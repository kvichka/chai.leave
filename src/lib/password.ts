/**
 * One definition of "acceptable password", used by the forced first-login
 * screen, the voluntary change dialog, and the temporary-password generator.
 *
 * The house rule is a PIN: six digits plus at least one letter, e.g. 482913k.
 *
 * Worth being clear about what enforces this. The digit and letter rules are
 * checked in the browser only — a user's own password change goes straight to
 * Supabase Auth via updateUser(), which the database never sees and cannot
 * validate. The minimum *length* is enforced in three places: here, in
 * app_settings.min_password_length (which rpc_admin_create_employee and
 * rpc_admin_reset_password both check server-side), and in Supabase Auth's own
 * setting. So the shape is guidance; the length is a rule.
 */
export const PIN_DIGITS = 6
export const PIN_MIN_LENGTH = 7

export interface PasswordCheck {
  label: string
  ok: boolean
}

const countDigits = (s: string) => (s.match(/\d/g) ?? []).length
const countLetters = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length

export function passwordChecks(password: string, minLength = PIN_MIN_LENGTH): PasswordCheck[] {
  return [
    {
      label: `At least ${PIN_DIGITS} numbers`,
      ok: countDigits(password) >= PIN_DIGITS,
    },
    {
      label: 'At least one letter',
      ok: countLetters(password) >= 1,
    },
    {
      label: `At least ${Math.max(minLength, PIN_MIN_LENGTH)} characters in total`,
      ok: password.length >= Math.max(minLength, PIN_MIN_LENGTH),
    },
    {
      label: 'Not the temporary password you were given',
      ok: password.length === 0 || password !== 'demo-password-not-for-production',
    },
  ]
}

export function passwordIsValid(password: string, minLength = PIN_MIN_LENGTH): boolean {
  return password.length > 0 && passwordChecks(password, minLength).every((c) => c.ok)
}

/**
 * A temporary password in the same shape people are asked to choose: six digits
 * and a letter. Short enough to read down a phone line, and no characters that
 * are ambiguous when written by hand (no 0/O, 1/l/I).
 */
export function generatePin(): string {
  const digits = '23456789'
  const letters = 'abcdefghjkmnpqrstuvwxyz'
  const bytes = new Uint32Array(PIN_DIGITS + 1)
  crypto.getRandomValues(bytes)

  let out = ''
  for (let i = 0; i < PIN_DIGITS; i++) out += digits[bytes[i]! % digits.length]
  out += letters[bytes[PIN_DIGITS]! % letters.length]
  return out
}
