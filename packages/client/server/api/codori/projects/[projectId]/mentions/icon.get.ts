import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam
} from 'h3'
import { encodeProjectIdSegment } from '~~/shared/codori'
import { proxyServerFetch } from '../../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing project id.'
    })
  }

  const queryValue = getQuery(event).path
  const path = typeof queryValue === 'string'
    ? queryValue
    : ''

  if (!path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing mention asset path.'
    })
  }

  const query = new URLSearchParams()
  query.set('path', path)
  const response = await proxyServerFetch(
    event,
    `/api/projects/${encodeProjectIdSegment(projectId)}/mentions/icon?${query.toString()}`
  )

  if (!response.ok) {
    let statusMessage = 'Mention asset preview failed.'
    try {
      const body = await response.json() as { error?: { message?: string } }
      statusMessage = body.error?.message ?? statusMessage
    } catch {
      // Ignore parse failures and fall back to the default message.
    }

    throw createError({
      statusCode: response.status,
      statusMessage
    })
  }

  const headers = new Headers()
  for (const [key, value] of response.headers.entries()) {
    headers.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    headers
  })
})
