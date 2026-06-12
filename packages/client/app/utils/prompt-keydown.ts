export type PromptKeydownHandler = (event: KeyboardEvent) => void

export type PromptKeydownCaptureHandlers = {
  handleEnterCapture: PromptKeydownHandler
  handleNavigation: PromptKeydownHandler
  handleEnter: PromptKeydownHandler
}

const isPlainEnterKeydown = (event: KeyboardEvent) =>
  event.key === 'Enter'
  && !event.altKey
  && !event.ctrlKey
  && !event.metaKey
  && !event.shiftKey

export const routePromptKeydownCapture = (
  event: KeyboardEvent,
  handlers: PromptKeydownCaptureHandlers
) => {
  if (event.key !== 'Enter') {
    handlers.handleNavigation(event)
    return
  }

  if (isPlainEnterKeydown(event)) {
    handlers.handleEnterCapture(event)
    if (event.defaultPrevented) {
      return
    }
  }

  handlers.handleNavigation(event)
  if (event.defaultPrevented) {
    return
  }

  handlers.handleEnter(event)
}
