import { toCsv, type CsvRow } from './csv'

export function downloadCsv(filename: string, rows: CsvRow[], headers?: string[]) {
  const body = toCsv(rows, headers)
  if (!body) return

  // A BOM, so Excel opens Khmer script correctly instead of as mojibake.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

/**
 * The spreadsheet writer is ~50 kB and only runs when somebody clicks Export,
 * so it is fetched at that moment rather than shipped to every visitor.
 */
export async function downloadXlsx(filename: string, rows: CsvRow[], headers?: string[]) {
  if (rows.length === 0) return
  const { default: writeXlsxFile } = await import('write-excel-file')
  const cols = headers ?? Object.keys(rows[0]!)

  const sheet = [
    cols.map((c) => ({ value: c, fontWeight: 'bold' as const })),
    ...rows.map((r) =>
      cols.map((c) => {
        const v = r[c]
        if (typeof v === 'number') return { type: Number, value: v }
        if (typeof v === 'boolean') return { type: Boolean, value: v }
        return { type: String, value: v == null ? '' : String(v) }
      }),
    ),
  ]

  await writeXlsxFile(sheet as never, {
    fileName: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
    columns: cols.map(() => ({ width: 22 })),
  })
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function stamp(prefix: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
