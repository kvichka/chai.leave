-- =============================================================================
-- 0001_extensions_and_enums.sql
-- CHAI Cambodia Leave Management System
--
-- Extensions, private schema, and enumerated types.
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists citext    with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Private schema for security-definer helpers. Never exposed through PostgREST.
create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$ begin
  create type app_role as enum ('employee', 'supervisor', 'hr_admin', 'system_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_status as enum (
    'draft',
    'pending_supervisor',
    'pending_hr',
    'approved',
    'rejected',
    'cancelled',
    'withdrawn'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type day_portion as enum ('full_day', 'morning', 'afternoon');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_unit as enum ('working_day', 'calendar_day');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_status as enum ('active', 'on_probation', 'suspended', 'exited');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Identity helpers
--
-- These read the JWT claims that PostgREST puts on the session. They are used
-- instead of auth.uid() / auth.jwt() so that the same code path works when the
-- SQL test-suite impersonates a user with set_config('request.jwt.claims', ...).
-- -----------------------------------------------------------------------------

create or replace function app_private.jwt_claims()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function app_private.current_uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(app_private.jwt_claims() ->> 'sub', '')::uuid;
$$;

create or replace function app_private.current_email()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(app_private.jwt_claims() ->> 'email', ''),
    nullif(app_private.jwt_claims() #>> '{user_metadata,email}', '')
  );
$$;

comment on schema app_private is
  'Security-definer helpers for RLS. Not exposed via PostgREST.';
