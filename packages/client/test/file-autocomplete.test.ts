import { describe, expect, it } from 'vitest'
import {
  buildFileAutocompletePathSegments,
  findActiveFileAutocompleteMatch,
  normalizeFileAutocompleteQuery,
  normalizeFuzzyFileSearchMatches,
  replaceActiveFileAutocompleteMatch,
  toFileAutocompleteHandle
} from '../shared/file-autocomplete'

describe('file autocomplete helpers', () => {
  it('detects the active @file token at the caret', () => {
    expect(findActiveFileAutocompleteMatch('@/src/app.ts', 11, 11)).toEqual({
      start: 0,
      end: 12,
      raw: '@/src/app.ts',
      query: '/src/app.ts'
    })

    expect(findActiveFileAutocompleteMatch('/review @baz.ts', 15, 15)).toEqual({
      start: 8,
      end: 15,
      raw: '@baz.ts',
      query: 'baz.ts'
    })

    expect(findActiveFileAutocompleteMatch('Inspect\t@src/lib.ts', 19, 19)).toEqual({
      start: 8,
      end: 19,
      raw: '@src/lib.ts',
      query: 'src/lib.ts'
    })
  })

  it('normalizes fuzzy file search responses and builds markdown file handles', () => {
    expect(normalizeFuzzyFileSearchMatches({
      files: [{
        path: 'src/components',
        root: '/Users/demo/project',
        file_name: 'components',
        match_type: 'directory',
        score: 42,
        indices: [0, 1]
      }, {
        path: 'src/app.ts',
        root: '/Users/demo/project',
        fileName: 'app.ts',
        matchType: 'file',
        score: 99,
        indices: null
      }]
    })).toEqual([{
      path: 'src/components',
      root: '/Users/demo/project',
      fileName: 'components',
      matchType: 'directory',
      score: 42,
      indices: [0, 1]
    }, {
      path: 'src/app.ts',
      root: '/Users/demo/project',
      fileName: 'app.ts',
      matchType: 'file',
      score: 99,
      indices: null
    }])

    expect(normalizeFileAutocompleteQuery('/src/app.ts')).toBe('src/app.ts')
    expect(toFileAutocompleteHandle({
      root: '/Users/demo/project',
      path: 'src/app.ts',
      fileName: 'app.ts'
    })).toBe('[app.ts](/Users/demo/project/src/app.ts)')
    expect(toFileAutocompleteHandle({
      root: '/Users/demo/project',
      path: 'docs/My File.md',
      fileName: 'My File.md'
    })).toBe('[My File.md](/Users/demo/project/docs/My%20File.md)')
  })

  it('replaces the active token and preserves follow-up typing ergonomics', () => {
    expect(replaceActiveFileAutocompleteMatch(
      'Please inspect @baz.ts soon',
      {
        start: 15,
        end: 22
      },
      '[baz.ts](/src/lib/baz.ts)'
    )).toEqual({
      value: 'Please inspect [baz.ts](/src/lib/baz.ts) soon',
      caret: 40
    })

    expect(replaceActiveFileAutocompleteMatch(
      '@src/app.ts',
      {
        start: 0,
        end: 11
      },
      '[app.ts](/src/app.ts)'
    )).toEqual({
      value: '[app.ts](/src/app.ts)',
      caret: 21
    })

    expect(replaceActiveFileAutocompleteMatch(
      'Open @my file.ts',
      {
        start: 5,
        end: 16
      },
      '[my file.ts](/dir/my%20file.ts)'
    )).toEqual({
      value: 'Open [my file.ts](/dir/my%20file.ts)',
      caret: 36
    })
  })

  it('builds compact path segments with highlighted fuzzy matches', () => {
    expect(buildFileAutocompletePathSegments({
      path: 'src/components/LocalFileViewerModal.vue',
      indices: [0, 1, 2, 15, 16, 17, 18]
    })).toEqual([
      { text: '/', isMatch: false },
      { text: 'src', isMatch: true },
      { text: '/components/', isMatch: false },
      { text: 'Loca', isMatch: true },
      { text: 'lFileViewerModal.vue', isMatch: false }
    ])
  })
})
