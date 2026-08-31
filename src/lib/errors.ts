import type { PostgrestError } from '@supabase/supabase-js'

/**
 * The rule for this app: never replace a Postgres exception with
 * "Something went wrong." Every rule in the system is enforced in the database
 * and every one of those rules already carries a sentence written for a human.
 * Show it.
 */
export function humanError(error: unknown): string {
  if (!error) return 'Unknown error.'

  if (typeof error === 'string') return error

  const e = error as Partial<PostgrestError> & {
    message?: string
    error_description?: string
    details?: string
    hint?: string
    code?: string
  }

  // Constraint violations that escaped a friendly RAISE, translated once here
  // rather than in every call site.
  switch (e.code) {
    case '23505':
      if (e.message?.includes('employees_staff_code_key'))
        return 'That staff code is already in use.'
      if (e.message?.includes('employees_email_key'))
        return 'That email address is already registered.'
      if (e.message?.includes('entitlements_unique'))
        return 'An entitlement already exists for that employee, leave type and year.'
      break
    case '23514':
      if (e.message?.includes('entitlements_adjustment_needs_reason'))
        return 'An adjustment must have a reason. Enter one and try again.'
      if (e.message?.includes('leave_requests_date_order'))
        return 'The end date cannot be before the start date.'
      break
    case '23503':
      // Only paraphrase a genuine FK violation; our own RAISEs reuse this code
      // and already say something more useful.
      if (e.message?.includes('violates foreign key constraint')) {
        return 'That record is referenced elsewhere and cannot be changed or removed.'
      }
      break
    case '42501':
      return e.message ?? 'You do not have permission to do that.'
    case 'PGRST301':
      return 'Your session expired. Sign in again.'
  }

  const raw = e.message ?? e.error_description ?? e.details ?? ''

  // Strip the plpgsql prefix Postgres adds, keep the sentence we wrote.
  const cleaned = raw
    .replace(/^ERROR:\s*/i, '')
    .replace(/^Postgres error:\s*/i, '')
    .trim()

  return cleaned || 'Unknown error.'
}

export class AppError extends Error {}
