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

  it('routes bare /goal to goal inspection', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: '',
        isBare: true
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'openGoal'
    })
  })

  it('routes inline /goal text to a goal objective update', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: 'Ship issue #68',
        isBare: false
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'setGoalObjective',
      objective: 'Ship issue #68'
    })
  })

  it('routes /goal control commands to goal actions', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: 'pause',
        isBare: false
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'setGoalStatus',
      status: 'paused'
    })

    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: 'resume',
        isBare: false
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'setGoalStatus',
      status: 'active'
    })

    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: 'clear',
        isBare: false
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'clearGoal'
    })

    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: 'edit',
        isBare: false
      },
      attachmentsCount: 0,
      planModeAvailable: true
    })).toEqual({
      type: 'editGoal'
    })
  })

  it('rejects /goal commands with image attachments', () => {
    expect(resolveSlashCommandDispatch({
      slashCommand: {
        name: 'goal',
        args: 'Ship issue #68',
        isBare: false
      },
      attachmentsCount: 1,
      planModeAvailable: true
    })).toEqual({
      type: 'error',
      message: 'Slash commands do not support image attachments yet.'
    })
  })
})
