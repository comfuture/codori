import type { ComarkPlugin, ElementNode, Node } from '@comark/vue'

type MarkdownTree = Parameters<NonNullable<ComarkPlugin['post']>>[0]['tree']

export const SKILL_REFERENCE_BADGE_TAG = 'skill-reference-badge'

const RAW_SKILL_PATTERN = /^\$([a-z0-9][a-z0-9:._/-]*)/iu
const SKILL_LINK_LABEL_PATTERN = /^\$([a-z0-9][a-z0-9:._/-]*)$/iu
const SKILL_MARKDOWN_PATH_PATTERN = /(?:^|[/\\])SKILL\.md(?:$|[#?:])/iu
const TRAILING_RAW_SKILL_PUNCTUATION_PATTERN = /[.,!?;:]+$/u

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

const isElementNode = (node: Node): node is ElementNode => {
  return Array.isArray(node) && typeof node[0] === 'string'
}

const getRawSkillMatch = (source: string) => {
  const match = RAW_SKILL_PATTERN.exec(source)
  const rawName = match?.[1]
  if (!rawName) {
    return null
  }

  const name = rawName.replace(TRAILING_RAW_SKILL_PUNCTUATION_PATTERN, '')
  if (name.length < 2) {
    return null
  }

  return {
    name,
    length: name.length + 1
  }
}

const createSkillReferenceBadgeNode = (input: {
  name: string
  path?: string | null
  raw?: boolean
}): ElementNode => {
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

const isRawSkillReferenceNode = (node: Node): node is ElementNode => {
  return isElementNode(node)
    && node[0] === SKILL_REFERENCE_BADGE_TAG
    && node[1].raw === 'true'
}

const getRawSkillReferenceNodeName = (node: Node) => {
  if (!isRawSkillReferenceNode(node)) {
    return null
  }

  const name = node[1].name
  return typeof name === 'string' && name ? name : null
}

const getSkillLinkReference = (node: ElementNode) => {
  if (node[0] !== 'a') {
    return null
  }

  const props = node[1]
  const href = decodeSkillHref(props.href)
  if (!href || !SKILL_MARKDOWN_PATH_PATTERN.test(href)) {
    return null
  }

  const children = node.slice(2) as Node[]
  if (children.length !== 1) {
    return null
  }

  const [label] = children
  if (label == null) {
    return null
  }

  if (typeof label !== 'string') {
    const rawSkillName = getRawSkillReferenceNodeName(label)
    return rawSkillName
      ? {
          name: rawSkillName,
          path: href
        }
      : null
  }

  const match = SKILL_LINK_LABEL_PATTERN.exec(label.trim())
  if (!match?.[1]) {
    return null
  }

  return {
    name: match[1],
    path: href
  }
}

const removeRawSkillAutoCloseMarkers = (children: Node[]) => {
  const nextChildren = [...children]
  let shouldTrimTrailingMarker = false

  for (let index = 0; index < nextChildren.length; index += 1) {
    const child = nextChildren[index]
    if (!child || !isRawSkillReferenceNode(child)) {
      continue
    }

    const nextChild = nextChildren[index + 1]
    if (typeof nextChild === 'string' && nextChild.startsWith('$')) {
      const trimmed = nextChild.slice(1)
      if (trimmed) {
        nextChildren[index + 1] = trimmed
      } else {
        nextChildren.splice(index + 1, 1)
      }
      continue
    }

    shouldTrimTrailingMarker = true
  }

  if (!shouldTrimTrailingMarker) {
    return nextChildren
  }

  for (let index = nextChildren.length - 1; index >= 0; index -= 1) {
    const child = nextChildren[index]
    if (typeof child !== 'string') {
      continue
    }

    const trimmed = child.replace(/\$(\s*)$/u, '$1')
    if (trimmed !== child) {
      if (trimmed) {
        nextChildren[index] = trimmed
      } else {
        nextChildren.splice(index, 1)
      }
    }
    break
  }

  return nextChildren
}

const transformNode = (node: Node): Node => {
  if (!isElementNode(node)) {
    return node
  }

  const skillReference = getSkillLinkReference(node)
  if (skillReference) {
    return createSkillReferenceBadgeNode(skillReference)
  }

  const [tag, props, ...children] = node
  const nextChildren = removeRawSkillAutoCloseMarkers(
    children.map(child => transformNode(child))
  )

  return [
    tag,
    props,
    ...nextChildren
  ]
}

export const transformSkillReferenceBadges = (tree: MarkdownTree): MarkdownTree => {
  return {
    ...tree,
    nodes: tree.nodes.map(node => transformNode(node))
  }
}

const skillReferenceBadgeMarkdownItPlugin = (md: MarkdownItParser) => {
  md.inline.ruler.before('escape', 'skill_reference_badge', (state, silent) => {
    const source = state.src.slice(state.pos, state.posMax)
    const match = getRawSkillMatch(source)
    if (!match) {
      return false
    }

    state.pos += match.length
    if (silent) {
      return true
    }

    const token = state.push('mdc_inline_component', SKILL_REFERENCE_BADGE_TAG, 0)
    token.attrSet('name', match.name)
    token.attrSet('raw', 'true')
    token.markup = '$'
    token.content = match.name
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
