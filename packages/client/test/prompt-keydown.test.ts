import { describe, expect, it, vi } from 'vitest'
import { routePromptKeydownCapture } from '../app/utils/prompt-keydown'

const makeKeydownEvent = (key: string) => {
  let defaultPrevented = false

  return {
    key,
    get defaultPrevented() {
      return defaultPrevented
    },
    preventDefault() {
      defaultPrevented = true
    }
  } as KeyboardEvent
}

describe('prompt keydown routing', () => {
  it('keeps non-Enter keys out of submit-only handlers', () => {
    const event = makeKeydownEvent('a')
    const handleEnterCapture = vi.fn()
    const handleNavigation = vi.fn()
    const handleEnter = vi.fn()

    routePromptKeydownCapture(event, {
      handleEnterCapture,
      handleNavigation,
      handleEnter
    })

    expect(handleEnterCapture).not.toHaveBeenCalled()
    expect(handleNavigation).toHaveBeenCalledWith(event)
    expect(handleEnter).not.toHaveBeenCalled()
  })

  it('lets Enter capture handlers stop downstream prompt handling', () => {
    const event = makeKeydownEvent('Enter')
    const handleEnterCapture = vi.fn((keydownEvent: KeyboardEvent) => {
      keydownEvent.preventDefault()
    })
    const handleNavigation = vi.fn()
    const handleEnter = vi.fn()

    routePromptKeydownCapture(event, {
      handleEnterCapture,
      handleNavigation,
      handleEnter
    })

    expect(handleEnterCapture).toHaveBeenCalledWith(event)
    expect(handleNavigation).not.toHaveBeenCalled()
    expect(handleEnter).not.toHaveBeenCalled()
  })

  it('runs Enter submit handling after navigation has not consumed the event', () => {
    const event = makeKeydownEvent('Enter')
    const handleEnterCapture = vi.fn()
    const handleNavigation = vi.fn()
    const handleEnter = vi.fn()

    routePromptKeydownCapture(event, {
      handleEnterCapture,
      handleNavigation,
      handleEnter
    })

    expect(handleEnterCapture).toHaveBeenCalledWith(event)
    expect(handleNavigation).toHaveBeenCalledWith(event)
    expect(handleEnter).toHaveBeenCalledWith(event)
  })
})
