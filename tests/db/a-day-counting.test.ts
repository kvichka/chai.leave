import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signIn, USER } from './helpers'

/**
 * Acceptance suite A - day counting.
 *
 * 2026-08-01 is a Saturday, so 3-7 August 2026 is Monday to Friday and 8-9
 * August is a weekend. There are no Cambodian public holidays in August, which
 * is why this window was chosen.
 */
describe('A. Day counting', () => {
  let db: SupabaseClient
  let hr: SupabaseClient

  const workingDays = async (
    start: string,
    end: string,
    startPortion = 'full_day',
    endPortion = 'full_day',
  ) => {
    const { data, error } = await db.rpc('fn_working_days', {
      p_start: start,
      p_end: end,
      p_start_portion: startPortion,
      p_end_portion: endPortion,
    })
    if (error) throw error
    return Number(data)
  }

  const computeDays = async (
    type: string,
    start: string,
    end: string,
    startPortion = 'full_day',
    endPortion = 'full_day',
  ) => {
    const { data, error } = await db.rpc('fn_compute_days', {
      p_leave_type: type,
      p_start: start,
      p_end: end,
      p_start_portion: startPortion,
      p_end_portion: endPortion,
    })
    if (error) throw error
    return Number(data)
  }

  beforeAll(async () => {
    db = await signIn(USER.chantha)
    hr = await signIn(USER.dara)
    // Make sure the window really is clear, whatever the seed happened to hold.
    await hr.from('public_holidays').delete().gte('holiday_date', '2026-08-01').lte('holiday_date', '2026-08-31')
  })

  afterAll(async () => {
    await hr.from('public_holidays').delete().eq('holiday_date', '2026-08-05')
  })

  it('A1. Mon 3 Aug to Fri 7 Aug 2026, no holidays, full days -> 5.0', async () => {
    expect(await workingDays('2026-08-03', '2026-08-07')).toBe(5)
  })

  it('A3. Fri 7 Aug to Mon 10 Aug 2026 -> 2.0 (the weekend is excluded)', async () => {
    expect(await workingDays('2026-08-07', '2026-08-10')).toBe(2)
  })

  it('A4. Single day 3 Aug 2026, start_portion afternoon -> 0.5', async () => {
    expect(await workingDays('2026-08-03', '2026-08-03', 'afternoon')).toBe(0.5)
  })

  it('A5. 3 Aug to 5 Aug 2026, afternoon start and morning end -> 2.0', async () => {
    expect(await workingDays('2026-08-03', '2026-08-05', 'afternoon', 'morning')).toBe(2)
  })

  it('A6. A calendar-day type over 3 Aug to 1 Nov 2026 -> 91.0', async () => {
    // MATERNITY is unit = calendar_day. Weekends and holidays are irrelevant.
    expect(await computeDays('MATERNITY', '2026-08-03', '2026-11-01')).toBe(91)
  })

  it('A7. A weekend-only range for a working-day type -> 0.0', async () => {
    expect(await workingDays('2026-08-08', '2026-08-09')).toBe(0)
    expect(await computeDays('ANNUAL', '2026-08-08', '2026-08-09')).toBe(0)
  })

  it('A7b. ...and submitting that range is refused with a readable message', async () => {
    const { data: draft, error: insertError } = await db
      .from('leave_requests')
      .insert({
        employee_id: (await db.auth.getUser()).data.user!.id,
        leave_type_code: 'ANNUAL',
        start_date: '2026-08-08',
        end_date: '2026-08-09',
        status: 'draft',
      })
      .select()
      .single()

    // The nonneg CHECK deliberately allows a 0-day draft to exist precisely so
    // that submission can refuse it with a sentence rather than a constraint code.
    expect(insertError).toBeNull()
    expect(Number(draft!.days_requested)).toBe(0)

    const { error } = await db.rpc('rpc_submit_request', { p_request_id: draft!.id })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('no working days')

    await db.from('leave_requests').delete().eq('id', draft!.id)
  })

  describe('with a public holiday inside the range', () => {
    beforeAll(async () => {
      const { error } = await hr.from('public_holidays').upsert({
        holiday_date: '2026-08-05',
        name_en: 'Test holiday (acceptance suite)',
        is_half_day: false,
      })
      if (error) throw error
    })

    it('A2. Mon 3 Aug to Fri 7 Aug 2026 with a holiday on Wed 5 Aug -> 4.0', async () => {
      expect(await workingDays('2026-08-03', '2026-08-07')).toBe(4)
    })

    it('A2b. A half-day holiday removes exactly 0.5', async () => {
      await hr
        .from('public_holidays')
        .update({ is_half_day: true })
        .eq('holiday_date', '2026-08-05')
      expect(await workingDays('2026-08-03', '2026-08-07')).toBe(4.5)
      await hr
        .from('public_holidays')
        .update({ is_half_day: false })
        .eq('holiday_date', '2026-08-05')
    })
  })
})
