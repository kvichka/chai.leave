-- =============================================================================
-- 0011_password_auth.sql
--
-- Email + password authentication, administered entirely from inside the app.
-- No Google, no SSO, no identity provider to configure.
--
-- HR creates an account with a temporary password; the holder is forced to
-- change it before they can use anything.
--
-- NOTE ON THE APPROACH
-- Creating an auth user normally requires the service_role key, which must
-- never reach a browser. The usual answer is an Edge Function. These functions
-- instead write to auth.users from SECURITY DEFINER Postgres functions, which
-- keeps the privileged work server-side with no key to leak and no extra
-- deployment step.
--
-- That is a deliberate trade-off: writing to auth.users directly is not an
-- officially supported Supabase interface, and a future GoTrue release could
-- change the table shape underneath it. The column quirks it has to respect are
-- documented inline. If this ever becomes a system of record rather than a test
-- project, move this logic into an Edge Function using the admin API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Force a password change on first sign-in
-- -----------------------------------------------------------------------------
alter table public.employees
  add column if not exists must_change_password boolean not null default true;

comment on column public.employees.must_change_password is
  'True from account creation until the holder sets their own password. The app '
  'blocks every other screen while it is true.';

-- Existing rows predate the column and already have working passwords.
update public.employees set must_change_password = false where created_at < now();

-- -----------------------------------------------------------------------------
-- app_settings: minimum password length, so the rule lives in one place
-- -----------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists min_password_length smallint not null default 10;

-- -----------------------------------------------------------------------------
-- Shared helper: create or update a GoTrue user with a known password.
--
-- Two quirks are load-bearing:
--   1. confirmation_token, recovery_token, email_change and
--      email_change_token_new must be '' and never NULL. GoTrue reads them into
--      non-nullable Go strings; a NULL makes every sign-in fail with
--      "Database error querying schema".
--   2. A matching auth.identities row is required before password sign-in is
--      accepted. Its column layout changed across GoTrue versions, so detect
--      which one this project is on rather than assuming.
-- -----------------------------------------------------------------------------
create or replace function app_private.upsert_auth_user(
  p_email    text,
  p_password text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id              uuid;
  v_has_provider_id boolean;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));

  if v_id is null then
    v_id := extensions.gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      created_at, updated_at
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      lower(btrim(p_email)),
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('email', lower(btrim(p_email))),
      '', '', '', '',
      now(), now()
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now()
     where id = v_id;
  end if;

  -- Identity row, required for the email provider.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  if v_has_provider_id then
    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    values (
      lower(btrim(p_email)), v_id,
      jsonb_build_object('sub', v_id::text, 'email', lower(btrim(p_email)),
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    )
    on conflict do nothing;
  else
    insert into auth.identities (
      id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    values (
      lower(btrim(p_email)), v_id,
      jsonb_build_object('sub', v_id::text, 'email', lower(btrim(p_email))),
      'email', now(), now(), now()
    )
    on conflict do nothing;
  end if;

  return v_id;
end;
$$;

revoke execute on function app_private.upsert_auth_user(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- rpc_admin_create_employee
--   HR creates the account and the staff record in one step, and hands the
--   temporary password to the person however they like.
-- -----------------------------------------------------------------------------
create or replace function public.rpc_admin_create_employee(
  p_email          text,
  p_temp_password  text,
  p_staff_code     text,
  p_full_name      text,
  p_hire_date      date,
  p_department     text default null,
  p_position_title text default null,
  p_supervisor_id  uuid default null,
  p_gender         text default null,
  p_full_name_kh   text default null,
  p_role           public.app_role default 'employee'
)
returns public.employees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_min    smallint;
  e        public.employees%rowtype;
begin
  if not app_private.fn_is_hr() then
    raise exception 'Only HR may create staff accounts.' using errcode = '42501';
  end if;

  if p_role <> 'employee' and not app_private.fn_is_system_admin() then
    raise exception 'Only a system administrator may create an account with the "%" role.', p_role
      using errcode = '42501';
  end if;

  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'A valid email address is required.' using errcode = 'P0001';
  end if;

  select min_password_length into v_min from public.app_settings where id = 1;
  if p_temp_password is null or length(p_temp_password) < coalesce(v_min, 10) then
    raise exception 'The temporary password must be at least % characters.', coalesce(v_min, 10)
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.employees x where lower(x.email::text) = lower(btrim(p_email))
  ) then
    raise exception '% already has a staff record.', p_email using errcode = 'P0001';
  end if;

  v_uid := app_private.upsert_auth_user(p_email, p_temp_password);

  insert into public.employees (
    id, staff_code, full_name, full_name_kh, email, position_title,
    department, supervisor_id, hire_date, gender, role, must_change_password
  )
  values (
    v_uid, p_staff_code, p_full_name, p_full_name_kh,
    lower(btrim(p_email))::extensions.citext,
    p_position_title, p_department, p_supervisor_id, p_hire_date, p_gender,
    p_role, true
  )
  returning * into e;

  return e;
end;
$$;

-- -----------------------------------------------------------------------------
-- rpc_admin_reset_password
--   For "I have forgotten my password". No email delivery involved: HR sets a
--   new temporary one and passes it on, and the holder must change it again.
-- -----------------------------------------------------------------------------
create or replace function public.rpc_admin_reset_password(
  p_employee_id   uuid,
  p_temp_password text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_min   smallint;
begin
  if not app_private.fn_is_hr() then
    raise exception 'Only HR may reset a password.' using errcode = '42501';
  end if;

  select min_password_length into v_min from public.app_settings where id = 1;
  if p_temp_password is null or length(p_temp_password) < coalesce(v_min, 10) then
    raise exception 'The temporary password must be at least % characters.', coalesce(v_min, 10)
      using errcode = 'P0001';
  end if;

  select x.email::text into v_email from public.employees x where x.id = p_employee_id;
  if v_email is null then
    raise exception 'No such employee.' using errcode = 'P0002';
  end if;

  perform app_private.upsert_auth_user(v_email, p_temp_password);

  update public.employees
     set must_change_password = true
   where id = p_employee_id;

  insert into public.audit_log (table_name, record_id, action, actor_id, actor_email, after_data)
  values ('employees', p_employee_id::text, 'PASSWORD_RESET',
          app_private.fn_current_employee_id(), app_private.current_email(),
          jsonb_build_object('reset_by_hr', true));
end;
$$;

-- -----------------------------------------------------------------------------
-- rpc_password_changed
--   Called by the app immediately after supabase.auth.updateUser() succeeds.
--   Clears the flag for the caller and nobody else.
-- -----------------------------------------------------------------------------
create or replace function public.rpc_password_changed()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := app_private.current_uid();
begin
  if v_me is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;

  update public.employees
     set must_change_password = false
   where id = v_me;

  insert into public.audit_log (table_name, record_id, action, actor_id, actor_email)
  values ('employees', v_me::text, 'PASSWORD_CHANGED', v_me, app_private.current_email());
end;
$$;

grant execute on function
  public.rpc_admin_create_employee(text, text, text, text, date, text, text, uuid, text, text, public.app_role),
  public.rpc_admin_reset_password(uuid, text),
  public.rpc_password_changed()
to authenticated;

-- -----------------------------------------------------------------------------
-- The old Google-era registration function assumed the person had already
-- signed in through an identity provider. Nothing does that any more.
-- -----------------------------------------------------------------------------
drop function if exists public.rpc_register_employee(text, text, text, date, text, text, uuid, text, text);
drop function if exists public.rpc_list_unregistered_users();
