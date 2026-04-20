import { describe, expect, it } from 'vitest'
import { CodexRpcClient } from '../shared/codex-rpc'

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
})
