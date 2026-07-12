import { loadFonts } from '@xterm/addon-web-fonts'

// The static loader only uses the CSS Font Loading API. Keeping it separate
// from Terminal lets Codori retain stable Xterm 6.0 while awaiting webfonts.
export const WORKSPACE_TERMINAL_SYSTEM_FONT_FAMILY
  = 'SFMono-Regular, Menlo, Monaco, Consolas, monospace'

export const WORKSPACE_TERMINAL_MESLO_FONT_FAMILY
  = `"MesloLGS NF", ${WORKSPACE_TERMINAL_SYSTEM_FONT_FAMILY}`

export type WorkspaceTerminalFontLoader = (families: string[]) => Promise<unknown>

export const loadWorkspaceTerminalFontFamily = async (
  loader: WorkspaceTerminalFontLoader = loadFonts
) => {
  try {
    await loader(['MesloLGS NF'])
    return WORKSPACE_TERMINAL_MESLO_FONT_FAMILY
  } catch {
    return WORKSPACE_TERMINAL_SYSTEM_FONT_FAMILY
  }
}
