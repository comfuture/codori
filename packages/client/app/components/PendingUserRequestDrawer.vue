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

const props = defineProps<{
  request: PendingUserRequestState | null
}>()

const emit = defineEmits<{
  respond: [payload: { requestId: string | number, response: unknown }]
}>()

const isRequestUserInput = computed(() => props.request?.kind === 'requestUserInput')

const title = computed(() => {
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
    :key="request ? `${request.kind}:${String(request.requestId)}` : 'empty'"
    :open="Boolean(request)"
    :hide-header="isRequestUserInput"
    :handle="!isRequestUserInput"
    :dismissible="!isRequestUserInput"
    :title="title"
    :description="description"
    :body-class="isRequestUserInput ? 'px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-4' : 'px-4 pb-4 pt-2 md:px-5'"
    @update:open="handleOpenChange"
  >
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
