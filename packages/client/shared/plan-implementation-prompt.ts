export const shouldQueuePlanImplementationPrompt = (input: {
  turnId: string | null
  latestPlanTurnId: string | null
  turnStatus: string | null | undefined
}) =>
  Boolean(
    input.turnId
    && input.latestPlanTurnId === input.turnId
    && input.turnStatus === 'completed'
  )
