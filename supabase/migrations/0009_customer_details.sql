-- =====================================================================
-- AMBITION - Customer details for ordering
-- * Billing and shipping addresses, contact name and the QuickBooks id
--   (customers were imported once from QuickBooks Online).
-- * AMBIT employees can add a new customer from the order screen. It is
--   usable right away and flagged until accounting sets it up in QuickBooks.
-- Contractors still only ever see their own company (companies_read).
-- Safe to run more than once.
-- =====================================================================

alter table public.companies add column if not exists contact_name   text;
alter table public.companies add column if not exists bill_address   text;
alter table public.companies add column if not exists ship_address   text;
alter table public.companies add column if not exists qb_id          text;
alter table public.companies add column if not exists source         text not null default 'admin';
alter table public.companies add column if not exists needs_qb_setup boolean not null default false;
alter table public.companies add column if not exists created_by     uuid;  -- who added it (no foreign key: a second profiles<->companies link breaks the app's joins)
alter table public.companies drop constraint if exists companies_created_by_fkey;

do $$ begin
  alter table public.companies add constraint companies_source_check check (source in ('admin', 'quickbooks', 'app'));
exception when duplicate_object then null; end $$;

create unique index if not exists companies_qb_id_key on public.companies(qb_id) where qb_id is not null;
create index if not exists companies_name_idx on public.companies(lower(name));

-- Employees (not just admins) may add customers. Only admins can edit or delete them.
drop policy if exists companies_employee_insert on public.companies;
create policy companies_employee_insert on public.companies for insert to authenticated
  with check (public.is_employee() and source = 'app' and needs_qb_setup and created_by = auth.uid());
