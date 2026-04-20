type ObjectRecord = Record<string, unknown>

const isObjectRecord = (value: unknown): value is ObjectRecord =>
  typeof value === 'object' && value !== null

export type TurnPlanStepStatus = 'pending' | 'inProgress' | 'completed'

export type TurnPlanStep = {
  step: string
  status: TurnPlanStepStatus
}

export type TurnPlanUpdate = {
  threadId: string | null
  turnId: string | null
  explanation: string | null
  plan: TurnPlanStep[]
}

export type ThreadPlanState = TurnPlanUpdate & {
  structuralSignature: string
  panelOpen: boolean
  updatedAt: number
}

const normalizeTurnPlanStatus = (value: unknown): TurnPlanStepStatus | null => {
  switch (value) {
    case 'pending':
    case 'inProgress':
    case 'completed':
      return value
    default:
      return null
  }
}

const normalizeTurnPlanStep = (value: unknown): TurnPlanStep | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  const step = typeof value.step === 'string' ? value.step.trim() : ''
  const status = normalizeTurnPlanStatus(value.status)
  if (!step || !status) {
    return null
  }

  return {
    step,
    status
  }
}

export const normalizeTurnPlanUpdate = (value: unknown): TurnPlanUpdate | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  const rawPlan = Array.isArray(value.plan) ? value.plan : []
  const plan = rawPlan
    .map(normalizeTurnPlanStep)
    .filter((step): step is TurnPlanStep => step !== null)

  return {
    threadId: typeof value.threadId === 'string' && value.threadId.trim()
      ? value.threadId
      : null,
    turnId: typeof value.turnId === 'string' && value.turnId.trim()
      ? value.turnId
      : null,
    explanation: typeof value.explanation === 'string' && value.explanation.trim()
      ? value.explanation.trim()
      : null,
    plan
  }
}

export const getTurnPlanStructureSignature = (plan: TurnPlanStep[]) =>
  JSON.stringify(plan.map(step => step.step))

export const applyTurnPlanUpdate = (
  previous: ThreadPlanState | null | undefined,
  update: TurnPlanUpdate,
  updatedAt = Date.now()
): ThreadPlanState | null => {
  if (update.plan.length === 0) {
    return null
  }

  const structuralSignature = getTurnPlanStructureSignature(update.plan)
  const shouldAutoOpen = !previous || previous.structuralSignature !== structuralSignature

  return {
    ...update,
    structuralSignature,
    panelOpen: shouldAutoOpen ? true : previous.panelOpen,
    updatedAt
  }
}

export const resolveTurnPlanStepMeta = (status: TurnPlanStepStatus) => {
  switch (status) {
    case 'completed':
      return {
        kind: 'icon' as const,
        color: 'success' as const,
        label: 'done',
        icon: 'i-lucide-check',
        markerClass: 'text-success'
      }
    case 'inProgress':
      return {
        kind: 'icon' as const,
        color: 'info' as const,
        label: 'in progress',
        icon: 'i-lucide-loader-circle',
        markerClass: 'animate-spin text-info'
      }
    default:
      return {
        kind: 'dot' as const,
        color: 'neutral' as const,
        label: 'pending',
        icon: null,
        markerClass: 'bg-muted/70'
      }
  }
}
