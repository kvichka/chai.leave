import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, ATTACHMENT_BUCKET } from '@/lib/supabase'
import { useToast } from '@/components/ui/Toast'
import { humanError } from '@/lib/errors'
import type {
  DayPortion,
  Employee,
  LeaveRequest,
  LeaveType,
  PublicHoliday,
} from '@/lib/database.types'

/**
 * Anything that can change a balance invalidates all of these.
 *
 * Keep decision_history in the list. A supervisor approving a request watches
 * it leave the queue and expects to see it arrive in the history directly
 * below on the same screen; without this key that table keeps serving its
 * cached rows until something else refetches it.
 */
const LEAVE_KEYS = ['requests', 'balances', 'pending_approvals', 'decision_history', 'absences',
  'team_absences', 'out_today', 'coverage', 'liability', 'notifications', 'entitlements',
  'audit_log']

/**
 * Reference data. Cached for minutes rather than seconds because it barely
 * changes, which is precisely why the mutation that edits it has to say so -
 * otherwise an administrator saves a leave type and watches the old value sit
 * there for half an hour. Only the admin mutations opt in, via alsoInvalidate.
 */
const REFERENCE_KEYS = ['employees', 'leave_types', 'holidays'] as const
type ReferenceKey = (typeof REFERENCE_KEYS)[number]

function useInvalidate() {
  const qc = useQueryClient()
  return (extra: readonly string[] = []) => {
    for (const key of [...LEAVE_KEYS, ...extra]) void qc.invalidateQueries({ queryKey: [key] })
  }
}

/**
 * Every mutation in the app funnels through here so that the exact Postgres
 * sentence reaches the user. No "Something went wrong."
 */
function useAppMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: {
    successTitle?: (result: TResult, args: TArgs) => string
    successBody?: (result: TResult, args: TArgs) => string | undefined
    errorTitle?: string
    onDone?: (result: TResult, args: TArgs) => void
    /** Reference keys this mutation also changes, e.g. ['employees']. */
    alsoInvalidate?: readonly ReferenceKey[]
  } = {},
) {
  const toast = useToast()
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: fn,
    onSuccess: (result, args) => {
      invalidate(opts.alsoInvalidate)
      if (opts.successTitle) {
        toast.success(opts.successTitle(result, args), opts.successBody?.(result, args))
      }
      opts.onDone?.(result, args)
    },
    onError: (error) => {
      toast.error(opts.errorTitle ?? 'That did not work', humanError(error))
    },
  })
}

/* --------------------------------------------------------- leave requests */

export interface DraftInput {
  id?: string
  leave_type_code: string
  start_date: string
  end_date: string
  start_portion: DayPortion
  end_portion: DayPortion
  reason?: string | null
  handover_notes?: string | null
  contact_while_away?: string | null
  attachment_path?: string | null
}

export function useSaveDraft(employeeId: string | undefined) {
  return useAppMutation<DraftInput, LeaveRequest>(
    async (input) => {
      if (!employeeId) throw new Error('You are not signed in.')
      const payload = {
        employee_id: employeeId,
        leave_type_code: input.leave_type_code,
        start_date: input.start_date,
        end_date: input.end_date,
        start_portion: input.start_portion,
        end_portion: input.end_portion,
        reason: input.reason ?? null,
        handover_notes: input.handover_notes ?? null,
        contact_while_away: input.contact_while_away ?? null,
        attachment_path: input.attachment_path ?? null,
        status: 'draft' as const,
      }

      if (input.id) {
        const { data, error } = await supabase
          .from('leave_requests')
          .update(payload)
          .eq('id', input.id)
          .select()
          .single()
        if (error) throw error
        return data
      }

      const { data, error } = await supabase
        .from('leave_requests')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data
    },
    {
      successTitle: () => 'Draft saved',
      successBody: (r) => `${r.request_ref} · ${r.days_requested} day(s)`,
      errorTitle: 'Could not save the draft',
    },
  )
}

export function useDeleteDraft() {
  return useAppMutation<string, void>(
    async (id) => {
      const { error } = await supabase.from('leave_requests').delete().eq('id', id)
      if (error) throw error
    },
    { successTitle: () => 'Draft deleted', errorTitle: 'Could not delete the draft' },
  )
}

export function useSubmitRequest() {
  return useAppMutation<string, LeaveRequest>(
    async (id) => {
      const { data, error } = await supabase.rpc('rpc_submit_request', { p_request_id: id })
      if (error) throw error
      return data as LeaveRequest
    },
    {
      successTitle: () => 'Request submitted',
      successBody: (r) =>
        r.status === 'pending_hr'
          ? `${r.request_ref} went straight to HR — you have no supervisor on file.`
          : `${r.request_ref} is with your supervisor.`,
      errorTitle: 'Could not submit this request',
    },
  )
}

export function useSupervisorDecision() {
  return useAppMutation<{ id: string; approve: boolean; comment?: string }, LeaveRequest>(
    async ({ id, approve, comment }) => {
      const { data, error } = await supabase.rpc('rpc_supervisor_decision', {
        p_request_id: id,
        p_approve: approve,
        p_comment: comment ?? null,
      })
      if (error) throw error
      return data as LeaveRequest
    },
    {
      successTitle: (r) => (r.status === 'rejected' ? 'Request rejected' : 'Request approved'),
      successBody: (r) =>
        r.status === 'pending_hr' ? `${r.request_ref} is now with HR.` : r.request_ref,
      errorTitle: 'Could not record that decision',
    },
  )
}

export function useHrDecision() {
  return useAppMutation<{ id: string; approve: boolean; comment?: string }, LeaveRequest>(
    async ({ id, approve, comment }) => {
      const { data, error } = await supabase.rpc('rpc_hr_decision', {
        p_request_id: id,
        p_approve: approve,
        p_comment: comment ?? null,
      })
      if (error) throw error
      return data as LeaveRequest
    },
    {
      successTitle: (r) => (r.status === 'rejected' ? 'Request rejected' : 'Request approved'),
      successBody: (r) => r.request_ref,
      errorTitle: 'Could not record that decision',
    },
  )
}

export function useCancelRequest() {
  return useAppMutation<{ id: string; reason?: string }, LeaveRequest>(
    async ({ id, reason }) => {
      const { data, error } = await supabase.rpc('rpc_cancel_request', {
        p_request_id: id,
        p_reason: reason ?? null,
      })
      if (error) throw error
      return data as LeaveRequest
    },
    {
      successTitle: () => 'Request canceled',
      successBody: (r) => `${r.request_ref} — the days are back in your balance.`,
      errorTitle: 'Could not cancel this request',
    },
  )
}

export function useWithdrawRequest() {
  return useAppMutation<{ id: string; reason?: string }, LeaveRequest>(
    async ({ id, reason }) => {
      const { data, error } = await supabase.rpc('rpc_withdraw_request', {
        p_request_id: id,
        p_reason: reason ?? null,
      })
      if (error) throw error
      return data as LeaveRequest
    },
    { successTitle: () => 'Request withdrawn', errorTitle: 'Could not withdraw this request' },
  )
}

/* ------------------------------------------------------------ attachments */

export function useUploadAttachment(employeeId: string | undefined) {
  const toast = useToast()
  return useMutation({
    mutationFn: async ({ file, requestId }: { file: File; requestId: string }) => {
      if (!employeeId) throw new Error('Not signed in.')
      const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120)
      const path = `${employeeId}/${requestId}/${Date.now()}_${safeName}`
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type })
      if (error) throw error
      return path
    },
    onError: (e) => toast.error('Upload failed', humanError(e)),
  })
}

/* --------------------------------------------------------- notifications  */

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length === 0) return
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/* -------------------------------------------------------------- HR admin  */

export function useGenerateEntitlements() {
  return useAppMutation<{ year: number; employeeId?: string }, number>(
    async ({ year, employeeId }) => {
      const { data, error } = await supabase.rpc('fn_generate_entitlements', {
        p_leave_year: year,
        p_employee_id: employeeId ?? null,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    {
      successTitle: (_n, a) => `Entitlements generated for ${a.year}`,
      successBody: (n) =>
        `${n} row(s) created or refreshed. Existing carry-forward and adjustments were left alone.`,
      errorTitle: 'Could not generate entitlements',
    },
  )
}

export function useCarryForward() {
  return useAppMutation<number, number>(
    async (fromYear) => {
      const { data, error } = await supabase.rpc('fn_carry_forward', { p_from_year: fromYear })
      if (error) throw error
      return Number(data ?? 0)
    },
    {
      successTitle: (_n, year) => `Carry-forward run for ${year} → ${year + 1}`,
      successBody: (n) => `${n} employee entitlement(s) updated.`,
      errorTitle: 'Could not run carry-forward',
    },
  )
}

export function useAdjustEntitlement() {
  return useAppMutation<
    { id: string; adjustment_days: number; adjustment_reason: string },
    void
  >(
    async ({ id, adjustment_days, adjustment_reason }) => {
      const { error } = await supabase
        .from('entitlements')
        .update({ adjustment_days, adjustment_reason })
        .eq('id', id)
      if (error) throw error
    },
    { successTitle: () => 'Entitlement adjusted', errorTitle: 'Could not adjust the entitlement' },
  )
}

export function useSaveEmployee() {
  return useAppMutation<Partial<Employee> & { id: string }, void>(
    async (emp) => {
      const { id, ...rest } = emp
      const { error } = await supabase.from('employees').update(rest).eq('id', id)
      if (error) throw error
    },
    {
      successTitle: () => 'Employee updated',
      errorTitle: 'Could not update this employee',
      alsoInvalidate: ['employees'],
    },
  )
}


export function useSaveLeaveType() {
  return useAppMutation<Partial<LeaveType> & { code: string }, void>(
    async (lt) => {
      const { code, ...rest } = lt
      const { error } = await supabase.from('leave_types').update(rest).eq('code', code)
      if (error) throw error
    },
    {
      successTitle: () => 'Leave type updated',
      errorTitle: 'Could not update this leave type',
      alsoInvalidate: ['leave_types'],
    },
  )
}

export function useSaveHolidays() {
  return useAppMutation<PublicHoliday[] | Omit<PublicHoliday, 'leave_year'>[], number>(
    async (rows) => {
      const payload = rows.map((r) => ({
        holiday_date: r.holiday_date,
        name_en: r.name_en,
        name_kh: r.name_kh ?? null,
        is_half_day: r.is_half_day ?? false,
      }))
      const { error } = await supabase
        .from('public_holidays')
        .upsert(payload, { onConflict: 'holiday_date' })
      if (error) throw error
      return payload.length
    },
    {
      successTitle: (n) => `${n} public holiday(s) saved`,
      successBody: () => 'Verify these against the official sub-decree before relying on them.',
      errorTitle: 'Could not save public holidays',
      alsoInvalidate: ['holidays'],
    },
  )
}

export function useDeleteHoliday() {
  return useAppMutation<string, void>(
    async (date) => {
      const { error } = await supabase.from('public_holidays').delete().eq('holiday_date', date)
      if (error) throw error
    },
    {
      successTitle: () => 'Public holiday removed',
      errorTitle: 'Could not remove that holiday',
      alsoInvalidate: ['holidays'],
    },
  )
}

/* ------------------------------------------------------- accounts -------- */

export interface CreateEmployeeInput {
  email: string
  temp_password: string
  staff_code: string
  full_name: string
  hire_date: string
  department?: string
  position_title?: string
  supervisor_id?: string | null
  gender?: string | null
  full_name_kh?: string | null
  role?: string
}

/**
 * Creates the sign-in account and the staff record together. The temporary
 * password is generated in the browser, handed straight to the database, and
 * shown to the administrator once so they can pass it on. It is never stored
 * anywhere in readable form - Postgres hashes it on the way in.
 */
export function useCreateEmployee() {
  return useAppMutation<CreateEmployeeInput, Employee>(
    async (input) => {
      const { data, error } = await supabase.rpc('rpc_admin_create_employee', {
        p_email: input.email,
        p_temp_password: input.temp_password,
        p_staff_code: input.staff_code,
        p_full_name: input.full_name,
        p_hire_date: input.hire_date,
        p_department: input.department ?? null,
        p_position_title: input.position_title ?? null,
        p_supervisor_id: input.supervisor_id ?? null,
        p_gender: input.gender ?? null,
        p_full_name_kh: input.full_name_kh ?? null,
        p_role: input.role ?? 'employee',
      })
      if (error) throw error
      return data as Employee
    },
    {
      successTitle: (e) => `${e.full_name} can now sign in`,
      successBody: () => 'Give them the temporary password shown on screen.',
      errorTitle: 'Could not create this account',
      alsoInvalidate: ['employees'],
    },
  )
}

export function useResetPassword() {
  return useAppMutation<{ employeeId: string; tempPassword: string }, void>(
    async ({ employeeId, tempPassword }) => {
      const { error } = await supabase.rpc('rpc_admin_reset_password', {
        p_employee_id: employeeId,
        p_temp_password: tempPassword,
      })
      if (error) throw error
    },
    {
      successTitle: () => 'Temporary password set',
      successBody: () => 'They will be asked to choose a new one when they sign in.',
      errorTitle: 'Could not reset the password',
      alsoInvalidate: ['employees'],
    },
  )
}

/** Re-exported so callers do not need to know where the rules live. */
export { generatePin as generateTempPassword } from '@/lib/password'
