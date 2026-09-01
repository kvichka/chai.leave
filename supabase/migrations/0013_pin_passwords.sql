-- =============================================================================
-- 0013_pin_passwords.sql
--
-- Passwords become a PIN: six digits plus at least one letter (e.g. 482913k),
-- so the minimum length drops from 10 to 7.
--
-- HONEST NOTE ON WHAT THIS COSTS
-- Six digits and one letter is roughly 26 million combinations. Supabase Auth
-- rate-limits sign-in attempts, so casual online guessing is not the threat;
-- an offline attack against a leaked password hash is. That is an acceptable
-- trade for a test system, and worth revisiting before real staff sick-leave
-- records live here. Raise min_password_length and the checks in
-- src/lib/password.ts together if you do.
--
-- WHAT ENFORCES WHAT
--   length  — here (server-side, checked by both admin RPCs), plus Supabase
--             Auth's own "Minimum password length" setting in the dashboard.
--   shape   — browser only. A user changing their own password calls
--             supabase.auth.updateUser(), which never reaches this database, so
--             the digit/letter rule cannot be enforced in SQL.
-- =============================================================================

update public.app_settings
set min_password_length = 7
where id = 1;

comment on column public.app_settings.min_password_length is
  'Minimum characters for a password. Checked by rpc_admin_create_employee and '
  'rpc_admin_reset_password. Set to 7 for the six-digits-plus-a-letter PIN format. '
  'Supabase Auth has its own minimum in the dashboard; keep the two in step or the '
  'shorter one silently wins.';
