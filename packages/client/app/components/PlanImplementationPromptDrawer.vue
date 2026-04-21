<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BottomDrawerShell from './BottomDrawerShell.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  implement: []
  revisePlan: [prompt: string]
  'update:open': [open: boolean]
}>()

const revisionPrompt = ref('')
const implementButton = ref<{ $el?: HTMLElement } | HTMLElement | null>(null)

const trimmedRevisionPrompt = computed(() => revisionPrompt.value.trim())
const focusImplementButton = () => {
  const element = implementButton.value instanceof HTMLElement
    ? implementButton.value
    : implementButton.value?.$el

  element?.focus()
}

watch(() => props.open, async (open) => {
  if (open) {
    await nextTick()
    focusImplementButton()
    return
  }

  if (!open) {
    revisionPrompt.value = ''
  }
}, { immediate: true })

const submitRevisionPrompt = () => {
  if (!trimmedRevisionPrompt.value) {
    return
  }

  emit('revisePlan', trimmedRevisionPrompt.value)
  revisionPrompt.value = ''
}
</script>

<template>
  <BottomDrawerShell
    :open="props.open"
    title="Implement this plan?"
    description="Start implementation now, or add more guidance to request an updated plan while staying in Plan mode."
    body-class="px-4 pb-4 pt-2 md:px-5"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-3">
      <UButton
        ref="implementButton"
        type="button"
        color="primary"
        block
        class="justify-center rounded-lg"
        @click="emit('implement')"
      >
        Yes, implement this plan
      </UButton>

      <form
        class="space-y-2"
        @submit.prevent="submitRevisionPrompt"
      >
        <UInput
          v-model="revisionPrompt"
          size="lg"
          class="w-full"
          placeholder="Add more guidance and press Enter to update the plan"
        />

        <UButton
          type="submit"
          color="neutral"
          variant="ghost"
          block
          class="justify-center rounded-lg"
          :disabled="!trimmedRevisionPrompt"
        >
          Update the plan
        </UButton>
      </form>
    </div>
  </BottomDrawerShell>
</template>
