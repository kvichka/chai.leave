-- =============================================================================
-- 0003_rls_helpers.sql
-- SECURITY DEFINER, STABLE helper functions used by every RLS policy.
--
-- These live in app_private and are owned by the migration role, which owns the
-- tables. Because the tables are NOT declared FORCE ROW LEVEL SECURITY, the
-- owner bypasses RLS inside these functions - that is what stops the employees
-- policy from recursing into itself.
--
-- search_path is pinned on every function so a caller cannot shadow `public`
-- with a schema of their own and hijack the lookup.
-- =============================================================================

create or replace function app_private.fn_current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.id = app_private.current_uid()
  limit 1;
$$;

create or replace function app_private.fn_current_role()
returns app_role
language sql
stable
security definer
set search_path = ''
as $$
  select e.role
  from public.employees e
  where e.id = app_private.current_uid()
  limit 1;
$$;

create or replace function app_private.fn_is_hr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app_private.fn_current_role() in ('hr_admin', 'system_admin'), false);
$$;

create or replace function app_private.fn_is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app_private.fn_current_role() = 'system_admin', false);
$$;

-- Walks UP the supervisor_id chain from p_employee looking for p_manager.
-- True when p_manager is the direct or indirect supervisor of p_employee.
-- Depth-capped at 20 so a data-entry cycle cannot hang a query.
create or replace function app_private.fn_is_descendant_of(p_manager uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select e.id, e.supervisor_id, 1 as depth
    from public.employees e
    where e.id = p_employee
    union all
    select e.id, e.supervisor_id, c.depth + 1
    from public.employees e
    join chain c on e.id = c.supervisor_id
    where c.depth < 20
  )
  select exists (
    select 1
    from chain
    where chain.supervisor_id = p_manager
      and p_manager is not null
      and p_employee is not null
      and p_manager <> p_employee
  );
$$;

-- Everyone at or beneath p_manager in the reporting tree, p_manager included.
create or replace function app_private.fn_subtree(p_manager uuid)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select e.id, 1 as depth
    from public.employees e
    where e.id = p_manager
    union all
    select e.id, t.depth + 1
    from public.employees e
    join tree t on e.supervisor_id = t.id
    where t.depth < 20
  )
  select id from tree;
$$;

-- True when the current user may see this employee's data at all.
create or replace function app_private.fn_can_view_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_employee = app_private.current_uid()
    or app_private.fn_is_hr()
    or app_private.fn_is_descendant_of(app_private.current_uid(), p_employee);
$$;

-- Would setting p_supervisor as the supervisor of p_employee create a loop?
create or replace function app_private.fn_would_cycle(p_employee uuid, p_supervisor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_supervisor is null then false
    when p_supervisor = p_employee then true
    -- A cycle appears exactly when the proposed supervisor already sits
    -- somewhere beneath the employee.
    else app_private.fn_is_descendant_of(p_employee, p_supervisor)
  end;
$$;

grant execute on function
  app_private.fn_current_employee_id(),
  app_private.fn_current_role(),
  app_private.fn_is_hr(),
  app_private.fn_is_system_admin(),
  app_private.fn_is_descendant_of(uuid, uuid),
  app_private.fn_subtree(uuid),
  app_private.fn_can_view_employee(uuid),
  app_private.fn_would_cycle(uuid, uuid)
to authenticated, service_role;
