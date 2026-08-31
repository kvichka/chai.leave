// Copies dist/index.html to dist/404.html.
//
// Routing uses HashRouter, so GitHub Pages never needs a rewrite for normal
// navigation. This exists for the other case: someone has an old bookmark to a
// real path (from a previous deploy, or a hand-typed URL). Without 404.html
// they get GitHub's own 404 page; with it they land on the app, which then
// resolves the hash route itself.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
const index = resolve(dist, 'index.html')
const fallback = resolve(dist, '404.html')

if (!existsSync(index)) {
  console.error('dist/index.html not found. Run `npm run build` first.')
  process.exit(1)
}

copyFileSync(index, fallback)
console.log('Wrote dist/404.html (SPA fallback).')
