import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarPlus, HandCoins, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState, StatusChip, Tooltip } from '@/components/ui/primitives'
import { CompClaimDialog } from '@/components/CompClaimDialog'
import { useCompClaims } from '@/hooks/useLeaveData'
import { useWithdrawCompClaim } from '@/hooks/useMutations'
import { fmtDays } from '@/lib/format'
import { useAuth } from '@/providers/AuthProvider'
import { cn } from '@/lib/cn'

/**
 * Your own compensation claims, above My requests on the My leave page.
 *
 * Separate from "My requests" on purpose. A request spends leave; a claim
 * earns it. Putting them in one list would mean a reader had to check the
 * direction of every row.
 */
export function CompClaimsPanel({ className }: { className?: string }) {
  const { employee } = useAuth()
  const { data: claims = [] } = useCompClaims()
  const withdraw = useWithdrawCompClaim()
  const [claiming, setClaiming] = useState(false)

  const mine = claims.filter((c) => c.employee_id === employee?.id)
  const earned = mine
    .filter((c) => c.status === 'approved')
    .reduce((sum, c) => sum + Number(c.days_earned), 0)

  return (
    <>
      <Card className={cn('flex flex-col', className)}>
        <CardHeader
          title="Compensation leave claims"
          description={
            mine.length === 0
              ? 'Worked a weekend or a public holiday? Claim the day back.'
              : `${fmtDays(earned)} day(s) earned this way so far.`
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => setClaiming(true)}>
              <CalendarPlus className="h-3.5 w-3.5" /> Claim a day
            </Button>
          }
        />

        {mine.length === 0 ? (
          <EmptyState icon={<HandCoins className="h-7 w-7" />} title="No claims yet">
            If you work outside normal hours — a weekend, a public holiday, a long day in the
            field — claim the time back here. Approved days join your Compensation Leave balance
            and can be requested like any other leave.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.map((c) => {
              const waiting = c.status === 'pending_supervisor' || c.status === 'pending_hr'
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {c.worked_to && c.worked_to !== c.worked_date
                        ? `${format(parseISO(c.worked_date), 'd MMM')} – ${format(parseISO(c.worked_to), 'd MMM yyyy')}`
                        : format(parseISO(c.worked_date), 'EEE d MMM yyyy')}
                      <span className="ml-2 font-normal text-slate-500">
                        {fmtDays(c.days_earned)} day{Number(c.days_earned) === 1 ? '' : 's'}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500" title={c.reason}>
                      {c.reason}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <StatusChip status={c.status} />
                    {c.decision_note ? (
                      <Tooltip label={c.decision_note}>
                        <span className="cursor-help text-xs text-slate-400 underline decoration-dotted">
                          note
                        </span>
                      </Tooltip>
                    ) : null}
                    {waiting ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => withdraw.mutate(c.id)}
                        aria-label="Withdraw this claim"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Withdraw
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <CompClaimDialog open={claiming} onOpenChange={setClaiming} />
    </>
  )
}
