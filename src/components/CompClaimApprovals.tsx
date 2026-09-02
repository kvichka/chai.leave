import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Check, HandCoins, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/primitives'
import { Avatar } from '@/components/Avatar'
import { ReasonDialog } from '@/components/ReasonDialog'
import { useCompClaims, useEmployees } from '@/hooks/useLeaveData'
import { useCompClaimDecision } from '@/hooks/useMutations'
import { fmtDays } from '@/lib/format'
import { useAuth } from '@/providers/AuthProvider'
import type { CompLeaveClaim } from '@/lib/database.types'

/**
 * Compensation claims waiting on the signed-in approver.
 *
 * Renders nothing when the queue is empty. A permanently visible empty panel
 * on the Approvals page would be one more thing to scroll past every day, and
 * this queue is empty most of the time.
 */
export function CompClaimApprovals() {
  const { employee } = useAuth()
  const { data: claims = [] } = useCompClaims()
  const { data: employees = [] } = useEmployees()
  const decide = useCompClaimDecision()
  const [rejecting, setRejecting] = useState<CompLeaveClaim | null>(null)

  const waiting = claims.filter(
    (c) =>
      (c.status === 'pending_supervisor' || c.status === 'pending_hr') &&
      c.employee_id !== employee?.id,
  )

  if (waiting.length === 0) return null

  const nameOf = (id: string) => employees.find((e) => e.id === id)

  return (
    <>
      <Card className="mb-5 border-chai-200">
        <CardHeader
          title={`${waiting.length} compensation claim${waiting.length === 1 ? '' : 's'} to decide`}
          description="Time already worked outside normal hours. Approving adds the days to that person's Compensation Leave balance."
          action={<HandCoins className="h-4 w-4 text-chai-500" />}
        />

        <ul className="divide-y divide-slate-100">
          {waiting.map((c) => {
            const person = nameOf(c.employee_id)
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <Avatar
                  fullName={person?.full_name ?? '?'}
                  avatarPath={person?.avatar_path}
                  avatarEmoji={person?.avatar_emoji}
                  size="sm"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {person?.full_name ?? 'Unknown'}
                    <span className="ml-2 font-normal text-slate-500">
                      worked{' '}
                      {c.worked_to && c.worked_to !== c.worked_date
                        ? `${format(parseISO(c.worked_date), 'd MMM')} – ${format(parseISO(c.worked_to), 'd MMM yyyy')}`
                        : format(parseISO(c.worked_date), 'EEE d MMM yyyy')}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">{c.reason}</p>
                </div>

                <span className="shrink-0 rounded bg-chai-50 px-2 py-1 text-xs font-semibold tabular-nums text-chai-800">
                  +{fmtDays(c.days_earned)} day{Number(c.days_earned) === 1 ? '' : 's'}
                </span>

                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(c)}>
                    <X className="h-3.5 w-3.5" /> Decline
                  </Button>
                  <Button
                    size="sm"
                    loading={decide.isPending}
                    onClick={() => decide.mutate({ id: c.id, approve: true })}
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* required: the database refuses a decline with no reason, so the
          dialog enforces it rather than letting someone write nothing and
          then hit an error. */}
      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(v) => !v && setRejecting(null)}
        title={`Decline ${nameOf(rejecting?.employee_id ?? '')?.full_name ?? ''}'s claim`}
        label="Why are you declining it?"
        required
        destructive
        confirmLabel="Decline claim"
        onConfirm={async (note) => {
          if (rejecting) await decide.mutateAsync({ id: rejecting.id, approve: false, note })
          setRejecting(null)
        }}
      />
    </>
  )
}
