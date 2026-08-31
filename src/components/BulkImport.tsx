import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/Dialog'
import { downloadCsv } from '@/lib/export'
import { parseCsv, type CsvRow } from '@/lib/csv'
import { humanError } from '@/lib/errors'
import { cn } from '@/lib/cn'

export interface ImportColumn {
  /** Header text in the CSV, and the key rows are read by. */
  key: string
  required?: boolean
  /** Goes in the example row of the downloaded template. */
  example: string
  hint?: string
}

export interface ImportOutcome {
  ok: boolean
  message: string
  /** Extra columns to include in the downloadable results file. */
  extra?: Record<string, string>
}

/**
 * Download a template, fill it in, upload it back.
 *
 * Rows are imported one at a time rather than in a batch, on purpose. Each row
 * goes through the same database function the single-record form uses, so every
 * validation and permission check still applies, and a bad row fails on its own
 * with the server's own sentence rather than taking the whole file down.
 */
export function BulkImport<T extends CsvRow = CsvRow>({
  title,
  description,
  columns,
  onImportRow,
  currentRows,
  resultNoun = 'row',
  fileStem,
}: {
  title: string
  description: string
  columns: ImportColumn[]
  /** Throw to fail the row; the thrown message is shown against it. */
  onImportRow: (row: Record<string, string>, index: number) => Promise<ImportOutcome | void>
  /** Optional: lets the user download what is already in the system as a starting point. */
  currentRows?: () => T[]
  resultNoun?: string
  fileStem: string
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [results, setResults] = useState<(ImportOutcome & { index: number })[] | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)

  const required = columns.filter((c) => c.required).map((c) => c.key)

  function downloadTemplate() {
    const example: CsvRow = {}
    for (const c of columns) example[c.key] = c.example
    downloadCsv(`${fileStem}_template`, [example], columns.map((c) => c.key))
  }

  function downloadCurrent() {
    const data = currentRows?.() ?? []
    if (data.length === 0) return
    downloadCsv(`${fileStem}_current`, data, columns.map((c) => c.key))
  }

  function missingFor(row: Record<string, string>): string[] {
    return required.filter((k) => !row[k]?.trim())
  }

  async function handleFile(file: File) {
    setParseError(null)
    setResults(null)
    try {
      const text = await file.text()
      const { headers, rows: parsed } = parseCsv(text)

      const missingHeaders = required.filter((k) => !headers.includes(k))
      if (missingHeaders.length > 0) {
        throw new Error(
          `The file is missing required column(s): ${missingHeaders.join(', ')}. ` +
            'Download the template and use its header row.',
        )
      }
      if (parsed.length === 0) throw new Error('That file has a header row but no data.')

      setRows(parsed)
      setOpen(true)
    } catch (e) {
      setParseError((e as Error).message)
      setOpen(true)
    }
  }

  async function runImport() {
    setRunning(true)
    setProgress(0)
    const out: (ImportOutcome & { index: number })[] = []

    for (const [i, row] of rows.entries()) {
      const missing = missingFor(row)
      if (missing.length > 0) {
        out.push({ index: i, ok: false, message: `Missing: ${missing.join(', ')}` })
      } else {
        try {
          const r = await onImportRow(row, i)
          out.push({ index: i, ok: true, message: r?.message ?? 'Imported', extra: r?.extra })
        } catch (e) {
          out.push({ index: i, ok: false, message: humanError(e) })
        }
      }
      setProgress(i + 1)
      setResults([...out])
    }

    setRunning(false)
  }

  function downloadResults() {
    if (!results) return
    const data = results.map((r) => ({
      row: r.index + 2, // +2: 1-based, plus the header row
      ...rows[r.index],
      ...(r.extra ?? {}),
      result: r.ok ? 'imported' : 'failed',
      message: r.message,
    }))
    downloadCsv(`${fileStem}_results`, data)
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results?.filter((r) => !r.ok).length ?? 0
  const hasExtras = results?.some((r) => r.extra && Object.keys(r.extra).length > 0) ?? false

  return (
    <>
      <Card>
        <CardHeader
          title={title}
          description={description}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={downloadTemplate}>
                <Download className="h-3.5 w-3.5" /> Template
              </Button>
              {currentRows ? (
                <Button size="sm" variant="secondary" onClick={downloadCurrent}>
                  <Download className="h-3.5 w-3.5" /> Current data
                </Button>
              ) : null}
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload CSV
              </Button>
            </div>
          }
        />
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = '' // let the same file be chosen twice
          }}
        />
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-xs text-slate-500">
          {columns.map((c) => (
            <span key={c.key}>
              <code className="text-[11px] font-medium text-slate-700">{c.key}</code>
              {c.required ? <span className="text-chaiDarkRed"> *</span> : null}
              {c.hint ? <span className="ml-1 text-slate-400">— {c.hint}</span> : null}
            </span>
          ))}
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (running) return
          setOpen(v)
          if (!v) {
            setRows([])
            setResults(null)
            setParseError(null)
          }
        }}
        size="xl"
        title={
          parseError
            ? 'That file cannot be read'
            : results
              ? `Imported ${okCount} of ${rows.length}`
              : `Import ${rows.length} ${resultNoun}${rows.length === 1 ? '' : 's'}?`
        }
        description={
          parseError
            ? undefined
            : results
              ? undefined
              : 'Nothing is written until you confirm. Every row goes through the same checks as the single-record form.'
        }
        footer={
          parseError ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : results ? (
            <>
              <Button variant="secondary" onClick={downloadResults}>
                <Download className="h-4 w-4" /> Download results
              </Button>
              <Button onClick={() => setOpen(false)} disabled={running}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={running} onClick={() => void runImport()}>
                Import {rows.length} {resultNoun}
                {rows.length === 1 ? '' : 's'}
              </Button>
            </>
          )
        }
      >
        {parseError ? (
          <p className="flex items-start gap-2 rounded-lg border border-chaiDarkRed/30 bg-chaiDarkRed/5 p-3 text-sm text-chaiDarkRed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {parseError}
          </p>
        ) : (
          <div className="space-y-3">
            {running ? (
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-chai-600 transition-all"
                    style={{ width: `${(progress / Math.max(rows.length, 1)) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {progress} of {rows.length}…
                </p>
              </div>
            ) : null}

            {results && !running ? (
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 text-chaiDarkGreen">
                  <CheckCircle2 className="h-4 w-4" /> {okCount} imported
                </span>
                {failCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-chaiDarkRed">
                    <XCircle className="h-4 w-4" /> {failCount} failed
                  </span>
                ) : null}
                {hasExtras ? (
                  <span className="text-slate-500">
                    Download the results file — it carries information shown only once.
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="th w-10">#</th>
                    {columns.map((c) => (
                      <th key={c.key} className="th">
                        {c.key}
                      </th>
                    ))}
                    {results ? <th className="th">Result</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, i) => {
                    const res = results?.find((r) => r.index === i)
                    const missing = missingFor(row)
                    return (
                      <tr
                        key={i}
                        className={cn(
                          res && !res.ok && 'bg-chaiDarkRed/5',
                          res?.ok && 'bg-chaiGreen/5',
                          !res && missing.length > 0 && 'bg-chaiLightGold/30',
                        )}
                      >
                        <td className="td text-slate-400">{i + 2}</td>
                        {columns.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              'td max-w-[14rem] truncate',
                              missing.includes(c.key) && 'text-chaiDarkRed',
                            )}
                            title={row[c.key]}
                          >
                            {row[c.key] || (missing.includes(c.key) ? 'required' : '—')}
                          </td>
                        ))}
                        {results ? (
                          <td className="td max-w-[20rem] whitespace-normal">
                            {res ? (
                              <span
                                className={cn(
                                  'text-xs',
                                  res.ok ? 'text-chaiDarkGreen' : 'text-chaiDarkRed',
                                )}
                              >
                                {res.message}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">waiting…</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {!results ? (
              <p className="flex items-start gap-2 text-xs text-slate-500">
                <FileUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Rows highlighted in gold are missing something required and will be skipped.
              </p>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  )
}
