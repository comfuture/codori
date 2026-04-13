import { describe, expect, it } from 'vitest'
import {
  createDarwinServiceDefinition,
  createLinuxServiceDefinition,
  getDarwinInstallCommands,
  getDarwinRestartCommands,
  getDarwinServiceName,
  getDarwinUninstallCommands,
  getLinuxInstallCommands,
  getLinuxRestartCommands,
  getLinuxServiceName,
  getLinuxUninstallCommands,
  renderLaunchdPlist,
  renderSystemdUnit,
  resolveServicePlatform
} from '../src/service-adapters.js'

describe('service adapters', () => {
  it('resolves supported service platforms', () => {
    expect(resolveServicePlatform('darwin')).toBe('darwin')
    expect(resolveServicePlatform('linux')).toBe('linux')
    expect(() => resolveServicePlatform('win32')).toThrow(/Unsupported service platform/)
  })

  it('renders a launchd plist for macOS services', () => {
    const plist = renderLaunchdPlist({
      serviceName: 'io.codori.server.abc123def456',
      launcherPath: '/Users/test/.codori/services/abc/run-service.sh',
      root: '/Users/test/Project',
      metadataDirectory: '/Users/test/.codori/services/abc'
    })

    expect(plist).toContain('<key>Label</key>')
    expect(plist).toContain('<string>io.codori.server.abc123def456</string>')
    expect(plist).toContain('<string>/Users/test/.codori/services/abc/run-service.sh</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
  })

  it('renders a systemd unit for linux services', () => {
    const unit = renderSystemdUnit({
      serviceName: 'codori-abc123def456.service',
      launcherPath: '/home/test/My $Projects/.codori/%services/abc/run-service.sh',
      root: '/home/test/My $Projects'
    })

    expect(unit).toContain('Description=Codori service (codori-abc123def456.service)')
    expect(unit).toContain('WorkingDirectory="/home/test/My $Projects"')
    expect(unit).toContain('ExecStart="/home/test/My $$Projects/.codori/%%services/abc/run-service.sh"')
    expect(unit).toContain('WantedBy=default.target')
  })

  it('creates a macOS service definition and command sequences', () => {
    const definition = createDarwinServiceDefinition({
      installId: 'abc123def456',
      scope: 'user',
      launcherPath: '/Users/test/.codori/services/abc/run-service.sh',
      root: '/Users/test/Project',
      metadataDirectory: '/Users/test/.codori/services/abc',
      homeDir: '/Users/test'
    })

    expect(definition.serviceName).toBe(getDarwinServiceName('abc123def456'))
    expect(definition.serviceFilePath).toBe(
      '/Users/test/Library/LaunchAgents/io.codori.server.abc123def456.plist'
    )
    expect(getDarwinInstallCommands(definition, 'user', 501)).toEqual([
      {
        command: 'launchctl',
        args: ['bootout', 'gui/501', definition.serviceFilePath]
      },
      {
        command: 'launchctl',
        args: ['bootstrap', 'gui/501', definition.serviceFilePath]
      },
      {
        command: 'launchctl',
        args: ['enable', 'gui/501/io.codori.server.abc123def456']
      },
      {
        command: 'launchctl',
        args: ['kickstart', '-k', 'gui/501/io.codori.server.abc123def456']
      }
    ])
    expect(getDarwinRestartCommands(definition, 'user', 501)[0]).toEqual({
      command: 'launchctl',
      args: ['bootout', 'gui/501', definition.serviceFilePath]
    })
    expect(getDarwinUninstallCommands(definition, 'user', 501)[1]).toEqual({
      command: 'launchctl',
      args: ['disable', 'gui/501/io.codori.server.abc123def456']
    })
  })

  it('creates a linux service definition and command sequences', () => {
    const definition = createLinuxServiceDefinition({
      installId: 'abc123def456',
      scope: 'user',
      launcherPath: '/home/test/.codori/services/abc/run-service.sh',
      root: '/home/test/Project',
      metadataDirectory: '/home/test/.codori/services/abc',
      homeDir: '/home/test'
    })

    expect(definition.serviceName).toBe(getLinuxServiceName('abc123def456'))
    expect(definition.serviceFilePath).toBe(
      '/home/test/.config/systemd/user/codori-abc123def456.service'
    )
    expect(getLinuxInstallCommands(definition, 'user')).toEqual([
      {
        command: 'systemctl',
        args: ['--user', 'daemon-reload']
      },
      {
        command: 'systemctl',
        args: ['--user', 'enable', '--now', 'codori-abc123def456.service']
      }
    ])
    expect(getLinuxRestartCommands(definition, 'system')).toEqual([
      {
        command: 'systemctl',
        args: ['daemon-reload']
      },
      {
        command: 'systemctl',
        args: ['restart', 'codori-abc123def456.service']
      }
    ])
    expect(getLinuxUninstallCommands(definition, 'user')).toEqual([
      {
        command: 'systemctl',
        args: ['--user', 'disable', '--now', 'codori-abc123def456.service']
      },
      {
        command: 'systemctl',
        args: ['--user', 'daemon-reload']
      }
    ])
  })
})
