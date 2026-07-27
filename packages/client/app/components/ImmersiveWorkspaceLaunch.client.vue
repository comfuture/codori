<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createImmersiveWorkspaceRoute,
  detectImmersiveVrSupport,
  type ImmersiveVrCapability,
  type RpcWorkspace
} from '~~/shared/workspace'

const props = defineProps<{
  workspace: RpcWorkspace
  threadId: string | null
  returnTo: string
}>()

const supported = ref(false)
let capabilityRequest = 0

const href = computed(() => {
  if (!props.workspace.id.trim() || !props.threadId?.trim()) {
    return null
  }
  return createImmersiveWorkspaceRoute({
    identity: {
      workspace: props.workspace,
      threadId: props.threadId
    },
    returnTo: props.returnTo
  })
})

onMounted(async () => {
  const request = ++capabilityRequest
  const xr = (navigator as Navigator & {
    xr?: ImmersiveVrCapability
  }).xr
  const nextSupported = await detectImmersiveVrSupport({
    secureContext: window.isSecureContext,
    xr
  })
  if (request === capabilityRequest) {
    supported.value = nextSupported
  }
})

onBeforeUnmount(() => {
  capabilityRequest += 1
})
</script>

<template>
  <UTooltip
    v-if="supported && href"
    text="Open immersive workspace"
  >
    <UButton
      :href="href"
      external
      icon="i-hugeicons-vr-glasses"
      color="neutral"
      variant="ghost"
      square
      aria-label="Open immersive workspace"
      data-testid="immersive-workspace-launch"
    />
  </UTooltip>
</template>
