import { computed, reactive, type Ref } from 'vue'
import type { AsyncUserInputQuestion } from '../../shared/generated/codex-app-server/v2/AsyncUserInputQuestion'

export type AsyncUserQuestionRequest = {
  id: string
  questions: AsyncUserInputQuestion[]
  questionIndex?: number
}

export type AsyncUserAnswer = { text: string, questionIndex: number }

type QuestionSession = {
  current: AsyncUserQuestionRequest | null
  seenItems: Set<string>
  followingTurns: Set<string>
  seenTurns: Set<string>
}

const sessions = new Map<string, QuestionSession>()

export const useAsyncUserQuestions = (workspaceKey: string, threadId: Ref<string | null>) => {
  const session = computed(() => {
    const key = `${workspaceKey}::${threadId.value ?? '__draft__'}`
    let value = sessions.get(key)
    if (!value) {
      value = reactive({ current: null, seenItems: new Set<string>(), followingTurns: new Set<string>(), seenTurns: new Set<string>() })
      sessions.set(key, value)
    }
    return value
  })

  const open = (request: AsyncUserQuestionRequest) => {
    session.value.current = request
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

  const answered = (id: string, questionIndex: number) => {
    const request = session.value.current
    if (!request || request.id !== id || (request.questionIndex ?? 0) !== questionIndex) return
    if (questionIndex + 1 >= request.questions.length) dismiss(id)
    else request.questionIndex = questionIndex + 1
  }

  return { current: computed(() => session.value.current), open, dismiss, receive, turnStarted, answered }
}
