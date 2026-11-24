-- 0114: Contractors Foam Supply's store, ready for Nick, plus CFS's price to AMBIT kept private.
--  * CFS's price to AMBIT for each gun part moves out of the products list (any signed-in login could read it there)
--    into vendor_costs, which only admins can read. Drop ships and the admin price sheets read it from there.
--  * Each distributor store is linked to its AMBIT customer account (CFS = Contractors Foam Supply), so the owner can
--    fill his purchase prices from the prices set for his account in A.I. (foam per lb, everything else per unit).
--    Only his own account prices count, never AMBIT's list price.
--  * Graco and Binks parts show MSRP to anyone who isn't signed in (the makers allow no other advertised price).
--    Signed-in customers see their own price. Parts with no sell price yet start at MSRP.
--  * The owner can set sell prices by markup for one product group at a time.
--  * The owner's login shows his full name, and AMBIT can hand the login to him (a password only he knows).
-- Run AFTER the 1124g update is live on the site (push first, then this). Run once in Supabase > SQL Editor. Safe to run again.

-- ---------------------------------------------------------------- CFS's price to AMBIT, admins only
create table if not exists public.vendor_costs (
  product_id  uuid primary key references public.products(id) on delete cascade,
  partner_id  text references public.partners(id) on delete set null,
  cost        numeric(12,2) not null check (cost >= 0),
  updated_at  timestamptz not null default now()
);
alter table public.vendor_costs enable row level security;
drop policy if exists vendor_costs_admin on public.vendor_costs;
create policy vendor_costs_admin on public.vendor_costs for select to authenticated using (public.is_admin());

insert into public.vendor_costs (product_id, partner_id, cost)
select p.id, p.drop_ship_partner, p.vendor_cost from public.products p where p.vendor_cost is not null
on conflict (product_id) do update set cost = excluded.cost, partner_id = excluded.partner_id, updated_at = now();
update public.products set vendor_cost = null where vendor_cost is not null;

-- ---------------------------------------------------------------- a store's AMBIT customer account
alter table public.partners add column if not exists company_id uuid references public.companies(id) on delete set null;
update public.partners p
   set company_id = (select c.id from public.companies c where lower(trim(c.name)) = 'contractors foam supply' order by c.active desc limit 1)
 where p.id = 'cfs' and p.company_id is null;

-- What AMBIT charges the store for each item it buys from AMBIT (not the parts the store itself drop ships for AMBIT).
-- Foam stays per lb; everything else is per unit (a bag, a box, each).
create or replace function public.partner_ambit_prices(p_partner text)
returns table (item_id uuid, ambit_price numeric)
language sql stable security definer set search_path = public as $fn$
  select i.id,
         case when i.basis = 'lb' then case when pf.basis = 'lb' then round(pf.price, 4) end
              else public.price_per_unit(pf.price, pf.basis, i.product_id) end
    from public.partner_items i
    join public.partners p on p.id = i.partner_id and p.company_id is not null
    join public.products pr on pr.id = i.product_id
    cross join lateral public.price_for(p.company_id, i.product_id) pf
   where i.partner_id = p_partner
     and pf.source = 'customer'   -- only prices set for this store's account, never AMBIT's list price
     and pr.drop_ship_partner is distinct from p_partner
     and (public.my_partner() = p_partner or public.can_view_partner(p_partner))
$fn$;
revoke all on function public.partner_ambit_prices(text) from public, anon;
grant execute on function public.partner_ambit_prices(text) to authenticated;

-- The owner: fill purchase prices from those AMBIT prices (only the empty ones, unless he says replace them all).
create or replace function public.partner_ambit_costs(p_partner text, p_only_empty boolean default true) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if public.my_partner() is distinct from p_partner then raise exception 'Only the store owner can change prices.'; end if;
  if not exists (select 1 from public.partners where id = p_partner and company_id is not null) then
    raise exception 'Your store isn''t linked to your AMBIT account yet. Ask AMBIT to link it.';
  end if;
  update public.partner_items i
     set cost = a.ambit_price, updated_at = now()
    from public.partner_ambit_prices(p_partner) a
   where i.id = a.item_id and a.ambit_price is not null and i.active
     and (not coalesce(p_only_empty, true) or i.cost is null);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.partner_ambit_costs(text, boolean) from public, anon;
grant execute on function public.partner_ambit_costs(text, boolean) to authenticated;

-- ---------------------------------------------------------------- markup by product group
drop function if exists public.partner_apply_markup(text, numeric, boolean);
create or replace function public.partner_apply_markup(p_partner text, p_pct numeric, p_only_empty boolean, p_category text default null) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if public.my_partner() is distinct from p_partner then raise exception 'Only the store owner can change prices.'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 1000 then raise exception 'Use a markup between 0 and 1000 percent.'; end if;
  update public.partner_items
     set price = round(cost * (1 + p_pct / 100), 2), updated_at = now()
   where partner_id = p_partner and active and not per_customer and cost is not null
     and (not p_only_empty or price is null)
     and (nullif(trim(coalesce(p_category, '')), '') is null or category = p_category);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.partner_apply_markup(text, numeric, boolean, text) from public, anon;
grant execute on function public.partner_apply_markup(text, numeric, boolean, text) to authenticated;

-- ---------------------------------------------------------------- the store's catalog: MSRP for Graco / Binks parts
drop function if exists public.partner_catalog(text);
create or replace function public.partner_catalog(p_partner text)
returns table (id uuid, sku text, name text, description text, category text, unit text, image_url text,
               price numeric, per_customer boolean, basis text, in_stock boolean, my_price numeric, sort int, msrp boolean)
language sql stable security definer set search_path = public as $fn$
  with me as (
    select c.id, c.off_pct from public.partner_customers c
     where c.id = public.my_partner_customer() and c.partner_id = p_partner and c.active
  )
  select i.id, i.sku, i.name, i.description, i.category, i.unit, i.image_url,
         -- what anyone sees: the maker's MSRP when it has one, else the store's price
         case when i.per_customer then null when pr.msrp is not null then pr.msrp else i.price end,
         i.per_customer, i.basis,
         case when i.qty_on_hand is null then null else i.qty_on_hand > 0 end,
         -- a signed-in customer: their own price, else the store's price less their discount
         (select coalesce(cp.price, case when i.per_customer or coalesce(i.price, pr.msrp) is null then null
                                         else round(coalesce(i.price, pr.msrp) * (1 - me.off_pct / 100), 2) end)
            from me left join public.partner_customer_prices cp on cp.customer_id = me.id and cp.item_id = i.id),
         i.sort,
         (pr.msrp is not null and not i.per_customer)
    from public.partner_items i
    join public.partners p on p.id = i.partner_id and p.active
    left join public.products pr on pr.id = i.product_id
   where i.partner_id = p_partner and i.active
$fn$;
revoke all on function public.partner_catalog(text) from public;
grant execute on function public.partner_catalog(text) to anon, authenticated;

-- ---------------------------------------------------------------- CFS: a head start on the price sheet
-- Graco / Binks parts with no sell price start at MSRP (Nick can change any of them).
update public.partner_items i
   set price = pr.msrp, updated_at = now()
  from public.products pr
 where pr.id = i.product_id and i.partner_id = 'cfs' and i.price is null and not i.per_customer and pr.msrp is not null;
-- Purchase prices from what AMBIT charges CFS, where none is typed yet.
update public.partner_items i
   set cost = a.ambit_price, updated_at = now()
  from (select x.item_id, x.ambit_price from public.partners p
          cross join lateral (
            select i2.id as item_id,
                   case when i2.basis = 'lb' then case when pf.basis = 'lb' then round(pf.price, 4) end
                        else public.price_per_unit(pf.price, pf.basis, i2.product_id) end as ambit_price
              from public.partner_items i2
              join public.products pr on pr.id = i2.product_id
              cross join lateral public.price_for(p.company_id, i2.product_id) pf
             where i2.partner_id = p.id and pf.source = 'customer' and pr.drop_ship_partner is distinct from p.id) x
         where p.id = 'cfs' and p.company_id is not null) a
 where i.id = a.item_id and a.ambit_price is not null and i.cost is null;

-- Handing a store's login to its owner (Admin > Distributor stores): anyone signed in as the owner is signed out.
-- Only the server (service key) can run this.
create or replace function public.partner_owner_signout(p_partner text) returns int
language plpgsql security definer set search_path = public, auth as $fn$
declare n int := 0; u uuid;
begin
  select id into u from public.profiles where partner_id = p_partner and partner_role = 'owner' limit 1;
  if u is null then return 0; end if;
  delete from auth.sessions where user_id = u;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.partner_owner_signout(text) from public, anon, authenticated;
grant execute on function public.partner_owner_signout(text) to service_role;

-- The owner's name on his login.
update public.profiles set full_name = 'Nick Blomberg'
 where partner_id = 'cfs' and partner_role = 'owner' and coalesce(trim(full_name), '') in ('', 'Nick');

notify pgrst, 'reload schema';

-- Check: CFS linked to its AMBIT account (1), CFS prices moved (should be about 267), CFS items with a sell price.
select (select count(*) from public.partners where id = 'cfs' and company_id is not null) as "CFS linked (1)",
       (select count(*) from public.vendor_costs) as "CFS prices kept private",
       (select count(*) from public.partner_items where partner_id = 'cfs' and price is not null) as "CFS items with a sell price",
       (select count(*) from public.partner_items where partner_id = 'cfs' and cost is not null) as "CFS items with a purchase price";
