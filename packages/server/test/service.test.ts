import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detectRootPromptDefault,
  getServiceLauncherPath,
  getServiceMetadataDirectory,
  getServiceMetadataPath,
  parseServicePort,
  resolveDefaultServicePort,
  resolveServiceScope,
  toServiceInstallId
} from '../src/service.js'

describe('service helpers', () => {
  it('creates a stable install id from the resolved root path', () => {
    const installId = toServiceInstallId('/tmp/demo/../demo')

    expect(installId).toMatch(/^[a-f0-9]{12}$/)
    expect(installId).toBe(toServiceInstallId('/tmp/demo'))
  })

  it('builds service metadata paths under the codori home directory', () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const installId = 'abc123def456'

    expect(getServiceMetadataDirectory(installId, homeDir)).toBe(
      join(homeDir, '.codori', 'services', installId)
    )
    expect(getServiceMetadataPath(installId, homeDir)).toBe(
      join(homeDir, '.codori', 'services', installId, 'service.json')
    )
    expect(getServiceLauncherPath(installId, homeDir)).toBe(
      join(homeDir, '.codori', 'services', installId, 'run-service.sh')
    )
  })

  it('uses the cwd as the default root when it is a git repository', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    expect(detectRootPromptDefault(root)).toEqual({
      value: root,
      reason: 'git',
      shouldConfirm: true
    })
  })

  it('uses the cwd as the default root when workspace markers are present', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')

    expect(detectRootPromptDefault(root)).toEqual({
      value: root,
      reason: 'workspace-marker',
      shouldConfirm: true
    })
  })

  it('uses the cwd as the default root when nested git projects exist', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true })

    expect(detectRootPromptDefault(root)).toEqual({
      value: root,
      reason: 'nested-git-projects',
      shouldConfirm: true
    })
  })

  it('returns no default root when the cwd does not look like a project root', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))

    expect(detectRootPromptDefault(root)).toEqual({
      value: null,
      reason: 'none',
      shouldConfirm: false
    })
  })

  it('defaults the service scope to user and accepts explicit scopes', () => {
    expect(resolveServiceScope(undefined)).toBe('user')
    expect(resolveServiceScope('user')).toBe('user')
    expect(resolveServiceScope('system')).toBe('system')
  })

  it('rejects unsupported service scopes', () => {
    expect(() => resolveServiceScope('team')).toThrow(/Unsupported service scope/)
  })

  it('parses valid service ports and rejects invalid ones', () => {
    expect(parseServicePort(undefined)).toBeUndefined()
    expect(parseServicePort('4310')).toBe(4310)
    expect(parseServicePort(9000)).toBe(9000)
    expect(() => parseServicePort('0')).toThrow(/Invalid service port/)
    expect(() => parseServicePort('70000')).toThrow(/Invalid service port/)
    expect(() => parseServicePort('abc')).toThrow(/Invalid service port/)
  })

  it('falls back to the default service port when one is not provided', () => {
    expect(resolveDefaultServicePort(undefined)).toBe(4310)
    expect(resolveDefaultServicePort(8080)).toBe(8080)
  })
})
