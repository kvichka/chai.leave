import { UserRoundX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/providers/AuthProvider'

/**
 * A signed-in Google user with no employees row must never see an empty
 * dashboard and wonder whether the system is broken. Tell them exactly what
 * has happened and what to do about it.
 */
export function NotRegisteredPage() {
  const { session, signOut } = useAuth()

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="card w-full max-w-md p-7 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <UserRoundX className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          Your account is not yet registered
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          You signed in successfully as{' '}
          <span className="font-medium text-slate-800">{session?.user.email}</span>, but there is no
          staff record for you yet. Contact HR and ask them to register you — they will need your
          staff code and hire date.
        </p>
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          Signing in once, as you have just done, is the step HR was waiting for. They can add you
          now.
        </p>
        <Button variant="secondary" className="mt-5 w-full justify-center" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  )
}
