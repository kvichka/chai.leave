-- =============================================================================
-- 0005_triggers.sql
-- Integrity that RLS cannot express: derived columns, the status state machine,
-- role-escalation defense, supervisor cycles, and the append-only audit trail.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------
create or replace function app_private.trg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'leave_types', 'public_holidays', 'entitlements',
    'leave_requests', 'app_settings'
  ]
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function app_private.trg_set_updated_at()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Append-only audit trail
-- SECURITY DEFINER so the insert survives audit_log's deny-all write policy.
-- -----------------------------------------------------------------------------
create or replace function app_private.trg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_before    jsonb;
  v_after     jsonb;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
  elsif tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- Nothing of substance changed: skip the row rather than pad the log.
    if v_before - 'updated_at' = v_after - 'updated_at' then
      return coalesce(new, old);
    end if;
  end if;

  v_record_id := coalesce(v_after ->> 'id', v_before ->> 'id',
                          v_after ->> 'code', v_before ->> 'code',
                          v_after ->> 'holiday_date', v_before ->> 'holiday_date',
                          'unknown');

  insert into public.audit_log (
    table_name, record_id, action, actor_id, actor_email, before_data, after_data
  )
  values (
    tg_table_name,
    v_record_id,
    coalesce(nullif(current_setting('app.audit_action', true), ''), tg_op),
    app_private.current_uid(),
    app_private.current_email(),
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'leave_requests', 'entitlements', 'leave_types', 'public_holidays'
  ]
  loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on public.%I
         for each row execute function app_private.trg_audit()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- leave_requests: derived columns.
-- days_requested is ALWAYS recomputed. A client cannot set it, cannot shrink it,
-- and cannot round it in their own favour.
-- Named ..._10_... so it fires before the guard trigger below.
-- -----------------------------------------------------------------------------
create or replace function app_private.trg_leave_request_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.leave_year := public.fn_leave_year_of(new.start_date);

  new.days_requested := public.fn_compute_days(
    new.leave_type_code,
    new.start_date,
    new.end_date,
    new.start_portion,
    new.end_portion
  );

  if tg_op = 'INSERT' then
    if new.request_ref is null or btrim(new.request_ref) = '' then
      new.request_ref := public.fn_next_request_ref(new.leave_year);
    end if;
  else
    new.request_ref := old.request_ref;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leave_requests_10_compute on public.leave_requests;
create trigger trg_leave_requests_10_compute
  before insert or update on public.leave_requests
  for each row execute function app_private.trg_leave_request_compute();

-- -----------------------------------------------------------------------------
-- leave_requests: the state machine.
--
-- Every status transition and every approval field must come from one of the
-- rpc_ functions, which announce themselves with a transaction-local session
-- flag. Without this trigger the whole approval workflow is decorative:
-- an employee could simply UPDATE their own row to 'approved'.
-- -----------------------------------------------------------------------------
create or replace function app_private.trg_leave_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_in_workflow boolean := coalesce(current_setting('app.workflow_context', true), '') = 'on';
begin
  if v_in_workflow then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception
      'Leave request status cannot be changed directly. Use the approval actions.'
      using errcode = '42501';
  end if;

  if new.employee_id is distinct from old.employee_id then
    raise exception 'A leave request cannot be reassigned to another employee.'
      using errcode = '42501';
  end if;

  if new.submitted_at            is distinct from old.submitted_at
     or new.supervisor_id        is distinct from old.supervisor_id
     or new.supervisor_decision_at is distinct from old.supervisor_decision_at
     or new.supervisor_comment   is distinct from old.supervisor_comment
     or new.hr_id                is distinct from old.hr_id
     or new.hr_decision_at       is distinct from old.hr_decision_at
     or new.hr_comment           is distinct from old.hr_comment
     or new.cancelled_at         is distinct from old.cancelled_at
     or new.cancellation_reason  is distinct from old.cancellation_reason
  then
    raise exception 'Approval fields are set by the workflow, not by the client.'
      using errcode = '42501';
  end if;

  -- Content edits are only ever legal on a draft. RLS says the same thing;
  -- this is the belt to that pair of braces.
  if old.status <> 'draft' then
    raise exception 'Only a draft request can be edited. This request is %.', old.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leave_requests_20_guard on public.leave_requests;
create trigger trg_leave_requests_20_guard
  before update on public.leave_requests
  for each row execute function app_private.trg_leave_request_guard();

-- -----------------------------------------------------------------------------
-- employees: only a system_admin may change the role column, and nobody may
-- build a reporting cycle.
-- A column-level RLS restriction is not enough on its own, hence a trigger.
-- -----------------------------------------------------------------------------
create or replace function app_private.trg_employee_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if not app_private.fn_is_system_admin() then
      raise exception 'Only a system administrator may change a role.'
        using errcode = '42501';
    end if;
  end if;

  if new.supervisor_id is not null then
    if new.supervisor_id = new.id then
      raise exception 'An employee cannot supervise themselves.' using errcode = '23514';
    end if;

    if app_private.fn_would_cycle(new.id, new.supervisor_id) then
      raise exception
        'That supervisor reports (directly or indirectly) to this employee - it would create a loop.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_employee_guard on public.employees;
create trigger trg_employee_guard
  before insert or update on public.employees
  for each row execute function app_private.trg_employee_guard();

-- -----------------------------------------------------------------------------
-- entitlements: an adjustment must record who granted it and when.
-- -----------------------------------------------------------------------------
create or replace function app_private.trg_entitlement_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.adjustment_days is distinct from old.adjustment_days then
    if new.adjustment_days <> 0 then
      new.granted_by := coalesce(new.granted_by, app_private.fn_current_employee_id());
      new.granted_at := coalesce(new.granted_at, now());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_entitlement_stamp on public.entitlements;
create trigger trg_entitlement_stamp
  before insert or update on public.entitlements
  for each row execute function app_private.trg_entitlement_stamp();
