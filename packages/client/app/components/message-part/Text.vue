<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import math, { Math as ComarkMath } from '@comark/vue/plugins/math'
import mermaid, { Mermaid } from '@comark/vue/plugins/mermaid'
import { computed, defineComponent, h, type Component } from 'vue'

const props = defineProps<{
  role?: 'user' | 'assistant' | 'system'
  part?: {
    type: 'text'
    text: string
    state?: 'done' | 'streaming'
  } | null
}>()

const ResponsiveMermaid = Mermaid as Component

const ChatMarkdownMermaid = defineComponent({
  name: 'ChatMarkdownMermaid',
  props: {
    content: {
      type: String,
      required: true
    },
    class: {
      type: String,
      default: ''
    },
    height: {
      type: String,
      default: ''
    },
    width: {
      type: String,
      default: ''
    },
    theme: {
      type: [String, Object],
      default: undefined
    },
    themeDark: {
      type: [String, Object],
      default: undefined
    }
  },
  setup(props, { attrs }) {
    return () => h(ResponsiveMermaid, {
      ...attrs,
      ...props,
      height: props.height || 'auto',
      width: props.width || '100%'
    })
  }
})

const components = {
  math: ComarkMath,
  mermaid: ChatMarkdownMermaid
}

const plugins = [
  math(),
  mermaid(),
  highlight({ preStyles: false })
]
const isStreaming = computed(() => props.part?.state === 'streaming')
</script>

<template>
  <p
    v-if="role === 'user'"
    class="whitespace-pre-wrap text-[15px] leading-7 text-highlighted"
  >
    {{ part?.text ?? '' }}
  </p>
  <Suspense v-else>
    <Comark
      class="cd-markdown"
      :markdown="part?.text ?? ''"
      :streaming="isStreaming"
      :components="components"
      :plugins="plugins"
      caret
    />
  </Suspense>
</template>
