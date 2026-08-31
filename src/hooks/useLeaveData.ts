import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/AuthProvider'
import type {
  AbsenceDay,
  AppNotification,
  AppSettings,
  AuditLogRow,
  DayPortion,
  Employee,
  Entitlement,
  LeaveBalance,
  LeaveLiability,
  LeaveRequest,
  LeaveType,
  PendingApproval,
  PublicHoliday,
  TeamAbsence,
  TeamCoverage,
} from '@/lib/database.types'
import { isoDate } from '@/lib/format'
import { leaveYearOf } from '@/lib/leaveYear'

const STATIC = { staleTime: 30 * 60 * 1000 }
const LIVE = { staleTime: 30 * 1000 }

export function currentLeaveYear(settings?: AppSettings | null, on = new Date()): number {
  return leaveYearOf(on, settings?.leave_year_start_month ?? 1)
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    ...STATIC,
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single()
      if (error) throw error
      return data
    },
  })
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ['leave_types'],
    ...STATIC,
    queryFn: async (): Promise<LeaveType[]> => {
      const { data, error } = await supabase
        .from('leave_types')
        .select('*')
        .order('display_order')
      if (error) throw error
      return data
    },
  })
}

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: ['holidays', year ?? 'all'],
    ...STATIC,
    queryFn: async (): Promise<PublicHoliday[]> => {
      let q = supabase.from('public_holidays').select('*').order('holiday_date')
      if (year) q = q.eq('leave_year', year)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

export function useUpcomingHolidays(limit = 3) {
  return useQuery({
    queryKey: ['holidays', 'upcoming', limit],
    ...STATIC,
    queryFn: async (): Promise<PublicHoliday[]> => {
      const { data, error } = await supabase
        .from('public_holidays')
        .select('*')
        .gte('holiday_date', isoDate(new Date()))
        .order('holiday_date')
        .limit(limit)
      if (error) throw error
      return data
    },
  })
}

export function useMyBalances(leaveYear: number) {
  const { employee } = useAuth()
  return useQuery({
    queryKey: ['balances', 'me', employee?.id, leaveYear],
    enabled: !!employee?.id,
    ...LIVE,
    queryFn: async (): Promise<LeaveBalance[]> => {
      const { data, error } = await supabase
        .from('v_leave_balances')
        .select('*')
        .eq('employee_id', employee!.id)
        .eq('leave_year', leaveYear)
        .order('display_order')
      if (error) throw error
      return data
    },
  })
}

export function useAllBalances(leaveYear: number, enabled = true) {
  return useQuery({
    queryKey: ['balances', 'all', leaveYear],
    enabled,
    ...LIVE,
    queryFn: async (): Promise<LeaveBalance[]> => {
      const { data, error } = await supabase
        .from('v_leave_balances')
        .select('*')
        .eq('leave_year', leaveYear)
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

export function useMyRequests() {
  const { employee } = useAuth()
  return useQuery({
    queryKey: ['requests', 'me', employee?.id],
    enabled: !!employee?.id,
    ...LIVE,
    queryFn: async (): Promise<LeaveRequest[]> => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('employee_id', employee!.id)
        .order('start_date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useEmployeeRequests(employeeId: string | null) {
  return useQuery({
    queryKey: ['requests', 'employee', employeeId],
    enabled: !!employeeId,
    ...LIVE,
    queryFn: async (): Promise<LeaveRequest[]> => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('employee_id', employeeId!)
        .order('start_date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ['pending_approvals'],
    ...LIVE,
    queryFn: async (): Promise<PendingApproval[]> => {
      const { data, error } = await supabase
        .from('v_pending_approvals')
        .select('*')
        .order('days_waiting', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await supabase.from('employees').select('*').order('full_name')
      if (error) throw error
      return data
    },
  })
}

export function useOutToday() {
  return useQuery({
    queryKey: ['out_today'],
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_out_today').select('*').order('full_name')
      if (error) throw error
      return data
    },
  })
}

export function useAbsenceCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['absences', from, to],
    ...LIVE,
    queryFn: async (): Promise<AbsenceDay[]> => {
      const { data, error } = await supabase
        .from('v_absence_calendar')
        .select('*')
        .gte('absence_date', from)
        .lte('absence_date', to)
        .order('absence_date')
      if (error) throw error
      return data
    },
  })
}

/**
 * Team-scoped absences. Goes through an RPC rather than the view, because the
 * employees RLS policy deliberately does not let colleagues read each other's
 * rows - see the comment on rpc_team_absences in 0008_rls.sql.
 */
export function useTeamAbsences(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['team_absences', from, to],
    enabled,
    ...LIVE,
    queryFn: async (): Promise<TeamAbsence[]> => {
      const { data, error } = await supabase.rpc('rpc_team_absences', {
        p_start: from,
        p_end: to,
      })
      if (error) throw error
      return (data ?? []) as TeamAbsence[]
    },
  })
}

export function useCoverage() {
  return useQuery({
    queryKey: ['coverage'],
    ...LIVE,
    queryFn: async (): Promise<TeamCoverage[]> => {
      const { data, error } = await supabase
        .from('v_team_coverage')
        .select('*')
        .order('the_date')
      if (error) throw error
      return data
    },
  })
}

export function useLiability(leaveYear: number) {
  return useQuery({
    queryKey: ['liability', leaveYear],
    ...LIVE,
    queryFn: async (): Promise<LeaveLiability[]> => {
      const { data, error } = await supabase
        .from('v_leave_liability')
        .select('*')
        .eq('leave_year', leaveYear)
        .order('unused_days', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useNotifications() {
  const { employee } = useAuth()
  return useQuery({
    queryKey: ['notifications', employee?.id],
    enabled: !!employee?.id,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })
}

export function useEntitlements(leaveYear: number, employeeId?: string) {
  return useQuery({
    queryKey: ['entitlements', leaveYear, employeeId ?? 'all'],
    ...LIVE,
    queryFn: async (): Promise<Entitlement[]> => {
      let q = supabase.from('entitlements').select('*').eq('leave_year', leaveYear)
      if (employeeId) q = q.eq('employee_id', employeeId)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

export function useAuditLog(filters: {
  table?: string
  actor?: string
  from?: string
  to?: string
}) {
  return useQuery({
    queryKey: ['audit_log', filters],
    queryFn: async (): Promise<AuditLogRow[]> => {
      let q = supabase
        .from('audit_log')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(500)
      if (filters.table) q = q.eq('table_name', filters.table)
      if (filters.actor) q = q.eq('actor_id', filters.actor)
      if (filters.from) q = q.gte('occurred_at', filters.from)
      if (filters.to) q = q.lte('occurred_at', `${filters.to}T23:59:59Z`)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

/**
 * The live day count on the request form. Computed by the database, never by
 * the browser, so the number on screen is the number that will be stored.
 */
export function usePreviewDays(args: {
  leaveType: string | null
  start: string | null
  end: string | null
  startPortion: DayPortion
  endPortion: DayPortion
}) {
  const { leaveType, start, end, startPortion, endPortion } = args
  return useQuery({
    queryKey: ['preview_days', leaveType, start, end, startPortion, endPortion],
    enabled: !!leaveType && !!start && !!end && end >= start,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('rpc_preview_days', {
        p_leave_type: leaveType,
        p_start: start,
        p_end: end,
        p_start_portion: startPortion,
        p_end_portion: endPortion,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
  })
}

/**
 * Requests that have already been decided, for the approvals history.
 *
 * Scope comes from Row Level Security, not from a filter here: a supervisor
 * sees their own reporting tree, HR sees everyone. Bounded to one leave year so
 * the query stays small as history accumulates.
 */
export function useDecisionHistory(leaveYear: number) {
  return useQuery({
    queryKey: ['decision_history', leaveYear],
    ...LIVE,
    queryFn: async (): Promise<LeaveRequest[]> => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('leave_year', leaveYear)
        .in('status', ['approved', 'rejected', 'cancelled', 'withdrawn'])
        .order('updated_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data
    },
  })
}
