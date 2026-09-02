import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { CalendarClock, CalendarRange, ChevronRight, PlaneTakeoff, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KpiTile,
  TableSkeleton,
} from '@/components/ui/primitives'
import {
  currentLeaveYear,
  useAllBalances,
  useAbsenceCalendar,
  useEmployees,
  useOutToday,
  usePendingApprovals,
  useSettings,
} from '@/hooks/useLeaveData'
import { useAuth } from '@/providers/AuthProvider'
import { fmtDate, fmtDays } from '@/lib/format'
import { Avatar } from '@/components/Avatar'
import { cn } from '@/lib/cn'
import type { Employee } from '@/lib/database.types'

interface TreeNode {
  employee: Employee
  depth: number
  directReports: number
}

/**
 * The org unit beneath the signed-in person, with the leave facts a supervisor
 * actually needs: who is out today, who has a request waiting on them, and who
 * is sitting on leave they have not booked.
 *
 * Row Level Security already restricts what can be read to this subtree, so the
 * flattening below is presentation, not access control.
 */
export function MyTeamPage() {
  const { employee } = useAuth()
  const { data: settings } = useSettings()
  const leaveYear = currentLeaveYear(settings)

  const { data: employees = [], isLoading } = useEmployees()
  const { data: balances = [] } = useAllBalances(leaveYear)
  const { data: outToday = [] } = useOutToday()
  const { data: pending = [] } = usePendingApprovals()
  const today = new Date()
  const weekAhead = new Date(today)
  weekAhead.setDate(weekAhead.getDate() + 7)
  const { data: weekAbsences = [] } = useAbsenceCalendar(
    today.toISOString().slice(0, 10),
    weekAhead.toISOString().slice(0, 10),
  )

  /** Depth-first walk down supervisor_id, so the hierarchy reads top to bottom. */
  const tree = useMemo(() => {
    if (!employee) return []
    const childrenOf = new Map<string, Employee[]>()
    for (const e of employees) {
      if (!e.supervisor_id) continue
      const list = childrenOf.get(e.supervisor_id) ?? []
      list.push(e)
      childrenOf.set(e.supervisor_id, list)
    }
    for (const list of childrenOf.values()) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name))
    }

    const out: TreeNode[] = []
    const walk = (id: string, depth: number) => {
      for (const child of childrenOf.get(id) ?? []) {
        out.push({
          employee: child,
          depth,
          directReports: (childrenOf.get(child.id) ?? []).length,
        })
        // Depth-capped for the same reason the SQL helper is: a data-entry
        // cycle must not hang the page.
        if (depth < 8) walk(child.id, depth + 1)
      }
    }
    walk(employee.id, 0)
    return out
  }, [employees, employee])

  const annualByEmployee = useMemo(() => {
    const m = new Map<
      string,
      { available: number; entitled: number; taken: number; pending: number }
    >()
    for (const b of balances) {
      if (b.leave_type_code !== 'ANNUAL') continue
      m.set(b.employee_id, {
        available: Number(b.available_days),
        entitled: Number(b.entitled_days),
        taken: Number(b.taken_days),
        pending: Number(b.pending_days),
      })
    }
    return m
  }, [balances])

  const outTodayIds = useMemo(() => new Set(outToday.map((o) => o.employee_id)), [outToday])
  const pendingByEmployee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pending) m.set(p.employee_id, (m.get(p.employee_id) ?? 0) + 1)
    return m
  }, [pending])

  const directCount = tree.filter((n) => n.depth === 0).length
  const teamOutToday = tree.filter((n) => outTodayIds.has(n.employee.id)).length
  const teamPending = tree.reduce((s, n) => s + (pendingByEmployee.get(n.employee.id) ?? 0), 0)
  const teamIds = useMemo(() => new Set(tree.map((n) => n.employee.id)), [tree])

  /** Distinct team members with approved leave on a working day in the next 7. */
  const awayThisWeek = useMemo(() => {
    const ids = new Set<string>()
    for (const a of weekAbsences) {
      if (a.status !== 'approved' || !a.is_working_day) continue
      if (teamIds.has(a.employee_id)) ids.add(a.employee_id)
    }
    return ids.size
  }, [weekAbsences, teamIds])
  const teamUnused = tree.reduce(
    (s, n) => s + (annualByEmployee.get(n.employee.id)?.available ?? 0),
    0,
  )

  if (isLoading) {
    return (
      <>
        <PageHeader title="My team" />
        <TableSkeleton rows={6} cols={5} />
      </>
    )
  }

  if (tree.length === 0) {
    return (
      <>
        <PageHeader title="My team" />
        <Card>
          <EmptyState icon={<Users className="h-8 w-8" />} title="Nobody reports to you">
            When someone is assigned to you as their supervisor, they will appear here along with
            their leave balances. HR sets reporting lines under Admin → Employees.
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="My team"
        description={`${directCount} direct report${directCount === 1 ? '' : 's'}${
          tree.length > directCount ? `, ${tree.length} people in total` : ''
        }. Everyone in your reporting line, however deep.`}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="Team size" value={tree.length} sub={`${directCount} report to you directly`} icon={<Users className="h-4 w-4" />} />
        <KpiTile
          label="Away today"
          value={teamOutToday}
          sub={teamOutToday === 0 ? 'everyone is in' : 'approved leave'}
          tone={teamOutToday > 0 ? 'chai' : 'slate'}
          icon={<PlaneTakeoff className="h-4 w-4" />}
        />
        <KpiTile
          label="Away this week"
          value={awayThisWeek}
          sub={awayThisWeek === 0 ? 'next 7 days' : `of ${tree.length} in the team`}
          tone={tree.length > 0 && awayThisWeek / tree.length > 0.3 ? "amber" : "slate"}
          icon={<CalendarRange className="h-4 w-4" />}
        />
        <KpiTile
          label="Waiting on a decision"
          value={teamPending}
          sub={teamPending > 0 ? 'in your approvals queue' : 'queue clear'}
          tone={teamPending > 0 ? 'amber' : 'emerald'}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <KpiTile
          className="sm:col-span-2 lg:col-span-2 xl:col-span-1"
          label="Annual leave unused"
          value={`${fmtDays(teamUnused)}d`}
          sub="across the team this year"
          tone="chai"
        />
      </div>

      <Card>
        <CardHeader
          title="Reporting line"
          description="Indented by level. Annual leave only — other types are on each person's own page."
          action={
            teamPending > 0 ? (
              <Link
                to="/approvals"
                className="inline-flex items-center gap-1 rounded-lg bg-chai-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-chai-700"
              >
                Review {teamPending} request{teamPending === 1 ? '' : 's'}
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : null
          }
        />

        <div className="table-wrap border-0">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Person</th>
                <th className="th">Department</th>
                <th className="th">Annual leave</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tree.map(({ employee: e, depth, directReports }) => {
                const annual = annualByEmployee.get(e.id)
                const away = outTodayIds.has(e.id)
                const waiting = pendingByEmployee.get(e.id) ?? 0
                const awayRow = outToday.find((o) => o.employee_id === e.id)

                return (
                  <tr key={e.id} className="hover:bg-slate-50/70">
                    <td className="td">
                      <div
                        className="flex items-center gap-2.5"
                        style={{ paddingLeft: `${depth * 1.25}rem` }}
                      >
                        {depth > 0 ? (
                          <span className="text-slate-300" aria-hidden>
                            └
                          </span>
                        ) : null}
                        <Avatar
                          fullName={e.full_name}
                          avatarPath={e.avatar_path}
                          avatarEmoji={e.avatar_emoji}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {e.full_name}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {e.position_title ?? '—'}
                            {directReports > 0 ? (
                              <span className="text-slate-400">
                                {' '}
                                · {directReports} report{directReports === 1 ? '' : 's'}
                              </span>
                            ) : null}
                          </p>
                          {/* Badges belong with the person, not in a column of
                              their own that reads "—" whenever the team is all
                              in — which is most days. */}
                          {away || waiting > 0 || e.employment_status !== 'active' ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {away ? (
                                <Badge tone="chai">
                                  Away{awayRow ? ` · back ${fmtDate(awayRow.return_date)}` : ''}
                                </Badge>
                              ) : null}
                              {waiting > 0 ? (
                                <Badge tone="amber">{waiting} awaiting you</Badge>
                              ) : null}
                              {e.employment_status !== 'active' ? (
                                <Badge tone="slate">
                                  {e.employment_status.replace('_', ' ')}
                                </Badge>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="td">{e.department ?? '—'}</td>

                    <td className="td">
                      {annual ? (
                        <AnnualLeaveBar annual={annual} />
                      ) : (
                        <span className="text-xs text-slate-400">no entitlement</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Unused leave is a burnout signal, not a saving. A bar flagged in gold is more than three
          quarters untouched — worth a conversation before it bunches up in December.
        </p>
      </Card>

      <div className="mt-5 grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <TeamBalanceChart tree={tree} annualByEmployee={annualByEmployee} />
        <TeamAbsenceChart leaveYear={leaveYear} teamIds={teamIds} />
      </div>
    </>
  )
}

/**
 * Taken, awaiting a decision, and still to book, as one bar.
 *
 * This replaced a Taken column and a Remaining column. Two numbers side by
 * side make a reader do the division; a bar shows the proportion directly,
 * which is the only thing a supervisor is actually reading them for. The
 * colours match the chart below, so the two agree.
 */
function AnnualLeaveBar({
  annual,
}: {
  annual: { available: number; entitled: number; taken: number; pending: number }
}) {
  const { available, entitled, taken, pending } = annual
  // Guard against a zero entitlement, and against a negative balance widening
  // a segment past the bar.
  const denominator = Math.max(entitled, taken + pending, 0.0001)
  const takenPct = Math.min((taken / denominator) * 100, 100)
  const pendingPct = Math.min((pending / denominator) * 100, 100 - takenPct)
  const mostlyUnused = entitled > 0 && available / entitled > 0.75

  return (
    <div className="min-w-[170px] max-w-[240px]">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-600">
          <span
            className={cn(
              'font-semibold tabular-nums',
              mostlyUnused ? 'text-chaiDarkGold' : 'text-slate-900',
            )}
          >
            {fmtDays(available)}
          </span>{' '}
          of {fmtDays(entitled)} left
        </span>
        {mostlyUnused ? (
          <span
            className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-chaiDarkGold"
            title="More than three quarters of the year's annual leave is still untouched"
          >
            mostly unused
          </span>
        ) : null}
      </div>

      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-chaiLightBlue"
        role="img"
        aria-label={`${fmtDays(taken)} taken, ${fmtDays(pending)} awaiting a decision, ${fmtDays(available)} still to book of ${fmtDays(entitled)}`}
      >
        <div style={{ width: `${takenPct}%`, backgroundColor: CHART_TAKEN }} />
        <div style={{ width: `${pendingPct}%`, backgroundColor: CHART_PENDING }} />
      </div>

      <p className="mt-1 text-[10px] text-slate-400">
        {fmtDays(taken)} taken
        {pending > 0 ? ` · ${fmtDays(pending)} awaiting you` : ''}
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- charts -- */

const CHART_TAKEN = '#003E78' // Dark Blue
const CHART_PENDING = '#F3B71B' // Gold
const CHART_REMAINING = '#D5E7EF' // Light Blue

/**
 * Annual leave per person, as one stacked bar each. A long pale tail is someone
 * who has not booked anything — the shape of the chart is the message, without
 * anyone having to read the numbers.
 */
function TeamBalanceChart({
  tree,
  annualByEmployee,
}: {
  tree: TreeNode[]
  annualByEmployee: Map<string, { available: number; entitled: number; taken: number }>
}) {
  const data = useMemo(
    () =>
      tree
        .map((n) => {
          const a = annualByEmployee.get(n.employee.id)
          if (!a) return null
          const pending = Math.max(a.entitled - a.taken - a.available, 0)
          return {
            name: n.employee.full_name.split(' ')[0] ?? n.employee.full_name,
            fullName: n.employee.full_name,
            taken: a.taken,
            pending,
            remaining: Math.max(a.available, 0),
          }
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .sort((a, b) => b.remaining - a.remaining),
    [tree, annualByEmployee],
  )

  return (
    <Card>
      <CardHeader
        title="Annual leave, per person"
        description="Taken, awaiting a decision, and still to book."
      />
      <div className="px-2 pb-3" style={{ height: Math.max(180, data.length * 44 + 60) }}>
        {data.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No annual leave entitlements yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={72}
                tick={{ fontSize: 11 }}
                stroke="#94a3b8"
              />
              <RTooltip
                cursor={{ fill: '#f1f5f9' }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                formatter={(v: number, k: string) => [`${v} days`, LABELS[k] ?? k]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(k) => LABELS[k] ?? k} />
              <Bar dataKey="taken" stackId="a" fill={CHART_TAKEN} radius={[4, 0, 0, 4]} />
              <Bar dataKey="pending" stackId="a" fill={CHART_PENDING} />
              <Bar dataKey="remaining" stackId="a" fill={CHART_REMAINING} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

const LABELS: Record<string, string> = {
  taken: 'Taken',
  pending: 'Pending',
  remaining: 'Still to book',
  days: 'Days away',
  peak: 'Most away at once',
}

/**
 * When the team is actually away, month by month. The line is the peak number
 * of people off on any single day that month, which is the number that decides
 * whether the work gets covered — a total of twelve absence days matters far
 * less if it is one person for twelve days than four people for three.
 */
function TeamAbsenceChart({ leaveYear, teamIds }: { leaveYear: number; teamIds: Set<string> }) {
  const { data: absences = [] } = useAbsenceCalendar(`${leaveYear}-01-01`, `${leaveYear}-12-31`)

  const data = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(leaveYear, i, 1).toLocaleString('en', { month: 'short' }),
      days: 0,
      peak: 0,
      perDay: new Map<string, Set<string>>(),
    }))

    for (const a of absences) {
      if (!teamIds.has(a.employee_id)) continue
      if (a.status !== 'approved') continue
      if (!a.is_working_day) continue
      const idx = new Date(a.absence_date).getMonth()
      const m = months[idx]
      if (!m) continue
      m.days += 1
      const set = m.perDay.get(a.absence_date) ?? new Set<string>()
      set.add(a.employee_id)
      m.perDay.set(a.absence_date, set)
    }

    return months.map((m) => ({
      month: m.month,
      days: m.days,
      peak: Math.max(0, ...[...m.perDay.values()].map((s) => s.size)),
    }))
  }, [absences, teamIds, leaveYear])

  const total = data.reduce((s, m) => s + m.days, 0)

  return (
    <Card>
      <CardHeader
        title={`When the team is away, ${leaveYear}`}
        description="Approved working days. The line is the most people off on any single day."
      />
      <div className="h-64 px-2 pb-3">
        {total === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            No approved leave recorded for your team this year yet.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <RTooltip
                cursor={{ fill: '#f1f5f9' }}
                formatter={(v: number, k: string) => [v, LABELS[k] ?? k]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(k) => LABELS[k] ?? k} />
              <Bar dataKey="days" fill={CHART_TAKEN} radius={[4, 4, 0, 0]} />
              <Line
                type="monotone"
                dataKey="peak"
                stroke={CHART_PENDING}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
