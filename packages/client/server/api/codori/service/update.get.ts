import { defineEventHandler } from 'h3'
import type { ServiceUpdateResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ServiceUpdateResponse>(event, '/api/service/update')
)
