import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePendingUserRequest } from '../app/composables/usePendingUserRequest'
import { toServerRequestResponse, type CodexRpcServerRequest } from '../shared/codex-rpc'
import {
  buildMcpElicitationResponse,
  buildRequestUserInputResponse,
  parsePendingUserRequest
} from '../shared/pending-user-request'

const makeRequestUserInputRequest = (input: {
  id: string | number
  threadId?: string | null
  turnId?: string | null
  itemId?: string | null
  questions: Array<Record<string, unknown>>
}): CodexRpcServerRequest => ({
  id: input.id,
  method: 'item/tool/requestUserInput',
  params: {
    ...(input.threadId != null ? { threadId: input.threadId } : {}),
    ...(input.turnId != null ? { turnId: input.turnId } : {}),
    ...(input.itemId != null ? { itemId: input.itemId } : {}),
    questions: input.questions
  }
})

const makeMcpElicitationRequest = (input: {
  id: string | number
  mode: 'form' | 'url'
  threadId?: string | null
  turnId?: string | null
  serverName?: string
  message: string
  requestedSchema?: Record<string, unknown>
  url?: string
  elicitationId?: string
}): CodexRpcServerRequest => ({
  id: input.id,
  method: 'mcpServer/elicitation/request',
  params: input.mode === 'form'
    ? {
        mode: 'form',
        ...(input.threadId != null ? { threadId: input.threadId } : {}),
        ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
        serverName: input.serverName ?? 'test-server',
        _meta: null,
        message: input.message,
        requestedSchema: input.requestedSchema ?? {
          type: 'object',
          properties: {}
        }
      }
    : {
        mode: 'url',
        ...(input.threadId != null ? { threadId: input.threadId } : {}),
        ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
        serverName: input.serverName ?? 'test-server',
        _meta: null,
        message: input.message,
        url: input.url ?? 'https://example.com/auth',
        elicitationId: input.elicitationId ?? 'elic-1'
      }
})

describe('pending user request shared helpers', () => {
  it('parses request-user-input questions and builds answers payloads', () => {
    const parsed = parsePendingUserRequest(makeRequestUserInputRequest({
      id: 7,
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
    }))

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
    expect(parsePendingUserRequest(makeMcpElicitationRequest({
      id: 9,
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
    }))).toEqual({
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

    expect(parsePendingUserRequest(makeMcpElicitationRequest({
      id: 10,
      mode: 'url',
      message: 'Open the auth flow'
    }))).toEqual({
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
    await expect(toServerRequestResponse(makeRequestUserInputRequest({
      id: 12,
      questions: [{
          id: 'choice',
          question: 'Pick one'
        }]
    }), {
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

    await expect(toServerRequestResponse(makeMcpElicitationRequest({
      id: 13,
      mode: 'url',
      message: 'Open the auth flow'
    }), {
      handler: async () => null
    })).resolves.toEqual({
      action: 'decline',
      content: null,
      _meta: null
    })
  })

  it('holds an incoming request until the UI resolves it', async () => {
    const manager = usePendingUserRequest(`project-${Date.now()}`, ref('thread-1'))
    const responsePromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 11,
      questions: [{
          id: 'choice',
          question: 'Pick one',
          options: [{ label: 'Ship', description: 'Proceed' }]
        }]
    }))

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
    expect(manager.pendingRequest.value).toBeNull()
    expect(manager.markRequestResolved(11)).toBe(false)
    expect(manager.pendingRequest.value).toBeNull()
  })

  it('only exposes requests for the active thread session', async () => {
    const activeThreadId = ref('thread-a')
    const manager = usePendingUserRequest(`project-${Date.now()}`, activeThreadId)
    const responsePromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 14,
      threadId: 'thread-a',
      questions: [{
          id: 'choice',
          question: 'Pick one',
          options: [{ label: 'Ship' }]
        }]
    }))

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
    expect(manager.markRequestResolved(14)).toBe(false)
  })

  it('promotes draft-scoped live requests when a new thread starts', async () => {
    const activeThreadId = ref<string | null>(null)
    const manager = usePendingUserRequest(`project-${Date.now()}`, activeThreadId)
    const responsePromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 17,
      questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'ChatWorkspace' }]
        }]
    }))

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
    expect(manager.markRequestResolved(17)).toBe(false)
    expect(manager.pendingRequest.value).toBeNull()
  })

  it('uses the visible route thread when request-user-input arrives before thread hydration', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-route')
    const activeThreadId = ref<string | null>(null)
    const manager = usePendingUserRequest(projectId, currentThreadId, activeThreadId)
    const responsePromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 18,
      questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Route thread' }]
        }]
    }))

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
    expect(manager.markRequestResolved(18)).toBe(false)
    expect(manager.pendingRequest.value).toBeNull()
  })

  it('preserves pending requests across manager instances for the same thread', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-route')
    const firstManager = usePendingUserRequest(projectId, currentThreadId)
    const responsePromise = firstManager.handleServerRequest(makeRequestUserInputRequest({
      id: 19,
      threadId: 'thread-route',
      questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Preserved' }]
        }]
    }))

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
    expect(secondManager.markRequestResolved(19)).toBe(false)
  })

  it('resolves requests by id even after the visible thread session changes', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-a')
    const manager = usePendingUserRequest(projectId, currentThreadId)
    const responsePromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 191,
      threadId: 'thread-a',
      questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Chat surface' }]
        }]
    }))

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
    expect(manager.markRequestResolved(191)).toBe(false)
  })

  it('can resolve a pending request using the generated thread id from serverRequest/resolved', async () => {
    const projectId = `project-${Date.now()}`
    const currentThreadId = ref<string | null>('thread-a')
    const manager = usePendingUserRequest(projectId, currentThreadId)
    const responsePromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 192,
      threadId: 'thread-a',
      questions: [{
          id: 'scope',
          question: 'Pick a scope',
          options: [{ label: 'Chat surface' }]
        }]
    }))

    currentThreadId.value = 'thread-b'
    expect(manager.pendingRequest.value).toBeNull()

    expect(manager.resolveRequest(192, {
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
    expect(manager.markRequestResolved(192, 'thread-a')).toBe(false)
  })

  it('ignores stale responses after the queue advances to the next request', async () => {
    const activeThreadId = ref('thread-stale')
    const manager = usePendingUserRequest(`project-${Date.now()}`, activeThreadId)
    const firstResponse = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 20,
      threadId: 'thread-stale',
      questions: [{
          id: 'first',
          question: 'First choice',
          options: [{ label: 'One' }]
        }]
    }))
    const secondResponse = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 21,
      threadId: 'thread-stale',
      questions: [{
          id: 'second',
          question: 'Second choice',
          options: [{ label: 'Two' }]
        }]
    }))

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
    expect(manager.pendingRequest.value?.requestId).toBe(21)

    expect(manager.resolveRequest(20, {
      answers: {}
    })).toBe(false)
    expect(manager.pendingRequest.value?.requestId).toBe(21)

    expect(manager.markRequestResolved(20)).toBe(false)
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
    expect(manager.markRequestResolved(21)).toBe(false)
  })

  it('cancels pending requests on teardown with protocol-specific responses', async () => {
    const projectId = `project-${Date.now()}`
    const activeThreadId = ref('thread-a')
    const manager = usePendingUserRequest(projectId, activeThreadId)

    const userInputPromise = manager.handleServerRequest(makeRequestUserInputRequest({
      id: 15,
      threadId: 'thread-a',
      questions: [{
          id: 'choice',
          question: 'Pick one'
        }]
    }))
    const mcpPromise = manager.handleServerRequest(makeMcpElicitationRequest({
      id: 16,
      threadId: 'thread-b',
      mode: 'form',
      message: 'Need confirmation',
      requestedSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              title: 'Email'
            }
          }
        }
    }))

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
