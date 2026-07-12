<script setup lang="ts">
import { computed } from 'vue'
import { useLocalFileViewer } from '../composables/useLocalFileViewer'
import LocalFilePreview from './LocalFilePreview.vue'

const { state, closeViewer } = useLocalFileViewer()

const isOpen = computed({
  get: () => state.value.open,
  set: (open: boolean) => {
    if (!open) {
      closeViewer()
    }
  }
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    fullscreen
    :ui="{
      header: 'hidden',
      close: 'hidden',
      content: 'overflow-hidden bg-default',
      body: '!h-full !p-0'
    }"
  >
    <template #body>
      <LocalFilePreview
        v-if="state.workspace && state.path"
        :workspace="state.workspace"
        :path="state.path"
        :line="state.line"
      >
        <template #actions>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Close local file viewer"
            @click="closeViewer"
          />
        </template>
      </LocalFilePreview>
    </template>
  </UModal>
</template>
