-- =============================================================================
-- 0014_normalize_text_fields.sql
--
-- A trailing space in employees.department split one team into two.
--
-- "Admin" and "Admin " are different strings, so they became two departments
-- everywhere the value is grouped or filtered: the department dropdown, the
-- annual-leave-utilization chart, the grouped balances table, and - the one
-- that actually matters - fn_team_coverage, where a two-person team counted as
-- two one-person teams and so could never breach the coverage threshold.
--
-- Nobody types a trailing space on purpose, and no screen can show the
-- difference. Fixing it in the application would leave the database able to
-- accept it again from the bulk importer or a direct SQL edit, so it is
-- normalized here, on the way in, for every writer.
-- =============================================================================

-- ---------------------------------------------------------------- backfill --
-- Collapse internal runs of whitespace too: "Global  Health" and
-- "Global Health" have the same problem for the same reason.
update public.employees
set department = nullif(regexp_replace(btrim(department), '\s+', ' ', 'g'), '')
where department is distinct from
      nullif(regexp_replace(btrim(department), '\s+', ' ', 'g'), '');

update public.employees
set position_title = nullif(regexp_replace(btrim(position_title), '\s+', ' ', 'g'), '')
where position_title is distinct from
      nullif(regexp_replace(btrim(position_title), '\s+', ' ', 'g'), '');

update public.employees
set full_name = regexp_replace(btrim(full_name), '\s+', ' ', 'g')
where full_name is distinct from regexp_replace(btrim(full_name), '\s+', ' ', 'g');

update public.employees
set staff_code = btrim(staff_code)
where staff_code is distinct from btrim(staff_code);

-- ------------------------------------------------------------- prevention --
create or replace function app_private.fn_normalize_employee_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An empty department is absence of information, not a department called "".
  -- nullif keeps it out of the grouping and filter lists.
  new.department     := nullif(regexp_replace(btrim(new.department),     '\s+', ' ', 'g'), '');
  new.position_title := nullif(regexp_replace(btrim(new.position_title), '\s+', ' ', 'g'), '');
  new.full_name      := regexp_replace(btrim(new.full_name),             '\s+', ' ', 'g');
  new.full_name_kh   := nullif(btrim(new.full_name_kh), '');
  new.staff_code     := btrim(new.staff_code);
  return new;
end;
$$;

comment on function app_private.fn_normalize_employee_text() is
  'Trims and collapses whitespace in the employee text fields that are grouped '
  'or filtered on. A trailing space in department once split one team into two '
  'across every chart and the coverage-risk calculation.';

-- Runs before trg_employee_guard: alphabetical order within the same timing,
-- and the guard should validate the value that will actually be stored.
drop trigger if exists trg_employee_normalize on public.employees;
create trigger trg_employee_normalize
  before insert or update on public.employees
  for each row execute function app_private.fn_normalize_employee_text();

revoke execute on function app_private.fn_normalize_employee_text() from public, anon, authenticated;
