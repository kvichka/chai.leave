import { useMemo } from 'react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { CalendarHeart, Plus } from 'lucide-react'
import { fmtDate, fmtDays } from '@/lib/format'
import type { LeaveBalance, LeaveRequest } from '@/lib/database.types'

/**
 * Fills the third cell of the balance row, which was otherwise empty whenever
 * someone only had two leave types in play.
 *
 * It answers the two questions the individual cards cannot: how much have I
 * used across everything, and when am I next off. Working-day and calendar-day
 * types are counted separately, because adding them is precisely the mistake
 * this application exists to stop.
 */
export function YearSummaryTile({
  balances,
  requests,
  leaveYear,
  onRequest,
}: {
  balances: LeaveBalance[]
  requests: LeaveRequest[]
  leaveYear: number
  onRequest: () => void
}) {
  const takenWorking = balances
    .filter((b) => b.unit === 'working_day')
    .reduce((s, b) => s + Number(b.taken_days), 0)

  const pendingWorking = balances
    .filter((b) => b.unit === 'working_day')
    .reduce((s, b) => s + Number(b.pending_days), 0)

  const next = useMemo(() => {
    const today = new Date()
    return requests
      .filter(
        (r) =>
          (r.status === 'approved' || r.status === 'pending_supervisor' || r.status === 'pending_hr') &&
          differenceInCalendarDays(parseISO(r.start_date), today) >= 0,
      )
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
  }, [requests])

  const daysAway = next ? differenceInCalendarDays(parseISO(next.start_date), new Date()) : null

  return (
    <div className="flex flex-col rounded-xl border border-dashed border-chai-200 bg-chai-50/50 p-3.5">
      <p className="text-sm font-semibold text-slate-900">Your {leaveYear} so far</p>

      <div className="mt-3 flex items-baseline gap-4">
        <div>
          <p className="text-2xl font-bold leading-none tabular-nums text-chai-700">
            {fmtDays(takenWorking)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">days taken</p>
        </div>
        {pendingWorking > 0 ? (
          <div>
            <p className="text-2xl font-bold leading-none tabular-nums text-chaiDarkGold">
              {fmtDays(pendingWorking)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">awaiting a decision</p>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-start gap-2 border-t border-chai-200/70 pt-2.5">
        <CalendarHeart className="mt-0.5 h-4 w-4 shrink-0 text-chai-500" aria-hidden />
        <div className="min-w-0 text-xs">
          {next ? (
            <>
              <p className="font-medium text-slate-800">
                Next off {fmtDate(next.start_date)}
                {daysAway === 0 ? ' — today' : daysAway === 1 ? ' — tomorrow' : ''}
              </p>
              <p className="text-slate-500">
                {daysAway !== null && daysAway > 1 ? `In ${daysAway} days. ` : ''}
                {next.status === 'approved' ? 'Approved.' : 'Waiting on a decision.'}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-800">Nothing booked</p>
              <p className="text-slate-500">
                You have no leave coming up. Time off is easier to cover when it is planned early.
              </p>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onRequest}
        className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-lg bg-chai-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-chai-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chai-500 focus-visible:ring-offset-2"
      >
        <Plus className="h-3.5 w-3.5" /> Request leave
      </button>
    </div>
  )
}
