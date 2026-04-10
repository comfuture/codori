import type { NuxtConfig } from 'nuxt/schema'

const config: NuxtConfig = {
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ssr: false,
  compatibilityDate: '2025-01-15',
  runtimeConfig: {
    public: {
      serverBase: process.env.CODORI_SERVER_BASE ?? '',
      serverWsBase: process.env.CODORI_SERVER_WS_BASE ?? ''
    }
  },
  devtools: {
    enabled: true
  }
}

export default config
