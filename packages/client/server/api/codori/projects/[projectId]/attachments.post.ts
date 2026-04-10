import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  setResponseStatus
} from 'h3'
import { encodeProjectIdSegment } from '~~/shared/codori'
import { proxyServerFetch } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing project id.'
    })
  }

  const contentType = getRequestHeader(event, 'content-type')
  if (!contentType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing content type.'
    })
  }

  const response = await proxyServerFetch(
    event,
    `/api/projects/${encodeProjectIdSegment(projectId)}/attachments`,
    {
      method: 'POST',
      headers: {
        'content-type': contentType
      },
      body: event.node.req as unknown as BodyInit
    }
  )

  const body = await response.json()
  setResponseStatus(event, response.status)

  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } }
    throw createError({
      statusCode: response.status,
      statusMessage: errorBody.error?.message ?? 'Attachment upload failed.',
      data: body
    })
  }

  return body
})
