import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Info, Paperclip, Users } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, NativeSelect, Textarea, Badge } from '@/components/ui/primitives'
import { DateRangePicker } from '@/components/DateRangePicker'
import {
  useHolidays,
  useLeaveTypes,
  useMyBalances,
  usePreviewDays,
  useTeamAbsences,
} from '@/hooks/useLeaveData'
import { useSaveDraft, useSubmitRequest, useUploadAttachment } from '@/hooks/useMutations'
import { useAuth } from '@/providers/AuthProvider'
import { fmtDate, fmtDays } from '@/lib/format'
import type { LeaveRequest, LeaveType } from '@/lib/database.types'
import { cn } from '@/lib/cn'

const schema = z.object({
  leave_type_code: z.string().min(1, 'Choose a leave type.'),
  start_date: z.string().min(1, 'Choose the dates for this leave.'),
  end_date: z.string().min(1, 'Choose the dates for this leave.'),
  start_portion: z.enum(['full_day', 'morning', 'afternoon']),
  end_portion: z.enum(['full_day', 'morning', 'afternoon']),
  reason: z.string().max(2000).optional(),
  handover_notes: z.string().max(2000).optional(),
  contact_while_away: z.string().max(200).optional(),
})

type FormValues = z.infer<typeof schema>

export function RequestFormDialog({
  open,
  onOpenChange,
  editing,
  presetType,
  leaveYear,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing?: LeaveRequest | null
  /** Pre-selects a leave type, e.g. when opened from a balance card. */
  presetType?: string | null
  leaveYear: number
}) {
  const { employee } = useAuth()
  const { data: types = [] } = useLeaveTypes()
  const { data: balances = [] } = useMyBalances(leaveYear)
  const { data: holidayRows = [] } = useHolidays()
  const [file, setFile] = useState<File | null>(null)

  const saveDraft = useSaveDraft(employee?.id)
  const submitRequest = useSubmitRequest()
  const upload = useUploadAttachment(employee?.id)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      leave_type_code: '',
      start_date: '',
      end_date: '',
      start_portion: 'full_day',
      end_portion: 'full_day',
      reason: '',
      handover_notes: '',
      contact_while_away: '',
    },
  })

  useEffect(() => {
    if (!open) return
    reset(
      editing
        ? {
            leave_type_code: editing.leave_type_code,
            start_date: editing.start_date,
            end_date: editing.end_date,
            start_portion: editing.start_portion,
            end_portion: editing.end_portion,
            reason: editing.reason ?? '',
            handover_notes: editing.handover_notes ?? '',
            contact_while_away: editing.contact_while_away ?? '',
          }
        : {
            leave_type_code: presetType ?? '',
            start_date: '',
            end_date: '',
            start_portion: 'full_day',
            end_portion: 'full_day',
            reason: '',
            handover_notes: '',
            contact_while_away: '',
          },
    )
    setFile(null)
  }, [open, editing, presetType, reset])

  const values = watch()
  const selectedType = types.find((t) => t.code === values.leave_type_code) ?? null

  const holidayMap = useMemo(
    () =>
      new Map(
        holidayRows.map((h) => [h.holiday_date, { name: h.name_en, half: h.is_half_day }]),
      ),
    [holidayRows],
  )

  const balanceByType = useMemo(
    () => new Map(balances.map((b) => [b.leave_type_code, b])),
    [balances],
  )

  const { data: computedDays, isFetching: computing } = usePreviewDays({
    leaveType: values.leave_type_code || null,
    start: values.start_date || null,
    end: values.end_date || null,
    startPortion: values.start_portion,
    endPortion: values.end_portion,
  })

  const { data: teamAbsences = [] } = useTeamAbsences(
    values.start_date || '1900-01-01',
    values.end_date || '1900-01-01',
    !!values.start_date && !!values.end_date,
  )

  const clashes = useMemo(() => {
    const map = new Map<string, { name: string; type: string; from: string; to: string }>()
    for (const a of teamAbsences) {
      if (a.is_self) continue
      if (a.status !== 'approved') continue
      if (!map.has(a.employee_id)) {
        map.set(a.employee_id, {
          name: a.full_name,
          type: a.leave_type_name,
          from: a.start_date,
          to: a.end_date,
        })
      }
    }
    return [...map.values()]
  }, [teamAbsences])

  const available = selectedType ? (balanceByType.get(selectedType.code)?.available_days ?? 0) : 0
  const days = Number(computedDays ?? 0)

  const needsAttachment =
    !!selectedType?.requires_attachment && days > Number(selectedType.attachment_after_days ?? 0)

  const overBalance =
    !!selectedType?.counts_against_balance && days > 0 && days > available

  const noticeFrom = selectedType
    ? addDaysIso(new Date(), selectedType.code === 'SICK' ? -3650 : selectedType.min_notice_days)
    : undefined

  const grouped = useMemo(() => groupTypes(types), [types])

  async function persistDraft(v: FormValues): Promise<LeaveRequest> {
    return saveDraft.mutateAsync({
      id: editing?.id,
      leave_type_code: v.leave_type_code,
      start_date: v.start_date,
      end_date: v.end_date,
      start_portion: selectedType?.allows_half_day ? v.start_portion : 'full_day',
      end_portion: selectedType?.allows_half_day ? v.end_portion : 'full_day',
      reason: v.reason || null,
      handover_notes: v.handover_notes || null,
      contact_while_away: v.contact_while_away || null,
      attachment_path: editing?.attachment_path ?? null,
    })
  }

  /**
   * Each mutation already reports its own failure through a toast carrying the
   * server's sentence. Swallowing the rejection here stops it also surfacing as
   * an unhandled promise rejection in the console — and, importantly, leaves the
   * dialog open with the user's input intact so they can correct it.
   */
  async function onSaveDraft(v: FormValues) {
    try {
      const saved = await persistDraft(v)
      if (file) await attach(saved, v)
      onOpenChange(false)
    } catch {
      /* reported by the mutation's own error handler */
    }
  }

  async function attach(saved: LeaveRequest, v: FormValues) {
    const path = await upload.mutateAsync({ file: file!, requestId: saved.id })
    await saveDraft.mutateAsync({
      id: saved.id,
      leave_type_code: v.leave_type_code,
      start_date: v.start_date,
      end_date: v.end_date,
      start_portion: v.start_portion,
      end_portion: v.end_portion,
      reason: v.reason || null,
      handover_notes: v.handover_notes || null,
      contact_while_away: v.contact_while_away || null,
      attachment_path: path,
    })
  }

  async function onSubmitForApproval(v: FormValues) {
    try {
      const saved = await persistDraft(v)
      if (file) await attach(saved, v)
      await submitRequest.mutateAsync(saved.id)
      onOpenChange(false)
    } catch {
      // Same as above. A refusal — overlapping dates, insufficient balance —
      // is an expected outcome here, not an exception the user should see
      // twice.
    }
  }

  const busy = saveDraft.isPending || submitRequest.isPending || upload.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Edit ${editing.request_ref}` : 'Request leave'}
      description="Day counts and balances are calculated by the server, so what you see here is what will be recorded."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={saveDraft.isPending && !submitRequest.isPending}
            onClick={handleSubmit(onSaveDraft)}
          >
            Save as draft
          </Button>
          <Button loading={submitRequest.isPending} onClick={handleSubmit(onSubmitForApproval)}>
            Submit for approval
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmitForApproval)}>
        <Field
          label="Leave type"
          htmlFor="leave_type_code"
          required
          error={errors.leave_type_code?.message}
        >
          <NativeSelect id="leave_type_code" {...register('leave_type_code')}>
            <option value="">Choose…</option>
            {grouped.map((group) => {
              const options = [group.parent, ...group.children].filter(
                (t): t is LeaveType => !!t && t.is_requestable && t.is_active,
              )
              if (options.length === 0) return null
              if (options.length === 1 && group.children.length === 0) {
                const t = options[0]!
                return (
                  <option key={t.code} value={t.code} disabled={isDisabled(t)}>
                    {optionLabel(t)}
                  </option>
                )
              }
              return (
                <optgroup key={group.code} label={group.label}>
                  {options.map((t) => (
                    <option key={t.code} value={t.code} disabled={isDisabled(t)}>
                      {optionLabel(t)}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </NativeSelect>
        </Field>

        {selectedType ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
            <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              {selectedType.unit === 'calendar_day'
                ? 'Counted in calendar days — weekends and public holidays are included.'
                : 'Counted in working days — weekends and public holidays are excluded.'}
            </span>
            {selectedType.min_notice_days > 0 && selectedType.code !== 'SICK' ? (
              <Badge tone="amber">{selectedType.min_notice_days} days notice required</Badge>
            ) : null}
            {selectedType.code === 'SICK' ? (
              <Badge tone="chai">Past dates are allowed</Badge>
            ) : null}
            {!selectedType.is_paid ? <Badge tone="red">Unpaid</Badge> : null}
          </div>
        ) : null}

        <Field
          label="Dates"
          required
          error={errors.start_date?.message ?? errors.end_date?.message}
          hint={
            selectedType?.unit === 'working_day'
              ? 'Weekends and public holidays are shaded and cannot be chosen as a start or end date.'
              : undefined
          }
        >
          <DateRangePicker
            value={{ start: values.start_date || null, end: values.end_date || null }}
            onChange={(v) => {
              setValue('start_date', v.start ?? '', { shouldValidate: true })
              setValue('end_date', v.end ?? '', { shouldValidate: true })
            }}
            holidays={holidayMap}
            blockNonWorking={selectedType?.unit !== 'calendar_day'}
            minDate={noticeFrom}
          />
        </Field>

        {selectedType?.allows_half_day ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First day" htmlFor="start_portion">
              <NativeSelect id="start_portion" {...register('start_portion')}>
                <option value="full_day">Full day</option>
                <option value="morning">Morning only</option>
                <option value="afternoon">Afternoon only</option>
              </NativeSelect>
            </Field>
            <Field label="Last day" htmlFor="end_portion">
              <NativeSelect
                id="end_portion"
                disabled={!values.end_date || values.end_date === values.start_date}
                {...register('end_portion')}
              >
                <option value="full_day">Full day</option>
                <option value="morning">Morning only</option>
                <option value="afternoon">Afternoon only</option>
              </NativeSelect>
            </Field>
          </div>
        ) : null}

        {/* Live day count, computed by the database so the client cannot
            disagree with what gets stored. */}
        {!values.start_date || !values.end_date ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
            Pick your dates and the day count will appear here — weekends and public holidays are
            handled for you.
          </p>
        ) : (
          <div
            className={cn(
              'overflow-hidden rounded-lg border',
              overBalance
                ? 'border-chaiDarkRed/30 bg-chaiDarkRed/5'
                : 'border-chai-200 bg-chai-50',
            )}
          >
            <div className="flex flex-wrap items-end justify-between gap-3 p-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  This request
                </p>
                <p className="mt-0.5 text-3xl font-bold leading-none tabular-nums text-slate-900">
                  {computing ? '·' : fmtDays(days)}
                  <span className="ml-1.5 text-sm font-normal text-slate-500">
                    {selectedType?.unit === 'calendar_day' ? 'calendar days' : 'working days'}
                  </span>
                </p>
              </div>

              {selectedType?.counts_against_balance ? (
                <div className="text-right">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {overBalance ? 'You only have' : 'Left afterwards'}
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 text-3xl font-bold leading-none tabular-nums',
                      overBalance ? 'text-chaiDarkRed' : 'text-slate-900',
                    )}
                  >
                    {fmtDays(overBalance ? available : available - days)}
                    <span className="ml-1.5 text-sm font-normal text-slate-500">
                      of {fmtDays(available)}
                    </span>
                  </p>
                </div>
              ) : null}
            </div>

            {/* How much of the remaining balance this request consumes. */}
            {selectedType?.counts_against_balance && available > 0 && !overBalance ? (
              <div className="h-1.5 w-full bg-white/70">
                <div
                  className="h-full bg-chai-600 transition-all"
                  style={{ width: `${Math.min((days / available) * 100, 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        )}

        {days === 0 && values.start_date && values.end_date && !computing ? (
          <Callout tone="red">
            Those dates contain no working days. Pick a range that includes at least one.
          </Callout>
        ) : null}

        {overBalance ? (
          <Callout tone="red">
            This is {fmtDays(days - available)} day(s) more than you have available. The server will
            refuse it — reduce the range or speak to HR.
          </Callout>
        ) : null}

        {clashes.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <Users className="h-4 w-4" />
              {clashes.length} teammate{clashes.length === 1 ? ' is' : 's are'} already off then
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-amber-900/90">
              {clashes.slice(0, 6).map((c) => (
                <li key={c.name}>
                  <span className="font-medium">{c.name}</span> — {c.type}, {fmtDate(c.from)} to{' '}
                  {fmtDate(c.to)}
                </li>
              ))}
              {clashes.length > 6 ? <li>…and {clashes.length - 6} more.</li> : null}
            </ul>
            <p className="mt-1.5 text-xs text-amber-800">
              This is a warning, not a block. Check cover with your supervisor.
            </p>
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional details
          </p>
          <div className="space-y-3">
        <Field label="Reason" htmlFor="reason">
          <Textarea id="reason" rows={2} {...register('reason')} placeholder="Short explanation" />
        </Field>

        <Field
          label="Handover notes"
          htmlFor="handover_notes"
          hint="Who is covering what while you are away."
        >
          <Textarea
            id="handover_notes"
            rows={2}
            {...register('handover_notes')}
            placeholder="e.g. Bopha will submit the weekly district data."
          />
        </Field>

        <Field label="Contact while away" htmlFor="contact_while_away">
          <Input
            id="contact_while_away"
            {...register('contact_while_away')}
            placeholder="Phone number, if you can be reached"
          />
        </Field>
          </div>
        </div>

        {selectedType?.requires_attachment ? (
          <Field
            label="Supporting document"
            htmlFor="attachment"
            required={needsAttachment}
            hint={
              needsAttachment
                ? `${selectedType.name_en} over ${fmtDays(selectedType.attachment_after_days)} day(s) requires a document. PDF, JPG or PNG, up to 10 MB.`
                : 'Not required for a request of this length, but you can attach one.'
            }
          >
            <div className="flex items-center gap-2">
              <Input
                id="attachment"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs"
              />
              {editing?.attachment_path && !file ? (
                <Badge tone="emerald">
                  <Paperclip className="mr-1 h-3 w-3" /> Attached
                </Badge>
              ) : null}
            </div>
          </Field>
        ) : null}

        {needsAttachment && !file && !editing?.attachment_path ? (
          <Callout tone="amber">
            A supporting document is required before this can be submitted.
          </Callout>
        ) : null}
      </form>
    </Dialog>
  )

  function isDisabled(t: LeaveType): boolean {
    if (!t.counts_against_balance) return false
    const b = balanceByType.get(t.code)
    if (!b) return true
    return Number(b.available_days) <= 0
  }

  function optionLabel(t: LeaveType): string {
    const b = balanceByType.get(t.code)
    if (!t.counts_against_balance) return t.name_en
    if (!b) return `${t.name_en} — no entitlement`
    const unit = t.unit === 'calendar_day' ? 'calendar days' : 'days'
    return `${t.name_en} — ${fmtDays(b.available_days)} of ${fmtDays(b.entitled_days)} ${unit} left`
  }
}

function Callout({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  }
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', tones[tone])}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function groupTypes(types: LeaveType[]) {
  const parents = types.filter((t) => !t.parent_code)
  return parents.map((p) => ({
    code: p.code,
    label: p.name_en,
    parent: p.is_requestable ? p : null,
    children: types.filter((t) => t.parent_code === p.code),
  }))
}

function addDaysIso(from: Date, days: number): string {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
