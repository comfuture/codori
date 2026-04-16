import { describe, expect, it } from 'vitest'
import {
  findActiveFileAutocompleteMatch,
  normalizeFileAutocompleteQuery,
  normalizeFuzzyFileSearchMatches,
  replaceActiveFileAutocompleteMatch,
  toFileAutocompleteInsertion
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

  it('normalizes fuzzy file search responses and insertion text', () => {
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
    expect(toFileAutocompleteInsertion({
      path: 'src/components',
      matchType: 'directory'
    })).toBe('/src/components/')
    expect(toFileAutocompleteInsertion({
      path: 'src/app.ts',
      matchType: 'file'
    })).toBe('/src/app.ts')
  })

  it('replaces the active token and preserves follow-up typing ergonomics', () => {
    expect(replaceActiveFileAutocompleteMatch(
      'Please inspect @baz.ts soon',
      {
        start: 15,
        end: 22
      },
      '/src/lib/baz.ts'
    )).toEqual({
      value: 'Please inspect /src/lib/baz.ts soon',
      caret: 30
    })

    expect(replaceActiveFileAutocompleteMatch(
      '@src/components',
      {
        start: 0,
        end: 15
      },
      '/src/components/'
    )).toEqual({
      value: '/src/components/',
      caret: 16
    })

    expect(replaceActiveFileAutocompleteMatch(
      'Open @my file.ts',
      {
        start: 5,
        end: 16
      },
      '/dir/my file.ts'
    )).toEqual({
      value: 'Open "/dir/my file.ts"',
      caret: 22
    })
  })
})
