import { useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWeekend,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { Card, CardHeader, Tooltip } from '@/components/ui/primitives'
import { useHolidays } from '@/hooks/useLeaveData'
import { isoDate, leaveTypeColor } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { LeaveRequest, PublicHoliday } from '@/lib/database.types'

/** How many months to show side by side. */
const MONTHS = 2

/**
 * Two month grids for the My leave page: public holidays, and the viewer's own
 * booked leave, on a calendar rather than in a list.
 *
 * A list of dates answers "when is the next holiday". It does not answer the
 * question people actually have when booking time off, which is whether the
 * days they are eyeing sit next to a holiday or a weekend. A grid answers that
 * at a glance.
 *
 * Two months rather than one because leave is usually booked a few weeks out,
 * and a single month hides the answer for anything near the end of it.
 *
 * Holiday names are listed underneath, because a grid can show that a day is
 * special but not what it is called.
 */
export function MonthAtAGlance({
  requests = [],
  className,
}: {
  requests?: LeaveRequest[]
  className?: string
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const today = new Date()

  // Not scoped to a leave year: the grids run past month ends, and December
  // shows days belonging to the next year.
  const { data: allHolidays = [] } = useHolidays()

  const holidayByDate = useMemo(
    () => new Map(allHolidays.map((h) => [h.holiday_date, h])),
    [allHolidays],
  )

  /** Own leave, by date, so a day can be shaded in its leave type's colour. */
  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest>()
    for (const r of requests) {
      if (r.status !== 'approved' && r.status !== 'pending_supervisor' && r.status !== 'pending_hr')
        continue
      for (const day of eachDayOfInterval({
        start: parseISO(r.start_date),
        end: parseISO(r.end_date),
      })) {
        map.set(isoDate(day), r)
      }
    }
    return map
  }, [requests])

  const months = useMemo(
    () => Array.from({ length: MONTHS }, (_, i) => addMonths(cursor, i)),
    [cursor],
  )

  /** Holidays falling in either month on screen, in date order. */
  const shownHolidays = useMemo(
    () =>
      allHolidays
        .filter((h) => months.some((m) => isSameMonth(parseISO(h.holiday_date), m)))
        .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)),
    [allHolidays, months],
  )

  const spanLabel =
    months.length > 1
      ? `${format(months[0]!, 'MMMM')} – ${format(months[months.length - 1]!, 'MMMM yyyy')}`
      : format(cursor, 'MMMM yyyy')

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <CardHeader
        title="The next two months"
        description={spanLabel}
        action={
          <div className="flex items-center gap-0.5">
            <Tooltip label="Lunar holiday dates move each year. These are estimates until HR confirms them against the official Royal Government of Cambodia sub-decree.">
              <button
                type="button"
                className="rounded p-0.5 text-slate-300 hover:text-slate-500"
                aria-label="About these dates"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => setCursor((c) => addMonths(c, -1))}
              aria-label="Show the previous month"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor(startOfMonth(new Date()))}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setCursor((c) => addMonths(c, 1))}
              aria-label="Show the next month"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <div className="grid gap-x-7 gap-y-5 px-4 pb-2 pt-3 sm:grid-cols-2">
        {months.map((month) => (
          <MonthGrid
            key={isoDate(month)}
            month={month}
            today={today}
            holidayByDate={holidayByDate}
            leaveByDate={leaveByDate}
          />
        ))}
      </div>

      {/* A grid shows that a day is special; only a name says which. */}
      <div className="mt-auto border-t border-slate-100 px-4 py-2.5">
        {shownHolidays.length === 0 ? (
          <p className="text-[11px] text-slate-400">No public holidays in these two months.</p>
        ) : (
          <ul className="grid gap-x-7 gap-y-1 sm:grid-cols-2">
            {shownHolidays.map((h) => {
              const date = parseISO(h.holiday_date)
              const onWeekend = isWeekend(date)
              return (
                <li key={h.holiday_date} className="flex items-baseline gap-2 text-[11px]">
                  <span className="w-11 shrink-0 font-semibold tabular-nums text-rose-800">
                    {format(date, 'd MMM')}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      onWeekend ? 'text-slate-400' : 'text-slate-600',
                    )}
                    title={h.name_en}
                  >
                    {h.name_en}
                    {h.is_half_day ? ' (half day)' : ''}
                  </span>
                  {onWeekend ? (
                    <span
                      className="shrink-0 text-slate-400"
                      title="Falls on a weekend, so it gives no extra day off and changes no working-day count"
                    >
                      weekend
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-100 ring-1 ring-rose-200" /> Public
          holiday
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-chai-600" /> Your leave
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-chaiGreen/20 ring-2 ring-chaiDarkGreen" />{' '}
          Today
        </span>
      </div>
    </Card>
  )
}

/** One month. Weeks start on Monday, as they do on the main calendar. */
function MonthGrid({
  month,
  today,
  holidayByDate,
  leaveByDate,
}: {
  month: Date
  today: Date
  holidayByDate: Map<string, PublicHoliday>
  leaveByDate: Map<string, LeaveRequest>
}) {
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  )

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-700">{format(month, 'MMMM yyyy')}</p>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span
            key={`${d}-${i}`}
            className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >
            {d}
          </span>
        ))}

        {days.map((day) => {
          const iso = isoDate(day)
          const holiday = holidayByDate.get(iso)
          const leave = leaveByDate.get(iso)
          const outside = !isSameMonth(day, month)
          const isToday = isSameDay(day, today)
          const weekend = isWeekend(day)

          return (
            <div key={iso} className="flex justify-center">
              <span
                title={
                  [
                    holiday ? holiday.name_en : null,
                    leave ? `Your leave — ${leave.status.replace(/_/g, ' ')}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-full text-[11px] tabular-nums',
                  outside && 'opacity-30',
                  !holiday && !leave && weekend && 'text-slate-400',
                  !holiday && !leave && !weekend && 'text-slate-700',
                  holiday && 'bg-rose-100 font-semibold text-rose-800',
                  // Green, not blue: blue is "your leave" and the ring was
                  // being read as leave-related. Not gold either - gold means
                  // "awaiting a decision" everywhere else in the app.
                  isToday && 'ring-2 ring-chaiDarkGreen ring-offset-1',
                  isToday && !holiday && !leave && 'bg-chaiGreen/20 font-semibold text-chaiDarkGreen',
                )}
                style={
                  leave && !holiday
                    ? {
                        backgroundColor: leaveTypeColor(leave.leave_type_code),
                        color: '#fff',
                        fontWeight: 600,
                      }
                    : undefined
                }
              >
                {format(day, 'd')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
