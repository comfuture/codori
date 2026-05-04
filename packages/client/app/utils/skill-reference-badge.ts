import type { ComarkElement, ComarkNode, ComarkPlugin, ComarkTree } from '@comark/vue'

export const SKILL_REFERENCE_BADGE_TAG = 'skill-reference-badge'

const RAW_SKILL_PATTERN = /^\$([a-z][a-z0-9:._/-]*)/u
const SKILL_LINK_LABEL_PATTERN = /^\$([a-z][a-z0-9:._/-]*)$/u
const SKILL_MARKDOWN_PATH_PATTERN = /(?:^|[/\\])SKILL\.md(?:$|[#?:])/iu

type MarkdownItStateInline = {
  src: string
  pos: number
  posMax: number
  push: (type: string, tag: string, nesting: number) => {
    attrSet: (name: string, value: string) => void
    content?: string
    markup?: string
  }
}

type MarkdownItParser = {
  inline: {
    ruler: {
      before: (
        beforeName: string,
        ruleName: string,
        rule: (state: MarkdownItStateInline, silent: boolean) => boolean
      ) => void
    }
  }
}

const isElementNode = (node: ComarkNode): node is ComarkElement => {
  return Array.isArray(node) && typeof node[0] === 'string'
}

const createSkillReferenceBadgeNode = (input: {
  name: string
  path?: string | null
  raw?: boolean
}): ComarkElement => {
  return [
    SKILL_REFERENCE_BADGE_TAG,
    {
      name: input.name,
      ...(input.path ? { path: input.path } : {}),
      ...(input.raw ? { raw: 'true' } : {})
    }
  ]
}

const decodeSkillHref = (href: unknown) => {
  if (typeof href !== 'string') {
    return null
  }

  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

const getSkillLinkReference = (node: ComarkElement) => {
  if (node[0] !== 'a') {
    return null
  }

  const props = node[1]
  const href = decodeSkillHref(props.href)
  if (!href || !SKILL_MARKDOWN_PATH_PATTERN.test(href)) {
    return null
  }

  const children = node.slice(2)
  if (children.length !== 1 || typeof children[0] !== 'string') {
    return null
  }

  const match = SKILL_LINK_LABEL_PATTERN.exec(children[0].trim())
  if (!match?.[1]) {
    return null
  }

  return {
    name: match[1],
    path: href
  }
}

const transformNode = (node: ComarkNode): ComarkNode => {
  if (!isElementNode(node)) {
    return node
  }

  const skillReference = getSkillLinkReference(node)
  if (skillReference) {
    return createSkillReferenceBadgeNode(skillReference)
  }

  const [tag, props, ...children] = node
  const nextChildren = children.map(child => transformNode(child))
  const hasRawSkillReference = nextChildren.some((child) => {
    return isElementNode(child)
      && child[0] === SKILL_REFERENCE_BADGE_TAG
      && child[1].raw === 'true'
  })

  if (hasRawSkillReference) {
    const lastIndex = nextChildren.length - 1
    const lastChild = nextChildren[lastIndex]
    if (typeof lastChild === 'string' && lastChild.endsWith('$')) {
      const trimmed = lastChild.slice(0, -1)
      if (trimmed) {
        nextChildren[lastIndex] = trimmed
      } else {
        nextChildren.pop()
      }
    }
  }

  return [
    tag,
    props,
    ...nextChildren
  ]
}

export const transformSkillReferenceBadges = (tree: ComarkTree): ComarkTree => {
  return {
    ...tree,
    nodes: tree.nodes.map(node => transformNode(node))
  }
}

const skillReferenceBadgeMarkdownItPlugin = (md: MarkdownItParser) => {
  md.inline.ruler.before('escape', 'skill_reference_badge', (state, silent) => {
    const source = state.src.slice(state.pos, state.posMax)
    const match = RAW_SKILL_PATTERN.exec(source)
    if (!match?.[1]) {
      return false
    }

    if (silent) {
      return true
    }

    const token = state.push('mdc_inline_component', SKILL_REFERENCE_BADGE_TAG, 0)
    token.attrSet('name', match[1])
    token.attrSet('raw', 'true')
    token.markup = '$'
    token.content = match[1]
    state.pos += match[0].length
    return true
  })
}

export const skillReferenceBadgePlugin = (): ComarkPlugin => {
  return {
    name: 'skill-reference-badge',
    markdownItPlugins: [skillReferenceBadgeMarkdownItPlugin],
    post: (state) => {
      state.tree = transformSkillReferenceBadges(state.tree)
    }
  }
}
