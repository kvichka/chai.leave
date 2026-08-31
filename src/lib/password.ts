/**
 * One definition of "acceptable password", used by both the forced first-login
 * screen and the voluntary change dialog. Two copies would drift.
 *
 * The database enforces the minimum length independently (app_settings
 * .min_password_length); this is the same rule stated early enough to be
 * useful while typing.
 */
export interface PasswordCheck {
  label: string
  ok: boolean
}

export function passwordChecks(password: string, minLength: number): PasswordCheck[] {
  return [
    { label: `At least ${minLength} characters`, ok: password.length >= minLength },
    { label: 'A lower-case letter', ok: /[a-z]/.test(password) },
    { label: 'An upper-case letter', ok: /[A-Z]/.test(password) },
    { label: 'A number', ok: /\d/.test(password) },
    {
      label: 'Not the temporary password you were given',
      ok: password.length === 0 || password !== 'demo-password-not-for-production',
    },
  ]
}

export function passwordIsValid(password: string, minLength: number): boolean {
  return password.length > 0 && passwordChecks(password, minLength).every((c) => c.ok)
}
