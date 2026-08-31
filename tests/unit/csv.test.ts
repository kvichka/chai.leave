import { describe, expect, it } from 'vitest'
import { escapeCsv, toCsv } from '@/lib/csv'

describe('escapeCsv', () => {
  it('passes plain values through', () => {
    expect(escapeCsv('Sokha Meas')).toBe('Sokha Meas')
    expect(escapeCsv(18)).toBe('18')
    expect(escapeCsv(true)).toBe('true')
  })

  it('renders null and undefined as empty', () => {
    expect(escapeCsv(null)).toBe('')
    expect(escapeCsv(undefined)).toBe('')
  })

  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsv('Meas, Sokha')).toBe('"Meas, Sokha"')
    expect(escapeCsv('She said "no"')).toBe('"She said ""no"""')
    expect(escapeCsv('line one\nline two')).toBe('"line one\nline two"')
  })

  it('neutralises spreadsheet formula injection', () => {
    // A leave reason is free text typed by staff. It must never execute.
    expect(escapeCsv('=1+1')).toBe("'=1+1")
    expect(escapeCsv('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    )
    expect(escapeCsv('+44 12 345')).toBe("'+44 12 345")
    expect(escapeCsv('-5')).toBe("'-5")
    expect(escapeCsv('@here')).toBe("'@here")
  })
})

describe('toCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv([
      { name: 'Chantha Ly', days: 4.5 },
      { name: 'Bopha Sok', days: 2 },
    ])
    expect(csv).toBe('name,days\r\nChantha Ly,4.5\r\nBopha Sok,2')
  })

  it('honours an explicit column order and ignores extra keys', () => {
    const csv = toCsv([{ b: 2, a: 1, c: 3 }], ['a', 'b'])
    expect(csv).toBe('a,b\r\n1,2')
  })

  it('leaves a missing key empty rather than writing "undefined"', () => {
    const csv = toCsv([{ a: 1 }, { a: 2, b: 3 }], ['a', 'b'])
    expect(csv).toBe('a,b\r\n1,\r\n2,3')
  })
})
