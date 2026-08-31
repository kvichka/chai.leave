import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isWeekend,
  parseISO,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDateRange, isoDate } from '@/lib/format'

export interface DateRangeValue {
  start: string | null
  end: string | null
}

/**
 * Two-click range selection: first click sets the day, second click extends to
 * a range. One click and close is a single-day request, which is the common
 * case and should not require a second interaction.
 *
 * Weekends and public holidays are shaded everywhere, and blocked as a start or
 * end date for working-day leave types. They stay selectable for calendar-day
 * types (maternity, unpaid), because that leave genuinely runs through them.
 */
export function DateRangePicker({
  value,
  onChange,
  holidays,
  blockNonWorking,
  minDate,
  id,
}: {
  value: DateRangeValue
  onChange: (v: DateRangeValue) => void
  holidays: Map<string, { name: string; half: boolean }>
  blockNonWorking: boolean
  minDate?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState<Date>(() =>
    value.start ? startOfMonth(parseISO(value.start)) : startOfMonth(new Date()),
  )
  /** True between the first and second click of a range. */
  const [extending, setExtending] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)

  const label = value.start
    ? value.end && value.end !== value.start
      ? fmtDateRange(value.start, value.end)
      : `${format(parseISO(value.start), 'dd MMM yyyy')} — one day`
    : 'Select dates'

  function pick(day: Date) {
    const iso = isoDate(day)

    if (!extending || !value.start) {
      // First click. Treat it as a valid single-day selection straight away, so
      // closing now gives one day rather than nothing.
      onChange({ start: iso, end: iso })
      setExtending(true)
      setHovered(null)
      return
    }

    // Second click completes the range, in whichever order it was clicked.
    const first = value.start
    if (iso < first) onChange({ start: iso, end: first })
    else onChange({ start: first, end: iso })
    setExtending(false)
    setHovered(null)
    setOpen(false)
  }

  /** While extending, preview the range the pointer is currently over. */
  const preview = useMemo(() => {
    if (!extending || !value.start || !hovered) return null
    return hovered < value.start
      ? { start: hovered, end: value.start }
      : { start: value.start, end: hovered }
  }, [extending, value.start, hovered])

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setExtending(false)
          setHovered(null)
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          className="field flex items-center justify-between gap-2 text-left"
          aria-label="Select the leave dates"
        >
          <span className={cn(!value.start && 'text-slate-400')}>{label}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, -1))}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold text-slate-800">
              {format(cursor, 'MMMM yyyy')}
              <span className="hidden sm:inline"> — {format(addMonths(cursor, 1), 'MMMM yyyy')}</span>
            </p>
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, 1))}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Say which click we are on, rather than leaving people to guess. */}
          <p
            className={cn(
              'mb-2 rounded-md px-2 py-1.5 text-xs',
              extending ? 'bg-chai-100 font-medium text-chai-800' : 'bg-slate-50 text-slate-600',
            )}
          >
            {extending
              ? 'Now click the last day. For a single day, press Done.'
              : 'Click the first day of your leave.'}
          </p>

          <div className="flex gap-4" onMouseLeave={() => setHovered(null)}>
            <MonthGrid
              month={cursor}
              value={value}
              preview={preview}
              holidays={holidays}
              blockNonWorking={blockNonWorking}
              minDate={minDate}
              onPick={pick}
              onHover={setHovered}
            />
            <div className="hidden sm:block">
              <MonthGrid
                month={addMonths(cursor, 1)}
                value={value}
                preview={preview}
                holidays={holidays}
                blockNonWorking={blockNonWorking}
                minDate={minDate}
                onPick={pick}
                onHover={setHovered}
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-200" /> Weekend
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-chaiDarkRed/10 ring-1 ring-chaiDarkRed/30" />{' '}
                Public holiday
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-chai-600" /> Selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              {value.start ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  onClick={() => {
                    onChange({ start: null, end: null })
                    setExtending(false)
                  }}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-md bg-chai-600 px-3 py-1 text-xs font-medium text-white hover:bg-chai-700 disabled:bg-chai-300"
                disabled={!value.start}
                onClick={() => {
                  setExtending(false)
                  setOpen(false)
                }}
              >
                Done
              </button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MonthGrid({
  month,
  value,
  preview,
  holidays,
  blockNonWorking,
  minDate,
  onPick,
  onHover,
}: {
  month: Date
  value: DateRangeValue
  preview: { start: string; end: string } | null
  holidays: Map<string, { name: string; half: boolean }>
  blockNonWorking: boolean
  minDate?: string
  onPick: (d: Date) => void
  onHover: (iso: string | null) => void
}) {
  const days = useMemo(() => {
    const from = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    const to = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
    return eachDayOfInterval({ start: from, end: to })
  }, [month])

  const start = value.start ? parseISO(value.start) : null
  const end = value.end ? parseISO(value.end) : null
  const min = minDate ? parseISO(minDate) : null

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 pb-1 text-center text-[10px] font-semibold uppercase text-slate-400">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const iso = isoDate(day)
          const outside = day.getMonth() !== month.getMonth()
          const holiday = holidays.get(iso)
          const weekend = isWeekend(day)
          const nonWorking = weekend || (!!holiday && !holiday.half)
          const tooEarly = min ? isBefore(day, min) : false
          const disabled = outside || tooEarly || (blockNonWorking && nonWorking)

          const inRange = start && end && !isBefore(day, start) && !isAfter(day, end)
          const inPreview = preview && iso >= preview.start && iso <= preview.end
          const isEdge = (start && isSameDay(day, start)) || (end && isSameDay(day, end))

          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onPick(day)}
              onMouseEnter={() => !disabled && onHover(iso)}
              title={holiday ? `${holiday.name}${holiday.half ? ' (half day)' : ''}` : undefined}
              aria-label={format(day, 'd MMMM yyyy')}
              className={cn(
                'h-8 w-8 rounded-md text-xs tabular-nums transition-colors',
                outside && 'invisible',
                !disabled && 'hover:bg-chai-100',
                weekend && !isEdge && 'bg-slate-100 text-slate-400',
                holiday && !isEdge && 'bg-chaiDarkRed/10 text-chaiDarkRed',
                disabled && !outside && 'cursor-not-allowed line-through opacity-60',
                (inRange || inPreview) && !isEdge && 'bg-chai-100 text-chai-800',
                isEdge && 'bg-chai-600 font-semibold text-white hover:bg-chai-700',
              )}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
