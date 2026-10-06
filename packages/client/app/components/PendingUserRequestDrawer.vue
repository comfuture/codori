<script setup lang="ts">
import { computed } from 'vue'
import {
  buildMcpElicitationResponse,
  buildPendingUserRequestDismissResponse,
  buildRequestUserInputResponse,
  type PendingUserRequestState
} from '../../shared/pending-user-request'
import BottomDrawerShell from './BottomDrawerShell.vue'
import McpElicitationForm from './pending-request/McpElicitationForm.vue'
import McpElicitationUrlPrompt from './pending-request/McpElicitationUrlPrompt.vue'
import RequestUserInputForm from './pending-request/RequestUserInputForm.vue'
import AsyncQuestions from './message-part/AsyncQuestions.vue'
import type { AsyncUserAnswer, AsyncUserQuestionRequest } from '../composables/useAsyncUserQuestions'

const props = defineProps<{
  request: PendingUserRequestState | null
  asyncRequest?: AsyncUserQuestionRequest | null
  asyncSubmitting?: boolean
  asyncError?: string | null
}>()

const emit = defineEmits<{
  respond: [payload: { requestId: string | number, response: unknown }]
  asyncRespond: [answer: AsyncUserAnswer]
  asyncDraftChange: [draft: AsyncUserAnswer]
  asyncDismiss: []
}>()

const isRequestUserInput = computed(() => props.request?.kind === 'requestUserInput')
const isAsyncRequest = computed(() => !props.request && Boolean(props.asyncRequest))

const title = computed(() => {
  if (isAsyncRequest.value) return 'User Answer'
  switch (props.request?.kind) {
    case 'mcpElicitationForm':
      return 'Tool confirmation required'
    case 'mcpElicitationUrl':
      return 'Complete a browser step'
    default:
      return ''
  }
})

const description = computed(() => {
  switch (props.request?.kind) {
    case 'mcpElicitationForm':
      return props.request.message ?? 'A connected MCP server asked for structured input.'
    case 'mcpElicitationUrl':
      return props.request.message ?? 'A connected MCP server asked you to finish a step outside the chat.'
    default:
      return ''
  }
})

const handleOpenChange = (nextOpen: boolean) => {
  if (!nextOpen && isAsyncRequest.value) {
    emit('asyncDismiss')
    return
  }
  if (nextOpen || !props.request || props.request.kind === 'requestUserInput') {
    return
  }

  emit('respond', {
    requestId: props.request.requestId,
    response: buildPendingUserRequestDismissResponse(props.request)
  })
}
</script>

<template>
  <BottomDrawerShell
    :key="request ? `${request.kind}:${String(request.requestId)}` : asyncRequest?.id ?? 'empty'"
    :open="Boolean(request || asyncRequest)"
    :hide-header="isRequestUserInput"
    :handle="!isRequestUserInput"
    :dismissible="!isRequestUserInput"
    :title="title"
    :description="description"
    :body-class="isRequestUserInput ? 'px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-4' : 'px-4 pb-4 pt-2 md:px-5'"
    @update:open="handleOpenChange"
  >
    <template v-if="isAsyncRequest && asyncRequest">
      <div class="mb-2 flex justify-end">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="emit('asyncDismiss')"
        >
          Dismiss
        </UButton>
      </div>
      <AsyncQuestions
        :questions="asyncRequest.questions"
        :question-index="asyncRequest.questionIndex"
        :answer-draft="asyncRequest.answerDraft"
        :disabled="asyncSubmitting"
        @reply="emit('asyncRespond', $event)"
        @draft-change="emit('asyncDraftChange', $event)"
      />
      <p
        v-if="asyncError"
        role="alert"
        class="mt-2 text-sm text-error"
      >
        {{ asyncError }}
      </p>
    </template>
    <RequestUserInputForm
      v-if="request?.kind === 'requestUserInput'"
      :key="request.requestId"
      :request="request"
      :submitting="request.submitting"
      @submit="emit('respond', {
        requestId: request.requestId,
        response: buildRequestUserInputResponse($event)
      })"
    />

    <McpElicitationForm
      v-else-if="request?.kind === 'mcpElicitationForm'"
      :key="request.requestId"
      :request="request"
      @accept="emit('respond', {
        requestId: request.requestId,
        response: buildMcpElicitationResponse('accept', $event)
      })"
      @decline="emit('respond', {
        requestId: request.requestId,
        response: buildMcpElicitationResponse('decline')
      })"
      @cancel="emit('respond', {
        requestId: request.requestId,
        response: buildMcpElicitationResponse('cancel')
      })"
    />

    <McpElicitationUrlPrompt
      v-else-if="request?.kind === 'mcpElicitationUrl'"
      :request="request"
      @accept="emit('respond', {
        requestId: request.requestId,
        response: buildMcpElicitationResponse('accept')
      })"
      @decline="emit('respond', {
        requestId: request.requestId,
        response: buildMcpElicitationResponse('decline')
      })"
      @cancel="emit('respond', {
        requestId: request.requestId,
        response: buildMcpElicitationResponse('cancel')
      })"
    />
  </BottomDrawerShell>
</template>
