-- =====================================================================
-- AMBITION - Sale prices and the home screen banner
-- * products.sale_price / sale_ends: a product on sale shows its sale
--   price in the app and is charged that price on new orders. Leave
--   sale_ends blank to keep the sale going until it's removed.
-- * promos: the slides in the scrolling banner at the top of Home
--   (Admin → Home banner). Starts with Jet Stream, the Carlisle ST1 gun,
--   Chem-Trend silicone and the distribution centers map.
-- Safe to run more than once.
-- =====================================================================

alter table public.products add column if not exists sale_price numeric(12,2);
alter table public.products add column if not exists sale_ends date;  -- last day of the sale (blank = no end date)

-- Is a sale running today? (AMBIT's day: Central time)
create or replace function public.sale_on(p_price numeric, p_ends date) returns boolean
language sql stable set search_path = public as $$
  select p_price is not null and (p_ends is null or p_ends >= (now() at time zone 'America/Chicago')::date);
$$;

create table if not exists public.promos (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'product' check (kind in ('product', 'locations', 'custom')),
  product_id uuid references public.products(id) on delete set null,
  eyebrow    text,                                   -- small label over the title
  title      text not null,
  subtitle   text,
  image_url  text,
  link       text,                                   -- blank = the product in Order (or Branches for the map)
  theme      text not null default 'blue',
  audience   text not null default 'all' check (audience in ('all', 'employee', 'customer')),
  sort       int not null default 0,
  active     boolean not null default true,
  starts_on  date,
  ends_on    date,
  created_at timestamptz not null default now()
);

alter table public.promos enable row level security;
drop policy if exists promos_read on public.promos;
create policy promos_read on public.promos for select to authenticated
  using (public.is_admin() or (active and public.is_active()));
drop policy if exists promos_admin on public.promos;
create policy promos_admin on public.promos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The first four slides (only when the banner is empty).
insert into public.promos (kind, product_id, eyebrow, title, subtitle, image_url, theme, sort)
select v.kind, (select id from public.products where sku = v.sku limit 1), v.eyebrow, v.title, v.subtitle, v.image_url, v.theme, v.sort
  from (values
    ('product',   '5003646',    'On sale',               'Knauf Jet Stream Ultra', 'Blowing insulation for attics, floors and walls', '/promos/jetstream.webp', 'green', 1),
    ('product',   '336508',     'Featured gun',          'Carlisle ST1 Gun',       'Spray foam gun, ready to order in the app',       '/promos/st1.webp',       'dark',  2),
    ('product',   '1330521318', 'On sale',               'SprayFoam Silicone',     'Chem-Trend 10.5 oz aerosol release',            '/promos/chemtrend.webp', 'red',   3),
    ('locations', null,         'AMBIT Distribution',    '5 distribution centers', 'Spray foam, fiberglass, guns and parts stocked close to your jobs.', '/promos/map-south.svg', 'blue', 4)
  ) as v(kind, sku, eyebrow, title, subtitle, image_url, theme, sort)
 where not exists (select 1 from public.promos);

-- Sale prices from the banner.
update public.products set sale_price = 33.50 where sku = '5003646' and sale_price is null;     -- Jet Stream, a bag
update public.products set sale_price = 14.95 where sku = '1330521318' and sale_price is null;  -- Chem-Trend 10.5 oz

-- ---------- Placing an order: charge sale prices (otherwise unchanged from 0010) ----------
create or replace function public.place_order(
  p_items           jsonb,
  p_delivery_method text,
  p_branch_id       text default null,
  p_ship_address    text default null,
  p_po_number       text default null,
  p_needed_by       date default null,
  p_notes           text default null,
  p_company_id      uuid default null,
  p_customer_name   text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me       public.profiles;
  co       public.companies;
  new_id   uuid;
  item     jsonb;
  pr       record;
  q        numeric;
  subtotal numeric := 0;
  any_cp   boolean := false;
  n        int := 0;
  v_branch text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then
    raise exception 'Your account is not active yet.';
  end if;

  if me.role = 'customer' then
    if me.company_id is null then
      raise exception 'Your account is not linked to a company yet. Please contact AMBIT.';
    end if;
    select * into co from public.companies where id = me.company_id;
  elsif p_company_id is not null then
    select * into co from public.companies where id = p_company_id;
  end if;

  if p_delivery_method is null or p_delivery_method not in ('pickup', 'jobsite', 'dropship') then
    raise exception 'Choose how you want the order delivered.';
  end if;
  if p_delivery_method = 'pickup' and not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Choose a pickup branch.';
  end if;
  if p_delivery_method <> 'pickup' and coalesce(trim(p_ship_address), '') = '' then
    raise exception 'Enter the delivery address.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your order is empty.';
  end if;

  v_branch := case
    when p_delivery_method in ('pickup', 'jobsite') and exists (select 1 from public.branches where id = p_branch_id) then p_branch_id
  end;

  insert into public.orders (
    placed_by, company_id, company_name, account_no,
    placed_by_name, placed_by_email, placed_by_phone, placed_by_role,
    delivery_method, branch_id, ship_address, po_number, needed_by, notes)
  values (
    me.id, co.id,
    coalesce(co.name, nullif(trim(p_customer_name), ''), 'AMBIT (internal)'),
    co.account_no,
    me.full_name, me.email, me.phone, me.role,
    p_delivery_method,
    v_branch,
    case when p_delivery_method <> 'pickup' then trim(p_ship_address) end,
    nullif(trim(p_po_number), ''),
    p_needed_by,
    nullif(trim(p_notes), ''))
  returning id into new_id;

  for item in select * from jsonb_array_elements(p_items) loop
    q := nullif(item->>'qty', '')::numeric;
    if q is null or q <= 0 then continue; end if;

    -- A product on sale is charged its sale price, and the sale price shows even on
    -- products that are normally priced to the customer's account.
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false)
             and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p
      left join public.categories c on c.id = p.category_id
     where p.id = (item->>'product_id')::uuid and p.active;
    if not found then
      raise exception 'An item in your order is no longer available. Please refresh and try again.';
    end if;

    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (new_id, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end,
            pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end);

    if pr.cp then
      any_cp := true;
    elsif pr.list_price is not null then
      subtotal := subtotal + round(pr.list_price * q, 2);
    end if;
    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'Your order is empty.';
  end if;

  update public.orders
     set est_subtotal = subtotal,
         has_customer_pricing = any_cp,
         approval_ref = 'APV-' || order_no || '-' || upper(substr(md5(id::text || clock_timestamp()::text), 1, 4))
   where id = new_id;

  -- A contractor ordering for their own company approves it by placing it.
  if me.role = 'customer' then
    update public.orders
       set approval_status = 'approved', approval_method = 'in_app',
           approved_at = now(), approved_by_name = coalesce(me.full_name, me.email)
     where id = new_id;
  end if;
  return new_id;
end $$;

select (select count(*) from public.promos) as banner_slides,
       (select count(*) from public.products where public.sale_on(sale_price, sale_ends)) as products_on_sale;
