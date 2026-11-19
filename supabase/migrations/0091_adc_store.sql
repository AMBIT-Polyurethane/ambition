-- 0091: the ADC web store (AMBIT Distribution Centers), the Black Friday sale sheet and our costs.
--  * products.adc_image_url: the ADC-logo photo the web store shows (the app keeps image_url, the AMBIT-logo one).
--  * product_costs: what AMBIT pays for each item (admins only; never shown to customers).
--  * web_sales + web_sale_items: a sale on the ADC store (Black Friday 2026: Nov 19 to Nov 30) and each item's sale price.
--  * adc_orders: orders placed on the ADC store as a guest (no payment; the team follows up).
--  * adc_catalog(), adc_sale(), adc_place_order(): what the public store can read and do. Nothing else is open to guests.
-- Safe to run again.

alter table public.products add column if not exists adc_image_url text;

-- ---------------------------------------------------------------- costs (admins only)
create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost numeric(12,4) not null check (cost >= 0),
  source text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.product_costs enable row level security;
drop policy if exists product_costs_admin on public.product_costs;
create policy product_costs_admin on public.product_costs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Load or update costs by SKU: [{"sku": "336508", "cost": 2806.30}, ...]. Returns how many matched.
create or replace function public.admin_set_costs(p jsonb, p_source text default null) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only admins can change costs.'; end if;
  insert into public.product_costs (product_id, cost, source, updated_at, updated_by)
  select pr.id, x.cost, left(coalesce(p_source, 'upload'), 120), now(), auth.uid()
    from jsonb_to_recordset(p) as x(sku text, cost numeric)
    join public.products pr on lower(pr.sku) = lower(trim(x.sku))
   where x.cost is not null and x.cost >= 0
  on conflict (product_id) do update set cost = excluded.cost, source = excluded.source, updated_at = now(), updated_by = auth.uid();
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke execute on function public.admin_set_costs(jsonb, text) from public, anon;
grant execute on function public.admin_set_costs(jsonb, text) to authenticated;

-- ADC photos, matched by SKU like the app's photos.
create or replace function public.admin_set_adc_images(p jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only admins can change product photos.'; end if;
  update public.products pr set adc_image_url = x.url
    from jsonb_to_recordset(p) as x(sku text, url text)
   where lower(pr.sku) = lower(x.sku);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke execute on function public.admin_set_adc_images(jsonb) from public, anon;
grant execute on function public.admin_set_adc_images(jsonb) to authenticated;

-- ---------------------------------------------------------------- sales on the ADC store
create table if not exists public.web_sales (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Spray foam is priced per customer, so a sale takes a flat amount off each customer's own $/lb (Black Friday: $0.05).
alter table public.web_sales add column if not exists foam_off_per_lb numeric(8,4);
create table if not exists public.web_sale_items (
  sale_id bigint not null references public.web_sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(12,2) check (price is null or price >= 0),
  updated_at timestamptz not null default now(),
  primary key (sale_id, product_id)
);
alter table public.web_sales enable row level security;
alter table public.web_sale_items enable row level security;
drop policy if exists web_sales_admin on public.web_sales;
create policy web_sales_admin on public.web_sales for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists web_sale_items_admin on public.web_sale_items;
create policy web_sale_items_admin on public.web_sale_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Black Friday 2026, today through Cyber Monday. Every item with a list price starts on the sheet;
-- Jeremiah deletes the ones that aren't in the sale and types the sale prices.
insert into public.web_sales (slug, name, starts_on, ends_on, foam_off_per_lb)
values ('black-friday-2026', 'Black Friday', date '2026-11-19', date '2026-11-30', 0.05)
on conflict (slug) do nothing;
update public.web_sales set foam_off_per_lb = 0.05 where slug = 'black-friday-2026' and foam_off_per_lb is null;
insert into public.web_sale_items (sale_id, product_id)
select s.id, pr.id
  from public.web_sales s
  join public.products pr on pr.active and pr.list_price is not null and not coalesce(pr.admin_only, false)
  left join public.categories c on c.id = pr.category_id
 where s.slug = 'black-friday-2026'
   and not coalesce(pr.customer_priced, c.customer_priced, false)
   and not coalesce(c.admin_only, false)
   and not exists (select 1 from public.web_sale_items i where i.sale_id = s.id)
on conflict do nothing;

-- The sale running today (Central time), if any.
drop function if exists public.adc_sale();
create function public.adc_sale() returns table (slug text, name text, starts_on date, ends_on date, foam_off_per_lb numeric)
language sql stable security definer set search_path = public as $fn$
  select s.slug, s.name, s.starts_on, s.ends_on, s.foam_off_per_lb
    from public.web_sales s
   where s.active and (now() at time zone 'America/Chicago')::date between s.starts_on and s.ends_on
   order by s.ends_on
   limit 1
$fn$;
revoke execute on function public.adc_sale() from public;
grant execute on function public.adc_sale() to anon, authenticated;

-- Everything the public store shows: active items that aren't private label. Items priced per customer show no price
-- ("Request a quote"). No costs, stock or customer data.
create or replace function public.adc_catalog()
returns table (id uuid, sku text, name text, description text, unit text, category_id text, category text, cat_sort int,
               list_price numeric, quote boolean, sale_price numeric, image text, sort int)
language sql stable security definer set search_path = public as $fn$
  with sale as (select s.id from public.web_sales s
                 where s.active and (now() at time zone 'America/Chicago')::date between s.starts_on and s.ends_on
                 order by s.ends_on limit 1)
  select pr.id, pr.sku, pr.name, pr.description, pr.unit, pr.category_id, c.name, coalesce(c.sort, 999),
         case when coalesce(pr.customer_priced, c.customer_priced, false) then null else pr.list_price end,
         coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null,
         (select i.price from public.web_sale_items i join sale on sale.id = i.sale_id
           where i.product_id = pr.id and i.price is not null and not coalesce(pr.customer_priced, c.customer_priced, false)
             and i.price < coalesce(pr.list_price, i.price + 1)),
         pr.adc_image_url, coalesce(pr.sort, 0)
    from public.products pr
    left join public.categories c on c.id = pr.category_id
   where pr.active and not coalesce(pr.admin_only, false) and not coalesce(c.admin_only, false)
$fn$;
revoke execute on function public.adc_catalog() from public;
grant execute on function public.adc_catalog() to anon, authenticated;

-- ---------------------------------------------------------------- guest orders
create table if not exists public.adc_orders (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'working', 'done', 'cancelled')),
  name text not null,
  company text,
  email text not null,
  phone text not null,
  delivery text not null default 'ship' check (delivery in ('ship', 'pickup')),
  pickup_branch text,
  address jsonb,
  notes text,
  items jsonb not null,
  subtotal numeric(12,2) not null default 0,
  has_quote boolean not null default false,
  sale_slug text,
  emailed_at timestamptz,
  email_status text,
  staff_note text,
  handled_by uuid,
  handled_by_name text,
  handled_at timestamptz
);
alter table public.adc_orders enable row level security;
drop policy if exists adc_orders_staff_read on public.adc_orders;
create policy adc_orders_staff_read on public.adc_orders for select to authenticated
  using (public.is_admin() or public.has_perm('order_desk') or public.has_perm('ordering'));
drop policy if exists adc_orders_staff_update on public.adc_orders;
create policy adc_orders_staff_update on public.adc_orders for update to authenticated
  using (public.is_admin() or public.has_perm('order_desk')) with check (public.is_admin() or public.has_perm('order_desk'));

-- A guest places an order. Prices come from the database (today's sale price if lower), never from the browser.
-- p: {name, company, email, phone, delivery, pickup_branch, address:{street, street2, city, state, zip}, notes,
--     items:[{product_id, qty} or {sku, name, qty} for parts not in the catalog]}
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
    select x.product_id, x.sku as x_sku, x.name as x_name, x.qty, a.id, a.sku, a.name, a.unit, a.list_price, a.quote, a.sale_price
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
        'promo', case when r.quote and v_foam is not null then '$' || to_char(v_foam, 'FM0.00') || ' per lb off your price (sale)' end);
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

-- After the email goes out, the app notes it on the order (the guest who placed it can't read orders back).
create or replace function public.adc_mark_emailed(p_id bigint, p_status text) returns void
language sql security definer set search_path = public as $fn$
  update public.adc_orders set emailed_at = now(), email_status = left(p_status, 40)
   where id = p_id and emailed_at is null and created_at > now() - interval '10 minutes'
$fn$;
revoke execute on function public.adc_mark_emailed(bigint, text) from public;
grant execute on function public.adc_mark_emailed(bigint, text) to anon, authenticated;

select 'Ready' as "Check",
  (select count(*) from public.web_sale_items i join public.web_sales s on s.id = i.sale_id where s.slug = 'black-friday-2026') as "Items on the Black Friday sheet",
  (select count(*) from public.adc_catalog()) as "Items in the ADC store";
