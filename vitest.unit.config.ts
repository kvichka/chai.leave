import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Pure functions only. No database, no network - these run anywhere, including
// on a laptop with no Docker.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'unit',
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
