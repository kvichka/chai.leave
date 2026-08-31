import * as ToastPrimitive from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  tone: Tone
  title: string
  body?: string
}

interface ToastApi {
  success: (title: string, body?: string) => void
  error: (title: string, body?: string) => void
  info: (title: string, body?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

let nextId = 1

const TONE: Record<Tone, { ring: string; icon: ReactNode }> = {
  success: {
    ring: 'ring-emerald-200 bg-emerald-50',
    icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
  },
  error: {
    ring: 'ring-red-200 bg-red-50',
    icon: <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />,
  },
  info: {
    ring: 'ring-slate-200 bg-white',
    icon: <Info className="h-4 w-4 shrink-0 text-chai-600" />,
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((tone: Tone, title: string, body?: string) => {
    setItems((prev) => [...prev, { id: nextId++, tone, title, body }])
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, b) => push('success', t, b),
      error: (t, b) => push('error', t, b),
      info: (t, b) => push('info', t, b),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="right" duration={7000}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((i) => i.id !== item.id))
            }}
            // Errors carry the exact server sentence, which can be long -
            // give people time to read it.
            duration={item.tone === 'error' ? 14000 : 6000}
            className={cn(
              'flex items-start gap-2.5 rounded-lg p-3 shadow-lg ring-1 animate-slide-in',
              TONE[item.tone].ring,
            )}
          >
            {TONE[item.tone].icon}
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-sm font-semibold text-slate-900">
                {item.title}
              </ToastPrimitive.Title>
              {item.body ? (
                <ToastPrimitive.Description className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600">
                  {item.body}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
