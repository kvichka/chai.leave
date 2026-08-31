import { useState } from 'react'
import { differenceInCalendarDays, format, getDay, parseISO } from 'date-fns'
import { CalendarOff, ChevronDown, Info } from 'lucide-react'
import { Card, CardHeader, EmptyState, Tooltip } from '@/components/ui/primitives'
import { useUpcomingHolidays } from '@/hooks/useLeaveData'
import { cn } from '@/lib/cn'

const COLLAPSED = 3

/**
 * Deliberately compact: this is reference information sitting beside the thing
 * you came to the page for, so it should not out-measure it.
 *
 * Three by default, the rest behind a toggle. The two facts kept on every row
 * are the weekday and how soon — a holiday on a Saturday gives nobody a day off
 * and is excluded from working-day counts, and one on a Monday or Friday is
 * when someone might bolt annual leave onto a long weekend.
 */
export function UpcomingHolidays({ limit = 8 }: { limit?: number }) {
  const { data: holidays = [], isLoading } = useUpcomingHolidays(limit)
  const [expanded, setExpanded] = useState(false)

  const shown = expanded ? holidays : holidays.slice(0, COLLAPSED)
  const hidden = holidays.length - shown.length

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Upcoming public holidays"
        action={
          <Tooltip label="Lunar dates move each year. These are estimates until HR confirms them against the official Royal Government of Cambodia sub-decree.">
            <button
              type="button"
              className="rounded p-0.5 text-slate-300 hover:text-slate-500"
              aria-label="About these dates"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        }
      />

      {isLoading ? (
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: COLLAPSED }).map((_, i) => (
            <li key={i} className="flex items-center gap-2.5 px-3 py-2">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-slate-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
            </li>
          ))}
        </ul>
      ) : holidays.length === 0 ? (
        <EmptyState icon={<CalendarOff className="h-6 w-6" />} title="No holidays loaded">
          Ask HR to import the official list — every leave calculation that spans a holiday
          depends on it.
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {shown.map((h, i) => {
              const date = parseISO(h.holiday_date)
              const daysAway = differenceInCalendarDays(date, new Date())
              const dow = getDay(date)
              const onWeekend = dow === 0 || dow === 6
              const longWeekend = dow === 1 || dow === 5
              const isNext = i === 0 && !onWeekend

              return (
                <li
                  key={h.holiday_date}
                  className={cn('flex items-center gap-2.5 px-3 py-2', isNext && 'bg-chai-50/70')}
                >
                  <div
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-md leading-none',
                      onWeekend
                        ? 'bg-slate-100 text-slate-400'
                        : isNext
                          ? 'bg-chai-600 text-white'
                          : 'bg-chai-100 text-chai-800',
                    )}
                    aria-hidden
                  >
                    <div className="text-center">
                      <p className="text-xs font-bold tabular-nums">{format(date, 'd')}</p>
                      <p className="text-[8px] font-semibold uppercase opacity-80">
                        {format(date, 'MMM')}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-xs font-medium',
                        onWeekend ? 'text-slate-400' : 'text-slate-900',
                      )}
                      title={h.name_kh ? `${h.name_en} · ${h.name_kh}` : h.name_en}
                    >
                      {h.name_en}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {format(date, 'EEE')} · {relativeLabel(daysAway)}
                      {h.is_half_day ? ' · half day' : ''}
                      {onWeekend ? (
                        <span className="text-slate-400"> · weekend</span>
                      ) : longWeekend ? (
                        <span className="font-medium text-chaiDarkGreen"> · long weekend</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>

          {holidays.length > COLLAPSED ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2 text-[11px] font-medium text-chai-700 hover:bg-chai-50"
            >
              {expanded ? 'Show fewer' : `Show ${hidden} more`}
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')}
              />
            </button>
          ) : null}
        </>
      )}
    </Card>
  )
}

function relativeLabel(days: number): string {
  if (days < 0) return 'past'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 7) return `in ${days} days`
  if (days < 14) return 'next week'
  if (days < 31) return `in ${Math.round(days / 7)} weeks`
  const months = Math.round(days / 30)
  return months <= 1 ? 'in a month' : `in ${months} months`
}
