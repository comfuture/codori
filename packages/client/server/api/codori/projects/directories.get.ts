import { defineEventHandler, getQuery } from 'h3'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const path = typeof query.path === 'string' ? query.path.trim() : ''
  const search = path ? `?${new URLSearchParams({ path }).toString()}` : ''
  return await proxyServerRequest(event, `/api/projects/directories${search}`)
})
