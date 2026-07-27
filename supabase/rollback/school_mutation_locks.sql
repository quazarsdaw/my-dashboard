revoke execute
on function public.acquire_school_mutation_lock(text, uuid, integer)
from service_role;
revoke execute
on function public.renew_school_mutation_lock(text, uuid, integer)
from service_role;
revoke execute
on function public.release_school_mutation_lock(text, uuid)
from service_role;

drop function if exists
  public.release_school_mutation_lock(text, uuid);
drop function if exists
  public.renew_school_mutation_lock(text, uuid, integer);
drop function if exists
  public.acquire_school_mutation_lock(text, uuid, integer);

drop table if exists public.school_mutation_locks;
