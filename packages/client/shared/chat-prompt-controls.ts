import type { ReasoningEffort } from './generated/codex-app-server/ReasoningEffort'

export const FALLBACK_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const satisfies readonly ReasoningEffort[]

export type ModelOption = {
  id: string
  model: string
  displayName: string
  hidden: boolean
  isDefault: boolean
  defaultReasoningEffort: ReasoningEffort
  supportedReasoningEfforts: ReasoningEffort[]
}

export type TokenUsageSnapshot = {
  totalTokens: number | null
  totalInputTokens: number
  totalCachedInputTokens: number
  totalOutputTokens: number
  lastUsageKnown: boolean
  lastTotalTokens: number | null
  lastInputTokens: number
  lastCachedInputTokens: number
  lastOutputTokens: number
  modelContextWindow: number | null
}

export type ContextWindowState = {
  contextWindow: number | null
  usedTokens: number | null
  remainingTokens: number | null
  usedPercent: number | null
  remainingPercent: number | null
}

type ReasoningEffortOptionRecord = {
  reasoningEffort?: unknown
}

type ModelRecord = {
  id?: unknown
  model?: unknown
  displayName?: unknown
  hidden?: unknown
  isDefault?: unknown
  defaultReasoningEffort?: unknown
  supportedReasoningEfforts?: unknown
}

export const FALLBACK_MODELS: ModelOption[] = [
  {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [...FALLBACK_REASONING_EFFORTS]
  },
  {
    id: 'gpt-5.4-mini',
    model: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [...FALLBACK_REASONING_EFFORTS]
  },
  {
    id: 'gpt-5.3-codex',
    model: 'gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [...FALLBACK_REASONING_EFFORTS]
  }
]

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === 'string' && FALLBACK_REASONING_EFFORTS.includes(value as ReasoningEffort)

const toFiniteNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const toReasoningEfforts = (value: unknown): ReasoningEffort[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (isReasoningEffort(entry)) {
      return [entry]
    }

    const record = isObjectRecord(entry) ? entry as ReasoningEffortOptionRecord : null
    return isReasoningEffort(record?.reasoningEffort) ? [record.reasoningEffort] : []
  })
}

const normalizeModel = (value: unknown): ModelOption | null => {
  const record = isObjectRecord(value) ? value as ModelRecord : null
  if (!record || typeof record.model !== 'string') {
    return null
  }

  const supportedReasoningEfforts = toReasoningEfforts(record.supportedReasoningEfforts)
  const defaultReasoningEffort = isReasoningEffort(record.defaultReasoningEffort)
    ? record.defaultReasoningEffort
    : supportedReasoningEfforts[0] ?? 'medium'

  return {
    id: typeof record.id === 'string' ? record.id : record.model,
    model: record.model,
    displayName: typeof record.displayName === 'string' && record.displayName.trim()
      ? record.displayName.trim()
      : record.model,
    hidden: Boolean(record.hidden),
    isDefault: Boolean(record.isDefault),
    defaultReasoningEffort,
    supportedReasoningEfforts: supportedReasoningEfforts.length > 0
      ? supportedReasoningEfforts
      : [...FALLBACK_REASONING_EFFORTS]
  }
}

export const normalizeModelList = (value: unknown): ModelOption[] => {
  const data = isObjectRecord(value) && Array.isArray(value.data)
    ? value.data
    : Array.isArray(value)
      ? value
      : []

  const models = data
    .map(normalizeModel)
    .filter((entry): entry is ModelOption => entry !== null)

  return models.length > 0 ? models : FALLBACK_MODELS
}

export const ensureModelOption = (
  models: ModelOption[],
  model: string | null | undefined,
  effort?: ReasoningEffort | null
) => {
  if (!model || models.some(entry => entry.model === model)) {
    return models
  }

  return [{
    id: model,
    model,
    displayName: model,
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: effort ?? 'medium',
    supportedReasoningEfforts: [...FALLBACK_REASONING_EFFORTS]
  }, ...models]
}

export const visibleModelOptions = (models: ModelOption[]) => {
  const visible = models.filter(model => !model.hidden)
  return visible.length > 0 ? visible : FALLBACK_MODELS
}

export const resolveSelectedModel = (
  models: ModelOption[],
  preferredModel?: string | null
) => {
  if (preferredModel && models.some(model => model.model === preferredModel)) {
    return preferredModel
  }

  const defaultModel = models.find(model => model.isDefault)?.model
  return defaultModel ?? models[0]?.model ?? FALLBACK_MODELS[0]!.model
}

export const resolveEffortOptions = (
  models: ModelOption[],
  model: string | null | undefined
) => {
  const selectedModel = models.find(entry => entry.model === model)
  return selectedModel?.supportedReasoningEfforts.length
    ? selectedModel.supportedReasoningEfforts
    : [...FALLBACK_REASONING_EFFORTS]
}

export const resolveSelectedEffort = (
  models: ModelOption[],
  model: string | null | undefined,
  preferredEffort?: ReasoningEffort | null
) => {
  const effortOptions = resolveEffortOptions(models, model)
  if (preferredEffort && effortOptions.includes(preferredEffort)) {
    return preferredEffort
  }

  const selectedModel = models.find(entry => entry.model === model)
  if (selectedModel && effortOptions.includes(selectedModel.defaultReasoningEffort)) {
    return selectedModel.defaultReasoningEffort
  }

  return effortOptions[0] ?? 'medium'
}

export const coercePromptSelection = (
  models: ModelOption[],
  preferredModel?: string | null,
  preferredEffort?: ReasoningEffort | null
) => {
  const nextModel = resolveSelectedModel(models, preferredModel)
  return {
    model: nextModel,
    effort: resolveSelectedEffort(models, nextModel, preferredEffort)
  }
}

export const normalizeConfigDefaults = (value: unknown) => {
  const config = isObjectRecord(value) && isObjectRecord(value.config)
    ? value.config
    : null

  return {
    model: typeof config?.model === 'string' ? config.model : null,
    effort: isReasoningEffort(config?.model_reasoning_effort) ? config.model_reasoning_effort : null,
    contextWindow: toFiniteNumber(config?.model_context_window)
  }
}

export const normalizeThreadTokenUsage = (value: unknown): TokenUsageSnapshot | null => {
  const params = isObjectRecord(value) ? value : null
  const tokenUsage = isObjectRecord(params?.tokenUsage) ? params.tokenUsage : null
  if (!tokenUsage) {
    return null
  }

  const total = isObjectRecord(tokenUsage.total) ? tokenUsage.total : {}
  const last = isObjectRecord(tokenUsage.last) ? tokenUsage.last : null

  return {
    totalTokens: toFiniteNumber(total.totalTokens),
    totalInputTokens: toFiniteNumber(total.inputTokens) ?? 0,
    totalCachedInputTokens: toFiniteNumber(total.cachedInputTokens) ?? 0,
    totalOutputTokens: toFiniteNumber(total.outputTokens) ?? 0,
    lastUsageKnown: last !== null,
    lastTotalTokens: toFiniteNumber(last?.totalTokens),
    lastInputTokens: toFiniteNumber(last?.inputTokens) ?? 0,
    lastCachedInputTokens: toFiniteNumber(last?.cachedInputTokens) ?? 0,
    lastOutputTokens: toFiniteNumber(last?.outputTokens) ?? 0,
    modelContextWindow: toFiniteNumber(tokenUsage.modelContextWindow)
  }
}

export const buildTurnOverrides = (
  model: string | null | undefined,
  effort: ReasoningEffort | null | undefined
) => {
  const overrides: {
    model?: string
    effort?: ReasoningEffort
  } = {}

  if (model) {
    overrides.model = model
  }

  if (effort) {
    overrides.effort = effort
  }

  return overrides
}

export const formatReasoningEffortLabel = (value: ReasoningEffort) => {
  switch (value) {
    case 'xhigh':
      return 'Very high'
    case 'none':
      return 'None'
    default:
      return value.charAt(0).toUpperCase() + value.slice(1)
  }
}

export const formatCompactTokenCount = (value: number) => {
  if (value < 1000) {
    return String(value)
  }

  const short = value / 1000
  const rounded = short >= 10 ? short.toFixed(0) : short.toFixed(1)
  return `${rounded.replace(/\\.0$/, '')}k`
}

export const resolveContextWindowState = (
  tokenUsage: TokenUsageSnapshot | null,
  fallbackContextWindow: number | null
): ContextWindowState => {
  const contextWindow = tokenUsage?.modelContextWindow ?? fallbackContextWindow
  // App-server exposes cumulative thread totals separately; the latest turn total
  // is the closest match to current context occupancy.
  const usedTokens = tokenUsage
    ? tokenUsage.lastTotalTokens ?? (tokenUsage.lastUsageKnown
        ? tokenUsage.lastInputTokens + tokenUsage.lastOutputTokens
        : null)
    : null

  if (!contextWindow || usedTokens == null) {
    return {
      contextWindow,
      usedTokens,
      remainingTokens: null,
      usedPercent: null,
      remainingPercent: null
    }
  }

  const cappedUsedTokens = Math.max(0, Math.min(contextWindow, usedTokens))
  const usedPercent = Math.max(0, Math.min(100, (cappedUsedTokens / contextWindow) * 100))

  return {
    contextWindow,
    usedTokens: cappedUsedTokens,
    remainingTokens: Math.max(0, contextWindow - cappedUsedTokens),
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent)
  }
}

export const shouldShowContextWindowIndicator = (state: ContextWindowState) =>
  state.contextWindow !== null && state.usedTokens !== null
