<script setup lang="ts">
withDefaults(defineProps<{
  open?: boolean
  title?: string
  description?: string
  hideHeader?: boolean
  bodyClass?: string
}>(), {
  open: false,
  title: '',
  description: '',
  hideHeader: false,
  bodyClass: ''
})

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()
</script>

<template>
  <UDrawer
    :open="open"
    direction="bottom"
    :handle="true"
    :ui="{
      content: 'inset-x-auto right-auto bottom-0 left-1/2 w-[90vw] max-w-[52rem] -translate-x-1/2 rounded-t-2xl rounded-b-none border-x border-t border-default bg-default shadow-2xl md:w-[min(50vw,52rem)]',
      container: 'gap-0 p-0',
      handle: 'mt-2 !h-1 !w-10 rounded-full',
      header: hideHeader ? 'hidden' : 'px-4 pb-1 pt-3 md:px-5',
      body: bodyClass || 'px-4 pb-4 pt-2 md:px-5',
      footer: 'hidden'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div
        v-if="!hideHeader && (title || description || $slots.header)"
        class="space-y-1.5"
      >
        <slot name="header">
          <h2
            v-if="title"
            class="text-sm font-semibold text-highlighted md:text-base"
          >
            {{ title }}
          </h2>
          <p
            v-if="description"
            class="text-sm leading-5 text-muted"
          >
            {{ description }}
          </p>
        </slot>
      </div>
    </template>

    <template #body>
      <slot />
    </template>
  </UDrawer>
</template>
