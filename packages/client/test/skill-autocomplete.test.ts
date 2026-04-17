import { describe, expect, it } from 'vitest'
import {
  filterSkillAutocompleteEntries,
  findActiveSkillAutocompleteMatch,
  hasSkillAutocompleteMentions,
  normalizeSkillsListResponse,
  preprocessSkillMentionsForSubmission,
  reconcileSkillAutocompleteSelections,
  replaceActiveSkillAutocompleteMatch,
  toSkillAutocompleteCompletion,
  type SkillAutocompleteEntry,
  type SkillAutocompleteSelection
} from '../shared/skill-autocomplete'

const TEST_SKILLS: SkillAutocompleteEntry[] = [{
  name: 'imagegen',
  description: 'Generate or edit raster images.',
  enabled: true,
  path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md',
  scope: 'system',
  shortDescription: 'Create or edit bitmap assets.',
  displayName: 'Image Generator',
  brandColor: null,
  iconSmall: null,
  iconLarge: null
}, {
  name: 'linear',
  description: 'Inspect and update Linear issues.',
  enabled: true,
  path: '/Users/demo/.codex/skills/linear/SKILL.md',
  scope: 'user',
  shortDescription: null,
  displayName: null,
  brandColor: null,
  iconSmall: null,
  iconLarge: null
}, {
  name: 'gh-fix-ci',
  description: 'Fix failing Github CI actions.',
  enabled: true,
  path: '/Users/demo/.codex/skills/gh-fix-ci/SKILL.md',
  scope: 'user',
  shortDescription: 'Fix failing Github CI actions',
  displayName: null,
  brandColor: null,
  iconSmall: null,
  iconLarge: null
}, {
  name: 'duplicate',
  description: 'Repo-scoped duplicate',
  enabled: true,
  path: '/Users/demo/project/.agents/skills/duplicate/SKILL.md',
  scope: 'repo',
  shortDescription: null,
  displayName: null,
  brandColor: null,
  iconSmall: null,
  iconLarge: null
}, {
  name: 'duplicate',
  description: 'User-scoped duplicate',
  enabled: true,
  path: '/Users/demo/.codex/skills/duplicate/SKILL.md',
  scope: 'user',
  shortDescription: null,
  displayName: null,
  brandColor: null,
  iconSmall: null,
  iconLarge: null
}]

describe('skill autocomplete helpers', () => {
  it('detects the active $skill token at the caret', () => {
    expect(findActiveSkillAutocompleteMatch('$imagegen', 9, 9)).toEqual({
      start: 0,
      end: 9,
      raw: '$imagegen',
      query: 'imagegen'
    })

    expect(findActiveSkillAutocompleteMatch('Use $lin', 8, 8)).toEqual({
      start: 4,
      end: 8,
      raw: '$lin',
      query: 'lin'
    })

    expect(findActiveSkillAutocompleteMatch('Check $linear!', 14, 14)).toBeNull()
  })

  it('normalizes skills/list responses and filters skills by prefix', () => {
    expect(normalizeSkillsListResponse({
      data: [{
        cwd: '/Users/demo/project',
        errors: [{
          path: '/Users/demo/project/.agents/skills/bad/SKILL.md',
          message: 'Invalid frontmatter'
        }],
        skills: [{
          name: 'imagegen',
          description: 'Generate or edit raster images.',
          enabled: true,
          path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md',
          scope: 'system',
          shortDescription: 'Create or edit bitmap assets.',
          interface: {
            displayName: 'Image Generator'
          }
        }]
      }]
    })).toEqual([{
      cwd: '/Users/demo/project',
      errors: [{
        path: '/Users/demo/project/.agents/skills/bad/SKILL.md',
        message: 'Invalid frontmatter'
      }],
      skills: [{
        name: 'imagegen',
        description: 'Generate or edit raster images.',
        enabled: true,
        path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md',
        scope: 'system',
        shortDescription: 'Create or edit bitmap assets.',
        displayName: 'Image Generator',
        brandColor: null,
        iconSmall: null,
        iconLarge: null
      }]
    }])

    expect(filterSkillAutocompleteEntries(TEST_SKILLS, '').map(entry => entry.name)).toEqual([
      'imagegen',
      'linear',
      'gh-fix-ci',
      'duplicate',
      'duplicate'
    ])
    expect(filterSkillAutocompleteEntries(TEST_SKILLS, 'im').map(entry => entry.name)).toEqual(['imagegen'])
    expect(filterSkillAutocompleteEntries(TEST_SKILLS, 'fi').map(entry => entry.name)).toContain('gh-fix-ci')
    expect(filterSkillAutocompleteEntries(TEST_SKILLS, 'FI').map(entry => entry.name)).toContain('gh-fix-ci')
    expect(toSkillAutocompleteCompletion(TEST_SKILLS[0]!)).toBe('$imagegen')
  })

  it('replaces the active token and inserts one trailing space for follow-up typing', () => {
    expect(replaceActiveSkillAutocompleteMatch(
      'Use $imag please',
      {
        start: 4,
        end: 9
      },
      '$imagegen'
    )).toEqual({
      value: 'Use $imagegen please',
      caret: 13,
      tokenStart: 4,
      tokenEnd: 13
    })

    expect(replaceActiveSkillAutocompleteMatch(
      '$linear',
      {
        start: 0,
        end: 7
      },
      '$linear'
    )).toEqual({
      value: '$linear ',
      caret: 8,
      tokenStart: 0,
      tokenEnd: 7
    })
  })

  it('shifts or invalidates tracked selections as the draft changes', () => {
    const selections: SkillAutocompleteSelection[] = [{
      start: 4,
      end: 13,
      name: 'imagegen',
      path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md'
    }]

    expect(reconcileSkillAutocompleteSelections(
      'Use $imagegen ',
      'Please use $imagegen ',
      selections
    )).toEqual([{
      start: 11,
      end: 20,
      name: 'imagegen',
      path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md'
    }])

    expect(reconcileSkillAutocompleteSelections(
      'Use $imagegen ',
      'Use $image ',
      selections
    )).toEqual([])
  })

  it('preprocesses tracked selections first and falls back to unique skill names', () => {
    const selections: SkillAutocompleteSelection[] = [{
      start: 19,
      end: 29,
      name: 'duplicate',
      path: '/Users/demo/project/.agents/skills/duplicate/SKILL.md'
    }]

    expect(hasSkillAutocompleteMentions('Use $imagegen with $duplicate')).toBe(true)
    expect(hasSkillAutocompleteMentions('No skills here')).toBe(false)

    expect(preprocessSkillMentionsForSubmission(
      'Use $imagegen with $duplicate',
      selections,
      TEST_SKILLS
    )).toBe(
      'Use [$imagegen](/Users/demo/.codex/skills/.system/imagegen/SKILL.md) with [$duplicate](/Users/demo/project/.agents/skills/duplicate/SKILL.md)'
    )

    expect(preprocessSkillMentionsForSubmission(
      'Keep $duplicate raw when unresolved',
      [],
      TEST_SKILLS
    )).toBe('Keep $duplicate raw when unresolved')
  })
})
