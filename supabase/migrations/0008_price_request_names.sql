-- =====================================================================
-- AMBITION - "My price requests"
-- Price requests are matched to a rep by the name picked in the form's
-- SALES REP box. When that name isn't spelled the same as the rep's app
-- account (e.g. "Mike" vs "Michael"), an admin links the two here.
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.rep_name_links (
  rep_name   text primary key,   -- the name as it appears on the form (lower case)
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rep_name_links enable row level security;

drop policy if exists rep_links_read on public.rep_name_links;
drop policy if exists rep_links_admin on public.rep_name_links;
create policy rep_links_read on public.rep_name_links for select to authenticated
  using (public.is_employee());
create policy rep_links_admin on public.rep_name_links for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.rep_name_links from anon;
