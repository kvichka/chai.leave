import { useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  AlertTriangle,
  CalendarDays,
  Download,
  History,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  TableSkeleton,
  Textarea,
} from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/Dialog'
import {
  currentLeaveYear,
  useAllBalances,
  useAuditLog,
  useEmployees,
  useEntitlements,
  useHolidays,
  useLeaveTypes,
  useSettings,
} from '@/hooks/useLeaveData'
import {
  useAdjustEntitlement,
  useCarryForward,
  useDeleteHoliday,
  useGenerateEntitlements,
  useSaveHolidays,
  useSaveLeaveType,
} from '@/hooks/useMutations'
import { EmployeesTab } from './admin-employees'
import { ExportTab } from './admin-export'
import {
  EntitlementBulkImport,
  HolidayBulkImport,
  LeaveTypeBulkImport,
} from './admin-bulk-imports'
import { fmtDate, fmtDateTime, fmtDays } from '@/lib/format'
import type { LeaveType } from '@/lib/database.types'
import { cn } from '@/lib/cn'

const TABS = [
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'types', label: 'Leave types', icon: Wallet },
  { id: 'holidays', label: 'Public holidays', icon: CalendarDays },
  { id: 'entitlements', label: 'Entitlements', icon: RefreshCw },
  { id: 'audit', label: 'Audit log', icon: History },
  { id: 'export', label: 'Export data', icon: Download },
] as const

export function AdminPage() {
  const [tab, setTab] = useState<string>('employees')
  const { data: settings } = useSettings()
  const leaveYear = currentLeaveYear(settings)

  return (
    <>
      <PageHeader
        title="Administration"
        description="Employees, leave types, holidays, entitlements, exports and the audit trail."
      />

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map(({ id, label, icon: Icon }) => (
            <Tabs.Trigger
              key={id}
              value={id}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === id
                  ? 'border-chai-600 text-chai-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="employees">
          <EmployeesTab />
        </Tabs.Content>
        <Tabs.Content value="types">
          <LeaveTypesTab />
        </Tabs.Content>
        <Tabs.Content value="holidays">
          <HolidaysTab />
        </Tabs.Content>
        <Tabs.Content value="entitlements">
          <EntitlementsTab leaveYear={leaveYear} />
        </Tabs.Content>
        <Tabs.Content value="export">
          <ExportTab />
        </Tabs.Content>
        <Tabs.Content value="audit">
          <AuditTab />
        </Tabs.Content>
      </Tabs.Root>
    </>
  )
}


/* ========================================================= LEAVE TYPES === */

function LeaveTypesTab() {
  const { data: types = [], isLoading } = useLeaveTypes()
  const { data: balances = [] } = useAllBalances(new Date().getFullYear())
  const save = useSaveLeaveType()
  const [editing, setEditing] = useState<LeaveType | null>(null)

  const approvedByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of balances) {
      m.set(b.leave_type_code, (m.get(b.leave_type_code) ?? 0) + Number(b.taken_days))
    }
    return m
  }, [balances])

  const unitChanged = editing
    ? editing.unit !== types.find((t) => t.code === editing.code)?.unit
    : false
  const hasApproved = editing ? (approvedByType.get(editing.code) ?? 0) > 0 : false

  if (isLoading) return <TableSkeleton rows={10} cols={7} />

  return (
    <>
      <LeaveTypeBulkImport types={types} />

      <div className="table-wrap">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Name</th>
              <th className="th">Unit</th>
              <th className="th text-right">Default days</th>
              <th className="th">Flags</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {types.map((t) => (
              <tr key={t.code} className={cn('hover:bg-slate-50/70', !t.is_active && 'opacity-50')}>
                <td className="td font-mono text-xs">
                  {t.parent_code ? <span className="text-slate-300">└ </span> : null}
                  {t.code}
                </td>
                <td className="td">{t.name_en}</td>
                <td className="td">
                  <Badge tone={t.unit === 'calendar_day' ? 'violet' : 'chai'}>
                    {t.unit === 'calendar_day' ? 'calendar days' : 'working days'}
                  </Badge>
                </td>
                <td className="td text-right tabular-nums">{fmtDays(t.default_days)}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1">
                    {t.is_prorated ? <Badge tone="chai">pro-rated</Badge> : null}
                    {t.max_carry_forward > 0 ? (
                      <Badge tone="emerald">carry {fmtDays(t.max_carry_forward)}</Badge>
                    ) : null}
                    {t.requires_attachment ? <Badge tone="amber">document</Badge> : null}
                    {t.gender_restriction ? (
                      <Badge tone="violet">{t.gender_restriction} only</Badge>
                    ) : null}
                    {!t.is_paid ? <Badge tone="red">unpaid</Badge> : null}
                    {!t.is_requestable ? <Badge>heading only</Badge> : null}
                  </div>
                </td>
                <td className="td text-right">
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ ...t })}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        title={`Edit ${editing?.name_en ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant={unitChanged && hasApproved ? 'danger' : 'primary'}
              loading={save.isPending}
              onClick={async () => {
                await save.mutateAsync(editing!)
                setEditing(null)
              }}
            >
              {unitChanged && hasApproved ? 'Change the unit anyway' : 'Save'}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-3">
            {unitChanged && hasApproved ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {fmtDays(approvedByType.get(editing.code))} approved days already exist on this
                    type.
                  </p>
                  <p className="mt-0.5">
                    Changing the unit does not recalculate them. Historical requests will keep the
                    day counts they were given, so past and future records will no longer mean the
                    same thing. This is exactly the confusion between working days and calendar
                    days that the old spreadsheet had. Only proceed if you are correcting a
                    mistake, and note it in the audit trail.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name (English)">
                <Input
                  value={editing.name_en}
                  onChange={(e) => setEditing({ ...editing, name_en: e.target.value })}
                />
              </Field>
              <Field label="Name (Khmer)">
                <Input
                  lang="km"
                  value={editing.name_kh ?? ''}
                  onChange={(e) => setEditing({ ...editing, name_kh: e.target.value })}
                />
              </Field>
              <Field label="Unit" hint="Never mix the two in one calculation.">
                <NativeSelect
                  value={editing.unit}
                  onChange={(e) =>
                    setEditing({ ...editing, unit: e.target.value as LeaveType['unit'] })
                  }
                >
                  <option value="working_day">Working days</option>
                  <option value="calendar_day">Calendar days</option>
                </NativeSelect>
              </Field>
              <Field label="Default days">
                <Input
                  type="number"
                  step="0.5"
                  value={editing.default_days}
                  onChange={(e) =>
                    setEditing({ ...editing, default_days: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Minimum notice (days)">
                <Input
                  type="number"
                  value={editing.min_notice_days}
                  onChange={(e) =>
                    setEditing({ ...editing, min_notice_days: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Maximum carry-forward">
                <Input
                  type="number"
                  step="0.5"
                  value={editing.max_carry_forward}
                  onChange={(e) =>
                    setEditing({ ...editing, max_carry_forward: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Carry-forward expires end of month" hint="1 = January, 3 = March.">
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={editing.carry_forward_expiry_month ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      carry_forward_expiry_month: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Document required after (days)">
                <Input
                  type="number"
                  step="0.5"
                  value={editing.attachment_after_days ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      attachment_after_days: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['is_prorated', 'Pro-rate in the joining year'],
                  ['allows_half_day', 'Allow half days'],
                  ['requires_attachment', 'Requires a supporting document'],
                  ['requires_hr_approval', 'Requires HR approval'],
                  ['is_paid', 'Paid'],
                  ['counts_against_balance', 'Counts against the balance'],
                  ['is_requestable', 'Can be requested directly'],
                  ['is_active', 'Active'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-chai-600 focus:ring-chai-500"
                    checked={Boolean(editing[key])}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>

            <Field label="Description">
              <Textarea
                rows={2}
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Dialog>
    </>
  )
}

/* =========================================================== HOLIDAYS ==== */

function HolidaysTab() {
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const { data: holidays = [], isLoading } = useHolidays(year)
  const save = useSaveHolidays()
  const remove = useDeleteHoliday()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  const years = [year - 1, year, year + 1, year + 2]

  function parsePaste(): { holiday_date: string; name_en: string; name_kh: string | null; is_half_day: boolean }[] {
    const rows: { holiday_date: string; name_en: string; name_kh: string | null; is_half_day: boolean }[] = []
    const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    for (const [i, line] of lines.entries()) {
      const parts = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((p) => p.trim().replace(/^"|"$/g, ''))
      const [date, name, kh, half] = parts
      if (!date || !name) throw new Error(`Line ${i + 1}: expected "YYYY-MM-DD, Name".`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Line ${i + 1}: "${date}" is not YYYY-MM-DD.`)
      rows.push({
        holiday_date: date,
        name_en: name,
        name_kh: kh || null,
        is_half_day: /^(y|yes|true|half|1)$/i.test(half ?? ''),
      })
    }
    return rows
  }

  return (
    <div className="space-y-4">
      <HolidayBulkImport holidays={holidays} year={year} />

      <Card className="border-amber-200 bg-amber-50/60">
        <div className="flex items-start gap-2.5 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The seeded dates are <strong>not authoritative</strong>. Meak Bochea, Visak Bochea, the
            Royal Ploughing Ceremony, Pchum Ben and the Water Festival move every year. Verify the
            whole list against the official Royal Government of Cambodia sub-decree before relying
            on it — a wrong holiday silently miscounts every piece of leave that spans it.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NativeSelect
          className="w-32"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Leave year"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </NativeSelect>
        <Button onClick={() => setPasteOpen(true)}>
          <Plus className="h-4 w-4" /> Bulk import
        </Button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : holidays.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDays className="h-7 w-7" />} title={`No holidays for ${year}`}>
            Paste the official list for {year} using Bulk import. Leave spanning missing holidays
            will be over-counted until you do.
          </EmptyState>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Date</th>
                <th className="th">Day</th>
                <th className="th">Name</th>
                <th className="th">Khmer</th>
                <th className="th">Half day</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {holidays.map((h) => {
                const d = new Date(`${h.holiday_date}T00:00:00`)
                const weekend = d.getDay() === 0 || d.getDay() === 6
                return (
                  <tr key={h.holiday_date} className={cn(weekend && 'bg-slate-50')}>
                    <td className="td">{fmtDate(h.holiday_date)}</td>
                    <td className="td text-slate-500">
                      {d.toLocaleDateString('en', { weekday: 'short' })}
                      {weekend ? ' · already a weekend' : ''}
                    </td>
                    <td className="td">{h.name_en}</td>
                    <td className="td" lang="km">
                      {h.name_kh ?? '—'}
                    </td>
                    <td className="td">{h.is_half_day ? 'Yes' : '—'}</td>
                    <td className="td text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(h.holiday_date)}
                        aria-label={`Remove ${h.name_en}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Bulk import public holidays"
        description="One per line: date, name, Khmer name (optional), half day (optional). Comma or tab separated. Existing dates are updated."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              onClick={async () => {
                try {
                  setParseError(null)
                  const rows = parsePaste()
                  await save.mutateAsync(rows)
                  setPaste('')
                  setPasteOpen(false)
                } catch (e) {
                  setParseError((e as Error).message)
                }
              }}
            >
              Import
            </Button>
          </>
        }
      >
        <Field
          label="Paste the official list"
          error={parseError ?? undefined}
          hint={`Example:\n2027-01-01, International New Year Day\n2027-04-14, Khmer New Year (day 1), ចូលឆ្នាំថ្មី\n2027-09-24, Constitution Day, , no`}
        >
          <Textarea
            rows={12}
            className="font-mono text-xs"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="2027-01-01, International New Year Day"
          />
        </Field>
      </Dialog>
    </div>
  )
}

/* ======================================================= ENTITLEMENTS ==== */

function EntitlementsTab({ leaveYear }: { leaveYear: number }) {
  const [year, setYear] = useState(leaveYear)
  const { data: employees = [] } = useEmployees()
  const { data: entitlements = [], isLoading } = useEntitlements(year)
  const { data: types = [] } = useLeaveTypes()
  const generate = useGenerateEntitlements()
  const carry = useCarryForward()
  const adjust = useAdjustEntitlement()
  const { data: settings } = useSettings()

  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [adjDays, setAdjDays] = useState('0')
  const [adjReason, setAdjReason] = useState('')
  const [filter, setFilter] = useState('')

  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const typeByCode = useMemo(() => new Map(types.map((t) => [t.code, t])), [types])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return entitlements
      .map((e) => ({ ...e, employee: empById.get(e.employee_id) }))
      .filter((e) => e.employee)
      .filter(
        (e) =>
          !q ||
          e.employee!.full_name.toLowerCase().includes(q) ||
          e.employee!.staff_code.toLowerCase().includes(q) ||
          e.leave_type_code.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          a.employee!.full_name.localeCompare(b.employee!.full_name) ||
          (typeByCode.get(a.leave_type_code)?.display_order ?? 0) -
            (typeByCode.get(b.leave_type_code)?.display_order ?? 0),
      )
  }, [entitlements, empById, typeByCode, filter])

  const target = rows.find((r) => r.id === adjusting)

  return (
    <div className="space-y-4">
      <EntitlementBulkImport year={year} rows={rows} />

      <Card>
        <CardHeader
          title="Yearly operations"
          description="Both are idempotent. Neither ever overwrites an adjustment you have already made."
        />
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Leave year">
            <NativeSelect
              className="w-32"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[leaveYear - 1, leaveYear, leaveYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            loading={generate.isPending}
            onClick={() => generate.mutate({ year })}
          >
            <RefreshCw className="h-4 w-4" /> Generate entitlements for {year}
          </Button>
          <Button
            variant="secondary"
            loading={carry.isPending}
            onClick={() => carry.mutate(year)}
          >
            Carry forward {year} → {year + 1}
          </Button>
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Pro-rating method in use:{' '}
          <span className="font-medium text-slate-700">
            {settings?.prorate_method === 'daily_365'
              ? 'daily (base × days employed ÷ 365, rounded to the nearest half day)'
              : 'monthly accrual (base ÷ 12 × completed months, rounded to the nearest half day)'}
          </span>
          . Both give 10.5 days for an 18-day entitlement starting 1 June. Change it in
          app_settings once HR has decided.
        </p>
      </Card>

      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name, staff code or leave type…"
        className="max-w-sm"
        aria-label="Filter entitlements"
      />

      {isLoading ? (
        <TableSkeleton rows={10} cols={7} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet className="h-7 w-7" />} title={`No entitlements for ${year}`}>
            Run “Generate entitlements” above to create one row per active employee per leave type.
          </EmptyState>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Employee</th>
                <th className="th">Leave type</th>
                <th className="th text-right">Base</th>
                <th className="th text-right">Pro-rated</th>
                <th className="th text-right">Carried</th>
                <th className="th text-right">Adjustment</th>
                <th className="th text-right">Total</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="td">
                    <p className="font-medium text-slate-900">{r.employee!.full_name}</p>
                    <p className="text-xs text-slate-500">{r.employee!.staff_code}</p>
                  </td>
                  <td className="td">{typeByCode.get(r.leave_type_code)?.name_en ?? r.leave_type_code}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.base_days)}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.prorated_days)}</td>
                  <td className="td text-right tabular-nums">{fmtDays(r.carry_forward_days)}</td>
                  <td className="td text-right tabular-nums">
                    {Number(r.adjustment_days) !== 0 ? (
                      <span title={r.adjustment_reason ?? ''} className="cursor-help underline decoration-dotted">
                        {Number(r.adjustment_days) > 0 ? '+' : ''}
                        {fmtDays(r.adjustment_days)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="td text-right font-medium tabular-nums">{fmtDays(r.total_days)}</td>
                  <td className="td text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setAdjusting(r.id)
                        setAdjDays(String(r.adjustment_days))
                        setAdjReason(r.adjustment_reason ?? '')
                      }}
                    >
                      Adjust
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!adjusting}
        onOpenChange={(v) => !v && setAdjusting(null)}
        title="Adjust an entitlement"
        description={
          target
            ? `${target.employee!.full_name} — ${typeByCode.get(target.leave_type_code)?.name_en}, ${year}`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button
              loading={adjust.isPending}
              disabled={Number(adjDays) !== 0 && adjReason.trim().length === 0}
              onClick={async () => {
                await adjust.mutateAsync({
                  id: adjusting!,
                  adjustment_days: Number(adjDays),
                  adjustment_reason: adjReason.trim(),
                })
                setAdjusting(null)
              }}
            >
              Save adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Adjustment in days" hint="Negative numbers reduce the entitlement.">
            <Input
              type="number"
              step="0.5"
              value={adjDays}
              onChange={(e) => setAdjDays(e.target.value)}
            />
          </Field>
          <Field
            label="Reason"
            required={Number(adjDays) !== 0}
            hint="The database refuses an adjustment with no reason. This is what replaces the spreadsheet's unexplained manual adder."
          >
            <Textarea rows={3} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  )
}

/* ============================================================== AUDIT ==== */

function AuditTab() {
  const { data: employees = [] } = useEmployees()
  const [filters, setFilters] = useState<{ table?: string; actor?: string; from?: string; to?: string }>(
    {},
  )
  const { data: rows = [], isLoading } = useAuditLog(filters)
  const [open, setOpen] = useState<number | null>(null)

  const actorName = useMemo(() => new Map(employees.map((e) => [e.id, e.full_name])), [employees])
  const detail = rows.find((r) => r.id === open)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          className="w-48"
          aria-label="Filter by table"
          value={filters.table ?? ''}
          onChange={(e) => setFilters({ ...filters, table: e.target.value || undefined })}
        >
          <option value="">All tables</option>
          {['employees', 'leave_requests', 'entitlements', 'leave_types', 'public_holidays'].map(
            (t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ),
          )}
        </NativeSelect>
        <NativeSelect
          className="w-56"
          aria-label="Filter by actor"
          value={filters.actor ?? ''}
          onChange={(e) => setFilters({ ...filters, actor: e.target.value || undefined })}
        >
          <option value="">Anyone</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </NativeSelect>
        <Input
          type="date"
          className="w-40"
          aria-label="From date"
          value={filters.from ?? ''}
          onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
        />
        <Input
          type="date"
          className="w-40"
          aria-label="To date"
          value={filters.to ?? ''}
          onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={10} cols={5} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<History className="h-7 w-7" />} title="No audit entries match">
            Widen the filters. The audit log cannot be edited or deleted by anyone, including HR, so
            anything that happened is still here.
          </EmptyState>
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">When</th>
                <th className="th">Table</th>
                <th className="th">Action</th>
                <th className="th">Actor</th>
                <th className="th">Record</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="td">{fmtDateTime(r.occurred_at)}</td>
                  <td className="td font-mono text-xs">{r.table_name}</td>
                  <td className="td">
                    <Badge
                      tone={
                        r.action === 'DELETE'
                          ? 'red'
                          : r.action === 'APPROVE'
                            ? 'emerald'
                            : r.action === 'REJECT'
                              ? 'amber'
                              : 'slate'
                      }
                    >
                      {r.action}
                    </Badge>
                  </td>
                  <td className="td">
                    {r.actor_id ? (actorName.get(r.actor_id) ?? r.actor_email ?? '—') : 'system'}
                  </td>
                  <td className="td font-mono text-[11px] text-slate-500">{r.record_id}</td>
                  <td className="td text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(r.id)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={open !== null}
        onOpenChange={(v) => !v && setOpen(null)}
        title="Audit entry"
        description={detail ? `${detail.table_name} · ${detail.action}` : undefined}
        size="xl"
      >
        {detail ? (
          <div className="grid gap-3 [&>*]:min-w-0 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Before
              </p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                {JSON.stringify(detail.before_data ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                After
              </p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                {JSON.stringify(detail.after_data ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
