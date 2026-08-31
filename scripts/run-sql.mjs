#!/usr/bin/env node
/**
 * Runs .sql files against a Postgres database, in order, stopping at the first
 * error. Replaces the psql dependency: psql is not installed on every machine,
 * and requiring it made `npm run db:rls` unrunnable for anyone without the
 * Postgres client tools or a Docker container to borrow one from.
 *
 * Usage:
 *   node scripts/run-sql.mjs supabase/tests/rls_tests.sql
 *   node scripts/run-sql.mjs "supabase/migrations/*.sql" supabase/seed.sql
 *
 * Connection, in order of preference:
 *   1. SUPABASE_DB_URL or TEST_DATABASE_URL in the environment
 *   2. the same, from .env.local
 *   3. `supabase status -o env` (the local Docker stack)
 *
 * psql meta-commands (\set, \echo, \timing) are handled here rather than sent
 * to the server. ON_ERROR_STOP is the only behaviour, always.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, basename, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import pg from 'pg'
import dotenv from 'dotenv'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/run-sql.mjs <file.sql | glob> [more.sql ...]')
  process.exit(1)
}

/* ------------------------------------------------------------ connection -- */

for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) dotenv.config({ path: f, override: false })
}

/**
 * Discrete PG* fields are preferred over a URI because a Supabase-generated
 * password routinely contains / * & @ $ - all of which have meaning inside a
 * connection string and would need percent-encoding. As separate values they
 * are passed through verbatim.
 */
function resolveDiscreteFields() {
  const { PGHOST, PGPASSWORD } = process.env
  if (!PGHOST || !PGPASSWORD) return null
  return {
    host: PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'postgres',
    user: process.env.PGUSER ?? 'postgres',
    password: PGPASSWORD,
  }
}

function resolveConnectionString() {
  const fromEnv = process.env.SUPABASE_DB_URL || process.env.TEST_DATABASE_URL
  if (fromEnv && !/^TODO/i.test(fromEnv)) return fromEnv

  try {
    const status = execSync('npx --yes supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const local = status.match(/^DB_URL="?([^"\n\r]+)"?/m)?.[1]?.trim()
    if (local) return local
  } catch {
    /* no local stack; fall through */
  }

  console.error(
    'No database connection available.\n\n' +
      'Set these in .env.local (Supabase dashboard -> Connect -> Session pooler):\n' +
      '  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD\n\n' +
      'Use the session pooler on port 5432, not the transaction pooler on 6543 -\n' +
      'these scripts rely on SET LOCAL and explicit transactions.\n\n' +
      'Or start the local stack with `supabase start`.',
  )
  process.exit(1)
}

const discrete = resolveDiscreteFields()
const connectionString = discrete ? null : resolveConnectionString()

/** Never print the password back out. */
function safeLabel() {
  if (discrete) return `${discrete.host}:${discrete.port}/${discrete.database}`
  try {
    const u = new URL(connectionString)
    return `${u.hostname}:${u.port || 5432}${u.pathname}`
  } catch {
    return '(unparseable connection string)'
  }
}

const isLocal = discrete
  ? /^(127\.0\.0\.1|localhost)$/.test(discrete.host)
  : /(^|@)(127\.0\.0\.1|localhost)/.test(connectionString)

/* ----------------------------------------------------------------- files -- */

function expand(pattern) {
  if (!pattern.includes('*')) return [pattern]
  const dir = dirname(pattern)
  const rx = new RegExp('^' + basename(pattern).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  return readdirSync(dir)
    .filter((f) => rx.test(f))
    .sort()
    .map((f) => join(dir, f))
}

const files = args.flatMap(expand)
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`No such file: ${f}`)
    process.exit(1)
  }
}

/* -------------------------------------------------------------- psql-isms -- */

function stripMetaCommands(sql) {
  const echoes = []
  const body = sql
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trimStart()
      if (!t.startsWith('\\')) return true
      const echo = t.match(/^\\echo\s+'?(.*?)'?\s*$/)
      if (echo) echoes.push(echo[1])
      return false
    })
    .join('\n')
  return { body, echoes }
}

/* ------------------------------------------------------------------- run -- */

const client = new pg.Client({
  ...(discrete ?? { connectionString }),
  // Supabase terminates TLS at the pooler with a certificate chain Node does
  // not ship a root for. The connection is still encrypted.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // The RLS suite is a single long script; do not cut it off mid-transaction.
  statement_timeout: 0,
  query_timeout: 0,
})

// RAISE NOTICE is how the SQL suites report progress ("ok 1 - ...").
client.on('notice', (msg) => {
  if (msg.message) console.log(`  ${msg.message}`)
})

let failed = false

try {
  await client.connect()
  console.log(`Connected to ${safeLabel()}${isLocal ? ' (local)' : ''}\n`)

  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const { body } = stripMetaCommands(raw)
    if (!body.trim()) continue

    process.stdout.write(`▶ ${file}\n`)
    try {
      await client.query(body)
      console.log(`  ✓ ${basename(file)}\n`)
    } catch (error) {
      failed = true
      console.error(`\n  ✗ ${file} FAILED`)
      console.error(`    ${error.message}`)
      if (error.detail) console.error(`    detail: ${error.detail}`)
      if (error.hint) console.error(`    hint:   ${error.hint}`)
      if (error.where) console.error(`    where:  ${String(error.where).split('\n')[0]}`)
      if (error.position) {
        const upto = body.slice(0, Number(error.position))
        console.error(`    line:   ${upto.split('\n').length} of ${resolve(file)}`)
      }
      break
    }
  }
} catch (error) {
  failed = true
  console.error(`\nConnection failed: ${error.message}`)
  if (/password authentication|SASL/i.test(error.message)) {
    console.error(
      'Check the password in SUPABASE_DB_URL. Reset it under Project Settings -> Database.',
    )
  }
} finally {
  await client.end().catch(() => {})
}

if (failed) {
  console.error('\nFAILED.')
  process.exit(1)
}

console.log('All statements completed.')
