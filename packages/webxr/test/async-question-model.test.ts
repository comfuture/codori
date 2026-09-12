import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { AsyncQuestionModel } from '../src/async-question-model'
import { ASYNC_QUESTION_OFFSET, resolveAsyncQuestionPosition } from '../src/async-question-placement'

const questions = [{ title: 'Choose a color', options: ['Blue', 'Green'] }, { title: 'Explain', options: null }]

describe('immersive async questions', () => {
  it('keeps questions and custom drafts until explicit dismissal, independent of elapsed time', () => {
    const model = new AsyncQuestionModel()
    model.receive('question', questions)
    model.answer(1, 'Keep this draft')
    model.dismiss()
    model.receive('question', questions)
    expect(model.snapshot().currentId).toBeNull()
    model.open('question')
    expect(model.snapshot().history[0]?.answers).toEqual(['', 'Keep this draft'])
    expect(model.snapshot().currentId).toBe('question')
  })

  it('sends each choice immediately without submitting defaults for later questions', () => {
    const model = new AsyncQuestionModel()
    model.receive('question', questions)
    const first = model.beginSubmit(0, 'Green')!
    expect(first.text).toBe('Choose a color\nGreen')
    expect(model.beginSubmit(1, 'duplicate')).toBeNull()
    model.finishSubmit(first.id, first.index)
    expect(model.snapshot().currentId).toBe('question')
    expect(model.snapshot().history[0]?.answeredQuestions).toEqual([true, false])
    expect(model.beginSubmit(1)).toBeNull()
    model.answer(1, 'Because it works')
    const second = model.beginSubmit(1)!
    expect(second.text).toBe('Explain\nBecause it works')
    model.finishSubmit(second.id, second.index, 'Offline')
    expect(model.snapshot().history[0]?.answers[1]).toBe('Because it works')
    expect(model.snapshot().currentId).toBe('question')
    const retry = model.beginSubmit(1)!
    model.finishSubmit(retry.id, retry.index)
    expect(model.snapshot().currentId).toBeNull()
    model.open('question')
    expect(model.snapshot().history[0]?.answered).toBe(true)
  })

  it('anchors at the lower screen center even after the viewer rotates and moves', () => {
    const viewer = new Vector3(3, 1.7, -4)
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const placed = resolveAsyncQuestionPosition(viewer, rotation)
    const local = placed.clone().sub(viewer).applyQuaternion(rotation.clone().invert())
    expect(local.x).toBeCloseTo(0)
    expect(local.y).toBeLessThan(0)
    expect(local.z).toBeLessThan(0)
    expect(local.distanceTo(ASYNC_QUESTION_OFFSET)).toBeLessThan(1e-8)
  })
})
