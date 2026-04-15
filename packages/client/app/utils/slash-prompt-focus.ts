// Slash-command popups are rendered as inert overlays. This helper is only for
// the composer blur guard to recognize "still inside the slash popup" targets.
export const isFocusWithinContainer = (
  target: EventTarget | null | undefined,
  container: ParentNode | null | undefined
) =>
  target instanceof Node
  && Boolean(container?.contains(target))
