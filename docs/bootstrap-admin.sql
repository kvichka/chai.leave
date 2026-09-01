-- =============================================================================
-- Create the first administrator.
--
-- Chicken and egg: accounts are created by an administrator, so the first one
-- has to be made outside the application. Paste this into the Supabase SQL
-- editor (Dashboard -> SQL Editor -> New query), change the two values at the
-- top, and run it.
--
-- Note it does NOT call rpc_admin_create_employee. That function checks
-- app_private.fn_is_hr() explicitly, and the SQL editor has no signed-in user,
-- so the check fails no matter what privileges the connection has. It calls the
-- underlying helper instead — which is exactly why the helper has EXECUTE
-- revoked from every application role and can only be reached from a direct
-- database connection.
-- =============================================================================

do $$
declare
  -- ---- CHANGE THESE -------------------------------------------------------
  v_email    text := 'you@example.org';
  v_password text := 'ChangeMeOnFirstLogin1';   -- at least 10 characters
  v_name     text := 'Your Name';
  v_code     text := 'ADM-001';
  v_hired    date := '2024-01-15';              -- your real hire date: it drives pro-rating
  v_dept     text := 'Operations';
  v_position text := 'Data Analyst';
  -- -------------------------------------------------------------------------
  v_uid uuid;
begin
  -- Creates the sign-in account, or resets the password if it already exists.
  v_uid := app_private.upsert_auth_user(v_email, v_password);

  insert into public.employees (
    id, staff_code, full_name, email, position_title, department,
    hire_date, employment_status, role, must_change_password
  )
  values (
    v_uid, v_code, v_name, lower(btrim(v_email))::extensions.citext,
    v_position, v_dept, v_hired,
    'active', 'system_admin',
    true   -- forces a password change on first sign-in
  )
  on conflict (id) do update
    set role                 = 'system_admin',
        must_change_password = true;

  raise notice 'Administrator ready: % — sign in with the password above.', v_email;
end $$;

-- Give yourself entitlements for this leave year, so the balances are not empty.
-- fn_generate_entitlements is HR-only, so briefly present as the account just
-- created. The claim is transaction-local and disappears at commit.
do $$
declare
  v_email text := 'you@example.org';   -- same address as above
  v_uid   uuid;
begin
  select id into v_uid from public.employees where email::text = lower(btrim(v_email));

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'email', v_email, 'role', 'authenticated')::text,
    true
  );

  perform public.fn_generate_entitlements(extract(year from current_date)::smallint);
  raise notice 'Entitlements generated for %.', extract(year from current_date);
end $$;
