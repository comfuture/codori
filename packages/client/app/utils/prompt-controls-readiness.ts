export const runAfterPromptControlsReady = async <Result>(
  ensureReady: () => Promise<void>,
  run: () => Promise<Result> | Result
): Promise<Result> => {
  await ensureReady()
  return await run()
}

export const resolvePromptControlsReadinessError = (error: string | null) =>
  error ?? 'A valid app-server model selection is required.'

export const hasPromptSubmissionContent = (
  text: string,
  attachmentCount: number
) => text.trim().length > 0 || attachmentCount > 0

export const runThreadHydrationWithoutPromptControlsGate = async <Result>(
  ensureReady: () => Promise<void>,
  hydrate: () => Promise<Result>,
  syncPromptControls: (result: Result) => void
): Promise<Result> => {
  const promptControlsReady = ensureReady().then(
    () => true,
    () => false
  )
  const result = await hydrate()

  void promptControlsReady.then((ready) => {
    if (ready) {
      syncPromptControls(result)
    }
  }).catch(() => {})

  return result
}

export const withPromptControlsTimeout = async <Result>(
  operation: Promise<Result>,
  operationLabel: string,
  timeoutMs = 30_000
): Promise<Result> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timed out waiting for Codex app-server ${operationLabel}.`))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}
