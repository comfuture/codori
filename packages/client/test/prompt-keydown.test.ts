import { describe, expect, it, vi } from 'vitest'
import { routePromptKeydownCapture } from '../app/utils/prompt-keydown'

const makeKeydownEvent = (
  key: string,
  init: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {}
) => {
  let defaultPrevented = false

  return {
    key,
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
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

  it('keeps modified Enter out of exact capture handling', () => {
    const events = [
      makeKeydownEvent('Enter', { altKey: true }),
      makeKeydownEvent('Enter', { ctrlKey: true }),
      makeKeydownEvent('Enter', { metaKey: true }),
      makeKeydownEvent('Enter', { shiftKey: true })
    ]
    const handleEnterCapture = vi.fn()
    const handleNavigation = vi.fn()
    const handleEnter = vi.fn()

    for (const event of events) {
      routePromptKeydownCapture(event, {
        handleEnterCapture,
        handleNavigation,
        handleEnter
      })
    }

    expect(handleEnterCapture).not.toHaveBeenCalled()
    expect(handleNavigation).toHaveBeenCalledTimes(events.length)
    expect(handleEnter).toHaveBeenCalledTimes(events.length)
    expect(events.every(event => !event.defaultPrevented)).toBe(true)
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
