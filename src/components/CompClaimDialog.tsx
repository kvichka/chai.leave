import { useMemo, useState } from 'react'
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  isWeekend,
  parseISO,
  subMonths,
} from 'date-fns'
import { CalendarPlus } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, NativeSelect, Textarea } from '@/components/ui/primitives'
import { DateRangePicker } from '@/components/DateRangePicker'
import { useSubmitCompClaim } from '@/hooks/useMutations'
import { useHolidays } from '@/hooks/useLeaveData'
import { isoDate } from '@/lib/format'

/**
 * Claim time back for working outside normal hours.
 *
 * The form asks for the days already worked, not days to take off. Those are
 * two different things and conflating them is the easiest way for someone to
 * end up with a balance they did not earn, so every label says "worked".
 *
 * A period rather than a single date, because the case this exists for - a
 * field visit - is rarely one day. The day count is suggested from the period
 * but stays editable: whether a Saturday and Sunday earn two days or one is a
 * policy question, not an arithmetic one.
 */
export function CompClaimDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const today = isoDate(new Date())
  // Open on last month: a claim looks backwards, and starting on this month
  // shows a second month that is entirely in the future and unselectable.
  const lastMonth = isoDate(subMonths(new Date(), 1))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [days, setDays] = useState('1')
  const [daysTouched, setDaysTouched] = useState(false)
  const [reason, setReason] = useState('')
  const submit = useSubmitCompClaim()
  const { data: holidays = [] } = useHolidays()

  const holidayMap = useMemo(
    () => new Map(holidays.map((h) => [h.holiday_date, { name: h.name_en, half: h.is_half_day }])),
    [holidays],
  )

  const effectiveTo = to || from
  const spanValid = from !== '' && effectiveTo >= from && effectiveTo <= today
  const spanDays = spanValid ? differenceInCalendarDays(parseISO(effectiveTo), parseISO(from)) + 1 : 0

  /** The days in the period that were not ordinary working days. */
  const offDays = spanValid
    ? eachDayOfInterval({ start: parseISO(from), end: parseISO(effectiveTo) }).filter(
        (d) => isWeekend(d) || holidays.some((h) => h.holiday_date === isoDate(d)),
      ).length
    : 0

  // Suggest the number of weekend and holiday days covered, because that is
  // what a claim usually amounts to. When the period is all ordinary working
  // days, suggest one rather than the whole span: the person worked days they
  // were already being paid for, and the extra hours are what they are
  // claiming. Defaulting high would quietly invite over-claiming.
  const suggested = String(offDays > 0 ? offDays : 1)
  const daysValue = daysTouched ? days : suggested

  const valid = spanValid && reason.trim().length >= 3 && Number(daysValue) > 0

  function setPeriod(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    setDaysTouched(false)
  }

  async function send() {
    await submit.mutateAsync({
      worked_from: from,
      worked_to: effectiveTo,
      days_earned: Number(daysValue),
      reason: reason.trim(),
    })
    setPeriod('', '')
    setDays('1')
    setReason('')
    onOpenChange(false)
  }

  const dayOptions = Array.from({ length: Math.max(spanDays, 1) * 4 }, (_, i) => (i + 1) / 2)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Claim compensation leave"
      description="For time worked outside normal working hours — a weekend, a public holiday, or days in the field. Your approver decides, and approved days are added to your Compensation Leave balance to use later."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={!valid} loading={submit.isPending}>
            <CalendarPlus className="h-4 w-4" /> Send to approver
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Days you worked"
            required
            hint="Click a day, then the last day, for a period. Weekends and holidays are selectable — they are the point."
          >
            {/* The same picker as the leave request form, so the two feel like
                one app. maxDate rather than minDate: a claim is for work
                already done, so nothing after today can be chosen. */}
            <DateRangePicker
              value={{ start: from || null, end: to || from || null }}
              onChange={(v) => setPeriod(v.start ?? '', v.end ?? '')}
              holidays={holidayMap}
              blockNonWorking={false}
              maxDate={today}
              initialMonth={lastMonth}
              firstDayPrompt="Click the first day you worked."
            />
          </Field>
        </div>

        <Field
          label="Days earned"
          required
          hint={
            !spanValid || daysTouched
              ? 'How much time off this earns.'
              : offDays > 0
                ? `Suggested: the ${offDays} weekend or holiday day${offDays === 1 ? '' : 's'} in your period. Change it if your policy differs.`
                : 'Suggested one day for the extra hours. Change it if it was more.'
          }
        >
          <NativeSelect
            value={daysValue}
            onChange={(e) => {
              setDays(e.target.value)
              setDaysTouched(true)
            }}
          >
            {dayOptions.map((d) => (
              <option key={d} value={String(d)}>
                {d === 0.5 ? 'Half a day' : `${d} day${d === 1 ? '' : 's'}`}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="What did you work on?"
            required
            hint="Your approver sees this, and it stays on the record."
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Field visit to Kampot health centre, Friday to Sunday"
            />
          </Field>
        </div>
      </div>

      {spanValid ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
          <span className="font-medium text-slate-800">
            {spanDays === 1
              ? format(parseISO(from), 'EEEE d MMMM')
              : `${format(parseISO(from), 'd MMM')} to ${format(parseISO(effectiveTo), 'd MMM')} — ${spanDays} days`}
            .
          </span>{' '}
          {offDays === 0 ? (
            <>
              All of these are ordinary working days. You can still claim, but say clearly why the
              hours went beyond normal — your approver has only your description to go on.
            </>
          ) : offDays === spanDays ? (
            <>
              {offDays === 1 ? 'That is a weekend or public holiday' : 'All of these are weekends or public holidays'}
              , which is exactly what this is for.
            </>
          ) : (
            <>
              {offDays} of them {offDays === 1 ? 'is a weekend or public holiday' : 'are weekends or public holidays'}
              , which is why {offDays} {offDays === 1 ? 'day is' : 'days are'} suggested above.
            </>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}
