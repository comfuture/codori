import { describe, expect, it } from 'vitest'
import { resolveProjectDisplayName } from '../shared/codori'

describe('project display names', () => {
  it('prefers a trimmed project name over the opaque project id', () => {
    expect(resolveProjectDisplayName({
      projectId: '01a04cb0-6813-7112-ad01-11a673b615d9',
      projectName: '  codori  '
    })).toBe('codori')
  })

  it('uses the project id only when the project has no usable name', () => {
    expect(resolveProjectDisplayName({
      projectId: '01a04cb0-6813-7112-ad01-11a673b615d9',
      projectName: '   '
    })).toBe('01a04cb0-6813-7112-ad01-11a673b615d9')
    expect(resolveProjectDisplayName(null, 'Loading project')).toBe('Loading project')
  })
})
