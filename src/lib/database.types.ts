// Hand-maintained mirror of /supabase/migrations. Regenerate with
//   supabase gen types typescript --local > src/lib/database.types.ts
// if you prefer, but keep the hand-written view and RPC shapes below.

export type AppRole = 'employee' | 'supervisor' | 'hr_admin' | 'system_admin'

export type LeaveStatus =
  | 'draft'
  | 'pending_supervisor'
  | 'pending_hr'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'withdrawn'

export type DayPortion = 'full_day' | 'morning' | 'afternoon'
export type LeaveUnit = 'working_day' | 'calendar_day'
export type EmploymentStatus = 'active' | 'on_probation' | 'suspended' | 'exited'

export interface Employee {
  id: string
  staff_code: string
  full_name: string
  full_name_kh: string | null
  email: string
  position_title: string | null
  department: string | null
  supervisor_id: string | null
  hire_date: string
  probation_end_date: string | null
  exit_date: string | null
  employment_status: EmploymentStatus
  role: AppRole
  must_change_password: boolean
  gender: 'M' | 'F' | null
  created_at: string
  updated_at: string
  date_of_birth: string | null
  avatar_path: string | null
  avatar_emoji: string | null
  show_birthday: boolean
}

export interface LeaveType {
  code: string
  parent_code: string | null
  name_en: string
  name_kh: string | null
  description: string | null
  unit: LeaveUnit
  default_days: number
  is_prorated: boolean
  max_carry_forward: number
  carry_forward_expiry_month: number | null
  allows_half_day: boolean
  requires_attachment: boolean
  attachment_after_days: number | null
  requires_hr_approval: boolean
  min_notice_days: number
  max_consecutive_days: number | null
  gender_restriction: 'M' | 'F' | null
  is_paid: boolean
  counts_against_balance: boolean
  is_requestable: boolean
  is_active: boolean
  display_order: number
}

export interface PublicHoliday {
  holiday_date: string
  name_en: string
  name_kh: string | null
  leave_year: number
  is_half_day: boolean
}

export interface Entitlement {
  id: string
  employee_id: string
  leave_type_code: string
  leave_year: number
  base_days: number
  prorated_days: number
  carry_forward_days: number
  adjustment_days: number
  adjustment_reason: string | null
  granted_by: string | null
  granted_at: string | null
  total_days: number
}

export interface LeaveRequest {
  id: string
  request_ref: string
  employee_id: string
  leave_type_code: string
  leave_year: number
  start_date: string
  end_date: string
  start_portion: DayPortion
  end_portion: DayPortion
  days_requested: number
  reason: string | null
  handover_notes: string | null
  contact_while_away: string | null
  attachment_path: string | null
  status: LeaveStatus
  submitted_at: string | null
  supervisor_id: string | null
  supervisor_decision_at: string | null
  supervisor_comment: string | null
  hr_id: string | null
  hr_decision_at: string | null
  hr_comment: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
}

export interface AppSettings {
  id: number
  prorate_method: 'monthly_accrual' | 'daily_365'
  leave_year_start_month: number
  allow_negative_balance: boolean
  min_days_notice_default: number
  max_pending_per_employee: number
  coverage_risk_threshold: number
  email_notifications_enabled: boolean
  min_password_length: number
}

export interface AppNotification {
  id: number
  recipient_id: string
  request_id: string | null
  event_type: string
  title: string
  body: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface AuditLogRow {
  id: number
  table_name: string
  record_id: string
  action: string
  actor_id: string | null
  actor_email: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  occurred_at: string
}

/* ---------------------------------------------------------------- views --- */

export interface LeaveBalance {
  employee_id: string
  staff_code: string
  full_name: string
  department: string | null
  supervisor_id: string | null
  employment_status: EmploymentStatus
  leave_type_code: string
  name_en: string
  parent_code: string | null
  unit: LeaveUnit
  display_order: number
  is_paid: boolean
  counts_against_balance: boolean
  leave_year: number
  base_days: number
  prorated_days: number
  carry_forward_days: number
  adjustment_days: number
  adjustment_reason: string | null
  entitled_days: number
  taken_days: number
  pending_days: number
  draft_days: number
  expired_carry_forward_days: number
  available_days: number
  utilization_pct: number
}

export type AgingBucket = '0-2 days' | '3-5 days' | '6-10 days' | '>10 days'

export interface PendingApproval {
  request_id: string
  request_ref: string
  status: Extract<LeaveStatus, 'pending_supervisor' | 'pending_hr'>
  employee_id: string
  employee_name: string
  staff_code: string
  department: string | null
  supervisor_id: string | null
  supervisor_name: string | null
  leave_type_code: string
  leave_type_name: string
  unit: LeaveUnit
  start_date: string
  end_date: string
  start_portion: DayPortion
  end_portion: DayPortion
  days_requested: number
  reason: string | null
  handover_notes: string | null
  contact_while_away: string | null
  attachment_path: string | null
  submitted_at: string
  days_waiting: number
  aging_bucket: AgingBucket
  balance_before_approval: number
  balance_after_approval: number
}

export interface AbsenceDay {
  request_id: string
  request_ref: string
  employee_id: string
  full_name: string
  staff_code: string
  department: string | null
  supervisor_id: string | null
  leave_type_code: string
  leave_type_name: string
  unit: LeaveUnit
  status: LeaveStatus
  absence_date: string
  start_date: string
  end_date: string
  return_date: string
  day_portion: DayPortion
  is_working_day: boolean
}

export interface OutToday {
  employee_id: string
  full_name: string
  staff_code: string
  department: string | null
  supervisor_id: string | null
  leave_type_code: string
  leave_type_name: string
  day_portion: DayPortion
  start_date: string
  end_date: string
  return_date: string
}

export interface TeamCoverage {
  department: string
  the_date: string
  headcount: number
  absent_count: number
  absent_pct: number
  is_coverage_risk: boolean
}

export interface LeaveLiability {
  department: string
  leave_year: number
  staff_count: number
  entitled_days: number
  taken_days: number
  pending_days: number
  unused_days: number
  utilization_pct: number
}

/* ------------------------------------------------------------------ rpc --- */

export interface TeamAbsence {
  employee_id: string
  full_name: string
  department: string | null
  leave_type_code: string
  leave_type_name: string
  status: LeaveStatus
  start_date: string
  end_date: string
  absence_date: string
  day_portion: DayPortion
  is_self: boolean
}


/**
 * Day and month only, from rpc_birthdays. The year deliberately never leaves
 * the database - see supabase/migrations/0015_birthdays.sql.
 */
export interface Birthday {
  employee_id: string
  full_name: string
  department: string | null
  birth_month: number
  birth_day: number
}

/** A claim for time off in lieu. See supabase/migrations/0018_compensation_leave.sql. */
export interface CompLeaveClaim {
  id: string
  employee_id: string
  worked_date: string
  worked_to: string
  days_earned: number
  reason: string
  status: LeaveStatus
  leave_year: number
  supervisor_id: string | null
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  submitted_at: string | null
  created_at: string
}
