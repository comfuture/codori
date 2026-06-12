export type PromptKeydownHandler = (event: KeyboardEvent) => void

export type PromptKeydownCaptureHandlers = {
  handleEnterCapture: PromptKeydownHandler
  handleNavigation: PromptKeydownHandler
  handleEnter: PromptKeydownHandler
}

export const routePromptKeydownCapture = (
  event: KeyboardEvent,
  handlers: PromptKeydownCaptureHandlers
) => {
  const isEnter = event.key === 'Enter'

  if (isEnter) {
    handlers.handleEnterCapture(event)
    if (event.defaultPrevented) {
      return
    }
  }

  handlers.handleNavigation(event)
  if (event.defaultPrevented) {
    return
  }

  if (isEnter) {
    handlers.handleEnter(event)
  }
}
