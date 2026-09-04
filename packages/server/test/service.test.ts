import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLauncherScript,
  detectRootPromptDefault,
  getServiceLauncherPath,
  getServiceMetadataDirectory,
  getServiceMetadataPath,
  getWildcardHostWarning,
  parseServicePort,
  resolveHostPromptDefault,
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

  it('uses the safe loopback host by default', async () => {
    const hostDefault = await resolveHostPromptDefault(undefined)

    expect(hostDefault).toEqual({
      value: '127.0.0.1',
      source: 'loopback',
      warning: null
    })
  })

  it('retains explicit hosts and warns on explicit wildcard hosts', async () => {
    await expect(resolveHostPromptDefault('127.0.0.1')).resolves.toEqual({
      value: '127.0.0.1',
      source: 'explicit',
      warning: null
    })
    await expect(resolveHostPromptDefault('0.0.0.0')).resolves.toEqual({
      value: '0.0.0.0',
      source: 'explicit',
      warning: getWildcardHostWarning()
    })
  })

  it('builds a launcher script that pins the managed bundle bootstrap without npx', () => {
    const script = buildLauncherScript({
      installId: 'abc123def456',
      root: '/tmp/workspace',
      host: '100.64.0.10',
      port: 4310,
      scope: 'user',
      nodePath: '/opt/node/bin/node',
      bootstrapPath: '/tmp/service/launch-service.cjs',
      tailscaleServePolicy: 'disabled'
    })

    expect(script).toContain('#!/bin/sh')
    expect(script).toContain("export PATH='/opt/node/bin':$PATH")
    expect(script).toContain('export CODORI_SERVICE_MANAGED=1')
    expect(script).toContain("export CODORI_SERVICE_INSTALL_ID='abc123def456'")
    expect(script).toContain("export CODORI_SERVICE_SCOPE='user'")
    // The install-time root travels as an env fallback rather than `--root`, so a
    // root changed from Settings is not overridden on the next managed launch.
    expect(script).toContain("export CODORI_SERVICE_INSTALL_ROOT='/tmp/workspace'")
    expect(script).not.toContain('--root')
    expect(script).toContain("exec '/opt/node/bin/node' '/tmp/service/launch-service.cjs' start --host '100.64.0.10' --port 4310 --no-tailscale-serve")
    expect(script).not.toContain('npx')
    // A user-scoped service resolves the same home at runtime.
    expect(script).not.toContain('CODORI_SERVICE_HOME')
  })

  it('carries the metadata home for a system-scoped launcher', () => {
    const script = buildLauncherScript({
      installId: 'abc123def456',
      root: '/tmp/workspace',
      host: '127.0.0.1',
      port: 4310,
      scope: 'system',
      nodePath: '/opt/node/bin/node',
      bootstrapPath: '/tmp/service/launch-service.cjs',
      homeDir: '/Users/installer'
    })

    expect(script).toContain("export CODORI_SERVICE_HOME='/Users/installer'")
  })
})
