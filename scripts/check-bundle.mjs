#!/usr/bin/env node
/**
 * Pre-publish safety checks on dist/.
 *
 * Run by CI before uploading to Pages, and worth running by hand before any
 * manual deploy:
 *
 *   npm run check:bundle
 *
 * A naive `grep -r service_role dist` does NOT work: supabase-js contains that
 * string in its own source, so the check fires on every build. These look for
 * actual credentials instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const problems = []

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`No ${DIST}/ directory. Run "npm run build" first.`)
  process.exit(1)
}

/* -------------------------------------------------------- sourcemaps ----- */

const maps = files.filter((f) => f.endsWith('.map'))
if (maps.length > 0) {
  problems.push(
    `${maps.length} sourcemap(s) in ${DIST}/. They publish the original TypeScript ` +
      'and were once 81% of this deploy. Build without VITE_SOURCEMAP=1.',
  )
}

/* ---------------------------------------------------- secret API keys ----- */

const text = files.filter((f) => /\.(js|html|css|json|txt)$/.test(f))

for (const file of text) {
  const body = readFileSync(file, 'utf8')

  // New-format Supabase secret key. The prefix alone is not enough to match on:
  // supabase-js contains `t.startsWith("sb_secret_")` in its own key-detection
  // code, so require an actual key body after it.
  const secretKey = body.match(/sb_secret_[A-Za-z0-9_-]{16,}/)
  if (secretKey) {
    problems.push(
      `${file} contains a secret key (${secretKey[0].slice(0, 18)}…). ` +
        'That key bypasses Row Level Security.',
    )
  }

  // Legacy service_role keys are JWTs. Decode any that appear and inspect the
  // claim, rather than matching the words "service_role" — which legitimately
  // appear inside supabase-js itself.
  for (const jwt of body.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    const payload = jwt.split('.')[1]
    if (!payload) continue
    let decoded
    try {
      decoded = Buffer.from(payload, 'base64url').toString('utf8')
    } catch {
      continue
    }
    if (/"role"\s*:\s*"service_role"/.test(decoded)) {
      problems.push(`${file} contains a service_role JWT. That key bypasses Row Level Security.`)
    }
  }
}

/* ------------------------------------------------------------ report ----- */

const totalBytes = files.reduce((s, f) => s + statSync(f).size, 0)
const js = files.filter((f) => f.endsWith('.js'))
const jsBytes = js.reduce((s, f) => s + statSync(f).size, 0)

console.log(`${DIST}/: ${files.length} files, ${(totalBytes / 1024).toFixed(0)} kB total`)
console.log(`  javascript: ${(jsBytes / 1024).toFixed(0)} kB across ${js.length} chunks`)

if (problems.length > 0) {
  console.error('\nRefusing to publish:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log('  no secret keys, no sourcemaps — safe to publish.')
