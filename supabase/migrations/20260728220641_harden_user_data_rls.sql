create table if not exists public.user_data (
  user_id uuid not null references auth.users(id),
  key text not null,
  value text,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table public.user_data enable row level security;

create or replace function public.set_user_data_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all
on function public.set_user_data_updated_at()
from public, anon, authenticated;

drop trigger if exists user_data_set_updated_at on public.user_data;
create trigger user_data_set_updated_at
before insert or update on public.user_data
for each row
execute function public.set_user_data_updated_at();

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
