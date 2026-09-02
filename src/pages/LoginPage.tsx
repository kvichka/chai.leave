import { useState } from 'react'
import { CalendarCheck2, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/primitives'
import { useAuth, ALLOWED_EMAIL_DOMAIN } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { humanError } from '@/lib/errors'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    try {
      await signIn(email, password)
      // The auth listener swaps the whole tree on success; nothing to reset.
    } catch (err) {
      // Supabase returns the same message for a wrong password and an unknown
      // address, on purpose - it stops the form being used to discover which
      // email addresses exist.
      toast.error('Could not sign in', humanError(err))
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-chai-50 to-white px-4">
      <div className="w-full max-w-sm">
        <div className="card p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-chai-600 text-white">
              <CalendarCheck2 className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold text-slate-900">CHAI Cambodia</h1>
              <p className="text-sm text-slate-500">Leave management</p>
            </div>
          </div>

          <form className="space-y-3" onSubmit={submit}>
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.org"
              />
            </Field>

            <Field label="Password" htmlFor="password" required>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
              />
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full justify-center"
              loading={busy}
              disabled={!email.trim() || !password}
            >
              Sign in
            </Button>
          </form>

          <p className="mt-4 rounded-lg bg-chai-50 p-2.5 text-xs leading-relaxed text-slate-600">
            Accounts are created by HR. If you do not have one, or you have forgotten your
            password, ask them to set you up — there is no self-service reset.
            {ALLOWED_EMAIL_DOMAIN ? (
              <>
                {' '}
                Only <span className="font-medium">@{ALLOWED_EMAIL_DOMAIN}</span> addresses can
                sign in.
              </>
            ) : null}
          </p>

          <DevSignIn />
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-slate-400">
          This system holds leave records, including sick leave. Access is restricted to you,
          your reporting line and HR, and every change is recorded in an audit log.
        </p>
      </div>
    </main>
  )
}

/**
 * The demo staff, in reporting order. The role is what makes each one worth
 * clicking: the screen looks quite different depending on who you are.
 *
 * Deliberately no passwords here. They live in VITE_DEMO_PASSWORD in
 * .env.local, which is gitignored — one of these accounts is an HR admin, and
 * a PIN committed to a public repository is a PIN anyone can use against the
 * live project.
 */
const DEMO_STORAGE_KEY = 'chai-leave:demo-password'

/**
 * Where the shared demo password comes from, in order:
 *
 *   1. VITE_DEMO_PASSWORD in .env.local  - local development, gitignored.
 *   2. localStorage on this browser      - the deployed site.
 *
 * The second is why the panel can exist on a public URL at all. The password
 * is typed once, by you, into the browser you test from; it never enters the
 * published JavaScript, so someone else opening the site finds a locked panel
 * and no way past it. Sokha Meas is an HR administrator who can read every
 * record and reset anyone's password - that account is not something to hand
 * out with the URL.
 */
function readDemoPassword(): string | undefined {
  // The import.meta.env.DEV guard is load-bearing, not decoration. Vite inlines
  // VITE_DEMO_PASSWORD as a string literal at build time, so without it a
  // production build run on a machine that has .env.local would compile the
  // password straight into the published JavaScript. With it, the branch is
  // dead in production and the literal is dropped. scripts/check-bundle.mjs
  // fails the build if it ever reappears.
  const fromEnv = import.meta.env.DEV
    ? (import.meta.env.VITE_DEMO_PASSWORD as string | undefined)
    : undefined
  if (fromEnv) return fromEnv
  try {
    return window.localStorage.getItem(DEMO_STORAGE_KEY) ?? undefined
  } catch {
    // Private browsing, or storage blocked. Fall back to the locked panel.
    return undefined
  }
}

const DEMO_USERS: { email: string; name: string; role: string; note: string }[] = [
  { email: 'sokha.meas@example.org', name: 'Sokha Meas', role: 'HR admin', note: 'Sees everyone' },
  { email: 'dara.pen@example.org', name: 'Dara Pen', role: 'Supervisor', note: 'Whole programmes tree' },
  { email: 'sreymom.kim@example.org', name: 'Sreymom Kim', role: 'Supervisor', note: 'Malaria, 2 reports' },
  { email: 'rithy.norn@example.org', name: 'Rithy Norn', role: 'Supervisor', note: 'HIV, 2 reports' },
  { email: 'chantha.ly@example.org', name: 'Chantha Ly', role: 'Employee', note: 'Malaria' },
  { email: 'bopha.sok@example.org', name: 'Bopha Sok', role: 'Employee', note: 'Malaria' },
  { email: 'vanna.chea@example.org', name: 'Vanna Chea', role: 'Employee', note: 'HIV' },
  { email: 'pisey.chhun@example.org', name: 'Pisey Chhun', role: 'Employee', note: 'HIV' },
  { email: 'kosal.sam@example.org', name: 'Kosal Sam', role: 'Employee', note: 'Operations' },
  { email: 'nary.tep@example.org', name: 'Nary Tep', role: 'Employee', note: 'Operations' },
]

const ROLE_STYLES: Record<string, string> = {
  'HR admin': 'bg-chai-100 text-chai-800',
  Supervisor: 'bg-amber-100 text-amber-800',
  Employee: 'bg-slate-100 text-slate-600',
}

/**
 * One-click sign-in for the demo staff, on localhost and on the deployed test
 * site alike. Locked until this browser has been given the shared password.
 */
function DevSignIn() {
  return <DevSignInPanel />
}

function DevSignInPanel() {
  const { signIn } = useAuth()
  const [password, setPassword] = useState<string | undefined>(readDemoPassword)
  const [entry, setEntry] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const toast = useToast()

  function unlock(e: React.FormEvent) {
    e.preventDefault()
    const value = entry.trim()
    if (!value) return
    // Not verified here - there is nothing to verify it against without a
    // round trip. A wrong one simply fails on the first click, and the toast
    // below says so.
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, value)
    } catch {
      /* storage blocked: it still works for this page view */
    }
    setPassword(value)
    setEntry('')
  }

  function lock() {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY)
    } catch {
      /* nothing to clear */
    }
    setPassword(undefined)
  }

  async function go(email: string) {
    setPending(email)
    try {
      await signIn(email, password!)
      // On success the auth listener swaps the tree out from under us.
    } catch (err) {
      const message = humanError(err)
      toast.error(
        'That demo account could not sign in',
        /invalid login credentials/i.test(message)
          ? 'Wrong demo password for this browser, or the account no longer exists. Use Forget to clear it and enter it again.'
          : message,
      )
      setPending(null)
    }
  }

  return (
    <details className="mt-4 overflow-hidden rounded-lg border border-dashed border-slate-300 bg-chai-50/60">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600">
        <FlaskConical className="h-3.5 w-3.5" />
        {password ? 'Sign in as a demo user — one click' : 'Demo sign-in (locked)'}
      </summary>
      <div className="border-t border-dashed border-slate-300 p-2">
        {!password ? (
          <form className="space-y-2 p-1" onSubmit={unlock}>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Enter the shared demo password once and this browser remembers it, turning the
              list below into one-click sign-in. It is stored only here — never in the
              published site.
            </p>
            <div className="flex gap-1.5">
              <Input
                type="password"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="Demo password"
                aria-label="Demo password"
                className="text-xs"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={!entry.trim()}>
                Unlock
              </Button>
            </div>
          </form>
        ) : (
        <>
        <ul className="space-y-1">
          {DEMO_USERS.map((u) => (
            <li key={u.email}>
              <button
                type="button"
                onClick={() => void go(u.email)}
                disabled={pending !== null}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">
                  {u.name}
                  {pending === u.email ? (
                    <span className="ml-1.5 font-normal text-slate-400">signing in…</span>
                  ) : null}
                </span>
                <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                  {u.note}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    ROLE_STYLES[u.role] ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {u.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-2">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Test accounts on the reserved example.org domain, sharing one password.
          </p>
          <button
            type="button"
            onClick={lock}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-white hover:text-slate-700"
          >
            Forget
          </button>
        </div>
        </>
        )}
      </div>
    </details>
  )
}
