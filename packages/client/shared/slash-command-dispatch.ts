import type { SubmittedSlashCommand } from './slash-commands'

export type SlashCommandDispatchAction =
  | {
      type: 'passThrough'
    }
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'openReview'
    }
  | {
      type: 'openUsageStatus'
    }
  | {
      type: 'openGoal'
    }
  | {
      type: 'setGoalObjective'
      objective: string
    }
  | {
      type: 'setGoalStatus'
      status: 'active' | 'paused'
    }
  | {
      type: 'clearGoal'
    }
  | {
      type: 'editGoal'
    }
  | {
      type: 'activatePlanMode'
    }
  | {
      type: 'submitPlanPrompt'
      text: string
    }

export const resolveSlashCommandDispatch = (input: {
  slashCommand: SubmittedSlashCommand
  attachmentsCount: number
  planModeAvailable: boolean
  planModeUnavailableMessage?: string | null
}): SlashCommandDispatchAction => {
  const { slashCommand, attachmentsCount, planModeAvailable, planModeUnavailableMessage } = input

  switch (slashCommand.name) {
    case 'review':
      if (attachmentsCount > 0) {
        return {
          type: 'error',
          message: 'Slash commands do not support image attachments yet.'
        }
      }

      if (!slashCommand.isBare) {
        return {
          type: 'error',
          message: '`/review` currently only supports the bare command. Choose the diff target in the review drawer.'
        }
      }

      return {
        type: 'openReview'
      }
    case 'usage':
    case 'status':
      if (attachmentsCount > 0) {
        return {
          type: 'error',
          message: 'Slash commands do not support image attachments yet.'
        }
      }

      if (!slashCommand.isBare) {
        return {
          type: 'error',
          message: `\`/${slashCommand.name}\` currently only supports the bare command.`
        }
      }

      return {
        type: 'openUsageStatus'
      }
    case 'goal': {
      if (attachmentsCount > 0) {
        return {
          type: 'error',
          message: 'Slash commands do not support image attachments yet.'
        }
      }

      if (slashCommand.isBare) {
        return {
          type: 'openGoal'
        }
      }

      const normalizedArgs = slashCommand.args.trim().toLowerCase()
      switch (normalizedArgs) {
        case 'pause':
          return {
            type: 'setGoalStatus',
            status: 'paused'
          }
        case 'resume':
          return {
            type: 'setGoalStatus',
            status: 'active'
          }
        case 'clear':
          return {
            type: 'clearGoal'
          }
        case 'edit':
          return {
            type: 'editGoal'
          }
        default:
          return {
            type: 'setGoalObjective',
            objective: slashCommand.args
          }
      }
    }
    case 'plan':
      if (!planModeAvailable) {
        return {
          type: 'error',
          message: planModeUnavailableMessage ?? 'Plan mode is unavailable in the current runtime.'
        }
      }

      if (slashCommand.isBare) {
        if (attachmentsCount > 0) {
          return {
            type: 'error',
            message: 'Bare `/plan` cannot submit image attachments. Switch mode first or add planning text.'
          }
        }

        return {
          type: 'activatePlanMode'
        }
      }

      return {
        type: 'submitPlanPrompt',
        text: slashCommand.args
      }
    default:
      return {
        type: 'passThrough'
      }
  }
}
