import { useMemo, useState } from 'react'
import { CalendarX2, Inbox, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import {
  Card,
  CardHeader,
  CardSkeleton,
  EmptyState,
  StatusChip,
  TableSkeleton,
  Tooltip,
} from '@/components/ui/primitives'
import { RequestFormDialog } from '@/components/RequestFormDialog'
import { UpcomingHolidays } from '@/components/UpcomingHolidays'
import { YearSummaryTile } from '@/components/YearSummaryTile'
import { ReasonDialog } from '@/components/ReasonDialog'
import {
  currentLeaveYear,
  useLeaveTypes,
  useMyBalances,
  useMyRequests,
  useSettings,
} from '@/hooks/useLeaveData'
import { useCancelRequest, useDeleteDraft, useWithdrawRequest } from '@/hooks/useMutations'
import { fmtDateRange, fmtDays, isoDate, leaveTypeColor } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { LeaveBalance, LeaveRequest } from '@/lib/database.types'

export function MyLeavePage() {
  const { data: settings } = useSettings()
  const leaveYear = currentLeaveYear(settings)

  const { data: balances = [], isLoading: balancesLoading } = useMyBalances(leaveYear)
  const { data: requests = [], isLoading: requestsLoading } = useMyRequests()
  const { data: types = [] } = useLeaveTypes()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveRequest | null>(null)
  const [presetType, setPresetType] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null)
  const [withdrawing, setWithdrawing] = useState<LeaveRequest | null>(null)

  const cancelRequest = useCancelRequest()
  const withdrawRequest = useWithdrawRequest()
  const deleteDraft = useDeleteDraft()

  const typeName = useMemo(
    () => new Map(types.map((t) => [t.code, t.name_en])),
    [types],
  )

  // Only show a balance for something the employee actually has an entitlement to.
  const cards = balances.filter((b) => Number(b.entitled_days) > 0 || Number(b.taken_days) > 0)

  /**
   * Twelve equal-weight cards is not a dashboard, it is a list. Most staff touch
   * two leave types in a year; the other ten are zeros that push the ones that
   * matter off the screen.
   *
   * Full cards go to the everyday types and to anything actually in play this
   * year. The rest collapse to one line each - still visible, still accurate,
   * just not shouting.
   */
  const EVERYDAY = new Set(['ANNUAL', 'SICK'])
  const inPlay = (b: LeaveBalance) =>
    Number(b.taken_days) > 0 || Number(b.pending_days) > 0 || Number(b.draft_days) > 0
  const primary = cards.filter((b) => EVERYDAY.has(b.leave_type_code) || inPlay(b))
  const secondary = cards.filter((b) => !primary.includes(b))

  return (
    <>
      <PageHeader
        title="My leave"
        description={`Leave year ${leaveYear}. All figures are calculated by the server.`}
      />

      {/* ------------------------------------------------------- balances -- */}
      <section aria-labelledby="balances-heading" className="mb-6">
        <h2 id="balances-heading" className="sr-only">
          Balances
        </h2>
        {balancesLoading ? (
          <CardSkeleton count={3} />
        ) : cards.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarX2 className="h-8 w-8" />}
              title="No entitlements for this year yet"
              action={undefined}
            >
              HR generates entitlements at the start of each leave year. If you have just joined,
              ask HR to run it for {leaveYear}.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {primary.map((b) => (
                <BalanceCard
                  key={b.leave_type_code}
                  balance={b}
                  onRequest={(code) => {
                    setEditing(null)
                    setPresetType(code)
                    setFormOpen(true)
                  }}
                />
              ))}
              <YearSummaryTile
                balances={cards}
                requests={requests}
                leaveYear={leaveYear}
                onRequest={() => {
                  setEditing(null)
                  setPresetType(null)
                  setFormOpen(true)
                }}
              />
            </div>

            {secondary.length > 0 ? (
              <Card>
                <CardHeader
                  title="Also available to you"
                  description={`${secondary.length} other leave types, none used this year.`}
                />
                <ul className="grid gap-x-6 gap-y-1.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {secondary.map((b) => (
                    <li
                      key={b.leave_type_code}
                      className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0"
                    >
                      <span className="min-w-0 truncate text-sm text-slate-700" title={b.name_en}>
                        {b.name_en}
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-slate-900">
                        {fmtDays(b.available_days)}
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          {b.unit === 'calendar_day' ? 'cal. ' : ''}
                          {Number(b.available_days) === 1 ? 'day' : 'days'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        )}
      </section>

      <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ----------------------------------------------------- requests -- */}
        <section aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="mb-2 text-sm font-semibold text-slate-800">
            My requests
          </h2>

          {requestsLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : requests.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Inbox className="h-8 w-8" />}
                title="You have not requested any leave yet"
                action={
                  <Button
                    onClick={() => {
                      setEditing(null)
                      setFormOpen(true)
                    }}
                  >
                    <Plus className="h-4 w-4" /> Request leave
                  </Button>
                }
              >
                When you do, it will appear here with its status and who it is waiting on.
              </EmptyState>
            </Card>
          ) : (
            <div className="table-wrap">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Reference</th>
                    <th className="th">Type</th>
                    <th className="th">Dates</th>
                    <th className="th text-right">Days</th>
                    <th className="th">Status</th>
                    <th className="th">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="td font-mono text-xs text-slate-500">{r.request_ref}</td>
                      <td className="td">{typeName.get(r.leave_type_code) ?? r.leave_type_code}</td>
                      <td className="td">{fmtDateRange(r.start_date, r.end_date)}</td>
                      <td className="td text-right tabular-nums">{fmtDays(r.days_requested)}</td>
                      <td className="td">
                        <StatusChip status={r.status} />
                        {r.supervisor_comment || r.hr_comment ? (
                          <Tooltip label={r.hr_comment ?? r.supervisor_comment}>
                            <span className="ml-1.5 cursor-help text-xs text-slate-400 underline decoration-dotted">
                              note
                            </span>
                          </Tooltip>
                        ) : null}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {r.status === 'draft' ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditing(r)
                                  setFormOpen(true)
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteDraft.mutate(r.id)}
                                aria-label={`Delete draft ${r.request_ref}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : null}

                          {r.status === 'pending_supervisor' || r.status === 'pending_hr' ? (
                            <Button size="sm" variant="secondary" onClick={() => setWithdrawing(r)}>
                              <Undo2 className="h-3.5 w-3.5" /> Withdraw
                            </Button>
                          ) : null}

                          {r.status === 'approved' && r.start_date > isoDate(new Date()) ? (
                            <Button size="sm" variant="secondary" onClick={() => setCancelling(r)}>
                              <CalendarX2 className="h-3.5 w-3.5" /> Cancel
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ----------------------------------------------------- holidays -- */}
        <aside>
          <UpcomingHolidays />
        </aside>
      </div>

      <RequestFormDialog
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v)
          if (!v) setPresetType(null)
        }}
        presetType={presetType}
        editing={editing}
        leaveYear={leaveYear}
      />

      <ReasonDialog
        open={!!withdrawing}
        onOpenChange={(v) => !v && setWithdrawing(null)}
        title={`Withdraw ${withdrawing?.request_ref ?? ''}`}
        description="This pulls the request back before a decision is made. The days return to your balance."
        label="Why are you withdrawing it?"
        placeholder="Optional"
        confirmLabel="Withdraw request"
        loading={withdrawRequest.isPending}
        onConfirm={async (reason) => {
          await withdrawRequest.mutateAsync({ id: withdrawing!.id, reason })
          setWithdrawing(null)
        }}
      />

      <ReasonDialog
        open={!!cancelling}
        onOpenChange={(v) => !v && setCancelling(null)}
        title={`Cancel ${cancelling?.request_ref ?? ''}`}
        description="Approved leave that has not started yet can be canceled. The days go straight back into your balance."
        label="Reason for canceling"
        placeholder="Optional"
        confirmLabel="Cancel this leave"
        destructive
        loading={cancelRequest.isPending}
        onConfirm={async (reason) => {
          await cancelRequest.mutateAsync({ id: cancelling!.id, reason })
          setCancelling(null)
        }}
      />
    </>
  )
}


/**
 * One leave type, at a glance.
 *
 * The number people actually want is "how many do I have left", so that is the
 * only thing set at display size. Everything else supports it. Taken and
 * pending stay visually distinct — a request awaiting a decision is not the
 * same as a day already spent, and merging them is how the old spreadsheet
 * managed to over-book people without anyone noticing.
 */
function BalanceCard({
  balance: b,
  onRequest,
}: {
  balance: LeaveBalance
  onRequest: (code: string) => void
}) {
  const entitled = Number(b.entitled_days)
  const taken = Number(b.taken_days)
  const pending = Number(b.pending_days)
  const draft = Number(b.draft_days)
  const available = Number(b.available_days)
  const carried = Number(b.carry_forward_days)
  const adjustment = Number(b.adjustment_days)

  const denominator = Math.max(entitled, taken + pending, 0.0001)
  const takenPct = Math.min((taken / denominator) * 100, 100)
  const pendingPct = Math.min((pending / denominator) * 100, 100 - takenPct)
  const untouched = taken === 0 && pending === 0
  const accent = leaveTypeColor(b.leave_type_code)

  return (
    <button
      type="button"
      onClick={() => onRequest(b.leave_type_code)}
      disabled={available <= 0}
      className={cn(
        'group relative w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left',
        'transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chai-500',
        available > 0 ? 'hover:border-slate-300 hover:shadow-md' : 'cursor-default opacity-80',
      )}
      aria-label={
        available > 0
          ? `Request ${b.name_en}. ${available} of ${entitled} remaining.`
          : `${b.name_en}: none remaining`
      }
    >
      {/* Colour key, so Annual and Sick are told apart at a glance and the card
          matches its series in the dashboard charts. */}
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div className="pl-2">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-900" title={b.name_en}>
            {b.name_en}
          </p>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {b.unit === 'calendar_day' ? 'calendar' : 'working'}
          </span>
        </div>

        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className={cn(
              'text-3xl font-bold tabular-nums leading-none',
              available <= 0 ? 'text-slate-400' : 'text-slate-900',
            )}
          >
            {fmtDays(available)}
          </span>
          <span className="text-sm text-slate-500">
            of {fmtDays(entitled)} {available === 1 ? 'day' : 'days'} left
          </span>
        </div>

        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
          {untouched ? (
            // Nothing used yet: show the whole entitlement as available rather
            // than an empty grey trough that reads as "no data".
            <div className="w-full opacity-25" style={{ backgroundColor: accent }} />
          ) : (
            <>
              <div style={{ width: `${takenPct}%`, backgroundColor: accent }} />
              <div className="hatched" style={{ width: `${pendingPct}%` }} />
            </>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {untouched ? (
            <span className="text-slate-500">None used yet this year</span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 text-slate-600">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                />
                {fmtDays(taken)} taken
              </span>
              {pending > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-chaiDarkGold">
                  <span className="hatched h-2 w-2 rounded-full" aria-hidden />
                  {fmtDays(pending)} pending
                </span>
              ) : null}
            </>
          )}
          {draft > 0 ? <span className="text-slate-400">{fmtDays(draft)} in draft</span> : null}
        </div>

        {carried > 0 || adjustment !== 0 ? (
          <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
            {carried > 0
              ? `Includes ${fmtDays(carried)} carried forward${
                  Number(b.expired_carry_forward_days) > 0
                    ? `, ${fmtDays(b.expired_carry_forward_days)} now expired`
                    : ''
                }.`
              : null}
            {adjustment !== 0
              ? ` Adjustment ${adjustment > 0 ? '+' : ''}${fmtDays(adjustment)}: ${b.adjustment_reason}`
              : null}
          </p>
        ) : null}

        {available > 0 ? (
          <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-chai-700 opacity-0 transition-opacity group-hover:opacity-100">
            <Plus className="h-3 w-3" /> Request {b.name_en.toLowerCase()}
          </p>
        ) : null}
      </div>
    </button>
  )
}
