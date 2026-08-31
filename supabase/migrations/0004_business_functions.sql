-- =============================================================================
-- 0004_business_functions.sql
-- All leave arithmetic. The client never computes a day count or a balance;
-- it asks these functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Leave-year boundaries
-- -----------------------------------------------------------------------------
create or replace function public.fn_leave_year_start(p_leave_year smallint)
returns date
language sql
stable
set search_path = ''
as $$
  select make_date(p_leave_year::int, s.leave_year_start_month::int, 1)
  from public.app_settings s
  where s.id = 1;
$$;

create or replace function public.fn_leave_year_end(p_leave_year smallint)
returns date
language sql
stable
set search_path = ''
as $$
  select (public.fn_leave_year_start(p_leave_year) + interval '1 year' - interval '1 day')::date;
$$;

-- Which leave year does a given date fall in?
create or replace function public.fn_leave_year_of(p_date date)
returns smallint
language sql
stable
set search_path = ''
as $$
  select case
    when extract(month from p_date)::int >= s.leave_year_start_month
      then extract(year from p_date)::smallint
    else (extract(year from p_date)::int - 1)::smallint
  end
  from public.app_settings s
  where s.id = 1;
$$;

-- -----------------------------------------------------------------------------
-- fn_working_days
--   Mon-Fri between p_start and p_end inclusive,
--   minus every public holiday in range that falls on a weekday
--     (0.5 for a half-day holiday),
--   minus 0.5 when the start is a part-day,
--   minus 0.5 when the end is a part-day AND the range is longer than one day.
--   A single-day part-day request therefore returns exactly 0.5.
-- -----------------------------------------------------------------------------
create or replace function public.fn_working_days(
  p_start          date,
  p_end            date,
  p_start_portion  day_portion default 'full_day',
  p_end_portion    day_portion default 'full_day'
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_days              numeric := 0;
  v_holidays          numeric := 0;
  v_start_chargeable  boolean;
  v_end_chargeable    boolean;
begin
  if p_start is null or p_end is null or p_end < p_start then
    return 0;
  end if;

  select count(*)::numeric
    into v_days
  from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') d
  where extract(isodow from d) < 6;

  select coalesce(sum(case when h.is_half_day then 0.5 else 1 end), 0)
    into v_holidays
  from public.public_holidays h
  where h.holiday_date between p_start and p_end
    and extract(isodow from h.holiday_date) < 6;

  v_days := v_days - v_holidays;

  -- A part-day marker only removes half a day if that day was chargeable to
  -- begin with. Marking "afternoon" on a Saturday must not create -0.5.
  v_start_chargeable := extract(isodow from p_start) < 6
    and not exists (
      select 1 from public.public_holidays h
      where h.holiday_date = p_start and h.is_half_day = false
    );

  v_end_chargeable := extract(isodow from p_end) < 6
    and not exists (
      select 1 from public.public_holidays h
      where h.holiday_date = p_end and h.is_half_day = false
    );

  if p_start_portion <> 'full_day' and v_start_chargeable then
    v_days := v_days - 0.5;
  end if;

  if p_end_portion <> 'full_day' and p_end <> p_start and v_end_chargeable then
    v_days := v_days - 0.5;
  end if;

  return greatest(v_days, 0)::numeric(6,2);
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_calendar_days
--   Inclusive day count. Weekends and holidays are deliberately NOT excluded:
--   maternity and unpaid leave run continuously.
-- -----------------------------------------------------------------------------
create or replace function public.fn_calendar_days(p_start date, p_end date)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start is null or p_end is null or p_end < p_start then 0::numeric(6,2)
    else ((p_end - p_start) + 1)::numeric(6,2)
  end;
$$;

-- -----------------------------------------------------------------------------
-- fn_compute_days
--   The ONLY place days_requested is ever derived. Dispatches on leave_types.unit.
-- -----------------------------------------------------------------------------
create or replace function public.fn_compute_days(
  p_leave_type     text,
  p_start          date,
  p_end            date,
  p_start_portion  day_portion default 'full_day',
  p_end_portion    day_portion default 'full_day'
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  -- Schema-qualified: this function runs with search_path = '', so pg_catalog
  -- resolves but public does not.
  v_unit public.leave_unit;
begin
  select lt.unit into v_unit
  from public.leave_types lt
  where lt.code = p_leave_type;

  if v_unit is null then
    raise exception 'Unknown leave type "%".', p_leave_type
      using errcode = '23503';
  end if;

  if v_unit = 'calendar_day' then
    return public.fn_calendar_days(p_start, p_end);
  end if;

  return public.fn_working_days(p_start, p_end, p_start_portion, p_end_portion);
end;
$$;

-- Read-only wrapper the request form calls for its live day count, so the
-- client and the server can never disagree about the number.
create or replace function public.rpc_preview_days(
  p_leave_type     text,
  p_start          date,
  p_end            date,
  p_start_portion  day_portion default 'full_day',
  p_end_portion    day_portion default 'full_day'
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.fn_compute_days(p_leave_type, p_start, p_end, p_start_portion, p_end_portion);
$$;

-- -----------------------------------------------------------------------------
-- fn_prorate_entitlement
--   Prior-year hires with no exit get the full entitlement - the source
--   spreadsheet pro-rated them by mistake.
--   Mid-year joiners AND mid-year leavers are pro-rated on the portion of the
--   leave year actually employed. Both methods round to the nearest half day.
-- -----------------------------------------------------------------------------
create or replace function public.fn_prorate_entitlement(
  p_hire_date  date,
  p_leave_year smallint,
  p_base_days  numeric,
  p_exit_date  date default null
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_method     text;
  v_ystart     date;
  v_yend       date;
  v_start      date;
  v_end        date;
  v_months     numeric;
  v_days_emp   numeric;
  v_days_year  numeric;
  v_age        interval;
  v_result     numeric;
begin
  if p_base_days is null or p_base_days <= 0 or p_hire_date is null then
    return 0::numeric(6,2);
  end if;

  select s.prorate_method into v_method from public.app_settings s where s.id = 1;
  v_method := coalesce(v_method, 'monthly_accrual');

  v_ystart := public.fn_leave_year_start(p_leave_year);
  v_yend   := public.fn_leave_year_end(p_leave_year);

  v_start := greatest(p_hire_date, v_ystart);
  v_end   := least(coalesce(p_exit_date, v_yend), v_yend);

  -- Employed for none of this leave year.
  if v_end < v_start then
    return 0::numeric(6,2);
  end if;

  -- Employed for the whole leave year: no pro-rating at all.
  if p_hire_date <= v_ystart and (p_exit_date is null or p_exit_date >= v_yend) then
    return (round(p_base_days * 2) / 2)::numeric(6,2);
  end if;

  if v_method = 'daily_365' then
    v_days_emp  := (v_end - v_start) + 1;
    v_days_year := (v_yend - v_ystart) + 1;
    v_result    := p_base_days * (v_days_emp / v_days_year);
  else
    -- monthly_accrual: (base / 12) x completed whole months employed in the year
    v_age    := age((v_end + 1)::date, v_start);
    v_months := (extract(year from v_age) * 12) + extract(month from v_age);
    v_result := (p_base_days / 12) * v_months;
  end if;

  return (round(v_result * 2) / 2)::numeric(6,2);
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_next_request_ref  ('LR-2026-0001')
--   Atomic: the upsert takes a row lock, so two concurrent submissions cannot
--   claim the same reference.
-- -----------------------------------------------------------------------------
create or replace function public.fn_next_request_ref(p_leave_year smallint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  insert into public.request_ref_counters (leave_year, last_value)
  values (p_leave_year, 1)
  on conflict (leave_year)
    do update set last_value = public.request_ref_counters.last_value + 1
  returning last_value into v_next;

  return 'LR-' || p_leave_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Carry-forward expiry
--   ANNUAL carry-forward expires 31 March (leave_types.carry_forward_expiry_month).
--   Convention, documented in the README: carry-forward is consumed FIRST.
--   After the expiry date, any carry-forward not already used by leave starting
--   on or before that date drops out of the pool.
-- -----------------------------------------------------------------------------
create or replace function app_private.fn_expired_carry_forward(
  p_employee_id  uuid,
  p_leave_type   text,
  p_leave_year   smallint
)
returns numeric
language plpgsql
stable
-- SECURITY INVOKER on purpose. Called from security_invoker views (where RLS
-- must apply) and from SECURITY DEFINER RPCs (where it inherits the definer's
-- rights and sees everything). One definition, correct in both contexts.
security invoker
set search_path = ''
as $$
declare
  v_cf            numeric;
  v_expiry_month  smallint;
  v_expiry        date;
  v_used          numeric;
begin
  select e.carry_forward_days, lt.carry_forward_expiry_month
    into v_cf, v_expiry_month
  from public.entitlements e
  join public.leave_types lt on lt.code = e.leave_type_code
  where e.employee_id = p_employee_id
    and e.leave_type_code = p_leave_type
    and e.leave_year = p_leave_year;

  if v_cf is null or v_cf <= 0 or v_expiry_month is null then
    return 0;
  end if;

  v_expiry := (make_date(p_leave_year::int, v_expiry_month::int, 1)
               + interval '1 month' - interval '1 day')::date;

  if current_date <= v_expiry then
    return 0;
  end if;

  select coalesce(sum(r.days_requested), 0)
    into v_used
  from public.leave_requests r
  where r.employee_id = p_employee_id
    and r.leave_type_code = p_leave_type
    and r.leave_year = p_leave_year
    and r.status in ('approved', 'pending_supervisor', 'pending_hr')
    and r.start_date <= v_expiry;

  return greatest(v_cf - least(v_cf, v_used), 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_available_balance
--   What the employee may still ASK for.
--   total_days - approved - pending(reserved) - expired carry-forward.
--   Draft days are NOT subtracted (the balance view reports them separately)
--   so that an over-booked plan is visible rather than silently blocking.
-- -----------------------------------------------------------------------------
create or replace function public.fn_available_balance(
  p_employee_id       uuid,
  p_leave_type        text,
  p_leave_year        smallint,
  p_exclude_request   uuid default null
)
returns numeric
language plpgsql
stable
-- SECURITY INVOKER: a caller can only ever aggregate rows RLS already lets them
-- read, so passing someone else's employee_id yields 0, never a leak.
security invoker
set search_path = ''
as $$
declare
  v_total    numeric := 0;
  v_used     numeric := 0;
  v_expired  numeric := 0;
begin
  select coalesce(e.total_days, 0) into v_total
  from public.entitlements e
  where e.employee_id = p_employee_id
    and e.leave_type_code = p_leave_type
    and e.leave_year = p_leave_year;

  v_total := coalesce(v_total, 0);

  select coalesce(sum(r.days_requested), 0) into v_used
  from public.leave_requests r
  where r.employee_id = p_employee_id
    and r.leave_type_code = p_leave_type
    and r.leave_year = p_leave_year
    and r.status in ('approved', 'pending_supervisor', 'pending_hr')
    and (p_exclude_request is null or r.id <> p_exclude_request);

  v_expired := app_private.fn_expired_carry_forward(p_employee_id, p_leave_type, p_leave_year);

  return (v_total - v_used - v_expired)::numeric(6,2);
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_approvable_balance
--   What an approver may still GRANT right now: entitlement minus what is
--   already approved. Pending requests are deliberately NOT reserved here -
--   if they were, the first of two pending requests could never be approved.
--   This is the function that catches acceptance test D3.
-- -----------------------------------------------------------------------------
create or replace function public.fn_approvable_balance(
  p_employee_id     uuid,
  p_leave_type      text,
  p_leave_year      smallint,
  p_exclude_request uuid default null
)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_total    numeric := 0;
  v_approved numeric := 0;
  v_expired  numeric := 0;
begin
  select coalesce(e.total_days, 0) into v_total
  from public.entitlements e
  where e.employee_id = p_employee_id
    and e.leave_type_code = p_leave_type
    and e.leave_year = p_leave_year;

  v_total := coalesce(v_total, 0);

  select coalesce(sum(r.days_requested), 0) into v_approved
  from public.leave_requests r
  where r.employee_id = p_employee_id
    and r.leave_type_code = p_leave_type
    and r.leave_year = p_leave_year
    and r.status = 'approved'
    and (p_exclude_request is null or r.id <> p_exclude_request);

  v_expired := app_private.fn_expired_carry_forward(p_employee_id, p_leave_type, p_leave_year);

  return (v_total - v_approved - v_expired)::numeric(6,2);
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_generate_entitlements
--   Idempotent upsert of one row per active employee x requestable leave type.
--   NEVER overwrites carry_forward_days or adjustment_days once they are set.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- fn_carry_forward
--   Carries LEAST(unused, leave_types.max_carry_forward) from p_from_year into
--   p_from_year + 1 for every leave type that permits it.
-- -----------------------------------------------------------------------------
create or replace function public.fn_carry_forward(p_from_year smallint)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rec    record;
  v_unused numeric;
  v_carry  numeric;
  v_count  integer := 0;
  v_actor  uuid := app_private.fn_current_employee_id();
begin
  if not app_private.fn_is_hr() then
    raise exception 'Only HR may run carry-forward.' using errcode = '42501';
  end if;

  for v_rec in
    select ent.employee_id,
           ent.leave_type_code,
           ent.total_days,
           lt.max_carry_forward
    from public.entitlements ent
    join public.leave_types lt on lt.code = ent.leave_type_code
    where ent.leave_year = p_from_year
      and lt.max_carry_forward > 0
      and lt.is_active
  loop
    select v_rec.total_days - coalesce(sum(r.days_requested), 0)
      into v_unused
    from public.leave_requests r
    where r.employee_id = v_rec.employee_id
      and r.leave_type_code = v_rec.leave_type_code
      and r.leave_year = p_from_year
      and r.status = 'approved';

    v_carry := greatest(least(coalesce(v_unused, 0), v_rec.max_carry_forward), 0);

    if v_carry > 0 then
      insert into public.entitlements as ent (
        employee_id, leave_type_code, leave_year,
        base_days, prorated_days, carry_forward_days, granted_by, granted_at
      )
      select v_rec.employee_id,
             v_rec.leave_type_code,
             (p_from_year + 1)::smallint,
             lt.default_days,
             case
               when lt.is_prorated
                 then public.fn_prorate_entitlement(e.hire_date, (p_from_year + 1)::smallint, lt.default_days, e.exit_date)
               else lt.default_days
             end,
             v_carry,
             v_actor,
             now()
      from public.leave_types lt
      join public.employees e on e.id = v_rec.employee_id
      where lt.code = v_rec.leave_type_code
      on conflict (employee_id, leave_type_code, leave_year) do update
        set carry_forward_days = excluded.carry_forward_days,
            updated_at         = now();

      insert into public.audit_log (table_name, record_id, action, actor_id, actor_email, after_data)
      values ('entitlements', v_rec.employee_id::text, 'CARRY_FORWARD',
              v_actor, app_private.current_email(),
              jsonb_build_object(
                'leave_type_code', v_rec.leave_type_code,
                'from_year', p_from_year,
                'to_year', p_from_year + 1,
                'carried_days', v_carry
              ));

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function
  public.fn_working_days(date, date, day_portion, day_portion),
  public.fn_calendar_days(date, date),
  public.fn_compute_days(text, date, date, day_portion, day_portion),
  public.rpc_preview_days(text, date, date, day_portion, day_portion),
  public.fn_prorate_entitlement(date, smallint, numeric, date),
  public.fn_available_balance(uuid, text, smallint, uuid),
  public.fn_approvable_balance(uuid, text, smallint, uuid),
  public.fn_leave_year_of(date),
  public.fn_leave_year_start(smallint),
  public.fn_leave_year_end(smallint),
  public.fn_generate_entitlements(smallint, uuid),
  public.fn_carry_forward(smallint)
to authenticated, service_role;

grant execute on function
  app_private.fn_expired_carry_forward(uuid, text, smallint)
to authenticated, service_role;

revoke execute on function public.fn_next_request_ref(smallint) from public, anon, authenticated;
