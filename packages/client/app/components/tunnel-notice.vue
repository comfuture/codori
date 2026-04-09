<script setup lang="ts">
import { computed } from 'vue'
import { useRequestURL } from '#imports'

const localHostnames = new Set([
  'localhost',
  '127.0.0.1',
  '::1'
])

const requestUrl = useRequestURL()

const shouldShow = computed(() => !localHostnames.has(requestUrl.hostname))
</script>

<template>
  <UAlert
    v-if="shouldShow"
    color="warning"
    variant="soft"
    icon="i-lucide-shield-alert"
    title="Private tunnel is not included"
  >
    <template #description>
      Codori does not create a private tunnel for you. Expose this service through your own network layer such as Tailscale or Cloudflare Tunnel.
    </template>
  </UAlert>
</template>
