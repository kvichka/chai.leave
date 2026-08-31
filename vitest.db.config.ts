import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Acceptance suites A (day counting), B (pro-rating), C (workflow) and
// D (balance integrity) from section 10 of the build spec.
//
// These run against a local Supabase started with `supabase start`, signing in
// as the seeded demo users through the public anon key - so they exercise Row
// Level Security rather than tunnelling under it with a service_role key.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'db',
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/db/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The suites mutate shared fixtures; keep them strictly serial.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
