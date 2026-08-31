-- =============================================================================
-- 0010_scheduling.sql
-- Daily sweep for stale approvals.
--
-- pg_cron is available on Supabase paid plans and in the local CLI stack. On the
-- free tier the extension may be missing, so this migration degrades quietly and
-- the same job is run by .github/workflows/reminders.yml instead. Either path
-- calls the identical function, so there is only one implementation to trust.
-- =============================================================================

do $$
begin
  execute 'create extension if not exists pg_cron with schema extensions';
exception when others then
  raise notice 'pg_cron unavailable (%). Falling back to the scheduled GitHub Action.', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 02:00 Asia/Phnom_Penh is 19:00 UTC the previous day.
    perform cron.unschedule('leave-stale-approvals')
      where exists (select 1 from cron.job where jobname = 'leave-stale-approvals');

    perform cron.schedule(
      'leave-stale-approvals',
      '0 19 * * 0-4',
      $cron$ select public.fn_notify_stale_approvals(); $cron$
    );
  end if;
exception when others then
  raise notice 'Could not schedule the stale-approval sweep (%). Use the GitHub Action.', sqlerrm;
end $$;
