-- =============================================================================
-- 0019_protect_earned_entitlements.sql
--
-- Fixes a data-loss bug introduced with compensation leave in 0018.
--
-- WHAT WENT WRONG
--   fn_generate_entitlements cross-joins every active, requestable leave type
--   and, on conflict, overwrites prorated_days with the type's default_days.
--   That is right for an annual allowance and catastrophic for an earned one:
--   COMP has default_days = 0, so the next time HR pressed "Generate
--   entitlements" every compensation day anybody had earned was silently set
--   to zero. Somebody who had already spent theirs was left on a negative
--   balance, which the app otherwise refuses to allow.
--
--   It also created an empty COMP row for all staff, putting a "0 of 0 days"
--   entry on everyone's balances.
--
-- THE FIX
--   A leave type now declares whether its entitlement is earned rather than
--   granted. The generator and the carry-forward skip earned types entirely,
--   because for those the claims are the source of truth and the entitlement
--   is only a running total of them.
--
--   A flag rather than "where code <> 'COMP'": if a second earned type is ever
--   added, the rule should already cover it instead of failing the same way.
-- =============================================================================

alter table public.leave_types
  add column if not exists is_claim_based boolean not null default false;

comment on column public.leave_types.is_claim_based is
  'True when the entitlement is earned through approved claims rather than '
  'granted as an annual allowance. fn_generate_entitlements and '
  'fn_carry_forward skip these: overwriting them would destroy earned days.';

update public.leave_types set is_claim_based = true where code = 'COMP';

-- ------------------------------------------------------------- generator --
create or replace function public.fn_generate_entitlements(
  p_leave_year  smallint,
  p_employee_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_actor uuid := app_private.fn_current_employee_id();
begin
  if not app_private.fn_is_hr() then
    raise exception 'Only HR may generate entitlements.' using errcode = '42501';
  end if;

  with target as (
    select e.id, e.hire_date, e.exit_date, e.gender
    from public.employees e
    where e.employment_status in ('active', 'on_probation')
      and (p_employee_id is null or e.id = p_employee_id)
  ),
  upserted as (
    insert into public.entitlements as ent (
      employee_id, leave_type_code, leave_year,
      base_days, prorated_days, granted_by, granted_at
    )
    select
      t.id,
      lt.code,
      p_leave_year,
      lt.default_days,
      case
        when lt.is_prorated then public.fn_prorate_entitlement(t.hire_date, p_leave_year, lt.default_days, t.exit_date)
        else lt.default_days
      end,
      v_actor,
      now()
    from target t
    cross join public.leave_types lt
    where lt.is_active
      and lt.is_requestable
      -- Earned entitlements are built from approved claims. Generating them
      -- would reset the total to the type's default of zero.
      and not lt.is_claim_based
      -- Do not hand a man a maternity entitlement row.
      and (lt.gender_restriction is null
           or t.gender is null
           or lt.gender_restriction = t.gender)
    on conflict (employee_id, leave_type_code, leave_year) do update
      set base_days     = excluded.base_days,
          prorated_days = excluded.prorated_days,
          updated_at    = now()
      -- carry_forward_days and adjustment_days are intentionally untouched.
    returning 1
  )
  select count(*) into v_count from upserted;

  insert into public.audit_log (table_name, record_id, action, actor_id, actor_email, after_data)
  values ('entitlements', coalesce(p_employee_id::text, 'ALL'), 'GENERATE',
          v_actor, app_private.current_email(),
          jsonb_build_object('leave_year', p_leave_year, 'rows', v_count));

  return v_count;
end;
$$;

-- ------------------------------------------------- note on carry forward --
-- fn_carry_forward is deliberately left alone. It already selects only types
-- with max_carry_forward > 0, and COMP is zero, so earned days cannot be
-- carried into next year - which is the correct behaviour anyway: a day earned
-- by working a Saturday in 2026 belongs to 2026. If a future earned type ever
-- sets max_carry_forward above zero, add "and not lt.is_claim_based" there.

-- ------------------------------------------------------------------ repair --
-- Rebuild every COMP entitlement from the claims, which were never damaged.
do $$
declare
  r record;
begin
  -- Rows the generator created for people who have never claimed anything.
  delete from public.entitlements ent
  where ent.leave_type_code = 'COMP'
    and not exists (
      select 1 from public.comp_leave_claims c
      where c.employee_id = ent.employee_id
        and c.leave_year  = ent.leave_year
        and c.status      = 'approved'
    );

  -- And restore the totals for everybody who has.
  for r in
    select distinct employee_id, leave_year
    from public.comp_leave_claims
    where status = 'approved'
  loop
    perform app_private.fn_sync_comp_entitlement(r.employee_id, r.leave_year::smallint);
  end loop;
end $$;
