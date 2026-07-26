import { defineEventHandler } from 'h3'
import type { RuntimeBackendStatusResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<RuntimeBackendStatusResponse>(
    event,
    '/api/runtime/backend'
  )
)
