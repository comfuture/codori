<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  part?: {
    type: 'reasoning'
    summary: string[]
    content: string[]
    state?: 'done' | 'streaming'
  } | null
}>()

const plugins = [highlight({ preStyles: false })]
const isOpen = ref(props.part?.state === 'streaming')

watch(() => props.part?.state, (state) => {
  if (state === 'streaming') {
    isOpen.value = true
  }
})

const summaryText = computed(() => {
  const summary = props.part?.summary.join(' ').trim()
  if (summary) {
    return summary
  }

  const content = props.part?.content.join(' ').trim()
  return content || 'Reasoning'
})

const bodyText = computed(() =>
  [...(props.part?.summary ?? []), ...(props.part?.content ?? [])]
    .join('\n\n')
    .trim()
)
</script>

<template>
  <div class="rounded-2xl border border-default/70 bg-elevated/30">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      @click="isOpen = !isOpen"
    >
      <div class="flex min-w-0 items-start gap-3">
        <UIcon
          name="i-lucide-brain-circuit"
          class="mt-0.5 size-4 shrink-0 text-primary"
        />
        <div class="min-w-0">
          <div class="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
            Reasoning
          </div>
          <div class="truncate text-sm text-toned">
            {{ summaryText }}
          </div>
        </div>
      </div>
      <UIcon
        :name="isOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-4 shrink-0 text-muted"
      />
    </button>

    <div
      v-if="isOpen"
      class="border-t border-default/70 px-4 py-4"
    >
      <Suspense>
        <Comark
          class="cd-markdown"
          :markdown="bodyText"
          :streaming="part?.state === 'streaming'"
          :plugins="plugins"
          caret
        />
      </Suspense>
    </div>
  </div>
</template>
