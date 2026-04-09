import type { NuxtConfig } from 'nuxt/schema'

const config: NuxtConfig = {
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-15',
  runtimeConfig: {
    codoriServerBase: process.env.CODORI_SERVER_BASE ?? 'http://127.0.0.1:4310',
    public: {
      codoriServerWsBase: process.env.CODORI_SERVER_WS_BASE ?? 'ws://127.0.0.1:4310'
    }
  },
  devtools: {
    enabled: true
  }
}

export default config
