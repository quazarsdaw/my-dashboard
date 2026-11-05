-- отзыв ключа edge выполняется отдельно; guard и доступ читателя сохраняются.
\set ON_ERROR_STOP on
begin;
select set_config('dashboard.release_owner', :'dashboard_owner', true);
do $$
declare target_owner uuid := current_setting('dashboard.release_owner')::uuid;
begin
  if current_user <> 'postgres' then raise exception 'requires_postgres'; end if;
  update private.dashboard_write_accounts set write_enabled=false where owner_id=target_owner;
  if not found then raise exception 'owner_not_configured'; end if;
  update private.dashboard_write_requests set state='cancelled',terminal_at=clock_timestamp()
    where owner_id=target_owner and state='prepared';
end;
$$;
commit;
