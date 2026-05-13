import type { ThreadGoal } from './generated/codex-app-server/v2/ThreadGoal'
import type { ThreadGoalClearedNotification } from './generated/codex-app-server/v2/ThreadGoalClearedNotification'
import type { ThreadGoalStatus } from './generated/codex-app-server/v2/ThreadGoalStatus'
import type { ThreadGoalUpdatedNotification } from './generated/codex-app-server/v2/ThreadGoalUpdatedNotification'

const THREAD_GOAL_STATUSES = new Set<ThreadGoalStatus>([
  'active',
  'paused',
  'budgetLimited',
  'complete'
])

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isThreadGoalStatus = (value: unknown): value is ThreadGoalStatus =>
  typeof value === 'string' && THREAD_GOAL_STATUSES.has(value as ThreadGoalStatus)

const finiteNumberOrZero = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export const normalizeThreadGoal = (value: unknown): ThreadGoal | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  const threadId = value.threadId
  const objective = value.objective
  const status = value.status
  if (typeof threadId !== 'string' || typeof objective !== 'string' || !isThreadGoalStatus(status)) {
    return null
  }

  return {
    threadId,
    objective,
    status,
    tokenBudget: typeof value.tokenBudget === 'number' && Number.isFinite(value.tokenBudget)
      ? value.tokenBudget
      : null,
    tokensUsed: finiteNumberOrZero(value.tokensUsed),
    timeUsedSeconds: finiteNumberOrZero(value.timeUsedSeconds),
    createdAt: finiteNumberOrZero(value.createdAt),
    updatedAt: finiteNumberOrZero(value.updatedAt)
  }
}

export const normalizeThreadGoalUpdatedNotification = (
  params: unknown
): ThreadGoalUpdatedNotification | null => {
  if (!isObjectRecord(params)) {
    return null
  }

  const threadId = params.threadId
  const turnId = params.turnId
  const goal = normalizeThreadGoal(params.goal)
  if (typeof threadId !== 'string' || !goal) {
    return null
  }

  return {
    threadId,
    turnId: typeof turnId === 'string' ? turnId : null,
    goal
  }
}

export const normalizeThreadGoalClearedNotification = (
  params: unknown
): ThreadGoalClearedNotification | null => {
  if (!isObjectRecord(params) || typeof params.threadId !== 'string') {
    return null
  }

  return {
    threadId: params.threadId
  }
}

export const applyThreadGoalUpdated = (
  goals: Record<string, ThreadGoal>,
  params: unknown
) => {
  const notification = normalizeThreadGoalUpdatedNotification(params)
  if (!notification) {
    return goals
  }

  return {
    ...goals,
    [notification.threadId]: notification.goal
  }
}

export const applyThreadGoalCleared = (
  goals: Record<string, ThreadGoal>,
  params: unknown
) => {
  const notification = normalizeThreadGoalClearedNotification(params)
  if (!notification || !(notification.threadId in goals)) {
    return goals
  }

  const nextGoals = { ...goals }
  delete nextGoals[notification.threadId]
  return nextGoals
}

export const goalStatusLabel = (status: ThreadGoalStatus) => {
  switch (status) {
    case 'active':
      return 'Active'
    case 'paused':
      return 'Paused'
    case 'budgetLimited':
      return 'Budget limited'
    case 'complete':
      return 'Complete'
  }
}

export const formatGoalElapsedSeconds = (seconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

