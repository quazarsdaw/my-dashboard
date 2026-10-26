-- только синтетическая изолированная база; это не production migration.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table if not exists public.dashboard_test_marker (value text primary key);
insert into public.dashboard_test_marker values ('synthetic-dashboard-write-only') on conflict do nothing;
insert into auth.users values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002') on conflict do nothing;
create table public.user_data (
  user_id uuid not null references auth.users(id), key text not null, value text,
  updated_at timestamptz default now(), primary key (user_id, key)
);
insert into public.user_data (user_id, key, value) values
  ('00000000-0000-4000-8000-000000000001', 'legacy-preserved', E' [ {"text":"привет 😀", "n":9007199254740993} ]\n');
grant all on public.user_data to service_role;
