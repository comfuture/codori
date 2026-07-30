import { describe, expect, it } from 'vitest'
import { truncateCanvasText } from '../src/text-surface'

const context = {
  measureText: (text: string) => ({
    width: [...text].reduce(
      (width, character) => width + (
        character !== '…'
        && (character.codePointAt(0) ?? 0) > 0xff
          ? 2
          : 1
      ),
      0
    )
  })
} as Pick<CanvasRenderingContext2D, 'measureText'>

describe('canvas text surface', () => {
  it('keeps a title that fits its container unchanged', () => {
    expect(truncateCanvasText(context, 'Build WebXR', 20))
      .toBe('Build WebXR')
  })

  it('ellipsizes long Latin and CJK titles without splitting graphemes', () => {
    expect(truncateCanvasText(context, 'Build the immersive workspace', 12))
      .toBe('Build the i…')
    expect(truncateCanvasText(context, '매우 긴 웹엑스알 패널 제목', 12))
      .toBe('매우 긴 웹…')
  })

  it('returns an empty label when even an ellipsis cannot fit', () => {
    expect(truncateCanvasText(context, 'title', 0)).toBe('')
  })
})
