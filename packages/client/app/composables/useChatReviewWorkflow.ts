import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { DraftAttachment } from './useChatAttachments'
import type { ChatStatus, LiveStream } from './useChatSession'
import {
  itemToMessages,
  upsertStreamingMessage,
  type ChatMessage
} from '~~/shared/codex-chat'
import {
  resolveProjectGitBranchesUrl,
  type ProjectGitBranchesResponse
} from '~~/shared/codori'
import type { ReviewStartParams } from '~~/shared/generated/codex-app-server/v2/ReviewStartParams'
import type { ReviewStartResponse } from '~~/shared/generated/codex-app-server/v2/ReviewStartResponse'
import type { ReviewTarget } from '~~/shared/generated/codex-app-server/v2/ReviewTarget'
import type { TokenUsageSnapshot } from '~~/shared/chat-prompt-controls'

type ReviewRpcClient = {
  request<T>(method: 'review/start', params: ReviewStartParams): Promise<T>
}

type UseChatReviewWorkflowOptions = {
  projectId: string
  serverBase: string
  input: Ref<string>
  attachments: Ref<DraftAttachment[]>
  hasPendingRequest: Ref<boolean>
  isWorkflowBusy: ComputedRef<boolean>
  error: Ref<string | null>
  status: Ref<ChatStatus>
  tokenUsage: Ref<TokenUsageSnapshot | null>
  messages: Ref<ChatMessage[]>
  setComposerError: (messageText: string) => void
  markAwaitingAssistantOutput: (nextValue: boolean) => void
  clearAttachments: (options?: { revoke?: boolean }) => void
  restoreDraftIfPristine: (text: string, submittedAttachments: DraftAttachment[]) => void
  ensurePendingLiveStream: () => Promise<LiveStream>
  getClient: (projectId: string) => ReviewRpcClient
  lockLiveStreamTurnId: (liveStream: LiveStream, turnId: string | null) => void
  replayBufferedNotifications: (liveStream: LiveStream) => void
  clearDismissedSlashMatch: () => void
}

export const useChatReviewWorkflow = (options: UseChatReviewWorkflowOptions) => {
  const reviewDrawerOpen = ref(false)
  const reviewDrawerMode = ref<'target' | 'branch'>('target')
  const reviewDrawerCommandText = ref('/review')
  const reviewBranches = ref<string[]>([])
  const reviewCurrentBranch = ref<string | null>(null)
  const reviewBranchesLoading = ref(false)
  const reviewBranchesError = ref<string | null>(null)
  const reviewStartPending = ref(false)

  const reviewBaseBranches = computed(() =>
    reviewBranches.value.filter(branch => branch !== reviewCurrentBranch.value)
  )

  const resetReviewDrawerState = () => {
    reviewDrawerMode.value = 'target'
    reviewDrawerCommandText.value = '/review'
    reviewBranchesLoading.value = false
    reviewBranchesError.value = null
  }

  const closeReviewDrawer = () => {
    reviewDrawerOpen.value = false
    resetReviewDrawerState()
  }

  const openReviewDrawer = (commandText = '/review') => {
    options.clearDismissedSlashMatch()
    reviewDrawerCommandText.value = commandText
    reviewDrawerMode.value = 'target'
    reviewBranchesError.value = null
    reviewDrawerOpen.value = true
  }

  const fetchProjectGitBranches = async () => {
    reviewBranchesLoading.value = true
    reviewBranchesError.value = null

    try {
      const response = await fetch(resolveProjectGitBranchesUrl({
        projectId: options.projectId,
        configuredBase: options.serverBase
      }))

      const body = await response.json() as ProjectGitBranchesResponse | { error?: { message?: string } }
      if (!response.ok) {
        throw new Error(body && typeof body === 'object' && 'error' in body
          ? body.error?.message ?? 'Failed to load local branches.'
          : 'Failed to load local branches.')
      }

      const result = body as ProjectGitBranchesResponse
      reviewCurrentBranch.value = result.currentBranch
      reviewBranches.value = result.branches
    } finally {
      reviewBranchesLoading.value = false
    }
  }

  const openBaseBranchPicker = async () => {
    reviewDrawerMode.value = 'branch'

    try {
      await fetchProjectGitBranches()
      if (!reviewBaseBranches.value.length) {
        reviewBranchesError.value = 'No local base branches are available to compare against.'
      }
    } catch (caughtError) {
      reviewBranchesError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    }
  }

  const startReview = async (target: ReviewTarget) => {
    if (reviewStartPending.value) {
      return
    }

    if (options.hasPendingRequest.value || options.isWorkflowBusy.value) {
      options.setComposerError('Review can only start when the current thread is idle.')
      return
    }

    reviewStartPending.value = true
    const draftText = reviewDrawerCommandText.value
    const submittedAttachments = options.attachments.value.slice()
    options.input.value = ''
    options.clearAttachments({ revoke: false })

    try {
      const client = options.getClient(options.projectId)
      const liveStream = await options.ensurePendingLiveStream()
      options.error.value = null
      options.status.value = 'submitted'
      options.tokenUsage.value = null
      options.markAwaitingAssistantOutput(true)

      const response = await client.request<ReviewStartResponse>('review/start', {
        threadId: liveStream.threadId,
        delivery: 'inline',
        target
      } satisfies ReviewStartParams)

      for (const item of response.turn.items) {
        if (item.type === 'userMessage') {
          continue
        }

        for (const nextMessage of itemToMessages(item)) {
          options.messages.value = upsertStreamingMessage(options.messages.value, {
            ...nextMessage,
            pending: false
          })
        }
      }

      options.lockLiveStreamTurnId(liveStream, response.turn.id)
      options.replayBufferedNotifications(liveStream)
      closeReviewDrawer()
    } catch (caughtError) {
      options.restoreDraftIfPristine(draftText, submittedAttachments)
      options.setComposerError(caughtError instanceof Error ? caughtError.message : String(caughtError))
    } finally {
      reviewStartPending.value = false
    }
  }

  const handleReviewDrawerOpenChange = (open: boolean) => {
    if (open) {
      reviewDrawerOpen.value = true
      return
    }

    closeReviewDrawer()
  }

  const handleReviewDrawerBack = () => {
    reviewDrawerMode.value = 'target'
    reviewBranchesError.value = null
  }

  return {
    reviewDrawerOpen,
    reviewDrawerMode,
    reviewDrawerCommandText,
    reviewBranches,
    reviewCurrentBranch,
    reviewBaseBranches,
    reviewBranchesLoading,
    reviewBranchesError,
    reviewStartPending,
    openReviewDrawer,
    closeReviewDrawer,
    openBaseBranchPicker,
    startReview,
    handleReviewDrawerOpenChange,
    handleReviewDrawerBack
  }
}
