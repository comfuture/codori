<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  priority: '1' | '2' | '3'
}>()

const priorityUi = computed(() => {
  const base = 'align-middle rounded-md font-semibold ring-1 ring-inset'

  switch (props.priority) {
    case '1':
      return {
        base: `${base} bg-[#ea580c]/15 text-[#fdba74] ring-[#ea580c]/35 dark:bg-[#ea580c]/20 dark:text-[#fed7aa] dark:ring-[#fb923c]/35`
      }
    case '2':
      return {
        base: `${base} bg-[#f59e0b]/15 text-[#fcd34d] ring-[#f59e0b]/35 dark:bg-[#f59e0b]/20 dark:text-[#fde68a] dark:ring-[#fbbf24]/35`
      }
    default:
      return {
        base: `${base} bg-[#fbbf24]/15 text-[#fde68a] ring-[#fbbf24]/35 dark:bg-[#fbbf24]/20 dark:text-[#fef3c7] dark:ring-[#facc15]/35`
      }
  }
})
</script>

<template>
  <UBadge
    as="span"
    color="warning"
    variant="soft"
    size="sm"
    :ui="priorityUi"
  >
    P{{ priority }}
  </UBadge>
</template>
