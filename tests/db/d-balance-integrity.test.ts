import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addDays,
  availableBalance,
  clearRequests,
  createDraft,
  findRange,
  iso,
  ID,
  setEntitlementTotal,
  signIn,
  statusOf,
  thisYear,
  USER,
} from './helpers'



/**
 * Acceptance suite D - balance integrity. These are the tests that matter most:
 * every one of them corresponds to a way a leave system quietly gives away days
 * it does not have.
 */
describe('D. Balance integrity', () => {
  let bopha: SupabaseClient
  let sokha: SupabaseClient
  let dara: SupabaseClient
  let vanna: SupabaseClient
  const year = thisYear()

  beforeAll(async () => {
    bopha = await signIn(USER.bopha)
    sokha = await signIn(USER.sokha)
    dara = await signIn(USER.dara)
    vanna = await signIn(USER.vanna)
  })

  beforeEach(async () => {
    await clearRequests(dara, ID.bopha)
  })

  it('D1. 2.0 available, 3.0 requested -> refused, and the message names the 2', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'ANNUAL', year, 2)
    expect(await availableBalance(bopha, ID.bopha, 'ANNUAL', year)).toBe(2)

    const range = await findRange(bopha, 'ANNUAL', 3, 30)
    const draft = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: range.start,
      end_date: range.end,
    })

    const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: draft.id })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('2')
    expect(error!.message).toMatch(/available/i)
    expect(await statusOf(bopha, draft.id)).toBe('draft')
  })

  it('D2. Pending days are reserved: the second of two 3-day requests is refused', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'ANNUAL', year, 5)

    const first = await findRange(bopha, 'ANNUAL', 3, 30)
    const second = await findRange(bopha, 'ANNUAL', 3, 90)

    const a = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: first.start,
      end_date: first.end,
    })
    const { error: firstError } = await bopha.rpc('rpc_submit_request', { p_request_id: a.id })
    expect(firstError).toBeNull()
    expect(await statusOf(bopha, a.id)).toBe('pending_supervisor')

    const b = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: second.start,
      end_date: second.end,
    })
    const { error: secondError } = await bopha.rpc('rpc_submit_request', { p_request_id: b.id })

    expect(secondError).not.toBeNull()
    expect(secondError!.message).toMatch(/available/i)
    expect(await statusOf(bopha, b.id)).toBe('draft')
  })

  it('D3. Concurrency: two 3-day requests both pending, 5.0 entitled, only the first can be approved', async () => {
    // Both are submitted while 6 days are available, so both legitimately reach
    // the supervisor. The entitlement is then corrected down to 5, which is the
    // realistic version of "the balance moved while the request was waiting".
    //
    // The check that catches this lives at whichever stage commits the days.
    // Since the supervisor's decision became final, that is the supervisor
    // stage — the same property, one approval earlier.
    await setEntitlementTotal(dara, ID.bopha, 'ANNUAL', year, 6)

    const first = await findRange(bopha, 'ANNUAL', 3, 30)
    const second = await findRange(bopha, 'ANNUAL', 3, 90)

    const a = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: first.start,
      end_date: first.end,
    })
    const b = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: second.start,
      end_date: second.end,
    })

    for (const r of [a, b]) {
      const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: r.id })
      if (error) throw error
      expect(await statusOf(bopha, r.id)).toBe('pending_supervisor')
    }

    await setEntitlementTotal(dara, ID.bopha, 'ANNUAL', year, 5)

    // First fits: 5 entitled, nothing approved yet, 3 requested.
    const { error: firstApproval } = await sokha.rpc('rpc_supervisor_decision', {
      p_request_id: a.id,
      p_approve: true,
      p_comment: null,
    })
    expect(firstApproval).toBeNull()
    expect(await statusOf(bopha, a.id)).toBe('approved')

    // Second does not: 5 entitled, 3 already approved, 3 requested.
    const { error: secondApproval } = await sokha.rpc('rpc_supervisor_decision', {
      p_request_id: b.id,
      p_approve: true,
      p_comment: null,
    })
    expect(secondApproval).not.toBeNull()
    expect(secondApproval!.message).toMatch(/exceed the balance/i)
    expect(secondApproval!.message).toMatch(/another request/i)
    expect(await statusOf(bopha, b.id)).toBe('pending_supervisor')
  })

  it('D4. Overlapping date ranges for the same employee are refused', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'ANNUAL', year, 18)

    const range = await findRange(bopha, 'ANNUAL', 3, 30)
    const a = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: range.start,
      end_date: range.end,
    })
    const { error: firstError } = await bopha.rpc('rpc_submit_request', { p_request_id: a.id })
    expect(firstError).toBeNull()

    // Same middle day, different span.
    const overlapStart = iso(addDays(new Date(`${range.start}T00:00:00Z`), 1))
    const overlapEnd = iso(addDays(new Date(`${range.start}T00:00:00Z`), 4))
    const b = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'ANNUAL',
      start_date: overlapStart,
      end_date: overlapEnd,
    })

    const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: b.id })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/overlap/i)
  })

  it('D5. A male employee requesting maternity leave is refused on the gender restriction', async () => {
    await clearRequests(dara, ID.vanna)
    const start = iso(addDays(new Date(), 60))
    const end = iso(addDays(new Date(), 90))

    const draft = await createDraft(vanna, {
      employee_id: ID.vanna,
      leave_type_code: 'MATERNITY',
      start_date: start,
      end_date: end,
    })

    const { error } = await vanna.rpc('rpc_submit_request', { p_request_id: draft.id })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/not available for your staff record/i)
  })

  it('D6. A 3-day sick leave with no supporting document is refused', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'SICK', year, 5)
    const range = await findRange(bopha, 'SICK', 3, 14)

    const draft = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'SICK',
      start_date: range.start,
      end_date: range.end,
    })

    const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: draft.id })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/supporting document/i)
  })

  it('D7. A 1-day sick leave with no supporting document is allowed', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'SICK', year, 5)
    const range = await findRange(bopha, 'SICK', 1, 14)

    const draft = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'SICK',
      start_date: range.start,
      end_date: range.end,
    })

    const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: draft.id })
    expect(error).toBeNull()
    expect(await statusOf(bopha, draft.id)).toBe('pending_supervisor')
  })

  it('D8. Annual leave inside the notice period is refused', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'ANNUAL', year, 18)

    // Temporarily widen the notice window so a working day is guaranteed to
    // fall inside it whatever weekday the suite happens to run on. The rule
    // under test is unchanged; only the size of the window is.
    const { data: original } = await dara
      .from('leave_types')
      .select('min_notice_days')
      .eq('code', 'ANNUAL')
      .single()
    await dara.from('leave_types').update({ min_notice_days: 10 }).eq('code', 'ANNUAL')

    try {
      // Three consecutive days always contain at least one weekday.
      let start: string | null = null
      for (let offset = 3; offset <= 5; offset++) {
        const candidate = iso(addDays(new Date(), offset))
        const { data } = await bopha.rpc('rpc_preview_days', {
          p_leave_type: 'ANNUAL',
          p_start: candidate,
          p_end: candidate,
          p_start_portion: 'full_day',
          p_end_portion: 'full_day',
        })
        if (Number(data) === 1) {
          start = candidate
          break
        }
      }
      expect(start).not.toBeNull()

      const draft = await createDraft(bopha, {
        employee_id: ID.bopha,
        leave_type_code: 'ANNUAL',
        start_date: start!,
        end_date: start!,
      })

      const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: draft.id })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/notice/i)
      expect(await statusOf(bopha, draft.id)).toBe('draft')
    } finally {
      await dara
        .from('leave_types')
        .update({ min_notice_days: original?.min_notice_days ?? 3 })
        .eq('code', 'ANNUAL')
    }
  })

  it('D9. Retroactive sick leave is allowed', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'SICK', year, 5)

    // The most recent working day on or before yesterday.
    let start: string | null = null
    for (let back = 1; back <= 7; back++) {
      const candidate = iso(addDays(new Date(), -back))
      const { data } = await bopha.rpc('rpc_preview_days', {
        p_leave_type: 'SICK',
        p_start: candidate,
        p_end: candidate,
        p_start_portion: 'full_day',
        p_end_portion: 'full_day',
      })
      if (Number(data) === 1) {
        start = candidate
        break
      }
    }
    expect(start).not.toBeNull()

    const draft = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'SICK',
      start_date: start!,
      end_date: start!,
      reason: 'Was ill, reporting it now.',
    })

    const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: draft.id })
    expect(error).toBeNull()
    expect(await statusOf(bopha, draft.id)).toBe('pending_supervisor')
  })

  it('D10. Half days are refused on a leave type that does not allow them', async () => {
    await setEntitlementTotal(dara, ID.bopha, 'MENTAL_HEALTH', year, 1)
    const range = await findRange(bopha, 'MENTAL_HEALTH', 1, 14)

    const draft = await createDraft(bopha, {
      employee_id: ID.bopha,
      leave_type_code: 'MENTAL_HEALTH',
      start_date: range.start,
      end_date: range.end,
      start_portion: 'afternoon',
    })

    const { error } = await bopha.rpc('rpc_submit_request', { p_request_id: draft.id })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/whole days/i)
  })

  it('D11. Working days and calendar days are never mixed', async () => {
    // The bug that made the source workbook unusable: 21 working days and
    // 90 calendar days summed in one row.
    const start = iso(addDays(new Date(), 40))
    const end = iso(addDays(new Date(), 43)) // four consecutive days

    const [{ data: annual }, { data: maternity }] = await Promise.all([
      bopha.rpc('rpc_preview_days', {
        p_leave_type: 'ANNUAL',
        p_start: start,
        p_end: end,
        p_start_portion: 'full_day',
        p_end_portion: 'full_day',
      }),
      bopha.rpc('rpc_preview_days', {
        p_leave_type: 'MATERNITY',
        p_start: start,
        p_end: end,
        p_start_portion: 'full_day',
        p_end_portion: 'full_day',
      }),
    ])

    expect(Number(maternity)).toBe(4)
    expect(Number(annual)).toBeLessThanOrEqual(4)
  })
})
