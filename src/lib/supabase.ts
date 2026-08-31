import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** An unfilled .env.local placeholder, rather than a real value. */
function isPlaceholder(value: string | undefined): boolean {
  if (!value || value.trim() === '') return true
  return /^TODO/i.test(value.trim()) || value.includes('your-project-ref')
}

/**
 * False until .env.local holds real credentials. The app renders a setup screen
 * in that state instead of white-screening on an invalid URL, which is what
 * createClient would do if we handed it "TODO_https://…".
 */
export const supabaseConfigured = !isPlaceholder(rawUrl) && !isPlaceholder(rawKey)

const url = supabaseConfigured ? rawUrl : 'http://127.0.0.1:54321'
const anonKey = supabaseConfigured ? rawKey : 'not-configured'

// This key is public by design. It ships inside the bundle. Every access
// decision is made by Row Level Security in Postgres, never here.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: supabaseConfigured,
    autoRefreshToken: supabaseConfigured,
    detectSessionInUrl: supabaseConfigured,
    // GitHub Pages serves the app under a hash route; the OAuth callback comes
    // back as a fragment, which detectSessionInUrl handles.
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-application-name': 'chai-leave' },
  },
})

export const ATTACHMENT_BUCKET = 'leave-attachments'

/** Signed URL for a private attachment. Valid for one minute. */
export async function signedAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, 60)
  if (error) return null
  return data.signedUrl
}
