import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Menu,
  Settings2,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/providers/AuthProvider'
import { NotificationBell } from './NotificationBell'
import { UserMenu } from './UserMenu'

export function AppShell({ children }: { children: ReactNode }) {
  const { isHr, isSupervisor } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const nav = [
    { to: '/my-leave', label: 'My leave', icon: LayoutDashboard, show: true },
    { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, show: isSupervisor },
    { to: '/team', label: 'My team', icon: Users, show: isSupervisor },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays, show: true },
    { to: '/hr', label: 'HR dashboard', icon: LayoutDashboard, show: isHr },
    { to: '/admin', label: 'Admin', icon: Settings2, show: isHr },
  ].filter((n) => n.show)

  const NavItems = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="space-y-0.5" aria-label="Main">
      {nav.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-chai-50 text-chai-800'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Skip link, for keyboard users */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      {/* Top bar. Dark Blue #003E78 is CHAI's primary; the guide puts it first
          whenever a non-black is used, and it makes the chrome unmistakably
          CHAI rather than generic admin-panel white. */}
      <header className="sticky top-0 z-30 bg-chai-600 shadow-sm">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3 sm:px-5">
          <button
            type="button"
            className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-sm font-bold text-chai-600">
              C
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-white">CHAI Cambodia</p>
              <p className="truncate text-[11px] text-white/70">Leave management</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <UserMenu />
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-slate-200 bg-white p-3 lg:hidden">
            <NavItems onNavigate={() => setMobileOpen(false)} />
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-6 px-3 py-5 sm:px-5">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">
            <NavItems />
          </div>
        </aside>

        <main id="main" key={location.pathname} className="min-w-0 flex-1 pb-16">
          {children}
        </main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
