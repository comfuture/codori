import type { ModuleOptions as PwaModuleOptions } from '@vite-pwa/nuxt'
import type { NuxtConfig } from 'nuxt/schema'

const config: NuxtConfig & { pwa: PwaModuleOptions } = {
  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  ssr: false,
  compatibilityDate: '2025-01-15',
  app: {
    head: {
      title: 'Codori',
      meta: [
        { name: 'theme-color', content: '#111827' }
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/codori-192.png' }
      ]
    }
  },
  pwa: {
    manifest: false,
    registerType: 'autoUpdate',
    injectRegister: 'inline',
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/xr(?:\/|$)/],
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true
    }
  },
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
