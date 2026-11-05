-- входящие и бэклог участвуют в той же защите версий, что и задачи с датой.
-- флаги аккаунтов и содержимое существующих документов не меняются.
create or replace function private.dashboard_protected_key(p_key text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(
    p_key in ('horizons_goals_v2', 'inbox_v1', 'backlog_tasks_v1')
    or p_key ~ '^goals:[0-9]{4}-[0-9]{2}-[0-9]{2}$',
    false
  );
$$;
