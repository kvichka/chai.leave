import { useMemo, useState } from 'react'
import { Download, Send, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { downloadCsv, stamp } from '@/lib/export'
import { fmtDays, fmtPercent } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Employee, LeaveBalance } from '@/lib/database.types'

/**
 * "Who still has leave to take, and whose supervisor do I tell?"
 *
 * Unused annual leave is a burnout signal and an accruing liability, and it is
 * only actionable if you can hand a specific supervisor a specific list. So the
 * default view is grouped by supervisor rather than by person.
 */
export function RemainingLeavePanel({
  balances,
  employees,
  leaveYear,
}: {
  balances: LeaveBalance[]
  employees: Employee[]
  leaveYear: number
}) {
  const [grouping, setGrouping] = useState<'supervisor' | 'person'>('supervisor')

  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  /**
   * How far through the leave year we are. A person sitting on most of their
   * entitlement in February is unremarkable; in October it needs a conversation.
   */
  const yearProgress = useMemo(() => {
    const now = new Date()
    if (now.getFullYear() !== leaveYear) return now.getFullYear() > leaveYear ? 1 : 0
    const start = new Date(leaveYear, 0, 1).getTime()
    const end = new Date(leaveYear + 1, 0, 1).getTime()
    return (now.getTime() - start) / (end - start)
  }, [leaveYear])

  const rows = useMemo(
    () =>
      balances
        .filter(
          (b) =>
            b.leave_type_code === 'ANNUAL' &&
            b.employment_status !== 'exited' &&
            Number(b.entitled_days) > 0,
        )
        .map((b) => {
          const entitled = Number(b.entitled_days)
          const remaining = Number(b.available_days)
          const usedPct = entitled > 0 ? ((entitled - remaining) / entitled) * 100 : 0
          const supervisor = b.supervisor_id ? empById.get(b.supervisor_id) : undefined
          return {
            employee_id: b.employee_id,
            name: b.full_name,
            staff_code: b.staff_code,
            department: b.department ?? '(unassigned)',
            supervisorName: supervisor?.full_name ?? 'No supervisor',
            supervisorEmail: supervisor?.email ?? '',
            entitled,
            taken: Number(b.taken_days),
            pending: Number(b.pending_days),
            remaining,
            usedPct,
            // Behind where they ought to be by this point in the year.
            behind: usedPct / 100 < yearProgress - 0.25,
          }
        })
        .sort((a, b) => b.remaining - a.remaining),
    [balances, empById, yearProgress],
  )

  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0)
  const behindCount = rows.filter((r) => r.behind).length

  const bySupervisor = useMemo(() => {
    const map = new Map<string, { email: string; people: typeof rows }>()
    for (const r of rows) {
      const entry = map.get(r.supervisorName) ?? { email: r.supervisorEmail, people: [] }
      entry.people.push(r)
      map.set(r.supervisorName, entry)
    }
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        email: v.email,
        people: v.people,
        totalRemaining: v.people.reduce((s, p) => s + p.remaining, 0),
        behind: v.people.filter((p) => p.behind).length,
      }))
      .sort((a, b) => b.totalRemaining - a.totalRemaining)
  }, [rows])

  function exportRows() {
    downloadCsv(
      stamp('leave_still_to_take'),
      rows.map((r) => ({
        staff_code: r.staff_code,
        name: r.name,
        department: r.department,
        supervisor: r.supervisorName,
        supervisor_email: r.supervisorEmail,
        entitled_days: r.entitled,
        taken_days: r.taken,
        pending_days: r.pending,
        remaining_days: r.remaining,
        used_pct: Math.round(r.usedPct),
        behind_schedule: r.behind ? 'yes' : 'no',
      })),
    )
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title="Leave still to take" />
        <EmptyState icon={<TrendingDown className="h-7 w-7" />} title="Nothing to show">
          No annual leave entitlements match the current filter.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Leave still to take"
        description={`${fmtDays(totalRemaining)} days across ${rows.length} staff. ${
          behindCount > 0
            ? `${behindCount} are well behind for this point in the year.`
            : 'Nobody is significantly behind.'
        }`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
              {(['supervisor', 'person'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrouping(g)}
                  aria-pressed={grouping === g}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium capitalize',
                    grouping === g
                      ? 'bg-chai-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  By {g}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" onClick={exportRows}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        }
      />

      {grouping === 'supervisor' ? (
        <ul className="divide-y divide-slate-100">
          {bySupervisor.map((s) => (
            <li key={s.name} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{s.name}</p>
                  {s.email ? (
                    <p className="truncate text-xs text-slate-500">{s.email}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {s.behind > 0 ? (
                    <Badge tone="amber">{s.behind} behind schedule</Badge>
                  ) : null}
                  <span className="text-sm tabular-nums text-slate-700">
                    {fmtDays(s.totalRemaining)} days across {s.people.length}
                  </span>
                  {s.email ? (
                    <a
                      href={buildMailto(s.email, s.name, s.people, leaveYear)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Send className="h-3 w-3" /> Draft email
                    </a>
                  ) : null}
                </div>
              </div>

              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {s.people.map((p) => (
                  <li
                    key={p.employee_id}
                    className={cn(
                      'text-xs',
                      p.behind ? 'font-medium text-chaiDarkGold' : 'text-slate-600',
                    )}
                  >
                    {p.name} — {fmtDays(p.remaining)} left of {fmtDays(p.entitled)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap border-0">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Name</th>
                <th className="th">Department</th>
                <th className="th">Supervisor</th>
                <th className="th text-right">Entitled</th>
                <th className="th text-right">Taken</th>
                <th className="th text-right">Pending</th>
                <th className="th text-right">Remaining</th>
                <th className="th text-right">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.employee_id}
                  className={cn('hover:bg-slate-50/70', r.behind && 'bg-chaiLightGold/25')}
                >
                  <td className="td">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.staff_code}</p>
                  </td>
                  <td className="td">{r.department}</td>
                  <td className="td">{r.supervisorName}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.entitled)}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.taken)}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.pending)}</td>
                  <td className="td text-right font-semibold tabular-nums">
                    {fmtDays(r.remaining)}
                  </td>
                  <td className="td text-right">
                    <span
                      className={cn(
                        'tabular-nums',
                        r.behind ? 'font-medium text-chaiDarkGold' : 'text-slate-600',
                      )}
                    >
                      {fmtPercent(r.usedPct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
        Highlighted rows are more than 25 percentage points behind where the calendar is. That
        is a prompt for a conversation, not a rule — someone may have leave booked for December.
      </p>
    </Card>
  )
}

/**
 * A pre-filled draft rather than an automated send: the supervisor conversation
 * should come from a person, and HR can edit it before it goes.
 */
function buildMailto(
  email: string,
  supervisorName: string,
  people: { name: string; remaining: number; entitled: number }[],
  leaveYear: number,
): string {
  const lines = people.map((p) => `  - ${p.name}: ${p.remaining} of ${p.entitled} days remaining`)
  const body = [
    `Hello ${supervisorName.split(' ')[0]},`,
    '',
    `A quick note on annual leave balances in your team for ${leaveYear}:`,
    '',
    ...lines,
    '',
    'Unused leave tends to bunch up at the end of the year, which is hard on the person and hard to cover.',
    'Could you talk to them about booking some time?',
    '',
    'Thank you.',
  ].join('\n')

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    `Annual leave balances in your team (${leaveYear})`,
  )}&body=${encodeURIComponent(body)}`
}
