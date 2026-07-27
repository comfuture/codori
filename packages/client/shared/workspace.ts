import { encodeChatIdSegment, encodeProjectIdSegment } from './codori'
import { resolveWsBase } from './network'

export type RpcWorkspace =
  | { kind: 'project', id: string }
  | { kind: 'chat', id: string }

export type WorkspaceIdentity = {
  workspace: RpcWorkspace
  threadId: string
}

export type ImmersiveWorkspaceRoute = {
  identity: WorkspaceIdentity
  returnTo: string
}

export type ImmersiveVrCapability = {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>
}

const normalizedNonEmpty = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

export const workspaceKey = (workspace: RpcWorkspace) =>
  `${workspace.kind}:${workspace.id}`

export const resolveWorkspaceRpcPath = (workspace: RpcWorkspace) =>
  workspace.kind === 'chat'
    ? `/api/chats/${encodeChatIdSegment(workspace.id)}/rpc`
    : `/api/projects/${encodeProjectIdSegment(workspace.id)}/rpc`

export const resolveWorkspaceRpcUrl = (input: {
  workspace: RpcWorkspace
  configuredWsBase?: string | null
  configuredHttpBase?: string | null
}) => new URL(
  resolveWorkspaceRpcPath(input.workspace),
  resolveWsBase(input.configuredWsBase, input.configuredHttpBase)
).toString()

export const sanitizeCodoriReturnRoute = (
  value: string | null | undefined,
  fallback = '/'
) => {
  const candidate = value?.trim()
  if (
    !candidate
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
  ) {
    return fallback
  }

  const url = new URL(candidate, 'https://codori.invalid')
  if (url.origin !== 'https://codori.invalid' || /^\/xr(?:\/|$)/u.test(url.pathname)) {
    return fallback
  }

  return `${url.pathname}${url.search}${url.hash}`
}

export const createImmersiveWorkspaceRoute = (input: {
  identity: WorkspaceIdentity
  returnTo?: string | null
}) => {
  const workspaceId = normalizedNonEmpty(input.identity.workspace.id)
  const threadId = normalizedNonEmpty(input.identity.threadId)
  if (!workspaceId || !threadId) {
    throw new Error('An immersive workspace requires a materialized workspace and thread.')
  }

  const query = new URLSearchParams({
    workspaceKind: input.identity.workspace.kind,
    workspaceId,
    threadId,
    returnTo: sanitizeCodoriReturnRoute(input.returnTo)
  })
  return `/xr/?${query.toString()}`
}

const routeSearchParams = (input: string | URL | URLSearchParams) => {
  if (input instanceof URLSearchParams) {
    return input
  }
  if (input instanceof URL) {
    return input.searchParams
  }
  return new URL(input, 'https://codori.invalid').searchParams
}

export const parseImmersiveWorkspaceRoute = (
  input: string | URL | URLSearchParams
): ImmersiveWorkspaceRoute | null => {
  const params = routeSearchParams(input)
  const kind = params.get('workspaceKind')
  const workspaceId = normalizedNonEmpty(params.get('workspaceId'))
  const threadId = normalizedNonEmpty(params.get('threadId'))
  if ((kind !== 'project' && kind !== 'chat') || !workspaceId || !threadId) {
    return null
  }

  return {
    identity: {
      workspace: {
        kind,
        id: workspaceId
      },
      threadId
    },
    returnTo: sanitizeCodoriReturnRoute(params.get('returnTo'))
  }
}

export const detectImmersiveVrSupport = async (input: {
  secureContext: boolean
  xr?: ImmersiveVrCapability | null
}) => {
  if (!input.secureContext || !input.xr) {
    return false
  }

  try {
    return await input.xr.isSessionSupported('immersive-vr')
  } catch {
    return false
  }
}
