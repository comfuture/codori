<script setup lang="ts">
defineProps<{
  pending?: boolean
}>()
</script>

<template>
  <USeparator
    :label="pending ? '.. compacting thread ..' : '...compacted thread...'"
    color="neutral"
    type="dashed"
    :ui="{
      root: 'py-2',
      border: 'border-muted',
      label: 'text-xs font-medium text-muted'
    }"
  />
</template>
