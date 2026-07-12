import { defineEventHandler } from 'h3'
import type { ServerCapabilitiesResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ServerCapabilitiesResponse>(event, '/api/capabilities')
)
