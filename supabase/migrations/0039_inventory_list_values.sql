-- =====================================================================
-- AMBIT Intelligence update 0039 - Inventory List values (dashboards only)
-- * A base "List value" per item, set by admins in Inventory Hub > List values. The Inventory Hub
--   (dashboard and reports) values stock at it: List value first, then the location's COUNT SHEET
--   Sell Price, then the catalog price. Order history is no longer used to value stock.
-- * Kept in its own table that only staff with inventory access can read, so it never reaches the
--   order screens, Place an order, or any customer.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.product_values (
  product_id      uuid primary key references public.products(id) on delete cascade,
  list_value      numeric(12,2) not null check (list_value >= 0),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
alter table public.product_values enable row level security;
revoke all on public.product_values from anon;
grant select, insert, update, delete on public.product_values to authenticated;

-- Read: admins and staff with any inventory access (the Inventory Hub). Customers never.
drop policy if exists product_values_read on public.product_values;
create policy product_values_read on public.product_values for select to authenticated
  using ((select public.is_admin()) or (select public.has_perm('inventory')) or (select public.has_perm('inv_reports'))
         or (select public.has_perm('receiving')) or (select public.has_perm('transfers')));
-- Change: admins only.
drop policy if exists product_values_write on public.product_values;
create policy product_values_write on public.product_values for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Private label items stay admin-only here too.
drop policy if exists product_values_private on public.product_values;
create policy product_values_private on public.product_values as restrictive for select to authenticated
  using (not (product_id = any (coalesce((select public.hidden_products()), '{}'::uuid[]))));

select 'inventory list values ready' as status;
