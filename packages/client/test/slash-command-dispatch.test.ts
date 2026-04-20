import { describe, expect, it } from 'vitest'
import { resolveSlashCommandDispatch } from '../shared/slash-command-dispatch'

describe('slash command dispatch', () => {
  it('routes bare /plan to a mode switch', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'plan',
        args: '',
        isBare: true
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'activatePlanMode'
    })
  })

  it('routes inline /plan to a normal planning turn', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'plan',
        args: 'Draft a rollout plan',
        isBare: false
      },
      attachmentsCount: 1,
      planModeAvailable: true
    })).toEqual({
      type: 'submitPlanPrompt',
      text: 'Draft a rollout plan'
    })
  })

  it('surfaces plan-mode unavailability instead of falling back to plain chat', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'plan',
        args: '',
        isBare: true
      },
      attachmentsCount: 0,
      planModeAvailable: false,
      planModeUnavailableMessage: 'Plan mode is unavailable in the current runtime.'
    })).toEqual({
      type: 'error',
      message: 'Plan mode is unavailable in the current runtime.'
    })
  })
})
