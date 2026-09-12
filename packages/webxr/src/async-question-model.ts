import type { AsyncUserInputQuestion } from '@codori/client/shared/generated/codex-app-server/v2'

export type AsyncQuestionEntry = {
  id: string
  questions: AsyncUserInputQuestion[]
  answers: string[]
  answeredQuestions: boolean[]
  answered: boolean
}

export type AsyncQuestionSnapshot = {
  history: AsyncQuestionEntry[]
  currentId: string | null
  submittingId: string | null
  error: string | null
}

export type AsyncQuestionAction =
  | { type: 'open', id: string }
  | { type: 'dismiss' }
  | { type: 'answer', id?: string, index: number, text: string }
  | { type: 'send', index: number, text?: string }

export const formatAsyncQuestionAnswer = (entry: AsyncQuestionEntry, index: number, text: string) =>
  `${entry.questions[index]!.title}\n${text.trim()}`

export class AsyncQuestionModel {
  private history: AsyncQuestionEntry[] = []
  private currentId: string | null = null
  private submittingId: string | null = null
  private error: string | null = null

  receive(id: string, questions: AsyncUserInputQuestion[], open = true) {
    if (!questions.length || this.history.some(entry => entry.id === id)) return
    this.history.push({
      id,
      questions: questions.map(question => ({ ...question, options: question.options?.slice() ?? null })),
      answers: questions.map(() => ''),
      answeredQuestions: questions.map(() => false),
      answered: false
    })
    if (open && !this.currentId) this.currentId = id
  }

  snapshot(): AsyncQuestionSnapshot {
    return {
      history: this.history.map(entry => ({ ...entry, answers: entry.answers.slice(), answeredQuestions: entry.answeredQuestions.slice() })),
      currentId: this.currentId,
      submittingId: this.submittingId,
      error: this.error
    }
  }

  open(id: string) {
    if (!this.history.some(entry => entry.id === id)) return
    this.currentId = id
    this.error = null
  }

  dismiss() { this.currentId = null }

  answer(index: number, text: string, id = this.currentId) {
    const entry = this.history.find(entry => entry.id === id)
    if (!entry || this.submittingId || !entry.questions[index]) return
    entry.answers[index] = text
    this.error = null
  }

  beginSubmit(index: number, text?: string) {
    const entry = this.history.find(entry => entry.id === this.currentId)
    const answer = text ?? entry?.answers[index] ?? ''
    if (!entry || this.submittingId || !entry.questions[index] || !answer.trim()) return null
    this.submittingId = entry.id
    this.error = null
    return { id: entry.id, index, text: formatAsyncQuestionAnswer(entry, index, answer) }
  }

  finishSubmit(id: string, index: number, error?: string) {
    if (this.submittingId !== id) return
    this.submittingId = null
    this.error = error ?? null
    if (error) return
    const entry = this.history.find(entry => entry.id === id)
    if (entry) {
      entry.answeredQuestions[index] = true
      entry.answered = entry.answeredQuestions.every(Boolean)
    }
    if (this.currentId === id && entry?.answered) this.currentId = null
  }
}
