-- =============================================================================
-- 0007_views.sql
-- Every view is security_invoker = true, so the RLS policies on the base tables
-- still apply. A view must never be a hole in the fence.
-- =============================================================================

drop view if exists public.v_leave_liability  cascade;
drop view if exists public.v_team_coverage    cascade;
drop view if exists public.v_out_today        cascade;
drop view if exists public.v_absence_calendar cascade;
drop view if exists public.v_pending_approvals cascade;
drop view if exists public.v_leave_balances   cascade;

-- -----------------------------------------------------------------------------
-- v_leave_balances
-- The Entitle -> Carry forward -> Adjustment -> Total -> Taken -> Available
-- chain from the original workbook, one row per employee x leave type x year.
-- Pending is reported separately from taken: staff must be able to tell
-- "gone" from "asked for".
-- -----------------------------------------------------------------------------
create view public.v_leave_balances with (security_invoker = true) as
select
  e.id                                as employee_id,
  e.staff_code,
  e.full_name,
  e.department,
  e.supervisor_id,
  e.employment_status,
  ent.leave_type_code,
  lt.name_en,
  lt.parent_code,
  lt.unit,
  lt.display_order,
  lt.is_paid,
  lt.counts_against_balance,
  ent.leave_year,
  ent.base_days,
  ent.prorated_days,
  ent.carry_forward_days,
  ent.adjustment_days,
  ent.adjustment_reason,
  ent.total_days                      as entitled_days,
  coalesce(agg.taken_days, 0)         as taken_days,
  coalesce(agg.pending_days, 0)       as pending_days,
  coalesce(agg.draft_days, 0)         as draft_days,
  app_private.fn_expired_carry_forward(e.id, ent.leave_type_code, ent.leave_year)
                                      as expired_carry_forward_days,
  (ent.total_days
     - coalesce(agg.taken_days, 0)
     - coalesce(agg.pending_days, 0)
     - app_private.fn_expired_carry_forward(e.id, ent.leave_type_code, ent.leave_year)
  )::numeric(6,2)                     as available_days,
  case
    when ent.total_days > 0
      then round(coalesce(agg.taken_days, 0) / ent.total_days * 100, 1)
    else 0
  end                                 as utilization_pct
from public.entitlements ent
join public.employees   e  on e.id   = ent.employee_id
join public.leave_types lt on lt.code = ent.leave_type_code
left join lateral (
  select
    sum(r.days_requested) filter (where r.status = 'approved')                          as taken_days,
    sum(r.days_requested) filter (where r.status in ('pending_supervisor', 'pending_hr')) as pending_days,
    sum(r.days_requested) filter (where r.status = 'draft')                             as draft_days
  from public.leave_requests r
  where r.employee_id     = ent.employee_id
    and r.leave_type_code = ent.leave_type_code
    and r.leave_year      = ent.leave_year
) agg on true;

comment on view public.v_leave_balances is
  'Balance chain per employee x leave type x year. Never SUM available_days across '
  'rows with different units - working days and calendar days are not the same quantity.';

-- -----------------------------------------------------------------------------
-- v_pending_approvals
-- -----------------------------------------------------------------------------
create view public.v_pending_approvals with (security_invoker = true) as
select
  r.id                       as request_id,
  r.request_ref,
  r.status,
  r.employee_id,
  e.full_name                as employee_name,
  e.staff_code,
  e.department,
  r.supervisor_id,
  s.full_name                as supervisor_name,
  r.leave_type_code,
  lt.name_en                 as leave_type_name,
  lt.unit,
  r.start_date,
  r.end_date,
  r.start_portion,
  r.end_portion,
  r.days_requested,
  r.reason,
  r.handover_notes,
  r.contact_while_away,
  r.attachment_path,
  r.submitted_at,
  greatest((current_date - r.submitted_at::date), 0) as days_waiting,
  case
    when greatest((current_date - r.submitted_at::date), 0) <= 2  then '0-2 days'
    when greatest((current_date - r.submitted_at::date), 0) <= 5  then '3-5 days'
    when greatest((current_date - r.submitted_at::date), 0) <= 10 then '6-10 days'
    else '>10 days'
  end                        as aging_bucket,
  public.fn_approvable_balance(r.employee_id, r.leave_type_code, r.leave_year, r.id)
                             as balance_before_approval,
  (public.fn_approvable_balance(r.employee_id, r.leave_type_code, r.leave_year, r.id)
     - r.days_requested)::numeric(6,2) as balance_after_approval
from public.leave_requests r
join public.employees   e  on e.id   = r.employee_id
join public.leave_types lt on lt.code = r.leave_type_code
left join public.employees s on s.id = r.supervisor_id
where r.status in ('pending_supervisor', 'pending_hr');

-- -----------------------------------------------------------------------------
-- v_absence_calendar
-- One row per employee per calendar date. Feeds the calendar grid, the
-- "who else is off then" clash warning, and the coverage model.
-- -----------------------------------------------------------------------------
create view public.v_absence_calendar with (security_invoker = true) as
select
  r.id                    as request_id,
  r.request_ref,
  r.employee_id,
  e.full_name,
  e.staff_code,
  e.department,
  e.supervisor_id,
  r.leave_type_code,
  lt.name_en              as leave_type_name,
  lt.unit,
  r.status,
  d::date                 as absence_date,
  r.start_date,
  r.end_date,
  (r.end_date + 1)        as return_date,
  case
    when d::date = r.start_date and r.start_portion <> 'full_day' then r.start_portion
    when d::date = r.end_date   and r.end_portion   <> 'full_day' then r.end_portion
    else 'full_day'::day_portion
  end                     as day_portion,
  (extract(isodow from d) < 6
    and not exists (
      select 1 from public.public_holidays h
      where h.holiday_date = d::date and h.is_half_day = false
    ))                    as is_working_day
from public.leave_requests r
join public.employees   e  on e.id   = r.employee_id
join public.leave_types lt on lt.code = r.leave_type_code
cross join lateral generate_series(r.start_date::timestamp, r.end_date::timestamp, interval '1 day') d
where r.status in ('approved', 'pending_supervisor', 'pending_hr');

-- -----------------------------------------------------------------------------
-- v_out_today
-- -----------------------------------------------------------------------------
create view public.v_out_today with (security_invoker = true) as
select
  employee_id,
  full_name,
  staff_code,
  department,
  supervisor_id,
  leave_type_code,
  leave_type_name,
  day_portion,
  start_date,
  end_date,
  return_date
from public.v_absence_calendar
where absence_date = current_date
  and status = 'approved';

-- -----------------------------------------------------------------------------
-- v_team_coverage
-- Department headcount vs absentees, for a rolling window around today.
-- absent_pct above app_settings.coverage_risk_threshold is a coverage risk.
-- -----------------------------------------------------------------------------
create view public.v_team_coverage with (security_invoker = true) as
with cfg as (
  select coverage_risk_threshold from public.app_settings where id = 1
),
span as (
  select d::date as the_date
  from generate_series(
    (current_date - interval '30 days')::timestamp,
    (current_date + interval '120 days')::timestamp,
    interval '1 day'
  ) d
  where extract(isodow from d) < 6
),
dept as (
  select department, count(*)::int as headcount
  from public.employees
  where employment_status in ('active', 'on_probation')
    and department is not null
  group by department
)
select
  dept.department,
  span.the_date,
  dept.headcount,
  coalesce(a.absent_count, 0)                                            as absent_count,
  case when dept.headcount > 0
       then round(coalesce(a.absent_count, 0)::numeric / dept.headcount * 100, 1)
       else 0 end                                                        as absent_pct,
  (dept.headcount > 0
    and round(coalesce(a.absent_count, 0)::numeric / dept.headcount * 100, 1)
        > (select coverage_risk_threshold from cfg))                     as is_coverage_risk
from dept
cross join span
left join lateral (
  select count(distinct ac.employee_id) as absent_count
  from public.v_absence_calendar ac
  where ac.department   = dept.department
    and ac.absence_date = span.the_date
    and ac.status       = 'approved'
    and ac.is_working_day
) a on true;

-- -----------------------------------------------------------------------------
-- v_leave_liability
-- Unused ANNUAL days, per department and org-wide. Finance will ask.
-- Restricted to working_day units so nothing is added across incompatible units.
-- -----------------------------------------------------------------------------
create view public.v_leave_liability with (security_invoker = true) as
select
  coalesce(b.department, '(unassigned)')  as department,
  b.leave_year,
  count(*)::int                           as staff_count,
  sum(b.entitled_days)::numeric(10,2)     as entitled_days,
  sum(b.taken_days)::numeric(10,2)        as taken_days,
  sum(b.pending_days)::numeric(10,2)      as pending_days,
  sum(b.available_days)::numeric(10,2)    as unused_days,
  case when sum(b.entitled_days) > 0
       then round(sum(b.taken_days) / sum(b.entitled_days) * 100, 1)
       else 0 end                         as utilization_pct
from public.v_leave_balances b
where b.leave_type_code = 'ANNUAL'
  and b.employment_status in ('active', 'on_probation')
group by coalesce(b.department, '(unassigned)'), b.leave_year;

grant select on
  public.v_leave_balances,
  public.v_pending_approvals,
  public.v_absence_calendar,
  public.v_out_today,
  public.v_team_coverage,
  public.v_leave_liability
to authenticated;
