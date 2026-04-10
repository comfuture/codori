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

export const proxyServerFetch = async (
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    headers?: HeadersInit
    body?: BodyInit | null
  } = {}
) => {
  const baseURL = getServerBase(event)
  const requestInit: RequestInit & { duplex?: 'half' } = {
    method: options.method,
    headers: options.headers,
    body: options.body ?? null
  }

  if (options.body) {
    requestInit.duplex = 'half'
  }

  return await fetch(`${baseURL}${path}`, requestInit)
}
