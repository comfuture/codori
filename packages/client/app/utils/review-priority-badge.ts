import type { ComarkElement, ComarkNode, ComarkPlugin, ComarkTree } from '@comark/vue'

export const REVIEW_PRIORITY_BADGE_TAG = 'review-priority-badge'

const REVIEW_PRIORITY_PATTERN = /^P([1-3])$/i

const isElementNode = (node: ComarkNode): node is ComarkElement => {
  return Array.isArray(node) && typeof node[0] === 'string'
}

const getPriorityLabel = (node: ComarkElement) => {
  if (node[0] !== 'span') {
    return null
  }

  const children = node.slice(2)

  if (children.length !== 1 || typeof children[0] !== 'string') {
    return null
  }

  const label = children[0].trim().toUpperCase()

  return REVIEW_PRIORITY_PATTERN.test(label) ? label as `P${1 | 2 | 3}` : null
}

const createPriorityBadgeNode = (label: `P${1 | 2 | 3}`): ComarkElement => {
  return [REVIEW_PRIORITY_BADGE_TAG, { priority: label.slice(1) }, label]
}

const replaceLeadingPriorityBadge = (children: ComarkNode[]) => {
  const targetIndex = children.findIndex((child) => {
    return typeof child !== 'string' || child.trim().length > 0
  })

  if (targetIndex === -1) {
    return children
  }

  const target = children[targetIndex]

  if (!target) {
    return children
  }

  if (!isElementNode(target)) {
    return children
  }

  const label = getPriorityLabel(target)

  if (!label) {
    return children
  }

  return children.map((child, index) => {
    return index === targetIndex ? createPriorityBadgeNode(label) : child
  })
}

const transformNode = (node: ComarkNode, parentTag?: string): ComarkNode => {
  if (!isElementNode(node)) {
    return node
  }

  const [tag, props, ...children] = node
  let nextChildren = children.map(child => transformNode(child, tag))

  if (tag === 'li' || (tag === 'p' && parentTag === 'li')) {
    nextChildren = replaceLeadingPriorityBadge(nextChildren)
  }

  return [tag, props, ...nextChildren]
}

export const transformReviewPriorityBadges = (tree: ComarkTree): ComarkTree => {
  return {
    ...tree,
    nodes: tree.nodes.map(node => transformNode(node))
  }
}

export const reviewPriorityBadgePlugin = (): ComarkPlugin => {
  return {
    name: 'review-priority-badge',
    post: (state) => {
      state.tree = transformReviewPriorityBadges(state.tree)
    }
  }
}
