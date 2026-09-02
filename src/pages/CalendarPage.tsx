import { useMemo, useState } from 'react'
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWeekend,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { CalendarRange, ChevronLeft, ChevronRight, Cake } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, NativeSelect, Skeleton } from '@/components/ui/primitives'
import { useBirthdays, useHolidays, useTeamAbsences } from '@/hooks/useLeaveData'
import { useAuth } from '@/providers/AuthProvider'
import { fmtDate, isoDate, leaveTypeColor } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { TeamAbsence } from '@/lib/database.types'

type View = 'month' | 'week'

export function CalendarPage() {
  const { isHr } = useAuth()
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [department, setDepartment] = useState('')

  const range = useMemo(() => {
    if (view === 'week') {
      const from = startOfWeek(cursor, { weekStartsOn: 1 })
      const to = endOfWeek(cursor, { weekStartsOn: 1 })
      return { from, to }
    }
    const from = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const to = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    return { from, to }
  }, [cursor, view])

  const { data: absences = [], isLoading } = useTeamAbsences(isoDate(range.from), isoDate(range.to))
  const { data: holidayRows = [] } = useHolidays()

  const holidays = useMemo(
    () => new Map(holidayRows.map((h) => [h.holiday_date, h])),
    [holidayRows],
  )

  const departments = useMemo(
    () => [...new Set(absences.map((a) => a.department).filter(Boolean))].sort() as string[],
    [absences],
  )

  const filtered = useMemo(
    () => (department ? absences.filter((a) => a.department === department) : absences),
    [absences, department],
  )

  const { data: birthdays = [] } = useBirthdays()

  /**
   * Keyed on month-day, not a full date: rpc_birthdays never returns the year,
   * and the same key then matches whichever year the calendar is showing.
   */
  const birthdaysByMonthDay = useMemo(() => {
    const map = new Map<string, typeof birthdays>()
    for (const b of birthdays) {
      const key = `${String(b.birth_month).padStart(2, '0')}-${String(b.birth_day).padStart(2, '0')}`
      const bucket = map.get(key)
      if (bucket) bucket.push(b)
      else map.set(key, [b])
    }
    return map
  }, [birthdays])

  const byDate = useMemo(() => {
    const map = new Map<string, TeamAbsence[]>()
    for (const a of filtered) {
      const list = map.get(a.absence_date) ?? []
      list.push(a)
      map.set(a.absence_date, list)
    }
    return map
  }, [filtered])

  const days = eachDayOfInterval({ start: range.from, end: range.to })

  const step = (dir: 1 | -1) =>
    setCursor(view === 'week' ? addWeeks(cursor, dir) : addMonths(cursor, dir))

  const legendCodes = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of filtered) seen.set(a.leave_type_name, a.leave_type_name)
    return [...seen.keys()].sort()
  }, [filtered])

  return (
    <>
      <PageHeader
        title="Calendar"
        description={
          isHr
            ? 'Everyone. Approved leave is solid, pending leave is outlined.'
            : 'Your team. Approved leave is solid, pending leave is outlined.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Filter by department"
              className="w-44"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
              {(['month', 'week'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium capitalize',
                    view === v ? 'bg-chai-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-[11rem] text-center text-sm font-semibold text-slate-800">
              {view === 'month'
                ? format(cursor, 'MMMM yyyy')
                : `${format(range.from, 'dd MMM')} – ${format(range.to, 'dd MMM yyyy')}`}
            </p>
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" className="ml-2" onClick={() => setCursor(new Date())}>
              Today
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-rose-100 ring-1 ring-rose-200" /> Public holiday
            </span>
            {birthdays.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Cake className="h-3 w-3 text-chaiDarkGold" aria-hidden /> Birthday
              </span>
            ) : null}
            {legendCodes.slice(0, 6).map((name) => {
              const code = filtered.find((a) => a.leave_type_name === name)
              return (
                <span key={name} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: leaveTypeColor(codeOf(code)) }}
                  />
                  {name}
                </span>
              )
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-7 gap-px bg-slate-200 p-px">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-none" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="py-1.5">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px bg-slate-200">
              {days.map((day) => {
                const iso = isoDate(day)
                const holiday = holidays.get(iso)
                const items = byDate.get(iso) ?? []
                const outside = view === 'month' && !isSameMonth(day, cursor)
                const today = isSameDay(day, new Date())

                return (
                  <div
                    key={iso}
                    className={cn(
                      'min-h-[6.5rem] bg-white p-1.5',
                      outside && 'bg-slate-50/70',
                      isWeekend(day) && 'bg-slate-50',
                      holiday && 'bg-rose-50',
                      view === 'week' && 'min-h-[16rem]',
                    )}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-1">
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          outside ? 'text-slate-300' : 'text-slate-500',
                          today &&
                            'grid h-5 w-5 place-items-center rounded-full bg-chai-600 font-semibold text-white',
                        )}
                      >
                        {format(day, 'd')}
                      </span>
                      {items.length > 2 && view === 'month' ? (
                        <span className="text-[10px] text-slate-400">{items.length}</span>
                      ) : null}
                    </div>

                    {holiday ? (
                      <p
                        className="mb-1 truncate rounded bg-rose-100 px-1 py-0.5 text-[10px] font-medium text-rose-800"
                        title={holiday.name_en}
                      >
                        {holiday.name_en}
                      </p>
                    ) : null}

                    {(birthdaysByMonthDay.get(format(day, 'MM-dd')) ?? []).map((b) => (
                      <p
                        key={b.employee_id}
                        className="mb-1 flex items-center gap-1 truncate rounded bg-chaiLightGold/40 px-1 py-0.5 text-[10px] font-medium text-chaiDarkGold"
                        title={`${b.full_name}'s birthday${b.department ? ` — ${b.department}` : ''}`}
                      >
                        <Cake className="h-2.5 w-2.5 shrink-0" aria-hidden />
                        <span className="truncate">{b.full_name}</span>
                      </p>
                    ))}

                    <ul className="space-y-0.5">
                      {items.slice(0, view === 'week' ? 20 : 3).map((a) => (
                        <li key={`${a.employee_id}-${a.leave_type_name}`}>
                          <span
                            className={cn(
                              'block truncate rounded px-1 py-0.5 text-[10px] font-medium',
                              a.status === 'approved' ? 'text-white' : 'bg-white',
                            )}
                            style={
                              a.status === 'approved'
                                ? { backgroundColor: leaveTypeColor(codeOf(a)) }
                                : {
                                    border: `1px dashed ${leaveTypeColor(codeOf(a))}`,
                                    color: leaveTypeColor(codeOf(a)),
                                  }
                            }
                            title={`${a.full_name} — ${a.leave_type_name} (${a.status.replace('_', ' ')}), ${fmtDate(a.start_date)} to ${fmtDate(a.end_date)}`}
                          >
                            {a.full_name}
                            {a.day_portion !== 'full_day' ? ' ½' : ''}
                          </span>
                        </li>
                      ))}
                      {view === 'month' && items.length > 3 ? (
                        <li className="px-1 text-[10px] text-slate-400">
                          +{items.length - 3} more
                        </li>
                      ) : null}
                    </ul>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!isLoading && filtered.length === 0 ? (
          <EmptyState icon={<CalendarRange className="h-7 w-7" />} title="Nobody is away">
            No approved or pending leave falls in this period for the people you can see.
          </EmptyState>
        ) : null}
      </Card>
    </>
  )
}

function codeOf(a: TeamAbsence | undefined): string {
  return a?.leave_type_code ?? ''
}
