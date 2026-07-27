begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(39);

select has_table(
  'public',
  'school_mutation_locks',
  'coordination-only lock table exists'
);
select col_is_pk(
  'public',
  'school_mutation_locks',
  'lock_key',
  'lock key is the primary key'
);
select col_type_is(
  'public',
  'school_mutation_locks',
  'lock_token',
  'uuid',
  'lock token uses uuid'
);
select col_type_is(
  'public',
  'school_mutation_locks',
  'locked_until',
  'timestamp with time zone',
  'lease deadline is timezone-aware'
);
select col_type_is(
  'public',
  'school_mutation_locks',
  'created_at',
  'timestamp with time zone',
  'created timestamp is timezone-aware'
);
select col_type_is(
  'public',
  'school_mutation_locks',
  'updated_at',
  'timestamp with time zone',
  'updated timestamp is timezone-aware'
);

select has_function(
  'public',
  'acquire_school_mutation_lock',
  array['text', 'uuid', 'integer'],
  'acquire rpc exists'
);
select has_function(
  'public',
  'renew_school_mutation_lock',
  array['text', 'uuid', 'integer'],
  'renew rpc exists'
);
select has_function(
  'public',
  'release_school_mutation_lock',
  array['text', 'uuid'],
  'release rpc exists'
);

truncate table public.school_mutation_locks;

select is(
  public.acquire_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000001'::uuid,
    60
  ),
  true,
  'first token acquires the lock'
);
select is(
  public.acquire_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000002'::uuid,
    60
  ),
  false,
  'second token cannot acquire a live lease'
);
select is(
  public.release_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000002'::uuid
  ),
  false,
  'foreign token cannot release the lease'
);
select is(
  public.release_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000001'::uuid
  ),
  true,
  'matching token releases the lease'
);
select is(
  (select count(*) from public.school_mutation_locks),
  0::bigint,
  'release removes only the matching lease'
);

select is(
  public.acquire_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000001'::uuid,
    60
  ),
  true,
  'lease is acquired before expiry takeover'
);
update public.school_mutation_locks
set locked_until = now() - interval '1 second'
where lock_key = 'active-lesson:owner';
select is(
  public.acquire_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000002'::uuid,
    60
  ),
  true,
  'expired lease can be taken over'
);
select is(
  (
    select lock_token
    from public.school_mutation_locks
    where lock_key = 'active-lesson:owner'
  ),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'takeover stores the new token'
);

select throws_ok(
  $$
    select public.acquire_school_mutation_lock(
      'active-lesson:owner',
      '00000000-0000-4000-8000-000000000003'::uuid,
      59
    )
  $$,
  '22023',
  'ttl must be exactly 60 seconds',
  'acquire rejects a ttl other than 60 seconds'
);
select throws_ok(
  $$
    select public.renew_school_mutation_lock(
      'active-lesson:owner',
      '00000000-0000-4000-8000-000000000002'::uuid,
      61
    )
  $$,
  '22023',
  'ttl must be exactly 60 seconds',
  'renew rejects a ttl other than 60 seconds'
);
select throws_ok(
  $$
    select public.acquire_school_mutation_lock(
      'active-lesson:owner',
      '00000000-0000-4000-8000-000000000003'::uuid,
      null
    )
  $$,
  '22023',
  'ttl must be exactly 60 seconds',
  'acquire rejects a null ttl'
);
select throws_ok(
  $$
    select public.renew_school_mutation_lock(
      'active-lesson:owner',
      '00000000-0000-4000-8000-000000000002'::uuid,
      null
    )
  $$,
  '22023',
  'ttl must be exactly 60 seconds',
  'renew rejects a null ttl'
);

truncate table public.school_mutation_locks;
select is(
  public.acquire_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000001'::uuid,
    60
  ),
  true,
  'lease is acquired before renew checks'
);
update public.school_mutation_locks
set locked_until = now() + interval '5 seconds'
where lock_key = 'active-lesson:owner';
select is(
  public.renew_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000001'::uuid,
    60
  ),
  true,
  'matching live token renews the lease'
);
select ok(
  (
    select locked_until > now() + interval '55 seconds'
    from public.school_mutation_locks
    where lock_key = 'active-lesson:owner'
  ),
  'renew extends the lease by sixty seconds'
);
select is(
  public.renew_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000002'::uuid,
    60
  ),
  false,
  'foreign token cannot renew the lease'
);
update public.school_mutation_locks
set locked_until = now() - interval '1 second'
where lock_key = 'active-lesson:owner';
select is(
  public.renew_school_mutation_lock(
    'active-lesson:owner',
    '00000000-0000-4000-8000-000000000001'::uuid,
    60
  ),
  false,
  'expired token cannot renew the lease'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.school_mutation_locks',
    'select,insert,update,delete'
  ),
  'anon has no direct table privileges'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.school_mutation_locks',
    'select,insert,update,delete'
  ),
  'authenticated has no direct table privileges'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.school_mutation_locks',
    'select,insert,update,delete'
  ),
  'service role uses rpc instead of direct table access'
);
select ok(
  not exists (
    select 1
    from pg_class as relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as privilege
    where relation.oid = 'public.school_mutation_locks'::regclass
      and privilege.grantee = 0
      and privilege.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'public has no direct table grants'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as privilege
    where procedure.oid =
      'public.acquire_school_mutation_lock(text,uuid,integer)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'public cannot execute acquire rpc'
);
select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as privilege
    where procedure.oid =
      'public.renew_school_mutation_lock(text,uuid,integer)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'public cannot execute renew rpc'
);
select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as privilege
    where procedure.oid =
      'public.release_school_mutation_lock(text,uuid)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'public cannot execute release rpc'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.acquire_school_mutation_lock(text,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.renew_school_mutation_lock(text,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.release_school_mutation_lock(text,uuid)',
    'execute'
  ),
  'anon cannot execute lock rpc'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.acquire_school_mutation_lock(text,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.renew_school_mutation_lock(text,uuid,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.release_school_mutation_lock(text,uuid)',
    'execute'
  ),
  'authenticated cannot execute lock rpc'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.acquire_school_mutation_lock(text,uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.renew_school_mutation_lock(text,uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.release_school_mutation_lock(text,uuid)',
    'execute'
  ),
  'service role can execute exactly the lock rpc surface'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'school_mutation_locks'
      and policyname = 'school_mutation_locks_deny_direct_access'
  ),
  1::bigint,
  'lock table has one explicit deny policy'
);
select is(
  (
    select qual
    from pg_policies
    where schemaname = 'public'
      and tablename = 'school_mutation_locks'
      and policyname = 'school_mutation_locks_deny_direct_access'
  ),
  'false',
  'deny policy never exposes existing lock rows'
);
select is(
  (
    select with_check
    from pg_policies
    where schemaname = 'public'
      and tablename = 'school_mutation_locks'
      and policyname = 'school_mutation_locks_deny_direct_access'
  ),
  'false',
  'deny policy never accepts direct lock writes'
);

select * from finish();
rollback;
