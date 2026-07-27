import { describe, expect, it } from 'vitest'
import {
  retainBoundedOutput,
  SpatialPanelModel,
  type SpatialPanelInput
} from '../src/panel-model'

const panel = (
  input: Partial<SpatialPanelInput> = {}
): SpatialPanelInput => ({
  id: 'command:1',
  kind: 'command',
  title: 'Run tests',
  status: 'in-progress',
  text: 'testing',
  cwd: '/project',
  exitCode: null,
  background: false,
  ...input
})

describe('spatial panel model', () => {
  it('bounds retained output and leaves a visible truncation marker', () => {
    const retained = retainBoundedOutput('0123456789'.repeat(12), 64)
    expect(retained.truncated).toBe(true)
    expect(retained.text).toContain('truncated')
    expect(retained.text).toMatch(/89$/)
    expect(retained.text).toHaveLength(64)
  })

  it('eases in, dwells three seconds after completion, then disappears', () => {
    const model = new SpatialPanelModel()
    model.upsert(panel(), 0)
    expect(model.snapshots()[0]?.phase).toBe('appearing')
    model.advance(420)
    expect(model.snapshots()[0]?.phase).toBe('visible')

    model.upsert(panel({
      status: 'completed',
      text: 'done',
      exitCode: 0
    }), 1_000)
    expect(model.snapshots()[0]?.phase).toBe('dwelling')
    model.advance(3_999)
    expect(model.snapshots()[0]?.phase).toBe('dwelling')
    model.advance(4_000)
    expect(model.snapshots()[0]?.phase).toBe('disappearing')
    model.advance(4_420)
    expect(model.snapshots()).toHaveLength(0)
  })

  it('still dwells and disappears when the first observed state is terminal', () => {
    const model = new SpatialPanelModel()
    model.upsert(panel({
      status: 'failed',
      text: 'failed before the started notification arrived'
    }), 0)

    model.advance(420)
    expect(model.snapshots()[0]?.phase).toBe('dwelling')
    model.advance(3_419)
    expect(model.snapshots()[0]?.phase).toBe('dwelling')
    model.advance(3_420)
    expect(model.snapshots()[0]?.phase).toBe('disappearing')
    model.advance(3_840)
    expect(model.snapshots()).toHaveLength(0)

    model.upsert(panel({
      status: 'failed',
      text: 'an unrelated update must not resurrect this panel'
    }), 4_000)
    expect(model.snapshots()).toHaveLength(0)
  })

  it('keeps background panels until the authoritative list removes them', () => {
    const model = new SpatialPanelModel()
    const background = panel({
      id: 'background:item-1:process-1',
      kind: 'background-terminal',
      background: true
    })
    model.reconcileBackground([background], 0)
    model.advance(10_000)
    expect(model.snapshots()).toHaveLength(1)

    model.reconcileBackground([], 10_001)
    expect(model.snapshots()[0]?.phase).toBe('disappearing')
    model.advance(10_421)
    expect(model.snapshots()).toHaveLength(0)
  })

  it('removes foreground panels when authoritative classification changes', () => {
    const model = new SpatialPanelModel()
    model.reconcileForeground([panel()], 0)
    model.advance(420)
    expect(model.snapshots()[0]?.phase).toBe('visible')

    model.reconcileForeground([], 500)
    expect(model.snapshots()[0]?.phase).toBe('disappearing')
    model.advance(920)
    expect(model.snapshots()).toHaveLength(0)
  })

  it('preserves manual reading position until returning to the live tail', () => {
    const model = new SpatialPanelModel()
    model.upsert(panel({
      text: ['one', 'two', 'three', 'four'].join('\n')
    }), 0)
    model.scroll('command:1', -2)
    model.upsert(panel({
      text: ['one', 'two', 'three', 'four', 'five'].join('\n')
    }), 1)
    expect(model.snapshots()[0]).toMatchObject({
      autoFollow: false,
      scrollOffset: 1
    })
    model.scroll('command:1', 10)
    expect(model.snapshots()[0]?.autoFollow).toBe(true)
    expect(model.snapshots()[0]?.scrollOffset).toBe(Number.POSITIVE_INFINITY)
  })
})
