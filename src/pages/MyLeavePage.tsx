import { useMemo, useState } from 'react'
import { CalendarX2, Inbox, Minus, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
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
import { MonthAtAGlance } from '@/components/MonthAtAGlance'
import { CompClaimsPanel } from '@/components/CompClaimsPanel'
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

  const secondaryGroups = useMemo(() => groupSecondary(secondary), [secondary])

  // Collapsed by default. These are the leave types nobody touches in a normal
  // year, so the four headings are the useful view and the rows are the detail.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

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
              <div className="sm:col-span-2 xl:col-span-3">
                <MonthAtAGlance requests={requests} />
              </div>
            </div>

            {secondary.length > 0 ? (
              <Card>
                <CardHeader
                  title="Also available to you"
                  description={`${secondary.length} other leave types, none used this year.`}
                />
                <div className="grid gap-x-10 gap-y-2 p-4 sm:grid-cols-2">
                  {secondaryGroups.map((group) => (
                    <section key={group.label} aria-label={group.label}>
                      <h3>
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.label)}
                          aria-expanded={openGroups.has(group.label)}
                          className="-mx-1.5 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-chai-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chai-500"
                        >
                          <span
                            aria-hidden
                            className="grid h-4 w-4 shrink-0 place-items-center rounded border border-chai-300 bg-white text-chai-700"
                          >
                            {openGroups.has(group.label) ? (
                              <Minus className="h-2.5 w-2.5" />
                            ) : (
                              <Plus className="h-2.5 w-2.5" />
                            )}
                          </span>
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-chai-700">
                            {group.label}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] font-normal normal-case tracking-normal text-slate-400">
                            {/* A count, not a total. Summing these would add
                                working days to calendar days. */}
                            {group.items.length} {group.items.length === 1 ? 'type' : 'types'}
                          </span>
                        </button>
                      </h3>
                      <ul className={cn('mt-1', openGroups.has(group.label) ? '' : 'hidden')}>
                        {group.items.map((b) => (
                          <li
                            key={b.leave_type_code}
                            className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0"
                          >
                            {/* Wraps rather than truncates. The prefix the
                                group heading already states is stripped, so
                                most of these now fit on one line anyway. */}
                            <span className="text-sm leading-snug text-slate-700" title={b.name_en}>
                              {shortLeaveLabel(b.leave_type_code, b.name_en)}
                            </span>
                            <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-slate-900">
                              {fmtDays(b.available_days)}
                              <span className="ml-1 text-xs font-normal text-slate-400">
                                {Number(b.available_days) === 1 ? 'day' : 'days'}
                              </span>
                              {b.unit === 'calendar_day' ? (
                                <span
                                  className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-chaiDarkGold"
                                  title="Counted in calendar days — weekends and public holidays included"
                                >
                                  cal
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </section>

      <section className="mb-6">
        <CompClaimsPanel />
      </section>

      <div className="grid gap-6 [&>*]:min-w-0">
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
            <ul className="space-y-2">
              {requests.map((r) => {
                const isDraft = r.status === 'draft'
                const waiting = r.status === 'pending_supervisor' || r.status === 'pending_hr'
                const cancellable = r.status === 'approved' && r.start_date > isoDate(new Date())
                const note = r.hr_comment ?? r.supervisor_comment
                const accent = leaveTypeColor(r.leave_type_code)

                return (
                  <li key={r.id}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 pl-0 transition-shadow hover:shadow-sm">
                      {/* The leave type's colour, matching the balance cards
                          and the calendar, so a row is identifiable before
                          reading a word of it. */}
                      <span
                        className="h-9 w-1 shrink-0 rounded-r"
                        style={{ backgroundColor: accent }}
                        aria-hidden
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {typeName.get(r.leave_type_code) ?? r.leave_type_code}
                        </p>
                        {/* The reference is kept on the row's tooltip rather
                            than in a column: it matters only when quoting a
                            request to HR, which is rare. */}
                        <p
                          className="mt-0.5 text-xs text-slate-500"
                          title={`Reference ${r.request_ref}`}
                        >
                          {fmtDateRange(r.start_date, r.end_date)}
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="tabular-nums">{fmtDays(r.days_requested)}</span>{' '}
                          {Number(r.days_requested) === 1 ? 'day' : 'days'}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <StatusChip status={r.status} />
                        {note ? (
                          <Tooltip label={note}>
                            <span className="cursor-help text-xs text-slate-400 underline decoration-dotted">
                              note
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {isDraft ? (
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

                        {waiting ? (
                          <Button size="sm" variant="secondary" onClick={() => setWithdrawing(r)}>
                            <Undo2 className="h-3.5 w-3.5" /> Withdraw
                          </Button>
                        ) : null}

                        {cancellable ? (
                          <Button size="sm" variant="secondary" onClick={() => setCancelling(r)}>
                            <CalendarX2 className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

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
/**
 * Presentation grouping for the leave types nobody uses in a normal year.
 *
 * Grouping on leave_types.parent_code was the obvious move and it is not good
 * enough: it yields seven buckets, four of them singletons, which is no less
 * crowded than the flat list it replaced. These four are the categories a
 * person actually recognises.
 *
 * Anything not listed falls into "Other leave", under its full name. HR can
 * add leave types from the Admin page, and a new one must never disappear
 * because it was not in this map.
 */
const SECONDARY_GROUPS: { label: string; codes: string[] }[] = [
  { label: 'Time for yourself', codes: ['LEARNING', 'MENTAL_HEALTH'] },
  { label: 'Family and bereavement', codes: ['SPECIAL_SIB_GP', 'SPECIAL_IMMEDIATE'] },
  {
    label: 'Becoming a parent',
    codes: [
      'MATERNITY',
      'MATERNITY_EXT',
      'PATERNITY',
      'ADOPT_UNDER6',
      'ADOPT_UNDER6_EXT',
      'ADOPT_OVER6',
    ],
  },
  { label: 'Unpaid', codes: ['UNPAID'] },
]

/**
 * Shorter labels for the grouped list. The group heading carries the prefix,
 * so repeating "Special Leave -" or "Adoption Leave -" on every row only
 * pushed the useful half of the name off the end with an ellipsis.
 *
 * The full name is still on the row's title attribute.
 */
const SHORT_LEAVE_LABEL: Record<string, string> = {
  LEARNING: 'Learning day',
  MENTAL_HEALTH: 'Mental health day',
  SPECIAL_SIB_GP: 'Sibling or grandparent',
  SPECIAL_IMMEDIATE: 'Spouse, child, parent or parent-in-law',
  MATERNITY: 'Maternity',
  MATERNITY_EXT: 'Maternity — additional month',
  PATERNITY: 'Paternity',
  ADOPT_UNDER6: 'Adoption — child 6 or under',
  ADOPT_UNDER6_EXT: 'Adoption — additional month',
  ADOPT_OVER6: 'Adoption — child over 6',
  UNPAID: 'Leave without pay',
}

function shortLeaveLabel(code: string, fallback: string): string {
  return SHORT_LEAVE_LABEL[code] ?? fallback
}

function groupSecondary(rows: LeaveBalance[]): { label: string; items: LeaveBalance[] }[] {
  const remaining = new Set(rows.map((r) => r.leave_type_code))
  const groups: { label: string; items: LeaveBalance[] }[] = []

  for (const group of SECONDARY_GROUPS) {
    // Follow the configured order within a group, not the query's.
    const items = group.codes
      .map((code) => rows.find((r) => r.leave_type_code === code))
      .filter((r): r is LeaveBalance => Boolean(r))
    for (const item of items) remaining.delete(item.leave_type_code)
    if (items.length > 0) groups.push({ label: group.label, items })
  }

  const leftovers = rows.filter((r) => remaining.has(r.leave_type_code))
  if (leftovers.length > 0) groups.push({ label: 'Other leave', items: leftovers })

  return groups
}

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

  // Donut geometry. Drawn by hand rather than with Recharts: this page is the
  // one everybody opens, and importing a chart library here would pull the
  // 370 kB charts chunk into its first paint for two small rings.
  const RADIUS = 25
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
  const takenArc = (takenPct / 100) * CIRCUMFERENCE
  const pendingArc = (pendingPct / 100) * CIRCUMFERENCE
  // Ids must be unique per card or every donut reuses the first one's pattern.
  const hatchId = `pending-hatch-${b.leave_type_code}`
  const usedPct = Math.round(takenPct + pendingPct)

  return (
    <button
      type="button"
      onClick={() => onRequest(b.leave_type_code)}
      disabled={available <= 0}
      className={cn(
        'group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-white',
        'p-4 pt-3.5 text-left transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chai-500',
        available > 0
          ? 'border-slate-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-lg'
          : 'cursor-default border-slate-200/80 bg-slate-50/40',
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
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-900" title={b.name_en}>
            {b.name_en}
          </p>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{ backgroundColor: `${accent}14`, color: accent }}
            title={
              b.unit === 'calendar_day'
                ? 'Counted in calendar days — weekends and public holidays included'
                : 'Counted in working days — weekends and public holidays excluded'
            }
          >
            {b.unit === 'calendar_day' ? 'calendar' : 'working'}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3.5">
          <div className="relative shrink-0">
            <svg viewBox="0 0 60 60" className="h-[58px] w-[58px]" role="presentation">
              <defs>
                <pattern
                  id={hatchId}
                  width="4"
                  height="4"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="4" height="4" fill={accent} opacity="0.2" />
                  <line x1="0" y1="0" x2="0" y2="4" stroke={accent} strokeWidth="2" opacity="0.8" />
                </pattern>
              </defs>

              {/* The remaining balance is the full ring underneath. */}
              <circle
                cx="30"
                cy="30"
                r={RADIUS}
                fill="none"
                strokeWidth="9"
                className="stroke-slate-100"
              />

              {untouched ? (
                // Nothing used: a faint complete ring. An empty grey circle
                // reads as "no data" rather than "all of it is still yours".
                <circle
                  cx="30"
                  cy="30"
                  r={RADIUS}
                  fill="none"
                  strokeWidth="9"
                  stroke={accent}
                  opacity="0.22"
                />
              ) : (
                <>
                  <circle
                    cx="30"
                    cy="30"
                    r={RADIUS}
                    fill="none"
                    strokeWidth="9"
                    stroke={accent}
                    strokeLinecap="butt"
                    strokeDasharray={`${takenArc} ${CIRCUMFERENCE}`}
                    transform="rotate(-90 30 30)"
                  />
                  {pending > 0 ? (
                    <circle
                      cx="30"
                      cy="30"
                      r={RADIUS}
                      fill="none"
                      strokeWidth="9"
                      stroke={`url(#${hatchId})`}
                      strokeLinecap="butt"
                      strokeDasharray={`${pendingArc} ${CIRCUMFERENCE}`}
                      strokeDashoffset={-takenArc}
                      transform="rotate(-90 30 30)"
                    />
                  ) : null}
                </>
              )}
            </svg>
            <span
              className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] font-semibold tabular-nums text-slate-400"
              aria-hidden
            >
              {untouched ? '0%' : `${usedPct}%`}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'text-3xl font-bold tabular-nums leading-none',
                  available <= 0 ? 'text-slate-400' : 'text-slate-900',
                )}
              >
                {fmtDays(available)}
              </span>
              <span className="text-sm text-slate-500">
                of {fmtDays(entitled)} left
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {available === 1 ? 'day' : 'days'} remaining this year
            </p>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
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

          {/* Sits on the same line as the usage legend rather than below it:
              the card header already names the leave type, so "Request" alone
              is unambiguous and the card stays one row shorter. Visible at
              rest because a phone has no hover to reveal it with. */}
          {available > 0 ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-semibold text-chai-700 opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Plus className="h-3 w-3" /> Request
            </span>
          ) : null}
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

      </div>
    </button>
  )
}
