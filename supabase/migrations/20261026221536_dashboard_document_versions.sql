-- добавление версий не изменяет исходный text и не включает writer.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table private.dashboard_write_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  guard_enabled boolean not null default false,
  write_enabled boolean not null default false
);
alter table private.dashboard_write_accounts enable row level security;
revoke all on private.dashboard_write_accounts from public, anon, authenticated;
grant select on private.dashboard_write_accounts to authenticated;
grant select, insert, update, delete on private.dashboard_write_accounts to service_role;
create policy dashboard_write_accounts_read_own on private.dashboard_write_accounts
  for select to authenticated using ((select auth.uid()) = owner_id);

alter table public.user_data
  add column revision bigint not null default 1 check (revision > 0),
  add column write_base_revision bigint;
grant select, insert, update on public.user_data to service_role;

create function private.dashboard_protected_key(p_key text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(p_key = 'horizons_goals_v2' or p_key ~ '^goals:[0-9]{4}-[0-9]{2}-[0-9]{2}$', false);
$$;
revoke all on function private.dashboard_protected_key(text) from public, anon;
grant execute on function private.dashboard_protected_key(text) to authenticated, service_role;

-- узкий внутренний trigger: только флаг владельца, версия, timestamp и new/old.
-- security definer нужен для закрытой flags-таблицы, а не для обхода user_data rls.
create function private.dashboard_version_user_data()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_key text;
  v_guard boolean;
begin
  if tg_op = 'DELETE' then
    v_owner := old.user_id;
    v_key := old.key;
  else
    v_owner := new.user_id;
    v_key := new.key;
    if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.key is distinct from old.key) then
      raise exception 'identity_immutable' using errcode = '22023';
    end if;
  end if;
  select a.guard_enabled into v_guard from private.dashboard_write_accounts a where a.owner_id = v_owner;
  if coalesce(v_guard, false) and private.dashboard_protected_key(v_key) then
    if tg_op = 'DELETE' then
      raise exception 'version_required' using errcode = '40001';
    end if;
    if new.write_base_revision is null then
      raise exception 'version_required' using errcode = '40001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.write_base_revision is not null and
     ((tg_op = 'INSERT' and new.write_base_revision <> 0) or
      (tg_op = 'UPDATE' and new.write_base_revision <> old.revision)) then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  -- одинаковые locks используются и для отсутствующих строк, включая read dependencies.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text || ':' || v_key, 0));
  if tg_op = 'INSERT' then new.revision := 1; else new.revision := old.revision + 1; end if;
  new.write_base_revision := null;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.dashboard_version_user_data() from public, anon, authenticated, service_role;
create trigger user_data_document_version before insert or update or delete on public.user_data
  for each row execute function private.dashboard_version_user_data();

create function public.dashboard_sync_capabilities()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('protocol', 2,
    'guardEnabled', coalesce((select a.guard_enabled from private.dashboard_write_accounts a where a.owner_id = auth.uid()), false),
    'writeEnabled', coalesce((select a.write_enabled from private.dashboard_write_accounts a where a.owner_id = auth.uid()), false));
$$;
revoke all on function public.dashboard_sync_capabilities() from public, anon, service_role;
grant execute on function public.dashboard_sync_capabilities() to authenticated;

create function public.dashboard_read_user_data(p_after_key text, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'key', d.key, 'exists', true, 'valueText', d.value, 'revision', d.revision::text, 'updatedAt', d.updated_at
  ) order by d.key), '[]'::jsonb) from (
    select u.key, u.value, u.revision, u.updated_at from public.user_data u
    where u.user_id = auth.uid() and (p_after_key is null or u.key > p_after_key)
    order by u.key limit p_limit
  ) d);
end;
$$;
revoke all on function public.dashboard_read_user_data(text, integer) from public, anon, service_role;
grant execute on function public.dashboard_read_user_data(text, integer) to authenticated;

create function public.dashboard_save_documents(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_change jsonb;
  v_total bigint := 0;
  v_row public.user_data%rowtype;
  v_current jsonb := '[]'::jsonb;
  v_saved jsonb := '[]'::jsonb;
  v_conflict boolean := false;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','unauthorized','status',401));
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','invalid_change','status',422));
  end if;
  if jsonb_array_length(p_changes) not between 1 and 64 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','invalid_change','status',422));
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) <> 'object' then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','invalid_change','status',422));
    end if;
    if not (v_change ?& array['key','expectedRevision','valueText']) or
       exists (select from jsonb_object_keys(v_change) k where k not in ('key','expectedRevision','valueText')) or
       jsonb_typeof(v_change->'key') <> 'string' or not private.dashboard_protected_key(v_change->>'key') or
       jsonb_typeof(v_change->'expectedRevision') <> 'string' or
       (v_change->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,18})$' or
       jsonb_typeof(v_change->'valueText') not in ('string','null') then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','invalid_change','status',422));
    end if;
    if (v_change->>'expectedRevision')::numeric > 9223372036854775807 then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','invalid_change','status',422));
    end if;
    v_total := v_total + coalesce(octet_length(v_change->>'valueText'), 0);
    if v_total > 4194304 then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','request_too_large','status',413));
    end if;
  end loop;
  if (select count(distinct value->>'key') from jsonb_array_elements(p_changes)) <> jsonb_array_length(p_changes) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','invalid_change','status',422));
  end if;
  -- сначала все advisory locks в одном порядке, затем row locks и проверки.
  for v_change in select value from jsonb_array_elements(p_changes) order by value->>'key' loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text || ':' || (v_change->>'key'), 0));
  end loop;
  for v_change in select value from jsonb_array_elements(p_changes) order by value->>'key' loop
    select * into v_row from public.user_data where user_id = v_owner and key = v_change->>'key' for update;
    v_conflict := v_conflict or coalesce(v_row.revision, 0) <> (v_change->>'expectedRevision')::bigint;
    v_current := v_current || jsonb_build_array(jsonb_build_object(
      'key', v_change->>'key', 'exists', v_row.revision is not null, 'valueText', v_row.value,
      'revision', coalesce(v_row.revision, 0)::text, 'updatedAt', v_row.updated_at));
  end loop;
  if v_conflict then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code','conflict','status',409), 'current', v_current);
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) order by value->>'key' loop
    if v_change->>'expectedRevision' = '0' then
      insert into public.user_data(user_id, key, value, write_base_revision)
      values(v_owner, v_change->>'key', v_change->>'valueText', 0) returning * into v_row;
    else
      update public.user_data set value = v_change->>'valueText', write_base_revision = (v_change->>'expectedRevision')::bigint
      where user_id = v_owner and key = v_change->>'key' returning * into v_row;
    end if;
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'key', v_row.key, 'exists', true, 'valueText', v_row.value, 'revision', v_row.revision::text, 'updatedAt', v_row.updated_at));
  end loop;
  return jsonb_build_object('ok', true, 'data', v_saved);
end;
$$;
revoke all on function public.dashboard_save_documents(jsonb) from public, anon, service_role;
grant execute on function public.dashboard_save_documents(jsonb) to authenticated;

create function public.dashboard_read_agent_documents(p_owner uuid, p_keys text[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_owner is null or p_keys is null or cardinality(p_keys) not between 1 and 64 or
     cardinality(p_keys) <> (select count(distinct key) from unnest(p_keys) key) or
     exists (select from unnest(p_keys) key where key is null or not
       (private.dashboard_protected_key(key) or key in ('tracker_v1','sphere_defs_v1'))) then
    raise exception 'invalid_keys' using errcode = '22023';
  end if;
  return (select jsonb_agg(jsonb_build_object(
    'key', requested.key, 'exists', u.key is not null, 'valueText', u.value,
    'revision', coalesce(u.revision, 0)::text, 'updatedAt', u.updated_at
  ) order by requested.ordinality)
  from unnest(p_keys) with ordinality as requested(key, ordinality)
  left join public.user_data u on u.user_id = p_owner and u.key = requested.key);
end;
$$;
revoke all on function public.dashboard_read_agent_documents(uuid, text[]) from public, anon, authenticated;
grant execute on function public.dashboard_read_agent_documents(uuid, text[]) to service_role;
