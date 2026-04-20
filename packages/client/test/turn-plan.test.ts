import { describe, expect, it } from 'vitest'
import {
  applyTurnPlanUpdate,
  normalizeTurnPlanUpdate
} from '../shared/turn-plan'

describe('turn plan state', () => {
  it('normalizes valid turn plan updates and drops malformed steps', () => {
    expect(normalizeTurnPlanUpdate({
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: ' Keep the list visible ',
      plan: [{
        step: 'Implement sticky panel',
        status: 'inProgress'
      }, {
        step: '  ',
        status: 'pending'
      }, {
        step: 'Ship tests',
        status: 'completed'
      }, {
        step: 'Invalid status',
        status: 'done'
      }]
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: 'Keep the list visible',
      plan: [{
        step: 'Implement sticky panel',
        status: 'inProgress'
      }, {
        step: 'Ship tests',
        status: 'completed'
      }]
    })
  })

  it('auto-opens when the first task list arrives', () => {
    const firstPlan = applyTurnPlanUpdate(null, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: null,
      plan: [{
        step: 'Inspect upstream events',
        status: 'pending'
      }]
    }, 100)

    expect(firstPlan).toMatchObject({
      panelOpen: true,
      structuralSignature: '["Inspect upstream events"]',
      updatedAt: 100
    })
  })

  it('preserves manual collapse on status-only changes', () => {
    const initialPlan = applyTurnPlanUpdate(null, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: null,
      plan: [{
        step: 'Inspect upstream events',
        status: 'pending'
      }, {
        step: 'Implement sticky panel',
        status: 'pending'
      }]
    }, 100)

    const collapsedPlan = {
      ...initialPlan!,
      panelOpen: false
    }

    const nextPlan = applyTurnPlanUpdate(collapsedPlan, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: 'Status moved forward',
      plan: [{
        step: 'Inspect upstream events',
        status: 'completed'
      }, {
        step: 'Implement sticky panel',
        status: 'inProgress'
      }]
    }, 200)

    expect(nextPlan).toMatchObject({
      panelOpen: false,
      explanation: 'Status moved forward'
    })
  })

  it('re-opens when the task structure changes', () => {
    const collapsedPlan = applyTurnPlanUpdate(null, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: null,
      plan: [{
        step: 'Inspect upstream events',
        status: 'completed'
      }]
    }, 100)

    const nextPlan = applyTurnPlanUpdate({
      ...collapsedPlan!,
      panelOpen: false
    }, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      explanation: null,
      plan: [{
        step: 'Inspect upstream events',
        status: 'completed'
      }, {
        step: 'Capture screenshot',
        status: 'pending'
      }]
    }, 200)

    expect(nextPlan).toMatchObject({
      panelOpen: true,
      structuralSignature: '["Inspect upstream events","Capture screenshot"]'
    })
  })
})
