create table public.school_mutation_locks (
  lock_key text primary key,
  lock_token uuid not null,
  locked_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.school_mutation_locks enable row level security;

create or replace function public.acquire_school_mutation_lock(
  p_lock_key text,
  p_lock_token uuid,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_rows integer;
begin
  if p_ttl_seconds is distinct from 60 then
    raise exception 'ttl must be exactly 60 seconds'
      using errcode = '22023';
  end if;

  insert into public.school_mutation_locks (
    lock_key,
    lock_token,
    locked_until
  )
  values (
    p_lock_key,
    p_lock_token,
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (lock_key) do update
  set
    lock_token = excluded.lock_token,
    locked_until = excluded.locked_until,
    updated_at = now()
  where public.school_mutation_locks.locked_until < now();

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$function$;

create or replace function public.renew_school_mutation_lock(
  p_lock_key text,
  p_lock_token uuid,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_rows integer;
begin
  if p_ttl_seconds is distinct from 60 then
    raise exception 'ttl must be exactly 60 seconds'
      using errcode = '22023';
  end if;

  update public.school_mutation_locks
  set
    locked_until = now() + make_interval(secs => p_ttl_seconds),
    updated_at = now()
  where lock_key = p_lock_key
    and lock_token = p_lock_token
    and locked_until >= now();

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$function$;

create or replace function public.release_school_mutation_lock(
  p_lock_key text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_rows integer;
begin
  delete from public.school_mutation_locks
  where lock_key = p_lock_key
    and lock_token = p_lock_token;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$function$;

revoke all on table public.school_mutation_locks
from public, anon, authenticated, service_role;

revoke all on function public.acquire_school_mutation_lock(text, uuid, integer)
from public, anon, authenticated;
revoke all on function public.renew_school_mutation_lock(text, uuid, integer)
from public, anon, authenticated;
revoke all on function public.release_school_mutation_lock(text, uuid)
from public, anon, authenticated;

grant execute
on function public.acquire_school_mutation_lock(text, uuid, integer)
to service_role;
grant execute
on function public.renew_school_mutation_lock(text, uuid, integer)
to service_role;
grant execute
on function public.release_school_mutation_lock(text, uuid)
to service_role;
