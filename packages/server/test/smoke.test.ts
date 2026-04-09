import { describe, expect, it } from 'vitest'
import { codoriServerVersion } from '../src/index.js'

describe('server package', () => {
  it('exports a version string', () => {
    expect(codoriServerVersion).toBe('0.1.0')
  })
})

