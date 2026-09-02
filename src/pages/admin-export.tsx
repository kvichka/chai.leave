import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, Field, NativeSelect } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/Toast'
import {
  currentLeaveYear,
  useAllBalances,
  useAllRequests,
  useCompClaims,
  useEmployees,
  useEntitlements,
  useHolidays,
  useLeaveTypes,
  useSettings,
} from '@/hooks/useLeaveData'
import { downloadCsv, downloadXlsx, stamp } from '@/lib/export'
import { fmtDays } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { CsvRow } from '@/lib/csv'

/**
 * The export screen.
 *
 * Distinct from each tab's "Current data" button, which produces a file shaped
 * like the import template so it can be edited and uploaded back. This screen
 * is for taking a copy: a handover, an audit, a spreadsheet somebody wants to
 * pivot. So it favours readable columns - a supervisor's name rather than
 * their id, "working days" rather than an enum - over round-trip fidelity.
 *
 * Everything is filtered in the browser from data already loaded, and Row
 * Level Security decides what arrives in the first place: nothing here can
 * reach a row the person could not already see on screen.
 */
export function ExportTab() {
  const { data: settings } = useSettings()
  const thisYear = currentLeaveYear(settings)

  const [year, setYear] = useState(thisYear)
  const [employeeId, setEmployeeId] = useState('')
  const [department, setDepartment] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const { data: employees = [] } = useEmployees()
  const { data: types = [] } = useLeaveTypes()
  const { data: holidays = [] } = useHolidays()
  const { data: entitlements = [] } = useEntitlements(year)
  const { data: balances = [] } = useAllBalances(year)
  const { data: requests = [] } = useAllRequests(year)
  const { data: claims = [] } = useCompClaims()

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort() as string[],
    [employees],
  )

  /** Leave years with anything in them, newest first, plus this one. */
  const years = useMemo(() => {
    const set = new Set<number>([thisYear])
    for (const h of holidays) set.add(h.leave_year)
    return [...set].sort((a, b) => b - a)
  }, [holidays, thisYear])

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.full_name ?? '') : '')

  /** Whether a given employee passes the person and department filters. */
  const inScope = (id: string) => {
    if (employeeId && id !== employeeId) return false
    if (department && byId.get(id)?.department !== department) return false
    return true
  }

  const people = employees.filter((e) => inScope(e.id))

  const sets: { id: string; label: string; note: string; rows: () => CsvRow[] }[] = [
    {
      id: 'employees',
      label: 'Employees',
      note: 'Names, departments, reporting lines, hire dates',
      rows: () =>
        people.map((e) => ({
          staff_code: e.staff_code,
          full_name: e.full_name,
          full_name_kh: e.full_name_kh ?? '',
          email: e.email,
          department: e.department ?? '',
          position_title: e.position_title ?? '',
          supervisor: nameOf(e.supervisor_id),
          role: e.role,
          employment_status: e.employment_status,
          hire_date: e.hire_date,
          exit_date: e.exit_date ?? '',
          date_of_birth: e.date_of_birth ?? '',
          gender: e.gender ?? '',
        })),
    },
    {
      id: 'balances',
      label: `Leave balances ${year}`,
      note: 'Entitled, taken, pending and remaining, per leave type',
      rows: () =>
        balances
          .filter((b) => inScope(b.employee_id))
          .map((b) => ({
            staff_code: b.staff_code,
            full_name: b.full_name,
            department: b.department ?? '',
            leave_type: b.name_en,
            // Spelt out, because a column of numbers in a spreadsheet loses
            // the distinction and adding the two units together is the exact
            // mistake this system exists to prevent.
            unit: b.unit === 'calendar_day' ? 'calendar days' : 'working days',
            leave_year: b.leave_year,
            entitled_days: Number(b.entitled_days),
            carry_forward_days: Number(b.carry_forward_days),
            adjustment_days: Number(b.adjustment_days),
            taken_days: Number(b.taken_days),
            pending_days: Number(b.pending_days),
            available_days: Number(b.available_days),
          })),
    },
    {
      id: 'requests',
      label: `Leave requests ${year}`,
      note: 'Every request, its dates, day count and outcome',
      rows: () =>
        requests
          .filter((r) => inScope(r.employee_id))
          .map((r) => ({
            reference: r.request_ref,
            staff_code: byId.get(r.employee_id)?.staff_code ?? '',
            full_name: nameOf(r.employee_id),
            department: byId.get(r.employee_id)?.department ?? '',
            leave_type: types.find((t) => t.code === r.leave_type_code)?.name_en ?? r.leave_type_code,
            start_date: r.start_date,
            end_date: r.end_date,
            days_requested: Number(r.days_requested),
            status: r.status.replace(/_/g, ' '),
            reason: r.reason ?? '',
            supervisor_comment: r.supervisor_comment ?? '',
            hr_comment: r.hr_comment ?? '',
            submitted_at: r.submitted_at ?? '',
          })),
    },
    {
      id: 'comp_claims',
      label: 'Compensation claims',
      note: 'Time worked outside normal hours, and what it earned',
      rows: () =>
        claims
          .filter((c) => inScope(c.employee_id) && c.leave_year === year)
          .map((c) => ({
            staff_code: byId.get(c.employee_id)?.staff_code ?? '',
            full_name: nameOf(c.employee_id),
            worked_from: c.worked_date,
            worked_to: c.worked_to,
            days_earned: Number(c.days_earned),
            status: c.status.replace(/_/g, ' '),
            reason: c.reason,
            decided_by: nameOf(c.decided_by),
            decision_note: c.decision_note ?? '',
          })),
    },
    {
      id: 'entitlements',
      label: `Entitlements ${year}`,
      note: 'How each allowance was arrived at, including adjustments',
      rows: () =>
        entitlements
          .filter((x) => inScope(x.employee_id))
          .map((x) => ({
            staff_code: byId.get(x.employee_id)?.staff_code ?? '',
            full_name: nameOf(x.employee_id),
            leave_type_code: x.leave_type_code,
            leave_year: x.leave_year,
            base_days: Number(x.base_days),
            prorated_days: Number(x.prorated_days),
            carry_forward_days: Number(x.carry_forward_days),
            adjustment_days: Number(x.adjustment_days),
            adjustment_reason: x.adjustment_reason ?? '',
          })),
    },
    {
      id: 'leave_types',
      label: 'Leave types',
      note: 'The rules: units, day counts, notice periods',
      rows: () =>
        types.map((t) => ({
          code: t.code,
          parent_code: t.parent_code ?? '',
          name_en: t.name_en,
          name_kh: t.name_kh ?? '',
          unit: t.unit === 'calendar_day' ? 'calendar days' : 'working days',
          default_days: Number(t.default_days),
          is_prorated: t.is_prorated,
          max_carry_forward: Number(t.max_carry_forward),
          min_notice_days: t.min_notice_days,
          requires_attachment: t.requires_attachment,
          gender_restriction: t.gender_restriction ?? '',
          is_paid: t.is_paid,
          is_active: t.is_active,
        })),
    },
    {
      id: 'holidays',
      label: 'Public holidays',
      note: 'All years on file',
      rows: () =>
        holidays.map((h) => ({
          holiday_date: h.holiday_date,
          name_en: h.name_en,
          name_kh: h.name_kh ?? '',
          leave_year: h.leave_year,
          is_half_day: h.is_half_day,
        })),
    },
  ]

  const counts = useMemo(
    () => new Map(sets.map((s) => [s.id, s.rows().length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, types, holidays, entitlements, balances, requests, claims, employeeId, department, year],
  )

  const scopeLabel = [
    employeeId ? (byId.get(employeeId)?.full_name ?? '') : null,
    department || null,
  ]
    .filter(Boolean)
    .join(' · ')

  async function one(id: string, format: 'csv' | 'xlsx') {
    const set = sets.find((s) => s.id === id)
    if (!set) return
    const rows = set.rows()
    if (rows.length === 0) {
      toast.error('Nothing to export', 'That table has no rows for the filters you picked.')
      return
    }
    setBusy(true)
    try {
      const name = stamp(`chai_leave_${id}_${year}`)
      if (format === 'csv') downloadCsv(name, rows)
      else await downloadXlsx(name, rows)
    } finally {
      setBusy(false)
    }
  }

  async function everything() {
    setBusy(true)
    try {
      const { default: writeXlsxFile } = await import('write-excel-file')
      const present = sets.map((s) => ({ ...s, data: s.rows() })).filter((s) => s.data.length > 0)
      if (present.length === 0) {
        toast.error('Nothing to export', 'No rows match the filters you picked.')
        return
      }

      const sheets = present.map((s) => {
        const cols = Object.keys(s.data[0]!)
        return [
          cols.map((c) => ({ value: c, fontWeight: 'bold' as const })),
          ...s.data.map((r) =>
            cols.map((c) => {
              const v = r[c]
              if (typeof v === 'number') return { type: Number, value: v }
              if (typeof v === 'boolean') return { type: Boolean, value: v }
              return { type: String, value: v == null ? '' : String(v) }
            }),
          ),
        ]
      })

      await writeXlsxFile(sheets as never, {
        fileName: `${stamp(`chai_leave_all_${year}`)}.xlsx`,
        sheets: present.map((s) => s.id),
        columns: sheets.map((sheet) => (sheet[0] as unknown[]).map(() => ({ width: 22 }))),
      })
      toast.success(
        'Exported',
        `${present.length} sheets, ${present.reduce((n, s) => n + s.data.length, 0)} rows.`,
      )
    } catch {
      toast.error('Could not build the workbook', 'Try exporting the tables one at a time.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Take a copy of the leave data for a handover, an audit, or your own analysis. To edit data
        and upload it back instead, use the <span className="font-medium">Current data</span>{' '}
        button on the tab you want — those files match the import template.
      </p>

      <Card>
        <CardHeader title="What to include" description="Filters apply to every table below." />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Leave year">
            <NativeSelect value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                  {y === thisYear ? ' (current)' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Department" hint={department ? undefined : 'All departments'}>
            <NativeSelect
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value)
                setEmployeeId('')
              }}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Employee" hint={employeeId ? undefined : 'Everyone in scope'}>
            <NativeSelect value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Everyone</option>
              {employees
                .filter((e) => !department || e.department === department)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={() => void everything()} loading={busy}>
            <FileSpreadsheet className="h-4 w-4" /> Export everything, one workbook
          </Button>
          {scopeLabel ? (
            <span className="text-xs text-slate-500">
              Filtered to <span className="font-medium text-slate-700">{scopeLabel}</span>
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="One table at a time"
          description="Row counts reflect the filters above."
        />
        <ul className="divide-y divide-slate-100">
          {sets.map((s) => {
            const n = counts.get(s.id) ?? 0
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{s.label}</p>
                  <p className="text-xs text-slate-500">{s.note}</p>
                </div>

                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    n === 0 ? 'text-slate-300' : 'text-slate-500',
                  )}
                >
                  {fmtDays(n)} row{n === 1 ? '' : 's'}
                </span>

                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={n === 0 || busy}
                    onClick={() => void one(s.id, 'csv')}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={n === 0 || busy}
                    onClick={() => void one(s.id, 'xlsx')}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> XLSX
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
