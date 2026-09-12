import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useAsyncUserQuestions } from '../app/composables/useAsyncUserQuestions'

const question = { id: 'question', questions: [{ title: 'Choose a color', options: ['Blue', 'Green'] }] }

describe('async question drawer lifecycle', () => {
  it('advances only after an acknowledged answer and closes after the last question', () => {
    const controller = useAsyncUserQuestions('answers', ref('thread'))
    const request = { id: 'multiple', questions: [
      { title: 'Choose a color', options: ['Blue'] }, { title: 'Why?', options: null }
    ] }
    controller.receive(request, 'turn-1')
    controller.answered('wrong-item', 0)
    expect(controller.current.value?.questionIndex ?? 0).toBe(0)
    controller.answered(request.id, 0)
    expect(controller.current.value?.questionIndex).toBe(1)
    controller.answered(request.id, 0)
    expect(controller.current.value?.questionIndex).toBe(1)
    controller.answered(request.id, 1)
    expect(controller.current.value).toBeNull()
  })

  it('dismisses after two distinct following turns, not its own turn or replayed notifications', () => {
    const controller = useAsyncUserQuestions('auto-close', ref('thread'))
    controller.receive(question, 'turn-1')
    controller.turnStarted('turn-1')
    controller.turnStarted(null)
    expect(controller.current.value?.id).toBe(question.id)
    controller.turnStarted('turn-2')
    controller.turnStarted('turn-1')
    controller.turnStarted('turn-2')
    expect(controller.current.value?.id).toBe(question.id)
    controller.turnStarted('turn-3')
    expect(controller.current.value).toBeNull()
    controller.open(question)
    expect(controller.current.value?.id).toBe(question.id)
    controller.turnStarted('turn-3')
    controller.turnStarted('turn-4')
    expect(controller.current.value?.id).toBe(question.id)
    controller.turnStarted('turn-5')
    expect(controller.current.value).toBeNull()
  })

  it('allows dismiss and badge reopen without replay reopening a dismissed question', () => {
    const controller = useAsyncUserQuestions('dismiss', ref('thread'))
    controller.receive(question, 'turn-1')
    controller.dismiss()
    controller.receive(question, 'turn-1')
    expect(controller.current.value).toBeNull()
    controller.open(question)
    expect(controller.current.value?.questions).toEqual(question.questions)
  })

  it('keeps thread state separate and a previous answer cannot close a newer question', () => {
    const threadId = ref<string | null>('first')
    const controller = useAsyncUserQuestions('scoped', threadId)
    controller.receive(question, 'turn-1')
    threadId.value = 'second'
    expect(controller.current.value).toBeNull()
    controller.receive({ ...question, id: 'second-question' }, 'turn-2')
    controller.dismiss(question.id)
    expect(controller.current.value?.id).toBe('second-question')
    threadId.value = 'first'
    expect(controller.current.value?.id).toBe(question.id)
  })
})
