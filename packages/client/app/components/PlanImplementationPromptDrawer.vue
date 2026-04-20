<script setup lang="ts">
import BottomDrawerShell from './BottomDrawerShell.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  implement: []
  stayInPlan: []
  'update:open': [open: boolean]
}>()
</script>

<template>
  <BottomDrawerShell
    :open="props.open"
    title="Implement this plan?"
    description="Switch back to Default mode and start implementing the approved plan."
    body-class="px-4 pb-4 pt-2 md:px-5"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-2">
      <UButton
        type="button"
        color="primary"
        block
        class="justify-center rounded-lg"
        @click="emit('implement')"
      >
        Yes, implement this plan
      </UButton>

      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        block
        class="justify-center rounded-lg"
        @click="emit('stayInPlan')"
      >
        No, stay in Plan mode
      </UButton>
    </div>
  </BottomDrawerShell>
</template>
