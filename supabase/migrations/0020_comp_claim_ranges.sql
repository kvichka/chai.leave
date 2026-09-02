-- =============================================================================
-- 0020_comp_claim_ranges.sql
--
-- A compensation claim can cover more than one day.
--
-- The first version took a single date, which is wrong for the case it exists
-- to serve: a field visit is rarely one day. Somebody who worked Friday to
-- Sunday in Kampot had to file three separate claims, each needing its own
-- approval, which is tedious for them and noisy for their supervisor.
--
-- WHY AN EXCLUSION CONSTRAINT REPLACES THE UNIQUE ONE
--   unique (employee_id, worked_date) stopped the same day being claimed
--   twice, which is the obvious way to inflate a balance. With ranges that is
--   no longer enough: 1-3 August and 2-4 August do not collide on any single
--   column but overlap on the 2nd and 3rd.
--
--   An exclusion constraint over daterange does what the unique constraint was
--   for, correctly. It applies only to live claims, so a rejected or withdrawn
--   period can be claimed again - otherwise one mistaken claim would block
--   those dates permanently.
-- =============================================================================

alter table public.comp_leave_claims
  add column if not exists worked_to date;

-- Existing single-date claims become one-day ranges.
update public.comp_leave_claims
set worked_to = worked_date
where worked_to is null;

alter table public.comp_leave_claims
  alter column worked_to set not null;

comment on column public.comp_leave_claims.worked_date is
  'First day worked. Kept its original name so existing rows and queries '
  'still read correctly; worked_to is the last day.';
comment on column public.comp_leave_claims.worked_to is
  'Last day worked, inclusive. Equal to worked_date for a single day.';

-- ------------------------------------------------------------ constraints --
do $$ begin
  alter table public.comp_leave_claims
    add constraint comp_range_order check (worked_to >= worked_date);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.comp_leave_claims
    add constraint comp_to_not_future check (worked_to <= current_date);
exception when duplicate_object then null; end $$;

-- Days earned must stay plausible for the length of the period: at most two
-- per calendar day covered, and never more than a month in one claim.
alter table public.comp_leave_claims drop constraint if exists comp_days_sane;
do $$ begin
  alter table public.comp_leave_claims
    add constraint comp_days_sane check (
      days_earned > 0
      and days_earned <= least((worked_to - worked_date + 1) * 2, 30)
    );
exception when duplicate_object then null; end $$;

-- Out with the single-date rule, in with the overlap rule.
alter table public.comp_leave_claims drop constraint if exists comp_one_per_day;
do $$ begin
  alter table public.comp_leave_claims
    add constraint comp_no_overlap
    exclude using gist (
      employee_id with =,
      daterange(worked_date, worked_to, '[]') with &&
    )
    where (status in ('draft', 'pending_supervisor', 'pending_hr', 'approved'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- submit --
drop function if exists public.rpc_submit_comp_claim(date, numeric, text);

create or replace function public.rpc_submit_comp_claim(
  p_worked_from date,
  p_worked_to   date,
  p_days_earned numeric,
  p_reason      text
)
returns public.comp_leave_claims
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app_private.current_uid();
  emp    public.employees%rowtype;
  c      public.comp_leave_claims%rowtype;
  v_next public.leave_status;
  v_to   date := coalesce(p_worked_to, p_worked_from);
begin
  select * into emp from public.employees where id = v_uid;
  if emp.id is null then
    raise exception 'No staff record for the signed-in user.' using errcode = '42501';
  end if;
  if emp.employment_status not in ('active', 'on_probation') then
    raise exception 'Only active staff may claim compensation leave.' using errcode = 'P0001';
  end if;

  if v_to < p_worked_from then
    raise exception 'The last day worked cannot be before the first.' using errcode = 'P0001';
  end if;
  if v_to > current_date then
    raise exception 'That period is not over yet. Claim it once the days have been worked.'
      using errcode = 'P0001';
  end if;
  if p_worked_from < current_date - interval '365 days' then
    raise exception 'That period starts more than a year ago. Ask HR to record it instead.'
      using errcode = 'P0001';
  end if;

  -- Checked here as well as by the constraint, so the message names the dates
  -- rather than surfacing a constraint violation.
  if exists (
    select 1 from public.comp_leave_claims x
    where x.employee_id = v_uid
      and x.status in ('draft', 'pending_supervisor', 'pending_hr', 'approved')
      and daterange(x.worked_date, x.worked_to, '[]')
          && daterange(p_worked_from, v_to, '[]')
  ) then
    raise exception 'You have already claimed part of % to %.',
      to_char(p_worked_from, 'DD Mon'), to_char(v_to, 'DD Mon YYYY')
      using errcode = 'P0001';
  end if;

  v_next := case when emp.supervisor_id is null then 'pending_hr' else 'pending_supervisor' end;

  insert into public.comp_leave_claims (
    employee_id, worked_date, worked_to, days_earned, reason, status, leave_year,
    supervisor_id, submitted_at
  )
  values (
    v_uid, p_worked_from, v_to, p_days_earned, btrim(p_reason), v_next,
    public.fn_leave_year_of(p_worked_from),
    emp.supervisor_id, now()
  )
  returning * into c;

  if v_next = 'pending_supervisor' then
    perform app_private.notify(
      emp.supervisor_id, null, 'comp_claim_submitted',
      emp.full_name || ' claimed compensation leave',
      app_private.fmt_days(c.days_earned) || ' day(s) for working '
        || app_private.fmt_worked_period(c.worked_date, c.worked_to) || '. ' || c.reason);
  else
    perform app_private.notify(
      h.id, null, 'comp_claim_submitted',
      emp.full_name || ' claimed compensation leave (no supervisor assigned)',
      app_private.fmt_days(c.days_earned) || ' day(s) for working '
        || app_private.fmt_worked_period(c.worked_date, c.worked_to) || '. ' || c.reason)
    from public.employees h
    where h.role in ('hr_admin', 'system_admin')
      and h.employment_status in ('active', 'on_probation');
  end if;

  return c;
end;
$$;

revoke execute on function public.rpc_submit_comp_claim(date, date, numeric, text) from public, anon;
grant   execute on function public.rpc_submit_comp_claim(date, date, numeric, text) to authenticated;

-- ------------------------------------------------------- reads better --
create or replace function app_private.fmt_worked_period(p_from date, p_to date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_to is null or p_to = p_from then to_char(p_from, 'DD Mon YYYY')
    else to_char(p_from, 'DD Mon') || ' - ' || to_char(p_to, 'DD Mon YYYY')
  end;
$$;

-- The decision notification gains the same wording.
create or replace function public.rpc_comp_claim_decision(
  p_claim_id uuid,
  p_approve  boolean,
  p_note     text default null
)
returns public.comp_leave_claims
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.current_uid();
  c     public.comp_leave_claims%rowtype;
begin
  select * into c from public.comp_leave_claims where id = p_claim_id;
  if c.id is null then
    raise exception 'That claim no longer exists.' using errcode = 'P0001';
  end if;
  if c.status not in ('pending_supervisor', 'pending_hr') then
    raise exception 'That claim has already been decided (%).', c.status
      using errcode = 'P0001';
  end if;

  if c.employee_id = v_uid then
    raise exception 'You cannot decide your own claim.' using errcode = '42501';
  end if;
  if not (
    app_private.fn_is_hr()
    or app_private.fn_is_descendant_of(v_uid, c.employee_id)
  ) then
    raise exception 'Only this person''s reporting line or HR may decide this claim.'
      using errcode = '42501';
  end if;

  if not p_approve and length(coalesce(btrim(p_note), '')) = 0 then
    raise exception 'Give a reason when refusing a claim.' using errcode = 'P0001';
  end if;

  update public.comp_leave_claims
     set status        = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status,
         decided_by    = v_uid,
         decided_at    = now(),
         decision_note = nullif(btrim(p_note), '')
   where id = c.id
  returning * into c;

  perform app_private.fn_sync_comp_entitlement(c.employee_id, c.leave_year);

  perform app_private.notify(
    c.employee_id, null,
    case when p_approve then 'comp_claim_approved' else 'comp_claim_rejected' end,
    case when p_approve
         then 'Compensation leave approved: ' || app_private.fmt_days(c.days_earned) || ' day(s)'
         else 'Compensation leave claim declined' end,
    coalesce(c.decision_note,
      'For working ' || app_private.fmt_worked_period(c.worked_date, c.worked_to) || '.'));

  return c;
end;
$$;

revoke execute on function public.rpc_comp_claim_decision(uuid, boolean, text) from public, anon;
grant   execute on function public.rpc_comp_claim_decision(uuid, boolean, text) to authenticated;
