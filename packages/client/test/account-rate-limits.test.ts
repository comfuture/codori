import { describe, expect, it } from 'vitest'
import { mergeAccountRateLimits, normalizeAccountRateLimits } from '../shared/account-rate-limits'
import type { GetAccountRateLimitsResponse } from '../shared/generated/codex-app-server/v2/GetAccountRateLimitsResponse'
import type { RateLimitSnapshot } from '../shared/generated/codex-app-server/v2/RateLimitSnapshot'

const snapshot = (overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot => ({
  limitId: null,
  limitName: null,
  normalModelSlug: null,
  primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1_800_000_000 },
  secondary: null,
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: null,
  rateLimitReachedType: null,
  ...overrides
})

describe('account rate limit protocol', () => {
  it('reads numeric Unix reset times and percentage points from the generated response', () => {
    const value: GetAccountRateLimitsResponse = {
      ordinaryUsageAllowed: false,
      rateLimits: snapshot(),
      rateLimitsByLimitId: { codex: snapshot({ primary: {
        usedPercent: 0.5,
        windowDurationMins: 300,
        resetsAt: 1_800_000_000
      } }) },
      rateLimitResetCredits: null,
      accountId: null,
      rateLimitUpsell: null
    }

    expect(normalizeAccountRateLimits(value)).toEqual([{
      limitId: 'codex',
      limitName: null,
      primary: {
        usedPercent: 0.5,
        windowDurationMins: 300,
        resetsAt: '2027-01-15T08:00:00.000Z'
      },
      secondary: null
    }])
    expect(normalizeAccountRateLimits({ rateLimits: snapshot() })[0]?.primary?.usedPercent).toBe(1)
  })

  it('uses map keys when bucket identifiers are unavailable and rejects invalid timestamps', () => {
    expect(normalizeAccountRateLimits({ rateLimitsByLimitId: { review: snapshot({
      primary: { usedPercent: 50, windowDurationMins: null, resetsAt: 1e30 }
    }) } })).toMatchObject([{
      limitId: 'review',
      primary: { usedPercent: 50, resetsAt: null }
    }])
  })

  it('keeps legacy named array buckets separate when their identifiers are absent', () => {
    expect(normalizeAccountRateLimits([
      snapshot({ limitName: 'Codex' }),
      snapshot({ limitName: 'Review' })
    ]).map(bucket => bucket.limitId)).toEqual(['Codex', 'Review'])
  })

  it('retains known windows while merging sparse notifications without rescaling percentages', () => {
    const current = normalizeAccountRateLimits({ rateLimits: snapshot() })
    expect(mergeAccountRateLimits(current, { rateLimits: {
      limitId: null,
      limitName: null,
      primary: { usedPercent: 0.25, resetsAt: null, windowDurationMins: null }
    } })).toMatchObject([{
      limitId: 'codex',
      primary: {
        usedPercent: 0.25,
        resetsAt: '2027-01-15T08:00:00.000Z',
        windowDurationMins: 300
      }
    }])
  })
})
