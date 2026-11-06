-- служебное состояние writer; эти объекты не включают доступ к записи.
create table private.dashboard_write_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  draft_id uuid not null default gen_random_uuid(),
  credential_generation text not null,
  credential_expires_at timestamptz not null,
  command_hash text not null,
  operation text not null,
  target_id text not null,
  state text not null default 'prepared' check (state in ('prepared','committed','cancelled','expired','conflicted')),
  prepared_at timestamptz not null,
  expires_at timestamptz not null,
  terminal_at timestamptz,
  versions jsonb not null default '{}'::jsonb,
  primary key (owner_id, request_id)
);
create index dashboard_write_prepare_window on private.dashboard_write_requests (owner_id, prepared_at);
create index dashboard_write_commit_window on private.dashboard_write_requests (owner_id, terminal_at) where state = 'committed';
create index dashboard_write_active_window on private.dashboard_write_requests (owner_id, expires_at) where state = 'prepared';

create table private.dashboard_write_drafts (
  owner_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  primary key (owner_id, request_id),
  foreign key (owner_id, request_id) references private.dashboard_write_requests on delete cascade
);
create table private.dashboard_write_receipts (
  owner_id uuid not null,
  request_id uuid not null,
  body jsonb not null,
  primary key (owner_id, request_id),
  foreign key (owner_id, request_id) references private.dashboard_write_requests on delete cascade
);
create table private.dashboard_write_audit (
  owner_id uuid not null,
  request_id uuid not null,
  actor text not null default 'hermes' check (actor = 'hermes'),
  operation text not null,
  target_id text not null,
  fields jsonb not null,
  versions jsonb not null,
  outcome text not null check (outcome = 'committed'),
  created_at timestamptz not null,
  primary key (owner_id, request_id),
  foreign key (owner_id, request_id) references private.dashboard_write_requests on delete cascade
);
alter table private.dashboard_write_requests enable row level security;
alter table private.dashboard_write_drafts enable row level security;
alter table private.dashboard_write_receipts enable row level security;
alter table private.dashboard_write_audit enable row level security;
revoke all on private.dashboard_write_requests, private.dashboard_write_drafts, private.dashboard_write_receipts, private.dashboard_write_audit
  from public, anon, authenticated, service_role;
grant select, insert, update on private.dashboard_write_requests to service_role;
grant select, insert on private.dashboard_write_drafts, private.dashboard_write_receipts to service_role;
grant insert on private.dashboard_write_audit to service_role;

create function private.dashboard_agent_error(p_code text, p_status integer)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('code', p_code, 'status', p_status));
$$;
create function private.dashboard_agent_ok(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('ok', true, 'data', p_data);
$$;

-- общий короткий lock на владельце: flags и счётчики проверяются в той же транзакции.
create function private.dashboard_agent_gate(p_owner uuid, p_credential text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a private.dashboard_write_accounts;
begin
  if p_owner is null or p_credential is null or p_credential !~ '^[0-9a-f]{64}$' then
    return private.dashboard_agent_error('unauthorized_or_expired', 401);
  end if;
  select * into a from private.dashboard_write_accounts where owner_id = p_owner for update;
  if not found or not (a.guard_enabled and a.write_enabled) then
    return private.dashboard_agent_error('write_disabled', 403);
  end if;
  return null;
end;
$$;

-- внутренний helper, вызывается только после gate. payload никогда не отдаётся модели.
create function private.dashboard_agent_current(
  p_owner uuid, p_credential text, p_request uuid, p_draft uuid, p_action text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r private.dashboard_write_requests; p jsonb; receipt jsonb; summary jsonb; ts timestamptz := clock_timestamp();
begin
  select * into r from private.dashboard_write_requests where owner_id = p_owner and request_id = p_request for update;
  if not found or (p_draft is not null and r.draft_id <> p_draft) then
    return private.dashboard_agent_error('request_unknown', 404);
  end if;
  if r.credential_generation <> p_credential or r.credential_expires_at <= ts then
    return private.dashboard_agent_error('unauthorized_or_expired', 401);
  end if;
  if r.state = 'prepared' and r.expires_at <= ts then
    r.state := 'expired';
    update private.dashboard_write_requests set state = r.state, terminal_at = ts
      where owner_id = p_owner and request_id = p_request;
  end if;
  if r.state = 'prepared' and p_action = 'cancel' then
    r.state := 'cancelled';
    update private.dashboard_write_requests set state = r.state, terminal_at = ts
      where owner_id = p_owner and request_id = p_request;
  end if;
  summary := jsonb_build_object('state', r.state, 'requestId', r.request_id, 'draftId', r.draft_id);
  if r.state = 'committed' then
    select body into receipt from private.dashboard_write_receipts where owner_id = p_owner and request_id = p_request;
    if receipt is null then
      if p_action <> 'status' then return private.dashboard_agent_error('request_retired', 410); end if;
      return private.dashboard_agent_ok(summary || jsonb_build_object(
        'receipt_expired', true, 'targetId', r.target_id, 'operation', r.operation,
        'versions', r.versions, 'committedAt', r.terminal_at));
    end if;
    return private.dashboard_agent_ok(summary || jsonb_build_object('receipt', receipt));
  end if;
  if p_action = 'status' or p_action = 'cancel' then
    return private.dashboard_agent_ok(summary || jsonb_build_object('expiresAt', r.expires_at));
  end if;
  if r.state = 'expired' then return private.dashboard_agent_error('draft_expired', 410); end if;
  if r.state = 'cancelled' then return private.dashboard_agent_error('draft_cancelled', 410); end if;
  if r.state = 'conflicted' then return private.dashboard_agent_error('conflict', 409); end if;
  select payload into p from private.dashboard_write_drafts where owner_id = p_owner and request_id = p_request;
  if p is null then return private.dashboard_agent_error('request_retired', 410); end if;
  summary := summary || jsonb_build_object('draft', jsonb_build_object(
    'requestId', r.request_id, 'draftId', r.draft_id, 'expiresAt', r.expires_at, 'previewText', p->'previewText'));
  if p_action in ('load', 'commit') then summary := summary || jsonb_build_object('payload', p); end if;
  return private.dashboard_agent_ok(summary);
end;
$$;

create function private.dashboard_agent_payload_valid(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  op text := p#>>'{resolved,operation}';
  args jsonb := p#>'{resolved,arguments}';
  hashes jsonb := p->'afterHashes';
  deps jsonb := p->'dependencies';
  item jsonb;
  k text;
  keys text[];
  seen text[] := '{}';
  d text := p#>>'{resolved,context,effectiveDate}';
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 262144 or
     jsonb_typeof(args) is distinct from 'object' or jsonb_typeof(hashes) is distinct from 'object' or
     jsonb_typeof(deps) is distinct from 'array' or jsonb_typeof(p->'changedFields') is distinct from 'array' or
     jsonb_typeof(p->'location') is distinct from 'object' or
     jsonb_typeof(p->'previewText') is distinct from 'string' or char_length(p->>'previewText') not between 1 and 2500 or
     jsonb_typeof(p->'targetId') is distinct from 'string' or char_length(p->>'targetId') not between 1 and 200 or
     jsonb_typeof(p->'credentialExpiresAt') is distinct from 'string' then return false; end if;
  case op
    when 'create_task' then keys := array['goals:' || d];
    when 'update_task' then keys := array['goals:' || (args#>>'{target,date}')];
    when 'move_task' then keys := array['goals:' || (args#>>'{target,date}'), 'goals:' || (args->>'toDate')];
    when 'route_inbox_to_task' then
      keys := array['inbox_v1', case when d = 'backlog' then 'backlog_tasks_v1' else 'goals:' || d end];
    when 'route_inbox_to_goal' then keys := array['inbox_v1','horizons_goals_v2'];
    when 'create_goal', 'update_goal', 'move_goal', 'set_goal_progress', 'complete_goal', 'reopen_goal'
      then keys := array['horizons_goals_v2'];
    else return false;
  end case;
  if (select count(*) from jsonb_object_keys(hashes)) <> cardinality(keys) or
     (select count(distinct value) from unnest(keys) value) <> cardinality(keys) or
     jsonb_array_length(deps) not between cardinality(keys) and cardinality(keys)+1 or
     jsonb_array_length(p->'changedFields') > 32 then return false; end if;
  foreach k in array keys loop
    if not private.dashboard_protected_key(k) or coalesce(hashes->>k, '') !~ '^[0-9a-f]{64}$' then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(deps) loop
    k := item->>'key';
    if k is null or k = any(seen) or not (k = any(keys) or k = 'sphere_defs_v1') or
       coalesce(item->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,18})$' then return false; end if;
    if (item->>'expectedRevision')::numeric > 9223372036854775807 then return false; end if;
    seen := array_append(seen,k);
  end loop;
  if not keys <@ seen then return false; end if;
  if exists (select from jsonb_array_elements_text(p->'changedFields') field where field is null or field not in (
    'text','description','estimatedMin','sphere','difficulty','subtasks','date','source','title',
    'horizon','periodKey','priority','order','type','target','unit','current','done'
  )) then return false; end if;
  if exists (select from jsonb_each(p->'location') item where item.key not in ('date','horizon','periodKey') or
     jsonb_typeof(item.value) <> 'string' or char_length(item.value #>> '{}') > 20) then return false; end if;
  return true;
end;
$$;

create function public.dashboard_agent_prepare(
  p_owner uuid, p_credential text, p_request uuid, p_command_hash text, p_payload jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  denied jsonb := private.dashboard_agent_gate(p_owner, p_credential);
  r private.dashboard_write_requests;
  ts timestamptz := clock_timestamp();
  credential_expiry timestamptz;
begin
  if denied is not null then return denied; end if;
  if p_request is null or coalesce(p_command_hash,'') !~ '^[0-9a-f]{64}$' then
    return private.dashboard_agent_error('invalid_change', 422);
  end if;
  select * into r from private.dashboard_write_requests where owner_id=p_owner and request_id=p_request;
  if found then
    if r.credential_generation <> p_credential then return private.dashboard_agent_error('unauthorized_or_expired', 401); end if;
    if r.command_hash <> p_command_hash then return private.dashboard_agent_error('request_mismatch', 409); end if;
    return private.dashboard_agent_current(p_owner,p_credential,p_request,null,'prepare');
  end if;
  if p_payload is null then return private.dashboard_agent_error('request_unknown', 404); end if;
  if not private.dashboard_agent_payload_valid(p_payload) then return private.dashboard_agent_error('invalid_change', 422); end if;
  begin
    credential_expiry := (p_payload->>'credentialExpiresAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return private.dashboard_agent_error('invalid_change', 422);
  end;
  if not isfinite(credential_expiry) or credential_expiry <= ts then
    return private.dashboard_agent_error('unauthorized_or_expired', 401);
  end if;
  if (select count(*) from private.dashboard_write_requests where owner_id=p_owner and prepared_at > ts - interval '600 seconds') >= 120 or
     (select count(*) from private.dashboard_write_requests where owner_id=p_owner and state='prepared' and expires_at > ts) >= 20 then
    return private.dashboard_agent_error('rate_limited', 429);
  end if;
  insert into private.dashboard_write_requests
    (owner_id,request_id,credential_generation,credential_expires_at,command_hash,operation,target_id,prepared_at,expires_at)
  values (p_owner,p_request,p_credential,credential_expiry,p_command_hash,p_payload#>>'{resolved,operation}',
    p_payload->>'targetId',ts,least(ts + interval '300 seconds', credential_expiry));
  insert into private.dashboard_write_drafts(owner_id,request_id,payload) values (p_owner,p_request,p_payload);
  return private.dashboard_agent_current(p_owner,p_credential,p_request,null,'prepare');
end;
$$;

create function public.dashboard_agent_load(p_owner uuid, p_credential text, p_request uuid, p_draft uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare denied jsonb := private.dashboard_agent_gate(p_owner,p_credential);
begin
  if denied is not null then return denied; end if;
  if p_draft is null then return private.dashboard_agent_error('invalid_change', 422); end if;
  return private.dashboard_agent_current(p_owner,p_credential,p_request,p_draft,'load');
end;
$$;
create function public.dashboard_agent_cancel(p_owner uuid, p_credential text, p_request uuid, p_draft uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare denied jsonb := private.dashboard_agent_gate(p_owner,p_credential);
begin
  if denied is not null then return denied; end if;
  if p_draft is null then return private.dashboard_agent_error('invalid_change', 422); end if;
  return private.dashboard_agent_current(p_owner,p_credential,p_request,p_draft,'cancel');
end;
$$;
create function public.dashboard_agent_status(p_owner uuid, p_credential text, p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare denied jsonb := private.dashboard_agent_gate(p_owner,p_credential);
begin
  if denied is not null then return denied; end if;
  if p_request is null then return private.dashboard_agent_ok(jsonb_build_object('state','enabled')); end if;
  return private.dashboard_agent_current(p_owner,p_credential,p_request,null,'status');
end;
$$;

create function public.dashboard_agent_commit(
  p_owner uuid, p_credential text, p_request uuid, p_draft uuid, p_documents jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  denied jsonb := private.dashboard_agent_gate(p_owner,p_credential);
  current_state jsonb;
  payload jsonb;
  d jsonb;
  k text;
  rev bigint;
  v_versions jsonb := '{}'::jsonb;
  expected jsonb;
  hashes jsonb;
  ts timestamptz;
  receipt jsonb;
  seen text[] := '{}';
begin
  if denied is not null then return denied; end if;
  if p_draft is null then return private.dashboard_agent_error('invalid_change', 422); end if;
  current_state := private.dashboard_agent_current(p_owner,p_credential,p_request,p_draft,'commit');
  if current_state->>'ok' <> 'true' then return current_state; end if;
  if current_state#>>'{data,state}' = 'committed' then
    return private.dashboard_agent_ok(current_state#>'{data,receipt}');
  end if;
  payload := current_state#>'{data,payload}';
  if not private.dashboard_agent_payload_valid(payload) then return private.dashboard_agent_error('invalid_change', 422); end if;
  hashes := payload->'afterHashes';
  select jsonb_object_agg(value->>'key', value->>'expectedRevision') into expected
    from jsonb_array_elements(payload->'dependencies');

  for k in select jsonb_object_keys(expected) order by 1 loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text || ':' || k, 0));
  end loop;
  for k in select jsonb_object_keys(expected) order by 1 loop
    select revision into rev from public.user_data where user_id=p_owner and key=k for update;
    if coalesce(rev,0) <> (expected->>k)::bigint then
      update private.dashboard_write_requests set state='conflicted', terminal_at=clock_timestamp()
        where owner_id=p_owner and request_id=p_request;
      return private.dashboard_agent_error('conflict', 409);
    end if;
  end loop;
  -- могли ждать row lock, поэтому ttl проверяется ещё раз до изменений.
  ts := clock_timestamp();
  current_state := private.dashboard_agent_current(p_owner,p_credential,p_request,p_draft,'commit');
  if current_state->>'ok' <> 'true' then return current_state; end if;
  if (select count(*) from private.dashboard_write_requests where owner_id=p_owner and state='committed' and terminal_at > ts - interval '600 seconds') >= 60 then
    return private.dashboard_agent_error('rate_limited', 429);
  end if;
  if jsonb_typeof(p_documents) is distinct from 'array' then return private.dashboard_agent_error('invalid_change', 422); end if;
  if jsonb_array_length(p_documents) <> (select count(*) from jsonb_object_keys(hashes)) then
    return private.dashboard_agent_error('invalid_change', 422);
  end if;
  for d in select value from jsonb_array_elements(p_documents) loop
    k := d->>'key';
    if jsonb_typeof(d) is distinct from 'object' then return private.dashboard_agent_error('invalid_change', 422); end if;
    if (select count(*) from jsonb_object_keys(d)) <> 3 or k is null or k = any(seen) or not (hashes ? k) or
       jsonb_typeof(d->'expectedRevision') is distinct from 'string' or (d->>'expectedRevision') is distinct from (expected->>k) or
       jsonb_typeof(d->'valueText') is distinct from 'string' or octet_length(d->>'valueText') > 4194304 or
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(d->>'valueText','UTF8')),'hex') is distinct from (hashes->>k) then
      return private.dashboard_agent_error('invalid_change', 422);
    end if;
    seen := array_append(seen,k);
  end loop;
  for d in select value from jsonb_array_elements(p_documents) order by value->>'key' loop
    k := d->>'key';
    rev := (expected->>k)::bigint;
    if rev = 0 then
      insert into public.user_data(user_id,key,value,write_base_revision)
      values(p_owner,k,d->>'valueText',0) returning revision into rev;
    else
      update public.user_data set value=d->>'valueText',write_base_revision=rev
        where user_id=p_owner and key=k returning revision into rev;
    end if;
    v_versions := v_versions || jsonb_build_object(k, rev::text);
  end loop;
  receipt := jsonb_build_object('requestId',p_request,'draftId',p_draft,'outcome','committed',
    'operation',payload#>>'{resolved,operation}','targetId',payload->>'targetId',
    'location',payload->'location','versions',v_versions,'committedAt',ts);
  insert into private.dashboard_write_receipts(owner_id,request_id,body) values(p_owner,p_request,receipt);
  insert into private.dashboard_write_audit(owner_id,request_id,operation,target_id,fields,versions,outcome,created_at)
    values(p_owner,p_request,payload#>>'{resolved,operation}',payload->>'targetId',payload->'changedFields',v_versions,'committed',ts);
  update private.dashboard_write_requests set state='committed',terminal_at=ts,versions=v_versions
    where owner_id=p_owner and request_id=p_request;
  return private.dashboard_agent_ok(receipt);
end;
$$;

revoke all on function private.dashboard_agent_error(text,integer), private.dashboard_agent_ok(jsonb),
  private.dashboard_agent_gate(uuid,text), private.dashboard_agent_current(uuid,text,uuid,uuid,text),
  private.dashboard_agent_payload_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.dashboard_agent_error(text,integer), private.dashboard_agent_ok(jsonb),
  private.dashboard_agent_gate(uuid,text), private.dashboard_agent_current(uuid,text,uuid,uuid,text),
  private.dashboard_agent_payload_valid(jsonb) to service_role;
revoke all on function public.dashboard_agent_prepare(uuid,text,uuid,text,jsonb),
  public.dashboard_agent_load(uuid,text,uuid,uuid), public.dashboard_agent_cancel(uuid,text,uuid,uuid),
  public.dashboard_agent_status(uuid,text,uuid), public.dashboard_agent_commit(uuid,text,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dashboard_agent_prepare(uuid,text,uuid,text,jsonb),
  public.dashboard_agent_load(uuid,text,uuid,uuid), public.dashboard_agent_cancel(uuid,text,uuid,uuid),
  public.dashboard_agent_status(uuid,text,uuid), public.dashboard_agent_commit(uuid,text,uuid,uuid,jsonb) to service_role;
