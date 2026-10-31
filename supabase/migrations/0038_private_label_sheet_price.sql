-- =====================================================================
-- AMBIT Intelligence update 0038 - Private label products, sheet sell prices
-- * Private label products (Alpha) are for admins only: nobody else sees them anywhere in the app
--   (catalog, ordering, stock, receiving, transfers, counts, reports, orders, logs). A product is
--   private when it's marked "Private label" in Admin > Products, or its group is (Alpha Chemicals is).
--   Daily spot checks never pick one.
-- * Each location's Sell Price from its COUNT SHEET is kept on the stock row (inventory.sell_price),
--   so the Inventory Hub values stock at the sheet's price.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.inventory  add column if not exists sell_price numeric(12,2);
alter table public.products   add column if not exists admin_only boolean not null default false;
alter table public.categories add column if not exists admin_only boolean not null default false;

update public.categories set admin_only = true where id = 'alpha-chemicals' and not admin_only;
update public.products set admin_only = true where (sku ilike 'ALPHA-%' or category_id = 'alpha-chemicals') and not admin_only;

-- Every private product (for the app's own rules), and what the signed-in person can't see.
create or replace function public.private_products() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
    from public.products p left join public.categories c on c.id = p.category_id
   where p.admin_only or coalesce(c.admin_only, false)
$$;
create or replace function public.hidden_products() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then '{}'::uuid[] else public.private_products() end
$$;
create or replace function public.hidden_skus() returns text[]
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then '{}'::text[]
              else coalesce((select array_agg(upper(p.sku)) from public.products p where p.id = any (public.private_products())), '{}'::text[]) end
$$;
revoke all on function public.private_products() from public, anon;
revoke all on function public.hidden_products() from public, anon;
revoke all on function public.hidden_skus() from public, anon;
grant execute on function public.private_products() to authenticated;
grant execute on function public.hidden_products() to authenticated;
grant execute on function public.hidden_skus() to authenticated;

-- Restrictive rules: they apply on top of every other read rule, so a private product never shows
-- for anyone but an admin, whatever screen asks.
drop policy if exists products_private on public.products;
create policy products_private on public.products as restrictive for select to authenticated
  using (not (id = any (coalesce((select public.hidden_products()), '{}'::uuid[]))));
drop policy if exists categories_private on public.categories;
create policy categories_private on public.categories as restrictive for select to authenticated
  using ((select public.is_admin()) or not admin_only);
do $$
declare t text;
begin
  foreach t in array array['inventory', 'inventory_lots', 'inventory_lines', 'inbound_lines', 'inventory_transfer_lines', 'inventory_count_lines', 'order_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_private', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (not (product_id = any (coalesce((select public.hidden_products()), ''{}''::uuid[]))))', t || '_private', t);
  end loop;
end $$;
drop policy if exists inventory_log_private on public.inventory_log;
create policy inventory_log_private on public.inventory_log as restrictive for select to authenticated
  using (sku is null or not (upper(sku) = any (coalesce((select public.hidden_skus()), '{}'::text[]))));

-- Daily spot checks: never a private product (the warehouse can't see it).
create or replace function public.spot_check_ensure(p_branch text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  last  date;
  d     date;
  cyc   int;
  c     bigint;
  pid   uuid;
  psku  text;
  pname text;
  punit text;
  priv  uuid[] := public.private_products();
begin
  if not (public.is_admin() or public.has_perm('inventory')) then return; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then return; end if;
  perform pg_advisory_xact_lock(hashtext('spot_check:' || p_branch));
  select max(day) into last from public.inventory_counts where branch_id = p_branch and kind = 'spot';
  d := greatest(coalesce(last + 1, today), today - 21);
  while d <= today loop
    if extract(isodow from d) between 1 and 5 then
      select coalesce(max(cycle), 1) into cyc from public.inventory_counts where branch_id = p_branch and kind = 'spot';
      pid := null;
      -- Something actually stocked here that hasn't had its turn this cycle.
      select i.product_id, i.sku, p.name, p.unit into pid, psku, pname, punit
        from public.inventory i join public.products p on p.id = i.product_id
       where i.branch_id = p_branch and i.on_sheet and not (i.product_id = any (priv))
         and (i.on_hand is not null or exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = i.product_id and x.on_sheet))
         and not exists (select 1 from public.inventory_count_lines l join public.inventory_counts k on k.id = l.count_id
                          where k.branch_id = p_branch and k.kind = 'spot' and k.cycle = cyc and l.product_id = i.product_id)
       order by random() limit 1;
      if pid is null then
        -- Every item has had a turn: start the next round.
        cyc := cyc + 1;
        select i.product_id, i.sku, p.name, p.unit into pid, psku, pname, punit
          from public.inventory i join public.products p on p.id = i.product_id
         where i.branch_id = p_branch and i.on_sheet and not (i.product_id = any (priv))
           and (i.on_hand is not null or exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = i.product_id and x.on_sheet))
         order by random() limit 1;
      end if;
      if pid is not null then
        c := null;
        insert into public.inventory_counts (branch_id, kind, day, cycle, status, started_by_name)
        values (p_branch, 'spot', d, cyc, 'open', 'AMBIT A.I.')
        on conflict do nothing
        returning id into c;
        if c is not null then
          if exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = pid and x.on_sheet) then
            insert into public.inventory_count_lines (count_id, product_id, sku, name, unit, lot_id, lot_no)
            select c, pid, x.sku, pname, punit, x.id, nullif(x.lot_no, '')
              from public.inventory_lots x
             where x.branch_id = p_branch and x.product_id = pid and x.on_sheet
             order by x.use_by nulls last, x.id;
          else
            insert into public.inventory_count_lines (count_id, product_id, sku, name, unit) values (c, pid, psku, pname, punit);
          end if;
        end if;
      end if;
    end if;
    d := d + 1;
  end loop;
end $$;

select 'private label and sheet prices ready' as status;
