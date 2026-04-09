import { defineEventHandler } from 'h3'
import type { ProjectsResponse } from '~~/shared/codori.js'
import { proxyCodoriRequest } from '../../../utils/codori-server.js'

export default defineEventHandler(async (event) =>
  await proxyCodoriRequest<ProjectsResponse>(event, '/api/projects')
)
