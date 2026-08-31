import { PlugZap } from 'lucide-react'

/**
 * Shown when .env.local has not been filled in yet. A blank page with a console
 * error is the worst possible answer to "I ran npm run dev and nothing
 * happened" - say what is missing and where to get it.
 */
export function NotConfiguredPage() {
  const rows = [
    {
      name: 'VITE_SUPABASE_URL',
      where: 'Project Settings → API → Project URL',
      value: import.meta.env.VITE_SUPABASE_URL,
    },
    {
      name: 'VITE_SUPABASE_ANON_KEY',
      where: 'Project Settings → API → anon public key',
      value: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  ]

  const looksUnset = (v: string | undefined) =>
    !v || v.trim() === '' || /^TODO/i.test(v.trim()) || v.includes('your-project-ref')

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="card p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <PlugZap className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold text-slate-900">Not connected to a database</h1>
              <p className="text-sm text-slate-500">
                The app is running, but <code className="text-xs">.env.local</code> still has
                placeholders in it.
              </p>
            </div>
          </div>

          <ol className="mb-5 space-y-3 text-sm text-slate-700">
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold">
                1
              </span>
              <span>
                Create a project at{' '}
                <a
                  className="font-medium text-chai-700 underline underline-offset-2"
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  supabase.com/dashboard
                </a>
                . Region: Southeast Asia (Singapore).
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold">
                2
              </span>
              <span>
                Put these two values into <code className="text-xs">.env.local</code>:
              </span>
            </li>
          </ol>

          <div className="mb-5 overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td className="px-3 py-2.5 align-top">
                      <code className="text-xs font-medium text-slate-800">{r.name}</code>
                      <p className="mt-0.5 text-xs text-slate-500">{r.where}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right align-top">
                      {looksUnset(r.value) ? (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                          not set
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                          set
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ol className="space-y-3 text-sm text-slate-700" start={3}>
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold">
                3
              </span>
              <span>
                Add <code className="text-xs">SUPABASE_DB_URL</code> too (Project Settings →
                Database → Connection string → URI → <strong>Session pooler</strong>), then run{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">npm run db:migrate</code>{' '}
                and{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">npm run db:seed</code>.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold">
                4
              </span>
              <span>
                Vite reloads <code className="text-xs">.env.local</code> only on restart — stop the
                dev server and start it again.
              </span>
            </li>
          </ol>
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-slate-400">
          Full instructions are in the README under &ldquo;Setup&rdquo;.
        </p>
      </div>
    </main>
  )
}
