import type { ComarkTree } from '@comark/vue'
import { describe, expect, it } from 'vitest'

import {
  REVIEW_PRIORITY_BADGE_TAG,
  transformReviewPriorityBadges
} from '../app/utils/review-priority-badge'

describe('transformReviewPriorityBadges', () => {
  it('replaces a leading priority span at the start of a list item', () => {
    const tree: ComarkTree = {
      nodes: [
        ['ul', {},
          ['li', {},
            ['span', {}, 'P1'],
            ' Fix the regression.'
          ]
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformReviewPriorityBadges(tree)

    expect(result.nodes).toEqual([
      ['ul', {},
        ['li', {},
          [REVIEW_PRIORITY_BADGE_TAG, { priority: '1' }, 'P1'],
          ' Fix the regression.'
        ]
      ]
    ])
  })

  it('replaces a leading priority span inside a paragraph-wrapped list item', () => {
    const tree: ComarkTree = {
      nodes: [
        ['ul', {},
          ['li', {},
            ['p', {},
              ['span', {}, 'P2'],
              ' Tighten the branch handling.'
            ]
          ]
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformReviewPriorityBadges(tree)

    expect(result.nodes).toEqual([
      ['ul', {},
        ['li', {},
          ['p', {},
            [REVIEW_PRIORITY_BADGE_TAG, { priority: '2' }, 'P2'],
            ' Tighten the branch handling.'
          ]
        ]
      ]
    ])
  })

  it('leaves non-leading and non-list priority spans unchanged', () => {
    const tree: ComarkTree = {
      nodes: [
        ['p', {},
          ['span', {}, 'P3'],
          ' Paragraph content'
        ],
        ['ul', {},
          ['li', {},
            'Prefix ',
            ['span', {}, 'P1'],
            ' should stay plain text.'
          ]
        ]
      ],
      frontmatter: {},
      meta: {}
    }

    const result = transformReviewPriorityBadges(tree)

    expect(result).toEqual(tree)
  })
})
