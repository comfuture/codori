import { IMMERSIVE_REALTIME_AUTO_START_DELAY_MS } from './config'

export type RealtimeAutoStartOptions = {
  prepare: () => Promise<void>
  isCurrent: () => boolean
  start: () => Promise<void>
  beforeStart?: () => void
  onStartError: (error: unknown) => void
  wait?: (milliseconds: number) => Promise<void>
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  globalThis.setTimeout(resolve, milliseconds)
})

export const coordinateRealtimeAutoStart = async (
  options: RealtimeAutoStartOptions
) => {
  const delay = (
    options.wait ?? wait
  )(IMMERSIVE_REALTIME_AUTO_START_DELAY_MS)
  await Promise.all([
    options.prepare(),
    delay
  ])
  if (!options.isCurrent()) {
    return false
  }
  options.beforeStart?.()
  try {
    await options.start()
    return true
  } catch (error) {
    options.onStartError(error)
    return false
  }
}
