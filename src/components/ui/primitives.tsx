import { forwardRef, type ReactNode } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/cn'
import { STATUS_CLASS, STATUS_LABEL } from '@/lib/format'
import type { LeaveStatus } from '@/lib/database.types'

/* --------------------------------------------------------------- Card ---- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------- Chips ---- */

export function StatusChip({ status, className }: { status: LeaveStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_CLASS[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode
  tone?: 'slate' | 'chai' | 'amber' | 'emerald' | 'red' | 'violet'
  className?: string
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    chai: 'bg-chai-50 text-chai-800 ring-chai-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    red: 'bg-red-50 text-red-800 ring-red-200',
    violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ----------------------------------------------------------- Skeletons --- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded bg-slate-200/70', className)}
      aria-hidden
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  )
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap p-3" role="status" aria-label="Loading">
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3">
            {Array.from({ length: cols }).map((__, c) => (
              <Skeleton key={c} className={cn('h-5 flex-1', c === 0 && 'max-w-[8rem]')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------- Empty state --- */

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="text-slate-300">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="max-w-md text-sm text-slate-500">{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------- Fields --- */

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, children, required, ...props }, ref) {
  return (
    <LabelPrimitive.Root ref={ref} className={cn('label', className)} {...props}>
      {children}
      {required ? (
        <span className="ml-0.5 text-red-600" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
})

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn('field', className)} {...props} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('field min-h-[80px]', className)} {...props} />
})

export const NativeSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function NativeSelect({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn('field pr-8', className)} {...props}>
      {children}
    </select>
  )
})

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p className="mt-1 text-xs font-medium text-red-600" role="alert">
      {children}
    </p>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="hint">{hint}</p> : null}
      <FieldError>{error}</FieldError>
    </div>
  )
}

/* ------------------------------------------------------------ Tooltips --- */

export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-slate-900" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

/* ------------------------------------------------------------ Progress --- */

/**
 * Taken / pending / available in one bar. Pending is hatched, never merged into
 * taken - the difference between "gone" and "asked for" matters to staff.
 */
export function BalanceBar({
  taken,
  pending,
  entitled,
}: {
  taken: number
  pending: number
  entitled: number
}) {
  const total = Math.max(entitled, taken + pending, 0.0001)
  const takenPct = Math.min((taken / total) * 100, 100)
  const pendingPct = Math.min((pending / total) * 100, 100 - takenPct)

  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
      role="img"
      aria-label={`${taken} taken, ${pending} pending, out of ${entitled}`}
    >
      <div className="bg-chai-600" style={{ width: `${takenPct}%` }} />
      <div className="hatched" style={{ width: `${pendingPct}%` }} />
    </div>
  )
}

export function KpiTile({
  label,
  value,
  sub,
  tone = 'slate',
  icon,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'slate' | 'chai' | 'amber' | 'emerald' | 'red'
  icon?: ReactNode
  /** For grid spans: an odd number of tiles never divides evenly. */
  className?: string
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900',
    chai: 'text-chai-700',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    red: 'text-red-600',
  }
  return (
    <div className={cn('card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon ? <span className="text-slate-300">{icon}</span> : null}
      </div>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  )
}
