import type { ComarkTree } from '@comark/vue'
import { parse } from '@comark/vue/parse'
import { describe, expect, it } from 'vitest'

import {
  SKILL_REFERENCE_BADGE_TAG,
  skillReferenceBadgePlugin,
  transformSkillReferenceBadges
} from '../app/utils/skill-reference-badge'

describe('transformSkillReferenceBadges', () => {
  it('replaces submitted skill markdown links with skill badge nodes', () => {
    const tree: ComarkTree = {
      nodes: [
        ['p', {},
          'Use ',
          ['a', { href: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md' }, '$imagegen'],
          ' now.'
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformSkillReferenceBadges(tree)

    expect(result.nodes).toEqual([
      ['p', {},
        'Use ',
        [
          SKILL_REFERENCE_BADGE_TAG,
          {
            name: 'imagegen',
            path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md'
          }
        ],
        ' now.'
      ]
    ])
  })

  it('decodes encoded local skill paths', () => {
    const tree: ComarkTree = {
      nodes: [
        ['p', {},
          ['a', { href: '/Users/demo/My%20Skills/%ED%85%8C%EC%8A%A4%ED%8A%B8/SKILL.md' }, '$skill-name']
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformSkillReferenceBadges(tree)

    expect(result.nodes).toEqual([
      ['p', {},
        [
          SKILL_REFERENCE_BADGE_TAG,
          {
            name: 'skill-name',
            path: '/Users/demo/My Skills/테스트/SKILL.md'
          }
        ]
      ]
    ])
  })

  it('leaves non-skill links unchanged', () => {
    const tree: ComarkTree = {
      nodes: [
        ['p', {},
          ['a', { href: 'https://example.com' }, '$imagegen'],
          ' ',
          ['a', { href: '/Users/demo/.codex/skills/imagegen/SKILL.md' }, 'imagegen'],
          ' ',
          ['a', { href: '/Users/demo/.codex/skills/imagegen/README.md' }, '$imagegen']
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformSkillReferenceBadges(tree)

    expect(result).toEqual(tree)
  })
})

describe('skillReferenceBadgePlugin', () => {
  it('parses submitted skill markdown links before raw skill matching can break link labels', async () => {
    const tree = await parse('Use [$imagegen](/Users/demo/.codex/skills/.system/imagegen/SKILL.md) now.', {
      plugins: [
        skillReferenceBadgePlugin()
      ]
    })

    expect(tree.nodes).toEqual([
      ['p', {},
        'Use ',
        [
          SKILL_REFERENCE_BADGE_TAG,
          {
            name: 'imagegen',
            path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md'
          }
        ],
        ' now.'
      ]
    ])
  })

  it('parses raw skill references before math auto-close consumes them', async () => {
    const tree = await parse('$skill-name additional text', {
      plugins: [
        skillReferenceBadgePlugin()
      ]
    })

    expect(tree.nodes).toEqual([
      ['p', {},
        [SKILL_REFERENCE_BADGE_TAG, { name: 'skill-name', raw: 'true' }],
        ' additional text'
      ]
    ])
  })

  it('accepts case-insensitive and digit-prefixed skill tokens', async () => {
    const tree = await parse('Use $ImageGen and $1tool.', {
      plugins: [
        skillReferenceBadgePlugin()
      ]
    })

    expect(tree.nodes).toEqual([
      ['p', {},
        'Use ',
        [SKILL_REFERENCE_BADGE_TAG, { name: 'ImageGen', raw: 'true' }],
        ' and ',
        [SKILL_REFERENCE_BADGE_TAG, { name: '1tool', raw: 'true' }],
        '.'
      ]
    ])
  })

  it('removes auto-close markers directly after raw skill badges', () => {
    const tree: ComarkTree = {
      nodes: [
        ['p', {},
          [SKILL_REFERENCE_BADGE_TAG, { name: 'skill-name', raw: 'true' }],
          '$ and more text'
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformSkillReferenceBadges(tree)

    expect(result.nodes).toEqual([
      ['p', {},
        [SKILL_REFERENCE_BADGE_TAG, { name: 'skill-name', raw: 'true' }],
        ' and more text'
      ]
    ])
  })

  it('removes trailing auto-close markers after raw skill content', () => {
    const tree: ComarkTree = {
      nodes: [
        ['p', {},
          [SKILL_REFERENCE_BADGE_TAG, { name: 'skill-name', raw: 'true' }],
          ' additional text$ '
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformSkillReferenceBadges(tree)

    expect(result.nodes).toEqual([
      ['p', {},
        [SKILL_REFERENCE_BADGE_TAG, { name: 'skill-name', raw: 'true' }],
        ' additional text '
      ]
    ])
  })

  it('does not treat ordinary inline LaTeX as a skill reference', async () => {
    const tree = await parse('Energy: $E = mc^2$.', {
      plugins: [
        skillReferenceBadgePlugin()
      ]
    })

    expect(tree.nodes).toEqual([
      ['p', {}, 'Energy: $E = mc^2$.']
    ])
  })

  it('does not replace code spans or fenced code', async () => {
    const tree = await parse([
      'Inline `$skill-name`.',
      '',
      '```text',
      '$skill-name',
      '```'
    ].join('\n'), {
      plugins: [
        skillReferenceBadgePlugin()
      ]
    })

    expect(tree.nodes).toEqual([
      ['p', {}, 'Inline ', ['code', {}, '$skill-name'], '.'],
      ['pre', { language: 'text' }, ['code', { class: 'language-text' }, '$skill-name']]
    ])
  })
})
