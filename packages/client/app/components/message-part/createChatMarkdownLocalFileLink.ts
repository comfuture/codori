import { defineComponent, h } from 'vue'
import type { WorkspaceLocalFileScope } from '../../../shared/local-files'
import LocalFileLink from './LocalFileLink.vue'

type LocalFileLinkScope = {
  projectId: string | null
  workspace: WorkspaceLocalFileScope | null
  workspaceRootPath: string | null
}

export const createChatMarkdownLocalFileLink = (resolveScope: () => LocalFileLinkScope) => defineComponent({
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
      ...resolveScope()
    }, slots)
  }
})
