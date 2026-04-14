import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePendingUserRequest } from '../app/composables/usePendingUserRequest'
import { toServerRequestResponse } from '../shared/codex-rpc'
import {
  buildMcpElicitationResponse,
  buildRequestUserInputResponse,
  parsePendingUserRequest
} from '../shared/pending-user-request'

describe('pending user request shared helpers', () => {
  it('parses request-user-input questions and builds answers payloads', () => {
    const parsed = parsePendingUserRequest({
      id: 7,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        questions: [{
          header: 'Scope',
          id: 'scope',
          question: 'What should Codex focus on?',
          options: [{
            label: 'UI',
            description: 'Tweak the interface'
          }],
          isOther: true,
          isSecret: false
        }]
      }
    })

    expect(parsed).toEqual({
      kind: 'requestUserInput',
      requestId: 7,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [{
        header: 'Scope',
        id: 'scope',
        question: 'What should Codex focus on?',
        options: [{
          label: 'UI',
          description: 'Tweak the interface'
        }],
        isOther: true,
        isSecret: false
      }]
    })

    expect(buildRequestUserInputResponse({
      scope: [' UI ', '', 'drawer copy']
    })).toEqual({
      answers: {
        scope: ['UI', 'drawer copy']
      }
    })
  })

  it('parses MCP elicitation form and url requests', () => {
    expect(parsePendingUserRequest({
      id: 9,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'form',
        message: 'Need confirmation',
        requestedSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              title: 'Email',
              format: 'email'
            },
            approved: {
              type: 'boolean',
              title: 'Approved'
            }
          },
          required: ['email']
        }
      }
    })).toEqual({
      kind: 'mcpElicitationForm',
      requestId: 9,
      threadId: null,
      message: 'Need confirmation',
      fields: [{
        kind: 'string',
        key: 'email',
        label: 'Email',
        description: null,
        required: true,
        minLength: null,
        maxLength: null,
        format: 'email',
        defaultValue: null
      }, {
        kind: 'boolean',
        key: 'approved',
        label: 'Approved',
        description: null,
        required: false,
        defaultValue: false
      }]
    })

    expect(parsePendingUserRequest({
      id: 10,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'url',
        message: 'Open the auth flow',
        url: 'https://example.com/auth',
        elicitationId: 'elic-1'
      }
    })).toEqual({
      kind: 'mcpElicitationUrl',
      requestId: 10,
      threadId: null,
      message: 'Open the auth flow',
      url: 'https://example.com/auth',
      elicitationId: 'elic-1'
    })

    expect(buildMcpElicitationResponse('accept', {
      email: 'octocat@example.com',
      approved: true
    })).toEqual({
      action: 'accept',
      content: {
        email: 'octocat@example.com',
        approved: true
      }
    })
  })

  it('delegates interactive server requests to the UI handler before falling back', async () => {
    await expect(toServerRequestResponse({
      id: 12,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{
          id: 'choice',
          question: 'Pick one'
        }]
      }
    }, {
      handler: async () => ({
        answers: {
          choice: ['Drawer flow']
        }
      })
    })).resolves.toEqual({
      answers: {
        choice: ['Drawer flow']
      }
    })

    await expect(toServerRequestResponse({
      id: 13,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'url',
        url: 'https://example.com/auth'
      }
    }, {
      handler: async () => null
    })).resolves.toEqual({
      action: 'decline',
      content: null,
      _meta: null
    })
  })

  it('holds an incoming request until the UI resolves it', async () => {
    const manager = usePendingUserRequest(`project-${Date.now()}`, ref('thread-1'))
    const responsePromise = manager.handleServerRequest({
      id: 11,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{
          id: 'choice',
          question: 'Pick one',
          options: [{ label: 'Ship', description: 'Proceed' }]
        }]
      }
    })

    expect(manager.pendingRequest.value?.kind).toBe('requestUserInput')

    manager.resolveCurrentRequest({
      answers: {
        choice: ['Ship']
      }
    })

    await expect(responsePromise).resolves.toEqual({
      answers: {
        choice: ['Ship']
      }
    })
    expect(manager.pendingRequest.value).toBeNull()
  })

  it('only exposes requests for the active thread session', async () => {
    const activeThreadId = ref('thread-a')
    const manager = usePendingUserRequest(`project-${Date.now()}`, activeThreadId)
    const responsePromise = manager.handleServerRequest({
      id: 14,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-a',
        questions: [{
          id: 'choice',
          question: 'Pick one',
          options: [{ label: 'Ship' }]
        }]
      }
    })

    expect(manager.pendingRequest.value?.threadId).toBe('thread-a')

    activeThreadId.value = 'thread-b'
    expect(manager.pendingRequest.value).toBeNull()

    activeThreadId.value = 'thread-a'
    expect(manager.pendingRequest.value?.threadId).toBe('thread-a')

    manager.resolveCurrentRequest({
      answers: {
        choice: ['Ship']
      }
    })

    await expect(responsePromise).resolves.toEqual({
      answers: {
        choice: ['Ship']
      }
    })
  })

  it('cancels pending requests on teardown with protocol-specific responses', async () => {
    const projectId = `project-${Date.now()}`
    const activeThreadId = ref('thread-a')
    const manager = usePendingUserRequest(projectId, activeThreadId)

    const userInputPromise = manager.handleServerRequest({
      id: 15,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-a',
        questions: [{
          id: 'choice',
          question: 'Pick one'
        }]
      }
    })
    const mcpPromise = manager.handleServerRequest({
      id: 16,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-b',
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              title: 'Email'
            }
          }
        }
      }
    })

    manager.cancelAllPendingRequests()

    await expect(userInputPromise).resolves.toEqual({
      answers: {}
    })
    await expect(mcpPromise).resolves.toEqual({
      action: 'cancel'
    })
    expect(manager.pendingRequest.value).toBeNull()
  })
})
