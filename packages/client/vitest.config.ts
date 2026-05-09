import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#imports': fileURLToPath(new URL('./test/mocks/nuxt-imports.ts', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    server: {
      deps: {
        inline: [
          /^@comark\/vue/,
          /^beautiful-mermaid/,
          /^comark/,
          /^katex/
        ]
      }
    }
  }
})
