import { describe, expect, it } from 'vitest'
import { formatPlaceholderProject } from '../shared/placeholder.js'

describe('client package', () => {
  it('formats placeholder labels', () => {
    expect(formatPlaceholderProject('codori')).toBe('project:codori')
  })
})
