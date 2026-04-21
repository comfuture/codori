import { describe, expect, it } from 'vitest'
import {
  buildCollaborationModeFromMask,
  findCollaborationModeMask,
  normalizeCollaborationModeListResponse,
  resolveThreadCollaborationModeKey
} from '../shared/collaboration-mode'

describe('collaboration mode helpers', () => {
  it('normalizes collaboration mode list responses', () => {
    expect(normalizeCollaborationModeListResponse({
      data: [{
        name: 'Plan',
        mode: 'plan',
        model: null,
        reasoning_effort: 'medium'
      }, {
        name: 'Default',
        mode: 'default',
        model: null
      }]
    })).toEqual([{
      name: 'Plan',
      mode: 'plan',
      model: null,
      reasoning_effort: 'medium'
    }, {
      name: 'Default',
      mode: 'default',
      model: null,
      reasoning_effort: undefined
    }])
  })

  it('preserves explicit null reasoning effort overrides', () => {
    const defaultMask = findCollaborationModeMask([{
      name: 'Default',
      mode: 'default',
      model: null,
      reasoning_effort: null
    }], 'default')

    expect(buildCollaborationModeFromMask(defaultMask, {
      model: 'gpt-5.4',
      reasoning_effort: 'high'
    })).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: null,
        developer_instructions: null
      }
    })
  })

  it('builds a concrete collaboration mode from a mask and base prompt settings', () => {
    const planMask = findCollaborationModeMask([{
      name: 'Plan',
      mode: 'plan',
      model: null,
      reasoning_effort: 'medium'
    }], 'plan')

    expect(buildCollaborationModeFromMask(planMask, {
      model: 'gpt-5.4',
      reasoning_effort: 'low'
    })).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null
      }
    })
  })

  it('uses a stable draft key before a thread exists', () => {
    expect(resolveThreadCollaborationModeKey(null)).toBe('__draft__')
    expect(resolveThreadCollaborationModeKey('thread-1')).toBe('thread-1')
  })
})
