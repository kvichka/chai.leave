import { useMemo } from 'react'
import { KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { Badge, Card, EmptyState } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Avatar } from '@/components/Avatar'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Employee } from '@/lib/database.types'

const ROLE_LABEL: Record<string, string> = {
  employee: 'Employee',
  supervisor: 'Supervisor',
  hr_admin: 'HR administrator',
  system_admin: 'System administrator',
}

/**
 * Employees as cards, grouped by department.
 *
 * A table is better for comparing one column down a list; cards are better for
 * finding a person. Both views exist because HR does both jobs, and this one is
 * the default because "who is this and who do they report to" is the more
 * common question.
 *
 * The card carries only what identifies somebody. Everything else - staff
 * code, hire date, date of birth, account state - is behind a click, so a
 * screen of fourteen people stays readable.
 */
export function EmployeeCards({
  employees,
  search,
  onOpen,
}: {
  employees: Employee[]
  search: string
  onOpen: (employee: Employee) => void
}) {
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      [e.full_name, e.full_name_kh, e.email, e.staff_code, e.department, e.position_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [employees, search])

  const groups = useMemo(() => {
    const map = new Map<string, Employee[]>()
    for (const e of filtered) {
      const key = e.department ?? ''
      const bucket = map.get(key)
      if (bucket) bucket.push(e)
      else map.set(key, [e])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([key, people]) => ({
        label: key || 'No department set',
        people: people.sort((a, b) => a.full_name.localeCompare(b.full_name)),
      }))
  }, [filtered])

  if (filtered.length === 0) {
    return (
      <Card>
        <EmptyState icon={<UserRound className="h-7 w-7" />} title="Nobody matches that search">
          Try part of a name, an email address, a staff code or a department.
        </EmptyState>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.label}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-chai-700">
              {group.label}
            </h3>
            <span className="text-[11px] text-slate-400">
              {group.people.length} {group.people.length === 1 ? 'person' : 'people'}
            </span>
          </div>

          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {group.people.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpen(e)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left',
                    'transition-all duration-150 hover:-translate-y-px hover:border-slate-300 hover:shadow-md',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chai-500',
                  )}
                >
                  <Avatar
                    fullName={e.full_name}
                    avatarPath={e.avatar_path}
                    avatarEmoji={e.avatar_emoji}
                    size="lg"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{e.full_name}</p>
                    <p className="truncate text-xs text-slate-500">{e.position_title ?? '—'}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {e.supervisor_id
                        ? `Reports to ${byId.get(e.supervisor_id)?.full_name ?? '—'}`
                        : 'No supervisor — requests go to HR'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {e.role !== 'employee' ? (
                      <Badge tone="chai">{ROLE_LABEL[e.role] ?? e.role}</Badge>
                    ) : null}
                    {e.must_change_password ? (
                      <Badge tone="amber">temporary password</Badge>
                    ) : null}
                    {e.employment_status !== 'active' ? (
                      <Badge tone="slate">{e.employment_status.replace('_', ' ')}</Badge>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * Everything about one person, opened from their card.
 *
 * Read-only. The two things that change a person - editing the record and
 * resetting the password - are the existing dialogs, reached from here rather
 * than reimplemented.
 */
export function EmployeeDetailDialog({
  employee,
  employees,
  open,
  onOpenChange,
  onEdit,
  onReset,
}: {
  employee: Employee | null
  employees: Employee[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (employee: Employee) => void
  onReset: (employee: Employee) => void
}) {
  if (!employee) return null

  const supervisor = employee.supervisor_id
    ? employees.find((e) => e.id === employee.supervisor_id)
    : null
  const reports = employees.filter((e) => e.supervisor_id === employee.id)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={employee.full_name}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
              onReset(employee)
            }}
          >
            <KeyRound className="h-4 w-4" /> Reset password
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onEdit(employee)
            }}
          >
            Edit record
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
        <Avatar
          fullName={employee.full_name}
          avatarPath={employee.avatar_path}
          avatarEmoji={employee.avatar_emoji}
          size="xl"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{employee.full_name}</p>
          {employee.full_name_kh ? (
            <p className="text-sm text-slate-600" lang="km">
              {employee.full_name_kh}
            </p>
          ) : null}
          <p className="text-xs text-slate-500">{employee.position_title ?? '—'}</p>
          <a
            href={`mailto:${employee.email}`}
            className="mt-1 inline-flex items-center gap-1 text-xs text-chai-700 hover:underline"
          >
            <Mail className="h-3 w-3" /> {employee.email}
          </a>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
        <Row label="Staff code" mono>
          {employee.staff_code}
        </Row>
        <Row label="Department">{employee.department ?? '—'}</Row>
        <Row label="Role">{ROLE_LABEL[employee.role] ?? employee.role}</Row>
        <Row label="Employment status">{employee.employment_status.replace('_', ' ')}</Row>
        <Row label="Hire date">{fmtDate(employee.hire_date)}</Row>
        <Row label="Exit date">
          {employee.exit_date ? fmtDate(employee.exit_date) : '—'}
        </Row>
        <Row label="Date of birth">
          {employee.date_of_birth ? fmtDate(employee.date_of_birth) : '—'}
        </Row>
        <Row label="Birthday calendar">
          {employee.show_birthday ? 'Shown to colleagues' : 'Hidden'}
        </Row>
        <Row label="Approver">
          {supervisor ? supervisor.full_name : 'HR — no supervisor set'}
        </Row>
        <Row label="Account">
          {employee.must_change_password ? (
            <Badge tone="amber">temporary password</Badge>
          ) : (
            <Badge tone="emerald">
              <ShieldCheck className="mr-1 h-3 w-3" /> active
            </Badge>
          )}
        </Row>
      </dl>

      {reports.length > 0 ? (
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {reports.length} direct {reports.length === 1 ? 'report' : 'reports'}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {reports.map((r) => (
              <li
                key={r.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-1 pr-2.5 text-xs text-slate-700"
              >
                <Avatar
                  fullName={r.full_name}
                  avatarPath={r.avatar_path}
                  avatarEmoji={r.avatar_emoji}
                  size="sm"
                  className="h-5 w-5 text-[9px]"
                />
                {r.full_name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  )
}

function Row({
  label,
  children,
  mono,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={cn('mt-0.5 text-sm text-slate-800', mono && 'font-mono text-xs')}>
        {children}
      </dd>
    </div>
  )
}
