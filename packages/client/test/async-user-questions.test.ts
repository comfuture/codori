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

  it.each(['dismiss', 'auto-close', 'replacement'] as const)('resumes the next unanswered question after %s and a fresh badge reopen', (close) => {
    const threadId = ref<string | null>('thread')
    const workspaceKey = `resume-${close}`
    const controller = useAsyncUserQuestions(workspaceKey, threadId)
    const questions = [
      { title: 'Choose a color', options: ['Blue'] }, { title: 'Why?', options: null }
    ]
    controller.receive({ id: 'multiple', questions }, 'turn-1')
    controller.answered('multiple', 0)
    if (close === 'dismiss') controller.dismiss()
    else if (close === 'auto-close') {
      controller.turnStarted('turn-2')
      controller.turnStarted('turn-3')
    } else controller.receive(question, 'turn-2')

    // Transcript badges recreate the request without a question index.
    const remounted = useAsyncUserQuestions(workspaceKey, threadId)
    remounted.open({ id: 'multiple', questions })
    expect(remounted.current.value?.questionIndex).toBe(1)
    remounted.answered('multiple', 0)
    expect(remounted.current.value?.questionIndex).toBe(1)
    remounted.answered('multiple', 1)
    expect(remounted.current.value).toBeNull()
    remounted.open({ id: 'multiple', questions })
    expect(remounted.current.value).toBeNull()
  })

  it('scopes saved answer progress by workspace, thread, and item', () => {
    const threadId = ref<string | null>('first')
    const controller = useAsyncUserQuestions('progress-scoped', threadId)
    const questions = [
      { title: 'Choose a color', options: ['Blue'] }, { title: 'Why?', options: null }
    ]
    controller.open({ id: 'multiple', questions })
    controller.answered('multiple', 0)
    controller.dismiss()
    threadId.value = 'second'
    controller.open({ id: 'multiple', questions })
    expect(controller.current.value?.questionIndex ?? 0).toBe(0)
    threadId.value = 'first'
    controller.open({ id: 'other-item', questions })
    expect(controller.current.value?.questionIndex ?? 0).toBe(0)
    controller.open({ id: 'multiple', questions })
    expect(controller.current.value?.questionIndex).toBe(1)
    const otherWorkspace = useAsyncUserQuestions('other-progress-workspace', threadId)
    otherWorkspace.open({ id: 'multiple', questions })
    expect(otherWorkspace.current.value?.questionIndex ?? 0).toBe(0)
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

  it('isolates drafts by workspace, thread, item, and question until an answer is acknowledged', () => {
    const threadId = ref<string | null>('first')
    const controller = useAsyncUserQuestions('draft-scoped', threadId)
    const questions = [
      { title: 'Choose a color', options: ['Blue'] }, { title: 'Why?', options: null }
    ]
    controller.open({ id: 'multiple', questions })
    controller.updateDraft('multiple', 0, 'My first answer')
    controller.updateDraft('wrong-item', 0, 'Wrong item')
    controller.updateDraft('multiple', 1, 'Wrong question')
    controller.dismiss()
    controller.open({ id: 'other-item', questions })
    expect(controller.current.value?.answerDraft).toBe('')
    controller.updateDraft('other-item', 0, 'Another answer')
    threadId.value = 'second'
    controller.open({ id: 'multiple', questions })
    expect(controller.current.value?.answerDraft).toBe('')
    controller.updateDraft('multiple', 0, 'Another thread')
    threadId.value = 'first'
    controller.open({ id: 'multiple', questions })
    expect(controller.current.value?.answerDraft).toBe('My first answer')
    controller.answered('multiple', 0)
    expect(controller.current.value?.answerDraft).toBe('')
    controller.updateDraft('multiple', 1, 'My second answer')
    controller.dismiss()
    const remounted = useAsyncUserQuestions('draft-scoped', threadId)
    remounted.open({ id: 'multiple', questions })
    expect(remounted.current.value?.answerDraft).toBe('My second answer')
    remounted.open({ id: 'other-item', questions })
    expect(remounted.current.value?.answerDraft).toBe('Another answer')
    const otherWorkspace = useAsyncUserQuestions('other-draft-workspace', threadId)
    otherWorkspace.open({ id: 'multiple', questions })
    expect(otherWorkspace.current.value?.answerDraft).toBe('')
  })

  it.each(['dismiss', 'replacement', 'thread navigation'] as const)('records a successful late answer after %s without changing another request', (interruption) => {
    const threadId = ref<string | null>('first')
    const controller = useAsyncUserQuestions(`late-answer-${interruption}`, threadId)
    const questions = [
      { title: 'Choose a color', options: ['Blue'] }, { title: 'Why?', options: null }
    ]
    controller.open({ id: 'multiple', questions })
    controller.updateDraft('multiple', 0, 'Sent answer')
    controller.dismiss()
    if (interruption === 'thread navigation') threadId.value = 'second'
    if (interruption !== 'dismiss') {
      controller.open({ id: interruption === 'replacement' ? 'newer' : 'multiple', questions })
      controller.updateDraft(controller.current.value!.id, 0, 'Newer draft')
    }
    controller.answered('multiple', 0, 'first')
    if (interruption === 'dismiss') expect(controller.current.value).toBeNull()
    else {
      expect(controller.current.value?.questionIndex).toBe(0)
      expect(controller.current.value?.answerDraft).toBe('Newer draft')
    }
    threadId.value = 'first'
    controller.open({ id: 'multiple', questions })
    expect(controller.current.value?.questionIndex).toBe(1)
    expect(controller.current.value?.answerDraft).toBe('')
    controller.updateDraft('multiple', 1, 'Next answer')
    controller.answered('multiple', 0, 'first')
    expect(controller.current.value?.questionIndex).toBe(1)
    expect(controller.current.value?.answerDraft).toBe('Next answer')
  })

  it('keeps an in-flight answer locked across remounts until the originating send settles', () => {
    const threadId = ref<string | null>('first')
    const controller = useAsyncUserQuestions('pending-remount', threadId)
    const questions = [
      { title: 'Choose a color', options: ['Blue'] }, { title: 'Why?', options: null }
    ]
    controller.open({ id: 'multiple', questions })
    controller.updateDraft('multiple', 0, 'Original answer')
    expect(controller.beginAnswer('multiple', 0)).toBe(true)
    controller.dismiss()
    threadId.value = 'second'
    controller.open({ id: 'multiple', questions })
    controller.updateDraft('multiple', 0, 'Another thread draft')
    expect(controller.submitting.value).toBe(false)

    const remounted = useAsyncUserQuestions('pending-remount', ref('first'))
    remounted.open({ id: 'multiple', questions })
    expect(remounted.submitting.value).toBe(true)
    expect(remounted.beginAnswer('multiple', 0)).toBe(false)
    remounted.updateDraft('multiple', 0, 'Must not replace the pending answer')
    expect(remounted.current.value?.answerDraft).toBe('Original answer')

    controller.answered('multiple', 0, 'first')
    controller.finishAnswer('multiple', 0, 'first')
    expect(remounted.submitting.value).toBe(false)
    expect(remounted.current.value?.questionIndex).toBe(1)
    expect(remounted.current.value?.answerDraft).toBe('')
    expect(remounted.beginAnswer('multiple', 0)).toBe(false)
    expect(controller.current.value?.questionIndex).toBe(0)
    expect(controller.current.value?.answerDraft).toBe('Another thread draft')
    remounted.updateDraft('multiple', 1, 'New answer after completion')
    controller.answered('multiple', 0, 'first')
    expect(remounted.current.value?.answerDraft).toBe('New answer after completion')
  })

  it('unlocks a failed submission after remount without clearing its draft', () => {
    const threadId = ref<string | null>('thread')
    const controller = useAsyncUserQuestions('failed-remount', threadId)
    controller.open(question)
    controller.updateDraft(question.id, 0, 'Retry this answer')
    expect(controller.beginAnswer(question.id, 0)).toBe(true)
    controller.dismiss()
    threadId.value = 'other-thread'
    controller.open(question)
    controller.updateDraft(question.id, 0, 'Another pending answer')
    expect(controller.beginAnswer(question.id, 0)).toBe(true)
    const remounted = useAsyncUserQuestions('failed-remount', ref('thread'))
    remounted.open(question)
    controller.finishAnswer(question.id, 0, 'thread')
    expect(remounted.submitting.value).toBe(false)
    expect(remounted.current.value?.answerDraft).toBe('Retry this answer')
    expect(controller.submitting.value).toBe(true)
    expect(controller.current.value?.answerDraft).toBe('Another pending answer')
    remounted.updateDraft(question.id, 0, 'Revised answer')
    expect(remounted.beginAnswer(question.id, 0)).toBe(true)
    remounted.answered(question.id, 0, 'thread')
    remounted.finishAnswer(question.id, 0, 'thread')
    expect(remounted.current.value).toBeNull()
  })
})
