-- =============================================================================
-- 0002_tables.sql
-- Core tables, constraints and indexes. RLS is ENABLED here and the policies
-- themselves land in 0008_rls.sql. Enabling RLS with no policy = deny-all,
-- which is the correct state between these two migrations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_settings (single row, id = 1)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                        smallint  primary key default 1,
  prorate_method            text      not null default 'monthly_accrual',
  leave_year_start_month    smallint  not null default 1,
  allow_negative_balance    boolean   not null default false,
  min_days_notice_default   smallint  not null default 0,
  max_pending_per_employee  smallint  not null default 5,
  coverage_risk_threshold   numeric(5,2) not null default 30.00,
  email_notifications_enabled boolean not null default false,
  updated_at                timestamptz not null default now(),
  constraint app_settings_singleton    check (id = 1),
  constraint app_settings_prorate      check (prorate_method in ('monthly_accrual', 'daily_365')),
  constraint app_settings_year_month   check (leave_year_start_month between 1 and 12)
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- employees
-- -----------------------------------------------------------------------------
create table if not exists public.employees (
  id                  uuid primary key references auth.users(id) on delete restrict,
  staff_code          text not null unique,
  full_name           text not null,
  full_name_kh        text,
  email               extensions.citext not null unique,
  position_title      text,
  department          text,
  supervisor_id       uuid references public.employees(id) on delete set null,
  hire_date           date not null,
  probation_end_date  date,
  exit_date           date,
  employment_status   employment_status not null default 'active',
  role                app_role not null default 'employee',
  gender              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint employees_no_self_supervision check (supervisor_id is distinct from id),
  constraint employees_exit_after_hire     check (exit_date is null or exit_date >= hire_date),
  constraint employees_gender_domain       check (gender is null or gender in ('M', 'F'))
);

comment on column public.employees.gender is
  'Only ever used to gate gender-restricted leave types (maternity / paternity). Never displayed.';

create index if not exists idx_employees_supervisor  on public.employees (supervisor_id);
create index if not exists idx_employees_department  on public.employees (department);
create index if not exists idx_employees_status      on public.employees (employment_status);

-- -----------------------------------------------------------------------------
-- leave_types
-- Replaces the merged 3-row spreadsheet header block (F6:L8) with real rows.
-- -----------------------------------------------------------------------------
create table if not exists public.leave_types (
  code                        text primary key,
  parent_code                 text references public.leave_types(code) on delete restrict,
  name_en                     text not null,
  name_kh                     text,
  description                 text,
  unit                        leave_unit not null,
  default_days                numeric(6,2) not null,
  is_prorated                 boolean not null default false,
  max_carry_forward           numeric(6,2) not null default 0,
  carry_forward_expiry_month  smallint,
  allows_half_day             boolean not null default true,
  requires_attachment         boolean not null default false,
  attachment_after_days       numeric(4,2),
  requires_hr_approval        boolean not null default true,
  min_notice_days             smallint not null default 0,
  max_consecutive_days        numeric(6,2),
  gender_restriction          text,
  is_paid                     boolean not null default true,
  counts_against_balance      boolean not null default true,
  is_requestable              boolean not null default true,
  is_active                   boolean not null default true,
  display_order               smallint not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint leave_types_no_self_parent  check (parent_code is distinct from code),
  constraint leave_types_gender_domain   check (gender_restriction is null or gender_restriction in ('M', 'F')),
  constraint leave_types_expiry_month    check (carry_forward_expiry_month is null
                                                or carry_forward_expiry_month between 1 and 12),
  constraint leave_types_days_nonneg     check (default_days >= 0)
);

comment on column public.leave_types.unit is
  'The fix for the source spreadsheet bug where 21 working days ("1 month") and '
  '90 calendar days ("3 months") were summed in the same row. Never aggregate across units.';

create index if not exists idx_leave_types_parent on public.leave_types (parent_code);

-- -----------------------------------------------------------------------------
-- public_holidays
-- -----------------------------------------------------------------------------
create table if not exists public.public_holidays (
  holiday_date  date primary key,
  name_en       text not null,
  name_kh       text,
  leave_year    smallint not null generated always as
                (extract(year from holiday_date)::smallint) stored,
  is_half_day   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_public_holidays_year on public.public_holidays (leave_year);

-- -----------------------------------------------------------------------------
-- entitlements  (one row per employee x leave type x leave year)
-- -----------------------------------------------------------------------------
create table if not exists public.entitlements (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees(id) on delete cascade,
  leave_type_code     text not null references public.leave_types(code) on delete restrict,
  leave_year          smallint not null,
  base_days           numeric(6,2) not null,
  prorated_days       numeric(6,2) not null,
  carry_forward_days  numeric(6,2) not null default 0,
  adjustment_days     numeric(6,2) not null default 0,
  adjustment_reason   text,
  granted_by          uuid references public.employees(id) on delete set null,
  granted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  total_days          numeric(6,2) generated always as
                      (prorated_days + carry_forward_days + adjustment_days) stored,
  constraint entitlements_unique unique (employee_id, leave_type_code, leave_year),
  -- Kills the spreadsheet's unexplained "E4 = 0+0" manual adder.
  constraint entitlements_adjustment_needs_reason
    check (adjustment_days = 0 or (adjustment_reason is not null and length(btrim(adjustment_reason)) > 0)),
  constraint entitlements_year_sane check (leave_year between 2000 and 2100)
);

create index if not exists idx_entitlements_employee_year
  on public.entitlements (employee_id, leave_year);

-- -----------------------------------------------------------------------------
-- request reference counters ('LR-2026-0001')
-- -----------------------------------------------------------------------------
create table if not exists public.request_ref_counters (
  leave_year  smallint primary key,
  last_value  integer not null default 0
);

-- -----------------------------------------------------------------------------
-- leave_requests
-- -----------------------------------------------------------------------------
create table if not exists public.leave_requests (
  id                      uuid primary key default gen_random_uuid(),
  request_ref             text not null unique,
  employee_id             uuid not null references public.employees(id) on delete restrict,
  leave_type_code         text not null references public.leave_types(code) on delete restrict,
  leave_year              smallint not null,
  start_date              date not null,
  end_date                date not null,
  start_portion           day_portion not null default 'full_day',
  end_portion             day_portion not null default 'full_day',
  days_requested          numeric(6,2) not null default 0,
  reason                  text,
  handover_notes          text,
  contact_while_away      text,
  attachment_path         text,
  status                  leave_status not null default 'draft',
  submitted_at            timestamptz,
  supervisor_id           uuid references public.employees(id) on delete set null,
  supervisor_decision_at  timestamptz,
  supervisor_comment      text,
  hr_id                   uuid references public.employees(id) on delete set null,
  hr_decision_at          timestamptz,
  hr_comment              text,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint leave_requests_date_order check (end_date >= start_date),
  -- Deliberately >= 0, not > 0. A draft over a public holiday or a weekend must be
  -- storable so that rpc_submit_request can reject it with the human-readable
  -- message "Selected dates contain no working days." instead of a raw CHECK
  -- violation. Submission enforces > 0. See README "Deviations from the spec".
  constraint leave_requests_days_nonneg check (days_requested >= 0)
);

create index if not exists idx_leave_requests_employee_year
  on public.leave_requests (employee_id, leave_year);
create index if not exists idx_leave_requests_status
  on public.leave_requests (status);
create index if not exists idx_leave_requests_dates
  on public.leave_requests (start_date, end_date);
create index if not exists idx_leave_requests_supervisor_status
  on public.leave_requests (supervisor_id, status);
create index if not exists idx_leave_requests_type
  on public.leave_requests (leave_type_code);

-- Overlap detection (rpc_submit_request validation 5) and calendar clash lookups.
create index if not exists idx_leave_requests_range_gist
  on public.leave_requests
  using gist (employee_id, daterange(start_date, end_date + 1, '[)'));

create index if not exists idx_leave_requests_range_gist_all
  on public.leave_requests
  using gist (daterange(start_date, end_date + 1, '[)'));

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id            bigserial primary key,
  recipient_id  uuid not null references public.employees(id) on delete cascade,
  request_id    uuid references public.leave_requests(id) on delete cascade,
  event_type    text not null,
  title         text not null,
  body          text,
  is_read       boolean not null default false,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_unread
  on public.notifications (recipient_id, is_read, created_at desc);

-- Stops the "pending > 3 working days" sweeper from re-notifying every run.
create unique index if not exists uq_notifications_reminder
  on public.notifications (recipient_id, request_id, event_type)
  where event_type in ('reminder_supervisor_3d', 'reminder_hr_5d');

-- -----------------------------------------------------------------------------
-- audit_log  (append-only; no UPDATE or DELETE policy will ever exist)
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigserial primary key,
  table_name   text not null,
  record_id    text not null,
  action       text not null,
  actor_id     uuid,
  actor_email  text,
  before_data  jsonb,
  after_data   jsonb,
  occurred_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_table_record on public.audit_log (table_name, record_id);
create index if not exists idx_audit_log_actor        on public.audit_log (actor_id);
create index if not exists idx_audit_log_occurred     on public.audit_log (occurred_at desc);

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere. Policies arrive in 0008_rls.sql.
-- -----------------------------------------------------------------------------
alter table public.app_settings          enable row level security;
alter table public.employees             enable row level security;
alter table public.leave_types           enable row level security;
alter table public.public_holidays       enable row level security;
alter table public.entitlements          enable row level security;
alter table public.leave_requests        enable row level security;
alter table public.notifications         enable row level security;
alter table public.audit_log             enable row level security;
alter table public.request_ref_counters  enable row level security;
