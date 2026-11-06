-- исполняется администратором/cron; миграция не устанавливает расширений и jobs.
create function private.dashboard_write_cleanup()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  ts timestamptz := clock_timestamp();
  drafts integer;
  receipts integer;
  audits integer;
begin
  update private.dashboard_write_requests set state='expired',terminal_at=ts
    where state='prepared' and expires_at <= ts;
  delete from private.dashboard_write_drafts d using private.dashboard_write_requests r
    where (r.owner_id,r.request_id)=(d.owner_id,d.request_id) and r.state <> 'prepared';
  get diagnostics drafts = row_count;
  delete from private.dashboard_write_receipts d using private.dashboard_write_requests r
    where (r.owner_id,r.request_id)=(d.owner_id,d.request_id) and r.terminal_at <= ts - interval '30 days';
  get diagnostics receipts = row_count;
  delete from private.dashboard_write_audit d using private.dashboard_write_requests r
    where (r.owner_id,r.request_id)=(d.owner_id,d.request_id) and r.terminal_at <= ts - interval '30 days';
  get diagnostics audits = row_count;
  return jsonb_build_object('drafts',drafts,'receipts',receipts,'audits',audits);
end;
$$;
revoke all on function private.dashboard_write_cleanup() from public, anon, authenticated, service_role;
