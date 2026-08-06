import { spawn } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, extname, resolve } from 'node:path'
import type {
  CodexExecutableFallbackReason,
  CodexExecutableSource,
  CodexExecutableStatus
} from './types.js'
import { terminateProcessTree } from './process-tree.js'

const require = createRequire(import.meta.url)
const DEFAULT_VALIDATION_TIMEOUT_MS = 2_000

type CodexExecutableProbeFailure = Extract<
  CodexExecutableFallbackReason,
  'path-validation-failed' | 'path-validation-timeout'
>

export type CodexExecutableProbeResult =
  | { usable: true }
  | { usable: false, reason: CodexExecutableProbeFailure }

export type CodexExecutableProbe = (
  candidate: string,
  input: {
    env: NodeJS.ProcessEnv
    platform: NodeJS.Platform
    timeoutMs: number
  }
) => Promise<CodexExecutableProbeResult>

export type ResolvedCodexExecutable = CodexExecutableStatus & {
  command: string
  argsPrefix: string[]
  shell?: boolean
}

export type CodexLaunchCommand = {
  command: string
  args: string[]
  shell?: boolean
}

export type CodexExecutableResolver = () => Promise<ResolvedCodexExecutable>

type ResolveCodexExecutableOptions = {
  override?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  cwd?: string
  execPath?: string
  bundledPath?: string
  validationTimeoutMs?: number
  probe?: CodexExecutableProbe
}

const windowsExecutableNames = (env: NodeJS.ProcessEnv) => {
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(extension => extension.trim().toLowerCase())
    .filter(Boolean)
  const names = extensions.map(extension => `codex${extension}`)
  names.push('codex.ps1', 'codex')
  return [...new Set(names)]
}

const pathEntries = (
  pathValue: string | undefined,
  platform: NodeJS.Platform,
  cwd: string
) => {
  if (!pathValue) {
    return []
  }
  const separator = platform === 'win32' ? ';' : delimiter
  return pathValue.split(separator).map((entry) => {
    const unquoted = entry.length >= 2 && entry.startsWith('"') && entry.endsWith('"')
      ? entry.slice(1, -1)
      : entry
    return resolve(cwd, unquoted || '.')
  })
}

const comparablePath = (path: string, platform: NodeJS.Platform) =>
  platform === 'win32' ? path.toLowerCase() : path

const bundledBinDirectory = (bundledPath: string) => {
  let current = dirname(resolve(bundledPath))

  while (true) {
    if (basename(current).toLowerCase() === 'node_modules') {
      return resolve(current, '.bin')
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

const directExecutable = (
  path: string,
  source: Exclude<CodexExecutableSource, 'bundle'>,
  fallbackReason: CodexExecutableFallbackReason | null,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): ResolvedCodexExecutable => {
  const extension = extname(path).toLowerCase()
  if (platform === 'win32' && extension === '.ps1') {
    return {
      path,
      source,
      fallbackReason,
      command: (env.ComSpec ?? env.COMSPEC)
        ?.replace(/cmd\.exe$/iu, 'WindowsPowerShell\\v1.0\\powershell.exe')
        ?? 'powershell.exe',
      argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path]
    }
  }
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    return {
      path,
      source,
      fallbackReason,
      command: path,
      argsPrefix: [],
      shell: true
    }
  }
  return {
    path,
    source,
    fallbackReason,
    command: path,
    argsPrefix: []
  }
}

const bundledExecutable = (
  bundledPath: string,
  execPath: string,
  fallbackReason: CodexExecutableFallbackReason
): ResolvedCodexExecutable => ({
  path: bundledPath,
  source: 'bundle',
  fallbackReason,
  command: execPath,
  argsPrefix: [bundledPath]
})

const isRunnableFile = async (candidate: string, platform: NodeJS.Platform) => {
  try {
    const candidateStat = await stat(candidate)
    if (!candidateStat.isFile()) {
      return false
    }
    if (platform !== 'win32') {
      await access(candidate, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

export const buildCodexLaunchCommand = (
  executable: ResolvedCodexExecutable,
  args: string[]
): CodexLaunchCommand => ({
  command: executable.command,
  args: [...executable.argsPrefix, ...args],
  ...(executable.shell ? { shell: true } : {})
})

export const probeCodexExecutable: CodexExecutableProbe = async (
  candidate,
  input
) => await new Promise<CodexExecutableProbeResult>((resolveProbe) => {
  const executable = directExecutable(
    candidate,
    'path',
    null,
    input.platform,
    input.env
  )
  const command = buildCodexLaunchCommand(executable, ['--version'])
  let settled = false
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let child: ReturnType<typeof spawn> | null = null

  const finish = (result: CodexExecutableProbeResult) => {
    if (settled) {
      return
    }
    settled = true
    if (timer) {
      clearTimeout(timer)
    }
    resolveProbe(result)
  }

  try {
    child = spawn(command.command, command.args, {
      detached: input.platform !== 'win32',
      env: input.env,
      shell: command.shell,
      stdio: 'ignore',
      windowsHide: true
    })
  } catch {
    finish({ usable: false, reason: 'path-validation-failed' })
    return
  }

  timer = setTimeout(() => {
    timedOut = true
    const pid = child?.pid
    if (typeof pid !== 'number') {
      child?.kill('SIGTERM')
      finish({ usable: false, reason: 'path-validation-timeout' })
      return
    }
    void terminateProcessTree(pid, {
      platform: input.platform,
      forceAfterMs: 500,
      pollMs: 25
    }).finally(() => {
      finish({ usable: false, reason: 'path-validation-timeout' })
    })
  }, input.timeoutMs)

  child.once('error', () => {
    if (timedOut) {
      return
    }
    finish({ usable: false, reason: 'path-validation-failed' })
  })
  child.once('close', (code) => {
    if (timedOut) {
      return
    }
    finish(code === 0
      ? { usable: true }
      : { usable: false, reason: 'path-validation-failed' })
  })
})

export const resolveCodexExecutable = async (
  options: ResolveCodexExecutableOptions = {}
): Promise<ResolvedCodexExecutable> => {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const cwd = options.cwd ?? process.cwd()
  const execPath = options.execPath ?? process.execPath
  const bundledPath = options.bundledPath
    ?? require.resolve('@openai/codex/bin/codex.js')
  const override = options.override ?? env.CODORI_CODEX_BIN
  if (override) {
    return directExecutable(override, 'override', null, platform, env)
  }

  const names = platform === 'win32' ? windowsExecutableNames(env) : ['codex']
  const probe = options.probe ?? probeCodexExecutable
  let fallbackReason: CodexExecutableFallbackReason = 'path-not-found'
  let foundBundledCandidate = false
  let bundledRealPath: string
  try {
    bundledRealPath = await realpath(bundledPath)
  } catch {
    bundledRealPath = bundledPath
  }
  const bundledBins = new Set<string>()
  for (const path of [bundledPath, bundledRealPath]) {
    const directory = bundledBinDirectory(path)
    if (directory) {
      bundledBins.add(comparablePath(directory, platform))
      try {
        bundledBins.add(comparablePath(await realpath(directory), platform))
      } catch {
        // The lexical directory is still useful when the package bin is absent.
      }
    }
  }

  for (const directory of pathEntries(env.PATH, platform, cwd)) {
    for (const name of names) {
      const candidate = resolve(directory, name)
      let candidateStat
      try {
        candidateStat = await stat(candidate)
      } catch {
        continue
      }
      if (!candidateStat.isFile() || !await isRunnableFile(candidate, platform)) {
        fallbackReason = 'path-not-executable'
        continue
      }

      let candidateRealPath: string
      try {
        candidateRealPath = await realpath(candidate)
      } catch {
        candidateRealPath = candidate
      }
      if (
        comparablePath(candidateRealPath, platform)
          === comparablePath(bundledRealPath, platform)
        || bundledBins.has(comparablePath(dirname(candidate), platform))
        || bundledBins.has(comparablePath(dirname(candidateRealPath), platform))
      ) {
        foundBundledCandidate = true
        continue
      }

      const result = await probe(candidate, {
        env,
        platform,
        timeoutMs: options.validationTimeoutMs ?? DEFAULT_VALIDATION_TIMEOUT_MS
      })
      if (result.usable) {
        return directExecutable(candidate, 'path', null, platform, env)
      }
      return bundledExecutable(bundledPath, execPath, result.reason)
    }
  }

  return bundledExecutable(
    bundledPath,
    execPath,
    foundBundledCandidate ? 'path-resolved-to-bundle' : fallbackReason
  )
}

export const createCodexExecutableResolver = (
  options: ResolveCodexExecutableOptions = {}
): CodexExecutableResolver => {
  let resolution: Promise<ResolvedCodexExecutable> | null = null
  return async () => {
    resolution ??= resolveCodexExecutable(options)
    return await resolution
  }
}

export const codexExecutableStatus = (
  executable: ResolvedCodexExecutable
): CodexExecutableStatus => ({
  path: executable.path,
  source: executable.source,
  fallbackReason: executable.fallbackReason
})
