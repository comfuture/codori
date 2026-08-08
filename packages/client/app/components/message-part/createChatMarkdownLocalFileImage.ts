import { defineComponent, h } from 'vue'
import type { WorkspaceLocalFileScope } from '../../../shared/local-files'
import LocalFileImage from './LocalFileImage.vue'

type LocalFileImageScope = {
  projectId: string | null
  workspace: WorkspaceLocalFileScope | null
}

export const createChatMarkdownLocalFileImage = (resolveScope: () => LocalFileImageScope) => defineComponent({
  name: 'ChatMarkdownLocalFileImage',
  inheritAttrs: false,
  props: {
    src: {
      type: String,
      default: ''
    },
    alt: {
      type: String,
      default: ''
    },
    title: {
      type: String,
      default: ''
    }
  },
  setup(imageProps, { attrs }) {
    return () => h(LocalFileImage, {
      ...attrs,
      src: imageProps.src,
      alt: imageProps.alt,
      title: imageProps.title,
      ...resolveScope()
    })
  }
})
