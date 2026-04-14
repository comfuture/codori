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
      content: 'inset-x-auto right-auto bottom-0 left-1/2 w-[calc(100vw-0.75rem)] max-w-[52rem] -translate-x-1/2 rounded-t-2xl rounded-b-none border-x border-t border-default bg-default shadow-2xl md:w-[min(50vw,52rem)]',
      container: 'gap-0 p-0',
      handle: 'mt-2 !h-1 !w-10 rounded-full',
      header: 'px-4 pb-1 pt-3 md:px-5',
      body: 'px-4 pb-4 pt-2 md:px-5',
      footer: 'hidden'
    }"
    @update:open="handleOpenChange"
  >
    <template #header>
      <div
        v-if="request"
        class="space-y-1.5"
      >
        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Pending request
        </p>
        <h2 class="text-sm font-semibold text-highlighted md:text-base">
          {{ title }}
        </h2>
        <p class="text-sm leading-5 text-muted">
          {{ description }}
        </p>
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
