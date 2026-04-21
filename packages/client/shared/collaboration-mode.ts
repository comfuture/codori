import type { ReasoningEffort } from './generated/codex-app-server/ReasoningEffort'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const asModeKind = (value: unknown) =>
  value === 'plan' || value === 'default' ? value : null

const asReasoningEffort = (value: unknown): ReasoningEffort | null | undefined => {
  switch (value) {
    case undefined:
      return undefined
    case null:
      return null
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return undefined
  }
}

export type CollaborationModeKind = 'plan' | 'default'

export type CollaborationModeSettings = {
  model: string
  reasoning_effort: ReasoningEffort | null
  developer_instructions: string | null
}

export type CollaborationMode = {
  mode: CollaborationModeKind
  settings: CollaborationModeSettings
}

export type CollaborationModeMask = {
  name: string
  mode: CollaborationModeKind | null
  model: string | null
  reasoning_effort?: ReasoningEffort | null
}

export type CollaborationModeListResponse = {
  data: CollaborationModeMask[]
}

export const DRAFT_COLLABORATION_MODE_KEY = '__draft__'

export const resolveThreadCollaborationModeKey = (threadId: string | null | undefined) =>
  threadId?.trim() || DRAFT_COLLABORATION_MODE_KEY

const normalizeCollaborationModeMask = (value: unknown): CollaborationModeMask | null => {
  if (!isRecord(value)) {
    return null
  }

  const name = asTrimmedString(value.name)
  if (!name) {
    return null
  }

  const reasoningSource = Object.hasOwn(value, 'reasoning_effort')
    ? value.reasoning_effort
    : Object.hasOwn(value, 'reasoningEffort')
      ? value.reasoningEffort
      : undefined

  return {
    name,
    mode: asModeKind(value.mode),
    model: asTrimmedString(value.model),
    reasoning_effort: asReasoningEffort(reasoningSource)
  }
}

export const normalizeCollaborationModeListResponse = (value: unknown): CollaborationModeMask[] => {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return []
  }

  return value.data
    .map(normalizeCollaborationModeMask)
    .filter((mask): mask is CollaborationModeMask => mask !== null)
}

export const findCollaborationModeMask = (
  masks: CollaborationModeMask[],
  mode: CollaborationModeKind
) =>
  masks.find(mask => mask.mode === mode) ?? null

export const buildCollaborationModeFromMask = (
  mask: CollaborationModeMask | null | undefined,
  base: {
    model: string
    reasoning_effort: ReasoningEffort | null
  }
): CollaborationMode | null => {
  if (!mask?.mode) {
    return null
  }

  return {
    mode: mask.mode,
    settings: {
      model: mask.model ?? base.model,
      reasoning_effort: mask.reasoning_effort === undefined
        ? base.reasoning_effort
        : mask.reasoning_effort,
      developer_instructions: null
    }
  }
}
