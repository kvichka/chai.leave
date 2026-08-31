import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

/**
 * Resolves the Supabase URL and anon key, in this order:
 *   1. TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY in the environment
 *   2. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local
 *      (the hosted-project path - one place to set them, not two)
 *   3. `supabase status -o env` (the local Docker stack)
 *
 * Note what is NOT here: the service_role key. Every acceptance test signs in
 * as one of the seeded demo users through the public anon key, which means the
 * tests exercise Row Level Security instead of tunnelling under it.
 */
export default async function setup() {
  for (const f of ['.env.local', '.env']) {
    if (existsSync(f)) dotenv.config({ path: f, override: false })
  }

  process.env.TEST_SUPABASE_URL ||= process.env.VITE_SUPABASE_URL ?? ''
  process.env.TEST_SUPABASE_ANON_KEY ||= process.env.VITE_SUPABASE_ANON_KEY ?? ''

  if (!process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_ANON_KEY) {
    let out: string
    try {
      out = execSync('npx --yes supabase status -o env', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error(
        'No Supabase to test against.\n' +
          '  Hosted project: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local\n' +
          '  Local stack:    run `supabase start`',
      )
    }

    const read = (key: string) =>
      out.match(new RegExp(`^${key}="?([^"\\n\\r]+)"?`, 'm'))?.[1]?.trim()

    // ||= not ??=, because the fallbacks above may have set an empty string.
    process.env.TEST_SUPABASE_URL ||= read('API_URL') ?? 'http://127.0.0.1:54321'
    process.env.TEST_SUPABASE_ANON_KEY ||= read('ANON_KEY') ?? ''
  }

  if (!process.env.TEST_SUPABASE_ANON_KEY) {
    throw new Error(
      'No anon key. Set VITE_SUPABASE_ANON_KEY in .env.local, or run `supabase start`.',
    )
  }

  // Fail loudly and early if the seed has not been applied - otherwise every
  // test fails with a confusing "invalid login credentials".
  const probe = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
  const { error } = await probe.auth.signInWithPassword({
    email: 'dara.pen@clintonhealthaccess.org',
    password: 'demo-password-not-for-production',
  })
  if (error) {
    throw new Error(
      `Could not sign in as the seeded HR demo user (${error.message}). ` +
        'Run `supabase db reset` so that supabase/seed.sql is applied.',
    )
  }
  await probe.auth.signOut()
}
