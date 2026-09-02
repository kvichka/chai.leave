-- =============================================================================
-- 0018_compensation_leave.sql
--
-- Time off in lieu. Somebody works a weekend or a public holiday, claims the
-- day back, their supervisor approves it, and the day lands in a Compensation
-- Leave balance they can spend later like any other leave.
--
-- WHY THE EARNED DAYS LIVE IN entitlements.prorated_days
--   entitlements.total_days is a generated column,
--   prorated_days + carry_forward_days + adjustment_days, and v_leave_balances
--   reads it. Adding a fourth term would mean dropping and recreating both the
--   column and the view.
--
--   Not needed. For every other leave type, prorated_days is "the annual
--   allowance, reduced for a part-year joiner". Compensation leave has no
--   annual allowance: the days earned ARE the entitlement. So the COMP
--   entitlement's prorated_days is the sum of that person's approved claims,
--   which is honest rather than a workaround, feeds total_days for free, and
--   leaves adjustment_days available for the HR corrections it exists for.
--
--   The claims table stays the source of truth. The entitlement is a running
--   total, recomputed from the claims on every decision, so the two cannot
--   drift.
--
-- WHY A SEPARATE TABLE RATHER THAN A leave_requests ROW
--   A leave request spends a balance over a date range. A claim does the
--   opposite: it credits a balance for one day already worked. Sharing the
--   table would mean every balance query, trigger and status guard had to ask
--   which direction a row pointed. This way rpc_submit_request and the whole
--   approval chain stay untouched.
-- =============================================================================

-- ------------------------------------------------------------- leave type --
insert into public.leave_types (
  code, name_en, name_kh, description, unit, default_days,
  is_prorated, max_carry_forward, allows_half_day, requires_attachment,
  requires_hr_approval, min_notice_days, is_paid, counts_against_balance,
  is_requestable, is_active, display_order
)
values (
  'COMP', 'Compensation Leave', 'ការឈប់សម្រាកជំនួស',
  'Time off in lieu of hours worked outside normal working time. The balance '
    'is built from approved compensation claims, not an annual allowance.',
  'working_day', 0,
  false, 0, true, false,
  false, 0, true, true,
  true, true, 15
)
on conflict (code) do update
  set name_en                = excluded.name_en,
      unit                   = excluded.unit,
      is_prorated            = excluded.is_prorated,
      counts_against_balance = excluded.counts_against_balance,
      is_requestable         = excluded.is_requestable,
      is_active              = excluded.is_active;

-- ----------------------------------------------------------------- claims --
create table if not exists public.comp_leave_claims (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  worked_date   date not null,
  days_earned   numeric(4,2) not null,
  reason        text not null,
  status        public.leave_status not null default 'draft',
  leave_year    smallint not null,
  supervisor_id uuid references public.employees(id) on delete set null,
  decided_by    uuid references public.employees(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Half a day or a whole one, and nobody earns a week from a single date.
  constraint comp_days_sane check (days_earned > 0 and days_earned <= 2),
  -- A claim is for work already done. Claiming a future date would let someone
  -- build a balance from work they have not yet performed.
  constraint comp_not_future check (worked_date <= current_date),
  -- Saying which day was worked and why is the whole audit trail.
  constraint comp_reason_present check (length(btrim(reason)) >= 3),
  -- Only the states a claim can actually be in.
  constraint comp_status_allowed
    check (status in ('draft', 'pending_supervisor', 'pending_hr', 'approved', 'rejected', 'withdrawn')),
  -- One claim per person per worked day: stops the same Saturday being
  -- claimed twice, which is the obvious way to inflate a balance.
  constraint comp_one_per_day unique (employee_id, worked_date)
);

create index if not exists idx_comp_claims_employee
  on public.comp_leave_claims (employee_id, leave_year);
create index if not exists idx_comp_claims_open
  on public.comp_leave_claims (supervisor_id, status)
  where status in ('pending_supervisor', 'pending_hr');

comment on table public.comp_leave_claims is
  'Claims for time off in lieu. An approved claim credits the employee''s COMP '
  'entitlement for that leave year; see app_private.fn_sync_comp_entitlement.';

-- --------------------------------------------------- keep updated_at honest --
drop trigger if exists trg_comp_touch on public.comp_leave_claims;
create trigger trg_comp_touch
  before update on public.comp_leave_claims
  for each row execute function app_private.trg_set_updated_at();

-- Same append-only audit trail as every other table that matters.
drop trigger if exists trg_audit on public.comp_leave_claims;
create trigger trg_audit
  after insert or update or delete on public.comp_leave_claims
  for each row execute function app_private.trg_audit();

-- ------------------------------------------------------ the running total --
create or replace function app_private.fn_sync_comp_entitlement(
  p_employee uuid,
  p_year     smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_earned numeric(6,2);
begin
  select coalesce(sum(days_earned), 0)
    into v_earned
  from public.comp_leave_claims
  where employee_id = p_employee
    and leave_year  = p_year
    and status      = 'approved';

  -- No claims and no row: nothing to create. An empty COMP entitlement would
  -- put a "0 of 0 days" card on everybody's screen for no reason.
  if v_earned = 0 and not exists (
    select 1 from public.entitlements
    where employee_id = p_employee and leave_type_code = 'COMP' and leave_year = p_year
  ) then
    return;
  end if;

  insert into public.entitlements (
    employee_id, leave_type_code, leave_year, base_days, prorated_days, granted_at
  )
  values (p_employee, 'COMP', p_year, v_earned, v_earned, now())
  on conflict (employee_id, leave_type_code, leave_year) do update
    set base_days     = excluded.base_days,
        prorated_days = excluded.prorated_days,
        granted_at    = now();
end;
$$;

comment on function app_private.fn_sync_comp_entitlement(uuid, smallint) is
  'Recomputes the COMP entitlement from approved claims. The claims are the '
  'source of truth; this keeps the entitlement in step so v_leave_balances '
  'needs no special case.';

-- --------------------------------------------------------------- submit --
create or replace function public.rpc_submit_comp_claim(
  p_worked_date date,
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
  v_uid uuid := app_private.current_uid();
  emp   public.employees%rowtype;
  c     public.comp_leave_claims%rowtype;
  v_next public.leave_status;
begin
  select * into emp from public.employees where id = v_uid;
  if emp.id is null then
    raise exception 'No staff record for the signed-in user.' using errcode = '42501';
  end if;
  if emp.employment_status not in ('active', 'on_probation') then
    raise exception 'Only active staff may claim compensation leave.' using errcode = 'P0001';
  end if;

  if p_worked_date > current_date then
    raise exception 'That date is in the future. Claim the day after you have worked it.'
      using errcode = 'P0001';
  end if;
  -- A year to claim is generous; beyond that the balance is untrackable and
  -- the leave year it belongs to has closed.
  if p_worked_date < current_date - interval '365 days' then
    raise exception 'That date is more than a year ago. Ask HR to record it instead.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.comp_leave_claims
    where employee_id = v_uid and worked_date = p_worked_date
  ) then
    raise exception 'You have already claimed %.', to_char(p_worked_date, 'DD Mon YYYY')
      using errcode = 'P0001';
  end if;

  -- Same routing as a leave request: the supervisor decides, or HR when there
  -- is nobody above you.
  v_next := case when emp.supervisor_id is null then 'pending_hr' else 'pending_supervisor' end;

  insert into public.comp_leave_claims (
    employee_id, worked_date, days_earned, reason, status, leave_year,
    supervisor_id, submitted_at
  )
  values (
    v_uid, p_worked_date, p_days_earned, btrim(p_reason), v_next,
    public.fn_leave_year_of(p_worked_date),
    emp.supervisor_id, now()
  )
  returning * into c;

  if v_next = 'pending_supervisor' then
    perform app_private.notify(
      emp.supervisor_id, null, 'comp_claim_submitted',
      emp.full_name || ' claimed compensation leave',
      app_private.fmt_days(c.days_earned) || ' day(s) for working '
        || to_char(c.worked_date, 'DD Mon YYYY') || '. ' || c.reason);
  else
    perform app_private.notify(
      h.id, null, 'comp_claim_submitted',
      emp.full_name || ' claimed compensation leave (no supervisor assigned)',
      app_private.fmt_days(c.days_earned) || ' day(s) for working '
        || to_char(c.worked_date, 'DD Mon YYYY') || '. ' || c.reason)
    from public.employees h
    where h.role in ('hr_admin', 'system_admin')
      and h.employment_status in ('active', 'on_probation');
  end if;

  return c;
end;
$$;

-- ------------------------------------------------------------- decide --
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
  emp   public.employees%rowtype;
begin
  select * into c from public.comp_leave_claims where id = p_claim_id;
  if c.id is null then
    raise exception 'That claim no longer exists.' using errcode = 'P0001';
  end if;
  if c.status not in ('pending_supervisor', 'pending_hr') then
    raise exception 'That claim has already been decided (%).', c.status
      using errcode = 'P0001';
  end if;

  -- The decision belongs to the reporting line, or to HR. Deciding your own
  -- claim would make the approval meaningless.
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
     -- The cast is required: CASE yields text, and with search_path empty
     -- there is no implicit coercion to the enum.
     set status        = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status,
         decided_by    = v_uid,
         decided_at    = now(),
         decision_note = nullif(btrim(p_note), '')
   where id = c.id
  returning * into c;

  -- Only now, from the approved rows, is the balance recomputed.
  perform app_private.fn_sync_comp_entitlement(c.employee_id, c.leave_year);

  select * into emp from public.employees where id = c.employee_id;
  perform app_private.notify(
    c.employee_id, null,
    case when p_approve then 'comp_claim_approved' else 'comp_claim_rejected' end,
    case when p_approve
         then 'Compensation leave approved: ' || app_private.fmt_days(c.days_earned) || ' day(s)'
         else 'Compensation leave claim declined' end,
    coalesce(c.decision_note,
      'For working ' || to_char(c.worked_date, 'DD Mon YYYY') || '.'));

  return c;
end;
$$;

-- ----------------------------------------------------------- withdraw --
create or replace function public.rpc_withdraw_comp_claim(p_claim_id uuid)
returns void
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
  if c.employee_id <> v_uid then
    raise exception 'That is not your claim.' using errcode = '42501';
  end if;
  if c.status not in ('pending_supervisor', 'pending_hr') then
    raise exception 'Only a claim still awaiting a decision can be withdrawn.'
      using errcode = 'P0001';
  end if;

  update public.comp_leave_claims
     set status = 'withdrawn'::public.leave_status
   where id = c.id;
end;
$$;

-- -------------------------------------------------------------------- RLS --
alter table public.comp_leave_claims enable row level security;
grant select on public.comp_leave_claims to authenticated;

-- Same visibility rule as a leave request: yours, your reporting line's, or
-- everyone's if you are HR. Writes go only through the functions above.
drop policy if exists comp_claims_select on public.comp_leave_claims;
create policy comp_claims_select on public.comp_leave_claims
  for select to authenticated
  using (
    employee_id = app_private.current_uid()
    or app_private.fn_is_hr()
    or app_private.fn_is_descendant_of(app_private.current_uid(), employee_id)
  );

revoke execute on function app_private.fn_sync_comp_entitlement(uuid, smallint)
  from public, anon, authenticated;

revoke execute on function public.rpc_submit_comp_claim(date, numeric, text) from public, anon;
grant   execute on function public.rpc_submit_comp_claim(date, numeric, text) to authenticated;

revoke execute on function public.rpc_comp_claim_decision(uuid, boolean, text) from public, anon;
grant   execute on function public.rpc_comp_claim_decision(uuid, boolean, text) to authenticated;

revoke execute on function public.rpc_withdraw_comp_claim(uuid) from public, anon;
grant   execute on function public.rpc_withdraw_comp_claim(uuid) to authenticated;
