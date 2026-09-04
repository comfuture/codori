import { defineEventHandler, readBody } from 'h3'
import type { CreateProjectResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<CreateProjectResponse>(event, '/api/projects', {
    method: 'POST',
    body: await readBody(event)
  })
)
