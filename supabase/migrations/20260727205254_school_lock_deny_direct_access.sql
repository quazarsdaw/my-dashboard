create policy school_mutation_locks_deny_direct_access
on public.school_mutation_locks
for all
to anon, authenticated
using (false)
with check (false);
