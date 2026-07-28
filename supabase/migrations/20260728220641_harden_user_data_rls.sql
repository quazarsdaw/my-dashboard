create table if not exists public.user_data (
  user_id uuid not null references auth.users(id),
  key text not null,
  value text,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table public.user_data enable row level security;

drop policy if exists "Users can manage their own data" on public.user_data;

revoke all privileges on table public.user_data from anon;
revoke all privileges on table public.user_data from authenticated;
grant select, insert, update, delete on table public.user_data to authenticated;

create policy user_data_select_own
on public.user_data
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_data_insert_own
on public.user_data
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy user_data_update_own
on public.user_data
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_data_delete_own
on public.user_data
for delete
to authenticated
using ((select auth.uid()) = user_id);
