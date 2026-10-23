-- =====================================================================
-- AMBITION - Forms hub: forms added by link
-- Jotform forms that belong to another Jotform login don't show up on
-- their own. An admin pastes the form's link in Admin > Forms hub and
-- says what it is (credit application, account setup or other).
-- Safe to run more than once.
-- =====================================================================
create table if not exists public.hub_forms (
  form_id  text primary key,                          -- Jotform form id
  kind     text check (kind in ('credit', 'account', 'other')),
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

alter table public.hub_forms enable row level security;
drop policy if exists hub_forms_admin on public.hub_forms;
create policy hub_forms_admin on public.hub_forms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

select count(*) as hub_forms from public.hub_forms;
