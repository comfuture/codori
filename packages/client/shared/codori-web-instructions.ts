import type { ConfigReadParams } from './generated/codex-app-server/v2/ConfigReadParams'
import type { ConfigReadResponse } from './generated/codex-app-server/v2/ConfigReadResponse'

export const CODORI_WEB_CLIENT_INSTRUCTIONS = `<codori_web_client_instructions>
This thread is displayed in Codori, a remote web client. When you mention a file that is inside the active workspace, use a valid Markdown link whose destination is a POSIX-style path relative to the workspace root, never an absolute host filesystem path or a file:// URL. For example: [ChatWorkspace.vue](packages/client/app/components/ChatWorkspace.vue:120). Preserve optional line and column locations as :line[:column]. If a relative destination contains spaces or parentheses, use valid Markdown escaping or an angle-bracket link destination.

Only use an absolute path when linking a temporary artifact that is genuinely outside the workspace and readable by the active app-server, such as a generated file under the platform temporary directory. Never link unrelated host files, credentials, secrets, or private configuration. Use the same path rules for Markdown images; when an image should appear inline, use syntax such as ![Architecture](artifacts/architecture.png) rather than exposing an absolute host path. Verify that a referenced file exists before linking it, keep link labels concise, and do not emit a browser-origin URL for a local file.
</codori_web_client_instructions>`

const CODORI_INSTRUCTIONS_RE = /<codori_web_client_instructions>[\s\S]*?<\/codori_web_client_instructions>/gu

export const composeCodoriDeveloperInstructions = (
  configuredInstructions: string | null | undefined,
  additionalInstructions?: string | null
) => [
  configuredInstructions?.replace(CODORI_INSTRUCTIONS_RE, '').trim(),
  additionalInstructions?.replace(CODORI_INSTRUCTIONS_RE, '').trim(),
  CODORI_WEB_CLIENT_INSTRUCTIONS
].filter((part): part is string => Boolean(part)).join('\n\n')

export type CodoriInstructionConfigClient = {
  request<T>(method: 'config/read', params: ConfigReadParams): Promise<T>
}

export const readCodoriDeveloperInstructions = async (
  client: CodoriInstructionConfigClient,
  cwd: string | null,
  additionalInstructions?: string | null
) => {
  try {
    const response = await client.request<ConfigReadResponse>('config/read', {
      includeLayers: false,
      cwd
    })
    return composeCodoriDeveloperInstructions(
      response.config.developer_instructions,
      additionalInstructions
    )
  } catch {
    return composeCodoriDeveloperInstructions(null, additionalInstructions)
  }
}
