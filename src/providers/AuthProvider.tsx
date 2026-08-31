import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AppRole, Employee } from '@/lib/database.types'

/**
 * Optional. Set VITE_ALLOWED_EMAIL_DOMAIN to lock sign-in to one domain.
 * Left unset, any address an administrator has created an account for can sign
 * in - which is what you want while testing.
 */
export const ALLOWED_EMAIL_DOMAIN: string | null =
  import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN?.trim() || null

interface AuthValue {
  session: Session | null
  employee: Employee | null
  /** True while we still do not know whether someone is signed in. */
  initialising: boolean
  /** Signed in, but no matching `employees` row exists. */
  unregistered: boolean
  /** Signed in with a temporary password that has to be replaced. */
  mustChangePassword: boolean
  role: AppRole | null
  isHr: boolean
  isSystemAdmin: boolean
  isSupervisor: boolean
  signIn: (email: string, password: string) => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [initialising, setInitialising] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setInitialising(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setInitialising(false)
      // A different person may have signed in - drop everything cached.
      queryClient.clear()
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [queryClient])

  const userId = session?.user.id ?? null

  const { data: employee, isLoading: employeeLoading } = useQuery({
    queryKey: ['me', userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Employee | null> => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', userId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw error
  }, [])

  const changePassword = useCallback(
    async (newPassword: string) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      // Clear the forced-change flag only after Supabase confirms the new
      // password, so a failure here can never leave someone locked out of the
      // change screen with a password they did not set.
      const { error: rpcError } = await supabase.rpc('rpc_password_changed')
      if (rpcError) throw rpcError

      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    queryClient.clear()
  }, [queryClient])

  // Domain lock, only when one is configured.
  useEffect(() => {
    const email = session?.user.email
    if (!ALLOWED_EMAIL_DOMAIN || !email) return
    if (!email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`)) {
      void supabase.auth.signOut()
    }
  }, [session])

  const value = useMemo<AuthValue>(() => {
    const role = employee?.role ?? null
    return {
      session,
      employee: employee ?? null,
      initialising: initialising || (!!userId && employeeLoading),
      unregistered: !!session && !employeeLoading && !employee,
      mustChangePassword: !!employee?.must_change_password,
      role,
      isHr: role === 'hr_admin' || role === 'system_admin',
      isSystemAdmin: role === 'system_admin',
      isSupervisor: role === 'supervisor' || role === 'hr_admin' || role === 'system_admin',
      signIn,
      changePassword,
      signOut,
    }
  }, [
    session,
    employee,
    employeeLoading,
    initialising,
    userId,
    signIn,
    changePassword,
    signOut,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
