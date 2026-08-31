import { useMemo, useState } from 'react'
import { Copy, KeyRound, Plus, Save, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Field, Input, NativeSelect, TableSkeleton } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/Dialog'
import { useEmployees } from '@/hooks/useLeaveData'
import {
  generateTempPassword,
  useCreateEmployee,
  useResetPassword,
  useSaveEmployee,
} from '@/hooks/useMutations'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { fmtDate } from '@/lib/format'
import type { Employee } from '@/lib/database.types'
import { BulkImport, type ImportColumn } from '@/components/BulkImport'

export function EmployeesTab() {
  const { isSystemAdmin } = useAuth()
  const { data: employees = [], isLoading } = useEmployees()
  const saveEmployee = useSaveEmployee()

  const [editing, setEditing] = useState<Employee | null>(null)
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<Employee | null>(null)

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Accounts are created here. There is no self-service sign-up and no identity provider —
          you set a temporary password and the holder replaces it on first sign-in.
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add employee
        </Button>
      </div>

      <EmployeeBulkImport employees={employees} />

      {isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : (
        <div className="table-wrap">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Staff code</th>
                <th className="th">Name</th>
                <th className="th">Department</th>
                <th className="th">Supervisor</th>
                <th className="th">Hired</th>
                <th className="th">Role</th>
                <th className="th">Account</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/70">
                  <td className="td font-mono text-xs">{e.staff_code}</td>
                  <td className="td">
                    <p className="font-medium text-slate-900">{e.full_name}</p>
                    <p className="text-xs text-slate-500">{e.email}</p>
                  </td>
                  <td className="td">{e.department ?? '—'}</td>
                  <td className="td">
                    {e.supervisor_id ? (byId.get(e.supervisor_id)?.full_name ?? '—') : '—'}
                  </td>
                  <td className="td">{fmtDate(e.hire_date)}</td>
                  <td className="td">
                    <Badge tone={e.role === 'employee' ? 'slate' : 'chai'}>{e.role}</Badge>
                  </td>
                  <td className="td">
                    {e.must_change_password ? (
                      <Badge tone="amber">temporary password</Badge>
                    ) : (
                      <Badge tone="emerald">
                        <ShieldCheck className="mr-1 h-3 w-3" /> active
                      </Badge>
                    )}
                  </td>
                  <td className="td text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setResetting(e)}>
                        <KeyRound className="h-3.5 w-3.5" /> Reset
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(e)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        title={`Edit ${editing?.full_name ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={saveEmployee.isPending}
              onClick={async () => {
                await saveEmployee.mutateAsync(editing!)
                setEditing(null)
              }}
            >
              <Save className="h-4 w-4" /> Save
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input
                value={editing.full_name}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
              />
            </Field>
            <Field label="Name in Khmer">
              <Input
                lang="km"
                value={editing.full_name_kh ?? ''}
                onChange={(e) => setEditing({ ...editing, full_name_kh: e.target.value })}
              />
            </Field>
            <Field label="Staff code">
              <Input
                value={editing.staff_code}
                onChange={(e) => setEditing({ ...editing, staff_code: e.target.value })}
              />
            </Field>
            <Field label="Position">
              <Input
                value={editing.position_title ?? ''}
                onChange={(e) => setEditing({ ...editing, position_title: e.target.value })}
              />
            </Field>
            <Field label="Department">
              <Input
                value={editing.department ?? ''}
                onChange={(e) => setEditing({ ...editing, department: e.target.value })}
              />
            </Field>
            <Field
              label="Supervisor"
              hint="The database refuses any choice that would create a reporting loop."
            >
              <NativeSelect
                value={editing.supervisor_id ?? ''}
                onChange={(e) => setEditing({ ...editing, supervisor_id: e.target.value || null })}
              >
                <option value="">No supervisor (goes straight to HR)</option>
                {employees
                  .filter((o) => o.id !== editing.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name} — {o.position_title ?? o.department ?? ''}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Hire date">
              <Input
                type="date"
                value={editing.hire_date}
                onChange={(e) => setEditing({ ...editing, hire_date: e.target.value })}
              />
            </Field>
            <Field label="Exit date" hint="Setting this pro-rates the remaining entitlement.">
              <Input
                type="date"
                value={editing.exit_date ?? ''}
                onChange={(e) => setEditing({ ...editing, exit_date: e.target.value || null })}
              />
            </Field>
            <Field label="Employment status">
              <NativeSelect
                value={editing.employment_status}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    employment_status: e.target.value as Employee['employment_status'],
                  })
                }
              >
                <option value="active">Active</option>
                <option value="on_probation">On probation</option>
                <option value="suspended">Suspended</option>
                <option value="exited">Exited</option>
              </NativeSelect>
            </Field>
            <Field
              label="Role"
              hint={
                isSystemAdmin
                  ? 'Only a system administrator can change this.'
                  : 'Locked. Only a system administrator can change a role.'
              }
            >
              <NativeSelect
                disabled={!isSystemAdmin}
                value={editing.role}
                onChange={(e) =>
                  setEditing({ ...editing, role: e.target.value as Employee['role'] })
                }
              >
                <option value="employee">Employee</option>
                <option value="supervisor">Supervisor</option>
                <option value="hr_admin">HR administrator</option>
                <option value="system_admin">System administrator</option>
              </NativeSelect>
            </Field>
            <Field
              label="Gender"
              hint="Used only to gate maternity and paternity leave. Never displayed elsewhere."
            >
              <NativeSelect
                value={editing.gender ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, gender: (e.target.value || null) as 'M' | 'F' | null })
                }
              >
                <option value="">Not recorded</option>
                <option value="F">F</option>
                <option value="M">M</option>
              </NativeSelect>
            </Field>
          </div>
        ) : null}
      </Dialog>

      <AddEmployeeDialog open={adding} onOpenChange={setAdding} employees={employees} />
      <ResetPasswordDialog
        employee={resetting}
        onOpenChange={(v) => !v && setResetting(null)}
      />
    </div>
  )
}

/* ---------------------------------------------------- temp password ------ */

function TempPasswordPanel({ password, email }: { password: string; email: string }) {
  const toast = useToast()
  return (
    <div className="rounded-lg border border-chaiGold bg-chaiLightGold/30 p-3">
      <p className="text-sm font-semibold text-slate-900">Temporary password</p>
      <p className="mt-0.5 text-xs text-slate-600">
        Shown once. Copy it now and give it to {email} — you cannot retrieve it later, only
        issue a new one.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 select-all rounded border border-slate-300 bg-white px-2.5 py-2 font-mono text-sm tracking-wide">
          {password}
        </code>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password)
              toast.success('Copied to the clipboard')
            } catch {
              toast.info('Select the text and copy it manually')
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        They will be required to replace it the first time they sign in.
      </p>
    </div>
  )
}

function AddEmployeeDialog({
  open,
  onOpenChange,
  employees,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  employees: Employee[]
}) {
  const { isSystemAdmin } = useAuth()
  const create = useCreateEmployee()
  const [issued, setIssued] = useState<{ password: string; email: string } | null>(null)
  const [form, setForm] = useState({
    email: '',
    staff_code: '',
    full_name: '',
    full_name_kh: '',
    hire_date: '',
    department: '',
    position_title: '',
    supervisor_id: '',
    gender: '',
    role: 'employee',
  })

  const valid =
    form.email.includes('@') && form.staff_code && form.full_name && form.hire_date

  function reset() {
    setIssued(null)
    setForm({
      email: '',
      staff_code: '',
      full_name: '',
      full_name_kh: '',
      hire_date: '',
      department: '',
      position_title: '',
      supervisor_id: '',
      gender: '',
      role: 'employee',
    })
  }

  async function submit() {
    const temp = generateTempPassword()
    await create.mutateAsync({
      ...form,
      temp_password: temp,
      supervisor_id: form.supervisor_id || null,
      gender: form.gender || null,
      full_name_kh: form.full_name_kh || null,
    })
    setIssued({ password: temp, email: form.email })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
      title={issued ? 'Account created' : 'Add an employee'}
      description={
        issued
          ? undefined
          : 'Creates their sign-in account and staff record together, and generates a temporary password for you to pass on.'
      }
      size="lg"
      footer={
        issued ? (
          <Button
            onClick={() => {
              onOpenChange(false)
              reset()
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={create.isPending} disabled={!valid} onClick={() => void submit()}>
              Create account
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <TempPasswordPanel password={issued.password} email={issued.email} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" required hint="This is what they sign in with.">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@example.org"
            />
          </Field>
          <Field label="Staff code" required>
            <Input
              value={form.staff_code}
              onChange={(e) => setForm({ ...form, staff_code: e.target.value })}
              placeholder="CHAI-KH-009"
            />
          </Field>
          <Field label="Full name" required>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="Name in Khmer">
            <Input
              lang="km"
              value={form.full_name_kh}
              onChange={(e) => setForm({ ...form, full_name_kh: e.target.value })}
            />
          </Field>
          <Field label="Hire date" required hint="Drives pro-rating in the joining year.">
            <Input
              type="date"
              value={form.hire_date}
              onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
            />
          </Field>
          <Field label="Department">
            <Input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <Field label="Position">
            <Input
              value={form.position_title}
              onChange={(e) => setForm({ ...form, position_title: e.target.value })}
            />
          </Field>
          <Field label="Supervisor">
            <NativeSelect
              value={form.supervisor_id}
              onChange={(e) => setForm({ ...form, supervisor_id: e.target.value })}
            >
              <option value="">No supervisor (requests go straight to HR)</option>
              {employees.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Role"
            hint={isSystemAdmin ? undefined : 'Only a system administrator can grant a role.'}
          >
            <NativeSelect
              disabled={!isSystemAdmin}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="employee">Employee</option>
              <option value="supervisor">Supervisor</option>
              <option value="hr_admin">HR administrator</option>
              <option value="system_admin">System administrator</option>
            </NativeSelect>
          </Field>
          <Field label="Gender" hint="Only gates maternity and paternity leave.">
            <NativeSelect
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="">Not recorded</option>
              <option value="F">F</option>
              <option value="M">M</option>
            </NativeSelect>
          </Field>
        </div>
      )}
    </Dialog>
  )
}

function ResetPasswordDialog({
  employee,
  onOpenChange,
}: {
  employee: Employee | null
  onOpenChange: (v: boolean) => void
}) {
  const reset = useResetPassword()
  const [issued, setIssued] = useState<string | null>(null)

  async function go() {
    const temp = generateTempPassword()
    await reset.mutateAsync({ employeeId: employee!.id, tempPassword: temp })
    setIssued(temp)
  }

  return (
    <Dialog
      open={!!employee}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) setIssued(null)
      }}
      title={`Reset password for ${employee?.full_name ?? ''}`}
      description={
        issued
          ? undefined
          : 'Their current password stops working immediately. They will be asked to choose a new one the next time they sign in.'
      }
      size="sm"
      footer={
        issued ? (
          <Button
            onClick={() => {
              onOpenChange(false)
              setIssued(null)
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => void go()}>
              Issue a temporary password
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <TempPasswordPanel password={issued} email={employee?.email ?? ''} />
      ) : (
        <p className="text-sm text-slate-600">
          Use this when someone has forgotten their password. There is no email delivery — you
          will be shown a temporary password to pass on however you normally reach them.
        </p>
      )}
    </Dialog>
  )
}

/* ------------------------------------------------------- bulk import ----- */

const EMPLOYEE_COLUMNS: ImportColumn[] = [
  { key: 'email', required: true, example: 'sok.dara@example.org', hint: 'what they sign in with' },
  { key: 'staff_code', required: true, example: 'CHAI-KH-020' },
  { key: 'full_name', required: true, example: 'Dara Sok' },
  { key: 'hire_date', required: true, example: '2026-02-01', hint: 'YYYY-MM-DD' },
  { key: 'department', example: 'Malaria' },
  { key: 'position_title', example: 'Programme Officer' },
  { key: 'supervisor_email', example: 'sokha.meas@clintonhealthaccess.org', hint: 'must already exist' },
  { key: 'role', example: 'employee', hint: 'employee | supervisor | hr_admin | system_admin' },
  { key: 'gender', example: '', hint: 'M or F, only gates maternity/paternity' },
  { key: 'full_name_kh', example: '' },
]

function EmployeeBulkImport({ employees }: { employees: Employee[] }) {
  const create = useCreateEmployee()

  const byEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e.id]))

  return (
    <BulkImport
      fileStem="employees"
      title="Add many at once"
      description="Download the template, fill in one row per person, upload it back. Each row creates a sign-in account and a staff record, and the results file carries every temporary password."
      columns={EMPLOYEE_COLUMNS}
      resultNoun="employee"
      currentRows={() =>
        employees.map((e) => ({
          email: e.email,
          staff_code: e.staff_code,
          full_name: e.full_name,
          hire_date: e.hire_date,
          department: e.department ?? '',
          position_title: e.position_title ?? '',
          supervisor_email: e.supervisor_id
            ? (employees.find((s) => s.id === e.supervisor_id)?.email ?? '')
            : '',
          role: e.role,
          gender: e.gender ?? '',
          full_name_kh: e.full_name_kh ?? '',
        }))
      }
      onImportRow={async (row) => {
        let supervisorId: string | null = null
        if (row.supervisor_email) {
          supervisorId = byEmail.get(row.supervisor_email.toLowerCase()) ?? null
          if (!supervisorId) {
            throw new Error(
              `No employee with the email ${row.supervisor_email}. Import supervisors before their reports, or leave the column blank and set it afterwards.`,
            )
          }
        }

        const temp = generateTempPassword()
        await create.mutateAsync({
          email: row.email,
          temp_password: temp,
          staff_code: row.staff_code,
          full_name: row.full_name,
          hire_date: row.hire_date,
          department: row.department || undefined,
          position_title: row.position_title || undefined,
          supervisor_id: supervisorId,
          gender: row.gender || null,
          full_name_kh: row.full_name_kh || null,
          role: row.role || 'employee',
        })

        return {
          ok: true,
          message: 'Account created',
          // Surfaced only in the downloadable results file - the passwords are
          // not recoverable afterwards.
          extra: { temporary_password: temp },
        }
      }}
    />
  )
}
