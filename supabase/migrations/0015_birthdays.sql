-- =============================================================================
-- 0015_birthdays.sql
--
-- Date of birth on the employee record, and birthdays on the shared calendar.
--
-- TWO PRIVACY DECISIONS ARE BAKED IN HERE, DELIBERATELY.
--
-- 1. The calendar shows the DAY AND MONTH ONLY. The year never leaves the
--    employees table. Publishing a full date of birth to the whole country
--    office would broadcast everyone's age, and a full DOB is also one of the
--    fields used to verify identity at a bank. Nobody needs the year to say
--    happy birthday.
--
-- 2. Staff can opt out, and HR can opt them out. employees.show_birthday
--    defaults to true because a birthday calendar with nobody on it is
--    pointless, but anyone who would rather not appear can be removed without
--    deleting the date HR holds on file.
--
-- WHY A FUNCTION AND NOT A VIEW
--   employees_select lets an ordinary employee read their own row and their
--   supervisor's, and nothing else. A birthday calendar has to show colleagues
--   in other teams, so it has to reach past that policy. Every view in this
--   database is security_invoker = true and that invariant is worth keeping,
--   so the widening happens in one SECURITY DEFINER function whose SELECT list
--   is the exact set of columns allowed out: name, department, month, day.
--   Nothing else can leak through it, however the caller queries.
-- =============================================================================

-- ------------------------------------------------------------------ column --
alter table public.employees
  add column if not exists date_of_birth date,
  add column if not exists show_birthday boolean not null default true;

-- A date of birth in the future is a typo; so is one implying an age of 100.
-- Cheap to check, and it catches the 2026-for-1926 slip at entry.
do $$ begin
  alter table public.employees
    add constraint employees_dob_sane
    check (
      date_of_birth is null
      or (date_of_birth > current_date - interval '100 years'
          and date_of_birth < current_date - interval '14 years')
    );
exception when duplicate_object then null; end $$;

comment on column public.employees.date_of_birth is
  'Full date of birth, HR-visible only. The shared birthday calendar exposes '
  'the day and month through rpc_birthdays and never the year.';

comment on column public.employees.show_birthday is
  'Opt-out for the shared birthday calendar. Does not affect the stored date.';

-- --------------------------------------------------------------- the reader --
create or replace function public.rpc_birthdays()
returns table (
  employee_id uuid,
  full_name   text,
  department  text,
  birth_month smallint,
  birth_day   smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.full_name,
    e.department,
    extract(month from e.date_of_birth)::smallint,
    extract(day   from e.date_of_birth)::smallint
  from public.employees e
  where e.date_of_birth is not null
    and e.show_birthday
    and e.employment_status = 'active'
  order by
    extract(month from e.date_of_birth),
    extract(day   from e.date_of_birth),
    e.full_name;
$$;

comment on function public.rpc_birthdays() is
  'Day and month of birth for active staff who have not opted out. Deliberately '
  'wider than the employees RLS policy so colleagues in other teams appear on '
  'the shared calendar; the year is never returned.';

revoke execute on function public.rpc_birthdays() from public, anon;
grant   execute on function public.rpc_birthdays() to authenticated;

-- ------------------------------------------------------ create with a DOB --
-- Added at the end of the parameter list with a default, so every existing
-- caller keeps working unchanged.
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
  p_role           public.app_role default 'employee',
  p_date_of_birth  date default null
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
    department, supervisor_id, hire_date, gender, role, must_change_password,
    date_of_birth
  )
  values (
    v_uid, p_staff_code, p_full_name, p_full_name_kh,
    lower(btrim(p_email))::extensions.citext,
    p_position_title, p_department, p_supervisor_id, p_hire_date, p_gender,
    p_role, true,
    p_date_of_birth
  )
  returning * into e;

  return e;
end;
$$;

revoke execute on function public.rpc_admin_create_employee(
  text, text, text, text, date, text, text, uuid, text, text, public.app_role, date
) from public, anon;
grant execute on function public.rpc_admin_create_employee(
  text, text, text, text, date, text, text, uuid, text, text, public.app_role, date
) to authenticated;
