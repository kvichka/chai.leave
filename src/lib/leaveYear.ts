/**
 * Which leave year does a date fall in?
 *
 * Mirrors public.fn_leave_year_of. CHAI Cambodia runs a calendar leave year
 * (leave_year_start_month = 1), but the setting exists so a future move to a
 * fiscal year does not require a schema change.
 */
export function leaveYearOf(date: Date, leaveYearStartMonth = 1): number {
  return date.getMonth() + 1 >= leaveYearStartMonth ? date.getFullYear() : date.getFullYear() - 1
}

export function leaveYearBounds(
  leaveYear: number,
  leaveYearStartMonth = 1,
): { start: Date; end: Date } {
  const start = new Date(leaveYear, leaveYearStartMonth - 1, 1)
  const end = new Date(leaveYear + 1, leaveYearStartMonth - 1, 0)
  return { start, end }
}
