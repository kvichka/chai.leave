import { useState } from 'react'
import { CalendarCheck2, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, NativeSelect } from '@/components/ui/primitives'
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

const DEMO_USERS = [
  { email: 'chantha.ly@clintonhealthaccess.org', label: 'Chantha Ly — employee' },
  { email: 'bopha.sok@clintonhealthaccess.org', label: 'Bopha Sok — employee' },
  { email: 'vanna.chea@clintonhealthaccess.org', label: 'Vanna Chea — employee' },
  { email: 'sreymom.kim@clintonhealthaccess.org', label: 'Sreymom Kim — employee, hired Jun 2026' },
  { email: 'rithy.norn@clintonhealthaccess.org', label: 'Rithy Norn — supervisor' },
  { email: 'sokha.meas@clintonhealthaccess.org', label: 'Sokha Meas — supervisor, 3 reports' },
  { email: 'dara.pen@clintonhealthaccess.org', label: 'Dara Pen — HR admin' },
  { email: 'sophea.chan@clintonhealthaccess.org', label: 'Sophea Chan — system admin' },
]

/**
 * One-click sign-in for the seeded demo staff. Rendered only when
 * import.meta.env.DEV is true, so Vite strips it from production builds - and
 * the accounts it lists exist only because seed.sql created them.
 */
function DevSignIn() {
  if (!import.meta.env.DEV) return null
  return <DevSignInPanel />
}

function DevSignInPanel() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState(DEMO_USERS[0]!.email)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function go() {
    setBusy(true)
    try {
      await signIn(email, 'demo-password-not-for-production')
    } catch (err) {
      toast.error('Demo sign-in failed', humanError(err))
      setBusy(false)
    }
  }

  return (
    <details className="mt-4 rounded-lg border border-dashed border-slate-300 bg-chai-50/60">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600">
        <FlaskConical className="h-3.5 w-3.5" />
        Developer sign-in (local only)
      </summary>
      <div className="space-y-2 border-t border-dashed border-slate-300 p-3">
        <NativeSelect
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Demo account"
          className="text-xs"
        >
          {DEMO_USERS.map((u) => (
            <option key={u.email} value={u.email}>
              {u.label}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-center"
          loading={busy}
          onClick={() => void go()}
        >
          Sign in as this demo user
        </Button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Seeded accounts sharing one password. Compiled out of production builds.
        </p>
      </div>
    </details>
  )
}
