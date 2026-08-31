import { format, parseISO, differenceInCalendarDays, isValid } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { DayPortion, LeaveStatus } from './database.types'

export const TIME_ZONE = 'Asia/Phnom_Penh'

/** House date format. A raw ISO timestamp is never shown to a user. */
export const DATE_FORMAT = 'dd MMM yyyy'
export const DATE_TIME_FORMAT = 'dd MMM yyyy, HH:mm'

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? d : null
}

/** A plain `date` column - no timezone conversion, it has no time in it. */
export function fmtDate(value: string | Date | null | undefined): string {
  const d = toDate(value)
  return d ? format(d, DATE_FORMAT) : '—'
}

/** A timestamptz column, rendered in Phnom Penh time. */
export function fmtDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value)
  return d ? formatInTimeZone(d, TIME_ZONE, DATE_TIME_FORMAT) : '—'
}

export function fmtDateRange(start: string, end: string): string {
  if (start === end) return fmtDate(start)
  const a = toDate(start)
  const b = toDate(end)
  if (!a || !b) return '—'
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) {
      return `${format(a, 'dd')} – ${format(b, DATE_FORMAT)}`
    }
    return `${format(a, 'dd MMM')} – ${format(b, DATE_FORMAT)}`
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

/** 2 -> "2", 4.5 -> "4.5". Never "4.50", never "4.500000001". */
export function fmtDays(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0'
  const n = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(n)) return '0'
  return String(Math.round(n * 100) / 100)
}

export function fmtDaysWithUnit(value: number | null | undefined, unit: string): string {
  const n = Number(value ?? 0)
  const noun = unit === 'calendar_day' ? 'calendar day' : 'day'
  return `${fmtDays(n)} ${noun}${n === 1 ? '' : 's'}`
}

export function fmtPercent(value: number | null | undefined, digits = 0): string {
  const n = Number(value ?? 0)
  return `${n.toFixed(digits)}%`
}

export const PORTION_LABEL: Record<DayPortion, string> = {
  full_day: 'Full day',
  morning: 'Morning only',
  afternoon: 'Afternoon only',
}

// "Canceled" with one L: CHAI writes American English (CHAI Style Guide).
// The database enum stays `cancelled` - identifiers are not prose, and
// renaming an enum value across the schema buys nothing a label cannot.
export const STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: 'Draft',
  pending_supervisor: 'With supervisor',
  pending_hr: 'With HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Canceled',
  withdrawn: 'Withdrawn',
}

/**
 * Status colors, applied identically everywhere in the app, drawn from the
 * CHAI palette rather than generic Tailwind hues:
 *   approved  -> Green / Dark Green
 *   pending   -> Gold / Dark Gold
 *   rejected  -> Dark Red
 *   draft     -> Light Grey, deliberately quiet
 */
export const STATUS_CLASS: Record<LeaveStatus, string> = {
  draft: 'bg-chaiLightGrey text-slate-700 ring-slate-300',
  pending_supervisor: 'bg-chaiLightGold/40 text-chaiDarkGold ring-chaiGold/50',
  pending_hr: 'bg-chaiLightGold/40 text-chaiDarkGold ring-chaiGold/50',
  approved: 'bg-chaiGreen/15 text-chaiDarkGreen ring-chaiGreen/40',
  rejected: 'bg-chaiDarkRed/10 text-chaiDarkRed ring-chaiDarkRed/30',
  cancelled: 'bg-chaiLightGrey text-slate-400 ring-slate-200',
  withdrawn: 'bg-chaiLightGrey text-slate-400 ring-slate-200',
}

/**
 * Chart series colors. These come from the CHAI expanded accent set, which the
 * Identity Guide designates for charts and data visualization. Dark Blue leads,
 * then Turquoise, in the guide's priority order.
 */
export const LEAVE_TYPE_COLOR: Record<string, string> = {
  ANNUAL: '#003E78', // Dark Blue
  SICK: '#7C1220', // Dark Red
  LEARNING: '#117996', // Turquoise
  MENTAL_HEALTH: '#218477', // Dark Teal
  SPECIAL_SIB_GP: '#C08E0A', // Dark Gold
  SPECIAL_IMMEDIATE: '#F3B71B', // Gold
  PATERNITY: '#158CFF', // Medium Blue
  MATERNITY: '#46C6EA', // Light Turquoise
  MATERNITY_EXT: '#6EDBCD', // Teal
  ADOPT_UNDER6: '#1ED37F', // Green
  ADOPT_UNDER6_EXT: '#169E5F', // Dark Green
  ADOPT_OVER6: '#218477', // Dark Teal
  UNPAID: '#64748B', // neutral - unpaid leave is deliberately not a brand accent
}

export function leaveTypeColor(code: string): string {
  return LEAVE_TYPE_COLOR[code] ?? '#003E78'
}

/** Approval-queue ageing, green through to Dark Red. */
export const AGING_COLOR: Record<string, string> = {
  '0-2 days': '#1ED37F', // Green
  '3-5 days': '#F3B71B', // Gold
  '6-10 days': '#C08E0A', // Dark Gold
  '>10 days': '#7C1220', // Dark Red
}

export function daysWaiting(submittedAt: string | null): number {
  const d = toDate(submittedAt)
  if (!d) return 0
  return Math.max(differenceInCalendarDays(new Date(), d), 0)
}

/** Same buckets as v_pending_approvals, for client-side grouping. */
export function agingBucket(days: number): string {
  if (days <= 2) return '0-2 days'
  if (days <= 5) return '3-5 days'
  if (days <= 10) return '6-10 days'
  return '>10 days'
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** ISO yyyy-MM-dd for a Date, without the UTC shift that toISOString() causes. */
export function isoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}
