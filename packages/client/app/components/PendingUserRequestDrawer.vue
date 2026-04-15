<script setup lang="ts">
import { computed } from 'vue'
import {
  buildMcpElicitationResponse,
  buildPendingUserRequestDismissResponse,
  buildRequestUserInputResponse,
  type PendingUserRequest
} from '../../shared/pending-user-request'
import BottomDrawerShell from './BottomDrawerShell.vue'
import McpElicitationForm from './pending-request/McpElicitationForm.vue'
import McpElicitationUrlPrompt from './pending-request/McpElicitationUrlPrompt.vue'
import RequestUserInputForm from './pending-request/RequestUserInputForm.vue'

const props = defineProps<{
  request: PendingUserRequest | null
}>()

const emit = defineEmits<{
  respond: [response: unknown]
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
  if (nextOpen || !props.request) {
    return
  }

  emit('respond', buildPendingUserRequestDismissResponse(props.request))
}
</script>

<template>
  <BottomDrawerShell
    :open="Boolean(request)"
    :hide-header="isRequestUserInput"
    :title="title"
    :description="description"
    :body-class="isRequestUserInput ? 'px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-4' : 'px-4 pb-4 pt-2 md:px-5'"
    @update:open="handleOpenChange"
  >
    <RequestUserInputForm
      v-if="request?.kind === 'requestUserInput'"
      :key="request.requestId"
      :request="request"
      @submit="emit('respond', buildRequestUserInputResponse($event))"
    />

    <McpElicitationForm
      v-else-if="request?.kind === 'mcpElicitationForm'"
      :key="request.requestId"
      :request="request"
      @accept="emit('respond', buildMcpElicitationResponse('accept', $event))"
      @decline="emit('respond', buildMcpElicitationResponse('decline'))"
      @cancel="emit('respond', buildMcpElicitationResponse('cancel'))"
    />

    <McpElicitationUrlPrompt
      v-else-if="request?.kind === 'mcpElicitationUrl'"
      :request="request"
      @accept="emit('respond', buildMcpElicitationResponse('accept'))"
      @decline="emit('respond', buildMcpElicitationResponse('decline'))"
      @cancel="emit('respond', buildMcpElicitationResponse('cancel'))"
    />
  </BottomDrawerShell>
</template>
