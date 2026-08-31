-- =============================================================================
-- 0006_rpc.sql
-- The workflow. Every status transition in the system happens here and nowhere
-- else. Each function re-derives the caller's identity, role and position in the
-- reporting tree from the JWT - a client-sent role is never trusted.
-- =============================================================================

-- Pretty day counts for error messages: 2.00 -> "2", 4.50 -> "4.5"
create or replace function app_private.fmt_days(p_days numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(coalesce(p_days, 0), 'FM9999999990.##');
$$;

-- Announce that we are inside an rpc_ function, which is what unlocks the
-- status columns for the guard trigger. Transaction-local: it evaporates when
-- the RPC's transaction ends.
create or replace function app_private.begin_workflow(p_action text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.workflow_context', 'on', true);
  if p_action is not null then
    perform set_config('app.audit_action', p_action, true);
  end if;
end;
$$;

create or replace function app_private.notify(
  p_recipient  uuid,
  p_request    uuid,
  p_event_type text,
  p_title      text,
  p_body       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then
    return;
  end if;

  insert into public.notifications (recipient_id, request_id, event_type, title, body)
  values (p_recipient, p_request, p_event_type, p_title, p_body)
  on conflict do nothing;
end;
$$;

-- The final gate before a request becomes 'approved'.
-- Re-run at the moment of approval, never at the moment of submission: a
-- request that fitted the balance three weeks ago may not fit it today because
-- a different request was approved in between. This is the single most common
-- bug in leave systems.
create or replace function app_private.assert_approvable(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.leave_requests%rowtype;
  lt        public.leave_types%rowtype;
  v_allow   boolean;
  v_avail   numeric;
begin
  select * into r from public.leave_requests where id = p_request_id;
  select * into lt from public.leave_types where code = r.leave_type_code;
  select allow_negative_balance into v_allow from public.app_settings where id = 1;

  if not lt.counts_against_balance or coalesce(v_allow, false) then
    return;
  end if;

  v_avail := public.fn_approvable_balance(r.employee_id, r.leave_type_code, r.leave_year, r.id);

  if r.days_requested > v_avail then
    raise exception
      'Cannot approve: this would exceed the balance. % has % day(s) of % left for %, and this request is for % day(s). Another request was most likely approved first.',
      (select full_name from public.employees where id = r.employee_id),
      app_private.fmt_days(v_avail),
      lt.name_en,
      r.leave_year,
      app_private.fmt_days(r.days_requested)
      using errcode = 'P0001';
  end if;
end;
$$;

-- =============================================================================
-- rpc_submit_request
-- =============================================================================
create or replace function public.rpc_submit_request(p_request_id uuid)
returns public.leave_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r            public.leave_requests%rowtype;
  lt           public.leave_types%rowtype;
  emp          public.employees%rowtype;
  cfg          public.app_settings%rowtype;
  v_me         uuid := app_private.current_uid();
  v_is_hr      boolean := app_private.fn_is_hr();
  v_days       numeric;
  v_avail      numeric;
  v_pending    integer;
  v_next       public.leave_status;
  v_overlap    text;
begin
  if v_me is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;

  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'That leave request no longer exists.' using errcode = 'P0002';
  end if;

  select * into cfg from public.app_settings where id = 1;
  select * into emp from public.employees where id = r.employee_id;
  select * into lt  from public.leave_types where code = r.leave_type_code;

  -- 1. ownership and state
  if r.employee_id <> v_me then
    raise exception 'You can only submit your own leave requests.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'This request has already been submitted (status: %).', r.status
      using errcode = 'P0001';
  end if;

  -- 2. employment status
  if emp.employment_status not in ('active', 'on_probation') then
    raise exception 'Leave cannot be requested while your employment status is "%".',
      emp.employment_status using errcode = 'P0001';
  end if;

  -- leave type must still be usable
  if not lt.is_active or not lt.is_requestable then
    raise exception '"%" is not available for new requests.', lt.name_en using errcode = 'P0001';
  end if;

  -- 9. gender-restricted types.
  -- Checked here, ahead of the balance test, so that a man requesting maternity
  -- leave is told the actual reason rather than "you have 0 days available".
  if lt.gender_restriction is not null and emp.gender is not null
     and lt.gender_restriction <> emp.gender then
    raise exception '% is not available for your staff record. Contact HR if this is wrong.',
      lt.name_en using errcode = 'P0001';
  end if;

  -- 3. date order
  if r.end_date < r.start_date then
    raise exception 'The end date cannot be before the start date.' using errcode = 'P0001';
  end if;

  -- 4. server-side day count
  v_days := public.fn_compute_days(r.leave_type_code, r.start_date, r.end_date,
                                   r.start_portion, r.end_portion);
  if v_days <= 0 then
    raise exception 'Selected dates contain no working days.' using errcode = 'P0001';
  end if;

  -- 12. half-days only where the leave type allows them
  if not lt.allows_half_day and (r.start_portion <> 'full_day' or r.end_portion <> 'full_day') then
    raise exception '% must be taken in whole days.', lt.name_en using errcode = 'P0001';
  end if;

  -- 5. no overlap with the caller's own live requests
  select string_agg(x.request_ref || ' (' || to_char(x.start_date, 'DD Mon YYYY')
                    || ' - ' || to_char(x.end_date, 'DD Mon YYYY') || ')', ', ')
    into v_overlap
  from public.leave_requests x
  where x.employee_id = r.employee_id
    and x.id <> r.id
    and x.status in ('draft', 'pending_supervisor', 'pending_hr', 'approved')
    and daterange(x.start_date, x.end_date + 1, '[)')
        && daterange(r.start_date, r.end_date + 1, '[)');

  if v_overlap is not null then
    raise exception 'These dates overlap another request of yours: %.', v_overlap
      using errcode = 'P0001';
  end if;

  -- 6. balance, with pending days reserved
  if lt.counts_against_balance and not cfg.allow_negative_balance then
    v_avail := public.fn_available_balance(r.employee_id, r.leave_type_code, r.leave_year, r.id);
    if v_days > v_avail then
      raise exception 'You have % day(s) of % available for %, but this request is for % day(s).',
        app_private.fmt_days(v_avail), lt.name_en, r.leave_year, app_private.fmt_days(v_days)
        using errcode = 'P0001';
    end if;
  end if;

  -- 7. notice period. Sick leave is exempt: retroactive sick leave is legitimate.
  if lt.code <> 'SICK' and not v_is_hr then
    if r.start_date < (current_date + coalesce(lt.min_notice_days, cfg.min_days_notice_default)) then
      raise exception '% needs % day(s) notice. The earliest start date you can request today is %.',
        lt.name_en,
        coalesce(lt.min_notice_days, cfg.min_days_notice_default),
        to_char(current_date + coalesce(lt.min_notice_days, cfg.min_days_notice_default), 'DD Mon YYYY')
        using errcode = 'P0001';
    end if;
  end if;

  -- 8. supporting document
  if lt.requires_attachment
     and v_days > coalesce(lt.attachment_after_days, 0)
     and (r.attachment_path is null or btrim(r.attachment_path) = '') then
    raise exception '% of more than % day(s) requires a supporting document.',
      lt.name_en, app_private.fmt_days(lt.attachment_after_days) using errcode = 'P0001';
  end if;

  -- 10. maximum consecutive days
  if lt.max_consecutive_days is not null and v_days > lt.max_consecutive_days then
    raise exception '% is limited to % consecutive day(s) per request.',
      lt.name_en, app_private.fmt_days(lt.max_consecutive_days) using errcode = 'P0001';
  end if;

  -- 11. pending-request cap
  select count(*) into v_pending
  from public.leave_requests x
  where x.employee_id = r.employee_id
    and x.status in ('pending_supervisor', 'pending_hr');

  if v_pending >= cfg.max_pending_per_employee then
    raise exception 'You already have % request(s) awaiting a decision. Wait for one to be decided before submitting another.',
      v_pending using errcode = 'P0001';
  end if;

  -- Transition
  v_next := case when emp.supervisor_id is null then 'pending_hr'::public.leave_status
                 else 'pending_supervisor'::public.leave_status end;

  perform app_private.begin_workflow('SUBMIT');

  update public.leave_requests
     set status        = v_next,
         submitted_at  = now(),
         supervisor_id = emp.supervisor_id
   where id = r.id
   returning * into r;

  if v_next = 'pending_supervisor' then
    perform app_private.notify(
      emp.supervisor_id, r.id, 'request_submitted',
      emp.full_name || ' requested ' || lt.name_en,
      app_private.fmt_days(r.days_requested) || ' day(s), '
        || to_char(r.start_date, 'DD Mon YYYY') || ' - ' || to_char(r.end_date, 'DD Mon YYYY'));
  else
    perform app_private.notify(
      h.id, r.id, 'request_submitted',
      emp.full_name || ' requested ' || lt.name_en || ' (no supervisor assigned)',
      app_private.fmt_days(r.days_requested) || ' day(s), '
        || to_char(r.start_date, 'DD Mon YYYY') || ' - ' || to_char(r.end_date, 'DD Mon YYYY'))
    from public.employees h
    where h.role in ('hr_admin', 'system_admin')
      and h.employment_status in ('active', 'on_probation');
  end if;

  return r;
end;
$$;

-- =============================================================================
-- rpc_supervisor_decision
-- =============================================================================
create or replace function public.rpc_supervisor_decision(
  p_request_id uuid,
  p_approve    boolean,
  p_comment    text default null
)
returns public.leave_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r        public.leave_requests%rowtype;
  lt       public.leave_types%rowtype;
  emp      public.employees%rowtype;
  v_me     uuid := app_private.current_uid();
  v_is_hr  boolean := app_private.fn_is_hr();
  v_next   public.leave_status;
begin
  if v_me is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;

  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'That leave request no longer exists.' using errcode = 'P0002';
  end if;

  select * into emp from public.employees where id = r.employee_id;
  select * into lt  from public.leave_types where code = r.leave_type_code;

  if r.status <> 'pending_supervisor' then
    raise exception 'This request is not awaiting a supervisor decision (status: %).', r.status
      using errcode = 'P0001';
  end if;

  -- Assigned supervisor, anyone above the employee in the tree, or HR as delegate.
  if not (
      r.supervisor_id = v_me
      or app_private.fn_is_descendant_of(v_me, r.employee_id)
      or v_is_hr
  ) then
    raise exception 'You are not in this employee''s reporting line.' using errcode = '42501';
  end if;

  if not p_approve and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'A reason is required when rejecting a request.' using errcode = 'P0001';
  end if;

  if p_approve then
    v_next := case when lt.requires_hr_approval then 'pending_hr'::public.leave_status
                   else 'approved'::public.leave_status end;

    -- Approving outright (no HR stage) is a final approval, so re-check here too.
    if v_next = 'approved' then
      perform app_private.assert_approvable(r.id);
    end if;
  else
    v_next := 'rejected';
  end if;

  perform app_private.begin_workflow(case when p_approve then 'APPROVE' else 'REJECT' end);

  update public.leave_requests
     set status                 = v_next,
         supervisor_id          = coalesce(supervisor_id, v_me),
         supervisor_decision_at = now(),
         supervisor_comment     = nullif(btrim(p_comment), '')
   where id = r.id
   returning * into r;

  if v_next = 'pending_hr' then
    perform app_private.notify(
      h.id, r.id, 'supervisor_approved',
      'HR approval needed: ' || emp.full_name || ' - ' || lt.name_en,
      app_private.fmt_days(r.days_requested) || ' day(s) from '
        || to_char(r.start_date, 'DD Mon YYYY'))
    from public.employees h
    where h.role in ('hr_admin', 'system_admin')
      and h.employment_status in ('active', 'on_probation');

    perform app_private.notify(
      r.employee_id, r.id, 'supervisor_approved',
      'Your ' || lt.name_en || ' request was approved by your supervisor',
      'It is now with HR for final approval.');
  else
    perform app_private.notify(
      r.employee_id, r.id,
      case when p_approve then 'request_approved' else 'request_rejected' end,
      'Your ' || lt.name_en || ' request was '
        || case when p_approve then 'approved' else 'rejected' end,
      coalesce(nullif(btrim(p_comment), ''), null));
  end if;

  return r;
end;
$$;

-- =============================================================================
-- rpc_hr_decision
-- =============================================================================
create or replace function public.rpc_hr_decision(
  p_request_id uuid,
  p_approve    boolean,
  p_comment    text default null
)
returns public.leave_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r    public.leave_requests%rowtype;
  lt   public.leave_types%rowtype;
  v_me uuid := app_private.current_uid();
begin
  if not app_private.fn_is_hr() then
    raise exception 'Only HR may take this decision.' using errcode = '42501';
  end if;

  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'That leave request no longer exists.' using errcode = 'P0002';
  end if;

  select * into lt from public.leave_types where code = r.leave_type_code;

  if r.status <> 'pending_hr' then
    raise exception 'This request is not awaiting an HR decision (status: %).', r.status
      using errcode = 'P0001';
  end if;

  if not p_approve and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'A reason is required when rejecting a request.' using errcode = 'P0001';
  end if;

  if p_approve then
    perform app_private.assert_approvable(r.id);
  end if;

  perform app_private.begin_workflow(case when p_approve then 'APPROVE' else 'REJECT' end);

  update public.leave_requests
     set status         = case when p_approve then 'approved'::public.leave_status
                               else 'rejected'::public.leave_status end,
         hr_id          = v_me,
         hr_decision_at = now(),
         hr_comment     = nullif(btrim(p_comment), '')
   where id = r.id
   returning * into r;

  perform app_private.notify(
    r.employee_id, r.id,
    case when p_approve then 'request_approved' else 'request_rejected' end,
    'Your ' || lt.name_en || ' request was '
      || case when p_approve then 'approved' else 'rejected' end || ' by HR',
    coalesce(nullif(btrim(p_comment), ''),
             app_private.fmt_days(r.days_requested) || ' day(s) from '
               || to_char(r.start_date, 'DD Mon YYYY')));

  if r.supervisor_id is not null then
    perform app_private.notify(
      r.supervisor_id, r.id, 'hr_decided',
      'HR ' || case when p_approve then 'approved' else 'rejected' end
        || ' a request you approved',
      (select full_name from public.employees where id = r.employee_id)
        || ' - ' || lt.name_en);
  end if;

  return r;
end;
$$;

-- =============================================================================
-- rpc_withdraw_request  (owner pulls back something still pending)
-- =============================================================================
create or replace function public.rpc_withdraw_request(
  p_request_id uuid,
  p_reason     text default null
)
returns public.leave_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r    public.leave_requests%rowtype;
  v_me uuid := app_private.current_uid();
begin
  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'That leave request no longer exists.' using errcode = 'P0002';
  end if;

  if r.employee_id <> v_me then
    raise exception 'You can only withdraw your own requests.' using errcode = '42501';
  end if;

  if r.status not in ('pending_supervisor', 'pending_hr') then
    raise exception 'Only a request awaiting a decision can be withdrawn (status: %).', r.status
      using errcode = 'P0001';
  end if;

  perform app_private.begin_workflow('WITHDRAW');

  update public.leave_requests
     set status              = 'withdrawn',
         cancelled_at        = now(),
         cancellation_reason = nullif(btrim(p_reason), '')
   where id = r.id
   returning * into r;

  perform app_private.notify(
    coalesce(r.supervisor_id, r.hr_id), r.id, 'request_withdrawn',
    (select full_name from public.employees where id = r.employee_id) || ' withdrew a leave request',
    r.request_ref);

  return r;
end;
$$;

-- =============================================================================
-- rpc_cancel_request
-- Restores the balance automatically, because both balance functions only ever
-- count rows in a live status.
-- =============================================================================
create or replace function public.rpc_cancel_request(
  p_request_id uuid,
  p_reason     text default null
)
returns public.leave_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r       public.leave_requests%rowtype;
  v_me    uuid := app_private.current_uid();
  v_is_hr boolean := app_private.fn_is_hr();
begin
  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'That leave request no longer exists.' using errcode = 'P0002';
  end if;

  if r.employee_id <> v_me and not v_is_hr then
    raise exception 'You can only cancel your own requests.' using errcode = '42501';
  end if;

  if r.status in ('cancelled', 'withdrawn', 'rejected') then
    raise exception 'This request is already %.', r.status using errcode = 'P0001';
  end if;

  if r.status = 'approved' and r.start_date <= current_date and not v_is_hr then
    raise exception
      'Leave that has already started cannot be cancelled here. Ask HR to adjust it.'
      using errcode = 'P0001';
  end if;

  perform app_private.begin_workflow('CANCEL');

  update public.leave_requests
     set status              = 'cancelled',
         cancelled_at        = now(),
         cancellation_reason = nullif(btrim(p_reason), '')
   where id = r.id
   returning * into r;

  if r.employee_id <> v_me then
    perform app_private.notify(
      r.employee_id, r.id, 'request_cancelled',
      'HR canceled your leave request ' || r.request_ref,
      nullif(btrim(p_reason), ''));
  else
    perform app_private.notify(
      coalesce(r.supervisor_id, r.hr_id), r.id, 'request_cancelled',
      (select full_name from public.employees where id = r.employee_id)
        || ' cancelled ' || r.request_ref,
      nullif(btrim(p_reason), ''));
  end if;

  return r;
end;
$$;

-- =============================================================================
-- Stale-approval sweeper.
-- Run daily (pg_cron, or the GitHub Action in .github/workflows/reminders.yml).
-- The partial unique index on notifications stops it re-nagging every day.
-- =============================================================================
create or replace function public.fn_notify_stale_approvals()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rec   record;
  v_count integer := 0;
begin
  for v_rec in
    select r.id, r.request_ref, r.supervisor_id, r.employee_id, r.submitted_at,
           e.full_name,
           public.fn_working_days(r.submitted_at::date, current_date) as waited
    from public.leave_requests r
    join public.employees e on e.id = r.employee_id
    where r.status in ('pending_supervisor', 'pending_hr')
      and r.submitted_at is not null
  loop
    if v_rec.waited > 3 and v_rec.supervisor_id is not null then
      perform app_private.notify(
        v_rec.supervisor_id, v_rec.id, 'reminder_supervisor_3d',
        'Still waiting: ' || v_rec.full_name || ' (' || v_rec.request_ref || ')',
        'Submitted ' || to_char(v_rec.submitted_at, 'DD Mon YYYY') || '.');
      v_count := v_count + 1;
    end if;

    if v_rec.waited > 5 then
      perform app_private.notify(
        h.id, v_rec.id, 'reminder_hr_5d',
        'Approval overdue: ' || v_rec.full_name || ' (' || v_rec.request_ref || ')',
        'Submitted ' || to_char(v_rec.submitted_at, 'DD Mon YYYY') || '.')
      from public.employees h
      where h.role in ('hr_admin', 'system_admin')
        and h.employment_status in ('active', 'on_probation');
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- =============================================================================
-- Employee onboarding helpers.
-- employees.id is an FK to auth.users, so a person must have signed in with
-- Google at least once before HR can register them. These two functions make
-- that a clear message rather than a foreign-key error.
-- =============================================================================
create or replace function public.rpc_list_unregistered_users()
returns table (user_id uuid, email text, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.last_sign_in_at
  from auth.users u
  left join public.employees e on e.id = u.id
  where e.id is null
    and app_private.fn_is_hr()
  order by u.last_sign_in_at desc nulls last;
$$;

create or replace function public.rpc_register_employee(
  p_email          text,
  p_staff_code     text,
  p_full_name      text,
  p_hire_date      date,
  p_department     text default null,
  p_position_title text default null,
  p_supervisor_id  uuid default null,
  p_gender         text default null,
  p_full_name_kh   text default null
)
returns public.employees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  e     public.employees%rowtype;
begin
  if not app_private.fn_is_hr() then
    raise exception 'Only HR may register employees.' using errcode = '42501';
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));

  if v_uid is null then
    raise exception
      '% has not signed in yet. Ask them to sign in with their CHAI Google account once, then register them.',
      p_email using errcode = 'P0001';
  end if;

  insert into public.employees (
    id, staff_code, full_name, full_name_kh, email, position_title,
    department, supervisor_id, hire_date, gender
  )
  values (
    v_uid, p_staff_code, p_full_name, p_full_name_kh, p_email::extensions.citext,
    p_position_title, p_department, p_supervisor_id, p_hire_date, p_gender
  )
  returning * into e;

  return e;
end;
$$;

grant execute on function
  public.rpc_submit_request(uuid),
  public.rpc_supervisor_decision(uuid, boolean, text),
  public.rpc_hr_decision(uuid, boolean, text),
  public.rpc_withdraw_request(uuid, text),
  public.rpc_cancel_request(uuid, text),
  public.rpc_list_unregistered_users(),
  public.rpc_register_employee(text, text, text, date, text, text, uuid, text, text)
to authenticated;

grant execute on function public.fn_notify_stale_approvals() to service_role;
revoke execute on function public.fn_notify_stale_approvals() from public, anon, authenticated;
