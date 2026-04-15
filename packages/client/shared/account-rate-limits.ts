export type RateLimitWindow = {
  usedPercent: number | null
  resetsAt: string | null
  windowDurationMins: number | null
}

export type RateLimitBucket = {
  limitId: string
  limitName: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

const toPercent = (value: unknown) => {
  const parsed = toFiniteNumber(value)
  if (parsed == null) {
    return null
  }

  const normalized = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed
  return Math.max(0, Math.min(100, normalized))
}

const toTimestamp = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  return Number.isNaN(Date.parse(value)) ? null : value
}

const normalizeRateLimitWindow = (value: unknown): RateLimitWindow | null => {
  const record = isObjectRecord(value) ? value : null
  if (!record) {
    return null
  }

  const usedPercent = toPercent(record.usedPercent)
  const resetsAt = toTimestamp(record.resetsAt)
  const windowDurationMins = toFiniteNumber(record.windowDurationMins)

  if (usedPercent == null && resetsAt == null && windowDurationMins == null) {
    return null
  }

  return {
    usedPercent,
    resetsAt,
    windowDurationMins
  }
}

const normalizeRateLimitBucket = (value: unknown): RateLimitBucket | null => {
  const record = isObjectRecord(value) ? value : null
  if (!record) {
    return null
  }

  const limitId = typeof record.limitId === 'string' && record.limitId.trim()
    ? record.limitId.trim()
    : null
  const limitName = typeof record.limitName === 'string' && record.limitName.trim()
    ? record.limitName.trim()
    : null

  if (!limitId && !limitName) {
    return null
  }

  const primary = normalizeRateLimitWindow(record.primary)
  const secondary = normalizeRateLimitWindow(record.secondary)
  if (!primary && !secondary) {
    return null
  }

  return {
    limitId: limitId ?? limitName ?? 'unknown',
    limitName,
    primary,
    secondary
  }
}

const collectRateLimitCandidates = (value: unknown) => {
  const root = isObjectRecord(value) ? value : null
  const rateLimits = Array.isArray(root?.rateLimits) ? root.rateLimits : []
  const rateLimitsByLimitId = isObjectRecord(root?.rateLimitsByLimitId)
    ? Object.values(root.rateLimitsByLimitId)
    : []

  if (rateLimits.length > 0 || rateLimitsByLimitId.length > 0) {
    return [...rateLimits, ...rateLimitsByLimitId]
  }

  return Array.isArray(value) ? value : []
}

export const normalizeAccountRateLimits = (value: unknown): RateLimitBucket[] => {
  const bucketsById = new Map<string, RateLimitBucket>()

  for (const candidate of collectRateLimitCandidates(value)) {
    const bucket = normalizeRateLimitBucket(candidate)
    if (!bucket) {
      continue
    }

    const existing = bucketsById.get(bucket.limitId)
    if (!existing) {
      bucketsById.set(bucket.limitId, bucket)
      continue
    }

    bucketsById.set(bucket.limitId, {
      ...existing,
      limitName: existing.limitName ?? bucket.limitName,
      primary: existing.primary ?? bucket.primary,
      secondary: existing.secondary ?? bucket.secondary
    })
  }

  return [...bucketsById.values()].sort((left, right) => {
    const leftLabel = (left.limitName ?? left.limitId).toLowerCase()
    const rightLabel = (right.limitName ?? right.limitId).toLowerCase()
    return leftLabel.localeCompare(rightLabel)
  })
}

export const formatRateLimitWindowDuration = (value: number | null) => {
  if (value == null || value <= 0) {
    return null
  }

  if (value % (60 * 24 * 7) === 0) {
    const weeks = value / (60 * 24 * 7)
    return `${weeks}w window`
  }

  if (value % (60 * 24) === 0) {
    const days = value / (60 * 24)
    return `${days}d window`
  }

  if (value % 60 === 0) {
    const hours = value / 60
    return `${hours}h window`
  }

  return `${value}m window`
}
