import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bell, CheckCheck, ChevronRight } from 'lucide-react'
import { useNotifications } from '@/hooks/useLeaveData'
import { useMarkNotificationsRead } from '@/hooks/useMutations'
import { useAuth } from '@/providers/AuthProvider'
import { supabase } from '@/lib/supabase'
import { fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { AppNotification, LeaveStatus } from '@/lib/database.types'

interface RequestStub {
  id: string
  employee_id: string
  request_ref: string
  status: LeaveStatus
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data: items = [], isLoading } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const { employee } = useAuth()
  const navigate = useNavigate()

  const requestIds = useMemo(
    () => [...new Set(items.map((n) => n.request_id).filter((id): id is string => !!id))],
    [items],
  )

  /**
   * One lookup for every request the bell mentions, so a click can tell
   * "something of mine was decided" from "something needs my decision".
   * RLS already limits this to requests the recipient may see.
   */
  const { data: requests = [] } = useQuery({
    queryKey: ['notification_targets', requestIds],
    enabled: requestIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<RequestStub[]> => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('id,employee_id,request_ref,status')
        .in('id', requestIds)
      if (error) throw error
      return data
    },
  })

  const byId = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests])

  function targetFor(n: AppNotification): string | null {
    if (!n.request_id) return null
    const r = byId.get(n.request_id)
    // Unknown request (deleted, or not yet loaded): send them somewhere sane
    // rather than nowhere.
    if (!r) return '/my-leave'
    return r.employee_id === employee?.id
      ? `/my-leave?request=${n.request_id}`
      : `/approvals?request=${n.request_id}`
  }

  function activate(n: AppNotification) {
    if (!n.is_read) markRead.mutate([n.id])
    const to = targetFor(n)
    if (to) {
      setOpen(false)
      navigate(to)
    }
  }

  const unread = items.filter((n) => !n.is_read)

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-chai-500"
          aria-label={unread.length ? `${unread.length} unread notifications` : 'Notifications'}
        >
          <Bell className="h-5 w-5" />
          {unread.length > 0 ? (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread.length > 0 ? (
              <button
                type="button"
                onClick={() => markRead.mutate(unread.map((n) => n.id))}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-chai-700 hover:bg-chai-50"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {isLoading ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500">
                Nothing yet. Requests you submit or need to decide on will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => {
                  const ref = n.request_id ? byId.get(n.request_id)?.request_ref : null
                  return (
                    <li key={n.id} className={cn(!n.is_read && 'bg-chai-50/60')}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
                        onClick={() => activate(n)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">
                            {n.title}
                          </span>
                          {n.body ? (
                            <span className="mt-0.5 block text-xs text-slate-600">{n.body}</span>
                          ) : null}
                          <span className="mt-1 block text-[11px] text-slate-400">
                            {fmtDateTime(n.created_at)}
                            {ref ? ` · ${ref}` : ''}
                          </span>
                        </span>
                        {n.request_id ? (
                          <ChevronRight
                            className="mt-0.5 h-4 w-4 shrink-0 text-slate-300"
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
