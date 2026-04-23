<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import math, { Math as ComarkMath } from '@comark/vue/plugins/math'
import mermaid from '@comark/vue/plugins/mermaid'
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue'
import LocalFileLink from './LocalFileLink.vue'
import ReviewPriorityBadge from './ReviewPriorityBadge.vue'
import { reviewPriorityBadgePlugin } from '../../utils/review-priority-badge'
import type { WorkspaceLocalFileScope } from '../../../shared/local-files'

const props = defineProps<{
  role?: 'user' | 'assistant' | 'system'
  projectId?: string | null
  workspace?: WorkspaceLocalFileScope | null
  workspaceRootPath?: string | null
  part?: {
    type: 'text'
    text: string
    state?: 'done' | 'streaming'
  } | null
}>()

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
    const svgContent = ref('')
    const error = ref<string | null>(null)
    const isDark = ref(false)

    const resolveTheme = () => {
      const themeProp = isDark.value ? props.themeDark : props.theme

      if (typeof themeProp === 'string' && themeProp in THEMES) {
        return THEMES[themeProp]
      }

      if (themeProp && typeof themeProp === 'object') {
        return themeProp
      }

      return THEMES[isDark.value ? 'tokyo-night' : 'tokyo-night-light']
    }

    const renderDiagram = () => {
      try {
        svgContent.value = renderMermaidSVG(props.content, resolveTheme())
        error.value = null
      } catch (caught) {
        svgContent.value = ''
        error.value = caught instanceof Error ? caught.message : 'Failed to render Mermaid diagram'
      }
    }

    onMounted(() => {
      const htmlEl = document.documentElement
      isDark.value = htmlEl.classList.contains('dark')

      const observer = new MutationObserver(() => {
        const nextIsDark = htmlEl.classList.contains('dark')
        if (nextIsDark !== isDark.value) {
          isDark.value = nextIsDark
          renderDiagram()
        }
      })

      observer.observe(htmlEl, {
        attributes: true,
        attributeFilter: ['class']
      })

      renderDiagram()
    })

    watch(() => [props.content, props.theme, props.themeDark], () => {
      renderDiagram()
    })

    return () => {
      if (error.value) {
        return h('pre', {
          ...attrs,
          class: ['cd-markdown-mermaid-fallback', props.class].filter(Boolean).join(' '),
          'data-mermaid-error': error.value
        }, [
          h('code', {
            class: 'language-mermaid'
          }, props.content)
        ])
      }

      return h('div', {
        ...attrs,
        class: ['mermaid', props.class].filter(Boolean).join(' '),
        style: {
          display: 'flex',
          justifyContent: 'center',
          width: props.width || '100%',
          height: props.height || 'auto'
        },
        innerHTML: svgContent.value
      })
    }
  }
})

const ChatMarkdownLocalFileLink = defineComponent({
  name: 'ChatMarkdownLocalFileLink',
  props: {
    href: {
      type: String,
      default: ''
    },
    title: {
      type: String,
      default: ''
    }
  },
  setup(linkProps, { slots }) {
    return () => h(LocalFileLink, {
      href: linkProps.href,
      title: linkProps.title,
      projectId: props.projectId ?? null,
      workspace: props.workspace ?? null,
      workspaceRootPath: props.workspaceRootPath ?? null
    }, slots)
  }
})

const components = {
  a: ChatMarkdownLocalFileLink,
  math: ComarkMath,
  mermaid: ChatMarkdownMermaid,
  'review-priority-badge': ReviewPriorityBadge
}

const plugins = [
  math(),
  mermaid(),
  reviewPriorityBadgePlugin(),
  highlight({ preStyles: false })
]
const isStreaming = computed(() => props.part?.state === 'streaming')
const markdownClass = computed(() =>
  props.role === 'user'
    ? 'cd-markdown cd-markdown-user'
    : 'cd-markdown'
)
</script>

<template>
  <Suspense>
    <Comark
      :class="markdownClass"
      :markdown="part?.text ?? ''"
      :streaming="isStreaming"
      :components="components"
      :plugins="plugins"
      caret
    />
  </Suspense>
</template>
