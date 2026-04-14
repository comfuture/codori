<script setup lang="ts">
import { computed } from 'vue'
import {
  buildMcpElicitationResponse,
  buildRequestUserInputResponse,
  type PendingUserRequest
} from '../../shared/pending-user-request'
import McpElicitationForm from './pending-request/McpElicitationForm.vue'
import McpElicitationUrlPrompt from './pending-request/McpElicitationUrlPrompt.vue'
import RequestUserInputForm from './pending-request/RequestUserInputForm.vue'

const props = defineProps<{
  request: PendingUserRequest | null
}>()

const emit = defineEmits<{
  respond: [response: unknown]
}>()

const title = computed(() => {
  switch (props.request?.kind) {
    case 'requestUserInput':
      return 'Codex needs your input'
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
    case 'requestUserInput':
      return 'This reply will be sent back to the in-flight Codex request, not as a new chat message.'
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

  emit('respond', buildMcpElicitationResponse('cancel'))
}
</script>

<template>
  <UDrawer
    :open="Boolean(request)"
    direction="bottom"
    :handle="true"
    :ui="{
      content: 'max-h-[88dvh] rounded-t-3xl',
      container: 'gap-0 p-0',
      header: 'px-4 pb-2 pt-4 md:px-6',
      body: 'px-4 pb-5 pt-1 md:px-6',
      footer: 'hidden'
    }"
    @update:open="handleOpenChange"
  >
    <template #header>
      <div
        v-if="request"
        class="flex items-start justify-between gap-4"
      >
        <div class="space-y-1">
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Pending request
          </p>
          <h2 class="text-base font-semibold text-highlighted">
            {{ title }}
          </h2>
          <p class="text-sm leading-6 text-muted">
            {{ description }}
          </p>
        </div>
      </div>
    </template>

    <template #body>
      <RequestUserInputForm
        v-if="request?.kind === 'requestUserInput'"
        :request="request"
        @submit="emit('respond', buildRequestUserInputResponse($event))"
      />

      <McpElicitationForm
        v-else-if="request?.kind === 'mcpElicitationForm'"
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
    </template>
  </UDrawer>
</template>
