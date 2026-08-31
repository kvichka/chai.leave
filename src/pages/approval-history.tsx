import { useMemo, useState } from 'react'
import { Download, History, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Card,
  CardHeader,
  EmptyState,
  Input,
  NativeSelect,
  StatusChip,
  TableSkeleton,
  Tooltip,
} from '@/components/ui/primitives'
import { useDecisionHistory, useEmployees, useLeaveTypes } from '@/hooks/useLeaveData'
import { downloadCsv, stamp } from '@/lib/export'
import { fmtDate, fmtDateRange, fmtDateTime, fmtDays, STATUS_LABEL } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { LeaveStatus } from '@/lib/database.types'

const FILTERS: { value: 'all' | LeaveStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Canceled' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

/**
 * Everything already decided, for the people this viewer is allowed to see.
 *
 * The pending queue empties as you work through it, which is the point of a
 * queue — but it means the page has nothing to say about what you decided last
 * week, and "did I already approve that?" is a real question. Row Level
 * Security decides the scope: a supervisor sees their reporting tree, HR sees
 * everyone.
 */
export function ApprovalHistory({ leaveYear }: { leaveYear: number }) {
  const { data: requests = [], isLoading } = useDecisionHistory(leaveYear)
  const { data: employees = [] } = useEmployees()
  const { data: types = [] } = useLeaveTypes()

  const [status, setStatus] = useState<'all' | LeaveStatus>('all')
  const [search, setSearch] = useState('')

  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const typeName = useMemo(() => new Map(types.map((t) => [t.code, t.name_en])), [types])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return requests
      .map((r) => {
        const emp = empById.get(r.employee_id)
        // Whoever spoke last is the one who decided it.
        const decidedAt = r.hr_decision_at ?? r.supervisor_decision_at ?? r.cancelled_at
        const deciderId = r.hr_decision_at ? r.hr_id : r.supervisor_id
        const decidedBy =
          r.status === 'withdrawn'
            ? `${emp?.full_name ?? 'They'} (withdrew it)`
            : r.status === 'cancelled'
              ? (empById.get(deciderId ?? '')?.full_name ?? 'Canceled')
              : (empById.get(deciderId ?? '')?.full_name ?? '—')
        const note = r.hr_comment ?? r.supervisor_comment ?? r.cancellation_reason ?? null
        return {
          ...r,
          employeeName: emp?.full_name ?? 'Unknown',
          department: emp?.department ?? '',
          staffCode: emp?.staff_code ?? '',
          typeName: typeName.get(r.leave_type_code) ?? r.leave_type_code,
          decidedAt,
          decidedBy,
          note,
        }
      })
      .filter((r) => (status === 'all' ? true : r.status === status))
      .filter(
        (r) =>
          !q ||
          r.employeeName.toLowerCase().includes(q) ||
          r.request_ref.toLowerCase().includes(q) ||
          r.typeName.toLowerCase().includes(q) ||
          r.department.toLowerCase().includes(q),
      )
  }, [requests, empById, typeName, status, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length }
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [requests])

  function exportRows() {
    downloadCsv(
      stamp('leave_decisions'),
      rows.map((r) => ({
        request_ref: r.request_ref,
        staff_code: r.staffCode,
        employee: r.employeeName,
        department: r.department,
        leave_type: r.typeName,
        start_date: r.start_date,
        end_date: r.end_date,
        days: r.days_requested,
        status: STATUS_LABEL[r.status],
        submitted_at: r.submitted_at ?? '',
        decided_at: r.decidedAt ?? '',
        decided_by: r.decidedBy,
        note: r.note ?? '',
      })),
    )
  }

  return (
    <Card>
      <CardHeader
        title="Decision history"
        description={`Everything already decided in ${leaveYear}, for the people you can see.`}
        action={
          rows.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={exportRows}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={cn(
                'border-r border-slate-300 px-2.5 py-1 text-xs font-medium last:border-r-0',
                status === f.value
                  ? 'bg-chai-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {f.label}
              <span className={cn('ml-1', status === f.value ? 'text-white/70' : 'text-slate-400')}>
                {counts[f.value] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, reference, type…"
            aria-label="Search decision history"
            className="w-56 pl-8"
          />
        </div>

        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | LeaveStatus)}
          aria-label="Filter by status"
          className="w-40 sm:hidden"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label} ({counts[f.value] ?? 0})
            </option>
          ))}
        </NativeSelect>
      </div>

      {isLoading ? (
        <div className="p-3">
          <TableSkeleton rows={5} cols={6} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<History className="h-7 w-7" />} title="Nothing decided yet">
          {requests.length === 0
            ? `No leave has been approved, rejected or canceled in ${leaveYear} for anyone in your reporting line.`
            : 'No decisions match that filter. Try "All", or clear the search.'}
        </EmptyState>
      ) : (
        <div className="table-wrap border-0">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Employee</th>
                <th className="th">Type</th>
                <th className="th">Dates</th>
                <th className="th text-right">Days</th>
                <th className="th">Outcome</th>
                <th className="th">Decided</th>
                <th className="th">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="td">
                    <p className="font-medium text-slate-900">{r.employeeName}</p>
                    <p className="font-mono text-[11px] text-slate-500">{r.request_ref}</p>
                  </td>
                  <td className="td">{r.typeName}</td>
                  <td className="td">{fmtDateRange(r.start_date, r.end_date)}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.days_requested)}</td>
                  <td className="td">
                    <StatusChip status={r.status} />
                    {r.note ? (
                      <Tooltip label={r.note}>
                        <span className="ml-1.5 cursor-help text-xs text-slate-400 underline decoration-dotted">
                          note
                        </span>
                      </Tooltip>
                    ) : null}
                  </td>
                  <td className="td">
                    {r.decidedAt ? (
                      <Tooltip label={fmtDateTime(r.decidedAt)}>
                        <span className="cursor-help">{fmtDate(r.decidedAt)}</span>
                      </Tooltip>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="td">{r.decidedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
        This is a convenience view, not the audit trail. Every change — including who made it and
        what the row looked like before — is recorded permanently in Admin → Audit log, which
        nobody can edit or delete.
      </p>
    </Card>
  )
}
