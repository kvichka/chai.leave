import { BulkImport, type ImportColumn } from '@/components/BulkImport'
import { useAdjustEntitlement, useSaveHolidays, useSaveLeaveType } from '@/hooks/useMutations'
import type { Employee, LeaveType, PublicHoliday } from '@/lib/database.types'

/** "", "y", "yes", "true", "1" -> boolean, falling back to the current value. */
const bool = (v: string | undefined, fallback: boolean) =>
  !v || v.trim() === '' ? fallback : /^(y|yes|true|1)$/i.test(v.trim())

const num = (v: string | undefined, fallback: number | null = null) =>
  !v || v.trim() === '' ? fallback : Number(v)

/* ------------------------------------------------------- leave types ----- */

const LEAVE_TYPE_COLUMNS: ImportColumn[] = [
  { key: 'code', required: true, example: 'ANNUAL', hint: 'must already exist' },
  { key: 'name_en', required: true, example: 'Annual Leave' },
  { key: 'unit', required: true, example: 'working_day', hint: 'working_day | calendar_day' },
  { key: 'default_days', required: true, example: '18' },
  { key: 'parent_code', example: '' },
  { key: 'name_kh', example: '' },
  { key: 'is_prorated', example: 'true', hint: 'true | false' },
  { key: 'max_carry_forward', example: '5' },
  { key: 'carry_forward_expiry_month', example: '3', hint: '1-12, blank for none' },
  { key: 'allows_half_day', example: 'true' },
  { key: 'requires_attachment', example: 'false' },
  { key: 'attachment_after_days', example: '' },
  { key: 'requires_hr_approval', example: 'true' },
  { key: 'min_notice_days', example: '3' },
  { key: 'max_consecutive_days', example: '' },
  { key: 'gender_restriction', example: '', hint: 'M | F | blank' },
  { key: 'is_paid', example: 'true' },
  { key: 'counts_against_balance', example: 'true' },
  { key: 'is_requestable', example: 'true' },
  { key: 'is_active', example: 'true' },
  { key: 'display_order', example: '10' },
]

export function LeaveTypeBulkImport({ types }: { types: LeaveType[] }) {
  const save = useSaveLeaveType()
  const byCode = new Map(types.map((t) => [t.code, t]))

  return (
    <BulkImport
      fileStem="leave_types"
      title="Edit leave types in bulk"
      description="Download the current types, change day counts or flags in a spreadsheet, upload it back. Existing codes are updated; an unknown code is rejected rather than silently creating a type."
      columns={LEAVE_TYPE_COLUMNS}
      resultNoun="leave type"
      currentRows={() =>
        types.map((t) => ({
          code: t.code,
          name_en: t.name_en,
          unit: t.unit,
          default_days: t.default_days,
          parent_code: t.parent_code ?? '',
          name_kh: t.name_kh ?? '',
          is_prorated: String(t.is_prorated),
          max_carry_forward: t.max_carry_forward,
          carry_forward_expiry_month: t.carry_forward_expiry_month ?? '',
          allows_half_day: String(t.allows_half_day),
          requires_attachment: String(t.requires_attachment),
          attachment_after_days: t.attachment_after_days ?? '',
          requires_hr_approval: String(t.requires_hr_approval),
          min_notice_days: t.min_notice_days,
          max_consecutive_days: t.max_consecutive_days ?? '',
          gender_restriction: t.gender_restriction ?? '',
          is_paid: String(t.is_paid),
          counts_against_balance: String(t.counts_against_balance),
          is_requestable: String(t.is_requestable),
          is_active: String(t.is_active),
          display_order: t.display_order,
        }))
      }
      onImportRow={async (row) => {
        const existing = byCode.get(row.code)
        if (!existing) {
          throw new Error(
            `"${row.code}" is not an existing leave type. Adding a new type in bulk is deliberately not supported, because a type carries entitlements and history — create it individually first.`,
          )
        }
        if (row.unit !== 'working_day' && row.unit !== 'calendar_day') {
          throw new Error(`unit must be working_day or calendar_day, not "${row.unit}".`)
        }
        if (Number.isNaN(Number(row.default_days))) {
          throw new Error(`default_days "${row.default_days}" is not a number.`)
        }

        await save.mutateAsync({
          code: row.code,
          name_en: row.name_en,
          name_kh: row.name_kh || null,
          unit: row.unit,
          default_days: Number(row.default_days),
          parent_code: row.parent_code || null,
          is_prorated: bool(row.is_prorated, existing.is_prorated),
          max_carry_forward: num(row.max_carry_forward, existing.max_carry_forward) as number,
          carry_forward_expiry_month: num(row.carry_forward_expiry_month),
          allows_half_day: bool(row.allows_half_day, existing.allows_half_day),
          requires_attachment: bool(row.requires_attachment, existing.requires_attachment),
          attachment_after_days: num(row.attachment_after_days),
          requires_hr_approval: bool(row.requires_hr_approval, existing.requires_hr_approval),
          min_notice_days: num(row.min_notice_days, existing.min_notice_days) as number,
          max_consecutive_days: num(row.max_consecutive_days),
          gender_restriction: (row.gender_restriction || null) as 'M' | 'F' | null,
          is_paid: bool(row.is_paid, existing.is_paid),
          counts_against_balance: bool(row.counts_against_balance, existing.counts_against_balance),
          is_requestable: bool(row.is_requestable, existing.is_requestable),
          is_active: bool(row.is_active, existing.is_active),
          display_order: num(row.display_order, existing.display_order) as number,
        })

        return {
          ok: true,
          message:
            row.unit !== existing.unit
              ? 'Updated — UNIT CHANGED. Days already approved were not recalculated.'
              : 'Updated',
        }
      }}
    />
  )
}

/* ---------------------------------------------------- public holidays ---- */

const HOLIDAY_COLUMNS: ImportColumn[] = [
  { key: 'holiday_date', required: true, example: '2027-01-01', hint: 'YYYY-MM-DD' },
  { key: 'name_en', required: true, example: 'International New Year Day' },
  { key: 'name_kh', example: '' },
  { key: 'is_half_day', example: 'false', hint: 'true | false' },
]

export function HolidayBulkImport({
  holidays,
  year,
}: {
  holidays: PublicHoliday[]
  year: number
}) {
  const save = useSaveHolidays()

  return (
    <BulkImport
      fileStem={`public_holidays_${year}`}
      title="Import the official holiday list"
      description="One row per day. Existing dates are updated, new ones added. Check it against the Royal Government of Cambodia sub-decree first — every day count that spans a holiday depends on this being right."
      columns={HOLIDAY_COLUMNS}
      resultNoun="holiday"
      currentRows={() =>
        holidays.map((h) => ({
          holiday_date: h.holiday_date,
          name_en: h.name_en,
          name_kh: h.name_kh ?? '',
          is_half_day: String(h.is_half_day),
        }))
      }
      onImportRow={async (row) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.holiday_date)) {
          throw new Error(`"${row.holiday_date}" is not a YYYY-MM-DD date.`)
        }
        await save.mutateAsync([
          {
            holiday_date: row.holiday_date,
            name_en: row.name_en,
            name_kh: row.name_kh || null,
            is_half_day: bool(row.is_half_day, false),
          },
        ])
        return { ok: true, message: 'Saved' }
      }}
    />
  )
}

/* ------------------------------------------------------ entitlements ----- */

const ENTITLEMENT_COLUMNS: ImportColumn[] = [
  { key: 'staff_code', required: true, example: 'CHAI-KH-005' },
  { key: 'leave_type_code', required: true, example: 'ANNUAL' },
  { key: 'adjustment_days', required: true, example: '2', hint: 'negative reduces' },
  { key: 'adjustment_reason', required: true, example: 'Carried over from a previous employer' },
]

export interface EntitlementRow {
  id: string
  leave_type_code: string
  adjustment_days: number
  adjustment_reason: string | null
  employee?: Employee
}

export function EntitlementBulkImport({
  year,
  rows,
}: {
  year: number
  rows: EntitlementRow[]
}) {
  const adjust = useAdjustEntitlement()

  return (
    <BulkImport
      fileStem={`entitlement_adjustments_${year}`}
      title={`Adjust entitlements in bulk for ${year}`}
      description="For corrections and one-off grants. A reason is mandatory on every row — the database refuses an adjustment without one, which is what replaces the source spreadsheet's unexplained manual adder."
      columns={ENTITLEMENT_COLUMNS}
      resultNoun="adjustment"
      currentRows={() =>
        rows
          .filter((r) => Number(r.adjustment_days) !== 0)
          .map((r) => ({
            staff_code: r.employee?.staff_code ?? '',
            leave_type_code: r.leave_type_code,
            adjustment_days: r.adjustment_days,
            adjustment_reason: r.adjustment_reason ?? '',
          }))
      }
      onImportRow={async (row) => {
        const target = rows.find(
          (r) =>
            r.employee?.staff_code === row.staff_code && r.leave_type_code === row.leave_type_code,
        )
        if (!target) {
          throw new Error(
            `No ${row.leave_type_code} entitlement for ${row.staff_code} in ${year}. Run "Generate entitlements" first.`,
          )
        }
        const days = Number(row.adjustment_days)
        if (Number.isNaN(days)) throw new Error(`"${row.adjustment_days}" is not a number.`)
        if (days !== 0 && !row.adjustment_reason.trim()) {
          throw new Error('A reason is required for any non-zero adjustment.')
        }

        await adjust.mutateAsync({
          id: target.id,
          adjustment_days: days,
          adjustment_reason: row.adjustment_reason.trim(),
        })
        return { ok: true, message: `Adjusted by ${days > 0 ? '+' : ''}${days}` }
      }}
    />
  )
}
