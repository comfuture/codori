import { computed, reactive, type Ref } from 'vue'
import type { AsyncUserInputQuestion } from '../../shared/generated/codex-app-server/v2/AsyncUserInputQuestion'

export type AsyncUserQuestionRequest = {
  id: string
  questions: AsyncUserInputQuestion[]
  questionIndex?: number
  answerDraft?: string
}

export type AsyncUserAnswer = { text: string, questionIndex: number }

type QuestionSession = {
  current: AsyncUserQuestionRequest | null
  nextQuestionByItem: Map<string, number>
  draftsByItem: Map<string, Map<number, string>>
  pendingAnswersByItem: Map<string, { questionIndex: number, draft: string }>
  seenItems: Set<string>
  followingTurns: Set<string>
  seenTurns: Set<string>
}

const sessions = new Map<string, QuestionSession>()

export const useAsyncUserQuestions = (workspaceKey: string, threadId: Ref<string | null>) => {
  const getSession = (id: string | null) => {
    const key = `${workspaceKey}::${id ?? '__draft__'}`
    let value = sessions.get(key)
    if (!value) {
      value = reactive({
        current: null,
        nextQuestionByItem: new Map<string, number>(),
        draftsByItem: new Map<string, Map<number, string>>(),
        pendingAnswersByItem: new Map<string, { questionIndex: number, draft: string }>(),
        seenItems: new Set<string>(),
        followingTurns: new Set<string>(),
        seenTurns: new Set<string>()
      })
      sessions.set(key, value)
    }
    return value
  }
  const session = computed(() => getSession(threadId.value))

  const open = (request: AsyncUserQuestionRequest) => {
    const questionIndex = session.value.nextQuestionByItem.get(request.id) ?? request.questionIndex ?? 0
    if (questionIndex >= request.questions.length) return
    session.value.nextQuestionByItem.set(request.id, questionIndex)
    const answerDraft = session.value.draftsByItem.get(request.id)?.get(questionIndex) ?? ''
    session.value.current = { ...request, questionIndex, answerDraft }
    session.value.followingTurns.clear()
  }
  const dismiss = (id?: string) => {
    if (!id || session.value.current?.id === id) session.value.current = null
  }
  const receive = (request: AsyncUserQuestionRequest, turnId: string | null) => {
    if (!request.questions.length || session.value.seenItems.has(request.id)) return
    session.value.seenItems.add(request.id)
    if (turnId) session.value.seenTurns.add(turnId)
    open(request)
  }
  const turnStarted = (turnId: string | null) => {
    if (!turnId || session.value.seenTurns.has(turnId)) return
    session.value.seenTurns.add(turnId)
    if (!session.value.current) return
    session.value.followingTurns.add(turnId)
    if (session.value.followingTurns.size >= 2) dismiss()
  }

  const updateDraft = (id: string, questionIndex: number, text: string) => {
    const request = session.value.current
    if (!request || request.id !== id || (request.questionIndex ?? 0) !== questionIndex) return
    if (session.value.pendingAnswersByItem.has(id)) return
    let drafts = session.value.draftsByItem.get(id)
    if (!drafts) {
      drafts = new Map<number, string>()
      session.value.draftsByItem.set(id, drafts)
    }
    drafts.set(questionIndex, text)
    request.answerDraft = text
  }

  const beginAnswer = (id: string, questionIndex: number) => {
    const origin = session.value
    const request = origin.current
    if (!request || request.id !== id || (request.questionIndex ?? 0) !== questionIndex
      || origin.nextQuestionByItem.get(id) !== questionIndex || origin.pendingAnswersByItem.has(id)) return false
    origin.pendingAnswersByItem.set(id, { questionIndex, draft: request.answerDraft ?? '' })
    return true
  }

  const finishAnswer = (id: string, questionIndex: number, answeredThreadId = threadId.value) => {
    const origin = getSession(answeredThreadId)
    if (origin.pendingAnswersByItem.get(id)?.questionIndex === questionIndex) origin.pendingAnswersByItem.delete(id)
  }

  const answered = (id: string, questionIndex: number, answeredThreadId = threadId.value) => {
    const origin = getSession(answeredThreadId)
    if (origin.nextQuestionByItem.get(id) !== questionIndex) return
    origin.nextQuestionByItem.set(id, questionIndex + 1)
    const pending = origin.pendingAnswersByItem.get(id)
    const drafts = origin.draftsByItem.get(id)
    if (!pending || (pending.questionIndex === questionIndex && pending.draft === (drafts?.get(questionIndex) ?? ''))) {
      drafts?.delete(questionIndex)
    }
    const request = origin.current
    if (!request || request.id !== id || (request.questionIndex ?? 0) !== questionIndex) return
    if (questionIndex + 1 >= request.questions.length) origin.current = null
    else {
      request.questionIndex = questionIndex + 1
      request.answerDraft = origin.draftsByItem.get(id)?.get(questionIndex + 1) ?? ''
    }
  }

  return {
    current: computed(() => session.value.current),
    submitting: computed(() => Boolean(session.value.current && session.value.pendingAnswersByItem.has(session.value.current.id))),
    open, dismiss, receive, turnStarted, updateDraft, beginAnswer, finishAnswer, answered
  }
}
