import { describe, expect, it } from 'vitest'
import {
  filterSlashCommands,
  findActiveSlashCommand,
  parseSubmittedSlashCommand,
  SLASH_COMMANDS,
  toSlashCommandCompletion
} from '../shared/slash-commands'

describe('slash command helpers', () => {
  it('detects the active slash token from the caret position', () => {
    expect(findActiveSlashCommand('/review', 7, 7)).toEqual({
      start: 0,
      end: 7,
      raw: '/review',
      query: 'review'
    })

    expect(findActiveSlashCommand('Check /re', 9, 9)).toEqual({
      start: 6,
      end: 9,
      raw: '/re',
      query: 're'
    })
  })

  it('ignores caret positions outside the active slash token', () => {
    expect(findActiveSlashCommand('/review more', 12, 12)).toBeNull()
    expect(findActiveSlashCommand('/review', 3, 7)).toBeNull()
  })

  it('filters available commands by prefix and formats completion text', () => {
    expect(filterSlashCommands(SLASH_COMMANDS, '')).toHaveLength(1)
    expect(filterSlashCommands(SLASH_COMMANDS, 're').map(command => command.name)).toEqual(['review'])
    expect(toSlashCommandCompletion(SLASH_COMMANDS[0]!)).toBe('/review ')
  })

  it('parses submitted slash commands and inline args', () => {
    expect(parseSubmittedSlashCommand('/review')).toEqual({
      name: 'review',
      args: '',
      isBare: true
    })

    expect(parseSubmittedSlashCommand('/review compare this')).toEqual({
      name: 'review',
      args: 'compare this',
      isBare: false
    })

    expect(parseSubmittedSlashCommand('review')).toBeNull()
  })
})
