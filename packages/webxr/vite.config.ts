import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const codoriServer = env.CODORI_WEBXR_DEV_SERVER
    || 'http://127.0.0.1:4310'

  return {
    base: '/xr/',
    server: {
      proxy: {
        '/api': {
          target: codoriServer,
          changeOrigin: true,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      target: 'es2022'
    }
  }
})
