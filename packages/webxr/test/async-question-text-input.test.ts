// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAsyncQuestionTextInput } from '../src/async-question-text-input'

const inputs: NativeAsyncQuestionTextInput[] = []
const setup = () => {
  const root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)
  const input = new NativeAsyncQuestionTextInput(root)
  inputs.push(input)
  return { root, input, field: input.element }
}

afterEach(() => {
  inputs.splice(0).forEach(input => input.dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('native text entry for the immersive question field', () => {
  it('focuses synchronously inside the overlay root and preserves Korean IME text and selection on draft updates', () => {
    const { root, input, field } = setup()
    const onChange = vi.fn()
    const target = { id: 'question', index: 0, label: 'Your reason', value: '', onChange }
    input.focus(target)
    expect(document.activeElement).toBe(field)
    expect(root.contains(field)).toBe(true)
    expect(field.style.display).not.toBe('none')
    field.dispatchEvent(new CompositionEvent('compositionstart'))
    field.value = '한글 초안'
    field.setSelectionRange(2, 2)
    field.dispatchEvent(new InputEvent('input', { data: '안', isComposing: true }))
    expect(input.isComposing).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith('한글 초안')
    input.focus({ ...target, value: 'stale snapshot' })
    expect(field.value).toBe('한글 초안')
    expect(field.selectionStart).toBe(2)
    expect(input.isComposing).toBe(true)
    field.dispatchEvent(new CompositionEvent('compositionend', { data: '안' }))
    expect(input.isComposing).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith('한글 초안')
  })

  it('retains the final blur composition in the original draft and releases focus without leaking later edits', () => {
    const { input, field } = setup()
    const first = vi.fn()
    const second = vi.fn()
    input.focus({ id: 'first', index: 0, label: 'First', value: '', onChange: first })
    field.dispatchEvent(new CompositionEvent('compositionstart'))
    field.value = 'ㅎ'
    field.addEventListener('blur', () => {
      field.value = '한글'
      field.dispatchEvent(new CompositionEvent('compositionend', { data: '한글' }))
    }, { once: true })
    input.focus({ id: 'second', index: 1, label: 'Second', value: 'Existing', onChange: second })
    expect(first).toHaveBeenLastCalledWith('한글')
    expect(second).not.toHaveBeenCalled()
    expect(field.value).toBe('Existing')
    expect(input.release()).toBe('Existing')
    expect(second).toHaveBeenLastCalledWith('Existing')
    expect(document.activeElement).not.toBe(field)
    field.value = 'Late event'
    field.dispatchEvent(new InputEvent('input'))
    expect(second).toHaveBeenCalledTimes(1)
    input.dispose()
    expect(field.isConnected).toBe(false)
  })

  it('keeps native text editing and IME keys out of global shortcuts without cancelling the native action', () => {
    const { input, field } = setup()
    input.focus({ id: 'question', index: 0, label: 'Answer', value: '', onChange: vi.fn() })
    const shortcut = vi.fn()
    document.addEventListener('keydown', shortcut)
    const key = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
    field.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    expect(shortcut).not.toHaveBeenCalled()
    document.removeEventListener('keydown', shortcut)
  })
})
