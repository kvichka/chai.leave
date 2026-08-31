export type CsvValue = string | number | boolean | null | undefined
export type CsvRow = Record<string, CsvValue>

/**
 * Quotes a single CSV field.
 *
 * A leading =, +, - or @ is treated as a formula by Excel and LibreOffice, so a
 * staff name or a leave reason could execute something when the export is
 * opened. Prefixing with an apostrophe neutralises that without changing what
 * the reader sees.
 */
export function escapeCsv(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Serialises rows to CRLF-delimited CSV. Returns '' for an empty set. */
export function toCsv(rows: CsvRow[], headers?: string[]): string {
  if (rows.length === 0) return ''
  const cols = headers ?? Object.keys(rows[0]!)
  return [
    cols.map(escapeCsv).join(','),
    ...rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(',')),
  ].join('\r\n')
}

/**
 * Parses CSV into row objects keyed by header.
 *
 * Handles quoted fields, embedded commas, doubled quotes, CRLF, and the BOM
 * Excel writes at the start of a UTF-8 file. Also strips the leading apostrophe
 * that escapeCsv adds to neutralise formula injection, so a file exported from
 * this app can be re-imported unchanged.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, '')
  const table: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      table.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    table.push(row)
  }

  const headerRow = table.shift() ?? []
  const headers = headerRow.map((h) => h.trim())

  const rows = table
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      headers.forEach((h, i) => {
        let v = (r[i] ?? '').trim()
        // Undo the anti-formula-injection prefix from escapeCsv.
        if (/^'[=+\-@]/.test(v)) v = v.slice(1)
        o[h] = v
      })
      return o
    })

  return { headers, rows }
}
