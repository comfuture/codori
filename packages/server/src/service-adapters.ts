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
  serviceFileEncoding?: BufferEncoding
}

export type ServiceUnitInput = {
  installId: string
  scope: ServiceScope
  launcherPath: string
  root: string
  metadataDirectory: string
  homeDir?: string
  userId?: number
  userName?: string
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

const WINDOWS_SYSTEM_ACCOUNT_SID = 'S-1-5-18'

const getCurrentUserName = (env: NodeJS.ProcessEnv = process.env) =>
  env.USERNAME?.trim() || env.USER?.trim() || ''

const quoteSystemdPathValue = (value: string) =>
  `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')}"`

const quoteSystemdExecValue = (value: string) =>
  quoteSystemdPathValue(value).replaceAll('$', '$$$$')

export const resolveServicePlatform = (platform = process.platform): ServicePlatform => {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return platform
  }

  throw new Error(`Unsupported service platform "${platform}".`)
}

export const getDarwinServiceName = (installId: string) => `io.codori.server.${installId}`

export const getLinuxServiceName = (installId: string) => `codori-${installId}.service`

export const getWindowsServiceName = (installId: string) => `Codori\\codori-${installId}`

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
  `WorkingDirectory=${quoteSystemdPathValue(root)}`,
  `ExecStart=${quoteSystemdExecValue(launcherPath)}`,
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

export const renderWindowsTaskXml = ({
  serviceName,
  launcherPath,
  root,
  scope,
  principalId
}: {
  serviceName: string
  launcherPath: string
  root: string
  scope: ServiceScope
  principalId: string
}) => {
  const principal = scope === 'system'
    ? [
        `      <UserId>${escapeXml(WINDOWS_SYSTEM_ACCOUNT_SID)}</UserId>`,
        '      <RunLevel>HighestAvailable</RunLevel>'
      ]
    : [
        `      <UserId>${escapeXml(principalId)}</UserId>`,
        '      <LogonType>InteractiveToken</LogonType>',
        '      <RunLevel>LeastPrivilege</RunLevel>'
      ]

  const trigger = scope === 'system'
    ? [
        '    <BootTrigger>',
        '      <Enabled>true</Enabled>',
        '    </BootTrigger>'
      ]
    : [
        '    <LogonTrigger>',
        '      <Enabled>true</Enabled>',
        `      <UserId>${escapeXml(principalId)}</UserId>`,
        '    </LogonTrigger>'
      ]

  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>Codori service (${escapeXml(serviceName)})</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    ...trigger,
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    ...principal,
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings>',
    '      <StopOnIdleEnd>false</StopOnIdleEnd>',
    '      <RestartOnIdle>false</RestartOnIdle>',
    '    </IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>',
    '    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>',
    '    <WakeToRun>false</WakeToRun>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>7</Priority>',
    '    <RestartOnFailure>',
    '      <Interval>PT1M</Interval>',
    '      <Count>999</Count>',
    '    </RestartOnFailure>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${escapeXml(launcherPath)}</Command>`,
    `      <WorkingDirectory>${escapeXml(root)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>'
  ].join('\r\n')
}

export const createWindowsServiceDefinition = ({
  installId,
  scope,
  launcherPath,
  root,
  metadataDirectory,
  userName = getCurrentUserName()
}: ServiceUnitInput): ServiceUnitDefinition => {
  const serviceName = getWindowsServiceName(installId)
  const principalId = scope === 'system' ? WINDOWS_SYSTEM_ACCOUNT_SID : userName

  if (scope === 'user' && !principalId) {
    throw new Error('Unable to resolve the current Windows user for a user-scoped Codori service.')
  }

  return {
    serviceName,
    serviceFilePath: join(metadataDirectory, 'service-task.xml'),
    serviceFileContents: renderWindowsTaskXml({
      serviceName,
      launcherPath,
      root,
      scope,
      principalId
    }),
    serviceFileEncoding: 'utf16le'
  }
}

export const getWindowsInstallCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => [
  {
    command: 'schtasks',
    args: ['/Delete', '/TN', definition.serviceName, '/F']
  },
  {
    command: 'schtasks',
    args: ['/Create', '/TN', definition.serviceName, '/XML', definition.serviceFilePath, '/F']
  },
  ...(scope === 'system' ? [] : [{
    command: 'schtasks',
    args: ['/Run', '/TN', definition.serviceName]
  }])
]

export const getWindowsStartCommands = (
  definition: ServiceUnitDefinition
): ServiceCommand[] => [
  {
    command: 'schtasks',
    args: ['/Run', '/TN', definition.serviceName]
  }
]

export const getWindowsStopCommands = (
  definition: ServiceUnitDefinition
): ServiceCommand[] => [
  {
    command: 'schtasks',
    args: ['/End', '/TN', definition.serviceName]
  }
]

export const getWindowsRestartCommands = (
  definition: ServiceUnitDefinition
): ServiceCommand[] => [
  {
    command: 'schtasks',
    args: ['/Create', '/TN', definition.serviceName, '/XML', definition.serviceFilePath, '/F']
  },
  {
    command: 'schtasks',
    args: ['/End', '/TN', definition.serviceName]
  },
  {
    command: 'schtasks',
    args: ['/Run', '/TN', definition.serviceName]
  }
]

export const getWindowsUninstallCommands = (
  definition: ServiceUnitDefinition
): ServiceCommand[] => [
  {
    command: 'schtasks',
    args: ['/End', '/TN', definition.serviceName]
  },
  {
    command: 'schtasks',
    args: ['/Delete', '/TN', definition.serviceName, '/F']
  }
]

export const getWindowsStatusCommands = (
  definition: ServiceUnitDefinition
): ServiceCommand[] => [
  {
    command: 'schtasks',
    args: ['/Query', '/TN', definition.serviceName, '/V', '/FO', 'LIST']
  }
]

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

export const getDarwinStartCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope,
  userId = getCurrentUserId()
): ServiceCommand[] => {
  const domain = getLaunchctlDomain(scope, userId)
  return [
    {
      command: 'launchctl',
      args: ['kickstart', `${domain}/${definition.serviceName}`]
    }
  ]
}

export const getDarwinStopCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope,
  userId = getCurrentUserId()
): ServiceCommand[] => {
  const domain = getLaunchctlDomain(scope, userId)
  return [
    {
      command: 'launchctl',
      args: ['kill', 'SIGTERM', `${domain}/${definition.serviceName}`]
    }
  ]
}

export const getDarwinStatusCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope,
  userId = getCurrentUserId()
): ServiceCommand[] => {
  const domain = getLaunchctlDomain(scope, userId)
  return [
    {
      command: 'launchctl',
      args: ['print', `${domain}/${definition.serviceName}`]
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

export const getLinuxStartCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => {
  const prefix = getSystemdPrefix(scope)
  return [
    {
      command: 'systemctl',
      args: [...prefix, 'start', definition.serviceName]
    }
  ]
}

export const getLinuxStopCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => {
  const prefix = getSystemdPrefix(scope)
  return [
    {
      command: 'systemctl',
      args: [...prefix, 'stop', definition.serviceName]
    }
  ]
}

export const getLinuxStatusCommands = (
  definition: ServiceUnitDefinition,
  scope: ServiceScope
): ServiceCommand[] => {
  const prefix = getSystemdPrefix(scope)
  return [
    {
      command: 'systemctl',
      args: [...prefix, 'status', definition.serviceName]
    }
  ]
}
