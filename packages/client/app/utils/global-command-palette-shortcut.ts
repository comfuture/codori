const editableSelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-codori-shortcuts="ignore"]'

export const isMacLikePlatform = (platform: string | null | undefined) =>
  /Mac|iPhone|iPad|iPod/i.test(platform ?? '')

export const isEditableShortcutTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return false
  }

  if (target instanceof HTMLElement) {
    const contentEditable = target.getAttribute('contenteditable') ?? target.contentEditable
    if (
      target.isContentEditable
      || contentEditable === ''
      || contentEditable === 'true'
      || contentEditable === 'plaintext-only'
    ) {
      return true
    }
  }

  return target.matches(editableSelector) || target.closest(editableSelector) !== null
}

export const isGlobalCommandPaletteShortcut = (
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'defaultPrevented' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'>,
  platform: string | null | undefined
) => {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) {
    return false
  }

  if (event.key.toLowerCase() !== 'k') {
    return false
  }

  return isMacLikePlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}
