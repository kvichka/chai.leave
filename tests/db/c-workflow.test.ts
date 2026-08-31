import { beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  availableBalance,
  clearRequests,
  createDraft,
  findPastWorkingDay,
  findRange,
  ID,
  setEntitlementTotal,
  signIn,
  statusOf,
  thisYear,
  USER,
} from './helpers'

/** Acceptance suite C - the approval workflow. */
describe('C. Workflow', () => {
  let chantha: SupabaseClient
  let sokha: SupabaseClient
  let dara: SupabaseClient
  let sophea: SupabaseClient
  let vanna: SupabaseClient
  const year = thisYear()

  beforeAll(async () => {
    chantha = await signIn(USER.chantha)
    sokha = await signIn(USER.sokha)
    dara = await signIn(USER.dara)
    sophea = await signIn(USER.sophea)
    vanna = await signIn(USER.vanna)
  })

  it('C7. Cancelling an approved request that has already started is refused', async () => {
    // Builds its own fixture rather than borrowing the seeded "currently out"
    // request: Vitest does not run test files in alphabetical order, and the
    // D suite clears Vanna's requests. A test that depends on another file
    // having not run yet is not a test.
    //
    // Sick leave is the only type that can legitimately be back-dated, which
    // makes it the only way to reach "approved and already started" through the
    // real workflow rather than by writing the row directly.
    await clearRequests(dara, ID.vanna)
    await setEntitlementTotal(dara, ID.vanna, 'SICK', year, 5)

    const past = await findPastWorkingDay(vanna, 'SICK')
    const draft = await createDraft(vanna, {
      employee_id: ID.vanna,
      leave_type_code: 'SICK',
      start_date: past,
      end_date: past,
      reason: 'Was ill last week.',
    })

    const { error: submitError } = await vanna.rpc('rpc_submit_request', {
      p_request_id: draft.id,
    })
    expect(submitError).toBeNull()

    // Dara is Vanna's supervisor, and that decision is now final.
    const { error: supError } = await dara.rpc('rpc_supervisor_decision', {
      p_request_id: draft.id,
      p_approve: true,
      p_comment: null,
    })
    expect(supError).toBeNull()

    expect(await statusOf(vanna, draft.id)).toBe('approved')

    // The actual assertion: the employee cannot cancel leave already under way.
    const { error: cancelError } = await vanna.rpc('rpc_cancel_request', {
      p_request_id: draft.id,
      p_reason: 'trying to cancel leave that has already begun',
    })
    expect(cancelError).not.toBeNull()
    expect(cancelError!.message).toMatch(/already started/i)
    expect(await statusOf(vanna, draft.id)).toBe('approved')

    // ...but HR can, because someone has to be able to correct a mistake.
    const { error: hrCancelError } = await dara.rpc('rpc_cancel_request', {
      p_request_id: draft.id,
      p_reason: 'HR correcting the record',
    })
    expect(hrCancelError).toBeNull()
    expect(await statusOf(dara, draft.id)).toBe('cancelled')
  })

  describe('C1-C3, C6. Submit, approve, approve, cancel', () => {
    let requestId: string
    let days: number
    let balanceBeforeSubmit: number

    beforeAll(async () => {
      await clearRequests(dara, ID.chantha)
      await setEntitlementTotal(dara, ID.chantha, 'ANNUAL', year, 18)
      balanceBeforeSubmit = await availableBalance(chantha, ID.chantha, 'ANNUAL', year)

      const range = await findRange(chantha, 'ANNUAL', 3, 30)
      const draft = await createDraft(chantha, {
        employee_id: ID.chantha,
        leave_type_code: 'ANNUAL',
        start_date: range.start,
        end_date: range.end,
      })
      requestId = draft.id
      days = Number(draft.days_requested)
      expect(days).toBe(3)
    })

    it('C1. Employee submits -> pending_supervisor, with supervisor_id populated', async () => {
      const { data, error } = await chantha.rpc('rpc_submit_request', { p_request_id: requestId })
      if (error) throw error
      expect(data.status).toBe('pending_supervisor')
      expect(data.supervisor_id).toBe(ID.sokha)
    })

    it('C1b. Pending days are reserved immediately, not only on approval', async () => {
      const now = await availableBalance(chantha, ID.chantha, 'ANNUAL', year)
      expect(balanceBeforeSubmit - now).toBe(days)
    })

    it('C2. Supervisor approves -> approved. The supervisor decision is final.', async () => {
      const before = await availableBalance(chantha, ID.chantha, 'ANNUAL', year)

      const { data, error } = await sokha.rpc('rpc_supervisor_decision', {
        p_request_id: requestId,
        p_approve: true,
        p_comment: 'Cover arranged with Bopha.',
      })
      if (error) throw error

      // No HR stage: leave_types.requires_hr_approval is false for every type,
      // so the supervisor's approval commits the days.
      expect(data.status).toBe('approved')
      expect(data.supervisor_comment).toBe('Cover arranged with Bopha.')

      const after = await availableBalance(chantha, ID.chantha, 'ANNUAL', year)
      // The days were already reserved while pending, so approving must not
      // deduct them a second time.
      expect(after).toBe(before)
      // And measured from before submission, the balance has dropped by exactly
      // the number of days requested.
      expect(balanceBeforeSubmit - after).toBe(days)
    })

    it('C3. HR is informed of the approval, but is not asked to decide', async () => {
      // Not in anyone's approval queue any more.
      const { data: queued } = await dara
        .from('v_pending_approvals')
        .select('request_id')
        .eq('request_id', requestId)
      expect(queued ?? []).toHaveLength(0)

      // HR got a notification that explicitly asks for nothing.
      const { data: notes } = await dara
        .from('notifications')
        .select('event_type,body')
        .eq('request_id', requestId)
        .eq('event_type', 'approved_for_information')
      expect((notes ?? []).length).toBeGreaterThan(0)
      expect(notes![0]!.body).toMatch(/no action needed/i)

      // Deciding it again is refused: it is already final.
      const { error } = await dara.rpc('rpc_hr_decision', {
        p_request_id: requestId,
        p_approve: true,
        p_comment: null,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/not awaiting an HR decision/i)
    })

    it('C6. Employee cancels the approved future request -> balance restored exactly', async () => {
      const { error } = await chantha.rpc('rpc_cancel_request', {
        p_request_id: requestId,
        p_reason: 'Plans changed',
      })
      if (error) throw error

      expect(await statusOf(chantha, requestId)).toBe('cancelled')
      const restored = await availableBalance(chantha, ID.chantha, 'ANNUAL', year)
      expect(restored).toBe(balanceBeforeSubmit)
    })
  })

  describe('C4. An employee with no supervisor', () => {
    it('goes straight to pending_hr', async () => {
      await clearRequests(dara, ID.sophea)
      await setEntitlementTotal(dara, ID.sophea, 'ANNUAL', year, 18)

      const range = await findRange(sophea, 'ANNUAL', 2, 60)
      const draft = await createDraft(sophea, {
        employee_id: ID.sophea,
        leave_type_code: 'ANNUAL',
        start_date: range.start,
        end_date: range.end,
      })

      const { data, error } = await sophea.rpc('rpc_submit_request', { p_request_id: draft.id })
      if (error) throw error
      expect(data.status).toBe('pending_hr')
      expect(data.supervisor_id).toBeNull()

      await sophea.rpc('rpc_cancel_request', { p_request_id: draft.id, p_reason: 'test cleanup' })
    })
  })

  describe('C5. Rejection requires a comment', () => {
    it('an empty comment is refused, and the request stays pending', async () => {
      await clearRequests(dara, ID.chantha)
      await setEntitlementTotal(dara, ID.chantha, 'ANNUAL', year, 18)

      const range = await findRange(chantha, 'ANNUAL', 2, 90)
      const draft = await createDraft(chantha, {
        employee_id: ID.chantha,
        leave_type_code: 'ANNUAL',
        start_date: range.start,
        end_date: range.end,
      })
      await chantha.rpc('rpc_submit_request', { p_request_id: draft.id })

      const { error: emptyError } = await sokha.rpc('rpc_supervisor_decision', {
        p_request_id: draft.id,
        p_approve: false,
        p_comment: '   ',
      })
      expect(emptyError).not.toBeNull()
      expect(emptyError!.message).toMatch(/reason is required/i)
      expect(await statusOf(chantha, draft.id)).toBe('pending_supervisor')

      // With a reason it goes through.
      const { data, error } = await sokha.rpc('rpc_supervisor_decision', {
        p_request_id: draft.id,
        p_approve: false,
        p_comment: 'Two people are already away that week.',
      })
      if (error) throw error
      expect(data.status).toBe('rejected')
    })
  })

  describe('C8. The status column cannot be written directly', () => {
    it('an employee cannot UPDATE their own request to approved', async () => {
      await clearRequests(dara, ID.chantha)
      const range = await findRange(chantha, 'ANNUAL', 1, 120)
      const draft = await createDraft(chantha, {
        employee_id: ID.chantha,
        leave_type_code: 'ANNUAL',
        start_date: range.start,
        end_date: range.end,
      })

      const { error } = await chantha
        .from('leave_requests')
        .update({ status: 'approved' })
        .eq('id', draft.id)

      expect(error).not.toBeNull()
      expect(await statusOf(chantha, draft.id)).toBe('draft')

      await chantha.from('leave_requests').delete().eq('id', draft.id)
    })

    it('a client-supplied days_requested is overwritten by the server', async () => {
      const range = await findRange(chantha, 'ANNUAL', 3, 150)
      const draft = await createDraft(chantha, {
        employee_id: ID.chantha,
        leave_type_code: 'ANNUAL',
        start_date: range.start,
        end_date: range.end,
      })
      expect(Number(draft.days_requested)).toBe(3)

      const { data, error } = await chantha
        .from('leave_requests')
        .update({ days_requested: 0.5 })
        .eq('id', draft.id)
        .select()
        .single()
      if (error) throw error
      expect(Number(data.days_requested)).toBe(3)

      await chantha.from('leave_requests').delete().eq('id', draft.id)
    })
  })
})
