import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/providers/AuthProvider'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { NotRegisteredPage } from '@/pages/NotRegisteredPage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { MyLeavePage } from '@/pages/MyLeavePage'
import { Skeleton } from '@/components/ui/primitives'

/**
 * Everything except My leave is loaded on demand.
 *
 * Bundling every screen together meant an ordinary employee downloaded the HR
 * dashboard, the admin console and the whole charting library in order to look
 * at their own leave balance — screens they can never even open, because the
 * routes are role-gated. Splitting them moves roughly two thirds of the
 * JavaScript off the first load for most staff.
 */
const ApprovalsPage = lazy(() =>
  import('@/pages/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })),
)
const HrDashboardPage = lazy(() =>
  import('@/pages/HrDashboardPage').then((m) => ({ default: m.HrDashboardPage })),
)
const CalendarPage = lazy(() =>
  import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })),
)
const MyTeamPage = lazy(() =>
  import('@/pages/MyTeamPage').then((m) => ({ default: m.MyTeamPage })),
)
const AdminPage = lazy(() => import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })))

/** Shown for the moment a lazily-loaded screen is being fetched. */
function RouteFallback() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm space-y-3 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}

export default function App() {
  const { session, employee, initialising, unregistered, mustChangePassword, isHr, isSupervisor } =
    useAuth()

  if (initialising) return <BootScreen />
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  if (unregistered || !employee) {
    return (
      <Routes>
        <Route path="*" element={<NotRegisteredPage />} />
      </Routes>
    )
  }

  // A temporary password must be replaced before anything else is reachable.
  if (mustChangePassword) {
    return (
      <Routes>
        <Route path="*" element={<ChangePasswordPage />} />
      </Routes>
    )
  }

  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/" element={<Navigate to="/my-leave" replace />} />
        <Route path="/login" element={<Navigate to="/my-leave" replace />} />
        <Route path="/my-leave" element={<MyLeavePage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route
          path="/team"
          element={isSupervisor ? <MyTeamPage /> : <Navigate to="/my-leave" replace />}
        />
        <Route
          path="/approvals"
          element={isSupervisor ? <ApprovalsPage /> : <Navigate to="/my-leave" replace />}
        />
        <Route
          path="/hr"
          element={isHr ? <HrDashboardPage /> : <Navigate to="/my-leave" replace />}
        />
        <Route
          path="/admin"
          element={isHr ? <AdminPage /> : <Navigate to="/my-leave" replace />}
        />
        <Route path="*" element={<Navigate to="/my-leave" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
