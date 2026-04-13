import os from 'node:os'
import { join } from 'node:path'
import type { ServicePlatform, ServiceScope } from './service.js'

export type ServiceCommand = {
  command: string
  args: string[]
}

export type ServiceUnitDefinition = {
  serviceName: string
  serviceFilePath: string
  serviceFileContents: string
}

export type ServiceUnitInput = {
  installId: string
  scope: ServiceScope
  launcherPath: string
  root: string
  metadataDirectory: string
  homeDir?: string
  userId?: number
}

const renderLaunchdArray = (values: string[]) =>
  values.map(value => `    <string>${escapeXml(value)}</string>`).join('\n')

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const getCurrentUserId = () => (typeof process.getuid === 'function' ? process.getuid() : 0)

const getLaunchctlDomain = (scope: ServiceScope, userId = getCurrentUserId()) =>
  scope === 'system' ? 'system' : `gui/${userId}`

const getSystemdPrefix = (scope: ServiceScope) =>
  scope === 'system' ? [] : ['--user']

export const resolveServicePlatform = (platform = process.platform): ServicePlatform => {
  if (platform === 'darwin' || platform === 'linux') {
    return platform
  }

  throw new Error(`Unsupported service platform "${platform}".`)
}

export const getDarwinServiceName = (installId: string) => `io.codori.server.${installId}`

export const getLinuxServiceName = (installId: string) => `codori-${installId}.service`

export const renderLaunchdPlist = ({ serviceName, launcherPath, root, metadataDirectory }: Omit<ServiceUnitDefinition, 'serviceFilePath' | 'serviceFileContents'> & {
  launcherPath: string
  root: string
  metadataDirectory: string
}) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '  <key>Label</key>',
  `  <string>${escapeXml(serviceName)}</string>`,
  '  <key>ProgramArguments</key>',
  '  <array>',
  renderLaunchdArray([launcherPath]),
  '  </array>',
  '  <key>RunAtLoad</key>',
  '  <true/>',
  '  <key>KeepAlive</key>',
  '  <true/>',
  '  <key>WorkingDirectory</key>',
  `  <string>${escapeXml(root)}</string>`,
  '  <key>StandardOutPath</key>',
  `  <string>${escapeXml(join(metadataDirectory, 'service.log'))}</string>`,
  '  <key>StandardErrorPath</key>',
  `  <string>${escapeXml(join(metadataDirectory, 'service.error.log'))}</string>`,
  '</dict>',
  '</plist>'
].join('\n')

export const renderSystemdUnit = ({ serviceName, launcherPath, root }: Omit<ServiceUnitDefinition, 'serviceFilePath' | 'serviceFileContents'> & {
  launcherPath: string
  root: string
}) => [
  '[Unit]',
  `Description=Codori service (${serviceName})`,
  'After=network.target',
  '',
  '[Service]',
  'Type=simple',
  `WorkingDirectory=${root}`,
  `ExecStart=${launcherPath}`,
  'Restart=always',
  'RestartSec=5',
  '',
  '[Install]',
  'WantedBy=default.target'
].join('\n')

export const createDarwinServiceDefinition = ({
  installId,
  scope,
  launcherPath,
  root,
  metadataDirectory,
  homeDir = os.homedir()
}: ServiceUnitInput): ServiceUnitDefinition => {
  const serviceName = getDarwinServiceName(installId)
  const serviceFilePath = scope === 'system'
    ? join('/Library/LaunchDaemons', `${serviceName}.plist`)
    : join(homeDir, 'Library', 'LaunchAgents', `${serviceName}.plist`)

  return {
    serviceName,
    serviceFilePath,
    serviceFileContents: renderLaunchdPlist({
      serviceName,
      launcherPath,
      root,
      metadataDirectory
    })
  }
}

export const createLinuxServiceDefinition = ({
  installId,
  scope,
  launcherPath,
  root,
  homeDir = os.homedir()
}: ServiceUnitInput): ServiceUnitDefinition => {
  const serviceName = getLinuxServiceName(installId)
  const serviceFilePath = scope === 'system'
    ? join('/etc/systemd/system', serviceName)
    : join(homeDir, '.config', 'systemd', 'user', serviceName)

  return {
    serviceName,
    serviceFilePath,
    serviceFileContents: renderSystemdUnit({
      serviceName,
      launcherPath,
      root
    })
  }
}

export const getDarwinInstallCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope,
  userId = getCurrentUserId()
): ServiceCommand[] => {
  const domain = getLaunchctlDomain(scope, userId)
  return [
    {
      command: 'launchctl',
      args: ['bootout', domain, definition.serviceFilePath]
    },
    {
      command: 'launchctl',
      args: ['bootstrap', domain, definition.serviceFilePath]
    },
    {
      command: 'launchctl',
      args: ['enable', `${domain}/${definition.serviceName}`]
    },
    {
      command: 'launchctl',
      args: ['kickstart', '-k', `${domain}/${definition.serviceName}`]
    }
  ]
}

export const getDarwinRestartCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope,
  userId = getCurrentUserId()
): ServiceCommand[] => {
  const domain = getLaunchctlDomain(scope, userId)
  return [
    {
      command: 'launchctl',
      args: ['bootout', domain, definition.serviceFilePath]
    },
    {
      command: 'launchctl',
      args: ['bootstrap', domain, definition.serviceFilePath]
    },
    {
      command: 'launchctl',
      args: ['kickstart', '-k', `${domain}/${definition.serviceName}`]
    }
  ]
}

export const getDarwinUninstallCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope,
  userId = getCurrentUserId()
): ServiceCommand[] => {
  const domain = getLaunchctlDomain(scope, userId)
  return [
    {
      command: 'launchctl',
      args: ['bootout', domain, definition.serviceFilePath]
    },
    {
      command: 'launchctl',
      args: ['disable', `${domain}/${definition.serviceName}`]
    }
  ]
}

export const getLinuxInstallCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => {
  const prefix = getSystemdPrefix(scope)
  return [
    {
      command: 'systemctl',
      args: [...prefix, 'daemon-reload']
    },
    {
      command: 'systemctl',
      args: [...prefix, 'enable', '--now', definition.serviceName]
    }
  ]
}

export const getLinuxRestartCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => {
  const prefix = getSystemdPrefix(scope)
  return [
    {
      command: 'systemctl',
      args: [...prefix, 'daemon-reload']
    },
    {
      command: 'systemctl',
      args: [...prefix, 'restart', definition.serviceName]
    }
  ]
}

export const getLinuxUninstallCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => {
  const prefix = getSystemdPrefix(scope)
  return [
    {
      command: 'systemctl',
      args: [...prefix, 'disable', '--now', definition.serviceName]
    },
    {
      command: 'systemctl',
      args: [...prefix, 'daemon-reload']
    }
  ]
}
