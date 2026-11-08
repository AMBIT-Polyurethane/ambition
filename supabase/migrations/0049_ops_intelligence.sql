-- 0049 AMBIT Intelligence in AMBIT-OPS (the pulsing atom button).
--
-- Everyone working in an AMBIT-OPS workspace can use AMBIT Intelligence there: their own business data
-- (through their own login and the existing walls) plus AMBIT's approved product knowledge. It counts
-- toward the same daily question limit and cost tracking as Ask AMBIT (Admin -> Ask AMBIT sets the
-- contractor limit). The Ask AMBIT screen itself stays staff-only until "Open to contractors" is on.
--
-- Run once in Supabase -> SQL Editor. Safe to run again.

create or replace function public.ai_can_use() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.status = 'active'
       and (p.role in ('employee', 'admin')
            or (select open_to_customers from public.ai_settings)
            or public.ops_company() is not null)
      from public.profiles p where p.id = auth.uid()), false)
$$;

revoke execute on function public.ai_can_use() from public, anon;
grant execute on function public.ai_can_use() to authenticated;
