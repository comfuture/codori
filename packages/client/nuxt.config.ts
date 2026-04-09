import type { NuxtConfig } from 'nuxt/schema'

const config: NuxtConfig = {
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-15',
  devtools: {
    enabled: true
  }
}

export default config
