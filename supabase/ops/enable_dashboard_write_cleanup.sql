-- отдельно согласованная production-операция. перед запуском проверить проект и историю.
-- если расширение отсутствует, сначала отдельно разрешить его установку.
begin;
do $$
begin
  if current_user <> 'postgres' or not exists (select from pg_extension where extname='pg_cron') then
    raise exception 'requires_postgres_and_pg_cron';
  end if;
end;
$$;
select cron.schedule('dashboard-write-cleanup','0 * * * *','select private.dashboard_write_cleanup()');
do $$
begin
  if (select count(*) from cron.job where jobname='dashboard-write-cleanup' and active
    and schedule='0 * * * *' and command='select private.dashboard_write_cleanup()'
    and database=current_database() and username=current_user) <> 1 or
    (select count(*) from cron.job where jobname='dashboard-write-cleanup') <> 1 then
    raise exception 'unexpected_cleanup_job';
  end if;
end;
$$;
commit;
