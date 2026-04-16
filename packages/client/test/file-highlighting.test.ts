import { describe, expect, it } from 'vitest'
import {
  buildHighlightedFileMarkdown,
  inferLocalFileLanguage,
  resolveLocalFileLanguageLabel
} from '../shared/file-highlighting'

describe('local file highlighting helpers', () => {
  it('infers languages from special filenames, extensions, and shebangs', () => {
    expect(inferLocalFileLanguage('/workspace/Dockerfile', '')).toBe('docker')
    expect(inferLocalFileLanguage('/workspace/src/App.vue', '')).toBe('vue')
    expect(inferLocalFileLanguage('/workspace/types/env.d.ts', '')).toBe('typescript')
    expect(inferLocalFileLanguage('/workspace/bin/dev', '#!/usr/bin/env bash\necho ok\n')).toBe('shellscript')
    expect(inferLocalFileLanguage('/workspace/README', 'plain text')).toBe(null)
  })

  it('resolves human-friendly labels for inferred languages', () => {
    expect(resolveLocalFileLanguageLabel('typescript')).toBe('TypeScript')
    expect(resolveLocalFileLanguageLabel('shellscript')).toBe('Shell')
    expect(resolveLocalFileLanguageLabel(null)).toBe(null)
  })

  it('builds a fenced markdown block with a safe fence length', () => {
    const markdown = buildHighlightedFileMarkdown('```\nconst value = 1\n```\n', 'typescript')

    expect(markdown.startsWith('````typescript\n')).toBe(true)
    expect(markdown.endsWith('\n````')).toBe(true)
    expect(markdown).toContain('const value = 1')
  })
})
