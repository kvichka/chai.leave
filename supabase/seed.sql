-- =============================================================================
-- seed.sql - CHAI Cambodia Leave Management
--
-- Sections:
--   1. Settings
--   2. Leave types            <- reference data, safe for production
--   3. Public holidays        <- SEE THE WARNING. Not authoritative.
--   4. Demo employees         <- DEVELOPMENT ONLY. Delete before go-live.
--   5. Demo leave requests    <- DEVELOPMENT ONLY.
--   6. Entitlement generation
--
-- Run with:  supabase db reset   (local Docker stack: migrations + this file)
--            npm run db:seed     (any database, via scripts/run-sql.mjs)
-- =============================================================================

-- =============================================================================
-- 1. SETTINGS
--
-- prorate_method is the decision HR must make, not the analyst.
--   'monthly_accrual' -> 1.5 days per completed month  -> 10.5 for a 1-Jun hire
--   'daily_365'       -> 18 x days/365, rounded to 0.5 -> 10.5 for a 1-Jun hire
-- Both are implemented. Show HR the two columns side by side and let them pick.
-- =============================================================================
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

update public.app_settings
set prorate_method           = 'monthly_accrual',
    leave_year_start_month   = 1,
    allow_negative_balance   = false,
    min_days_notice_default  = 0,
    max_pending_per_employee = 5,
    coverage_risk_threshold  = 30.00
where id = 1;

-- =============================================================================
-- 2. LEAVE TYPES
--
-- `unit` is the fix for the source workbook's row 9, where 21 working days
-- ("1 month") and 90 calendar days ("3 months") were added together. Nothing in
-- this application ever aggregates across the two units.
-- =============================================================================
insert into public.leave_types (
  code, parent_code, name_en, name_kh, description, unit, default_days,
  is_prorated, max_carry_forward, carry_forward_expiry_month, allows_half_day,
  requires_attachment, attachment_after_days, requires_hr_approval,
  min_notice_days, max_consecutive_days, gender_restriction, is_paid,
  counts_against_balance, is_requestable, is_active, display_order
) values
  ('ANNUAL', null, 'Annual Leave', 'ការឈប់សម្រាកប្រចាំឆ្នាំ',
   'Pro-rated from the hire date in the year of joining.',
   'working_day', 18, true, 5, 3, true,
   false, null, false, 3, null, null, true, true, true, true, 10),

  ('SICK', null, 'Sick Leave', 'ការឈប់សម្រាកព្យាបាលជំងឺ',
   'A medical certificate is required for more than two days. Retroactive requests are allowed.',
   'working_day', 5, false, 0, null, true,
   true, 2, false, 0, null, null, true, true, true, true, 20),

  ('LEARNING', null, 'Learning Day', 'ថ្ងៃសិក្សា',
   'Professional development, agreed with your supervisor in advance.',
   'working_day', 3, false, 0, null, false,
   false, null, false, 0, null, null, true, true, true, true, 30),

  ('MENTAL_HEALTH', null, 'Mental Health Day', 'ថ្ងៃសុខភាពផ្លូវចិត្ត',
   'No explanation required. No supporting document is ever requested.',
   'working_day', 1, false, 0, null, false,
   false, null, false, 0, null, null, true, true, true, true, 40),

  ('SPECIAL', null, 'Special Leave', 'ការឈប់សម្រាកពិសេស',
   'Category heading only. Choose one of the entries beneath it.',
   'working_day', 0, false, 0, null, false,
   false, null, false, 0, null, null, true, false, false, true, 50),

  ('SPECIAL_SIB_GP', 'SPECIAL', 'Special Leave - sibling or grandparent', null,
   'Bereavement or serious illness of a sibling or grandparent.',
   'working_day', 3, false, 0, null, false,
   false, null, false, 0, null, null, true, true, true, true, 51),

  ('SPECIAL_IMMEDIATE', 'SPECIAL', 'Special Leave - spouse, child, parent, parent-in-law', null,
   'Bereavement or serious illness of an immediate family member.',
   'working_day', 7, false, 0, null, false,
   false, null, false, 0, null, null, true, true, true, true, 52),

  ('PATERNITY', null, 'Paternity Leave', 'ការឈប់សម្រាកឪពុក',
   'Following the birth of a child.',
   'working_day', 7, false, 0, null, false,
   false, null, false, 0, null, 'M', true, true, true, true, 60),

  ('MATERNITY', null, 'Maternity Leave', 'ការឈប់សម្រាកមាតុភាព',
   'Ninety CALENDAR days, running continuously including weekends and holidays.',
   'calendar_day', 90, false, 0, null, false,
   false, null, false, 30, null, 'F', true, true, true, true, 70),

  ('MATERNITY_EXT', 'MATERNITY', 'Maternity Leave - additional month', null,
   'One additional month, counted in WORKING days.',
   'working_day', 21, false, 0, null, false,
   false, null, false, 30, null, 'F', true, true, true, true, 71),

  ('ADOPT_UNDER6', null, 'Adoption Leave - child 6 years or under', null,
   'Ninety CALENDAR days.',
   'calendar_day', 90, false, 0, null, false,
   true, 0, false, 30, null, null, true, true, true, true, 80),

  ('ADOPT_UNDER6_EXT', 'ADOPT_UNDER6', 'Adoption Leave - additional month', null,
   'One additional month, counted in WORKING days.',
   'working_day', 21, false, 0, null, false,
   false, null, false, 30, null, null, true, true, true, true, 81),

  ('ADOPT_OVER6', null, 'Adoption Leave - child over 6 years', null,
   'Forty-two WORKING days.',
   'working_day', 42, false, 0, null, false,
   true, 0, false, 30, null, null, true, true, true, true, 82),

  ('UNPAID', null, 'Leave Without Pay', 'ការឈប់សម្រាកគ្មានប្រាក់ឈ្នួល',
   'Unpaid. Ninety CALENDAR days maximum, requires HR approval.',
   'calendar_day', 90, false, 0, null, false,
   false, null, false, 30, 90, null, false, true, true, true, 90)
on conflict (code) do update set
  parent_code                = excluded.parent_code,
  name_en                    = excluded.name_en,
  name_kh                    = excluded.name_kh,
  description                = excluded.description,
  unit                       = excluded.unit,
  default_days               = excluded.default_days,
  is_prorated                = excluded.is_prorated,
  max_carry_forward          = excluded.max_carry_forward,
  carry_forward_expiry_month = excluded.carry_forward_expiry_month,
  allows_half_day            = excluded.allows_half_day,
  requires_attachment        = excluded.requires_attachment,
  attachment_after_days      = excluded.attachment_after_days,
  requires_hr_approval       = excluded.requires_hr_approval,
  min_notice_days            = excluded.min_notice_days,
  max_consecutive_days       = excluded.max_consecutive_days,
  gender_restriction         = excluded.gender_restriction,
  is_paid                    = excluded.is_paid,
  counts_against_balance     = excluded.counts_against_balance,
  is_requestable             = excluded.is_requestable,
  is_active                  = excluded.is_active,
  display_order              = excluded.display_order;

-- =============================================================================
-- 3. PUBLIC HOLIDAYS
--
--   *** THESE DATES ARE NOT AUTHORITATIVE. VERIFY BEFORE GO-LIVE. ***
--
-- Every date below must be checked against the official Royal Government of
-- Cambodia sub-decree on public holidays for the year in question, which is
-- published annually (typically in the preceding quarter).
--
-- Fixed-date holidays (1 Jan, 8 Mar, 1 May, 14 May, 18 Jun, 24 Sep, 15 Oct,
-- 29 Oct, 9 Nov) recur reliably.
--
-- The lunar holidays - Meak Bochea, Visak Bochea, Royal Ploughing Ceremony,
-- Pchum Ben and the Water Festival - move every year and the dates below are
-- ESTIMATES derived from the lunar calendar, NOT from a sub-decree. They are
-- seeded so the app has something to work with on day one. Replace them.
--
-- Getting these wrong silently over-counts or under-counts every piece of leave
-- that spans them, which is exactly the bug this system exists to remove.
-- Admin -> Public holidays has a bulk paste import for the corrected list.
-- =============================================================================
insert into public.public_holidays (holiday_date, name_en, name_kh, is_half_day) values
  -- ---- 2026 ----
  ('2026-01-01', 'International New Year Day', 'ទិវាចូលឆ្នាំសាកល', false),
  ('2026-03-03', 'Meak Bochea Day', 'ពិធីបុណ្យមាឃបូជា', false),                  -- LUNAR: estimate
  ('2026-03-08', 'International Women''s Day', 'ទិវានារីអន្តរជាតិ', false),
  ('2026-04-14', 'Khmer New Year (day 1)', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ', false),
  ('2026-04-15', 'Khmer New Year (day 2)', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ', false),
  ('2026-04-16', 'Khmer New Year (day 3)', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ', false),
  ('2026-05-01', 'International Labour Day', 'ទិវាពលកម្មអន្តរជាតិ', false),
  ('2026-05-14', 'Birthday of His Majesty King Norodom Sihamoni', 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្ម', false),
  ('2026-05-31', 'Visak Bochea Day', 'ពិធីបុណ្យវិសាខបូជា', false),                -- LUNAR: estimate
  ('2026-06-01', 'Royal Ploughing Ceremony', 'ព្រះរាជពិធីច្រត់ព្រះនង្គ័ល', false), -- LUNAR: estimate
  ('2026-06-18', 'Birthday of Her Majesty the Queen Mother', 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្មព្រះមហាក្សត្រី', false),
  ('2026-09-24', 'Constitution Day', 'ទិវាប្រកាសរដ្ឋធម្មនុញ្ញ', false),
  ('2026-10-10', 'Pchum Ben (day 1)', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ', false),               -- LUNAR: estimate
  ('2026-10-11', 'Pchum Ben (day 2)', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ', false),               -- LUNAR: estimate
  ('2026-10-12', 'Pchum Ben (day 3)', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ', false),               -- LUNAR: estimate
  ('2026-10-15', 'Commemoration Day of King Father Norodom Sihanouk', 'ទិវាប្រារព្ធពិធីរំលឹកព្រះវិញ្ញាណក្ខន្ធ', false),
  ('2026-10-29', 'Coronation Day of His Majesty King Norodom Sihamoni', 'ព្រះរាជពិធីគ្រងព្រះបរមរាជសម្បត្តិ', false),
  ('2026-11-09', 'Independence Day', 'ទិវាបុណ្យឯករាជ្យជាតិ', false),
  ('2026-11-23', 'Water Festival (day 1)', 'ព្រះរាជពិធីបុណ្យអុំទូក', false),        -- LUNAR: estimate
  ('2026-11-24', 'Water Festival (day 2)', 'ព្រះរាជពិធីបុណ្យអុំទូក', false),        -- LUNAR: estimate
  ('2026-11-25', 'Water Festival (day 3)', 'ព្រះរាជពិធីបុណ្យអុំទូក', false),        -- LUNAR: estimate

  -- ---- 2027 ----
  ('2027-01-01', 'International New Year Day', 'ទិវាចូលឆ្នាំសាកល', false),
  ('2027-02-20', 'Meak Bochea Day', 'ពិធីបុណ្យមាឃបូជា', false),                  -- LUNAR: estimate
  ('2027-03-08', 'International Women''s Day', 'ទិវានារីអន្តរជាតិ', false),
  ('2027-04-14', 'Khmer New Year (day 1)', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ', false),
  ('2027-04-15', 'Khmer New Year (day 2)', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ', false),
  ('2027-04-16', 'Khmer New Year (day 3)', 'ចូលឆ្នាំថ្មីប្រពៃណីជាតិ', false),
  ('2027-05-01', 'International Labour Day', 'ទិវាពលកម្មអន្តរជាតិ', false),
  ('2027-05-14', 'Birthday of His Majesty King Norodom Sihamoni', 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្ម', false),
  ('2027-05-20', 'Visak Bochea Day', 'ពិធីបុណ្យវិសាខបូជា', false),                -- LUNAR: estimate
  ('2027-05-21', 'Royal Ploughing Ceremony', 'ព្រះរាជពិធីច្រត់ព្រះនង្គ័ល', false), -- LUNAR: estimate
  ('2027-06-18', 'Birthday of Her Majesty the Queen Mother', 'ព្រះរាជពិធីបុណ្យចម្រើនព្រះជន្មព្រះមហាក្សត្រី', false),
  ('2027-09-24', 'Constitution Day', 'ទិវាប្រកាសរដ្ឋធម្មនុញ្ញ', false),
  ('2027-09-29', 'Pchum Ben (day 1)', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ', false),               -- LUNAR: estimate
  ('2027-09-30', 'Pchum Ben (day 2)', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ', false),               -- LUNAR: estimate
  ('2027-10-01', 'Pchum Ben (day 3)', 'ពិធីបុណ្យភ្ជុំបិណ្ឌ', false),               -- LUNAR: estimate
  ('2027-10-15', 'Commemoration Day of King Father Norodom Sihanouk', 'ទិវាប្រារព្ធពិធីរំលឹកព្រះវិញ្ញាណក្ខន្ធ', false),
  ('2027-10-29', 'Coronation Day of His Majesty King Norodom Sihamoni', 'ព្រះរាជពិធីគ្រងព្រះបរមរាជសម្បត្តិ', false),
  ('2027-11-09', 'Independence Day', 'ទិវាបុណ្យឯករាជ្យជាតិ', false),
  ('2027-11-12', 'Water Festival (day 1)', 'ព្រះរាជពិធីបុណ្យអុំទូក', false),        -- LUNAR: estimate
  ('2027-11-13', 'Water Festival (day 2)', 'ព្រះរាជពិធីបុណ្យអុំទូក', false),        -- LUNAR: estimate
  ('2027-11-14', 'Water Festival (day 3)', 'ព្រះរាជពិធីបុណ្យអុំទូក', false)         -- LUNAR: estimate
on conflict (holiday_date) do update set
  name_en     = excluded.name_en,
  name_kh     = excluded.name_kh,
  is_half_day = excluded.is_half_day;

-- =============================================================================
-- 4. DEMO EMPLOYEES - DEVELOPMENT ONLY
--
-- Eight staff, every role represented. The tree is deliberately four levels
-- deep so that INDIRECT reporting can actually be tested: Sokha must be able to
-- see Sreymom, who reports to Rithy, who reports to Sokha.
-- These write directly into auth.users, which is only appropriate on a local
-- `supabase db reset`. Do NOT run this section against a production project;
-- see README "First system_admin" for the production path.
--
--   Sophea Chan            Country Director          Leadership    system_admin
--   +- Dara Pen            HR & Ops Manager          Operations    hr_admin
--   |  +- Vanna Chea       Finance Officer           Operations    employee
--   +- Sokha Meas          Director of Programmes    Programmes    supervisor
--      +- Chantha Ly       M&E Officer               Malaria       employee
--      +- Bopha Sok        Programme Officer         Malaria       employee
--      +- Rithy Norn       Programme Manager, HIV    HIV           supervisor
--         +- Sreymom Kim   Data Analyst              HIV           employee
--                          (hired 1 Jun 2026 - the pro-rating demonstration)
-- =============================================================================
do $$
declare
  v_users jsonb := '[
    {"id":"11111111-1111-4111-8111-111111111111","email":"sophea.chan@clintonhealthaccess.org"},
    {"id":"22222222-2222-4222-8222-222222222222","email":"dara.pen@clintonhealthaccess.org"},
    {"id":"33333333-3333-4333-8333-333333333333","email":"sokha.meas@clintonhealthaccess.org"},
    {"id":"44444444-4444-4444-8444-444444444444","email":"rithy.norn@clintonhealthaccess.org"},
    {"id":"55555555-5555-4555-8555-555555555555","email":"chantha.ly@clintonhealthaccess.org"},
    {"id":"66666666-6666-4666-8666-666666666666","email":"bopha.sok@clintonhealthaccess.org"},
    {"id":"77777777-7777-4777-8777-777777777777","email":"vanna.chea@clintonhealthaccess.org"},
    {"id":"88888888-8888-4888-8888-888888888888","email":"sreymom.kim@clintonhealthaccess.org"}
  ]'::jsonb;
  v jsonb;
  v_has_provider_id boolean := false;
begin
  if to_regclass('auth.users') is null then
    raise notice 'auth.users not present - skipping demo employees.';
    return;
  end if;

  -- Supabase Auth needs a matching auth.identities row before it will accept a
  -- password sign-in. The column layout of that table changed across GoTrue
  -- versions (older: text `id`; newer: uuid `id` plus text `provider_id`), so
  -- detect which one we are on rather than guessing.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  for v in select * from jsonb_array_elements(v_users)
  loop
    -- The four empty-string columns below are not decoration. GoTrue reads them
    -- into non-nullable Go strings, so a NULL makes every sign-in fail with the
    -- unhelpful "Database error querying schema". Hand-inserted auth.users rows
    -- must set them explicitly.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      created_at, updated_at
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      (v ->> 'id')::uuid,
      'authenticated',
      'authenticated',
      v ->> 'email',
      extensions.crypt('demo-password-not-for-production', extensions.gen_salt('bf')),
      now(),
      -- 'email' first: these demo accounts sign in with a password. Real staff
      -- only ever arrive through Google, which is the sole provider enabled in
      -- production.
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('email', v ->> 'email'),
      '', '', '', '',
      now(),
      now()
    )
    on conflict (id) do nothing;

    if to_regclass('auth.identities') is not null then
      if v_has_provider_id then
        insert into auth.identities (
          provider_id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        )
        values (
          v ->> 'email',
          (v ->> 'id')::uuid,
          jsonb_build_object(
            'sub', v ->> 'id',
            'email', v ->> 'email',
            'email_verified', true,
            'phone_verified', false
          ),
          'email',
          now(), now(), now()
        )
        on conflict do nothing;
      else
        insert into auth.identities (
          id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        )
        values (
          v ->> 'email',
          (v ->> 'id')::uuid,
          jsonb_build_object('sub', v ->> 'id', 'email', v ->> 'email'),
          'email',
          now(), now(), now()
        )
        on conflict do nothing;
      end if;
    end if;
  end loop;

  -- Repair any demo rows created before the empty-string requirement was known,
  -- and any other GoTrue string column that happens to be nullable in this
  -- version. Scoped to the demo accounts; real accounts are created by GoTrue
  -- itself and are already correct.
  for v in select * from jsonb_array_elements(v_users)
  loop
    declare
      c record;
    begin
      for c in
        select column_name
        from information_schema.columns
        where table_schema = 'auth'
          and table_name = 'users'
          and data_type in ('text', 'character varying')
          and is_nullable = 'YES'
          and column_name in (
            'confirmation_token', 'recovery_token', 'email_change',
            'email_change_token_new', 'email_change_token_current',
            'phone_change', 'phone_change_token', 'reauthentication_token'
          )
      loop
        execute format(
          'update auth.users set %I = '''' where id = $1 and %I is null',
          c.column_name, c.column_name
        ) using (v ->> 'id')::uuid;
      end loop;
    end;
  end loop;
end $$;

insert into public.employees (
  id, staff_code, full_name, full_name_kh, email, position_title, department,
  supervisor_id, hire_date, probation_end_date, employment_status, role, gender
) values
  ('11111111-1111-4111-8111-111111111111', 'CHAI-KH-001', 'Sophea Chan', 'សុភា ចាន់',
   'sophea.chan@clintonhealthaccess.org', 'Country Director', 'Leadership',
   null, '2018-02-01', '2018-05-01', 'active', 'system_admin', 'F'),

  ('22222222-2222-4222-8222-222222222222', 'CHAI-KH-002', 'Dara Pen', 'តារា ប៉ែន',
   'dara.pen@clintonhealthaccess.org', 'HR & Operations Manager', 'Operations',
   '11111111-1111-4111-8111-111111111111', '2019-07-15', '2019-10-15', 'active', 'hr_admin', 'M'),

  ('33333333-3333-4333-8333-333333333333', 'CHAI-KH-003', 'Sokha Meas', 'សុខា មាស',
   'sokha.meas@clintonhealthaccess.org', 'Director of Programmes', 'Programmes',
   '11111111-1111-4111-8111-111111111111', '2020-03-02', '2020-06-02', 'active', 'supervisor', 'F'),

  ('44444444-4444-4444-8444-444444444444', 'CHAI-KH-004', 'Rithy Norn', 'ឫទ្ធី នន',
   'rithy.norn@clintonhealthaccess.org', 'Programme Manager, HIV', 'HIV',
   '33333333-3333-4333-8333-333333333333', '2021-09-01', '2021-12-01', 'active', 'supervisor', 'M'),

  ('55555555-5555-4555-8555-555555555555', 'CHAI-KH-005', 'Chantha Ly', 'ចន្ធា លី',
   'chantha.ly@clintonhealthaccess.org', 'Monitoring & Evaluation Officer', 'Malaria',
   '33333333-3333-4333-8333-333333333333', '2022-01-10', '2022-04-10', 'active', 'employee', 'F'),

  ('66666666-6666-4666-8666-666666666666', 'CHAI-KH-006', 'Bopha Sok', 'បុប្ផា សុខ',
   'bopha.sok@clintonhealthaccess.org', 'Programme Officer', 'Malaria',
   '33333333-3333-4333-8333-333333333333', '2023-05-02', '2023-08-02', 'active', 'employee', 'F'),

  ('77777777-7777-4777-8777-777777777777', 'CHAI-KH-007', 'Vanna Chea', 'វណ្ណា ជា',
   'vanna.chea@clintonhealthaccess.org', 'Finance Officer', 'Operations',
   '22222222-2222-4222-8222-222222222222', '2024-02-05', '2024-05-05', 'active', 'employee', 'M'),

  ('88888888-8888-4888-8888-888888888888', 'CHAI-KH-008', 'Sreymom Kim', 'ស្រីមុំ គីម',
   'sreymom.kim@clintonhealthaccess.org', 'Data Analyst', 'HIV',
   '44444444-4444-4444-8444-444444444444', '2026-06-01', '2026-09-01', 'on_probation', 'employee', 'F')
on conflict (id) do update set
  staff_code        = excluded.staff_code,
  full_name         = excluded.full_name,
  full_name_kh      = excluded.full_name_kh,
  email             = excluded.email,
  position_title    = excluded.position_title,
  department        = excluded.department,
  supervisor_id     = excluded.supervisor_id,
  hire_date         = excluded.hire_date,
  employment_status = excluded.employment_status,
  gender            = excluded.gender;

-- =============================================================================
-- 5. ENTITLEMENTS for the current and next leave year
--
-- fn_generate_entitlements refuses to run for a non-HR caller, so the seed
-- impersonates the seeded HR admin for the duration.
-- =============================================================================
do $$
declare
  v_year smallint := extract(year from current_date)::smallint;
begin
  if not exists (select 1 from public.employees) then
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',   '22222222-2222-4222-8222-222222222222',
      'email', 'dara.pen@clintonhealthaccess.org',
      'role',  'authenticated'
    )::text,
    false
  );

  perform public.fn_generate_entitlements(v_year);
  perform public.fn_generate_entitlements((v_year + 1)::smallint);

  perform set_config('request.jwt.claims', '', false);
end $$;

-- =============================================================================
-- 6. DEMO LEAVE REQUESTS - DEVELOPMENT ONLY
--
-- Written directly so the dashboards have something to show on first run.
-- days_requested is still computed by the trigger; it cannot be faked here
-- either. Dates are relative to today so the demo never goes stale.
-- =============================================================================
do $$
declare
  v_chantha uuid := '55555555-5555-4555-8555-555555555555';
  v_bopha   uuid := '66666666-6666-4666-8666-666666666666';
  v_vanna   uuid := '77777777-7777-4777-8777-777777777777';
  v_sreymom uuid := '88888888-8888-4888-8888-888888888888';
  v_sokha   uuid := '33333333-3333-4333-8333-333333333333';
  v_dara    uuid := '22222222-2222-4222-8222-222222222222';
  v_rithy   uuid := '44444444-4444-4444-8444-444444444444';
begin
  if not exists (select 1 from public.employees where id = v_chantha) then
    return;
  end if;
  if exists (select 1 from public.leave_requests) then
    return;  -- already seeded
  end if;

  insert into public.leave_requests (
    employee_id, leave_type_code, start_date, end_date, reason, handover_notes,
    status, submitted_at, supervisor_id, supervisor_decision_at,
    hr_id, hr_decision_at
  ) values
    -- taken earlier this year
    (v_chantha, 'ANNUAL', current_date - 60, current_date - 56,
     'Family trip to Siem Reap.', 'Kosal is covering the district reports.',
     'approved', now() - interval '70 days', v_sokha, now() - interval '69 days',
     v_dara, now() - interval '68 days'),

    (v_bopha, 'SICK', current_date - 20, current_date - 20,
     'Fever.', null,
     'approved', now() - interval '20 days', v_sokha, now() - interval '19 days',
     v_dara, now() - interval '19 days'),

    -- currently out
    (v_vanna, 'ANNUAL', current_date - 1, current_date + 2,
     'Wedding in Battambang.', 'Monthly close is already submitted.',
     'approved', now() - interval '18 days', v_dara, now() - interval '17 days',
     v_dara, now() - interval '17 days'),

    -- awaiting a supervisor
    (v_chantha, 'ANNUAL', current_date + 21, current_date + 25,
     'Annual leave.', 'Bopha will cover the weekly data submission.',
     'pending_supervisor', now() - interval '4 days', v_sokha, null, null, null),

    (v_sreymom, 'LEARNING', current_date + 14, current_date + 14,
     'Stata short course.', null,
     'pending_supervisor', now() - interval '7 days', v_rithy, null, null, null),

    -- awaiting HR
    (v_bopha, 'ANNUAL', current_date + 40, current_date + 44,
     'Khmer New Year visit to family.', 'Handover note attached in Drive.',
     'pending_hr', now() - interval '11 days', v_sokha, now() - interval '9 days',
     null, null),

    -- a draft the employee is still thinking about
    (v_vanna, 'MENTAL_HEALTH', current_date + 30, current_date + 30,
     null, null, 'draft', null, null, null, null, null);
end $$;

-- =============================================================================
-- Sanity output
-- =============================================================================
do $$
declare
  v_emp int; v_types int; v_hol int; v_ent int; v_req int;
begin
  select count(*) into v_emp   from public.employees;
  select count(*) into v_types from public.leave_types;
  select count(*) into v_hol   from public.public_holidays;
  select count(*) into v_ent   from public.entitlements;
  select count(*) into v_req   from public.leave_requests;
  raise notice 'Seed complete: % employees, % leave types, % holidays, % entitlements, % requests.',
    v_emp, v_types, v_hol, v_ent, v_req;
  raise notice 'REMINDER: public holiday dates are estimates. Verify against the RGC sub-decree.';
end $$;

-- =============================================================================
-- 7. DEMO ACCOUNTS - password state
--
-- The eight demo staff already have a known password, so they skip the
-- forced-change screen. A real account created through Admin -> Employees
-- starts with must_change_password = true and is blocked until it is changed.
-- =============================================================================
update public.employees
set must_change_password = false
where email::text like '%@clintonhealthaccess.org';
