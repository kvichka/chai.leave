import { describe, expect, it } from 'vitest'
import { generatePin, passwordChecks, passwordIsValid, PIN_DIGITS } from '@/lib/password'

describe('PIN password rules — six digits plus a letter', () => {
  it('accepts the house format', () => {
    expect(passwordIsValid('482913k')).toBe(true)
    expect(passwordIsValid('k482913')).toBe(true)
    expect(passwordIsValid('48a2913')).toBe(true)
  })

  it('rejects six digits with no letter', () => {
    expect(passwordIsValid('482913')).toBe(false)
  })

  it('rejects fewer than six digits', () => {
    expect(passwordIsValid('48291k')).toBe(false)
    expect(passwordIsValid('1234k')).toBe(false)
  })

  it('rejects letters alone, however long', () => {
    expect(passwordIsValid('abcdefghijklmnop')).toBe(false)
  })

  it('accepts something longer that still satisfies the rules', () => {
    expect(passwordIsValid('MyLeave2026pass99')).toBe(true)
  })

  it('rejects an empty password', () => {
    expect(passwordIsValid('')).toBe(false)
  })

  it('rejects the seeded demo password', () => {
    expect(passwordIsValid('demo-password-not-for-production')).toBe(false)
  })

  it('names each unmet rule so the screen can list them', () => {
    const checks = passwordChecks('12a')
    expect(checks.find((c) => c.label.includes('numbers'))?.ok).toBe(false)
    expect(checks.find((c) => c.label.includes('letter'))?.ok).toBe(true)
    expect(checks.find((c) => c.label.includes('characters in total'))?.ok).toBe(false)
  })

  it('honours a higher minimum length from app_settings', () => {
    // The rule never gets weaker than the PIN format, but it can get stronger.
    expect(passwordIsValid('482913k', 12)).toBe(false)
    expect(passwordIsValid('482913kkkkkk', 12)).toBe(true)
  })
})

describe('generatePin', () => {
  it('always produces a password its own rules accept', () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin()
      expect(passwordIsValid(pin), `generated "${pin}" fails validation`).toBe(true)
    }
  })

  it('is six digits then a letter', () => {
    for (let i = 0; i < 50; i++) {
      // Double backslash: inside a template literal, `\d` collapses to `d`.
      expect(generatePin()).toMatch(new RegExp(`^\\d{${PIN_DIGITS}}[a-z]$`))
    }
  })

  it('avoids characters that are ambiguous when read aloud or written', () => {
    for (let i = 0; i < 200; i++) {
      // no 0/O, no 1/l/I
      expect(generatePin()).not.toMatch(/[01lIoO]/)
    }
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePin()))
    expect(seen.size).toBeGreaterThan(180)
  })
})
