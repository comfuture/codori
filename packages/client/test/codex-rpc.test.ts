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
