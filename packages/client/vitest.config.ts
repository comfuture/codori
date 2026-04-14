import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
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
