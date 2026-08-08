import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexRpcClient,
  notificationRequestId,
  notificationThreadName,
  notificationThreadId,
  notificationTurnId,
  notificationTurnStatus,
  type CodexRpcNotification
} from '../shared/codex-rpc'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Codex RPC payload parsing', () => {
  it('reinitializes one socket after a connected transport closes', async () => {
    class RecoverableWebSocket extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 3
      static readonly instances: RecoverableWebSocket[] = []

      readyState = RecoverableWebSocket.CONNECTING

      constructor() {
        super()
        RecoverableWebSocket.instances.push(this)
        queueMicrotask(() => {
          this.readyState = RecoverableWebSocket.OPEN
          this.dispatchEvent(new Event('open'))
        })
      }

      close() {
        if (this.readyState === RecoverableWebSocket.CLOSED) {
          return
        }
        this.readyState = RecoverableWebSocket.CLOSED
        this.dispatchEvent(new Event('close'))
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id?: number, method?: string }
        if (request.method !== 'initialize' || request.id === undefined) {
          return
        }
        queueMicrotask(() => {
          const event = new Event('message') as Event & { data: string }
          Object.defineProperty(event, 'data', {
            value: JSON.stringify({ id: request.id, result: {} })
          })
          this.dispatchEvent(event)
        })
      }
    }

    vi.stubGlobal('WebSocket', RecoverableWebSocket)
    const client = new CodexRpcClient('ws://example.test')
    const states: string[] = []
    client.subscribeConnectionState(state => states.push(state))

    await Promise.all([client.connect(), client.connect()])
    expect(RecoverableWebSocket.instances).toHaveLength(1)
    expect(client.isConnected()).toBe(true)

    RecoverableWebSocket.instances[0]?.close()
    expect(client.isConnected()).toBe(false)

    await Promise.all([client.connect(), client.connect()])
    expect(RecoverableWebSocket.instances).toHaveLength(2)
    expect(client.isConnected()).toBe(true)
    expect(states).toEqual([
      'idle',
      'connecting',
      'connected',
      'disconnected',
      'connecting',
      'connected'
    ])
  })

  it('rejects a connection closed before initialization', async () => {
    class ConnectingWebSocket extends EventTarget {
      static readonly CONNECTING = 0

      static readonly OPEN = 1

      readyState = ConnectingWebSocket.CONNECTING

      close() {
        this.readyState = 3
        this.dispatchEvent(new Event('close'))
      }

      send() {}
    }

    vi.stubGlobal('WebSocket', ConnectingWebSocket)
    const client = new CodexRpcClient('ws://example.test')
    const states: string[] = []
    client.subscribeConnectionState(state => states.push(state))

    const connection = client.connect()
    client.close()

    await expect(connection).rejects.toThrow('closed before initialization')
    expect(states).toEqual(['idle', 'connecting', 'disconnected'])
  })

  it('publishes connection changes until the lifecycle subscriber leaves', () => {
    const client = new CodexRpcClient('ws://example.test')
    const states: string[] = []
    const unsubscribe = client.subscribeConnectionState(state => states.push(state))
    const setConnectionState = (client as unknown as {
      setConnectionState: (state: 'connected' | 'disconnected') => void
    }).setConnectionState.bind(client)

    setConnectionState('connected')
    setConnectionState('disconnected')
    unsubscribe()
    setConnectionState('connected')

    expect(states).toEqual(['idle', 'connected', 'disconnected'])
  })

  it('accepts string ids for server-initiated requests', async () => {
    const client = new CodexRpcClient('ws://example.test')
    const parsePayload = (client as unknown as {
      parsePayload: (raw: unknown) => Promise<unknown>
    }).parsePayload.bind(client)

    await expect(parsePayload(JSON.stringify({
      id: 'request-user-input-1',
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{
          id: 'scope',
          question: 'Pick one'
        }]
      }
    }))).resolves.toEqual({
      id: 'request-user-input-1',
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{
          id: 'scope',
          question: 'Pick one'
        }]
      }
    })
  })

  it('parses generated turn completion notifications', () => {
    const notification: CodexRpcNotification = {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          items: [],
          itemsView: 'full',
          status: 'completed',
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 100
        }
      }
    }

    expect(notificationThreadId(notification)).toBe('thread-1')
    expect(notificationTurnId(notification)).toBe('turn-1')
    expect(notificationTurnStatus(notification)).toBe('completed')
  })

  it('parses generated thread name update notifications', () => {
    const notification: CodexRpcNotification = {
      method: 'thread/name/updated',
      params: {
        threadId: 'thread-1',
        threadName: 'Investigate projectless chat titles'
      }
    }

    expect(notificationThreadId(notification)).toBe('thread-1')
    expect(notificationThreadName(notification)).toBe('Investigate projectless chat titles')
  })

  it('parses generated plan update notifications', () => {
    const notification: CodexRpcNotification = {
      method: 'turn/plan/updated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        explanation: 'next',
        plan: [{
          step: 'Do it',
          status: 'inProgress'
        }]
      }
    }

    expect(notificationThreadId(notification)).toBe('thread-1')
    expect(notificationTurnId(notification)).toBe('turn-1')
  })

  it('parses generated server request resolution notifications', () => {
    const notification: CodexRpcNotification = {
      method: 'serverRequest/resolved',
      params: {
        threadId: 'thread-1',
        requestId: 'request-user-input-1'
      }
    }

    expect(notificationThreadId(notification)).toBe('thread-1')
    expect(notificationRequestId(notification)).toBe('request-user-input-1')
  })
})
