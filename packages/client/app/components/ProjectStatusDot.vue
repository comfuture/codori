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

const pulseClass = 'text-success/35'
</script>

<template>
  <span
    class="relative inline-grid shrink-0 place-items-center align-middle"
    :class="padded ? 'rounded-md p-2' : ''"
  >
    <span
      v-if="pulse"
      aria-hidden="true"
      class="project-status-pulse pointer-events-none absolute inset-0 rounded-full"
      :class="pulseClass"
    >
    </span>

    <span
      class="relative z-10 block size-2 shrink-0 rounded-full ring-4"
      :class="dotClass"
    />
  </span>
</template>

<style scoped>
.project-status-pulse {
  animation: project-status-pulse 1.8s cubic-bezier(0.16, 0.84, 0.32, 1) infinite;
}

@keyframes project-status-pulse {
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0.9;
  }

  72% {
    box-shadow: 0 0 0 10px color-mix(in srgb, currentColor 22%, transparent);
    opacity: 0.2;
  }

  100% {
    box-shadow: 0 0 0 12px transparent;
    opacity: 0;
  }
}
</style>
