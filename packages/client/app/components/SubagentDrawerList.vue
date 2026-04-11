<script setup lang="ts">
import type { VisualSubagentPanel } from '~~/shared/codex-chat'
import {
  resolveSubagentAccent,
  resolveSubagentStatusMeta
} from '~~/shared/subagent-panels'

defineProps<{
  agents: VisualSubagentPanel[]
}>()

const emit = defineEmits<{
  expand: [threadId: string]
}>()
</script>

<template>
  <div class="min-h-0">
    <div
      v-if="agents.length === 0"
      class="rounded-lg border border-dashed border-default px-4 py-6 text-sm text-muted"
    >
      No subagents yet.
    </div>

    <ul
      v-else
      class="divide-y divide-default"
    >
      <li
        v-for="(agent, index) in agents"
        :key="agent.threadId"
        class="flex items-center gap-3 px-4 py-3"
      >
        <div
          class="size-2.5 shrink-0 rounded-full ring-4"
          :class="resolveSubagentAccent(index).dotClass"
        />

        <div class="min-w-0 flex-1">
          <p
            class="truncate text-sm font-medium"
            :class="resolveSubagentAccent(index).textClass"
          >
            {{ agent.name }}
          </p>
          <p class="text-xs text-muted">
            {{ resolveSubagentStatusMeta(agent.status).label }}
          </p>
        </div>

        <UButton
          icon="i-lucide-expand"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          :aria-label="`Expand ${agent.name}`"
          @click="emit('expand', agent.threadId)"
        />
      </li>
    </ul>
  </div>
</template>
