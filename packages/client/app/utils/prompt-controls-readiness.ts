export const runAfterPromptControlsReady = async <Result>(
  ensureReady: () => Promise<void>,
  run: () => Promise<Result> | Result
): Promise<Result> => {
  await ensureReady()
  return await run()
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
