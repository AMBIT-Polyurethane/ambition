-- 0102: the sale price everyone sees on ADC is only 5% under our normal price (spray foam excluded).
-- Normal price = the list price, or for items without one (fiberglass) the SELL PRICE on the inventory spreadsheet.
-- An item never shows below its real sale price, and an item with no normal price stays "Request a quote".
-- Current AMBIT customers still get the full sale price: the app applies it to their web order (see the app code).
-- Safe to run again.

create or replace function public.adc_catalog()
returns table (id uuid, sku text, name text, description text, unit text, category_id text, category text, cat_sort int,
               list_price numeric, quote boolean, sale_price numeric, image text, sort int, ship text, truck_qty numeric, is_set boolean)
language sql stable security definer set search_path = public as $fn$
  with sale as (select s.id from public.web_sales s
                 where s.active and (now() at time zone 'America/Chicago')::date between s.starts_on and s.ends_on
                 order by s.ends_on limit 1)
  select pr.id, pr.sku, pr.name, pr.description, pr.unit, pr.category_id, c.name, coalesce(c.sort, 999),
         case when coalesce(pr.customer_priced, c.customer_priced, false) then null else pr.list_price end,
         (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null) and sp.price is null,
         sp.price,
         pr.adc_image_url, coalesce(pr.sort, 0),
         coalesce(pr.adc_ship, c.adc_ship, 'parcel'), pr.truck_qty, pr.adc_set
    from public.products pr
    left join public.categories c on c.id = pr.category_id
    left join lateral (
      select max(v.sell_price) as price from public.inventory v where v.product_id = pr.id and v.sell_price > 0
    ) sheet on true
    left join lateral (
      select greatest(i.price, round(coalesce(pr.list_price, sheet.price) * 0.95, 2)) as price
        from public.web_sale_items i join sale on sale.id = i.sale_id
       where i.product_id = pr.id and i.price is not null and pr.category_id is distinct from 'ambit-foam'
         and coalesce(pr.list_price, sheet.price) is not null
         and (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null or i.price < pr.list_price)
       limit 1
    ) sp on true
   where pr.active and not coalesce(pr.admin_only, false) and not coalesce(c.admin_only, false) and not pr.adc_hide
$fn$;
revoke execute on function public.adc_catalog() from public;
grant execute on function public.adc_catalog() to anon, authenticated;

-- Check: what a shopper sees now for a few sale items (normal price, the posted sale price, and the full sale price).
select pr.sku as "Item", coalesce(pr.list_price, (select max(sell_price) from public.inventory v where v.product_id = pr.id)) as "Normal",
       a.sale_price as "ADC shows", i.price as "AMBIT customers"
  from public.web_sale_items i
  join public.web_sales s on s.id = i.sale_id and s.active
  join public.products pr on pr.id = i.product_id
  left join public.adc_catalog() a on a.id = pr.id
 where i.price is not null and a.id is not null
 order by pr.sku
 limit 12;
