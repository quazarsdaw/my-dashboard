-- только после согласованного релиза. psql -v dashboard_owner=<uuid> -v dashboard_release_verified=true -f <этот файл>
-- verified означает: сверены история и sql, assets, owner, hash/expiry и тесты отрицательных сценариев.
\set ON_ERROR_STOP on
begin;
select set_config('dashboard.release_owner', :'dashboard_owner', true);
select set_config('dashboard.release_verified', :'dashboard_release_verified', true);
do $$
declare
  target_owner uuid := current_setting('dashboard.release_owner')::uuid;
  job_id bigint;
begin
  if current_user <> 'postgres' or current_setting('dashboard.release_verified') <> 'true' then
    raise exception 'release_not_verified';
  end if;
  if not exists (select from private.dashboard_write_accounts where owner_id=target_owner and guard_enabled for update) then
    raise exception 'guard_not_enabled_for_owner';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version in (
      '20261026221536','20261105191935','20261105225357','20261105225642')) <> 4 then
    raise exception 'writer_migration_history_incomplete';
  end if;
  if (select count(*) from cron.job where jobname='dashboard-write-cleanup') <> 1 then
    raise exception 'cleanup_job_missing_or_duplicated';
  end if;
  select jobid into job_id from cron.job
    where jobname='dashboard-write-cleanup' and active and schedule='0 * * * *'
      and database=current_database() and username=current_user and command='select private.dashboard_write_cleanup()';
  if job_id is null or not exists (
      select from cron.job_run_details where jobid=job_id and status='succeeded' and end_time > now()-interval '2 hours') then
    raise exception 'cleanup_not_verified';
  end if;
  update private.dashboard_write_accounts set write_enabled=true where owner_id=target_owner;
end;
$$;
commit;
