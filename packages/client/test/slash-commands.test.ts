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
    expect(filterSlashCommands(SLASH_COMMANDS, '')).toHaveLength(4)
    expect(filterSlashCommands(SLASH_COMMANDS, 'pl').map(command => command.name)).toEqual(['plan'])
    expect(filterSlashCommands(SLASH_COMMANDS, 're').map(command => command.name)).toEqual(['review'])
    expect(filterSlashCommands(SLASH_COMMANDS, 'us').map(command => command.name)).toEqual(['usage'])
    expect(filterSlashCommands(SLASH_COMMANDS, 'st').map(command => command.name)).toEqual(['status'])
    expect(toSlashCommandCompletion(SLASH_COMMANDS[0]!)).toBe('/plan ')
    expect(toSlashCommandCompletion(SLASH_COMMANDS[1]!)).toBe('/review ')
  })

  it('parses submitted slash commands and inline args', () => {
    expect(parseSubmittedSlashCommand('/plan')).toEqual({
      name: 'plan',
      args: '',
      isBare: true
    })

    expect(parseSubmittedSlashCommand('/plan draft a migration')).toEqual({
      name: 'plan',
      args: 'draft a migration',
      isBare: false
    })

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

    expect(parseSubmittedSlashCommand('/usage')).toEqual({
      name: 'usage',
      args: '',
      isBare: true
    })

    expect(parseSubmittedSlashCommand('/status')).toEqual({
      name: 'status',
      args: '',
      isBare: true
    })

    expect(parseSubmittedSlashCommand('review')).toBeNull()
  })
})
