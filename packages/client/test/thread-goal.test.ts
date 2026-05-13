import { describe, expect, it } from 'vitest'
import {
  applyThreadGoalCleared,
  applyThreadGoalUpdated,
  formatGoalElapsedSeconds,
  goalStatusLabel,
  normalizeThreadGoal
} from '../shared/thread-goal'

describe('thread goal helpers', () => {
  it('normalizes app-server thread goal payloads', () => {
    expect(normalizeThreadGoal({
      threadId: 'thread-1',
      objective: 'Ship goal support',
      status: 'active',
      tokenBudget: 1000,
      tokensUsed: 125,
      timeUsedSeconds: 65,
      createdAt: 1,
      updatedAt: 2
    })).toEqual({
      threadId: 'thread-1',
      objective: 'Ship goal support',
      status: 'active',
      tokenBudget: 1000,
      tokensUsed: 125,
      timeUsedSeconds: 65,
      createdAt: 1,
      updatedAt: 2
    })

    expect(normalizeThreadGoal({
      threadId: 'thread-1',
      objective: 'Ship goal support',
      status: 'unknown'
    })).toBeNull()
  })

  it('applies goal update and clear notifications immutably', () => {
    const goals = applyThreadGoalUpdated({}, {
      threadId: 'thread-1',
      turnId: null,
      goal: {
        threadId: 'thread-1',
        objective: 'Ship goal support',
        status: 'paused',
        tokenBudget: null,
        tokensUsed: 5,
        timeUsedSeconds: 9,
        createdAt: 1,
        updatedAt: 2
      }
    })

    expect(goals['thread-1']?.status).toBe('paused')
    expect(applyThreadGoalCleared(goals, { threadId: 'thread-1' })).toEqual({})
  })

  it('formats status and elapsed labels', () => {
    expect(goalStatusLabel('budgetLimited')).toBe('Budget limited')
    expect(formatGoalElapsedSeconds(59)).toBe('59s')
    expect(formatGoalElapsedSeconds(90)).toBe('1m')
    expect(formatGoalElapsedSeconds(90 * 60)).toBe('1h 30m')
    expect(formatGoalElapsedSeconds(26 * 60 * 60)).toBe('1d 2h')
  })
})
