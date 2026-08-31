import { describe, expect, it } from 'vitest'
import {
  agingBucket,
  fmtDate,
  fmtDateRange,
  fmtDays,
  fmtDaysWithUnit,
  fmtPercent,
  initials,
  isoDate,
  STATUS_CLASS,
  STATUS_LABEL,
  AGING_COLOR,
  LEAVE_TYPE_COLOR,
  leaveTypeColor,
} from '@/lib/format'
import { leaveYearBounds, leaveYearOf } from '@/lib/leaveYear'

describe('fmtDays', () => {
  it('never shows trailing zeros', () => {
    expect(fmtDays(2)).toBe('2')
    expect(fmtDays(2.0)).toBe('2')
    expect(fmtDays('2.00')).toBe('2')
  })

  it('keeps halves', () => {
    expect(fmtDays(4.5)).toBe('4.5')
    expect(fmtDays('10.50')).toBe('10.5')
  })

  it('tolerates nulls and rubbish', () => {
    expect(fmtDays(null)).toBe('0')
    expect(fmtDays(undefined)).toBe('0')
    expect(fmtDays('not a number')).toBe('0')
  })

  it('does not reproduce the spreadsheet float', () => {
    expect(fmtDays(10.553424657534247)).toBe('10.55')
  })
})

describe('fmtDaysWithUnit', () => {
  it('pluralises and names the unit', () => {
    expect(fmtDaysWithUnit(1, 'working_day')).toBe('1 day')
    expect(fmtDaysWithUnit(2, 'working_day')).toBe('2 days')
    expect(fmtDaysWithUnit(90, 'calendar_day')).toBe('90 calendar days')
    expect(fmtDaysWithUnit(1, 'calendar_day')).toBe('1 calendar day')
  })
})

describe('date formatting', () => {
  it('uses dd MMM yyyy and never an ISO timestamp', () => {
    expect(fmtDate('2026-08-03')).toBe('03 Aug 2026')
    expect(fmtDate(null)).toBe('—')
  })

  it('collapses a range within one month', () => {
    expect(fmtDateRange('2026-08-03', '2026-08-07')).toBe('03 – 07 Aug 2026')
  })

  it('keeps both months when the range crosses one', () => {
    expect(fmtDateRange('2026-08-30', '2026-09-02')).toBe('30 Aug – 02 Sep 2026')
  })

  it('shows a single date once', () => {
    expect(fmtDateRange('2026-08-03', '2026-08-03')).toBe('03 Aug 2026')
  })

  it('keeps both years when the range crosses one', () => {
    expect(fmtDateRange('2026-12-28', '2027-01-04')).toBe('28 Dec 2026 – 04 Jan 2027')
  })

  it('isoDate does not shift the day across the timezone boundary', () => {
    // A naive toISOString() on a local midnight can roll back a day.
    const d = new Date(2026, 7, 3, 0, 30)
    expect(isoDate(d)).toBe('2026-08-03')
  })
})

describe('agingBucket', () => {
  it('matches the SQL buckets in v_pending_approvals exactly', () => {
    expect(agingBucket(0)).toBe('0-2 days')
    expect(agingBucket(2)).toBe('0-2 days')
    expect(agingBucket(3)).toBe('3-5 days')
    expect(agingBucket(5)).toBe('3-5 days')
    expect(agingBucket(6)).toBe('6-10 days')
    expect(agingBucket(10)).toBe('6-10 days')
    expect(agingBucket(11)).toBe('>10 days')
    expect(agingBucket(400)).toBe('>10 days')
  })
})

describe('status presentation', () => {
  it('gives every status a label and a color', () => {
    const statuses = Object.keys(STATUS_LABEL)
    expect(statuses).toHaveLength(7)
    for (const s of statuses) {
      expect(STATUS_CLASS[s as keyof typeof STATUS_CLASS]).toBeTruthy()
    }
  })

  it('uses CHAI palette tokens, not generic Tailwind hues', () => {
    expect(STATUS_CLASS.approved).toContain('chaiGreen')
    expect(STATUS_CLASS.pending_supervisor).toContain('chaiGold')
    expect(STATUS_CLASS.pending_hr).toContain('chaiGold')
    expect(STATUS_CLASS.rejected).toContain('chaiDarkRed')
    // Draft, cancelled and withdrawn stay deliberately quiet.
    expect(STATUS_CLASS.draft).toContain('chaiLightGrey')
    expect(STATUS_CLASS.cancelled).toContain('chaiLightGrey')
    expect(STATUS_CLASS.withdrawn).toContain('chaiLightGrey')

    // The two pending stages must be visually identical - "with supervisor" and
    // "with HR" are the same thing to the person waiting.
    expect(STATUS_CLASS.pending_supervisor).toBe(STATUS_CLASS.pending_hr)
  })

  it('writes American English, per the CHAI Style Guide', () => {
    expect(STATUS_LABEL.cancelled).toBe('Canceled')
    for (const label of Object.values(STATUS_LABEL)) {
      expect(label).not.toMatch(/cancelled/i)
    }
  })
})

describe('chart colors are all from the CHAI palette', () => {
  // Every value in the CHAI Identity Guide, plus the one deliberate neutral.
  const CHAI_PALETTE = new Set(
    [
      '#003E78', // Dark Blue
      '#117996', // Turquoise
      '#F3B71B', // Gold
      '#D5E7EF', // Light Blue
      '#F2F2F2', // Light Grey
      '#F8D476', // Light Gold
      '#46C6EA', // Light Turquoise
      '#158CFF', // Medium Blue
      '#C08E0A', // Dark Gold
      '#6EDBCD', // Teal
      '#218477', // Dark Teal
      '#1ED37F', // Green
      '#169E5F', // Dark Green
      '#7C1220', // Dark Red
      '#64748B', // neutral slate, used only for unpaid leave
    ].map((h) => h.toUpperCase()),
  )

  it('every leave type maps to a palette color', () => {
    for (const [code, hex] of Object.entries(LEAVE_TYPE_COLOR)) {
      expect(CHAI_PALETTE.has(hex.toUpperCase()), `${code} uses off-palette ${hex}`).toBe(true)
    }
  })

  it('every aging bucket maps to a palette color', () => {
    for (const [bucket, hex] of Object.entries(AGING_COLOR)) {
      expect(CHAI_PALETTE.has(hex.toUpperCase()), `${bucket} uses off-palette ${hex}`).toBe(true)
    }
  })

  it('falls back to Dark Blue for an unknown leave type', () => {
    expect(leaveTypeColor('ANNUAL')).toBe('#003E78')
    expect(leaveTypeColor('SOMETHING_NEW')).toBe('#003E78')
  })
})

describe('misc', () => {
  it('fmtPercent', () => {
    expect(fmtPercent(42)).toBe('42%')
    expect(fmtPercent(42.36, 1)).toBe('42.4%')
    expect(fmtPercent(null)).toBe('0%')
  })

  it('initials handles one, two and many names', () => {
    expect(initials('Sokha Meas')).toBe('SM')
    expect(initials('Sophea')).toBe('S')
    expect(initials('Norodom Sihamoni Kim Ly')).toBe('NS')
  })
})

describe('leave year', () => {
  it('is the calendar year when the leave year starts in January', () => {
    expect(leaveYearOf(new Date(2026, 0, 1))).toBe(2026)
    expect(leaveYearOf(new Date(2026, 11, 31))).toBe(2026)
  })

  it('rolls back for dates before a fiscal start month', () => {
    // April start: March 2026 still belongs to leave year 2025.
    expect(leaveYearOf(new Date(2026, 2, 31), 4)).toBe(2025)
    expect(leaveYearOf(new Date(2026, 3, 1), 4)).toBe(2026)
  })

  it('bounds a calendar leave year', () => {
    const { start, end } = leaveYearBounds(2026)
    expect(isoDate(start)).toBe('2026-01-01')
    expect(isoDate(end)).toBe('2026-12-31')
  })

  it('bounds an April fiscal leave year', () => {
    const { start, end } = leaveYearBounds(2026, 4)
    expect(isoDate(start)).toBe('2026-04-01')
    expect(isoDate(end)).toBe('2027-03-31')
  })
})
