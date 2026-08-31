import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const DEMO_PASSWORD = 'demo-password-not-for-production'

export const USER = {
  sophea: 'sophea.chan@clintonhealthaccess.org', // system_admin, no supervisor
  dara: 'dara.pen@clintonhealthaccess.org', // hr_admin
  sokha: 'sokha.meas@clintonhealthaccess.org', // supervisor of Chantha, Bopha, Rithy
  rithy: 'rithy.norn@clintonhealthaccess.org', // supervisor of Sreymom
  chantha: 'chantha.ly@clintonhealthaccess.org', // employee
  bopha: 'bopha.sok@clintonhealthaccess.org', // employee
  vanna: 'vanna.chea@clintonhealthaccess.org', // employee (male), reports to HR
  sreymom: 'sreymom.kim@clintonhealthaccess.org', // employee, hired 2026-06-01
} as const

export const ID = {
  sophea: '11111111-1111-4111-8111-111111111111',
  dara: '22222222-2222-4222-8222-222222222222',
  sokha: '33333333-3333-4333-8333-333333333333',
  rithy: '44444444-4444-4444-8444-444444444444',
  chantha: '55555555-5555-4555-8555-555555555555',
  bopha: '66666666-6666-4666-8666-666666666666',
  vanna: '77777777-7777-4777-8777-777777777777',
  sreymom: '88888888-8888-4888-8888-888888888888',
} as const

export async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`)
  return client
}

export function thisYear(): number {
  return new Date().getFullYear()
}

/**
 * Local calendar date. NOT toISOString().
 *
 * toISOString() converts to UTC first, so on a UTC+7 machine a local Monday is
 * emitted as the previous Sunday. findRange was therefore asking for Sun-Tue
 * windows and never finding three working days — a failure that appeared or
 * vanished depending on what hour of the day the suite happened to run.
 */
export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

/** The next Monday at least `minAheadDays` from today. */
export function mondayAtLeast(minAheadDays: number): Date {
  const d = addDays(new Date(), minAheadDays)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  return d
}

/**
 * Finds a start date whose N-day span really does compute to exactly N working
 * days, by asking the database. Hard-coding dates would make these tests break
 * every time a public holiday moves - which, for Cambodia, is annually.
 */
export async function findRange(
  client: SupabaseClient,
  leaveType: string,
  wantDays: number,
  minAheadDays = 21,
): Promise<{ start: string; end: string; days: number }> {
  let cursor = mondayAtLeast(minAheadDays)
  for (let attempt = 0; attempt < 30; attempt++) {
    const start = iso(cursor)
    const end = iso(addDays(cursor, wantDays - 1))
    const { data, error } = await client.rpc('rpc_preview_days', {
      p_leave_type: leaveType,
      p_start: start,
      p_end: end,
      p_start_portion: 'full_day',
      p_end_portion: 'full_day',
    })
    if (error) throw error
    if (Number(data) === wantDays) return { start, end, days: wantDays }
    cursor = addDays(cursor, 7)
  }
  throw new Error(`Could not find a clear ${wantDays}-working-day window for ${leaveType}.`)
}

/**
 * The most recent working day on or before yesterday, for the retroactive
 * sick-leave cases. Asks the database rather than assuming, so a public holiday
 * cannot silently turn a 1-day request into a 0-day one.
 */
export async function findPastWorkingDay(
  client: SupabaseClient,
  leaveType = 'SICK',
): Promise<string> {
  for (let back = 1; back <= 10; back++) {
    const candidate = iso(addDays(new Date(), -back))
    const { data, error } = await client.rpc('rpc_preview_days', {
      p_leave_type: leaveType,
      p_start: candidate,
      p_end: candidate,
      p_start_portion: 'full_day',
      p_end_portion: 'full_day',
    })
    if (error) throw error
    if (Number(data) === 1) return candidate
  }
  throw new Error(`No working day found in the last 10 days for ${leaveType}.`)
}

/** Windows handed out so far, so separate tests never overlap each other. */
let windowCursor = 21
export function nextWindowOffset(step = 21): number {
  windowCursor += step
  return windowCursor
}
export function resetWindowCursor(): void {
  windowCursor = 21
}

export interface DraftArgs {
  employee_id: string
  leave_type_code: string
  start_date: string
  end_date: string
  start_portion?: string
  end_portion?: string
  reason?: string
  attachment_path?: string
}

export async function createDraft(client: SupabaseClient, args: DraftArgs) {
  const { data, error } = await client
    .from('leave_requests')
    .insert({
      employee_id: args.employee_id,
      leave_type_code: args.leave_type_code,
      start_date: args.start_date,
      end_date: args.end_date,
      start_portion: args.start_portion ?? 'full_day',
      end_portion: args.end_portion ?? 'full_day',
      reason: args.reason ?? 'Acceptance test',
      attachment_path: args.attachment_path ?? null,
      status: 'draft',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Cancels every live request for one employee so a test starts from a known
 * balance. HR is allowed to cancel anything, including leave that has already
 * started, which is exactly why this runs as HR.
 */
export async function clearRequests(hr: SupabaseClient, employeeId: string) {
  const { data, error } = await hr
    .from('leave_requests')
    .select('id,status')
    .eq('employee_id', employeeId)
    .in('status', ['draft', 'pending_supervisor', 'pending_hr', 'approved'])
  if (error) throw error

  for (const r of data ?? []) {
    const { error: e } = await hr.rpc('rpc_cancel_request', {
      p_request_id: r.id,
      p_reason: 'Cleared by the acceptance test suite',
    })
    if (e) throw new Error(`Could not clear ${r.id}: ${e.message}`)
  }
}

/** Forces total_days for one entitlement to an exact figure, via the adjustment. */
export async function setEntitlementTotal(
  hr: SupabaseClient,
  employeeId: string,
  leaveTypeCode: string,
  leaveYear: number,
  totalDays: number,
) {
  const { data, error } = await hr
    .from('entitlements')
    .select('id,prorated_days,carry_forward_days')
    .eq('employee_id', employeeId)
    .eq('leave_type_code', leaveTypeCode)
    .eq('leave_year', leaveYear)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`No ${leaveTypeCode} entitlement for ${employeeId} in ${leaveYear}.`)

  const adjustment =
    totalDays - Number(data.prorated_days) - Number(data.carry_forward_days)

  const { error: e2 } = await hr
    .from('entitlements')
    .update({
      adjustment_days: adjustment,
      adjustment_reason:
        adjustment === 0 ? null : 'Set by the acceptance test suite to a known balance',
    })
    .eq('id', data.id)
  if (e2) throw e2
}

export async function availableBalance(
  client: SupabaseClient,
  employeeId: string,
  leaveTypeCode: string,
  leaveYear: number,
): Promise<number> {
  const { data, error } = await client.rpc('fn_available_balance', {
    p_employee_id: employeeId,
    p_leave_type: leaveTypeCode,
    p_leave_year: leaveYear,
    p_exclude_request: null,
  })
  if (error) throw error
  return Number(data)
}

export async function statusOf(client: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await client
    .from('leave_requests')
    .select('status')
    .eq('id', id)
    .single()
  if (error) throw error
  return data.status
}

/** Runs `fn`, expecting it to be refused, and returns the message. */
export async function expectRefusal(fn: () => Promise<{ error: unknown }>): Promise<string> {
  const { error } = await fn()
  if (!error) throw new Error('Expected the server to refuse this, but it succeeded.')
  return (error as { message: string }).message
}
