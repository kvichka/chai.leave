import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  CalendarClock,
  Download,
  FileSpreadsheet,
  Hourglass,
  PlaneTakeoff,
  Scale,
  TrendingUp,
  UserRoundMinus,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import {
  Badge,
  Card,
  CardHeader,
  CardSkeleton,
  EmptyState,
  Input,
  KpiTile,
  NativeSelect,
  TableSkeleton,
} from '@/components/ui/primitives'
import { DataTable, type GroupBy } from '@/components/ui/DataTable'
import {
  currentLeaveYear,
  useAbsenceCalendar,
  useAllBalances,
  useCoverage,
  useEmployees,
  useLiability,
  useOutToday,
  usePendingApprovals,
  useSettings,
} from '@/hooks/useLeaveData'
import {
  AGING_COLOR,
  fmtDate,
  fmtDays,
  fmtPercent,
  isoDate,
  leaveTypeColor,
} from '@/lib/format'
import { downloadCsv, downloadXlsx, stamp } from '@/lib/export'
import type { ColumnDef } from '@tanstack/react-table'
import type { LeaveBalance } from '@/lib/database.types'
import { RemainingLeavePanel } from './hr-remaining-leave'

export function HrDashboardPage() {
  const { data: settings } = useSettings()
  const leaveYear = currentLeaveYear(settings)

  const { data: allPending = [], isLoading: pendingLoading } = usePendingApprovals()
  const { data: allOutToday = [] } = useOutToday()
  const { data: allBalances = [], isLoading: balancesLoading } = useAllBalances(leaveYear)
  const { data: allLiability = [] } = useLiability(leaveYear)
  const { data: allCoverage = [] } = useCoverage()
  const { data: employees = [] } = useEmployees()

  const today = new Date()
  const yearStart = `${leaveYear}-01-01`
  const yearEnd = `${leaveYear}-12-31`
  const { data: allYearAbsences = [] } = useAbsenceCalendar(yearStart, yearEnd)

  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [grouped, setGrouped] = useState(true)

  /**
   * One filter for the whole page. Filtering only the table at the bottom, as
   * this page used to, gives a screen where the headline numbers and the detail
   * disagree - worse than not filtering at all.
   */
  const inDept = <T extends { department?: string | null }>(list: T[]) =>
    department ? list.filter((r) => r.department === department) : list

  const pending = useMemo(() => inDept(allPending), [allPending, department])
  const outToday = useMemo(() => inDept(allOutToday), [allOutToday, department])
  const balances = useMemo(() => inDept(allBalances), [allBalances, department])
  const liability = useMemo(() => inDept(allLiability), [allLiability, department])
  const coverage = useMemo(() => inDept(allCoverage), [allCoverage, department])
  const yearAbsences = useMemo(() => inDept(allYearAbsences), [allYearAbsences, department])
  const staff = useMemo(
    () => (department ? employees.filter((e) => e.department === department) : employees),
    [employees, department],
  )

  /* --------------------------------------------------------------- KPIs -- */

  const avgDaysToDecision = useMemo(() => {
    // Decided requests are not in v_pending_approvals, so this is the live
    // waiting time of the open queue - the number that actually needs managing.
    if (pending.length === 0) return 0
    return pending.reduce((s, r) => s + r.days_waiting, 0) / pending.length
  }, [pending])

  const outThisWeek = useMemo(() => {
    const end = new Date(today)
    end.setDate(end.getDate() + 7)
    const from = isoDate(today)
    const to = isoDate(end)
    return new Set(
      yearAbsences
        .filter((a) => a.status === 'approved' && a.absence_date >= from && a.absence_date <= to)
        .map((a) => a.employee_id),
    ).size
  }, [yearAbsences, today])

  const annual = balances.filter((b) => b.leave_type_code === 'ANNUAL')
  const orgUtilization = useMemo(() => {
    const entitled = annual.reduce((s, b) => s + Number(b.entitled_days), 0)
    const taken = annual.reduce((s, b) => s + Number(b.taken_days), 0)
    return entitled > 0 ? (taken / entitled) * 100 : 0
  }, [annual])

  const totalLiability = liability.reduce((s, r) => s + Number(r.unused_days), 0)

  /* ------------------------------------------------------------- charts -- */

  const agingData = useMemo(() => {
    const buckets = ['0-2 days', '3-5 days', '6-10 days', '>10 days']
    return buckets.map((b) => ({
      bucket: b,
      count: pending.filter((r) => r.aging_bucket === b).length,
    }))
  }, [pending])

  const byDepartment = useMemo(
    () =>
      liability
        .map((l) => ({
          department: l.department,
          utilization: Number(l.utilization_pct),
          unused: Number(l.unused_days),
        }))
        .sort((a, b) => a.utilization - b.utilization),
    [liability],
  )

  const monthlyByType = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(leaveYear, i, 1).toLocaleString('en', { month: 'short' }),
      idx: i,
    }))
    const codes = [...new Set(yearAbsences.map((a) => a.leave_type_code))]
    const rows = months.map((m) => {
      const row: Record<string, string | number> = { month: m.month }
      for (const c of codes) row[c] = 0
      return row
    })
    for (const a of yearAbsences) {
      if (a.status !== 'approved') continue
      if (!a.is_working_day && a.unit === 'working_day') continue
      const idx = new Date(a.absence_date).getMonth()
      const row = rows[idx]
      if (row) row[a.leave_type_code] = Number(row[a.leave_type_code] ?? 0) + 1
    }
    return { rows, codes }
  }, [yearAbsences, leaveYear])

  const coverageRisks = useMemo(
    () =>
      coverage
        .filter((c) => c.is_coverage_risk && c.the_date >= isoDate(today))
        .slice(0, 40),
    [coverage, today],
  )

  /* ----------------------------------------------------- zero-usage flag -- */

  const zeroUsage = useMemo(() => {
    const cutoff = new Date(leaveYear, 8, 30) // 30 September
    if (today < cutoff) return []
    return annual.filter(
      (b) =>
        Number(b.taken_days) === 0 &&
        Number(b.entitled_days) > 0 &&
        b.employment_status !== 'exited',
    )
  }, [annual, leaveYear, today])

  /* -------------------------------------------------------------- table -- */

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort() as string[],
    [employees],
  )

  // balances is already department-filtered above.
  const tableRows = balances

  const columns = useMemo<ColumnDef<LeaveBalance, unknown>[]>(
    () => [
      { accessorKey: 'staff_code', header: 'Staff code' },
      { accessorKey: 'full_name', header: 'Name' },
      ...(grouped
        ? []
        : [
            {
              accessorKey: 'department',
              header: 'Department',
              cell: (c) => String(c.getValue() ?? '—'),
            } as ColumnDef<LeaveBalance, unknown>,
          ]),
      { accessorKey: 'name_en', header: 'Leave type' },
      {
        accessorKey: 'unit',
        header: 'Unit',
        cell: (c) => (c.getValue() === 'calendar_day' ? 'calendar' : 'working'),
      },
      {
        accessorKey: 'entitled_days',
        header: 'Entitled',
        cell: (c) => <span className="tabular-nums">{fmtDays(c.getValue() as number)}</span>,
      },
      {
        accessorKey: 'taken_days',
        header: 'Taken',
        cell: (c) => <span className="tabular-nums">{fmtDays(c.getValue() as number)}</span>,
      },
      {
        accessorKey: 'pending_days',
        header: 'Pending',
        cell: (c) => <span className="tabular-nums">{fmtDays(c.getValue() as number)}</span>,
      },
      {
        accessorKey: 'available_days',
        header: 'Available',
        cell: (c) => (
          <span className="font-medium tabular-nums">{fmtDays(c.getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'utilization_pct',
        header: 'Used',
        cell: (c) => <span className="tabular-nums">{fmtPercent(c.getValue() as number)}</span>,
      },
    ],
    [grouped],
  )

  /**
   * Section header summary. Only annual leave is totalled: every row in that
   * total is in working days, so it is a sum that means something. Adding
   * across leave types would mix working and calendar days.
   */
  const groupByDepartment = useMemo<GroupBy<LeaveBalance>>(
    () => ({
      value: (b) => b.department ?? '',
      emptyLabel: 'No department set',
      summary: (rows) => {
        const staffCount = new Set(rows.map((b) => b.employee_id)).size
        const annualLeft = rows
          .filter((b) => b.leave_type_code === 'ANNUAL')
          .reduce((sum, b) => sum + Number(b.available_days), 0)
        return (
          <>
            {staffCount} {staffCount === 1 ? 'person' : 'people'}
            <span className="mx-1.5 text-slate-300">|</span>
            <span className="font-medium text-slate-600">{fmtDays(annualLeft)}</span> days annual
            leave left
          </>
        )
      },
    }),
    [],
  )

  function exportRows() {
    return tableRows.map((b) => ({
      staff_code: b.staff_code,
      full_name: b.full_name,
      department: b.department ?? '',
      leave_year: b.leave_year,
      leave_type: b.name_en,
      unit: b.unit,
      entitled_days: Number(b.entitled_days),
      carry_forward_days: Number(b.carry_forward_days),
      adjustment_days: Number(b.adjustment_days),
      taken_days: Number(b.taken_days),
      pending_days: Number(b.pending_days),
      available_days: Number(b.available_days),
      utilization_pct: Number(b.utilization_pct),
    }))
  }

  return (
    <>
      <PageHeader
        title="HR dashboard"
        description={`Leave year ${leaveYear} · ${staff.length} staff${department ? ` in ${department}` : " on file"}`}
        actions={
          <>
            <NativeSelect
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Filter the whole dashboard by department"
              className="w-52"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="secondary"
              onClick={() => downloadCsv(stamp('chai_leave_balances'), exportRows())}
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() => void downloadXlsx(stamp('chai_leave_balances'), exportRows())}
            >
              <FileSpreadsheet className="h-4 w-4" /> XLSX
            </Button>
          </>
        }
      />

      {/* ---------------------------------------------------------- KPIs -- */}
      {balancesLoading ? (
        <CardSkeleton count={6} />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiTile
            label="Pending requests"
            value={pending.length}
            sub={pending.length ? `oldest ${Math.max(...pending.map((p) => p.days_waiting))} days` : 'queue clear'}
            tone={pending.length > 0 ? 'amber' : 'emerald'}
            icon={<Hourglass className="h-4 w-4" />}
          />
          <KpiTile
            label="Avg days waiting"
            value={avgDaysToDecision.toFixed(1)}
            sub="across the open queue"
            tone={avgDaysToDecision > 5 ? 'red' : 'slate'}
            icon={<CalendarClock className="h-4 w-4" />}
          />
          <KpiTile
            label="On leave today"
            value={outToday.length}
            sub={`${staff.length ? Math.round((outToday.length / staff.length) * 100) : 0}% of staff`}
            icon={<PlaneTakeoff className="h-4 w-4" />}
          />
          <KpiTile label="On leave this week" value={outThisWeek} sub="next 7 days" />
          <KpiTile
            label="Annual leave used"
            value={fmtPercent(orgUtilization, 1)}
            sub="org-wide"
            tone={orgUtilization < 40 ? 'amber' : 'slate'}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <KpiTile
            label="Accrued liability"
            value={`${fmtDays(totalLiability)}d`}
            sub="unused annual leave"
            tone="chai"
            icon={<Scale className="h-4 w-4" />}
          />
        </div>
      )}

      <div className="mb-6 grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        {/* -------------------------------------------------- out today -- */}
        <Card>
          <CardHeader
            title="Out today and this week"
            description={`${outToday.length} away right now`}
          />
          {outToday.length === 0 ? (
            <EmptyState icon={<PlaneTakeoff className="h-7 w-7" />} title="Everyone is in">
              Nobody has approved leave covering today.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {outToday.map((o) => (
                <li key={o.employee_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{o.full_name}</p>
                    <p className="text-xs text-slate-500">
                      {o.department ?? '—'} · {o.leave_type_name}
                      {o.day_portion !== 'full_day' ? ` · ${o.day_portion.replace('_', ' ')}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    back {fmtDate(o.return_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------- aging chart -- */}
        <Card>
          <CardHeader
            title="Approval queue by age"
            description="Anything in orange or red has been waiting too long."
          />
          <div className="h-56 px-2 pb-3">
            {pendingLoading ? (
              <div className="p-4">
                <TableSkeleton rows={3} cols={2} />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} margin={{ top: 12, right: 12, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <RTooltip cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="count" name="Requests" radius={[4, 4, 0, 0]}>
                    {agingData.map((d) => (
                      <Cell key={d.bucket} fill={AGING_COLOR[d.bucket] ?? '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        {/* ------------------------------------------ utilization by dept -- */}
        <Card>
          <CardHeader
            title="Annual leave utilization by department"
            description="Low utilization is a burnout and liability signal, not a saving."
          />
          <div className="h-64 px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byDepartment}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis
                  type="category"
                  dataKey="department"
                  width={110}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <RTooltip
                  cursor={{ fill: '#f1f5f9' }}
                  formatter={(v: number) => [`${v}%`, 'Used']}
                />
                <Bar dataKey="utilization" fill="#2b7f9a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* --------------------------------------------- monthly by type -- */}
        <Card>
          <CardHeader
            title={`Leave taken by month, ${leaveYear}`}
            description="Expect peaks around Khmer New Year and Pchum Ben."
          />
          <div className="h-64 px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthlyByType.rows}
                margin={{ top: 8, right: 12, left: -20, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <RTooltip cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {monthlyByType.codes.map((code) => (
                  <Bar key={code} dataKey={code} stackId="a" fill={leaveTypeColor(code)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>


      {/* ------------------------------------------------ leave still to take -- */}
      <div className="mb-6">
        <RemainingLeavePanel balances={balances} employees={employees} leaveYear={leaveYear} />
      </div>
      {/* --------------------------------------------------- coverage risk -- */}
      <Card className="mb-6">
        <CardHeader
          title="Coverage risk"
          description={`Future working days where more than ${settings?.coverage_risk_threshold ?? 30}% of a department is away.`}
        />
        {coverageRisks.length === 0 ? (
          <EmptyState icon={<AlertTriangle className="h-7 w-7" />} title="No coverage risks ahead">
            No department drops below the threshold on any scheduled working day in the next four
            months.
          </EmptyState>
        ) : (
          <div className="table-wrap border-0">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Department</th>
                  <th className="th text-right">Headcount</th>
                  <th className="th text-right">Away</th>
                  <th className="th text-right">Absent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coverageRisks.map((c) => (
                  <tr key={`${c.department}-${c.the_date}`} className="bg-amber-50/40">
                    <td className="td">{fmtDate(c.the_date)}</td>
                    <td className="td">{c.department}</td>
                    <td className="td text-right tabular-nums">{c.headcount}</td>
                    <td className="td text-right tabular-nums">{c.absent_count}</td>
                    <td className="td text-right">
                      <Badge tone={c.absent_pct > 50 ? 'red' : 'amber'}>
                        {fmtPercent(c.absent_pct, 0)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------ zero usage -- */}
      {zeroUsage.length > 0 ? (
        <Card className="mb-6 border-amber-200">
          <CardHeader
            title={`${zeroUsage.length} staff have taken no annual leave this year`}
            description="It is past 30 September. Unused leave is a burnout signal and an accruing liability."
            action={<UserRoundMinus className="h-4 w-4 text-amber-500" />}
          />
          <ul className="flex flex-wrap gap-2 p-4">
            {zeroUsage.map((b) => (
              <li key={b.employee_id}>
                <Badge tone="amber">
                  {b.full_name} · {fmtDays(b.entitled_days)}d untouched
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---------------------------------------------------- balance table -- */}
      <section aria-labelledby="all-balances">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 id="all-balances" className="text-sm font-semibold text-slate-800">
            All balances
          </h2>
          <div className="flex flex-wrap gap-2">
            <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={grouped}
                onChange={(e) => setGrouped(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-chai-600 focus:ring-chai-500"
              />
              Group by department
            </label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, staff code, type…"
              className="w-56"
              aria-label="Search balances"
            />
          </div>
        </div>

        <DataTable
          data={tableRows}
          columns={columns}
          loading={balancesLoading}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
          pageSize={30}
          groupBy={grouped ? groupByDepartment : undefined}
          initialSorting={[{ id: 'full_name', desc: false }]}
          empty={
            <EmptyState icon={<FileSpreadsheet className="h-7 w-7" />} title="No balances yet">
              Run <span className="font-medium">Generate entitlements</span> on the Admin page for{' '}
              {leaveYear}.
            </EmptyState>
          }
        />
        <p className="mt-2 text-xs text-slate-500">
          Working-day and calendar-day rows are shown side by side but must never be added
          together — they are different units.
        </p>
      </section>
    </>
  )
}
