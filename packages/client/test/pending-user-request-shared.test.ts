import { nextTick, ref } from 'vue'
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
        scope: {
          answers: ['UI', 'drawer copy']
        }
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
          choice: {
            answers: ['Drawer flow']
          }
        }
      })
    })).resolves.toEqual({
      answers: {
        choice: {
          answers: ['Drawer flow']
        }
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

    expect(manager.resolveRequest(11, {
      answers: {
        choice: {
          answers: ['Ship']
        }
      }
    })).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      answers: {
        choice: {
          answers: ['Ship']
        }
      }
    })
    expect(manager.pendingRequest.value?.requestId).toBe(11)
    expect(manager.pendingRequest.value?.submitting).toBe(true)
    expect(manager.markRequestResolved(11)).toBe(true)
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

    expect(manager.resolveRequest(14, {
      answers: {
        choice: {
          answers: ['Ship']
        }
      }
    })).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      answers: {
        choice: {
          answers: ['Ship']
        }
      }
    })
    expect(manager.markRequestResolved(14)).toBe(true)
  })

  it('promotes draft-scoped live requests when a new thread starts', async () => {
    const activeThreadId = ref<string | null>(null)
    const manager = usePendingUserRequest(`project-${Date.now()}`, activeThreadId)
    const responsePromise = manager.handleServerRequest({
      id: 17,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'ChatWorkspace' }]
        }]
      }
    })

    expect(manager.pendingRequest.value?.kind).toBe('requestUserInput')
    expect(manager.pendingRequest.value?.threadId).toBeNull()

    activeThreadId.value = 'thread-live'
    await nextTick()

    expect(manager.pendingRequest.value?.kind).toBe('requestUserInput')
    expect(manager.pendingRequest.value?.threadId).toBeNull()

    expect(manager.resolveRequest(17, {
      answers: {
        scope: {
          answers: ['ChatWorkspace']
        }
      }
    })).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      answers: {
        scope: {
          answers: ['ChatWorkspace']
        }
      }
    })
    expect(manager.markRequestResolved(17)).toBe(true)
    expect(manager.pendingRequest.value).toBeNull()
  })

  it('uses the visible route thread when request-user-input arrives before thread hydration', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-route')
    const activeThreadId = ref<string | null>(null)
    const manager = usePendingUserRequest(projectId, currentThreadId, activeThreadId)
    const responsePromise = manager.handleServerRequest({
      id: 18,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Route thread' }]
        }]
      }
    })

    expect(manager.pendingRequest.value?.kind).toBe('requestUserInput')
    expect(manager.pendingRequest.value?.threadId).toBeNull()

    expect(manager.resolveRequest(18, {
      answers: {
        scope: {
          answers: ['Route thread']
        }
      }
    })).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      answers: {
        scope: {
          answers: ['Route thread']
        }
      }
    })
    expect(manager.markRequestResolved(18)).toBe(true)
    expect(manager.pendingRequest.value).toBeNull()
  })

  it('preserves pending requests across manager instances for the same thread', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-route')
    const firstManager = usePendingUserRequest(projectId, currentThreadId)
    const responsePromise = firstManager.handleServerRequest({
      id: 19,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-route',
        questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Preserved' }]
        }]
      }
    })

    const secondManager = usePendingUserRequest(projectId, currentThreadId)
    expect(secondManager.pendingRequest.value?.kind).toBe('requestUserInput')
    expect(secondManager.pendingRequest.value?.threadId).toBe('thread-route')

    expect(secondManager.resolveRequest(19, {
      answers: {
        scope: {
          answers: ['Preserved']
        }
      }
    })).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      answers: {
        scope: {
          answers: ['Preserved']
        }
      }
    })
    expect(secondManager.markRequestResolved(19)).toBe(true)
  })

  it('resolves requests by id even after the visible thread session changes', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-a')
    const manager = usePendingUserRequest(projectId, currentThreadId)
    const responsePromise = manager.handleServerRequest({
      id: 191,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-a',
        questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Chat surface' }]
        }]
      }
    })

    currentThreadId.value = 'thread-b'
    expect(manager.pendingRequest.value).toBeNull()

    expect(manager.resolveRequest(191, {
      answers: {
        scope: {
          answers: ['Chat surface']
        }
      }
    })).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      answers: {
        scope: {
          answers: ['Chat surface']
        }
      }
    })
    expect(manager.markRequestResolved(191)).toBe(true)
  })

  it('ignores stale responses after the queue advances to the next request', async () => {
    const activeThreadId = ref('thread-stale')
    const manager = usePendingUserRequest(`project-${Date.now()}`, activeThreadId)
    const firstResponse = manager.handleServerRequest({
      id: 20,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-stale',
        questions: [{
          id: 'first',
          question: 'First choice',
          options: [{ label: 'One' }]
        }]
      }
    })
    const secondResponse = manager.handleServerRequest({
      id: 21,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-stale',
        questions: [{
          id: 'second',
          question: 'Second choice',
          options: [{ label: 'Two' }]
        }]
      }
    })

    expect(manager.resolveRequest(20, {
      answers: {
        first: {
          answers: ['One']
        }
      }
    })).toBe(true)

    await expect(firstResponse).resolves.toEqual({
      answers: {
        first: {
          answers: ['One']
        }
      }
    })
    expect(manager.pendingRequest.value?.requestId).toBe(20)
    expect(manager.pendingRequest.value?.submitting).toBe(true)

    expect(manager.resolveRequest(20, {
      answers: {}
    })).toBe(false)
    expect(manager.pendingRequest.value?.requestId).toBe(20)

    expect(manager.markRequestResolved(20)).toBe(true)
    expect(manager.pendingRequest.value?.requestId).toBe(21)

    expect(manager.resolveRequest(21, {
      answers: {
        second: {
          answers: ['Two']
        }
      }
    })).toBe(true)

    await expect(secondResponse).resolves.toEqual({
      answers: {
        second: {
          answers: ['Two']
        }
      }
    })
    expect(manager.markRequestResolved(21)).toBe(true)
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
