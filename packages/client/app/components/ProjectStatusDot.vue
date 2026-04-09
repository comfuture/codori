<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  status: string
  pulse?: boolean
  padded?: boolean
}>(), {
  pulse: false,
  padded: false
})

const dotClass = computed(() => {
  switch (props.status) {
    case 'running':
    case 'Running':
      return 'bg-success ring-success/20'
    case 'starting':
    case 'Starting':
      return 'bg-primary ring-primary/20'
    case 'error':
    case 'Error':
      return 'bg-error ring-error/20'
    case 'stopped':
    case 'Stopped':
      return 'bg-muted ring-default'
    default:
      return 'bg-muted ring-default'
  }
})

const pulseClass = 'bg-success/35'
</script>

<template>
  <span
    class="inline-flex items-center justify-center"
    :class="padded ? 'rounded-md p-2' : ''"
  >
    <span class="relative inline-flex size-2 items-center justify-center">
      <span
        v-if="pulse"
        class="project-status-pulse absolute size-2 rounded-full"
        :class="pulseClass"
      />
      <span
        class="relative size-2 rounded-full ring-4"
        :class="dotClass"
      />
    </span>
  </span>
</template>

<style scoped>
.project-status-pulse {
  animation: project-status-pulse 1.8s cubic-bezier(0.16, 0.84, 0.32, 1) infinite;
}

@keyframes project-status-pulse {
  0% {
    opacity: 0.55;
    transform: scale(1);
  }

  72% {
    opacity: 0.1;
    transform: scale(4.4);
  }

  100% {
    opacity: 0;
    transform: scale(4.8);
  }
}
</style>
