import { describe, expect, it } from 'vitest'
import { createDevelopmentKitchenSink } from '../src/development-kitchen-sink'

describe('development kitchen sink', () => {
  it('covers the immersive text surfaces without a live workspace', () => {
    const fixture = createDevelopmentKitchenSink(1_000)

    expect(fixture.panels).toHaveLength(8)
    expect(new Set(fixture.panels.map(panel => panel.kind))).toEqual(new Set([
      'command',
      'file-change',
      'mcp-tool',
      'dynamic-tool',
      'web-search',
      'background-terminal'
    ]))
    expect(fixture.panels.filter(panel => panel.fileChange)).toHaveLength(2)
    expect(fixture.panels.some(panel => panel.background)).toBe(true)
    expect(fixture.panels.find(panel => panel.id === 'kitchen-mcp')?.text)
      .toContain('framebuffer scale: 1.25')
    expect(fixture.panels.find(panel => panel.id === 'kitchen-mcp')?.text)
      .toContain('fixed foveation: 0.00')
    expect(fixture.panels.find(panel => panel.id === 'kitchen-mcp')?.text)
      .toContain('text anisotropy: 8x')
    expect(fixture.transcripts).toEqual([
      expect.objectContaining({
        generation: fixture.generation,
        role: 'assistant',
        final: false
      })
    ])
  })
})
