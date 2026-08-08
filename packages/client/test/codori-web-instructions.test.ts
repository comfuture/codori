import { describe, expect, it, vi } from 'vitest'
import type { ConfigReadParams } from '../shared/generated/codex-app-server/v2/ConfigReadParams'
import {
  CODORI_WEB_CLIENT_INSTRUCTIONS,
  composeCodoriDeveloperInstructions,
  readCodoriDeveloperInstructions,
  type CodoriInstructionConfigClient
} from '../shared/codori-web-instructions'

describe('Codori web client developer instructions', () => {
  it('preserves configured and feature instructions while adding one stable block', () => {
    const composed = composeCodoriDeveloperInstructions(
      'Keep the configured workflow.',
      'This is a specialized voice thread.'
    )

    expect(composed).toContain('Keep the configured workflow.')
    expect(composed).toContain('This is a specialized voice thread.')
    expect(composed).toContain('[ChatWorkspace.vue](packages/client/app/components/ChatWorkspace.vue:120)')
    expect(composed).toContain('![Architecture](artifacts/architecture.png)')
    expect(composed.match(/<codori_web_client_instructions>/gu)).toHaveLength(1)
  })

  it('replaces an existing Codori block instead of duplicating it', () => {
    const composed = composeCodoriDeveloperInstructions([
      'Keep this instruction.',
      CODORI_WEB_CLIENT_INSTRUCTIONS,
      'Keep this one too.'
    ].join('\n\n'))

    expect(composed).toContain('Keep this instruction.')
    expect(composed).toContain('Keep this one too.')
    expect(composed.match(/<codori_web_client_instructions>/gu)).toHaveLength(1)
  })

  it('reads the effective cwd-scoped config before composing instructions', async () => {
    const request = vi.fn()
    const client: CodoriInstructionConfigClient = {
      request: async <T>(method: 'config/read', params: ConfigReadParams): Promise<T> => {
        request(method, params)
        return {
          config: {
            developer_instructions: 'Configured instruction.'
          }
        } as T
      }
    }

    const composed = await readCodoriDeveloperInstructions(client, '/workspace')

    expect(request).toHaveBeenCalledWith('config/read', {
      includeLayers: false,
      cwd: '/workspace'
    })
    expect(composed).toContain('Configured instruction.')
    expect(composed).toContain(CODORI_WEB_CLIENT_INSTRUCTIONS)
  })

  it('still composes the Codori block when config is unavailable', async () => {
    const client: CodoriInstructionConfigClient = {
      request: async () => {
        throw new Error('config unavailable')
      }
    }

    await expect(readCodoriDeveloperInstructions(client, '/workspace')).resolves.toBe(
      CODORI_WEB_CLIENT_INSTRUCTIONS
    )
  })
})
