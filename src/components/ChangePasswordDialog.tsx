import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/primitives'
import { useAuth } from '@/providers/AuthProvider'
import { useSettings } from '@/hooks/useLeaveData'
import { useToast } from '@/components/ui/Toast'
import { humanError } from '@/lib/errors'
import { passwordChecks } from '@/lib/password'
import { cn } from '@/lib/cn'

/** Voluntary password change, available from the profile card at any time. */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { employee, changePassword } = useAuth()
  const { data: settings } = useSettings()
  const minLength = settings?.min_password_length ?? 10

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (open) {
      setPassword('')
      setConfirm('')
    }
  }, [open])

  const checks = passwordChecks(password, minLength)
  const allOk = password.length > 0 && checks.every((c) => c.ok)
  const matches = password.length > 0 && password === confirm

  async function submit() {
    setBusy(true)
    try {
      await changePassword(password)
      toast.success('Password changed', 'Use the new one next time you sign in.')
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not change your password', humanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Change your password"
      description="You stay signed in on this device. Other devices will need the new password."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!allOk || !matches} onClick={() => void submit()}>
            Change password
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (allOk && matches) void submit()
        }}
      >
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={employee?.email ?? ''}
          readOnly
          hidden
        />

        <Field label="New password" htmlFor="dlg-new-password" required>
          <Input
            id="dlg-new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
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
          htmlFor="dlg-confirm-password"
          required
          error={confirm.length > 0 && !matches ? 'The two passwords do not match.' : undefined}
        >
          <Input
            id="dlg-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}
