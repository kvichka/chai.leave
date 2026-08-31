-- =============================================================================
-- rls_tests.sql
--
-- The anon key that ships inside the GitHub Pages bundle is public. Anyone can
-- read it out of the JavaScript. Row Level Security is therefore not one layer
-- of defense, it is the ONLY layer. This file exists to prove it holds.
--
-- Ten things that must FAIL, three that must SUCCEED. Any failure aborts.
--
-- Run:
--   npm run db:rls
--
-- That uses scripts/run-sql.mjs, which talks to Postgres over node-postgres and
-- needs no psql install. It connects to SUPABASE_DB_URL (from .env.local) or,
-- failing that, to the local `supabase start` stack. The few psql
-- meta-commands below are handled by the runner, not sent to the server.
--
-- Everything happens inside one transaction which is rolled back at the end,
-- so the fixtures below never persist.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- -----------------------------------------------------------------------------
-- Fixtures, created as the superuser so RLS does not get in the way of setup.
-- -----------------------------------------------------------------------------
\echo '--- setting up fixtures ---'

do $$
declare
  v_chantha uuid := '55555555-5555-4555-8555-555555555555';
  v_bopha   uuid := '66666666-6666-4666-8666-666666666666';
  v_vanna   uuid := '77777777-7777-4777-8777-777777777777';
  v_dara    uuid := '22222222-2222-4222-8222-222222222222';
begin
  -- A draft belonging to Chantha, used by checks 3 and 4.
  insert into public.leave_requests
    (id, employee_id, leave_type_code, start_date, end_date, status)
  values
    ('aaaaaaaa-0000-4000-8000-000000000001', v_chantha, 'ANNUAL',
     current_date + 60, current_date + 61, 'draft');

  -- A second draft for Chantha, used by the end-to-end workflow in check 13.
  insert into public.leave_requests
    (id, employee_id, leave_type_code, start_date, end_date, status)
  values
    ('aaaaaaaa-0000-4000-8000-000000000002', v_chantha, 'ANNUAL',
     current_date + 90, current_date + 92, 'draft');

  -- A request awaiting Vanna's own supervisor (Dara), used by check 6:
  -- Sokha is nowhere in Vanna's reporting line.
  insert into public.leave_requests
    (id, employee_id, leave_type_code, start_date, end_date, status,
     submitted_at, supervisor_id)
  values
    ('aaaaaaaa-0000-4000-8000-000000000003', v_vanna, 'ANNUAL',
     current_date + 70, current_date + 71, 'pending_supervisor', now(), v_dara);

  -- A stored attachment under Bopha's prefix, used by check 10.
  insert into storage.objects (id, bucket_id, name, owner, metadata)
  values ('bbbbbbbb-0000-4000-8000-000000000001',
          'leave-attachments',
          v_bopha::text || '/aaaaaaaa-0000-4000-8000-0000000000ff/medical-certificate.pdf',
          v_bopha,
          '{"mimetype":"application/pdf","size":1024}'::jsonb)
  on conflict (id) do nothing;

  -- Guarantee an audit row exists so "0 rows" in check 7 means "filtered",
  -- not "the table happened to be empty".
  insert into public.audit_log (table_name, record_id, action, actor_id, after_data)
  values ('employees', v_chantha::text, 'TEST', v_chantha, '{"seeded":"for rls tests"}'::jsonb);
end $$;

-- Impersonation helper for the psql side: sets the JWT claims PostgREST would
-- set, then drops into the `authenticated` role so policies actually apply.
-- (Left as literal SQL rather than a function: SECURITY DEFINER restores the
-- role on exit, which would silently undo the impersonation.)

-- =============================================================================
-- MUST FAIL - 1. Employee A cannot see Employee B's leave requests
-- =============================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","email":"chantha.ly@clintonhealthaccess.org","role":"authenticated"}',
  true);
set local role authenticated;

do $$
declare v_n int;
begin
  select count(*) into v_n
  from public.leave_requests
  where employee_id = '66666666-6666-4666-8666-666666666666';  -- Bopha, a peer

  if v_n <> 0 then
    raise exception 'FAIL 1: Chantha can see % of Bopha''s leave requests.', v_n;
  end if;
  raise notice 'ok 1  - employee cannot read a peer''s leave requests';
end $$;

-- =============================================================================
-- MUST FAIL - 2. Employee A cannot see anyone else's entitlements
-- =============================================================================
do $$
declare v_n int;
begin
  select count(*) into v_n
  from public.entitlements
  where employee_id <> '55555555-5555-4555-8555-555555555555';

  if v_n <> 0 then
    raise exception 'FAIL 2: Chantha can see % entitlement rows belonging to other staff.', v_n;
  end if;
  raise notice 'ok 2  - employee cannot read other staff entitlements';
end $$;

-- =============================================================================
-- MUST FAIL - 3. Employee A cannot approve their own request
-- =============================================================================
do $$
declare
  v_blocked boolean := false;
  v_status  leave_status;
begin
  begin
    update public.leave_requests
       set status = 'approved'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001';
    if not found then
      v_blocked := true;   -- filtered out by RLS
    end if;
  exception when others then
    v_blocked := true;     -- rejected by trg_leave_request_guard
  end;

  select status into v_status
  from public.leave_requests where id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if not v_blocked or v_status <> 'draft' then
    raise exception 'FAIL 3: employee self-approved. Status is now %.', v_status;
  end if;
  raise notice 'ok 3  - employee cannot set their own request to approved';
end $$;

-- =============================================================================
-- MUST FAIL - 4. A client-supplied days_requested does not stick
-- =============================================================================
do $$
declare v_days numeric;
begin
  update public.leave_requests
     set days_requested = 0.5
   where id = 'aaaaaaaa-0000-4000-8000-000000000001';

  select days_requested into v_days
  from public.leave_requests where id = 'aaaaaaaa-0000-4000-8000-000000000001';

  -- Two consecutive weekdays are 2.0 days; the exact figure depends on where in
  -- the week +60/+61 land, but it can never be the 0.5 the client asked for.
  if v_days = 0.5 then
    raise exception 'FAIL 4: client-supplied days_requested survived (%).', v_days;
  end if;
  raise notice 'ok 4  - days_requested is recomputed server-side (client said 0.5, stored %)', v_days;
end $$;

-- =============================================================================
-- MUST FAIL - 5. Employee A cannot adjust their own entitlement
-- =============================================================================
do $$
declare
  v_blocked boolean := false;
  v_adj     numeric;
begin
  begin
    update public.entitlements
       set adjustment_days = 10, adjustment_reason = 'because I would like ten more days'
     where employee_id = '55555555-5555-4555-8555-555555555555'
       and leave_type_code = 'ANNUAL';
    if not found then v_blocked := true; end if;
  exception when others then
    v_blocked := true;
  end;

  select adjustment_days into v_adj
  from public.entitlements
  where employee_id = '55555555-5555-4555-8555-555555555555'
    and leave_type_code = 'ANNUAL'
    and leave_year = extract(year from current_date)::smallint;

  if not v_blocked or coalesce(v_adj, 0) = 10 then
    raise exception 'FAIL 5: employee granted themselves days (adjustment is now %).', v_adj;
  end if;
  raise notice 'ok 5  - employee cannot write their own entitlement adjustment';
end $$;

-- =============================================================================
-- MUST FAIL - 8. Employee A cannot promote themselves to hr_admin
-- =============================================================================
do $$
declare
  v_blocked boolean := false;
  v_role    app_role;
begin
  begin
    update public.employees
       set role = 'hr_admin'
     where id = '55555555-5555-4555-8555-555555555555';
    if not found then v_blocked := true; end if;
  exception when others then
    v_blocked := true;
  end;

  select role into v_role from public.employees
  where id = '55555555-5555-4555-8555-555555555555';

  if not v_blocked or v_role <> 'employee' then
    raise exception 'FAIL 8: privilege escalation succeeded, role is now %.', v_role;
  end if;
  raise notice 'ok 8  - employee cannot change their own role';
end $$;

-- =============================================================================
-- MUST FAIL - 10. Employee A cannot read a colleague's stored attachment
-- =============================================================================
do $$
declare v_n int;
begin
  select count(*) into v_n
  from storage.objects
  where bucket_id = 'leave-attachments'
    and name like '66666666-6666-4666-8666-666666666666/%';

  if v_n <> 0 then
    raise exception 'FAIL 10: Chantha can see % of Bopha''s medical documents.', v_n;
  end if;
  raise notice 'ok 10 - employee cannot read another employee''s attachments';
end $$;

-- =============================================================================
-- MUST FAIL - 9. Nobody, in any role, may rewrite history
-- =============================================================================
do $$
declare
  v_upd_blocked boolean := false;
  v_del_blocked boolean := false;
begin
  begin
    update public.audit_log set action = 'NOTHING TO SEE HERE' where id > 0;
    if not found then v_upd_blocked := true; end if;
  exception when others then v_upd_blocked := true; end;

  begin
    delete from public.audit_log where id > 0;
    if not found then v_del_blocked := true; end if;
  exception when others then v_del_blocked := true; end;

  if not (v_upd_blocked and v_del_blocked) then
    raise exception 'FAIL 9: audit_log is mutable (update blocked=%, delete blocked=%).',
      v_upd_blocked, v_del_blocked;
  end if;
  raise notice 'ok 9a - employee cannot update or delete audit_log rows';
end $$;

-- =============================================================================
-- Switch to the supervisor, Sokha Meas
-- =============================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","email":"sokha.meas@clintonhealthaccess.org","role":"authenticated"}',
  true);
set local role authenticated;

-- =============================================================================
-- MUST FAIL - 6. A supervisor cannot approve outside their own tree
-- =============================================================================
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.rpc_supervisor_decision(
      'aaaaaaaa-0000-4000-8000-000000000003'::uuid, true, 'looks fine to me');
  exception when others then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL 6: rpc_supervisor_decision let Sokha decide on Vanna''s request.';
  end if;
end $$;

-- Confirm from outside the policy that nothing actually moved.
reset role;
do $$
declare v_status leave_status;
begin
  select status into v_status from public.leave_requests
  where id = 'aaaaaaaa-0000-4000-8000-000000000003';

  if v_status is distinct from 'pending_supervisor' then
    raise exception 'FAIL 6: Vanna''s request status is now %, expected pending_supervisor.', v_status;
  end if;
  raise notice 'ok 6  - supervisor cannot approve outside their reporting tree';
end $$;

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","email":"sokha.meas@clintonhealthaccess.org","role":"authenticated"}',
  true);
set local role authenticated;

-- =============================================================================
-- MUST FAIL - 7. A supervisor cannot read the audit log
-- =============================================================================
do $$
declare v_n int;
begin
  select count(*) into v_n from public.audit_log;
  if v_n <> 0 then
    raise exception 'FAIL 7: supervisor can read % audit rows.', v_n;
  end if;
  raise notice 'ok 7  - supervisor cannot read audit_log';
end $$;

-- =============================================================================
-- MUST FAIL - 9b. The supervisor cannot rewrite history either
-- =============================================================================
do $$
declare v_blocked boolean := false;
begin
  begin
    delete from public.audit_log where id > 0;
    if not found then v_blocked := true; end if;
  exception when others then v_blocked := true; end;

  if not v_blocked then
    raise exception 'FAIL 9b: supervisor deleted audit rows.';
  end if;
  raise notice 'ok 9b - supervisor cannot delete audit_log rows';
end $$;

-- =============================================================================
-- MUST SUCCEED - 12. A supervisor sees their three direct reports' balances
-- =============================================================================
do $$
declare
  v_direct   int;
  v_indirect int;
begin
  select count(distinct employee_id) into v_direct
  from public.v_leave_balances
  where supervisor_id = '33333333-3333-4333-8333-333333333333';

  if v_direct <> 3 then
    raise exception 'FAIL 12: supervisor sees % direct reports in v_leave_balances, expected 3.', v_direct;
  end if;

  -- and the indirect report one level further down
  select count(distinct employee_id) into v_indirect
  from public.v_leave_balances
  where employee_id = '88888888-8888-4888-8888-888888888888';

  if v_indirect <> 1 then
    raise exception 'FAIL 12: supervisor cannot see the indirect report Sreymom Kim.';
  end if;

  raise notice 'ok 12 - supervisor sees 3 direct reports and the indirect report';
end $$;

-- =============================================================================
-- Switch to HR, Dara Pen
-- =============================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"dara.pen@clintonhealthaccess.org","role":"authenticated"}',
  true);
set local role authenticated;

-- =============================================================================
-- MUST SUCCEED - 11. HR sees all eight employees
-- =============================================================================
do $$
declare v_n int;
begin
  select count(*) into v_n from public.employees;
  if v_n <> 8 then
    raise exception 'FAIL 11: HR sees % employees, expected 8.', v_n;
  end if;
  raise notice 'ok 11 - HR sees all 8 employees';
end $$;

-- =============================================================================
-- MUST FAIL - 9c. Not even HR may alter the audit log
-- =============================================================================
do $$
declare v_blocked boolean := false;
begin
  begin
    update public.audit_log set actor_email = 'nobody@example.com' where id > 0;
    if not found then v_blocked := true; end if;
  exception when others then v_blocked := true; end;

  if not v_blocked then
    raise exception 'FAIL 9c: HR modified audit rows.';
  end if;
  raise notice 'ok 9c - HR can read but not modify audit_log';
end $$;

-- =============================================================================
-- MUST SUCCEED - 13. Full workflow, and the balance drops by exactly the
--                    number of days requested.
-- =============================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","email":"chantha.ly@clintonhealthaccess.org","role":"authenticated"}',
  true);
set local role authenticated;

do $$
declare
  v_req      uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_emp      uuid := '55555555-5555-4555-8555-555555555555';
  v_year     smallint;
  v_before   numeric;
  v_after    numeric;
  v_days     numeric;
  v_status   leave_status;
begin
  select leave_year, days_requested into v_year, v_days
  from public.leave_requests where id = v_req;

  v_before := public.fn_available_balance(v_emp, 'ANNUAL', v_year);

  perform public.rpc_submit_request(v_req);
  select status into v_status from public.leave_requests where id = v_req;
  if v_status <> 'pending_supervisor' then
    raise exception 'FAIL 13: after submit the status is %, expected pending_supervisor.', v_status;
  end if;
  raise notice 'ok 13a- employee submitted; status is pending_supervisor';

  -- supervisor
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333333","email":"sokha.meas@clintonhealthaccess.org","role":"authenticated"}',
    true);
  -- The supervisor's decision is final: leave_types.requires_hr_approval is
  -- false for every type, so this commits the days rather than passing them on.
  perform public.rpc_supervisor_decision(v_req, true, 'Approved, cover arranged.');
  select status into v_status from public.leave_requests where id = v_req;
  if v_status <> 'approved' then
    raise exception 'FAIL 13: after supervisor approval the status is %, expected approved.', v_status;
  end if;
  raise notice 'ok 13b- supervisor approved; status is approved (no HR stage)';

  -- HR was told, not asked. Check the notification exists and asks for nothing.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","email":"dara.pen@clintonhealthaccess.org","role":"authenticated"}',
    true);
  if not exists (
    select 1 from public.notifications n
    where n.request_id = v_req
      and n.event_type = 'approved_for_information'
      and n.body ilike '%no action needed%'
  ) then
    raise exception 'FAIL 13: HR was not sent an information-only notice.';
  end if;
  raise notice 'ok 13c- HR was informed of the approval, not asked to decide';

  v_after := public.fn_available_balance(v_emp, 'ANNUAL', v_year);

  -- The request was pending (and therefore already reserved) between submit and
  -- approval, so the balance must be exactly where it was after submission.
  if v_before - v_after <> v_days then
    raise exception
      'FAIL 13: balance moved by % but the request was for % day(s) (before %, after %).',
      v_before - v_after, v_days, v_before, v_after;
  end if;

  raise notice 'ok 13 - approved; available balance fell by exactly % day(s) (% -> %)',
    v_days, v_before, v_after;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

\echo ''
\echo '================================================='
\echo ' ALL RLS CHECKS PASSED'
\echo '================================================='
\echo ''

rollback;
