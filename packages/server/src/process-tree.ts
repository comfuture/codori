import { spawn } from 'node:child_process'

type ProcessSignal = NodeJS.Signals | 0

type TerminateProcessTreeOptions = {
  platform?: NodeJS.Platform
  forceAfterMs?: number
  pollMs?: number
  isAlive?: (target: number) => boolean
  signal?: (target: number, signal: ProcessSignal) => void
  taskkill?: (pid: number, force: boolean) => Promise<boolean>
}

const wait = async (ms: number) =>
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })

const defaultIsAlive = (target: number) => {
  try {
    process.kill(target, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const defaultSignal = (target: number, signal: ProcessSignal) => {
  process.kill(target, signal)
}

const runTaskkill = async (pid: number, force: boolean) =>
  await new Promise<boolean>((resolvePromise) => {
    const child = spawn('taskkill', [
      '/PID',
      String(pid),
      '/T',
      ...(force ? ['/F'] : [])
    ], {
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', () => resolvePromise(false))
    child.once('close', code => resolvePromise(code === 0))
  })

const waitForStopped = async (
  target: number,
  isAlive: (target: number) => boolean,
  timeoutMs: number,
  pollMs: number
) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(target)) {
      return true
    }
    await wait(pollMs)
  }
  return !isAlive(target)
}

export const terminateProcessTree = async (
  pid: number,
  options: TerminateProcessTreeOptions = {}
) => {
  const platform = options.platform ?? process.platform
  const forceAfterMs = options.forceAfterMs ?? 3_000
  const pollMs = options.pollMs ?? 50
  const isAlive = options.isAlive ?? defaultIsAlive

  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  if (platform === 'win32') {
    if (!isAlive(pid)) {
      return false
    }
    const taskkill = options.taskkill ?? runTaskkill
    await taskkill(pid, false)
    if (await waitForStopped(pid, isAlive, forceAfterMs, pollMs)) {
      return true
    }
    await taskkill(pid, true)
    return await waitForStopped(pid, isAlive, forceAfterMs, pollMs)
  }

  const processGroup = -Math.abs(pid)
  if (!isAlive(processGroup)) {
    return false
  }
  const signal = options.signal ?? defaultSignal
  try {
    signal(processGroup, 'SIGTERM')
  } catch {
    return !isAlive(processGroup)
  }
  if (await waitForStopped(processGroup, isAlive, forceAfterMs, pollMs)) {
    return true
  }
  try {
    signal(processGroup, 'SIGKILL')
  } catch {
    return !isAlive(processGroup)
  }
  return await waitForStopped(processGroup, isAlive, forceAfterMs, pollMs)
}
