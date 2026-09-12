import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdditiveBlending, LineSegments, MeshBasicMaterial } from 'three'
import { CanvasTextSurface } from '../src/text-surface'
import { AsyncQuestionView, ASYNC_QUESTION_HOVER_OPACITY, setAsyncQuestionHover } from '../src/async-question-view'
import { AsyncQuestionModel } from '../src/async-question-model'
import type { AsyncQuestionTextTarget } from '../src/async-question-text-input'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('immersive question option buttons', () => {
  it('sends a choice immediately, exposes custom send separately, and highlights hovered targets', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) })
    const render = vi.spyOn(CanvasTextSurface.prototype, 'render').mockReturnValue({
      totalLineCount: 1, visibleLineCount: 1, startLine: 0, endLine: 1, hasAbove: false, hasBelow: false
    })
    const model = new AsyncQuestionModel()
    model.receive('question', [{ title: 'Choose', options: ['A', 'B'] }])
    const action = vi.fn()
    const input = { isComposing: false, focus: vi.fn(), release: vi.fn(() => null as string | null) }
    const view = new AsyncQuestionView(action, input)
    view.update(model.snapshot())
    const glow = view.group.getObjectByName('async-question-glow') as LineSegments
    expect(glow).toBeInstanceOf(LineSegments)
    expect(Array.isArray(glow.material)).toBe(false)
    if (!Array.isArray(glow.material)) {
      expect(glow.material.blending).toBe(AdditiveBlending)
      expect(glow.material.depthTest).toBe(true)
    }
    expect(view.hitTargets.some(hit => hit.userData.asyncQuestionBlocker === true)).toBe(true)
    const choice = view.hitTargets.find(hit => hit.name === 'async-question:B')!
    expect(choice).toBeDefined()
    expect(view.hitTargets.some(hit => hit.name === 'async-question:Send response')).toBe(false)
    expect(render.mock.calls.some(([content]) => content.body.includes('○') || content.body.includes('●'))).toBe(false)
    setAsyncQuestionHover(view.hitTargets, choice)
    expect((choice.material as MeshBasicMaterial).opacity).toBe(ASYNC_QUESTION_HOVER_OPACITY)
    choice.userData.asyncQuestionActivate()
    expect(action).toHaveBeenLastCalledWith({ type: 'send', index: 0, text: 'B' })
    setAsyncQuestionHover(view.hitTargets, null)
    expect((choice.material as MeshBasicMaterial).opacity).toBe(0)
    view.hitTargets.find(hit => hit.name === 'async-question:Write answer')!.userData.asyncQuestionActivate()
    expect(input.focus).toHaveBeenCalledWith(expect.objectContaining({ id: 'question', index: 0, value: '' }))
    expect(view.hitTargets.some(hit => hit.name === 'async-question:B')).toBe(false)
    model.answer(0, 'Typed')
    view.update(model.snapshot())
    expect(input.focus).toHaveBeenCalledTimes(1)
    input.isComposing = true
    view.hitTargets.find(hit => hit.name === 'async-question:Send response')!.userData.asyncQuestionActivate()
    expect(action).toHaveBeenLastCalledWith({ type: 'send', index: 0, text: 'B' })
    input.isComposing = false
    input.release.mockReturnValue('Typed')
    view.hitTargets.find(hit => hit.name === 'async-question:Send response')!.userData.asyncQuestionActivate()
    expect(action).toHaveBeenLastCalledWith({ type: 'send', index: 0, text: 'Typed' })
    view.dispose()
  })

  it('flushes a native draft to its original question when a new snapshot changes the open question', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) })
    vi.spyOn(CanvasTextSurface.prototype, 'render').mockReturnValue({
      totalLineCount: 1, visibleLineCount: 1, startLine: 0, endLine: 1, hasAbove: false, hasBelow: false
    })
    const model = new AsyncQuestionModel()
    model.receive('first', [{ title: 'First', options: null }])
    model.receive('second', [{ title: 'Second', options: null }])
    let target: AsyncQuestionTextTarget | null = null
    const input = {
      isComposing: false,
      focus: (next: AsyncQuestionTextTarget) => { target = next },
      release: () => {
        const previous = target
        target = null
        previous?.onChange('한글 초안')
        return previous ? '한글 초안' : null
      }
    }
    const view = new AsyncQuestionView(action => {
      if (action.type === 'answer') model.answer(action.index, action.text, action.id)
      view.update(model.snapshot())
    }, input)
    view.update(model.snapshot())
    view.hitTargets.find(hit => hit.name === 'async-question:Click to type your answer')!.userData.asyncQuestionActivate()
    model.open('second')
    view.update(model.snapshot())
    expect(model.snapshot().history.map(entry => entry.answers)).toEqual([['한글 초안'], ['']])
    expect(model.snapshot().currentId).toBe('second')
    view.dispose()
  })
})
