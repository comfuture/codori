export type SlashCommandName = 'review' | 'usage' | 'status'

export type SlashCommandDefinition = {
  name: SlashCommandName
  description: string
  supportsInlineArgs: boolean
  completeOnSpace: boolean
  executeOnEnter: boolean
}

export type ActiveSlashCommandMatch = {
  start: number
  end: number
  raw: string
  query: string
}

export type SubmittedSlashCommand = {
  name: string
  args: string
  isBare: boolean
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [{
  name: 'review',
  description: 'Review current changes or compare against a base branch.',
  supportsInlineArgs: false,
  completeOnSpace: true,
  executeOnEnter: true
}, {
  name: 'usage',
  description: 'Inspect current Codex quota windows and reset timing.',
  supportsInlineArgs: false,
  completeOnSpace: true,
  executeOnEnter: true
}, {
  name: 'status',
  description: 'Alias for `/usage` to inspect current Codex quota windows.',
  supportsInlineArgs: false,
  completeOnSpace: true,
  executeOnEnter: true
}]

export const findActiveSlashCommand = (
  input: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): ActiveSlashCommandMatch | null => {
  if (selectionStart == null || selectionEnd == null || selectionStart !== selectionEnd) {
    return null
  }

  const caret = selectionStart
  const lineStart = input.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
  const linePrefix = input.slice(lineStart, caret)
  const match = /(?:^|\s)(\/[a-z-]*)$/i.exec(linePrefix)
  if (!match) {
    return null
  }

  const raw = match[1] ?? ''
  if (!raw.startsWith('/')) {
    return null
  }

  return {
    start: caret - raw.length,
    end: caret,
    raw,
    query: raw.slice(1).toLowerCase()
  }
}

export const filterSlashCommands = (
  commands: SlashCommandDefinition[],
  query: string
) => {
  const normalizedQuery = query.trim().toLowerCase()
  return commands.filter(command => command.name.startsWith(normalizedQuery))
}

export const parseSubmittedSlashCommand = (input: string): SubmittedSlashCommand | null => {
  const trimmed = input.trim()
  const match = /^\/([a-z-]+)(?:\s+(.*))?$/i.exec(trimmed)
  if (!match) {
    return null
  }

  return {
    name: match[1]?.toLowerCase() ?? '',
    args: match[2]?.trim() ?? '',
    isBare: !(match[2]?.trim())
  }
}

export const toSlashCommandCompletion = (command: Pick<SlashCommandDefinition, 'name'>) =>
  `/${command.name} `
