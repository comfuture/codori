import { defineEventHandler, getQuery } from 'h3'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const path = typeof query.path === 'string' ? query.path : ''
  return await proxyServerRequest(event, `/api/projects/directories?${new URLSearchParams({ path }).toString()}`)
})
