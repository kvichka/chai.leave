import { useMemo, useState } from 'react'
import { Check, KeyRound, LogOut, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/primitives'
import { useAuth } from '@/providers/AuthProvider'
import { useSettings } from '@/hooks/useLeaveData'
import { useToast } from '@/components/ui/Toast'
import { humanError } from '@/lib/errors'
import { cn } from '@/lib/cn'

/**
 * Shown instead of the application, not alongside it, while
 * employees.must_change_password is true.
 *
 * A temporary password has been handed over out-of-band — spoken aloud, sent in
 * a chat message — so it should stop working as soon as its owner can replace
 * it. Blocking every other screen is the only reliable way to make that happen.
 */
export function ChangePasswordPage() {
  const { employee, changePassword, signOut } = useAuth()
  const { data: settings } = useSettings()
  const minLength = settings?.min_password_length ?? 10

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const checks = useMemo(
    () => [
      { label: `At least ${minLength} characters`, ok: password.length >= minLength },
      { label: 'A lower-case letter', ok: /[a-z]/.test(password) },
      { label: 'An upper-case letter', ok: /[A-Z]/.test(password) },
      { label: 'A number', ok: /\d/.test(password) },
      {
        label: 'Not the temporary password you were given',
        ok: password.length === 0 || password !== 'demo-password-not-for-production',
      },
    ],
    [password, minLength],
  )

  const allOk = checks.every((c) => c.ok) && password.length > 0
  const matches = password.length > 0 && password === confirm

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!allOk || !matches) return
    setBusy(true)
    try {
      await changePassword(password)
      toast.success('Password changed', 'Use it the next time you sign in.')
      // The `me` query refetches with must_change_password false, which swaps
      // this screen out for the application.
    } catch (err) {
      toast.error('Could not change your password', humanError(err))
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-chai-50 to-white px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-7">
          <div className="mb-5 flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-chai-600 text-white">
              <KeyRound className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold text-slate-900">Choose your own password</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                {employee?.full_name
                  ? `Welcome, ${employee.full_name.split(' ')[0]}. `
                  : null}
                You are signed in with a temporary password. Replace it before continuing.
              </p>
            </div>
          </div>

          <form className="space-y-3" onSubmit={submit}>
            {/* Present but hidden: password managers need the username to
                associate the credential they are about to save. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={employee?.email ?? ''}
              readOnly
              hidden
            />

            <Field label="New password" htmlFor="new-password" required>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <ul className="space-y-1">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    c.ok ? 'text-chaiDarkGreen' : 'text-slate-500',
                  )}
                >
                  {c.ok ? (
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
                  )}
                  {c.label}
                </li>
              ))}
            </ul>

            <Field
              label="Confirm new password"
              htmlFor="confirm-password"
              required
              error={
                confirm.length > 0 && !matches ? 'The two passwords do not match.' : undefined
              }
            >
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>

            <Button
              type="submit"
              size="lg"
              className="w-full justify-center"
              loading={busy}
              disabled={!allOk || !matches}
            >
              Set my password
            </Button>
          </form>

          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full justify-center"
            onClick={() => void signOut()}
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out instead
          </Button>
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-slate-400">
          Nobody else can see your password, including HR. If you forget it they can issue
          another temporary one, which will bring you back to this screen.
        </p>
      </div>
    </main>
  )
}
