import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const getCodoriServerBase = (event: H3Event) => {
  const runtimeConfig = useRuntimeConfig(event)
  return trimTrailingSlash(runtimeConfig.codoriServerBase as string)
}

export const proxyCodoriRequest = async <T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
  } = {}
) => {
  const baseURL = getCodoriServerBase(event)
  return await $fetch<T>(`${baseURL}${path}`, {
    method: options.method,
    body: options.body as BodyInit | Record<string, unknown> | undefined
  })
}
