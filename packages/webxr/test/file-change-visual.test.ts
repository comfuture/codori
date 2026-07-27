import { describe, expect, it } from 'vitest'
import {
  parseFilePatchLines,
  resolveFileChangeFrame
} from '../src/file-change-visual'

const update = {
  sourceId: 'file-item-1',
  path: 'src/app.ts',
  kind: 'update' as const,
  diff: [
    '@@ -10,3 +10,4 @@',
    ' const before = true',
    '-const removed = true',
    '+const replacement = true',
    '+const inserted = true',
    ' export default before'
  ].join('\n')
}

describe('file change panel frames', () => {
  it('parses hunk content without exposing unified diff headers', () => {
    expect(parseFilePatchLines(update.diff)).toEqual([
      expect.objectContaining({
        kind: 'context',
        text: 'const before = true',
        oldLine: 10,
        newLine: 10
      }),
      expect.objectContaining({
        kind: 'removed',
        text: 'const removed = true',
        oldLine: 11
      }),
      expect.objectContaining({
        kind: 'added',
        text: 'const replacement = true',
        newLine: 11
      }),
      expect.objectContaining({
        kind: 'added',
        text: 'const inserted = true',
        newLine: 12
      }),
      expect.objectContaining({
        kind: 'context',
        text: 'export default before',
        oldLine: 12,
        newLine: 13
      })
    ])
  })

  it('removes old lines before inserting and settling new lines', () => {
    const first = resolveFileChangeFrame({
      change: update,
      elapsedMs: 0
    })
    expect(first).toContain('const removed = true')
    expect(first).not.toContain('const replacement = true')

    const middle = resolveFileChangeFrame({
      change: update,
      elapsedMs: 170
    })
    expect(middle).not.toContain('const removed = true')
    expect(middle).toContain('const replacement = true')

    const final = resolveFileChangeFrame({
      change: update,
      elapsedMs: 250
    })
    expect(final).not.toContain('const removed = true')
    expect(final).toContain('const replacement = true')
    expect(final).toContain('const inserted = true')
    expect(final).not.toContain('\u001B')
  })

  it('shows the tail of a newly created file as content, not diff text', () => {
    const content = Array.from(
      { length: 24 },
      (_, index) => `+line ${index + 1}`
    ).join('\n')
    const final = resolveFileChangeFrame({
      change: {
        sourceId: 'file-item-2',
        path: 'src/new.ts',
        kind: 'add',
        diff: content
      },
      elapsedMs: 250,
      maximumLines: 8
    })
    expect(final).not.toContain('line 16')
    expect(final).toContain('line 17')
    expect(final).toContain('line 24')
    expect(final).not.toContain('+line')
  })
})
