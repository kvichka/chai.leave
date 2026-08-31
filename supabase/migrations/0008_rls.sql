-- =============================================================================
-- 0008_rls.sql
-- The anon key is public. These policies are the entire access-control system.
-- Everything here is proved by /supabase/tests/rls_tests.sql.
-- =============================================================================

-- An employee needs to see their own supervisor's row so the app can name the
-- person who is holding their request. Nothing wider than that.
create or replace function app_private.fn_my_supervisor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.supervisor_id
  from public.employees e
  where e.id = app_private.current_uid();
$$;

grant execute on function app_private.fn_my_supervisor_id() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Table privileges. anon gets nothing at all: there is no public data here.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

grant select on public.leave_types, public.public_holidays, public.app_settings to authenticated;
grant select, insert, update, delete on public.employees      to authenticated;
grant select, insert, update, delete on public.entitlements    to authenticated;
grant select, insert, update, delete on public.leave_requests  to authenticated;
grant select, update                 on public.notifications   to authenticated;
grant insert, update, delete         on public.leave_types     to authenticated;
grant insert, update, delete         on public.public_holidays to authenticated;
grant update                         on public.app_settings    to authenticated;
grant select                         on public.audit_log       to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- request_ref_counters is touched only by fn_next_request_ref (SECURITY DEFINER).
revoke all on public.request_ref_counters from anon, authenticated;

-- =============================================================================
-- employees
-- =============================================================================
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    id = app_private.current_uid()
    or app_private.fn_is_hr()
    or app_private.fn_is_descendant_of(app_private.current_uid(), id)
    or id = app_private.fn_my_supervisor_id()
  );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (app_private.fn_is_hr());

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (app_private.fn_is_hr())
  with check (app_private.fn_is_hr());
  -- The `role` column is additionally locked to system_admin by
  -- app_private.trg_employee_guard. A column restriction in a policy alone is
  -- not enough, because USING/WITH CHECK cannot see which columns changed.

drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees
  for delete to authenticated
  using (app_private.fn_is_hr());

-- =============================================================================
-- leave_types / public_holidays / app_settings - readable by all, written by HR
-- =============================================================================
drop policy if exists leave_types_select on public.leave_types;
create policy leave_types_select on public.leave_types
  for select to authenticated using (true);

drop policy if exists leave_types_write on public.leave_types;
create policy leave_types_write on public.leave_types
  for all to authenticated
  using (app_private.fn_is_hr())
  with check (app_private.fn_is_hr());

drop policy if exists public_holidays_select on public.public_holidays;
create policy public_holidays_select on public.public_holidays
  for select to authenticated using (true);

drop policy if exists public_holidays_write on public.public_holidays;
create policy public_holidays_write on public.public_holidays
  for all to authenticated
  using (app_private.fn_is_hr())
  with check (app_private.fn_is_hr());

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for update to authenticated
  using (app_private.fn_is_system_admin())
  with check (app_private.fn_is_system_admin());

-- =============================================================================
-- entitlements
-- =============================================================================
drop policy if exists entitlements_select on public.entitlements;
create policy entitlements_select on public.entitlements
  for select to authenticated
  using (
    employee_id = app_private.current_uid()
    or app_private.fn_is_hr()
    or app_private.fn_is_descendant_of(app_private.current_uid(), employee_id)
  );

drop policy if exists entitlements_write on public.entitlements;
create policy entitlements_write on public.entitlements
  for all to authenticated
  using (app_private.fn_is_hr())
  with check (app_private.fn_is_hr());

-- =============================================================================
-- leave_requests
-- Content only. Every status transition goes through an rpc_ function, which is
-- SECURITY DEFINER and therefore not subject to these policies - and is in turn
-- policed by app_private.trg_leave_request_guard.
-- =============================================================================
drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (
    employee_id = app_private.current_uid()
    or app_private.fn_is_hr()
    or app_private.fn_is_descendant_of(app_private.current_uid(), employee_id)
  );

drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests
  for insert to authenticated
  with check (
    employee_id = app_private.current_uid()
    and status = 'draft'
  );

drop policy if exists leave_requests_update on public.leave_requests;
create policy leave_requests_update on public.leave_requests
  for update to authenticated
  using (employee_id = app_private.current_uid() and status = 'draft')
  with check (employee_id = app_private.current_uid() and status = 'draft');

drop policy if exists leave_requests_delete on public.leave_requests;
create policy leave_requests_delete on public.leave_requests
  for delete to authenticated
  using (employee_id = app_private.current_uid() and status = 'draft');

-- =============================================================================
-- notifications - your own bell, nobody else's
-- =============================================================================
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = app_private.current_uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = app_private.current_uid())
  with check (recipient_id = app_private.current_uid());

-- Only is_read / read_at may be changed by the recipient.
create or replace function app_private.trg_notification_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) - 'is_read' - 'read_at' is distinct from to_jsonb(old) - 'is_read' - 'read_at' then
    raise exception 'Only the read flag on a notification can be changed.' using errcode = '42501';
  end if;
  if new.is_read and old.is_read is distinct from new.is_read then
    new.read_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_guard on public.notifications;
create trigger trg_notification_guard
  before update on public.notifications
  for each row execute function app_private.trg_notification_guard();

-- =============================================================================
-- audit_log - readable by HR, written only by the audit trigger, never changed.
-- There is deliberately NO update or delete policy for any role.
-- =============================================================================
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (app_private.fn_is_hr());

revoke insert, update, delete on public.audit_log from anon, authenticated;

-- =============================================================================
-- Scoped team visibility.
--
-- The employees policy above deliberately does NOT let colleagues read each
-- other's rows - hire dates and the gender flag are nobody else's business.
-- But the clash warning and the team calendar have to work. This function is
-- the narrow, audited hole: names and dates only, no personal fields, scoped to
-- the caller's own department plus anyone beneath them in the reporting tree.
-- =============================================================================
create or replace function public.rpc_team_absences(
  p_start date,
  p_end   date
)
returns table (
  employee_id     uuid,
  full_name       text,
  department      text,
  leave_type_code text,
  leave_type_name text,
  status          leave_status,
  start_date      date,
  end_date        date,
  absence_date    date,
  day_portion     day_portion,
  is_self         boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select e.id, e.department
    from public.employees e
    where e.id = app_private.current_uid()
  )
  select
    ac.employee_id,
    ac.full_name,
    ac.department,
    ac.leave_type_code,
    ac.leave_type_name,
    ac.status,
    ac.start_date,
    ac.end_date,
    ac.absence_date,
    ac.day_portion,
    (ac.employee_id = (select id from me)) as is_self
  from public.v_absence_calendar ac
  where (select id from me) is not null
    and ac.absence_date between p_start and p_end
    and (
      app_private.fn_is_hr()
      or ac.employee_id = (select id from me)
      or ac.department is not distinct from (select department from me)
      or app_private.fn_is_descendant_of((select id from me), ac.employee_id)
    )
  order by ac.absence_date, ac.full_name;
$$;

grant execute on function public.rpc_team_absences(date, date) to authenticated;
