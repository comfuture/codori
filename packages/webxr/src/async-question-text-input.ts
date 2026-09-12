export type AsyncQuestionTextTarget = {
  id: string
  index: number
  label: string
  value: string
  onChange: (value: string) => void
}

export type AsyncQuestionTextInput = {
  readonly isComposing: boolean
  focus: (target: AsyncQuestionTextTarget) => void
  release: () => string | null
}

/** Native editable focus for the scene's text field; the scene remains the visible UI. */
export class NativeAsyncQuestionTextInput implements AsyncQuestionTextInput {
  readonly element: HTMLTextAreaElement
  private target: AsyncQuestionTextTarget | null = null
  private composing = false
  private disposed = false

  constructor(parent: HTMLElement) {
    this.element = parent.ownerDocument.createElement('textarea')
    this.element.dataset.asyncQuestionInput = 'true'
    this.element.setAttribute('aria-label', 'Your answer')
    this.element.setAttribute('inputmode', 'text')
    this.element.setAttribute('enterkeyhint', 'done')
    this.element.setAttribute('autocomplete', 'off')
    this.element.setAttribute('virtualkeyboardpolicy', 'auto')
    this.element.tabIndex = -1
    // It must remain rendered and within the requested DOM-overlay root for focus.
    // No visible duplicate panel or off-screen scroll target is introduced.
    Object.assign(this.element.style, {
      position: 'fixed', left: '50%', bottom: '1px', width: '1px', height: '1px',
      padding: '0', border: '0', opacity: '0.01', fontSize: '16px',
      pointerEvents: 'none', resize: 'none'
    })
    this.element.addEventListener('input', this.publish)
    this.element.addEventListener('compositionstart', this.startComposition)
    this.element.addEventListener('compositionend', this.endComposition)
    this.element.addEventListener('blur', this.endComposition)
    this.element.addEventListener('keydown', this.keepTypingLocal)
    this.element.addEventListener('beforexrselect', this.keepSelectionLocal)
    parent.appendChild(this.element)
  }

  get isComposing() { return this.composing }

  private readonly publish = () => { this.target?.onChange(this.element.value) }
  private readonly startComposition = () => { this.composing = true }
  private readonly endComposition = () => { this.composing = false; this.publish() }
  private readonly keepTypingLocal = (event: KeyboardEvent) => { event.stopPropagation() }
  private readonly keepSelectionLocal = (event: Event) => { event.preventDefault() }

  focus(target: AsyncQuestionTextTarget) {
    if (this.disposed) return
    if (this.target?.id !== target.id || this.target?.index !== target.index) {
      this.release()
      this.target = target
      this.element.value = target.value
    } else {
      this.target = target
    }
    this.element.setAttribute('aria-label', target.label)
    // Called directly from the click/select handler, preserving user activation.
    this.element.focus({ preventScroll: true })
  }

  release() {
    const target = this.target
    if (!target) return null
    this.target = null
    this.composing = false
    this.element.blur()
    // Blurring may synchronously commit an IME composition into the control.
    const value = this.element.value
    target.onChange(value)
    return value
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.release()
    this.element.removeEventListener('input', this.publish)
    this.element.removeEventListener('compositionstart', this.startComposition)
    this.element.removeEventListener('compositionend', this.endComposition)
    this.element.removeEventListener('blur', this.endComposition)
    this.element.removeEventListener('keydown', this.keepTypingLocal)
    this.element.removeEventListener('beforexrselect', this.keepSelectionLocal)
    this.element.remove()
  }
}
