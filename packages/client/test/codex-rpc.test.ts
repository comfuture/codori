import { describe, expect, it } from 'vitest'
import {
  CodexRpcClient,
  notificationRequestId,
  notificationThreadId,
  notificationTurnId,
  notificationTurnStatus,
  type CodexRpcNotification
} from '../shared/codex-rpc'

describe('Codex RPC payload parsing', () => {
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
