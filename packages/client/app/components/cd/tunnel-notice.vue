<template>
  <UAlert
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

