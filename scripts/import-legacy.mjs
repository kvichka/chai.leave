#!/usr/bin/env node
/**
 * Migrates the per-employee Excel trackers into the database.
 *
 * Usage:
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...        # shell only. NEVER commit this.
 *   node scripts/import-legacy.mjs docs/import/employees.csv docs/import/leave_taken.csv
 *
 * Flags:
 *   --dry-run                 parse and validate, write nothing
 *   --no-create-missing-users  skip anyone without an auth account instead of
 *                              pre-provisioning one
 *   --year=2026               leave year to generate entitlements for
 *
 * This script is idempotent. Employees are matched on email, historical leave on
 * (employee, leave type, start date, end date). Run it as many times as you like.
 *
 * It uses the service_role key because it has to: it writes employees rows and
 * back-dated approved leave, both of which Row Level Security correctly forbids
 * to ordinary users. That key must come from your shell and must never be
 * committed, deployed, or put in the frontend.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const files = args.filter((a) => !a.startsWith('--'))
const yearFlag = args.find((a) => a.startsWith('--year='))
const LEAVE_YEAR = Number(yearFlag?.split('=')[1] ?? new Date().getFullYear())
const DRY = flags.has('--dry-run')
const CREATE_USERS = !flags.has('--no-create-missing-users')

const [employeesCsv, leaveCsv] = files
if (!employeesCsv) {
  console.error('Usage: node scripts/import-legacy.mjs <employees.csv> [leave_taken.csv]')
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell.')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

/* -------------------------------------------------------------- CSV ------ */

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
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
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const header = rows.shift()?.map((h) => h.trim().replace(/^﻿/, '')) ?? []
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => {
      const o = {}
      header.forEach((h, i) => {
        o[h] = (r[i] ?? '').trim()
      })
      return o
    })
}

const nn = (v) => (v === '' || v === undefined ? null : v)

function requireDate(value, label, line) {
  if (!value) throw new Error(`Line ${line}: ${label} is required.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Line ${line}: ${label} must be YYYY-MM-DD, got "${value}".`)
  }
  return value
}

/* ------------------------------------------------------- auth accounts --- */

async function allAuthUsers() {
  const byEmail = new Map()
  let page = 1
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of data.users) if (u.email) byEmail.set(u.email.toLowerCase(), u.id)
    if (data.users.length < 1000) break
    page++
  }
  return byEmail
}

/* ------------------------------------------------------------- run ------- */

const report = { employees: 0, employeesSkipped: 0, usersCreated: 0, leave: 0, leaveSkipped: 0 }
const problems = []

const staffRows = parseCsv(readFileSync(employeesCsv, 'utf8'))
console.log(`Read ${staffRows.length} employee row(s) from ${employeesCsv}`)

const authByEmail = await allAuthUsers()
const idByStaffCode = new Map()

// ---- pass 1: employees, without supervisors ----
for (const [i, r] of staffRows.entries()) {
  const line = i + 2
  try {
    const email = r.email?.toLowerCase()
    if (!email) throw new Error(`Line ${line}: email is required.`)
    if (!r.staff_code) throw new Error(`Line ${line}: staff_code is required.`)
    requireDate(r.hire_date, 'hire_date', line)

    let id = authByEmail.get(email)
    if (!id) {
      if (!CREATE_USERS) {
        problems.push(`${email}: no auth account, skipped (--no-create-missing-users).`)
        report.employeesSkipped++
        continue
      }
      if (DRY) {
        console.log(`  [dry-run] would pre-provision an account for ${email}`)
        continue
      }
      const { data, error } = await db.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { provider: 'google', providers: ['google'] },
      })
      if (error) throw new Error(`Line ${line}: could not create an account for ${email}: ${error.message}`)
      id = data.user.id
      authByEmail.set(email, id)
      report.usersCreated++
    }

    idByStaffCode.set(r.staff_code, id)

    const payload = {
      id,
      staff_code: r.staff_code,
      full_name: r.full_name,
      full_name_kh: nn(r.full_name_kh),
      email,
      position_title: nn(r.position_title),
      department: nn(r.department),
      hire_date: r.hire_date,
      probation_end_date: nn(r.probation_end_date),
      exit_date: nn(r.exit_date),
      employment_status: nn(r.employment_status) ?? 'active',
      role: nn(r.role) ?? 'employee',
      gender: nn(r.gender),
    }

    if (DRY) {
      console.log(`  [dry-run] upsert employee ${payload.staff_code} ${payload.full_name}`)
    } else {
      const { error } = await db.from('employees').upsert(payload, { onConflict: 'id' })
      if (error) throw new Error(`Line ${line}: ${error.message}`)
    }
    report.employees++
  } catch (e) {
    problems.push(e.message)
  }
}

// ---- pass 2: supervisors, once every id is known ----
for (const [i, r] of staffRows.entries()) {
  const line = i + 2
  const code = r.supervisor_staff_code
  if (!code) continue
  const selfId = idByStaffCode.get(r.staff_code)
  const supId = idByStaffCode.get(code)
  if (!selfId) continue
  if (!supId) {
    problems.push(`Line ${line}: supervisor_staff_code "${code}" is not in this file.`)
    continue
  }
  if (DRY) {
    console.log(`  [dry-run] ${r.staff_code} reports to ${code}`)
    continue
  }
  const { error } = await db.from('employees').update({ supervisor_id: supId }).eq('id', selfId)
  // A cycle is refused by the database trigger, which is the point.
  if (error) problems.push(`Line ${line}: ${error.message}`)
}

// ---- entitlements ----
if (!DRY) {
  const { error } = await db.rpc('fn_generate_entitlements', {
    p_leave_year: LEAVE_YEAR,
    p_employee_id: null,
  })
  if (error) {
    problems.push(
      `Entitlement generation failed (${error.message}). Run it from the Admin page instead.`,
    )
  } else {
    console.log(`Generated entitlements for ${LEAVE_YEAR}.`)
  }
}

/* -------------------------------------------------- historical leave ----- */

if (leaveCsv) {
  const leaveRows = parseCsv(readFileSync(leaveCsv, 'utf8'))
  console.log(`Read ${leaveRows.length} leave row(s) from ${leaveCsv}`)

  for (const [i, r] of leaveRows.entries()) {
    const line = i + 2
    try {
      const employeeId = idByStaffCode.get(r.staff_code)
      if (!employeeId) throw new Error(`Line ${line}: unknown staff_code "${r.staff_code}".`)
      requireDate(r.start_date, 'start_date', line)
      requireDate(r.end_date, 'end_date', line)
      if (!r.leave_type_code) throw new Error(`Line ${line}: leave_type_code is required.`)

      const { data: existing, error: findError } = await db
        .from('leave_requests')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('leave_type_code', r.leave_type_code)
        .eq('start_date', r.start_date)
        .eq('end_date', r.end_date)
        .limit(1)
      if (findError) throw new Error(`Line ${line}: ${findError.message}`)

      if (existing && existing.length > 0) {
        report.leaveSkipped++
        continue
      }

      const approver = r.approved_by_staff_code
        ? (idByStaffCode.get(r.approved_by_staff_code) ?? null)
        : null

      const payload = {
        employee_id: employeeId,
        leave_type_code: r.leave_type_code,
        start_date: r.start_date,
        end_date: r.end_date,
        start_portion: nn(r.start_portion) ?? 'full_day',
        end_portion: nn(r.end_portion) ?? 'full_day',
        reason: nn(r.reason) ?? 'Migrated from the Excel tracker',
        status: nn(r.status) ?? 'approved',
        submitted_at: nn(r.approved_on) ? `${r.approved_on}T00:00:00Z` : `${r.start_date}T00:00:00Z`,
        supervisor_id: approver,
        supervisor_decision_at: nn(r.approved_on) ? `${r.approved_on}T00:00:00Z` : null,
        hr_id: approver,
        hr_decision_at: nn(r.approved_on) ? `${r.approved_on}T00:00:00Z` : null,
        supervisor_comment: 'Imported from the legacy spreadsheet; original approval was by email.',
      }

      if (DRY) {
        console.log(
          `  [dry-run] ${r.staff_code} ${r.leave_type_code} ${r.start_date}..${r.end_date}`,
        )
      } else {
        const { error } = await db.from('leave_requests').insert(payload)
        if (error) throw new Error(`Line ${line}: ${error.message}`)
      }
      report.leave++
    } catch (e) {
      problems.push(e.message)
    }
  }
}

/* ---------------------------------------------------------- summary ------ */

console.log('\n--- summary ---')
console.log(`Employees upserted:      ${report.employees}`)
console.log(`Employees skipped:       ${report.employeesSkipped}`)
console.log(`Auth accounts created:   ${report.usersCreated}`)
console.log(`Leave records imported:  ${report.leave}`)
console.log(`Leave records already in: ${report.leaveSkipped}`)

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log(`  - ${p}`)
}

if (DRY) console.log('\nDry run: nothing was written.')

console.log(
  '\nNote: days_requested on every imported record was recomputed by the database from the\n' +
    'dates and the public holiday table. If a figure differs from the spreadsheet, the\n' +
    'spreadsheet was almost certainly the one that was wrong - check the holidays first.',
)

process.exit(problems.length > 0 ? 1 : 0)
