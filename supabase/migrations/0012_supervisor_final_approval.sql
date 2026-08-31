-- =============================================================================
-- 0012_supervisor_final_approval.sql
--
-- The supervisor's decision is final. HR is informed, not asked.
--
-- Two-stage approval was the original design, but it puts HR on the critical
-- path of every request in the organisation for no decision they actually make
-- differently from the supervisor. The supervisor knows whether the team can
-- spare the person; HR needs the record, not the veto.
--
-- Nothing structural is removed. `leave_types.requires_hr_approval` still
-- exists per type, so a specific type can be put back through HR by setting it
-- to true — unpaid leave and maternity are the obvious candidates, since both
-- carry payroll and statutory consequences a supervisor should not decide
-- alone. The `pending_hr` status and rpc_hr_decision also stay, because an
-- employee with no supervisor on file still has to go somewhere.
-- =============================================================================

update public.leave_types
set requires_hr_approval = false
where requires_hr_approval;

-- -----------------------------------------------------------------------------
-- rpc_supervisor_decision
--   Unchanged except for the final-approval branch, which now tells HR what
--   happened. The balance re-check that used to sit at the HR stage moves with
--   it: this is now the last gate before days are committed, so it has to run
--   here or two requests that each fit the balance could both be approved.
-- -----------------------------------------------------------------------------
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

    -- The last gate before the days are committed, wherever that gate now sits.
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
    -- Tell the requester.
    perform app_private.notify(
      r.employee_id, r.id,
      case when p_approve then 'request_approved' else 'request_rejected' end,
      'Your ' || lt.name_en || ' request was '
        || case when p_approve then 'approved' else 'rejected' end,
      coalesce(nullif(btrim(p_comment), ''), null));

    -- And tell HR, for the record rather than for a decision. Only on approval:
    -- a rejection changes no balance and needs no payroll awareness.
    if p_approve then
      perform app_private.notify(
        h.id, r.id, 'approved_for_information',
        emp.full_name || ' was approved for ' || lt.name_en,
        app_private.fmt_days(r.days_requested) || ' day(s), '
          || to_char(r.start_date, 'DD Mon YYYY') || ' - '
          || to_char(r.end_date, 'DD Mon YYYY')
          || '. Approved by ' || coalesce(
               (select full_name from public.employees where id = v_me), 'their supervisor')
          || '. No action needed.')
      from public.employees h
      where h.role in ('hr_admin', 'system_admin')
        and h.employment_status in ('active', 'on_probation')
        -- Do not notify the approver about their own decision.
        and h.id <> v_me;
    end if;
  end if;

  return r;
end;
$$;

grant execute on function public.rpc_supervisor_decision(uuid, boolean, text) to authenticated;
