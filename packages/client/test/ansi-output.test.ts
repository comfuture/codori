import { describe, expect, it } from 'vitest'

import { parseAnsiOutput } from '../app/utils/ansi-output'

describe('parseAnsiOutput', () => {
  it('renders SGR text colors and resets without leaking escape codes', () => {
    const segments = parseAnsiOutput('ok \x1B[31mred\x1B[0m done')

    expect(segments).toEqual([
      {
        text: 'ok ',
        style: {}
      },
      {
        text: 'red',
        style: {
          color: '#dc2626'
        }
      },
      {
        text: ' done',
        style: {}
      }
    ])
  })

  it('supports bold, background color, and 24-bit colors', () => {
    const segments = parseAnsiOutput('\x1B[1;42mgreen bg\x1B[22;48;2;12;34;56m rgb bg')

    expect(segments).toEqual([
      {
        text: 'green bg',
        style: {
          backgroundColor: '#14532d',
          fontWeight: '700'
        }
      },
      {
        text: ' rgb bg',
        style: {
          backgroundColor: 'rgb(12, 34, 56)'
        }
      }
    ])
  })

  it('strips unsupported ANSI control sequences', () => {
    const segments = parseAnsiOutput('before\x1B[2Kafter\x1B]0;title\x07')

    expect(segments).toEqual([
      {
        text: 'beforeafter',
        style: {}
      }
    ])
  })
})
