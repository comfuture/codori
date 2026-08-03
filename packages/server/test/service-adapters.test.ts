import { describe, expect, it } from 'vitest'
import {
  createDarwinServiceDefinition,
  createLinuxServiceDefinition,
  createWindowsServiceDefinition,
  getDarwinInstallCommands,
  getDarwinRestartCommands,
  getDarwinServiceName,
  getDarwinStartCommands,
  getDarwinStopCommands,
  getDarwinUninstallCommands,
  getLinuxInstallCommands,
  getLinuxRestartCommands,
  getLinuxServiceName,
  getLinuxStartCommands,
  getLinuxStopCommands,
  getLinuxUninstallCommands,
  getWindowsInstallCommands,
  getWindowsServiceName,
  getWindowsStartCommands,
  getWindowsStopCommands,
  getWindowsUninstallCommands,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTaskXml,
  resolveServicePlatform
} from '../src/service-adapters.js'

describe('service adapters', () => {
  it('resolves supported service platforms', () => {
    expect(resolveServicePlatform('darwin')).toBe('darwin')
    expect(resolveServicePlatform('linux')).toBe('linux')
    expect(resolveServicePlatform('win32')).toBe('win32')
    expect(() => resolveServicePlatform('aix')).toThrow(/Unsupported service platform/)
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
    // systemd does not strip quotes from WorkingDirectory=; it treats them as
    // part of the path and rejects the unit with `path is not absolute`, which
    // made every generated unit unloadable. The value takes a raw path, so only
    // `%` is escaped. ExecStart= is a command line and still needs its quotes.
    expect(unit).toContain('WorkingDirectory=/home/test/My $Projects\n')
    expect(unit).not.toContain('WorkingDirectory="')
    expect(unit).toContain('ExecStart="/home/test/My $$Projects/.codori/%%services/abc/run-service.sh"')
    expect(unit).toContain('WantedBy=default.target')
  })

  it('escapes a percent in the systemd working directory without quoting it', () => {
    const unit = renderSystemdUnit({
      serviceName: 'codori-pct.service',
      launcherPath: '/home/test/%root/.codori/services/abc/run-service.sh',
      root: '/home/test/%root'
    })

    // systemd expands `%` specifiers in this value, so it stays escaped even
    // though the path is unquoted. Verified on systemd 249: a unit with
    // `WorkingDirectory=/tmp/cd probe/%%dir` starts and resolves to `%dir`.
    expect(unit).toContain('WorkingDirectory=/home/test/%%root\n')
  })

  // systemd validates WorkingDirectory= as an absolute path after `%` expansion
  // and without any quote removal. This asserts the rule directly, so a future
  // change that re-quotes the value fails here instead of on a Linux host.
  it.each([
    ['/home/test/workspaces'],
    ['/home/test/My Projects'],
    ['/home/test/%root']
  ])('renders a loadable systemd working directory for %s', (root) => {
    const unit = renderSystemdUnit({
      serviceName: 'codori-load.service',
      launcherPath: `${root}/.codori/services/abc/run-service.sh`,
      root
    })

    const workingDirectory = unit
      .split('\n')
      .find(line => line.startsWith('WorkingDirectory='))
      ?.slice('WorkingDirectory='.length)

    expect(workingDirectory).toBeDefined()
    expect(workingDirectory?.startsWith('"')).toBe(false)
    // What systemd resolves after collapsing `%%` back to a literal `%`.
    expect((workingDirectory as string).replaceAll('%%', '%')).toBe(root)
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
      // Must precede bootstrap: a prior uninstall leaves a persistent disabled
      // override that makes bootstrap fail with "Input/output error".
      {
        command: 'launchctl',
        args: ['enable', 'gui/501/io.codori.server.abc123def456']
      },
      {
        command: 'launchctl',
        args: ['bootstrap', 'gui/501', definition.serviceFilePath]
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

    // KeepAlive restarts the process after a signal, so stopping must boot the
    // service out instead of killing it.
    expect(getDarwinStopCommands(definition, 'user', 501)).toEqual([
      {
        command: 'launchctl',
        args: ['bootout', 'gui/501', definition.serviceFilePath]
      }
    ])
    expect(getDarwinStartCommands(definition, 'user', 501)).toEqual([
      {
        command: 'launchctl',
        args: ['enable', 'gui/501/io.codori.server.abc123def456']
      },
      {
        command: 'launchctl',
        args: ['bootstrap', 'gui/501', definition.serviceFilePath]
      },
      {
        command: 'launchctl',
        args: ['kickstart', 'gui/501/io.codori.server.abc123def456']
      }
    ])
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

    // systemctl stop overrides Restart=always, so no bootout equivalent is needed.
    expect(getLinuxStopCommands(definition, 'user')).toEqual([
      {
        command: 'systemctl',
        args: ['--user', 'stop', 'codori-abc123def456.service']
      }
    ])
    expect(getLinuxStartCommands(definition, 'user')).toEqual([
      {
        command: 'systemctl',
        args: ['--user', 'start', 'codori-abc123def456.service']
      }
    ])
  })

  it('renders a windows logon task for user scope', () => {
    const xml = renderWindowsTaskXml({
      serviceName: 'Codori\\codori-abc123def456',
      launcherPath: 'C:\\Users\\test\\.codori\\services\\abc\\run-service.cmd',
      root: 'C:\\Users\\test\\Project',
      scope: 'user',
      principalId: 'test'
    })

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-16"?>')
    expect(xml).toContain('<LogonTrigger>')
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>')
    expect(xml).toContain('<Command>C:\\Users\\test\\.codori\\services\\abc\\run-service.cmd</Command>')
    expect(xml).toContain('<WorkingDirectory>C:\\Users\\test\\Project</WorkingDirectory>')
    // Windows has no launchd KeepAlive or systemd Restart=always equivalent.
    expect(xml).toContain('<RestartOnFailure>')
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(xml).not.toContain('<BootTrigger>')
  })

  it('renders a windows boot task running as SYSTEM for system scope', () => {
    const xml = renderWindowsTaskXml({
      serviceName: 'Codori\\codori-abc123def456',
      launcherPath: 'C:\\ProgramData\\codori\\run-service.cmd',
      root: 'C:\\Projects',
      scope: 'system',
      principalId: 'S-1-5-18'
    })

    expect(xml).toContain('<BootTrigger>')
    expect(xml).toContain('<UserId>S-1-5-18</UserId>')
    expect(xml).toContain('<RunLevel>HighestAvailable</RunLevel>')
    expect(xml).not.toContain('<LogonTrigger>')
  })

  it('escapes xml-sensitive characters in windows task definitions', () => {
    const xml = renderWindowsTaskXml({
      serviceName: 'Codori\\codori-abc',
      launcherPath: 'C:\\a & b\\run-service.cmd',
      root: 'C:\\<root>',
      scope: 'user',
      principalId: 'te"st'
    })

    expect(xml).toContain('<Command>C:\\a &amp; b\\run-service.cmd</Command>')
    expect(xml).toContain('<WorkingDirectory>C:\\&lt;root&gt;</WorkingDirectory>')
    expect(xml).toContain('<UserId>te&quot;st</UserId>')
  })

  it('creates a windows service definition and command sequences', () => {
    const definition = createWindowsServiceDefinition({
      installId: 'abc123def456',
      scope: 'user',
      launcherPath: 'C:\\Users\\test\\.codori\\services\\abc\\run-service.cmd',
      root: 'C:\\Users\\test\\Project',
      metadataDirectory: 'C:\\Users\\test\\.codori\\services\\abc',
      homeDir: 'C:\\Users\\test',
      userName: 'test'
    })

    expect(definition.serviceName).toBe(getWindowsServiceName('abc123def456'))
    expect(definition.serviceFileEncoding).toBe('utf16le')
    expect(definition.serviceFilePath).toContain('service-task.xml')

    expect(getWindowsInstallCommands(definition, 'user')).toEqual([
      {
        command: 'schtasks',
        args: ['/Delete', '/TN', definition.serviceName, '/F']
      },
      {
        command: 'schtasks',
        args: ['/Create', '/TN', definition.serviceName, '/XML', definition.serviceFilePath, '/F']
      },
      {
        command: 'schtasks',
        args: ['/Run', '/TN', definition.serviceName]
      }
    ])

    // A boot-triggered system task should not be kicked off from the installer session.
    expect(getWindowsInstallCommands(definition, 'system')).toHaveLength(2)

    expect(getWindowsStartCommands(definition)).toEqual([
      {
        command: 'schtasks',
        args: ['/Run', '/TN', definition.serviceName]
      }
    ])
    expect(getWindowsStopCommands(definition)).toEqual([
      {
        command: 'schtasks',
        args: ['/End', '/TN', definition.serviceName]
      }
    ])
    expect(getWindowsUninstallCommands(definition)).toEqual([
      {
        command: 'schtasks',
        args: ['/End', '/TN', definition.serviceName]
      },
      {
        command: 'schtasks',
        args: ['/Delete', '/TN', definition.serviceName, '/F']
      }
    ])
  })

  it('rejects a user-scoped windows definition without a resolvable user', () => {
    expect(() => createWindowsServiceDefinition({
      installId: 'abc123def456',
      scope: 'user',
      launcherPath: 'C:\\run-service.cmd',
      root: 'C:\\Projects',
      metadataDirectory: 'C:\\meta',
      userName: ''
    })).toThrow(/Unable to resolve the current Windows user/)
  })
})
