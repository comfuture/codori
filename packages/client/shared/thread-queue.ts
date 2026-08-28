import type { QueuedSubmission } from './generated/codex-app-server/v2/QueuedSubmission'
import type { UserInput } from './generated/codex-app-server/v2/UserInput'

export const THREAD_QUEUE_PAGE_SIZE = 100

export const createThreadQueueClientMessageId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `queued-user-${crypto.randomUUID()}`
    : `queued-user-${Date.now()}-${Math.random().toString(16).slice(2)}`

export const buildTextThreadQueueInput = (text: string): UserInput[] => [{
  type: 'text',
  text: text.trim(),
  text_elements: []
}]

export const threadQueueSubmissionText = (submission: Pick<QueuedSubmission, 'input'>) =>
  submission.input
    .filter((entry): entry is Extract<UserInput, { type: 'text' }> => entry.type === 'text')
    .map(entry => entry.text.trim())
    .filter(Boolean)
    .join('\n')

const isPlainTextThreadQueueInput = (entry: UserInput) =>
  entry.type === 'text' && entry.text_elements.length === 0

export const isTextOnlyThreadQueueSubmission = (submission: Pick<QueuedSubmission, 'input'>) =>
  submission.input.length > 0
  && submission.input.every(isPlainTextThreadQueueInput)

export const summarizeThreadQueueSubmission = (submission: Pick<QueuedSubmission, 'input'>) => {
  const text = threadQueueSubmissionText(submission)
  const structuredCount = submission.input.filter(entry => !isPlainTextThreadQueueInput(entry)).length
  if (text && structuredCount > 0) {
    return `${text}\n${structuredCount} structured input${structuredCount === 1 ? '' : 's'}`
  }
  if (text) {
    return text
  }
  if (structuredCount > 0) {
    return `${structuredCount} structured input${structuredCount === 1 ? '' : 's'}`
  }
  return 'Empty queued submission'
}

export const validateTextThreadQueueDraft = (input: {
  text: string
  attachmentCount: number
  mentionCount: number
  skillMentionCount: number
}) => {
  if (input.attachmentCount > 0) {
    return 'Queued prompts are text-only in this version. Remove image attachments before queuing.'
  }
  if (input.mentionCount > 0) {
    return 'Queued prompts do not support @ mentions yet. Remove the mention before queuing.'
  }
  if (input.skillMentionCount > 0) {
    return 'Queued prompts do not support selected $skill references yet. Remove the skill reference before queuing.'
  }
  if (!input.text.trim()) {
    return 'Enter a text prompt before adding it to the queue.'
  }
  if (/^\s*\//u.test(input.text)) {
    return 'Slash commands run immediately and cannot be added to the prompt queue.'
  }
  return null
}

export const isUnsupportedThreadQueueError = (message: string) =>
  /method not found|-32601|experimental api.*unsupported|thread\/queue\/\w+.*(?:not supported|unsupported)/iu.test(message)

export const formatThreadQueueError = (action: string, value: unknown) => {
  const message = value instanceof Error ? value.message : String(value)
  if (/capacity|queue is full|too many queued/iu.test(message)) {
    return `The thread queue is full. Remove an entry before ${action.toLowerCase()}.`
  }
  if (/thread.*(?:not found|missing)|unknown thread/iu.test(message)) {
    return `This thread is no longer available. Reload it before ${action.toLowerCase()}.`
  }
  return `${action} failed: ${message}`
}

export const moveThreadQueueSubmission = (
  submissions: QueuedSubmission[],
  submissionId: string,
  delta: -1 | 1
) => {
  const index = submissions.findIndex(submission => submission.id === submissionId)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= submissions.length) {
    return submissions
  }

  const reordered = submissions.slice()
  const [submission] = reordered.splice(index, 1)
  if (!submission) {
    return submissions
  }
  reordered.splice(nextIndex, 0, submission)
  return reordered
}

export const startObservedThreadQueueSubmission = async <LiveStream, Turn>(input: {
  ensureObserved: () => Promise<LiveStream | null>
  isCurrent: (liveStream: LiveStream) => boolean
  start: () => Promise<Turn>
}) => {
  const liveStream = await input.ensureObserved()
  if (!liveStream || !input.isCurrent(liveStream)) {
    return null
  }

  const turn = await input.start()
  if (!input.isCurrent(liveStream)) {
    return null
  }

  return { liveStream, turn }
}
