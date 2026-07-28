begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(32);

select has_table(
  'public',
  'user_data',
  'user_data table exists'
);
select col_type_is(
  'public',
  'user_data',
  'user_id',
  'uuid',
  'user id uses uuid'
);
select col_type_is(
  'public',
  'user_data',
  'key',
  'text',
  'key uses text'
);
select col_type_is(
  'public',
  'user_data',
  'value',
  'text',
  'value uses text'
);
select col_type_is(
  'public',
  'user_data',
  'updated_at',
  'timestamp with time zone',
  'updated at is timezone-aware'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_data'::regclass),
  'user_data has rls enabled'
);

select ok(
  not has_table_privilege('anon', 'public.user_data', 'select,insert,update,delete'),
  'anon has no direct crud privileges'
);

select ok(
  has_table_privilege('authenticated', 'public.user_data', 'select'),
  'authenticated can select'
);
select ok(
  has_table_privilege('authenticated', 'public.user_data', 'insert'),
  'authenticated can insert'
);
select ok(
  has_table_privilege('authenticated', 'public.user_data', 'update'),
  'authenticated can update'
);
select ok(
  has_table_privilege('authenticated', 'public.user_data', 'delete'),
  'authenticated can delete'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public' and tablename = 'user_data'
  ),
  4,
  'user_data has four explicit policies'
);

select is(
  (
    select roles::text
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_data'
      and cmd = 'SELECT'
  ),
  '{authenticated}',
  'select policy targets authenticated'
);
select ok(
  (
    select qual is not null
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_data'
      and cmd = 'SELECT'
  ),
  'select policy has ownership predicate'
);
select ok(
  (
    select with_check is not null
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_data'
      and cmd = 'INSERT'
  ),
  'insert policy has with check'
);
select ok(
  (
    select qual is not null and with_check is not null
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_data'
      and cmd = 'UPDATE'
  ),
  'update policy has using and with check'
);
select ok(
  (
    select qual is not null
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_data'
      and cmd = 'DELETE'
  ),
  'delete policy has ownership predicate'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'public.user_data'::regclass
      and tgname = 'user_data_set_updated_at'
      and not tgisinternal
  ),
  1,
  'user_data has one server timestamp trigger'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_user_data_updated_at()',
    'execute'
  ),
  'authenticated cannot call the timestamp trigger function directly'
);

insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

insert into public.user_data (user_id, key, value)
values
  ('11111111-1111-4111-8111-111111111111', 'owner-seed', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'foreign-seed', 'foreign')
on conflict (user_id, key) do update set value = excluded.value;

select ok(
  (
    select updated_at > '2026-01-01'::timestamptz
    from public.user_data
    where user_id = '11111111-1111-4111-8111-111111111111'
      and key = 'owner-seed'
  ),
  'insert receives a server timestamp'
);
update public.user_data
set updated_at = '2000-01-01'::timestamptz
where user_id = '11111111-1111-4111-8111-111111111111'
  and key = 'owner-seed';
select ok(
  (
    select updated_at > '2026-01-01'::timestamptz
    from public.user_data
    where user_id = '11111111-1111-4111-8111-111111111111'
      and key = 'owner-seed'
  ),
  'update replaces a client timestamp with a server timestamp'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

select is(
  (
    select count(*)
    from public.user_data
    where user_id = '11111111-1111-4111-8111-111111111111'
  ),
  1::bigint,
  'authenticated owner can select own row'
);
select is(
  (
    select count(*)
    from public.user_data
    where user_id = '22222222-2222-4222-8222-222222222222'
  ),
  0::bigint,
  'authenticated owner cannot select another user row'
);
select lives_ok(
  $$
    insert into public.user_data (user_id, key, value)
    values (
      '11111111-1111-4111-8111-111111111111',
      'owner-insert',
      'created'
    )
  $$,
  'authenticated owner can insert own row'
);
select throws_ok(
  $$
    insert into public.user_data (user_id, key, value)
    values (
      '22222222-2222-4222-8222-222222222222',
      'foreign-insert',
      'blocked'
    )
  $$,
  '42501',
  null,
  'authenticated owner cannot insert another user row'
);
select lives_ok(
  $$
    update public.user_data
    set value = 'updated'
    where user_id = '11111111-1111-4111-8111-111111111111'
      and key = 'owner-seed'
  $$,
  'authenticated owner can update own row'
);
select throws_ok(
  $$
    update public.user_data
    set user_id = '22222222-2222-4222-8222-222222222222'
    where user_id = '11111111-1111-4111-8111-111111111111'
      and key = 'owner-seed'
  $$,
  '42501',
  null,
  'authenticated owner cannot transfer a row to another user'
);
select is(
  (
    with changed as (
      update public.user_data
      set value = 'not-updated'
      where user_id = '22222222-2222-4222-8222-222222222222'
      returning 1
    )
    select count(*) from changed
  ),
  0::bigint,
  'authenticated owner cannot update another user row'
);
select is(
  (
    with removed as (
      delete from public.user_data
      where user_id = '22222222-2222-4222-8222-222222222222'
      returning 1
    )
    select count(*) from removed
  ),
  0::bigint,
  'authenticated owner cannot delete another user row'
);
select lives_ok(
  $$
    delete from public.user_data
    where user_id = '11111111-1111-4111-8111-111111111111'
      and key = 'owner-insert'
  $$,
  'authenticated owner can delete own row'
);

reset role;
set local role anon;
select throws_ok(
  $$ select * from public.user_data $$,
  '42501',
  null,
  'anon cannot select user_data'
);
select throws_ok(
  $$
    insert into public.user_data (user_id, key, value)
    values (
      '11111111-1111-4111-8111-111111111111',
      'anon-insert',
      'blocked'
    )
  $$,
  '42501',
  null,
  'anon cannot insert user_data'
);

reset role;
select * from finish();
rollback;
