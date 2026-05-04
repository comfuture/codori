import { renderMermaidSVG, THEMES } from 'beautiful-mermaid'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export const ChatMarkdownMermaid = defineComponent({
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
    let observer: MutationObserver | null = null

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

      observer = new MutationObserver(() => {
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

    onBeforeUnmount(() => {
      observer?.disconnect()
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
