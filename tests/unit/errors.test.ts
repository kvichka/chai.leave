import { describe, expect, it } from 'vitest'
import { humanError } from '@/lib/errors'

describe('humanError', () => {
  it('passes the database sentence through untouched', () => {
    // The whole point: rules live in Postgres and already carry a sentence
    // written for a human. The UI must not replace it with "Something went wrong."
    const message = 'You have 4.5 day(s) of Annual Leave available for 2026, but this request is for 6 day(s).'
    expect(humanError({ code: 'P0001', message })).toBe(message)
  })

  it('strips the ERROR: prefix', () => {
    expect(humanError({ message: 'ERROR:  Selected dates contain no working days.' })).toBe(
      'Selected dates contain no working days.',
    )
  })

  it('translates constraint violations that have no friendly RAISE', () => {
    expect(
      humanError({
        code: '23514',
        message: 'new row violates check constraint "entitlements_adjustment_needs_reason"',
      }),
    ).toBe('An adjustment must have a reason. Enter one and try again.')

    expect(
      humanError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "employees_staff_code_key"',
      }),
    ).toBe('That staff code is already in use.')
  })

  it('keeps a permission message rather than inventing one', () => {
    expect(
      humanError({ code: '42501', message: 'Only a system administrator may change a role.' }),
    ).toBe('Only a system administrator may change a role.')
  })

  it('tells the user to sign in again when the session has expired', () => {
    expect(humanError({ code: 'PGRST301', message: 'JWT expired' })).toBe(
      'Your session expired. Sign in again.',
    )
  })

  it('handles strings, nulls and empty objects without throwing', () => {
    expect(humanError('plain string')).toBe('plain string')
    expect(humanError(null)).toBe('Unknown error.')
    expect(humanError({})).toBe('Unknown error.')
  })
})
