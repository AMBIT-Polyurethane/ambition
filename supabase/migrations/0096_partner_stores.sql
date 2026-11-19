-- 0096: partner stores. A distributor AMBIT works with (Contractors Foam Supply first) gets their own store, built on
-- AMBIT Intelligence but walled off from AMBIT:
--  * partners: the distributor, their contact info, logo and colors.
--  * partner_items: their own item list (seeded from AMBIT's Black Friday sheet + AMBIT spray foam), with their purchase
--    price, sell price, qty on hand and photo. AMBIT's SKU is kept so orders between AMBIT and them match.
--  * partner_customers + partner_customer_prices: their customers and each customer's prices (spray foam per lb).
--  * partner_orders: orders placed on their store (guests or signed-in customers). No card payment yet.
--  * partner_invites: the owner invites a customer to make a login (and AMBIT invites the owner).
-- People who belong to a partner (profiles.partner_id) can't see anything of AMBIT's: is_active() is false for them.
-- Only the AMBIT people named in partner_viewers (Jeremiah) can read a partner's side, and they can't change it.
-- Safe to run again.

-- ---------------------------------------------------------------- partners
create table if not exists public.partners (
  id          text primary key,
  name        text not null,
  short       text not null,
  owner_name  text,
  email       text,
  phone       text,
  logo_url    text,
  color       text not null default '#2d694b',
  color2      text not null default '#24563d',
  tagline     text,
  hero_title  text,
  hero_text   text,
  hero_title_es text,
  hero_text_es  text,
  tagline_es  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The AMBIT people who may look at a partner's side (read only). Nobody else at AMBIT sees it.
create table if not exists public.partner_viewers (
  partner_id text not null references public.partners(id) on delete cascade,
  email      text not null,
  primary key (partner_id, email)
);
alter table public.partner_viewers enable row level security;
revoke all on public.partner_viewers from anon, authenticated;

create or replace function public.can_view_partner(p text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() and exists (
    select 1 from public.partner_viewers v join public.profiles pr on pr.id = auth.uid()
     where v.partner_id = p and lower(v.email) = lower(pr.email))
$fn$;
revoke all on function public.can_view_partner(text) from public;
grant execute on function public.can_view_partner(text) to anon, authenticated;

-- What the owner can change about their own store (not who may see it, not whether it is open).
revoke update on public.partners from anon, authenticated;
grant update (name, short, owner_name, email, phone, logo_url, color, color2, tagline, hero_title, hero_text,
              tagline_es, hero_title_es, hero_text_es, updated_at) on public.partners to authenticated;

alter table public.profiles add column if not exists partner_id text references public.partners(id) on delete set null;
alter table public.profiles add column if not exists partner_role text;
alter table public.profiles drop constraint if exists profiles_partner_role_check;
alter table public.profiles add constraint profiles_partner_role_check check (partner_role is null or partner_role in ('owner', 'customer'));
alter table public.profiles add column if not exists partner_customer_id uuid;

-- A partner's people are not AMBIT's: every AMBIT rule that needs an active AMBIT login says no to them.
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and partner_id is null)
$fn$;

-- The partner this person owns (null for everyone else).
create or replace function public.my_partner() returns text
language sql stable security definer set search_path = public as $fn$
  select partner_id from public.profiles where id = auth.uid() and partner_role = 'owner' and status = 'active'
$fn$;
-- The partner customer this person is (null for everyone else).
create or replace function public.my_partner_customer() returns uuid
language sql stable security definer set search_path = public as $fn$
  select partner_customer_id from public.profiles where id = auth.uid() and partner_role = 'customer' and status = 'active'
$fn$;
-- Shoppers who aren't signed in get null from both (the store's rules use them, so they must be able to call them).
revoke all on function public.my_partner() from public;
revoke all on function public.my_partner_customer() from public;
grant execute on function public.my_partner() to anon, authenticated;
grant execute on function public.my_partner_customer() to anon, authenticated;

-- ---------------------------------------------------------------- items, customers, prices, orders, invites
create table if not exists public.partner_items (
  id           uuid primary key default gen_random_uuid(),
  partner_id   text not null references public.partners(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  sku          text not null,
  name         text not null,
  description  text,
  category     text,
  unit         text,
  image_url    text,
  cost         numeric(12,4) check (cost is null or cost >= 0),
  price        numeric(12,2) check (price is null or price >= 0),
  per_customer boolean not null default false,
  basis        text not null default 'unit' check (basis in ('unit', 'lb')),
  qty_on_hand  numeric(12,2),
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (partner_id, sku)
);
create index if not exists partner_items_partner on public.partner_items(partner_id, active);

create table if not exists public.partner_customers (
  id          uuid primary key default gen_random_uuid(),
  partner_id  text not null references public.partners(id) on delete cascade,
  company     text not null,
  contact     text,
  email       text,
  phone       text,
  street      text,
  city        text,
  state       text,
  zip         text,
  terms       text,
  off_pct     numeric(5,2) not null default 0 check (off_pct >= 0 and off_pct <= 90),
  notes       text,
  user_id     uuid references public.profiles(id) on delete set null,
  invited_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists partner_customers_partner on public.partner_customers(partner_id);

create table if not exists public.partner_customer_prices (
  customer_id uuid not null references public.partner_customers(id) on delete cascade,
  item_id     uuid not null references public.partner_items(id) on delete cascade,
  price       numeric(12,4) not null check (price >= 0),
  updated_at  timestamptz not null default now(),
  primary key (customer_id, item_id)
);

create table if not exists public.partner_orders (
  id           bigserial primary key,
  partner_id   text not null references public.partners(id) on delete cascade,
  customer_id  uuid references public.partner_customers(id) on delete set null,
  placed_by    uuid references public.profiles(id) on delete set null,
  name         text not null,
  company      text,
  email        text not null,
  phone        text,
  delivery     text not null default 'ship' check (delivery in ('ship', 'pickup')),
  address      jsonb,
  po           text,
  notes        text,
  items        jsonb not null,
  subtotal     numeric(12,2) not null default 0,
  has_quote    boolean not null default false,
  status       text not null default 'new' check (status in ('new', 'shipped', 'done', 'cancelled')),
  tracking     text,
  lang         text not null default 'en',
  email_status text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists partner_orders_partner on public.partner_orders(partner_id, created_at desc);

create table if not exists public.partner_invites (
  id           uuid primary key default gen_random_uuid(),
  partner_id   text not null references public.partners(id) on delete cascade,
  email        text not null,
  partner_role text not null check (partner_role in ('owner', 'customer')),
  customer_id  uuid references public.partner_customers(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null default now() + interval '30 days',
  accepted_at  timestamptz,
  accepted_by  uuid,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- who can see what
alter table public.partners enable row level security;
alter table public.partner_items enable row level security;
alter table public.partner_customers enable row level security;
alter table public.partner_customer_prices enable row level security;
alter table public.partner_orders enable row level security;
alter table public.partner_invites enable row level security;

drop policy if exists partners_read on public.partners;
create policy partners_read on public.partners for select to anon, authenticated using (active or id = public.my_partner() or public.can_view_partner(id));
drop policy if exists partners_owner on public.partners;
create policy partners_owner on public.partners for update to authenticated using (id = public.my_partner()) with check (id = public.my_partner());

drop policy if exists partner_items_owner on public.partner_items;
create policy partner_items_owner on public.partner_items for all to authenticated using (partner_id = public.my_partner()) with check (partner_id = public.my_partner());
drop policy if exists partner_items_admin on public.partner_items;
create policy partner_items_admin on public.partner_items for select to authenticated using (public.can_view_partner(partner_id));

drop policy if exists partner_customers_owner on public.partner_customers;
create policy partner_customers_owner on public.partner_customers for all to authenticated using (partner_id = public.my_partner()) with check (partner_id = public.my_partner());
drop policy if exists partner_customers_self on public.partner_customers;
create policy partner_customers_self on public.partner_customers for select to authenticated using (id = public.my_partner_customer() or public.can_view_partner(partner_id));

drop policy if exists partner_prices_owner on public.partner_customer_prices;
create policy partner_prices_owner on public.partner_customer_prices for all to authenticated
  using (exists (select 1 from public.partner_customers c where c.id = customer_id and c.partner_id = public.my_partner()))
  with check (exists (select 1 from public.partner_customers c where c.id = customer_id and c.partner_id = public.my_partner()));
drop policy if exists partner_prices_self on public.partner_customer_prices;
create policy partner_prices_self on public.partner_customer_prices for select to authenticated
  using (customer_id = public.my_partner_customer()
         or exists (select 1 from public.partner_customers c where c.id = customer_id and public.can_view_partner(c.partner_id)));

drop policy if exists partner_orders_owner on public.partner_orders;
create policy partner_orders_owner on public.partner_orders for all to authenticated using (partner_id = public.my_partner()) with check (partner_id = public.my_partner());
drop policy if exists partner_orders_self on public.partner_orders;
create policy partner_orders_self on public.partner_orders for select to authenticated using (customer_id = public.my_partner_customer() or public.can_view_partner(partner_id));

drop policy if exists partner_invites_owner on public.partner_invites;
create policy partner_invites_owner on public.partner_invites for select to authenticated using (partner_id = public.my_partner() or public.can_view_partner(partner_id));

-- AMBIT staff can't see a partner's people either (their names and emails are the partner's business).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_employee() and (partner_id is null or public.can_view_partner(partner_id))));

-- Photos: a partner's owner can put photos in their own folder of the product-images bucket (partners/<id>/...).
drop policy if exists product_images_partner_insert on storage.objects;
create policy product_images_partner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = 'partners' and (storage.foldername(name))[2] = public.my_partner());
drop policy if exists product_images_partner_update on storage.objects;
create policy product_images_partner_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = 'partners' and (storage.foldername(name))[2] = public.my_partner());

-- ---------------------------------------------------------------- the public store
-- What a shopper sees: no costs, no other customers' prices. A signed-in customer of this partner gets their own prices.
create or replace function public.partner_catalog(p_partner text)
returns table (id uuid, sku text, name text, description text, category text, unit text, image_url text,
               price numeric, per_customer boolean, basis text, in_stock boolean, my_price numeric, sort int)
language sql stable security definer set search_path = public as $fn$
  with me as (
    select c.id, c.off_pct from public.partner_customers c
     where c.id = public.my_partner_customer() and c.partner_id = p_partner and c.active
  )
  select i.id, i.sku, i.name, i.description, i.category, i.unit, i.image_url,
         case when i.per_customer then null else i.price end,
         i.per_customer, i.basis,
         case when i.qty_on_hand is null then null else i.qty_on_hand > 0 end,
         (select coalesce(cp.price, case when i.per_customer or i.price is null then null else round(i.price * (1 - me.off_pct / 100), 2) end)
            from me left join public.partner_customer_prices cp on cp.customer_id = me.id and cp.item_id = i.id),
         i.sort
    from public.partner_items i
    join public.partners p on p.id = i.partner_id and p.active
   where i.partner_id = p_partner and i.active
$fn$;
revoke all on function public.partner_catalog(text) from public;
grant execute on function public.partner_catalog(text) to anon, authenticated;

-- An order on a partner's store. Prices come from the database (a customer's own prices when signed in).
create or replace function public.partner_place_order(p_partner text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_quote boolean := false;
  v_id bigint;
  v_cust uuid := public.my_partner_customer();
  v_short text;
  r record;
  q numeric;
  em text := lower(trim(coalesce(p->>'email', '')));
begin
  select short into v_short from public.partners where id = p_partner and active;
  if v_short is null then raise exception 'This store is not open.'; end if;
  if v_cust is not null and not exists (select 1 from public.partner_customers where id = v_cust and partner_id = p_partner) then v_cust := null; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please add your name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please add a good email address.'; end if;
  if v_cust is null and length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) < 10 then raise exception 'Please add a phone number.'; end if;
  if coalesce(p->>'delivery', 'ship') = 'ship' and length(trim(coalesce(p#>>'{address,street}', ''))) < 3 then raise exception 'Please add the address to ship to.'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Your cart is empty.'; end if;
  if jsonb_array_length(p->'items') > 120 then raise exception 'That is a lot of lines. Please call us for an order this size.'; end if;
  if (select count(*) from public.partner_orders where lower(email) = em and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.partner_orders where partner_id = p_partner and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We got several orders from you just now. Please call us and we will help.';
  end if;

  for r in
    select x.item_id, x.sku as x_sku, x.name as x_name, x.qty, c.id, c.sku, c.name, c.unit, c.price, c.per_customer, c.basis, c.my_price
      from jsonb_to_recordset(p->'items') as x(item_id text, sku text, name text, qty numeric)
      left join public.partner_catalog(p_partner) c on c.id::text = x.item_id
  loop
    q := round(coalesce(r.qty, 0));
    if q < 1 or q > 9999 then continue; end if;
    if r.item_id is not null then
      if r.id is null then continue; end if;
      declare price numeric := case when r.basis = 'lb' then null else coalesce(r.my_price, r.price) end;
      begin
        if price is null then v_quote := true; else v_sub := v_sub + price * q; end if;
        v_items := v_items || jsonb_build_object('item_id', r.id, 'sku', r.sku, 'name', r.name, 'unit', r.unit, 'qty', q, 'price', price,
          'per_lb', case when r.basis = 'lb' then r.my_price end);
      end;
    else
      -- A part picked on a gun drawing that isn't on the store's list: priced before it ships.
      if length(trim(coalesce(r.x_sku, ''))) = 0 then continue; end if;
      v_quote := true;
      v_items := v_items || jsonb_build_object('item_id', null, 'sku', left(trim(r.x_sku), 40), 'name', left(trim(coalesce(r.x_name, 'Part')), 160),
        'unit', 'each', 'qty', q, 'price', null);
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Your cart is empty.'; end if;

  insert into public.partner_orders (partner_id, customer_id, placed_by, name, company, email, phone, delivery, address, po, notes, items, subtotal, has_quote, lang)
  values (p_partner, v_cust, auth.uid(), left(trim(p->>'name'), 120), nullif(left(trim(coalesce(p->>'company', '')), 160), ''), left(em, 160),
          nullif(left(trim(coalesce(p->>'phone', '')), 40), ''),
          case when p->>'delivery' = 'pickup' then 'pickup' else 'ship' end,
          case when p->>'delivery' = 'pickup' then null else jsonb_build_object(
            'street', left(trim(coalesce(p#>>'{address,street}', '')), 160), 'city', left(trim(coalesce(p#>>'{address,city}', '')), 80),
            'state', upper(left(trim(coalesce(p#>>'{address,state}', '')), 2)), 'zip', left(trim(coalesce(p#>>'{address,zip}', '')), 10)) end,
          nullif(left(trim(coalesce(p->>'po', '')), 60), ''), nullif(left(trim(coalesce(p->>'notes', '')), 2000), ''),
          v_items, round(v_sub, 2), v_quote, case when p->>'lang' = 'es' then 'es' else 'en' end)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'order_no', v_short || '-' || (1000 + v_id), 'subtotal', round(v_sub, 2), 'has_quote', v_quote,
                            'items', v_items, 'customer_id', v_cust);
end $fn$;
revoke all on function public.partner_place_order(text, jsonb) from public;
grant execute on function public.partner_place_order(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- invites (owner by AMBIT, customers by the owner)
create or replace function public.partner_invite_lookup(p_hash text)
returns table (email text, partner_id text, partner_name text, partner_role text, company text, state text, has_account boolean)
language sql stable security definer set search_path = public as $fn$
  select i.email, i.partner_id, p.name, i.partner_role, c.company,
         case when i.accepted_at is not null then 'used' when i.expires_at < now() then 'expired' else 'open' end,
         exists (select 1 from public.profiles x where lower(x.email) = lower(i.email))
    from public.partner_invites i join public.partners p on p.id = i.partner_id
    left join public.partner_customers c on c.id = i.customer_id
   where i.token_hash = p_hash
$fn$;
revoke all on function public.partner_invite_lookup(text) from public;
grant execute on function public.partner_invite_lookup(text) to anon, authenticated;

create or replace function public.apply_partner_invite(p_user uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare inv public.partner_invites; pr public.profiles;
begin
  select * into pr from public.profiles where id = p_user;
  if pr.id is null then return false; end if;
  select * into inv from public.partner_invites where token_hash = p_hash and accepted_at is null and expires_at > now() for update;
  if inv.id is null or lower(inv.email) <> lower(pr.email) then return false; end if;
  -- Never turn an AMBIT login (staff or an AMBIT customer) into a partner login.
  if pr.role in ('employee', 'admin') or pr.company_id is not null or (pr.partner_id is not null and pr.partner_id <> inv.partner_id) then
    raise exception 'This email already has an AMBIT Intelligence login. Please use a different email.';
  end if;
  update public.profiles
     set partner_id = inv.partner_id, partner_role = inv.partner_role, partner_customer_id = inv.customer_id,
         status = 'active', role = 'customer', approved_at = now()
   where id = p_user;
  update public.partner_invites set accepted_at = now(), accepted_by = p_user where id = inv.id;
  if inv.customer_id is not null then update public.partner_customers set user_id = p_user where id = inv.customer_id; end if;
  return true;
end $fn$;
revoke all on function public.apply_partner_invite(uuid, text) from public, anon, authenticated;

create or replace function public.partner_accept_invite(p_hash text) returns boolean
language sql security definer set search_path = public as $fn$
  select public.apply_partner_invite(auth.uid(), p_hash)
$fn$;
revoke all on function public.partner_accept_invite(text) from public, anon;
grant execute on function public.partner_accept_invite(text) to authenticated;

-- A new invite link (the app makes the secret link and keeps only its fingerprint here).
-- The owner's invite: only a partner viewer at AMBIT (Jeremiah). A customer's invite: only that partner's owner.
create or replace function public.partner_create_invite(p_partner text, p_role text, p_email text, p_customer uuid, p_hash text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; em text := lower(trim(coalesce(p_email, '')));
begin
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  if p_role = 'owner' then
    if not public.can_view_partner(p_partner) then raise exception 'Only AMBIT can invite the store owner.'; end if;
    p_customer := null;
  elsif p_role = 'customer' then
    if public.my_partner() is distinct from p_partner then raise exception 'Only the store owner can invite customers.'; end if;
    if not exists (select 1 from public.partner_customers where id = p_customer and partner_id = p_partner) then raise exception 'Pick the customer first.'; end if;
    update public.partner_customers set email = em, invited_at = now(), updated_at = now() where id = p_customer;
  else
    raise exception 'Unknown invite.';
  end if;
  -- One open link per person: older ones stop working.
  update public.partner_invites set expires_at = now()
   where partner_id = p_partner and lower(email) = em and accepted_at is null and expires_at > now();
  insert into public.partner_invites (partner_id, email, partner_role, customer_id, token_hash, created_by)
  values (p_partner, em, p_role, p_customer, p_hash, auth.uid())
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.partner_create_invite(text, text, text, uuid, text) from public, anon;
grant execute on function public.partner_create_invite(text, text, text, uuid, text) to authenticated;

-- After the order emails go out: note whether they did (only on an order made in the last few minutes).
create or replace function public.partner_mark_emailed(p_id bigint, p_status text) returns void
language sql security definer set search_path = public as $fn$
  update public.partner_orders set email_status = left(p_status, 20)
   where id = p_id and created_at > now() - interval '10 minutes'
$fn$;
revoke all on function public.partner_mark_emailed(bigint, text) from public;
grant execute on function public.partner_mark_emailed(bigint, text) to anon, authenticated;

-- The owner's "set sell prices from my purchase price + markup" button on the price sheet.
create or replace function public.partner_apply_markup(p_partner text, p_pct numeric, p_only_empty boolean) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if public.my_partner() is distinct from p_partner then raise exception 'Only the store owner can change prices.'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 1000 then raise exception 'Use a markup between 0 and 1000 percent.'; end if;
  update public.partner_items
     set price = round(cost * (1 + p_pct / 100), 2), updated_at = now()
   where partner_id = p_partner and active and not per_customer and cost is not null
     and (not p_only_empty or price is null);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.partner_apply_markup(text, numeric, boolean) from public, anon;
grant execute on function public.partner_apply_markup(text, numeric, boolean) to authenticated;

-- New logins made from a partner invite are set up right away (and never show up as AMBIT access requests).
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
  return new;
end $fn$;

-- ---------------------------------------------------------------- Contractors Foam Supply
insert into public.partners (id, name, short, owner_name, email, phone, logo_url, color, color2, tagline, hero_title, hero_text, tagline_es, hero_title_es, hero_text_es)
values ('cfs', 'Contractors Foam Supply', 'CFS', 'Nick Blomberg', 'info@contractorsfoamsupply.com', '660-591-5424', '/partners/cfs/logo.png', '#2d694b', '#24563d',
        'Spray foam rig parts, guns and AMBIT spray foam',
        'Every part your rig needs, in stock and ready to ship.',
        'Guns, parts, hoses and AMBIT spray foam for spray foam contractors. Sign in for your account pricing and your order history.',
        'Repuestos para equipos de espuma, pistolas y espuma AMBIT',
        'Todas las piezas que su equipo necesita, en existencia y listas para enviar.',
        E'Pistolas, repuestos, mangueras y espuma AMBIT para contratistas de espuma en spray. Inicie sesi\u00f3n para ver sus precios y su historial de pedidos.')
on conflict (id) do update set email = excluded.email, phone = excluded.phone, owner_name = excluded.owner_name;

-- Only Jeremiah at AMBIT can look at the CFS side (read only).
insert into public.partner_viewers (partner_id, email) values ('cfs', 'jeremiah.bryant@ambitpu.com') on conflict do nothing;

-- His items: what's on AMBIT's Black Friday sheet now (the ones Jeremiah took off stay off), plus AMBIT spray foam
-- (priced per customer, per lb). No prices yet: Nick types his purchase and sell prices.
insert into public.partner_items (partner_id, product_id, sku, name, description, category, unit, per_customer, basis, sort)
select 'cfs', pr.id, pr.sku, pr.name, pr.description, c.name, pr.unit,
       pr.category_id = 'ambit-foam', case when pr.category_id = 'ambit-foam' then 'lb' else 'unit' end, coalesce(c.sort, 999) * 1000 + coalesce(pr.sort, 0)
  from public.products pr
  left join public.categories c on c.id = pr.category_id
 where pr.active
   and (pr.category_id = 'ambit-foam'
        or exists (select 1 from public.web_sale_items w join public.web_sales s on s.id = w.sale_id
                    where s.slug = 'black-friday-2026' and w.product_id = pr.id))
on conflict (partner_id, sku) do nothing;

-- His photos: AMBIT's product photos with the CFS logo where the ADC logo was (in the app at /partners/cfs/p/).
update public.partner_items i
   set image_url = '/partners/cfs/p/' || x.slug || '.jpg'
  from (select id, trim(both '-' from regexp_replace(lower(sku), '[^a-z0-9]+', '-', 'g')) as slug
          from public.partner_items where partner_id = 'cfs') x
 where i.id = x.id and i.image_url is null
   and x.slug in (
    '117509', '117510', '119626', '15c852', '17x756', '17x757', '19y308', '2000788', '2000810', '2000812',
    '2000975', '2000979', '2001025', '2001026', '2001033', '2001150', '2001152', '2001166', '2005366', '2005697',
    '2006546', '2006548', '2006550', '2006552', '2006553', '2006560', '2007352', '2010991', '206996', '246352',
    '246354', '246355', '246356', '246357', '246359', '246626', '246627', '246628', '246629', '246731',
    '246814', '246962', '246964', '247824', '248129', '248130', '248131', '248133', '248137', '248279',
    '248893', '24r894', '24z834', '256385', '25p588', '261821', '336359', '336360', '336361', '336362',
    '336371', '336374', '336375', '336376', '336379', '336381', '336394', '336396', '336397', '336398',
    '336399', '336400', '336408', '336412', '336413', '336414', '336415', '336417', '336418', '336419',
    '336420', '336422', '336424', '336428', '336437', '336441', '336443', '336508', '336735', '336736',
    '336738', '336740', '340354', '540248', '560249', '590120', 'afa-cc15', 'aft-ct31000', 'amb-seal-50-w', 'amb-seal-50',
    'amb-tite-20-w', 'amb-tite-20', 'ambi-tite-10-ag', 'ambi-tite-204-500', 'ambi-tite-204-wtote', 'ambi-tite-255ag', 'e40451', 'fdtcv', 'fx37rd', 'fx42rd',
    'fx47rd', 'fx9001', 'pc42rd', 'pc47rd', 'pc52rd', 's-t1436', 'st-232532', 'td07-2', 'tr704', 'vb-4060'
   );

-- AMBIT buys gun parts from CFS for drop-ship orders, so AMBIT is one of his customers.
insert into public.partner_customers (partner_id, company, contact, email, phone, terms, notes)
select 'cfs', 'AMBIT Polyurethane', 'AMBIT order desk', 'orders@ambitpu.com', '(817) 677-1200', 'Net 30',
       'AMBIT orders Graco and Binks parts for its drop-ship orders; CFS ships straight to AMBIT''s customer.'
 where not exists (select 1 from public.partner_customers where partner_id = 'cfs' and lower(email) = 'orders@ambitpu.com');

-- Check
select (select count(*) from public.partner_items where partner_id = 'cfs') as "CFS items",
       (select count(*) from public.partner_items where partner_id = 'cfs' and per_customer) as "of them AMBIT foam",
       (select count(*) from public.partner_items where partner_id = 'cfs' and image_url is not null) as "with his photo";
