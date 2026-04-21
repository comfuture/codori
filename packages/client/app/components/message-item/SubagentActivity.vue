<script setup lang="ts">
import { computed } from 'vue'
import type { SubagentActivityItem, SubagentAgentState } from '~~/shared/codex-chat'
import { useChatToolState } from './use-chat-tool-state'

const props = defineProps<{
  item: SubagentActivityItem
  agentStates?: SubagentAgentState[]
}>()

const hiddenActions = new Set<SubagentActivityItem['tool']>([
  'wait',
  'closeAgent'
])

const isHidden = computed(() => hiddenActions.has(props.item.tool))
const stateEntries = computed<SubagentAgentState[]>(() => props.agentStates ?? [])

const shortThreadId = (value: string) => value.slice(0, 8)

const title = computed(() => {
  switch (props.item.tool) {
    case 'spawnAgent':
      if (props.item.status === 'failed') {
        return 'Spawn failed'
      }
      return props.item.status === 'inProgress' ? 'Spawning..' : 'Spawned'
    case 'sendInput':
      if (props.item.status === 'failed') {
        return 'Send failed'
      }
      return props.item.status === 'inProgress' ? 'Sending..' : 'Sent'
    case 'resumeAgent':
      if (props.item.status === 'failed') {
        return 'Resume failed'
      }
      return props.item.status === 'inProgress' ? 'Resuming..' : 'Resumed'
    case 'wait':
      return 'Waiting'
    case 'closeAgent':
      return 'Closed'
    default:
      return 'Subagent'
  }
})

const suffix = computed(() => {
  if (props.item.receiverThreadIds.length === 0) {
    return ''
  }

  if (props.item.receiverThreadIds.length === 1) {
    return shortThreadId(props.item.receiverThreadIds[0] ?? '')
  }

  return `${props.item.receiverThreadIds.length} agents`
})

const statusColor = (status: SubagentAgentState['status']) => {
  switch (status) {
    case 'pendingInit':
      return 'primary'
    case 'running':
      return 'info'
    case 'completed':
      return 'success'
    case 'interrupted':
      return 'warning'
    case 'errored':
      return 'error'
    case 'shutdown':
    case 'notFound':
      return 'neutral'
    default:
      return 'neutral'
  }
}

const statusLabel = (status: SubagentAgentState['status']) => {
  switch (status) {
    case 'pendingInit':
      return 'pending'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'interrupted':
      return 'interrupted'
    case 'errored':
      return 'errored'
    case 'shutdown':
      return 'shutdown'
    case 'notFound':
      return 'not found'
    default:
      return 'active'
  }
}

const icon = computed(() =>
  props.item.status === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-bot'
)

const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status !== 'completed')
</script>

<template>
  <UChatTool
    v-if="!isHidden"
    :text="title"
    :suffix="suffix"
    :icon="icon"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="card"
    :open="open"
    :default-open="item.status === 'failed'"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <div class="rounded-md border border-default/70 bg-elevated/20 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span class="font-medium text-highlighted">from</span>
          <span class="font-mono text-toned">{{ shortThreadId(item.senderThreadId) }}</span>
          <span class="font-medium text-highlighted">to</span>
          <span class="font-mono text-toned">{{ item.receiverThreadIds.map(shortThreadId).join(', ') || '-' }}</span>
        </div>
        <div
          v-if="item.model || item.reasoningEffort"
          class="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted"
        >
          <span v-if="item.model">model: <span class="font-mono text-toned">{{ item.model }}</span></span>
          <span v-if="item.reasoningEffort">reasoning: <span class="font-mono text-toned">{{ item.reasoningEffort }}</span></span>
        </div>
      </div>

      <div
        v-if="item.prompt"
        class="rounded-md border border-default/70 bg-elevated/10 px-3 py-2"
      >
        <p class="mb-2 text-xs font-medium text-highlighted">
          Prompt
        </p>
        <pre class="whitespace-pre-wrap break-words text-xs leading-6 text-muted">{{ item.prompt }}</pre>
      </div>

      <div
        v-if="stateEntries.length > 0"
        class="rounded-md border border-default/70 bg-elevated/10 px-3 py-2"
      >
        <p class="mb-2 text-xs font-medium text-highlighted">
          Agent states
        </p>

        <ul class="space-y-2">
          <li
            v-for="entry in stateEntries"
            :key="`${item.id}-${entry.threadId}`"
            class="space-y-1"
          >
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="font-mono text-toned">{{ shortThreadId(entry.threadId) }}</span>
              <UBadge
                :color="statusColor(entry.status)"
                variant="soft"
                size="xs"
              >
                {{ statusLabel(entry.status) }}
              </UBadge>
            </div>
            <p
              v-if="entry.message"
              class="text-xs text-muted"
            >
              {{ entry.message }}
            </p>
          </li>
        </ul>
      </div>
    </div>
  </UChatTool>
</template>
