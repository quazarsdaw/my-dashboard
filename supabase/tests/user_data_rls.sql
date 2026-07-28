begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

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

select * from finish();
rollback;
