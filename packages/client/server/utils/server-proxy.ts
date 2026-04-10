import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const getServerBase = (event: H3Event) => {
  const runtimeConfig = useRuntimeConfig(event)
  return trimTrailingSlash(String(runtimeConfig.public.serverBase ?? ''))
}

export const proxyServerRequest = async <T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
  } = {}
) => {
  const baseURL = getServerBase(event)
  return await $fetch<T>(`${baseURL}${path}`, {
    method: options.method,
    body: options.body as BodyInit | Record<string, unknown> | undefined
  })
}
