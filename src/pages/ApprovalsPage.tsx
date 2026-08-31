import { Fragment, useMemo, useState } from 'react'
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Paperclip,
  ThumbsDown,
  ThumbsUp,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, StatusChip, TableSkeleton } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/Dialog'
import { ReasonDialog } from '@/components/ReasonDialog'
import {
  currentLeaveYear,
  usePendingApprovals,
  useSettings,
  useTeamAbsences,
} from '@/hooks/useLeaveData'
import { ApprovalHistory } from './approval-history'
import { useHrDecision, useSupervisorDecision } from '@/hooks/useMutations'
import { useAuth } from '@/providers/AuthProvider'
import { AGING_COLOR, fmtDate, fmtDateRange, fmtDays } from '@/lib/format'
import { signedAttachmentUrl } from '@/lib/supabase'
import type { PendingApproval } from '@/lib/database.types'
import { cn } from '@/lib/cn'

const BUCKET_ORDER = ['>10 days', '6-10 days', '3-5 days', '0-2 days'] as const

export function ApprovalsPage() {
  const { isHr } = useAuth()
  const { data: settings } = useSettings()
  const leaveYear = currentLeaveYear(settings)
  const { data: rows = [], isLoading } = usePendingApprovals()
  const supervisorDecision = useSupervisorDecision()
  const hrDecision = useHrDecision()

  const [expanded, setExpanded] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  /**
   * Rows this person can actually decide on right now. RLS already limits the
   * view to their own reporting tree, so any pending_supervisor row they can
   * see is one they are entitled to decide; only the HR stage needs the extra
   * role test.
   */
  const actionable = useMemo(
    () => rows.filter((r) => (r.status === 'pending_hr' ? isHr : true)),
    [rows, isHr],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, PendingApproval[]>()
    for (const bucket of BUCKET_ORDER) map.set(bucket, [])
    for (const r of rows) {
      const list = map.get(r.aging_bucket) ?? []
      list.push(r)
      map.set(r.aging_bucket, list)
    }
    for (const [, list] of map) list.sort((a, b) => b.days_waiting - a.days_waiting)
    return map
  }, [rows])

  async function decide(row: PendingApproval, approve: boolean, comment?: string) {
    if (row.status === 'pending_hr') {
      await hrDecision.mutateAsync({ id: row.request_id, approve, comment })
    } else {
      await supervisorDecision.mutateAsync({ id: row.request_id, approve, comment })
    }
  }

  async function bulkApprove() {
    setBulkBusy(true)
    // Sequential on purpose: each approval re-checks the balance against
    // everything approved before it. Firing them in parallel would let two
    // requests that only fit individually both slip through.
    for (const row of actionable) {
      try {
        await decide(row, true)
      } catch {
        /* the toast from the mutation already carries the server's sentence */
      }
    }
    setBulkBusy(false)
    setBulkOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          rows.length === 0
            ? 'Nothing is waiting on you.'
            : `${rows.length} request${rows.length === 1 ? '' : 's'} awaiting a decision, oldest first.`
        }
        actions={
          actionable.length > 1 ? (
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <CheckCheck className="h-4 w-4" /> Approve all ({actionable.length})
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardCheck className="h-8 w-8" />} title="Queue is empty">
            When someone in your reporting line submits a leave request, it will appear here.
            Requests waiting more than three working days will also send you a reminder.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-5">
          {BUCKET_ORDER.map((bucket) => {
            const list = grouped.get(bucket) ?? []
            if (list.length === 0) return null
            return (
              <section key={bucket}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: AGING_COLOR[bucket] }}
                    aria-hidden
                  />
                  <h2 className="text-sm font-semibold text-slate-800">
                    Waiting {bucket}
                    <span className="ml-1.5 font-normal text-slate-500">({list.length})</span>
                  </h2>
                </div>

                <div className="table-wrap">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th w-8" />
                        <th className="th">Employee</th>
                        <th className="th">Type</th>
                        <th className="th">Dates</th>
                        <th className="th text-right">Days</th>
                        <th className="th">Stage</th>
                        <th className="th text-right">Waiting</th>
                        <th className="th">
                          <span className="sr-only">Decision</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {list.map((row) => (
                        <Fragment key={row.request_id}>
                          <tr className="hover:bg-slate-50/70">
                            <td className="td">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpanded(expanded === row.request_id ? null : row.request_id)
                                }
                                aria-expanded={expanded === row.request_id}
                                aria-label={`Details for ${row.request_ref}`}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              >
                                {expanded === row.request_id ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            </td>
                            <td className="td">
                              <p className="font-medium text-slate-900">{row.employee_name}</p>
                              <p className="text-xs text-slate-500">
                                {row.department ?? '—'} · {row.request_ref}
                              </p>
                            </td>
                            <td className="td">{row.leave_type_name}</td>
                            <td className="td">{fmtDateRange(row.start_date, row.end_date)}</td>
                            <td className="td text-right tabular-nums">
                              {fmtDays(row.days_requested)}
                            </td>
                            <td className="td">
                              <StatusChip status={row.status} />
                            </td>
                            <td className="td text-right tabular-nums">{row.days_waiting}d</td>
                            <td className="td">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="success"
                                  onClick={() => void decide(row, true)}
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setRejecting(row)}
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" /> Reject
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {expanded === row.request_id ? (
                            <tr className="bg-slate-50/60">
                              <td colSpan={8} className="px-4 py-4">
                                <ExpandedDetail row={row} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      )}

      <div className="mt-6">
        <ApprovalHistory leaveYear={leaveYear} />
      </div>

      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(v) => !v && setRejecting(null)}
        title={`Reject ${rejecting?.request_ref ?? ''}`}
        description={`${rejecting?.employee_name ?? ''} will see this reason.`}
        label="Reason for rejecting"
        required
        confirmLabel="Reject request"
        destructive
        loading={supervisorDecision.isPending || hrDecision.isPending}
        onConfirm={async (reason) => {
          await decide(rejecting!, false, reason)
          setRejecting(null)
        }}
      />

      <Dialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        size="lg"
        title={`Approve ${actionable.length} requests`}
        description="Each one is approved separately and re-checked against the balance at that moment. Any that no longer fit will be refused and reported individually."
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button variant="success" loading={bulkBusy} onClick={() => void bulkApprove()}>
              Approve all {actionable.length}
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-slate-100 text-sm">
          {actionable.map((r) => (
            <li key={r.request_id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{r.employee_name}</p>
                <p className="text-xs text-slate-500">
                  {r.leave_type_name} · {fmtDateRange(r.start_date, r.end_date)} ·{' '}
                  {r.request_ref}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-slate-700">
                {fmtDays(r.days_requested)}d
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  )
}

function ExpandedDetail({ row }: { row: PendingApproval }) {
  const { data: absences = [] } = useTeamAbsences(row.start_date, row.end_date)

  const overlapping = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of absences) {
      if (a.employee_id === row.employee_id) continue
      if (a.status !== 'approved') continue
      seen.set(a.employee_id, `${a.full_name} — ${a.leave_type_name}`)
    }
    return [...seen.values()]
  }, [absences, row.employee_id])

  const negative = row.balance_after_approval < 0

  return (
    <div className="grid gap-4 [&>*]:min-w-0 md:grid-cols-3">
      <div className="space-y-3 md:col-span-2">
        <Detail label="Reason">{row.reason || <Muted>Not given.</Muted>}</Detail>
        <Detail label="Handover notes">
          {row.handover_notes || <Muted>No handover notes were recorded.</Muted>}
        </Detail>
        <Detail label="Contact while away">
          {row.contact_while_away || <Muted>Not given.</Muted>}
        </Detail>
        <Detail label="Submitted">{fmtDate(row.submitted_at)}</Detail>

        {row.attachment_path ? (
          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const url = await signedAttachmentUrl(row.attachment_path!)
                if (url) window.open(url, '_blank', 'noopener')
              }}
            >
              <Paperclip className="h-3.5 w-3.5" /> Open supporting document
            </Button>
            <p className="mt-1 text-xs text-slate-500">
              Opens a link that expires after one minute. Medical documents are never public.
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div
          className={cn(
            'rounded-lg border p-3',
            negative ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white',
          )}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Balance if approved
          </p>
          <p
            className={cn(
              'mt-0.5 text-xl font-semibold tabular-nums',
              negative ? 'text-red-700' : 'text-slate-900',
            )}
          >
            {fmtDays(row.balance_after_approval)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {fmtDays(row.balance_before_approval)} available now, less{' '}
            {fmtDays(row.days_requested)} requested.
          </p>
          {negative ? (
            <p className="mt-1.5 text-xs font-medium text-red-700">
              The server will refuse this approval.
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            <Users className="h-3.5 w-3.5" /> Also away then
          </p>
          {overlapping.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nobody else in the team.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {overlapping.slice(0, 5).map((o) => (
                <li key={o}>{o}</li>
              ))}
              {overlapping.length > 5 ? (
                <li className="text-xs text-slate-500">…and {overlapping.length - 5} more.</li>
              ) : null}
            </ul>
          )}
          {overlapping.length >= 2 ? (
            <Badge tone="amber" className="mt-2">
              Check cover
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{children}</p>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-400">{children}</span>
}
