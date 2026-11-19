-- 0095: Black Friday prices on items that are normally priced per customer (fiberglass batts and blow-in) and on
-- items with no list price (Mark II blow hoses).
--  * adc_catalog(): an item with a sale price shows that price on the ADC store, even with no list price; when the
--    sale ends it goes back to "Request a quote".
--  * adc_place_order(): the spray foam $/lb promo only goes on AMBIT spray foam (not on fiberglass).
--  * Puts the fiberglass and insulation accessories that have our cost on the Black Friday sheet (no sale price yet).
-- Safe to run again.

create or replace function public.adc_catalog()
returns table (id uuid, sku text, name text, description text, unit text, category_id text, category text, cat_sort int,
               list_price numeric, quote boolean, sale_price numeric, image text, sort int)
language sql stable security definer set search_path = public as $fn$
  with sale as (select s.id from public.web_sales s
                 where s.active and (now() at time zone 'America/Chicago')::date between s.starts_on and s.ends_on
                 order by s.ends_on limit 1)
  select pr.id, pr.sku, pr.name, pr.description, pr.unit, pr.category_id, c.name, coalesce(c.sort, 999),
         case when coalesce(pr.customer_priced, c.customer_priced, false) then null else pr.list_price end,
         (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null) and sp.price is null,
         sp.price,
         pr.adc_image_url, coalesce(pr.sort, 0)
    from public.products pr
    left join public.categories c on c.id = pr.category_id
    left join lateral (
      select i.price from public.web_sale_items i join sale on sale.id = i.sale_id
       where i.product_id = pr.id and i.price is not null and pr.category_id is distinct from 'ambit-foam'
         and (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null or i.price < pr.list_price)
       limit 1
    ) sp on true
   where pr.active and not coalesce(pr.admin_only, false) and not coalesce(c.admin_only, false)
$fn$;
revoke execute on function public.adc_catalog() from public;
grant execute on function public.adc_catalog() to anon, authenticated;

create or replace function public.adc_place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_quote boolean := false;
  v_sale text;
  v_foam numeric;
  v_id bigint;
  r record;
  q numeric;
  price numeric;
  em text := lower(trim(coalesce(p->>'email', '')));
begin
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please add your name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please add a good email address.'; end if;
  if length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) < 10 then raise exception 'Please add a phone number.'; end if;
  if coalesce(p->>'delivery', 'ship') = 'ship' and (length(trim(coalesce(p#>>'{address,street}', ''))) < 3 or length(trim(coalesce(p#>>'{address,zip}', ''))) < 5) then
    raise exception 'Please add the address to ship to.';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Your cart is empty.'; end if;
  if jsonb_array_length(p->'items') > 120 then raise exception 'That is a lot of lines. Please call us for an order this size.'; end if;
  -- Slow down floods: 5 orders an hour per email, 60 an hour in all.
  if (select count(*) from public.adc_orders where lower(email) = em and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.adc_orders where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We got several orders from you just now. Please call us and we will help.';
  end if;

  select a.slug, a.foam_off_per_lb into v_sale, v_foam from public.adc_sale() a limit 1;

  for r in
    select x.product_id, x.sku as x_sku, x.name as x_name, x.qty, a.id, a.sku, a.name, a.unit, a.list_price, a.quote, a.sale_price, a.category_id
      from jsonb_to_recordset(p->'items') as x(product_id text, sku text, name text, qty numeric)
      left join public.adc_catalog() a on a.id::text = x.product_id
  loop
    q := round(coalesce(r.qty, 0));
    if q < 1 or q > 9999 then continue; end if;
    if r.product_id is not null then
      if r.id is null then continue; end if;
      price := case when r.quote then null else coalesce(r.sale_price, r.list_price) end;
      if price is null then v_quote := true; else v_sub := v_sub + price * q; end if;
      v_items := v_items || jsonb_build_object('product_id', r.id, 'sku', r.sku, 'name', r.name, 'unit', r.unit, 'qty', q,
        'price', price, 'list_price', r.list_price, 'on_sale', r.sale_price is not null and not r.quote,
        'promo', case when r.quote and r.category_id = 'ambit-foam' and v_foam is not null then '$' || to_char(v_foam, 'FM0.00') || ' per lb off your price (sale)' end);
    else
      -- A part from a parts diagram that isn't in the catalog yet: AMBIT confirms the price.
      if length(trim(coalesce(r.x_sku, ''))) = 0 then continue; end if;
      v_quote := true;
      v_items := v_items || jsonb_build_object('product_id', null, 'sku', left(trim(r.x_sku), 40), 'name', left(trim(coalesce(r.x_name, 'Part')), 160),
        'unit', 'each', 'qty', q, 'price', null);
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Your cart is empty.'; end if;

  insert into public.adc_orders (name, company, email, phone, delivery, pickup_branch, address, notes, items, subtotal, has_quote, sale_slug)
  values (left(trim(p->>'name'), 120), nullif(left(trim(coalesce(p->>'company', '')), 160), ''), left(em, 160), left(trim(p->>'phone'), 40),
          case when p->>'delivery' = 'pickup' then 'pickup' else 'ship' end, nullif(left(coalesce(p->>'pickup_branch', ''), 40), ''),
          case when p->>'delivery' = 'pickup' then null else jsonb_build_object(
            'street', left(trim(coalesce(p#>>'{address,street}', '')), 160), 'street2', left(trim(coalesce(p#>>'{address,street2}', '')), 160),
            'city', left(trim(coalesce(p#>>'{address,city}', '')), 80), 'state', upper(left(trim(coalesce(p#>>'{address,state}', '')), 2)),
            'zip', left(trim(coalesce(p#>>'{address,zip}', '')), 10)) end,
          nullif(left(trim(coalesce(p->>'notes', '')), 2000), ''), v_items, round(v_sub, 2), v_quote, v_sale)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'order_no', 'ADC-' || (1000 + v_id), 'subtotal', round(v_sub, 2), 'has_quote', v_quote);
end $fn$;
revoke execute on function public.adc_place_order(jsonb) from public;
grant execute on function public.adc_place_order(jsonb) to anon, authenticated;

insert into public.web_sale_items (sale_id, product_id)
select s.id, pr.id
  from public.web_sales s
  join public.products pr on pr.active and pr.list_price is null and not coalesce(pr.admin_only, false)
 where s.slug = 'black-friday-2026'
   and pr.category_id in ('fiberglass', 'insulation-accessories')
   and exists (select 1 from public.product_costs pc where pc.product_id = pr.id)
on conflict do nothing;

-- Check: how many fiberglass / accessory items are on the Black Friday sheet now
select count(*) as "Fiberglass and accessories on the sheet"
  from public.web_sale_items i join public.products pr on pr.id = i.product_id
  join public.web_sales s on s.id = i.sale_id
 where s.slug = 'black-friday-2026' and pr.category_id in ('fiberglass', 'insulation-accessories') and pr.list_price is null;
