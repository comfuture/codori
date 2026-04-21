import { describe, expect, it } from 'vitest'
import { shouldQueuePlanImplementationPrompt } from '../shared/plan-implementation-prompt'

describe('plan implementation prompt helpers', () => {
  it('queues the drawer only for completed turns that emitted a plan', () => {
    expect(shouldQueuePlanImplementationPrompt({
      turnId: 'turn-1',
      latestPlanTurnId: 'turn-1',
      turnStatus: 'completed'
    })).toBe(true)

    expect(shouldQueuePlanImplementationPrompt({
      turnId: 'turn-1',
      latestPlanTurnId: 'turn-2',
      turnStatus: 'completed'
    })).toBe(false)

    expect(shouldQueuePlanImplementationPrompt({
      turnId: 'turn-1',
      latestPlanTurnId: 'turn-1',
      turnStatus: 'interrupted'
    })).toBe(false)

    expect(shouldQueuePlanImplementationPrompt({
      turnId: null,
      latestPlanTurnId: 'turn-1',
      turnStatus: 'completed'
    })).toBe(false)
  })
})
