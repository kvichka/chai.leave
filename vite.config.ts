import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// package.json declares "type": "module", so this file is loaded as ESM and
// __dirname does not exist. Paths are derived from import.meta.url instead.
import { fileURLToPath } from 'node:url'

// GitHub Pages serves this project from https://<org>.github.io/<repo>/, so the
// asset base must be the repo name. Set VITE_BASE_PATH in the workflow (it is
// derived from the repository name there) or leave the default below.
//
// Routing uses HashRouter, so no server-side rewrite is needed. scripts/spa-fallback.mjs
// still copies index.html to 404.html so that a stale bookmarked path lands on
// the app instead of on GitHub's own 404 page.
const base = process.env.VITE_BASE_PATH ?? '/chai-leave/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    // Sourcemaps were 6.2 MB of a 7.6 MB deploy - four times the size of the
    // application itself. They also publish the original TypeScript to anyone
    // who opens dev-tools. Set VITE_SOURCEMAP=1 when you actually need to debug
    // a production build.
    sourcemap: process.env.VITE_SOURCEMAP === '1',
    rollupOptions: {
      output: {
        // Only the libraries every screen needs are pinned to named chunks.
        // recharts is deliberately NOT listed: naming it made Rollup treat it as
        // a static dependency of the entry and modulepreload 406 kB of charting
        // for someone looking at their own leave balance. Left alone, it lands
        // in the async chunks that actually use it.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
