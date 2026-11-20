-- 0097: ADC go-live.
--  * Security: internal helper functions that only other database functions use can no longer be called directly.
--  * Busier limits for Black Friday: 10 orders an hour per email, 400 an hour in all.
--  * ADC customer accounts: anyone can make one (profiles.web_only). They never get into AMBIT Intelligence.
--  * Promo emails: everyone who opts in (checked by default) goes on adc_promo_contacts, with an unsubscribe link.
--  * AM-BUCKS: 3 points for every $100 paid (3% of the dollars, in points); 100 points = $1.00 off.
--    Points post only when AMBIT marks the order paid.
--  * Merch: shirts, hats... shown on the store as Coming soon (no ordering yet).
--  * Shipping rules: each category (or item) ships by parcel, by freight, pick up only, or pick up / full truck
--    (fiberglass). Spray foam, coatings, parts and supplies can ship; fiberglass is pick up unless it fills a truck.
--  * Spray foam on ADC sells in sets only (1 A-side + 1 B-side, never lopsided): the B-side items show as sets and
--    every set ordered brings its ISO A-side with it; the ISO A-side items are hidden on ADC (the AMBIT app keeps them).
-- Safe to run again.

-- ---------------------------------------------------------------- security
do $do$
declare f text;
begin
  foreach f in array array[
    'public.customer_prices_from_request(bigint)', 'public.price_rule_check(uuid, numeric)',
    'public.count_system_qty(text, uuid, bigint)', 'public.inventory_hold_left(public.inventory_holds)',
    'public.inventory_hold_mine(public.inventory_holds, uuid)', 'public.inventory_lot_held(bigint, uuid)',
    'public.inventory_lot_hold_text(bigint, uuid)', 'public.inventory_lot_mine(bigint, uuid)',
    'public.private_products()', 'public.expense_missing(uuid, date)', 'public.expense_month_status(uuid, date)']
  loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------- ADC customer accounts
alter table public.profiles add column if not exists web_only boolean not null default false;

create table if not exists public.adc_accounts (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  name         text,
  company      text,
  phone        text,
  street       text,
  city         text,
  state        text,
  zip          text,
  promo_opt_in boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.adc_accounts enable row level security;
drop policy if exists adc_accounts_self on public.adc_accounts;
create policy adc_accounts_self on public.adc_accounts for select to authenticated using (user_id = auth.uid() or public.is_employee());

-- Sign-ups, sign-ins and password emails on the store, to slow down anyone hammering them (the server reads and writes it).
create table if not exists public.adc_auth_events (
  id    bigserial primary key,
  kind  text not null,
  email text,
  ip    text,
  at    timestamptz not null default now()
);
create index if not exists adc_auth_events_at on public.adc_auth_events(at desc);
alter table public.adc_auth_events enable row level security;
revoke all on public.adc_auth_events from anon, authenticated;

-- Promo email list (anyone who opted in: at checkout, when making an account, or on the merch page).
create table if not exists public.adc_promo_contacts (
  email        text primary key,
  name         text,
  source       text,
  opted_in     boolean not null default true,
  opted_in_at  timestamptz,
  opted_out_at timestamptz,
  token        uuid not null default gen_random_uuid() unique,
  created_at   timestamptz not null default now()
);
alter table public.adc_promo_contacts enable row level security;
drop policy if exists adc_promo_staff on public.adc_promo_contacts;
create policy adc_promo_staff on public.adc_promo_contacts for select to authenticated using (public.is_admin());

create or replace function public.adc_promo_set(p_email text, p_name text, p_source text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $fn$
declare em text := lower(trim(coalesce(p_email, '')));
begin
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  insert into public.adc_promo_contacts (email, name, source, opted_in, opted_in_at, opted_out_at)
  values (left(em, 160), nullif(left(trim(coalesce(p_name, '')), 120), ''), left(coalesce(p_source, 'store'), 40), p_on,
          case when p_on then now() end, case when not p_on then now() end)
  on conflict (email) do update
     set opted_in = excluded.opted_in,
         name = coalesce(public.adc_promo_contacts.name, excluded.name),
         opted_in_at = case when excluded.opted_in then now() else public.adc_promo_contacts.opted_in_at end,
         opted_out_at = case when not excluded.opted_in then now() else public.adc_promo_contacts.opted_out_at end;
end $fn$;
revoke all on function public.adc_promo_set(text, text, text, boolean) from public, anon, authenticated;

-- "Tell me when it's ready" on the merch page (and anything else that only collects an email).
create or replace function public.adc_promo_signup(p_email text, p_name text, p_source text) returns boolean
language plpgsql security definer set search_path = public as $fn$
begin
  if (select count(*) from public.adc_promo_contacts where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Too many sign-ups just now. Please try again in a little while.';
  end if;
  if lower(trim(coalesce(p_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please add a good email address.'; end if;
  perform public.adc_promo_set(p_email, p_name, coalesce(nullif(p_source, ''), 'signup'), true);
  return true;
end $fn$;
revoke all on function public.adc_promo_signup(text, text, text) from public;
grant execute on function public.adc_promo_signup(text, text, text) to anon, authenticated;

-- The unsubscribe link in every promo email.
create or replace function public.adc_promo_unsubscribe(p_token uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare em text;
begin
  update public.adc_promo_contacts set opted_in = false, opted_out_at = now() where token = p_token returning email into em;
  if em is not null then update public.adc_accounts a set promo_opt_in = false from public.profiles p where p.id = a.user_id and lower(p.email) = em; end if;
  return em;
end $fn$;
revoke all on function public.adc_promo_unsubscribe(uuid) from public;
grant execute on function public.adc_promo_unsubscribe(uuid) to anon, authenticated;

-- A signed-in shopper saves their own details (and their promo email choice).
create or replace function public.adc_account_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $fn$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Please sign in first.'; end if;
  if me.partner_id is not null then raise exception 'This login belongs to another store.'; end if;
  insert into public.adc_accounts (user_id, name, company, phone, street, city, state, zip, promo_opt_in, updated_at)
  values (me.id, nullif(left(trim(coalesce(p->>'name', '')), 120), ''), nullif(left(trim(coalesce(p->>'company', '')), 160), ''),
          nullif(left(trim(coalesce(p->>'phone', '')), 40), ''), nullif(left(trim(coalesce(p->>'street', '')), 160), ''),
          nullif(left(trim(coalesce(p->>'city', '')), 80), ''), nullif(upper(left(trim(coalesce(p->>'state', '')), 2)), ''),
          nullif(left(trim(coalesce(p->>'zip', '')), 10), ''), coalesce((p->>'promo_opt_in')::boolean, true), now())
  on conflict (user_id) do update set name = excluded.name, company = excluded.company, phone = excluded.phone, street = excluded.street,
     city = excluded.city, state = excluded.state, zip = excluded.zip, promo_opt_in = excluded.promo_opt_in, updated_at = now();
  if me.web_only and coalesce(trim(p->>'name'), '') <> '' then
    update public.profiles set full_name = left(trim(p->>'name'), 120) where id = me.id;
  end if;
  perform public.adc_promo_set(me.email, p->>'name', 'account', coalesce((p->>'promo_opt_in')::boolean, true));
end $fn$;
revoke all on function public.adc_account_save(jsonb) from public, anon;
grant execute on function public.adc_account_save(jsonb) to authenticated;

-- New ADC logins: marked web-only (never an AMBIT access request) and their account details saved.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, phone, requested_company, requested_account_no, branch_id)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(meta->>'full_name', meta->>'name', '')), ''),
    nullif(trim(coalesce(meta->>'phone', '')), ''),
    nullif(trim(coalesce(meta->>'company', '')), ''),
    nullif(trim(coalesce(meta->>'account_no', '')), ''),
    (select b.id from public.branches b where b.id = meta->>'branch_id')
  )
  on conflict (id) do nothing;

  if coalesce(meta->>'invite', '') <> '' then
    begin
      perform public.apply_invite(new.id, meta->>'invite');
    exception when others then
      null;  -- never block a sign-up; the invite page tries again right after
    end;
  end if;
  if coalesce(meta->>'partner_invite', '') <> '' then
    begin
      perform public.apply_partner_invite(new.id, meta->>'partner_invite');
    exception when others then
      null;
    end;
  end if;
  if coalesce(meta->>'adc_signup', '') = '1' then
    begin
      update public.profiles set web_only = true, requested_company = null where id = new.id;
      insert into public.adc_accounts (user_id, name, company, phone, promo_opt_in)
      values (new.id, nullif(left(trim(coalesce(meta->>'full_name', '')), 120), ''), nullif(left(trim(coalesce(meta->>'company', '')), 160), ''),
              nullif(left(trim(coalesce(meta->>'phone', '')), 40), ''), coalesce((meta->>'promo_opt_in')::boolean, true))
      on conflict (user_id) do nothing;
      perform public.adc_promo_set(new.email, meta->>'full_name', 'account', coalesce((meta->>'promo_opt_in')::boolean, true));
    exception when others then
      null;
    end;
  end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------- shipping rules
alter table public.categories add column if not exists adc_ship text not null default 'parcel';
alter table public.categories drop constraint if exists categories_adc_ship_check;
alter table public.categories add constraint categories_adc_ship_check check (adc_ship in ('parcel', 'freight', 'pickup', 'truckload'));
alter table public.products add column if not exists adc_ship text;
alter table public.products drop constraint if exists products_adc_ship_check;
alter table public.products add constraint products_adc_ship_check check (adc_ship is null or adc_ship in ('parcel', 'freight', 'pickup', 'truckload'));
-- How many of this item fill a full truck (fiberglass; from the load calculator). Empty: AMBIT confirms.
alter table public.products add column if not exists truck_qty numeric(12,2);

-- Spray foam sets on ADC: B-side resins (drums and totes) sell as 1 A + 1 B; ISO A-side items are hidden on ADC.
alter table public.products add column if not exists adc_set boolean not null default false;
alter table public.products add column if not exists adc_hide boolean not null default false;
update public.products set adc_set = true
 where category_id = 'ambit-foam' and unit in ('drum', 'tote') and sku !~* '^(iso|huntsman-iso)';
update public.products set adc_hide = true
 where category_id = 'ambit-foam' and (sku ~* '^(iso|huntsman-iso)' or name ~* '^iso a-side');

-- Full truckload sizes from the Knauf 53' truckload builder (bags per full truck; Jet Stream ULTRA: 25 units x 42 bags).
update public.products p set truck_qty = x.n
  from (values
  ('B02VAK', 780),
  ('X02VAK', 660),
  ('B04AK', 416),
  ('B06VAK', 780),
  ('X06VAK', 660),
  ('B07AK', 416),
  ('B09E', 624),
  ('B11E', 416),
  ('B16E', 624),
  ('B17E', 416),
  ('B18E', 624),
  ('B19E', 416),
  ('B61VAK', 780),
  ('X66VAK', 660),
  ('B63AK', 416),
  ('B65VAK', 780),
  ('X17VAK', 660),
  ('B66AK', 416),
  ('B68E', 624),
  ('X20E', 528),
  ('B70E', 416),
  ('B75E', 624),
  ('B76E', 416),
  ('B77E', 624),
  ('B78E', 416),
  ('5003646', 1050)
  ) as x(sku, n)
 where p.sku = x.sku and p.truck_qty is null;

update public.categories set adc_ship = 'truckload' where id = 'fiberglass';
update public.categories set adc_ship = 'freight' where id in ('ambit-foam', 'roof-coatings-and-sealants', 'intumescent-coatings', 'alpha-chemicals');
update public.categories set adc_ship = 'pickup' where id = 'drums-and-containers';

-- ---------------------------------------------------------------- orders: accounts, promo, AM-BUCKS, truckload
alter table public.adc_orders add column if not exists user_id uuid references public.profiles(id) on delete set null;
alter table public.adc_orders add column if not exists promo_opt_in boolean;
alter table public.adc_orders add column if not exists bucks_requested numeric(12,2);
alter table public.adc_orders add column if not exists paid_total numeric(12,2);
alter table public.adc_orders add column if not exists paid_at timestamptz;
alter table public.adc_orders add column if not exists points_earned int;
alter table public.adc_orders add column if not exists bucks_used numeric(12,2);
alter table public.adc_orders add column if not exists is_test boolean not null default false;
alter table public.adc_orders drop constraint if exists adc_orders_delivery_check;
alter table public.adc_orders add constraint adc_orders_delivery_check check (delivery in ('ship', 'pickup', 'truckload'));
create index if not exists adc_orders_user on public.adc_orders(user_id);
create index if not exists adc_orders_email on public.adc_orders(lower(email));

-- ---------------------------------------------------------------- AM-BUCKS
insert into public.app_settings (key, value) values ('am_bucks', '{"points_per_dollar": 0.03, "point_value": 0.01}')
on conflict (key) do nothing;

create table if not exists public.am_bucks_ledger (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  adc_order_id    bigint references public.adc_orders(id) on delete set null,
  points          int not null,
  kind            text not null check (kind in ('earn', 'redeem', 'adjust')),
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists am_bucks_user on public.am_bucks_ledger(user_id, created_at desc);
alter table public.am_bucks_ledger enable row level security;
drop policy if exists am_bucks_read on public.am_bucks_ledger;
create policy am_bucks_read on public.am_bucks_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.has_perm('order_desk'));

create or replace function public.am_bucks_balance(p_user uuid) returns int
language sql stable security definer set search_path = public as $fn$
  select coalesce(sum(points), 0)::int from public.am_bucks_ledger where user_id = p_user
$fn$;
revoke all on function public.am_bucks_balance(uuid) from public, anon, authenticated;

-- A signed-in shopper: their orders (by login, or the email they confirmed) and their AM-BUCKS.
-- Past guest orders with their confirmed email join their account, and paid ones post their points.
create or replace function public.adc_my_account() returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  me public.profiles;
  verified boolean;
  r record;
  rate numeric := coalesce((select (value->>'points_per_dollar')::numeric from public.app_settings where key = 'am_bucks'), 0.03);
  pv numeric := coalesce((select (value->>'point_value')::numeric from public.app_settings where key = 'am_bucks'), 0.01);
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.partner_id is not null then return null; end if;
  select u.email_confirmed_at is not null into verified from auth.users u where u.id = me.id;
  if verified then
    update public.adc_orders set user_id = me.id where user_id is null and lower(email) = lower(me.email) and not is_test;
    for r in select o.* from public.adc_orders o
              where o.user_id = me.id and o.paid_total is not null and o.points_earned is null loop
      update public.adc_orders set points_earned = floor(r.paid_total * rate)::int where id = r.id;
      if floor(r.paid_total * rate) > 0 then
        insert into public.am_bucks_ledger (user_id, adc_order_id, points, kind, note)
        values (me.id, r.id, floor(r.paid_total * rate)::int, 'earn', 'Order ADC-' || (1000 + r.id));
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'email', me.email,
    'verified', coalesce(verified, false),
    'web_only', me.web_only,
    'account', (select to_jsonb(a) - 'user_id' from public.adc_accounts a where a.user_id = me.id),
    'points', public.am_bucks_balance(me.id),
    'point_value', pv,
    'points_per_dollar', rate,
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'points', l.points, 'kind', l.kind, 'note', l.note) order by l.created_at desc)
                           from (select * from public.am_bucks_ledger where user_id = me.id order by created_at desc limit 50) l), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'no', 'ADC-' || (1000 + o.id), 'at', o.created_at, 'status', o.status,
                           'delivery', o.delivery, 'items', o.items, 'subtotal', o.subtotal, 'has_quote', o.has_quote, 'paid_total', o.paid_total,
                           'points', o.points_earned) order by o.created_at desc)
                         from (select * from public.adc_orders where user_id = me.id and not is_test order by created_at desc limit 100) o), '[]'));
end $fn$;
revoke all on function public.adc_my_account() from public, anon;
grant execute on function public.adc_my_account() to authenticated;

-- AMBIT marks an ADC order paid (what they paid for the goods, before tax and shipping). The account earns its points,
-- and any AM-BUCKS used come off the balance. An order with no account earns its points when they make one.
create or replace function public.adc_order_mark_paid(p_id bigint, p_total numeric, p_bucks_used numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  o public.adc_orders;
  uid uuid;
  rate numeric := coalesce((select (value->>'points_per_dollar')::numeric from public.app_settings where key = 'am_bucks'), 0.03);
  pv numeric := coalesce((select (value->>'point_value')::numeric from public.app_settings where key = 'am_bucks'), 0.01);
  pts int;
  used_pts int := 0;
  who text := coalesce(public.my_name(), 'AMBIT');
begin
  if not (public.is_admin() or public.has_perm('order_desk')) then raise exception 'Only the order desk can mark web orders paid.'; end if;
  if p_total is null or p_total < 0 or p_total > 10000000 then raise exception 'Type what they paid for the goods.'; end if;
  select * into o from public.adc_orders where id = p_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.paid_at is not null then raise exception 'This order is already marked paid.'; end if;
  uid := coalesce(o.user_id, (select p.id from public.profiles p join auth.users u on u.id = p.id
                               where lower(p.email) = lower(o.email) and u.email_confirmed_at is not null and p.partner_id is null limit 1));
  if coalesce(p_bucks_used, 0) > 0 then
    if uid is null then raise exception 'This order has no ADC account, so it has no AM-BUCKS to use.'; end if;
    used_pts := round(p_bucks_used / pv)::int;
    if used_pts > public.am_bucks_balance(uid) then raise exception 'They only have $% in AM-BUCKS.', to_char(public.am_bucks_balance(uid) * pv, 'FM999999990.00'); end if;
    insert into public.am_bucks_ledger (user_id, adc_order_id, points, kind, note, created_by, created_by_name)
    values (uid, o.id, -used_pts, 'redeem', 'Used on ADC-' || (1000 + o.id), auth.uid(), who);
  end if;
  pts := case when uid is null then null else floor(p_total * rate)::int end;
  if pts is not null and pts > 0 then
    insert into public.am_bucks_ledger (user_id, adc_order_id, points, kind, note, created_by, created_by_name)
    values (uid, o.id, pts, 'earn', 'Order ADC-' || (1000 + o.id), auth.uid(), who);
  end if;
  update public.adc_orders
     set paid_total = round(p_total, 2), paid_at = now(), user_id = uid, points_earned = pts,
         bucks_used = case when used_pts > 0 then round(used_pts * pv, 2) end,
         status = 'done', staff_note = coalesce(nullif(left(trim(coalesce(p_note, '')), 1000), ''), staff_note),
         handled_by = auth.uid(), handled_by_name = who, handled_at = now()
   where id = o.id;
  return jsonb_build_object('points', coalesce(pts, 0), 'account', uid is not null, 'used', used_pts);
end $fn$;
revoke all on function public.adc_order_mark_paid(bigint, numeric, numeric, text) from public, anon;
grant execute on function public.adc_order_mark_paid(bigint, numeric, numeric, text) to authenticated;

-- Test orders: the order desk marks them, admins delete them (they never count for anything).
create or replace function public.adc_order_delete_test(p_id bigint) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then raise exception 'Only admins can delete web orders.'; end if;
  if not exists (select 1 from public.adc_orders where id = p_id and (is_test or status = 'cancelled')) then
    raise exception 'Mark it as a test order (or cancel it) first.';
  end if;
  delete from public.am_bucks_ledger where adc_order_id = p_id;
  delete from public.adc_orders where id = p_id;
end $fn$;
revoke all on function public.adc_order_delete_test(bigint) from public, anon;
grant execute on function public.adc_order_delete_test(bigint) to authenticated;

-- ---------------------------------------------------------------- merch (coming soon)
create table if not exists public.merch_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price       numeric(12,2) check (price is null or price >= 0),
  image_url   text,
  sizes       text,
  sort        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.merch_items enable row level security;
drop policy if exists merch_read on public.merch_items;
create policy merch_read on public.merch_items for select to anon, authenticated using (active or public.is_admin());
drop policy if exists merch_admin on public.merch_items;
create policy merch_admin on public.merch_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values ('merch', '{"coming_soon": true}') on conflict (key) do nothing;

-- ---------------------------------------------------------------- the store's catalog, now with how each item ships
drop function if exists public.adc_catalog();
create function public.adc_catalog()
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
      select i.price from public.web_sale_items i join sale on sale.id = i.sale_id
       where i.product_id = pr.id and i.price is not null and pr.category_id is distinct from 'ambit-foam'
         and (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null or i.price < pr.list_price)
       limit 1
    ) sp on true
   where pr.active and not coalesce(pr.admin_only, false) and not coalesce(c.admin_only, false) and not pr.adc_hide
$fn$;
revoke execute on function public.adc_catalog() from public;
grant execute on function public.adc_catalog() to anon, authenticated;

-- ---------------------------------------------------------------- placing an order
create or replace function public.adc_place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_quote boolean := false;
  v_sale text;
  v_foam numeric;
  v_id bigint;
  v_user uuid;
  v_pick text := '';
  v_truck numeric := 0;
  v_truck_known boolean := true;
  v_any_truck boolean := false;
  v_bucks numeric;
  v_del text := case when p->>'delivery' in ('pickup', 'truckload') then p->>'delivery' else 'ship' end;
  pv numeric := coalesce((select (value->>'point_value')::numeric from public.app_settings where key = 'am_bucks'), 0.01);
  r record;
  q numeric;
  price numeric;
  em text := lower(trim(coalesce(p->>'email', '')));
begin
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please add your name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please add a good email address.'; end if;
  if length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) < 10 then raise exception 'Please add a phone number.'; end if;
  if v_del in ('ship', 'truckload') and (length(trim(coalesce(p#>>'{address,street}', ''))) < 3 or length(trim(coalesce(p#>>'{address,zip}', ''))) < 5) then
    raise exception 'Please add the address to ship to.';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Your cart is empty.'; end if;
  if jsonb_array_length(p->'items') > 120 then raise exception 'That is a lot of lines. Please call us for an order this size.'; end if;
  -- Slow down floods: 10 orders an hour per email, 400 an hour in all.
  if (select count(*) from public.adc_orders where lower(email) = em and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.adc_orders where created_at > now() - interval '1 hour') >= 400 then
    raise exception 'We got several orders from you just now. Please call us and we will help.';
  end if;

  -- Signed in on the store (not one of a partner store's people): the order goes on their account.
  select id into v_user from public.profiles where id = auth.uid() and partner_id is null;

  select a.slug, a.foam_off_per_lb into v_sale, v_foam from public.adc_sale() a limit 1;

  for r in
    select x.product_id, x.sku as x_sku, x.name as x_name, x.qty, a.id, a.sku, a.name, a.unit, a.list_price, a.quote, a.sale_price, a.category_id, a.ship, a.truck_qty, a.is_set
      from jsonb_to_recordset(p->'items') as x(product_id text, sku text, name text, qty numeric)
      left join public.adc_catalog() a on a.id::text = x.product_id
  loop
    q := round(coalesce(r.qty, 0));
    if q < 1 or q > 9999 then continue; end if;
    if r.product_id is not null then
      if r.id is null then continue; end if;
      if v_del <> 'pickup' and r.ship = 'pickup' then v_pick := v_pick || case when v_pick = '' then '' else ', ' end || r.sku; end if;
      if r.ship = 'truckload' then
        v_any_truck := true;
        if v_del = 'ship' then v_pick := v_pick || case when v_pick = '' then '' else ', ' end || r.sku; end if;
        if r.truck_qty is null or r.truck_qty <= 0 then v_truck_known := false; else v_truck := v_truck + q / r.truck_qty; end if;
      end if;
      price := case when r.quote then null else coalesce(r.sale_price, r.list_price) end;
      if price is null then v_quote := true; else v_sub := v_sub + price * q; end if;
      -- A spray foam set: q sets = q ISO A-side + q of this B-side (never lopsided).
      v_items := v_items || jsonb_build_object('product_id', r.id, 'sku', r.sku,
        'name', case when r.is_set then r.name || ' SET (1 ISO A-side + 1 B-side ' || coalesce(r.unit, 'drum') || ')' else r.name end,
        'unit', case when r.is_set then 'set' else r.unit end, 'qty', q, 'set', r.is_set,
        'price', price, 'list_price', r.list_price, 'on_sale', r.sale_price is not null and not r.quote, 'ship', r.ship,
        'promo', case when r.quote and r.category_id = 'ambit-foam' and v_foam is not null then '$' || to_char(v_foam, 'FM0.00') || ' per lb off your price (sale)' end);
    else
      -- A part from a parts diagram that isn't in the catalog yet: AMBIT confirms the price.
      if length(trim(coalesce(r.x_sku, ''))) = 0 then continue; end if;
      v_quote := true;
      v_items := v_items || jsonb_build_object('product_id', null, 'sku', left(trim(r.x_sku), 40), 'name', left(trim(coalesce(r.x_name, 'Part')), 160),
        'unit', 'each', 'qty', q, 'price', null, 'ship', 'parcel');
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Your cart is empty.'; end if;
  if v_pick <> '' then
    raise exception 'Some items are pick up only (or ship only as a full truckload): %. Please pick up at an AMBIT location, or use the full truckload option.', v_pick;
  end if;
  if v_del = 'truckload' then
    if not v_any_truck then raise exception 'Full truckload delivery is for fiberglass. Please pick ship or pick up.'; end if;
    if v_truck_known and v_truck < 0.95 then
      raise exception 'That fiberglass fills about % percent of a truck. Add more to fill the truck, or pick it up at an AMBIT location.', round(v_truck * 100);
    end if;
  end if;

  -- AM-BUCKS they want to use: AMBIT takes them off when it confirms the total.
  v_bucks := case when v_user is not null and coalesce((p->>'use_bucks')::boolean, false)
                  then nullif(round(public.am_bucks_balance(v_user) * pv, 2), 0) end;

  insert into public.adc_orders (name, company, email, phone, delivery, pickup_branch, address, notes, items, subtotal, has_quote, sale_slug,
                                 user_id, promo_opt_in, bucks_requested)
  values (left(trim(p->>'name'), 120), nullif(left(trim(coalesce(p->>'company', '')), 160), ''), left(em, 160), left(trim(p->>'phone'), 40),
          v_del, case when v_del = 'pickup' then nullif(left(coalesce(p->>'pickup_branch', ''), 40), '') end,
          case when v_del = 'pickup' then null else jsonb_build_object(
            'street', left(trim(coalesce(p#>>'{address,street}', '')), 160), 'street2', left(trim(coalesce(p#>>'{address,street2}', '')), 160),
            'city', left(trim(coalesce(p#>>'{address,city}', '')), 80), 'state', upper(left(trim(coalesce(p#>>'{address,state}', '')), 2)),
            'zip', left(trim(coalesce(p#>>'{address,zip}', '')), 10)) end,
          nullif(left(trim(coalesce(p->>'notes', '')), 2000), ''), v_items, round(v_sub, 2), v_quote, v_sale,
          v_user, coalesce((p->>'promo_opt_in')::boolean, false), v_bucks)
  returning id into v_id;
  if coalesce((p->>'promo_opt_in')::boolean, false) then perform public.adc_promo_set(em, p->>'name', 'checkout', true); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'order_no', 'ADC-' || (1000 + v_id), 'subtotal', round(v_sub, 2), 'has_quote', v_quote,
                            'items', v_items, 'bucks', v_bucks);
end $fn$;
revoke execute on function public.adc_place_order(jsonb) from public;
grant execute on function public.adc_place_order(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- the A + B set photos on the store (red ISO drum + the B-side drum + a foam sample)
update public.products set adc_image_url = '/adc/sets/ambi-seal-50-set.jpg' where sku in ('AMB-SEAL-50', 'AMB-SEAL-50-W');
update public.products set adc_image_url = '/adc/sets/ambi-tite-204-set.jpg' where sku in ('AMB-TITE-20', 'AMB-TITE-20-W', 'AMBI-TITE-204-500');
update public.products set adc_image_url = '/adc/sets/ambi-jack-40-set.jpg' where sku = 'AMB-JACK';
update public.products set adc_image_url = '/adc/sets/ambi-roof-28-set.jpg' where sku = 'AMB-ROOF-28';

-- Check
select (select count(*) from public.categories where adc_ship <> 'parcel') as "Categories that don't ship by parcel",
       (select count(*) from public.adc_catalog()) as "Items on the store";
