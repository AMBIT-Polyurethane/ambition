-- AMBITION one-time setup: paste this whole file into Supabase > SQL Editor and click Run.

-- =====================================================================
-- AMBITION - database schema, roles and security rules
-- Run once in Supabase > SQL Editor (paste the whole file, click Run).
-- =====================================================================

-- ---------- Types ----------------------------------------------------
create type public.user_role   as enum ('customer', 'employee', 'admin');
create type public.user_status as enum ('pending', 'active', 'disabled');
create type public.order_status as enum ('new', 'processing', 'completed', 'cancelled');
create type public.audience    as enum ('all', 'customer', 'employee');

-- ---------- Tables ---------------------------------------------------
create table public.branches (
  id       text primary key,                 -- short code, e.g. 'okc'
  name     text not null,                    -- 'Oklahoma City'
  state    text not null,                    -- 'OK'
  address  text,
  phone    text,
  email    text,
  sort     int  not null default 0,
  active   boolean not null default true
);

create table public.companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  account_no        text unique,
  default_branch_id text references public.branches(id) on update cascade,
  phone             text,
  email             text,
  city              text,
  state             text,
  notes             text,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  full_name            text,
  phone                text,
  title                text,
  role                 public.user_role   not null default 'customer',
  status               public.user_status not null default 'pending',
  company_id           uuid references public.companies(id) on delete set null,
  branch_id            text references public.branches(id) on update cascade,
  requested_company    text,
  requested_account_no text,
  created_at           timestamptz not null default now(),
  approved_at          timestamptz,
  approved_by          uuid references public.profiles(id) on delete set null
);
create index profiles_company_idx on public.profiles(company_id);

create table public.categories (
  id              text primary key,          -- 'spray-foam'
  name            text not null,
  customer_priced boolean not null default false,  -- true = "Based on customer pricing"
  sort            int not null default 0
);

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  name            text not null,
  description     text,
  category_id     text references public.categories(id) on update cascade,
  unit            text not null default 'each',
  list_price      numeric(12,2),
  customer_priced boolean,                   -- blank = follow the category
  image_url       text,
  active          boolean not null default true,
  sort            int not null default 0,
  updated_at      timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);

create sequence public.order_no_seq start 1001;

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  order_no             bigint not null unique default nextval('public.order_no_seq'),
  placed_by            uuid not null references public.profiles(id),
  company_id           uuid references public.companies(id) on delete set null,
  company_name         text not null,
  account_no           text,
  placed_by_name       text,
  placed_by_email      text,
  placed_by_phone      text,
  placed_by_role       public.user_role not null,
  delivery_method      text not null check (delivery_method in ('pickup', 'jobsite', 'dropship')),
  branch_id            text references public.branches(id) on update cascade,
  ship_address         text,
  po_number            text,
  needed_by            date,
  notes                text,
  est_subtotal         numeric(12,2) not null default 0,
  has_customer_pricing boolean not null default false,
  status               public.order_status not null default 'new',
  email_status         text not null default 'pending',   -- pending | sent | failed | not_configured
  email_error          text,
  created_at           timestamptz not null default now()
);
create index orders_company_idx on public.orders(company_id);
create index orders_placed_by_idx on public.orders(placed_by);
create index orders_created_idx on public.orders(created_at desc);

create table public.order_items (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  sku             text not null,
  name            text not null,
  unit            text not null,
  qty             numeric(12,2) not null check (qty > 0),
  unit_price      numeric(12,2),
  customer_priced boolean not null default false,
  line_total      numeric(12,2)
);
create index order_items_order_idx on public.order_items(order_id);

create table public.links (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subtitle    text,
  url         text,                          -- blank = shows as "Coming soon"
  icon        text not null default 'link',
  section     text not null default 'resources' check (section in ('forms', 'resources')),
  audience    public.audience not null default 'all',
  open_in_app boolean not null default false,
  sort        int not null default 0,
  active      boolean not null default true
);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  doc_type     text not null default 'Other'
               check (doc_type in ('TDS', 'SDS', 'ESR', 'TSB', 'Guide', 'Marketing', 'Training', 'Other')),
  product      text,
  code         text,                         -- e.g. 'TSB-013'
  description  text,
  url          text,                         -- link to a file hosted elsewhere
  storage_path text,                         -- or a file uploaded to the 'docs' bucket
  audience     public.audience not null default 'all',
  published_on date,
  sort         int not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.courses (
  id       uuid primary key default gen_random_uuid(),
  title    text not null,
  subtitle text,
  minutes  int,
  lessons  int,
  audience public.audience not null default 'all',
  status   text not null default 'coming_soon' check (status in ('coming_soon', 'live')),
  url      text,
  sort     int not null default 0
);

-- ---------- Helper functions (used by the security rules) -----------
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

create or replace function public.is_employee() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('employee', 'admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.my_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and status = 'active'
$$;

-- Employees see everything; customers see 'all' + 'customer'.
create or replace function public.can_see(a public.audience) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and (a = 'all' or public.is_employee() or (a = 'customer' and public.my_role() = 'customer'))
$$;

-- ---------- New sign-ups ---------------------------------------------
-- Every new account starts as a PENDING customer. AMBIT employees become active
-- employees automatically when they sign in with Microsoft (see next trigger).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Promote @ambitpu.com Microsoft sign-ins to active employees.
create or replace function public.promote_microsoft_employee(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ident record;
begin
  select i.identity_data into ident
    from auth.identities i
   where i.user_id = p_user and i.provider = 'azure'
   limit 1;
  if not found then return; end if;
  if lower(coalesce(ident.identity_data->>'email', (select email from auth.users where id = p_user))) like '%@ambitpu.com' then
    update public.profiles
       set role        = case when role = 'admin' then role else 'employee'::public.user_role end,
           status      = case when status = 'disabled' then status else 'active'::public.user_status end,
           full_name   = coalesce(full_name, nullif(ident.identity_data->>'full_name', ''), nullif(ident.identity_data->>'name', '')),
           approved_at = coalesce(approved_at, now())
     where id = p_user;
  end if;
end $$;

create or replace function public.handle_new_identity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.provider = 'azure' then
    perform public.promote_microsoft_employee(new.user_id);
  end if;
  return new;
end $$;

create trigger on_auth_identity_created
  after insert on auth.identities
  for each row execute function public.handle_new_identity();

-- Called by the app right after a Microsoft sign-in (belt and braces for linked accounts).
create or replace function public.sync_microsoft_employee() returns void
language sql security definer set search_path = public as $$
  select public.promote_microsoft_employee(auth.uid())
$$;

-- ---------- Placing an order ----------------------------------------
-- Prices are always read from the products table, never trusted from the browser.
create or replace function public.place_order(
  p_items           jsonb,       -- [{"product_id": "...", "qty": 2}, ...]
  p_delivery_method text,
  p_branch_id       text default null,
  p_ship_address    text default null,
  p_po_number       text default null,
  p_needed_by       date default null,
  p_notes           text default null,
  p_company_id      uuid default null,   -- employees only: who the order is for
  p_customer_name   text default null    -- employees only: customer not in the list
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
    case when p_delivery_method = 'pickup' then p_branch_id end,
    case when p_delivery_method <> 'pickup' then trim(p_ship_address) end,
    nullif(trim(p_po_number), ''),
    p_needed_by,
    nullif(trim(p_notes), ''))
  returning id into new_id;

  for item in select * from jsonb_array_elements(p_items) loop
    q := nullif(item->>'qty', '')::numeric;
    if q is null or q <= 0 then continue; end if;

    select p.id, p.sku, p.name, p.unit, p.list_price,
           coalesce(p.customer_priced, c.customer_priced, false) as cp
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

  update public.orders set est_subtotal = subtotal, has_customer_pricing = any_cp where id = new_id;
  return new_id;
end $$;

create or replace function public.mark_order_email(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set email_status = p_status, email_error = left(p_error, 500)
   where id = p_order and (placed_by = auth.uid() or public.is_employee());
$$;

-- ---------- Admin actions -------------------------------------------
create or replace function public.admin_update_user(
  p_user    uuid,
  p_role    public.user_role,
  p_status  public.user_status,
  p_company uuid default null,
  p_branch  text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change accounts.';
  end if;
  if p_user = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then
    raise exception 'You cannot remove your own admin access.';
  end if;
  update public.profiles
     set role        = p_role,
         status      = p_status,
         company_id  = p_company,
         branch_id   = coalesce(p_branch, branch_id),
         approved_at = case when status <> 'active' and p_status = 'active' then now() else approved_at end,
         approved_by = case when status <> 'active' and p_status = 'active' then auth.uid() else approved_by end
   where id = p_user;
end $$;

-- Bootstrap: run in the SQL Editor after you create your own account.
--   select public.make_admin('jeremiah.bryant@ambitpu.com');
create or replace function public.make_admin(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.profiles
     set role = 'admin', status = 'active', approved_at = coalesce(approved_at, now())
   where email = lower(trim(p_email));
  get diagnostics n = row_count;
  if n = 0 then
    return 'No account found for ' || p_email || '. Create the account in the app first.';
  end if;
  return p_email || ' is now an admin.';
end $$;

-- ---------- Keep products.updated_at fresh ---------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------- Security rules (Row Level Security) ----------------------
alter table public.branches    enable row level security;
alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.categories  enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.links       enable row level security;
alter table public.documents   enable row level security;
alter table public.courses     enable row level security;

-- Branches: public (the request-access form lists them before sign-in)
create policy branches_read  on public.branches for select to anon, authenticated using (true);
create policy branches_admin on public.branches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Companies
create policy companies_read on public.companies for select to authenticated
  using (public.is_employee() or id = public.my_company_id());
create policy companies_admin on public.companies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Profiles: you see yourself; employees see everyone (directory, orders)
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_employee());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Catalog
create policy categories_read on public.categories for select to authenticated using (public.is_active());
create policy categories_admin on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy products_read on public.products for select to authenticated
  using (public.is_active() and (active or public.is_admin()));
create policy products_admin on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Orders (created only through place_order)
create policy orders_read on public.orders for select to authenticated
  using (public.is_employee() or placed_by = auth.uid()
         or (company_id is not null and company_id = public.my_company_id()));
create policy orders_update_staff on public.orders for update to authenticated
  using (public.is_employee()) with check (public.is_employee());
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Links, documents, courses
create policy links_read on public.links for select to authenticated
  using (public.can_see(audience) and (active or public.is_admin()));
create policy links_admin on public.links for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy documents_read on public.documents for select to authenticated
  using (public.can_see(audience) and (active or public.is_admin()));
create policy documents_admin on public.documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy courses_read on public.courses for select to authenticated
  using (public.can_see(audience));
create policy courses_admin on public.courses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Column-level limits --------------------------------------
-- People can edit their own name/phone/title/branch, nothing else.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant  update (full_name, phone, title, branch_id) on public.profiles to authenticated;
-- Orders: staff can change status only. Rows are created by place_order.
revoke insert, update, delete on public.orders from anon, authenticated;
grant  update (status) on public.orders to authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
-- Nothing but branches is readable before sign-in.
revoke all on public.companies, public.profiles, public.categories, public.products,
              public.orders, public.order_items, public.links, public.documents, public.courses
  from anon;

-- Functions: only signed-in users may call the app functions; make_admin is SQL-Editor only.
revoke execute on function public.place_order(jsonb, text, text, text, text, date, text, uuid, text) from public, anon;
revoke execute on function public.mark_order_email(uuid, text, text) from public, anon;
revoke execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid, text) from public, anon;
revoke execute on function public.sync_microsoft_employee() from public, anon;
revoke execute on function public.promote_microsoft_employee(uuid) from public, anon, authenticated;
revoke execute on function public.make_admin(text) from public, anon, authenticated;
grant execute on function public.place_order(jsonb, text, text, text, text, date, text, uuid, text) to authenticated;
grant execute on function public.mark_order_email(uuid, text, text) to authenticated;
grant execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid, text) to authenticated;
grant execute on function public.sync_microsoft_employee() to authenticated;

-- =====================================================================
-- AMBITION - starter data. Safe to edit later in the app (Admin) or in
-- Supabase > Table Editor. Sample products are replaced when you import
-- your product list (Admin > Products > Import CSV).
-- =====================================================================

insert into public.branches (id, name, state, sort) values
  ('okc', 'Oklahoma City', 'OK', 1),
  ('atx', 'Arlington',     'TX', 2),
  ('smx', 'San Marcos',    'TX', 3),
  ('jax', 'Jacksonville',  'FL', 4),
  ('mob', 'Mobile',        'AL', 5)
on conflict (id) do nothing;

insert into public.categories (id, name, customer_priced, sort) values
  ('spray-foam', 'Spray foam',   true,  1),
  ('fiberglass', 'Fiberglass',   true,  2),
  ('guns-parts', 'Guns & parts', false, 3),
  ('ppe',        'PPE & safety', false, 4),
  ('supplies',   'Supplies',     false, 5)
on conflict (id) do nothing;

insert into public.products (sku, name, description, category_id, unit, list_price, sort) values
  ('SAMPLE-SEAL',   'AMBI-SEAL Open Cell (sample)',        'Set · A + B drums',        'spray-foam', 'set',  null, 1),
  ('SAMPLE-TITE',   'AMBI-TITE Closed Cell (sample)',      'Set · A + B drums',        'spray-foam', 'set',  null, 2),
  ('SAMPLE-ROOF',   'AMBI-ROOF Roofing Foam (sample)',     'Set · A + B drums',        'spray-foam', 'set',  null, 3),
  ('SAMPLE-BATT',   'Fiberglass Batt R-13 Unfaced (sample)', '15 in × 93 in · bag',    'fiberglass', 'bag',  null, 4),
  ('SAMPLE-BLOW',   'Fiberglass Blowing Wool (sample)',    'Bag',                      'fiberglass', 'bag',  null, 5),
  ('SAMPLE-CHMBR',  'Mix Chamber (sample)',                'For AP-style guns',        'guns-parts', 'each', null, 6),
  ('SAMPLE-GREASE', 'Gun Grease Cartridge (sample)',       '14 oz',                    'guns-parts', 'each', null, 7),
  ('SAMPLE-SUITS',  'Disposable Coveralls (sample)',       'Case of 25 · XL',          'ppe',        'case', null, 8),
  ('SAMPLE-GLOVES', 'Nitrile Gloves (sample)',             'Box of 100 · L',           'ppe',        'box', null, 9),
  ('SAMPLE-CART',   'Respirator Cartridges (sample)',      'Organic vapor · pair',     'ppe',        'pair', null, 10),
  ('SAMPLE-STAPLE', 'Insulation Staples (sample)',         '9/16 in · box',            'supplies',   'box', null, 11),
  ('SAMPLE-POLY',   'Poly Sheeting 6 mil (sample)',        '10 ft × 100 ft roll',      'supplies',   'roll', null, 12)
on conflict (sku) do nothing;

-- Home-screen forms and tiles. Paste the real links in Admin > Links.
insert into public.links (title, subtitle, url, icon, section, audience, open_in_app, sort) values
  ('Price request',      'Quote pricing for a customer',  null, 'tag',       'forms',     'employee', true,  1),
  ('Travel request',     'Trips, mileage, lodging',       null, 'plane',     'forms',     'employee', true,  2),
  ('Time off request',   'Vacation, sick and personal days', null, 'calendar', 'forms',   'employee', true,  3),
  ('Customer complaint', 'Product quality report',        null, 'alert',     'forms',     'employee', true,  4),
  ('Spray job data log', 'Field conditions & settings',   null, 'clipboard', 'forms',     'all',      true,  5),
  ('Marketing kit',      'Co-branded material',           null, 'megaphone', 'resources', 'customer', false, 10),
  ('Marketing content',  'Co-branded material',           null, 'megaphone', 'resources', 'employee', false, 10),
  ('Training videos',    'Watch on the job',              null, 'play',      'resources', 'all',      false, 11),
  ('Training manuals',   'Building science',              null, 'book',      'resources', 'employee', false, 12),
  ('Tech support',       'Call or email AMBIT',           'mailto:orders@ambitpu.com', 'headset', 'resources', 'customer', false, 13);

insert into public.documents (title, doc_type, product, code, description, audience, sort) values
  ('AMBI-SEAL Technical Data Sheet', 'TDS', 'AMBI-SEAL', null, 'Add the PDF in Admin > Docs', 'all', 1),
  ('AMBI-SEAL Safety Data Sheet',    'SDS', 'AMBI-SEAL', null, 'Add the PDF in Admin > Docs', 'all', 2),
  ('AMBI-TITE Technical Data Sheet', 'TDS', 'AMBI-TITE', null, 'Add the PDF in Admin > Docs', 'all', 3),
  ('AMBI-TITE Safety Data Sheet',    'SDS', 'AMBI-TITE', null, 'Add the PDF in Admin > Docs', 'all', 4),
  ('Combustion safety',              'TSB', null, 'TSB-013', 'Technical service bulletin', 'all', 10),
  ('Minor open-cell separation',     'TSB', null, 'TSB-014', 'Technical service bulletin', 'all', 11),
  ('HVAC & the building envelope',   'TSB', null, 'TSB-015', 'Technical service bulletin', 'all', 12);

insert into public.courses (title, subtitle, lessons, minutes, sort) values
  ('Building science fundamentals',        'Heat, air and moisture movement',     6, 45, 1),
  ('Spray foam application',               'Set-up, technique and yield',         8, 60, 2),
  ('Moisture, dew point & substrate prep', 'Reading conditions before you spray', 4, 30, 3),
  ('HVAC & the building envelope',         'Sizing and ventilation after foam',   5, 40, 4),
  ('Combustion safety',                    'Appliances in sealed homes',          4, 30, 5);

-- =====================================================================
-- AMBITION - file storage for product docs (PDFs)
-- Files under "internal/" are visible to AMBIT employees only.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy docs_read on storage.objects for select to authenticated
  using (bucket_id = 'docs' and public.is_active()
         and (name not like 'internal/%' or public.is_employee()));

create policy docs_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and public.is_admin());
create policy docs_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'docs' and public.is_admin());
create policy docs_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and public.is_admin());

-- =====================================================================
-- AMBITION update 0004 - staff-only rules
-- * Only @ambitpu.com accounts can be AMBIT employees or admins.
-- * Adds the Time off request form (AMBIT staff only).
-- Run once in Supabase > SQL Editor.
-- =====================================================================

create or replace function public.admin_update_user(
  p_user    uuid,
  p_role    public.user_role,
  p_status  public.user_status,
  p_company uuid default null,
  p_branch  text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change accounts.';
  end if;
  select * into target from public.profiles where id = p_user;
  if target.id is null then
    raise exception 'Account not found.';
  end if;
  if p_role in ('employee', 'admin') and target.email not like '%@ambitpu.com' then
    raise exception 'Only @ambitpu.com accounts can be AMBIT staff. % is a contractor account.', target.email;
  end if;
  if p_user = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then
    raise exception 'You cannot remove your own admin access.';
  end if;
  update public.profiles
     set role        = p_role,
         status      = p_status,
         company_id  = case when p_role = 'customer' then p_company else null end,
         branch_id   = coalesce(p_branch, branch_id),
         approved_at = case when status <> 'active' and p_status = 'active' then now() else approved_at end,
         approved_by = case when status <> 'active' and p_status = 'active' then auth.uid() else approved_by end
   where id = p_user;
end $$;

create or replace function public.make_admin(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if lower(trim(p_email)) not like '%@ambitpu.com' then
    return 'Admins must use an @ambitpu.com account.';
  end if;
  update public.profiles
     set role = 'admin', status = 'active', company_id = null, approved_at = coalesce(approved_at, now())
   where email = lower(trim(p_email));
  get diagnostics n = row_count;
  if n = 0 then
    return 'No account found for ' || p_email || '. Create the account in the app first.';
  end if;
  return p_email || ' is now an admin.';
end $$;

-- Belt and braces: a staff role can never sit on a non-AMBIT email, however it is set.
alter table public.profiles drop constraint if exists staff_must_be_ambit;
alter table public.profiles add constraint staff_must_be_ambit
  check (role = 'customer' or email like '%@ambitpu.com') not valid;

revoke execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid, text) from public, anon;
grant  execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid, text) to authenticated;
revoke execute on function public.make_admin(text) from public, anon, authenticated;

insert into public.links (title, subtitle, url, icon, section, audience, open_in_app, sort)
select 'Time off request', 'Vacation, sick and personal days', null, 'calendar', 'forms', 'employee', true, 3
where not exists (select 1 from public.links where lower(title) = 'time off request');

-- =====================================================================
-- AMBITION update 0005
-- * Branch codes match the Inventory Control Workbook: OKC, ATX, SMX, JAX, MOB
--   (customers, staff and past orders follow automatically).
-- * Removes the sample products and any category left with no products.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

update public.branches set id = 'atx' where id = 'arl' and not exists (select 1 from public.branches where id = 'atx');
update public.branches set id = 'smx' where id = 'smt' and not exists (select 1 from public.branches where id = 'smx');

delete from public.products where sku like 'SAMPLE-%';
delete from public.categories c where not exists (select 1 from public.products p where p.category_id = c.id);

-- =====================================================================
-- AMBITION update 0006 - product photos
-- * Public "product-images" storage bucket (photos load fast for everyone;
--   only admins can add, replace or remove them).
-- * admin_set_product_images(): attach many photos to products by SKU at once.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

drop policy if exists product_images_read on storage.objects;
drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_update on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;

create policy product_images_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- p = [{"sku": "336508", "url": "https://..."}, ...]; url null removes the photo.
create or replace function public.admin_set_product_images(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change product photos.';
  end if;
  update public.products pr
     set image_url = x.url
    from jsonb_to_recordset(p) as x(sku text, url text)
   where lower(pr.sku) = lower(x.sku);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.admin_set_product_images(jsonb) from public, anon;
grant execute on function public.admin_set_product_images(jsonb) to authenticated;

-- =====================================================================
-- AMBITION - product docs library
--  * more document types (code reports, warranties, certificates, SPFA library)
--  * a document can belong to several products (the A-side SDS covers 3)
--  * revision text, renewal date for code reports, library category
--  * loads the current AMBIT product docs and the SPFA library from ambitpu.com.
--    The rows start as links to the website; Admin > Docs > "Copy files into
--    the app" stores a copy of each file in the app's own storage.
-- Safe to run more than once.
-- =====================================================================

alter table public.documents drop constraint if exists documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check check (doc_type in
  ('TDS', 'SDS', 'ESR', 'CCRR', 'TSB', 'Guide', 'Warranty', 'Certificate',
   'Marketing', 'Training', 'Industry', 'Other'));

alter table public.documents add column if not exists products   text[] not null default '{}';
alter table public.documents add column if not exists category   text;   -- library shelf, e.g. 'Roofing'
alter table public.documents add column if not exists revision   text;   -- shown as-is, e.g. 'Rev. 10/01/2024'
alter table public.documents add column if not exists renewal_on date;   -- code reports: renewal / expiry date

-- the old single "product" column becomes the first entry of "products"
update public.documents set products = array[product]
 where product is not null and product <> '' and products = '{}';

-- the empty placeholders from the first setup are replaced by the real files below
delete from public.documents
 where url is null and storage_path is null and doc_type in ('TDS', 'SDS')
   and title in ('AMBI-SEAL Technical Data Sheet', 'AMBI-SEAL Safety Data Sheet',
                 'AMBI-TITE Technical Data Sheet', 'AMBI-TITE Safety Data Sheet');

-- ---------------------------------------------------------------- AMBIT product docs
insert into public.documents (title, doc_type, products, code, description, revision, renewal_on, url, audience, sort)
select v.title, v.doc_type, v.products, v.code, v.description, v.revision, v.renewal_on::date,
       'https://ambitpu.com/wp-content/uploads/' || v.file, 'all', v.sort
from (values
  ('AMBI-SEAL 5.0 Technical Data Sheet', 'TDS', array['AMBI-SEAL 5.0'], null, 'Open-cell spray foam', 'Rev. 10/01/2024', null,
   '2025/03/TDS-AMBI-SEAL-5.0-Revision-10-01-2024.pdf', 101),
  ('PMDI ISO (A-side) Safety Data Sheet', 'SDS', array['AMBI-SEAL 5.0', 'AMBI-TITE 204', 'AMBI-JACK 4.0'], null, 'A-component for AMBI-SEAL, AMBI-TITE and AMBI-JACK', 'Rev. 10/05/2024', null,
   '2025/03/SDS-AMBIT-PMDI-ISO-A-COMPONENT-10-2024.pdf', 102),
  ('AMBI-SEAL 5.0 B-side Safety Data Sheet', 'SDS', array['AMBI-SEAL 5.0'], null, 'B-component (resin)', 'Rev. 09/23/2020', null,
   '2025/03/SDS-AMBI-SEAL-5.0-Open-Cell-B-Component-2021-04-26.pdf', 103),
  ('AMBI-SEAL 5.0 Code Compliance Research Report', 'CCRR', array['AMBI-SEAL 5.0'], 'CCRR-0393', 'Intertek code compliance report', 'Rev. 11/21/2024', '2025-11-30',
   '2025/03/CCRR-0393-AMBI-SEAL-5.0-11-30-2025-1.pdf', 104),
  ('AMBI-SEAL 5.0 Product Application Guide', 'Guide', array['AMBI-SEAL 5.0'], null, null, '12/12/2022', null,
   '2025/03/Product-Application-Guide-AMBI-SEAL-5.0-2022-12-12.pdf', 105),
  ('AMBI-SEAL 5.0 Warranty & Registration Form', 'Warranty', array['AMBI-SEAL 5.0'], null, null, '06/14/2021', null,
   '2025/03/AMBI-SEAL-5.0-Warranty-and-Registration-Form-2021-06-14.pdf', 106),
  ('Insulation Certificate', 'Certificate', array['AMBI-SEAL 5.0', 'AMBI-JACK 4.0'], null, null, '04/26/2024', null,
   '2025/03/INSULATION-CERTIFICATES-04-26-2024.pdf', 107),
  ('Flame Control 60-60A Thermal Barrier Data Sheet', 'TDS', array['AMBI-SEAL 5.0', 'AMBI-JACK 4.0'], null, '15-minute thermal barrier coating over spray foam', null, null,
   '2025/05/Flame-Control-60-60A.pdf', 108),

  ('AMBI-TITE 204 HFO Technical Data Sheet', 'TDS', array['AMBI-TITE 204'], null, 'Closed-cell HFO spray foam', 'Rev. 05/07/2025', null,
   '2026/06/TDS-AMBI-TITE-204-HFO-05-07-June-2026.pdf', 201),
  ('AMBI-TITE 204 HFO B-side Safety Data Sheet', 'SDS', array['AMBI-TITE 204'], null, 'B-component (resin)', 'Rev. 09/01/2022', null,
   '2025/11/SAFETY-DATA-SHEET-AMBI-TITE-204-HFO-Closed-Cell-SPF-System-B-Component-2022-09-01.pdf', 203),
  ('AMBI-TITE 204 HFO ICC-ES Evaluation Report', 'ESR', array['AMBI-TITE 204'], 'ESR-4427', 'ICC-ES evaluation report (includes FL supplement)', 'Reissued May 2025', '2027-05-01',
   '2025/11/ESR-4427-AMBI-TITE-204-HFO-May-2025.pdf', 204),
  ('AMBI-TITE 204 HFO Product Application Guide', 'Guide', array['AMBI-TITE 204'], null, null, '01/21/2025', null,
   '2025/03/Product-Application-Guide-AMBI-TITE-204-HFO-01-21-2025-KIM-HIGHT.pdf', 205),
  ('AMBI-TITE 204 HFO Warranty & Registration Form', 'Warranty', array['AMBI-TITE 204'], null, null, null, null,
   '2025/03/AMBI-TITE-204-HFO-Warranty-and-Registration-Form.pdf', 206),
  ('AMBI-TITE 204 HFO Product Brochure', 'Marketing', array['AMBI-TITE 204'], null, null, '11/08/2023', null,
   '2025/03/AMBI-TITE-204-HFO-Product-Flyer-2023-11-08-1.pdf', 208),

  ('AMBI-JACK 4.0 Technical Data Sheet', 'TDS', array['AMBI-JACK 4.0'], null, 'Concrete lifting foam', 'Rev. 03/25/2025', null,
   '2025/03/TDS-AMBI-JACK-4.0-Revision-225-03-25-Belinda-Kemper.pdf', 301),
  ('AMBI-JACK 4.0 B-side Safety Data Sheet', 'SDS', array['AMBI-JACK 4.0'], null, 'B-component (resin)', 'Rev. 08/03/2021', null,
   '2025/03/SDS-AMBI-JACK-4.0-Concrete-Lifing-System-B-Component-2021-08-03.pdf', 303),
  ('AMBI-JACK 4.0 Product Brochure', 'Marketing', array['AMBI-JACK 4.0'], null, null, '11/12/2024', null,
   '2025/03/AMBI-JACK-4.0-Product-Flyer-11-12-2024.pdf', 308),

  ('AMBI-ROOF 2.8 HFO Technical Data Sheet', 'TDS', array['AMBI-ROOF 2.8'], null, 'Roofing foam', 'Rev. 08/29/2024', null,
   '2025/11/TDS-AMBI-ROOF-2.8-HFO-08-29-2024.pdf', 401),
  ('AMBI-ROOF 2.8 Roofing Foam System Safety Data Sheet', 'SDS', array['AMBI-ROOF 2.8'], null, null, '2025', null,
   '2025/09/SAFETY-DATA-SHEET-AMBI-ROOF-2.8-ROOFING-FOAM-SYSTEM-2025.docx.pdf', 402)
) as v(title, doc_type, products, code, description, revision, renewal_on, file, sort)
where not exists (select 1 from public.documents d where d.url = 'https://ambitpu.com/wp-content/uploads/' || v.file);

-- ---------------------------------------------------------------- SPFA technical library
insert into public.documents (title, doc_type, code, category, url, audience, sort)
select v.title, 'Industry', v.code, v.category, 'https://ambitpu.com/wp-content/uploads/2025/10/' || v.file, 'all', v.sort
from (values
  ('SPFA-102', 'Roofing',    'A Guide for Selection of Elastomeric Protective Coatings Over Exterior SPF Applications', 'SPFA-102_010121.pdf', 1102),
  ('SPFA-103', 'Specialty',  'SPF Insulation Systems for Metal Service Vessels (-30°F to 200°F)', 'SPFA-103_010121.pdf', 1103),
  ('SPFA-104', 'Roofing',    'SPF Systems for New and Remedial Roofing', 'SPFA104_013123.pdf', 1104),
  ('SPFA-107', 'Roofing',    'SPF Roofing Blisters: Causes, Types, Prevention and Repair', 'SPFA-107_012725.pdf', 1107),
  ('SPFA-110', 'Roofing',    'SPF Aggregate Systems for New and Remedial Roofing', 'SPFA-110_012725.pdf', 1110),
  ('SPFA-111', 'Specialty',  'SPF Systems for Cold Storage Facilities (-40°F to +50°F)', 'SPFA-111_010121.pdf', 1111),
  ('SPFA-112', 'Insulation', 'SPF for Residential Building Envelope Insulation and Air Seal', 'SPFA-112_011021.pdf', 1112),
  ('SPFA-118', 'General',    'Moisture Management (Moisture Vapor Transmission)', 'SPFA-118-Moisture-Vapor-Transmission.pdf', 1118),
  ('SPFA-119', 'General',    'Glossary of Terms', 'SPFA-119_050223.pdf', 1119),
  ('SPFA-121', 'General',    'SPF Estimating Guide', 'SPFA-121_011021.pdf', 1121),
  ('SPFA-122', 'Roofing',    'Renewal of Foam and Coatings for SPF Roof Systems', 'SPFA-122_012725.pdf', 1122),
  ('SPFA-126', 'Insulation', 'Thermal and Ignition Barriers for SPF Insulation', 'SPFA-126_101222.pdf', 1126),
  ('SPFA-127', 'Roofing',    'SPF Roof Systems Maintenance Manual', 'SPFA-127_011021.pdf', 1127),
  ('SPFA-130', 'Roofing',    'SPF Roofing: The High-Performance, Weather-Resistant Solution (brochure)', 'SPFA-130-Spray-Polyurethane-Foam-Roofing.pdf', 1130),
  ('SPFA-134', 'Insulation', 'SPF Insulation for Metal Buildings', 'SPFA-134_-022825.pdf', 1134),
  ('SPFA-137', 'General',    'High-Pressure Spray Foam Equipment Guidelines', 'SPFA-137-122321.pdf', 1137),
  ('SPFA-138', 'Roofing',    'Evaluation of Roof Assembly for SPF Roof Systems', 'SPFA-138_011021.pdf', 1138),
  ('SPFA-139', 'Roofing',    'Repair of SPF Roof Systems Due to Hail and Wind-Driven Damage', 'SPFA-139_011021.pdf', 1139),
  ('SPFA-140', 'Insulation', 'SPF Insulation for the Exterior of Foundation Walls', 'SPFA-140_011021.pdf', 1140),
  ('SPFA-141', 'Insulation', 'SPF Insulation for Unvented (Conditioned) Attics and Cathedralized Ceilings', 'SPFA-141_010121.pdf', 1141),
  ('SPFA-142', 'Roofing',    'Securing Roof Components with SPF Adhesives', 'SPFA-142_012725.pdf', 1142),
  ('SPFA-143', 'General',    'Primers for SPF Insulation and Roofing Systems', 'SPFA-143_011021.pdf', 1143),
  ('SPFA-144', 'General',    'Coating Equipment Guidelines', 'SPFA-144_011021.pdf', 1144),
  ('SPFA-145', 'Insulation', 'Surface Texture of SPF', 'SPFA-145_011021.pdf', 1145),
  ('SPFA-146', 'Insulation', 'SPF for Hybrid Insulation Systems, Part 1: Warm Climates', 'SPFA-146_011021.pdf', 1146),
  ('SPFA-147', 'Insulation', 'SPF for Hybrid Insulation Systems, Part 2: Cold Climates', 'SPFA-147_011021.pdf', 1147),
  ('SPFA-150', 'Roofing',    'Photovoltaic (PV) Systems and SPF Roof Systems', 'SPFA-150_011021.pdf', 1150),
  ('SPFA-152', 'Insulation', 'SPF Insulation for the Interior of Basement and Crawlspace Walls', 'SPFA-152-011021.pdf', 1152),
  ('SPFA-153', 'Insulation', 'SPF Insulation Below Concrete Slabs', 'SPFA-153_011021.pdf', 1153),
  ('SPFA-154', 'Insulation', 'A Homeowner''s Guide to SPF Insulation (brochure)', 'SPFA-154-Insulation-Marketing-Brochure.pdf', 1154),
  ('SPFA-155', 'General',    'SPF Low-Pressure Equipment Guidelines', 'SPFA-155-021022.pdf', 1155),
  ('SPFA-157', 'Specialty',  'Polyurethane Foam for Concrete Lifting (Slab Jacking)', 'SPFA-157-Concrete-Lifting-050123.pdf', 1157),
  ('SPFA-158', 'Specialty',  'Polyurethane Foam for Concrete Repair (brochure)', 'SPFA-158-Concrete-Lifting-Brochure.pdf', 1158),
  ('SPFA TT-I4', 'General',  'Tech Tip: SPF and CPVC Piping', 'SPFA-TT-I4-SPF-and-CPVC-Piping-2021.pdf', 1199)
) as v(code, category, title, file, sort)
where not exists (select 1 from public.documents d where d.url = 'https://ambitpu.com/wp-content/uploads/2025/10/' || v.file);

-- =====================================================================
-- AMBITION - "My price requests"
-- Price requests are matched to a rep by the name picked in the form's
-- SALES REP box. When that name isn't spelled the same as the rep's app
-- account (e.g. "Mike" vs "Michael"), an admin links the two here.
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.rep_name_links (
  rep_name   text primary key,   -- the name as it appears on the form (lower case)
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rep_name_links enable row level security;

drop policy if exists rep_links_read on public.rep_name_links;
drop policy if exists rep_links_admin on public.rep_name_links;
create policy rep_links_read on public.rep_name_links for select to authenticated
  using (public.is_employee());
create policy rep_links_admin on public.rep_name_links for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.rep_name_links from anon;

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

-- =====================================================================
-- AMBITION - Customer approval for orders
-- * Orders AMBIT staff place for a customer are emailed to the customer
--   with a secure link. The order goes to orders@ambitpu.com only after
--   the customer approves (or asks for changes).
-- * Contractors ordering for themselves approve in the app ("Approve order").
-- * Job-site deliveries remember which branch they ship from.
-- * Branch street addresses for the printed order (blanks only).
-- Safe to run more than once.
-- =====================================================================

alter table public.orders add column if not exists approval_status       text not null default 'not_required';
alter table public.orders add column if not exists approval_method       text;         -- email_link | in_app | staff_recorded
alter table public.orders add column if not exists approval_email        text;         -- where the approval link was sent
alter table public.orders add column if not exists approval_token_hash   text;         -- sha256 of the link token (the token itself is never stored)
alter table public.orders add column if not exists approval_sent_at      timestamptz;
alter table public.orders add column if not exists approval_expires_at   timestamptz;
alter table public.orders add column if not exists approval_email_status text;         -- sent | failed | not_configured
alter table public.orders add column if not exists approval_email_error  text;
alter table public.orders add column if not exists approved_at           timestamptz;
alter table public.orders add column if not exists approved_by_name      text;
alter table public.orders add column if not exists approval_note         text;         -- the customer's change request, or how staff got the approval
alter table public.orders add column if not exists approval_ref          text;         -- APV-1048-7F3K, printed on the order

do $$ begin
  alter table public.orders add constraint orders_approval_status_check
    check (approval_status in ('not_required', 'pending', 'approved', 'changes_requested'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_approval_method_check
    check (approval_method is null or approval_method in ('email_link', 'in_app', 'staff_recorded'));
exception when duplicate_object then null; end $$;

create unique index if not exists orders_approval_token_key on public.orders(approval_token_hash) where approval_token_hash is not null;
create index if not exists orders_approval_status_idx on public.orders(approval_status);

-- Left over from the customer update (0009): harmless to repeat.
alter table public.companies drop constraint if exists companies_created_by_fkey;

-- Branch street addresses, shown on the printed order. Only fills blanks.
update public.branches set address = '4708 South Council Rd, Oklahoma City, OK 73179'    where id = 'okc' and coalesce(address, '') = '';
update public.branches set address = '3701 East Randol Mill Rd, Arlington, TX 76011'     where id = 'atx' and coalesce(address, '') = '';
update public.branches set address = '2101 Clovis R Barker Rd, San Marcos, TX 78666'     where id = 'smx' and coalesce(address, '') = '';
update public.branches set address = '4225 James E Casey Dr, Jacksonville, FL 32219'     where id = 'jax' and coalesce(address, '') = '';
update public.branches set address = '4600 Cypress Park Dr, Suite A, Mobile, AL 36619'   where id = 'mob' and coalesce(address, '') = '';

-- ---------- Placing an order (replaces the original) -----------------
-- Same inputs as before. Contractors' own orders are approved as they place them.
-- Job-site deliveries keep the branch they ship from.
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

    select p.id, p.sku, p.name, p.unit, p.list_price,
           coalesce(p.customer_priced, c.customer_priced, false) as cp
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

-- Whoever placed the order, AMBIT staff, or someone at the customer's company can record the orders@ email result.
create or replace function public.mark_order_email(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set email_status = p_status, email_error = left(p_error, 500)
   where id = p_order
     and (placed_by = auth.uid() or public.is_employee()
          or (company_id is not null and company_id = public.my_company_id()));
$$;

-- ---------- Staff: send (or resend) the approval email ----------------
-- The app makes a random token, emails the link, and stores only its sha256 here.
-- Resending makes a new link; the old one stops working.
create or replace function public.request_order_approval(p_order uuid, p_email text, p_token_hash text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.is_employee() then
    raise exception 'Only AMBIT staff can send orders for approval.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.placed_by_role = 'customer' then raise exception 'Contractors approve their own orders in the app.'; end if;
  if o.approval_status = 'approved' then raise exception 'This order is already approved.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status = 'not_required' and o.email_status = 'sent' then
    raise exception 'This order already went to AMBIT orders.';
  end if;
  if coalesce(trim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter the customer''s email address.';
  end if;
  if coalesce(length(p_token_hash), 0) <> 64 then raise exception 'Could not make an approval link.'; end if;

  update public.orders
     set approval_status       = 'pending',
         approval_email        = lower(trim(p_email)),
         approval_token_hash   = p_token_hash,
         approval_sent_at      = now(),
         approval_expires_at   = now() + interval '7 days',
         approval_note         = null,
         approval_email_status = null,
         approval_email_error  = null,
         approval_ref          = coalesce(approval_ref, 'APV-' || order_no || '-' || upper(substr(md5(id::text || clock_timestamp()::text), 1, 4)))
   where id = p_order;
end $$;

create or replace function public.mark_approval_email(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set approval_email_status = p_status, approval_email_error = left(p_error, 500)
   where id = p_order and public.is_employee();
$$;

-- Staff: the customer approved another way (phone, in person). Kept on the record and printed.
create or replace function public.record_order_approval(p_order uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me public.profiles;
begin
  if not public.is_employee() then raise exception 'Only AMBIT staff can record an approval.'; end if;
  select * into me from public.profiles where id = auth.uid();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.approval_status not in ('pending', 'changes_requested') then raise exception 'This order is not waiting for approval.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if length(coalesce(trim(p_note), '')) < 5 then
    raise exception 'Say who approved it and how, for example "Travis Holt approved by phone, 10:15 AM".';
  end if;
  update public.orders
     set approval_status = 'approved', approval_method = 'staff_recorded',
         approved_at = now(), approved_by_name = coalesce(me.full_name, me.email),
         approval_note = left(trim(p_note), 500), email_status = 'pending', email_error = null
   where id = p_order;
end $$;

-- A signed-in contractor approving (or asking to change) an order AMBIT placed for their company.
create or replace function public.customer_order_decision(p_order uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or me.role <> 'customer' then
    raise exception 'Only the customer can approve this order.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.company_id is distinct from me.company_id then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'This order is not waiting for approval.'; end if;
  if p_approve then
    update public.orders
       set approval_status = 'approved', approval_method = 'in_app',
           approved_at = now(), approved_by_name = coalesce(me.full_name, me.email),
           email_status = 'pending', email_error = null
     where id = o.id;
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Tell us what needs to change.'; end if;
    update public.orders
       set approval_status = 'changes_requested', approval_note = left(trim(p_note), 2000)
     where id = o.id;
  end if;
end $$;

-- ---------- The customer's approval link (no sign-in needed) ----------
-- Everything the approval page and the printed order need. Internal only.
create or replace function public.order_doc_json(p_order uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'order', to_jsonb(o) - 'approval_token_hash' - 'email_error' - 'approval_email_error' - 'placed_by',
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'order_id' - 'product_id' order by i.id)
                         from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'branch', (select to_jsonb(b) from public.branches b where b.id = o.branch_id),
    'company', (select jsonb_build_object('contact_name', c.contact_name, 'phone', c.phone, 'email', c.email,
                                          'bill_address', c.bill_address)
                  from public.companies c where c.id = o.company_id),
    'state', case
      when o.status = 'cancelled' then 'cancelled'
      when o.approval_status = 'approved' then 'approved'
      when o.approval_status = 'changes_requested' then 'changes_requested'
      when o.approval_status = 'pending' and o.approval_expires_at < now() then 'expired'
      when o.approval_status = 'pending' then 'pending'
      else 'closed' end)
  from public.orders o
  where o.id = p_order;
$$;

create or replace function public.order_approval_view(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  oid uuid;
begin
  if coalesce(length(p_token), 0) < 20 then return null; end if;
  select id into oid from public.orders
   where approval_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if oid is null then return null; end if;
  return public.order_doc_json(oid);
end $$;

create or replace function public.approve_order_by_link(p_token text, p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders
   where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if o.id is null then raise exception 'This approval link is not valid. Ask your AMBIT rep to send a new one.'; end if;
  if o.approval_status = 'approved' then return public.order_doc_json(o.id) || '{"already": true}'::jsonb; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'Your AMBIT rep is updating this order. Watch for a new email.'; end if;
  if o.approval_expires_at < now() then raise exception 'This approval link has expired. Ask your AMBIT rep to send a new one.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your name to approve.'; end if;
  update public.orders
     set approval_status = 'approved', approval_method = 'email_link',
         approved_at = now(), approved_by_name = left(trim(p_name), 120),
         email_status = 'pending', email_error = null
   where id = o.id;
  return public.order_doc_json(o.id);
end $$;

create or replace function public.request_order_changes_by_link(p_token text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders
   where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if o.id is null then raise exception 'This approval link is not valid. Ask your AMBIT rep to send a new one.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'This order is not waiting for approval.'; end if;
  if o.approval_expires_at < now() then raise exception 'This approval link has expired. Ask your AMBIT rep to send a new one.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Tell us what needs to change.'; end if;
  update public.orders
     set approval_status = 'changes_requested', approval_note = left(trim(p_note), 2000)
   where id = o.id;
  return public.order_doc_json(o.id);
end $$;

create or replace function public.mark_order_email_by_link(p_token text, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set email_status = p_status, email_error = left(p_error, 500)
   where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and approval_status = 'approved';
$$;

-- ---------- Who may call what ----------------------------------------
revoke execute on function public.order_doc_json(uuid) from public, anon, authenticated;
revoke execute on function public.mark_order_email(uuid, text, text) from public, anon;
revoke execute on function public.request_order_approval(uuid, text, text) from public, anon;
revoke execute on function public.mark_approval_email(uuid, text, text) from public, anon;
revoke execute on function public.record_order_approval(uuid, text) from public, anon;
revoke execute on function public.customer_order_decision(uuid, boolean, text) from public, anon;
revoke execute on function public.order_approval_view(text) from public;
revoke execute on function public.approve_order_by_link(text, text) from public;
revoke execute on function public.request_order_changes_by_link(text, text) from public;
revoke execute on function public.mark_order_email_by_link(text, text, text) from public;

grant execute on function public.mark_order_email(uuid, text, text) to authenticated;
grant execute on function public.request_order_approval(uuid, text, text) to authenticated;
grant execute on function public.mark_approval_email(uuid, text, text) to authenticated;
grant execute on function public.record_order_approval(uuid, text) to authenticated;
grant execute on function public.customer_order_decision(uuid, boolean, text) to authenticated;
-- The approval link works without signing in: anyone holding the link (and only them) can view and approve.
grant execute on function public.order_approval_view(text) to anon, authenticated;
grant execute on function public.approve_order_by_link(text, text) to anon, authenticated;
grant execute on function public.request_order_changes_by_link(text, text) to anon, authenticated;
grant execute on function public.mark_order_email_by_link(text, text, text) to anon, authenticated;

-- =====================================================================
-- AMBITION - Staff roles, the order desk, and price request approvals
-- * Each AMBIT staff account gets a job role (Admin, CRM, Sales rep, Tech,
--   Warehouse manager, Accounting) and checkboxes for what it can see and do.
--   Staff who were already active keep everything until an admin sets a role.
-- * Orders move through: customer approval -> AMBIT PO # (CRM) -> credit check
--   (Accounting) -> scheduled for delivery/pickup (CRM, customer is emailed)
--   -> completed.
-- * Price request approvals made in the app are recorded here (the prices
--   themselves are saved into the Jotform submission).
-- Safe to run more than once.
-- =====================================================================

-- ---------- Roles and permissions ------------------------------------
alter table public.profiles add column if not exists job_role text;
alter table public.profiles add column if not exists perms    text[] not null default '{}';

do $$ begin
  alter table public.profiles add constraint profiles_job_role_check
    check (job_role is null or job_role in ('admin', 'crm', 'sales_rep', 'tech', 'warehouse', 'accounting'));
exception when duplicate_object then null; end $$;

-- Everything a checkbox can turn on. Keep in step with lib/access.ts.
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check']
$$;

-- Staff who were active before roles existed keep seeing everything (except admin-only price approvals)
-- until an admin picks their role.
update public.profiles
   set perms = array['ordering', 'price_requests', 'time_off', 'travel', 'spray_log', 'complaints',
                     'inventory', 'order_desk', 'credit_check']
 where role = 'employee' and job_role is null and perms = '{}' and status = 'active';
update public.profiles set job_role = 'admin' where role = 'admin' and job_role is null;

-- Admins can do everything. Employees can do what their boxes allow. Contractors: nothing here.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select status = 'active' and (role = 'admin' or (role = 'employee' and p = any(perms)))
      from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.admin_set_access(p_user uuid, p_job_role text, p_perms text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  bad text[];
begin
  if not public.is_admin() then raise exception 'Only admins can change what people see.'; end if;
  if p_job_role is not null and p_job_role not in ('admin', 'crm', 'sales_rep', 'tech', 'warehouse', 'accounting') then
    raise exception 'Unknown role %.', p_job_role;
  end if;
  select array_agg(x) into bad from unnest(coalesce(p_perms, '{}')) x where not x = any(public.all_perms());
  if bad is not null then raise exception 'Unknown permission %.', array_to_string(bad, ', '); end if;
  update public.profiles
     set job_role = p_job_role,
         perms    = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(coalesce(p_perms, '{}')) x)
   where id = p_user;
end $$;

-- Home-screen form links can be limited to a permission (Time off request -> time_off, ...).
alter table public.links add column if not exists perm text;
update public.links set perm = 'price_requests' where perm is null and lower(title) like 'price request%';
update public.links set perm = 'travel'         where perm is null and lower(title) like 'travel%';
update public.links set perm = 'time_off'       where perm is null and lower(title) like 'time off%';
update public.links set perm = 'complaints'     where perm is null and lower(title) like '%complaint%';
update public.links set perm = 'spray_log'      where perm is null and lower(title) like 'spray job%';

-- ---------- Order desk ------------------------------------------------
alter table public.orders add column if not exists ambit_po          text;
alter table public.orders add column if not exists po_by_name        text;
alter table public.orders add column if not exists po_at             timestamptz;
alter table public.orders add column if not exists credit_status     text;          -- pending | approved | hold
alter table public.orders add column if not exists credit_by_name    text;
alter table public.orders add column if not exists credit_at         timestamptz;
alter table public.orders add column if not exists credit_note       text;
alter table public.orders add column if not exists scheduled_for     date;
alter table public.orders add column if not exists schedule_note     text;
alter table public.orders add column if not exists scheduled_by_name text;
alter table public.orders add column if not exists scheduled_at      timestamptz;
alter table public.orders add column if not exists notify_status     text;          -- the customer's "scheduled" email
alter table public.orders add column if not exists notify_error      text;
alter table public.orders add column if not exists completed_at      timestamptz;

do $$ begin
  alter table public.orders add constraint orders_credit_status_check
    check (credit_status is null or credit_status in ('pending', 'approved', 'hold'));
exception when duplicate_object then null; end $$;

-- Where each order sits right now. Worked out by the database, never typed.
do $$ begin
  alter table public.orders add column stage text generated always as (
    case
      when status = 'cancelled' then 'cancelled'
      when status = 'completed' then 'completed'
      when approval_status in ('pending', 'changes_requested') then 'customer'
      when ambit_po is null then 'needs_po'
      when credit_status = 'hold' then 'hold'
      when credit_status is distinct from 'approved' then 'credit'
      when scheduled_for is null then 'schedule'
      else 'scheduled'
    end) stored;
exception when duplicate_column then null; end $$;
create index if not exists orders_stage_idx on public.orders(stage);

create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(full_name, email) from public.profiles where id = auth.uid()
$$;

-- CRM: enter (or correct) AMBIT's PO number. Sends the order to the credit check.
create or replace function public.order_set_po(p_order uuid, p_po text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the PO number.'; end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- Accounting: release (no credit hold) or put on hold.
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'The PO number has to be entered first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), '')
   where id = p_order;
end $$;

-- CRM: set (or change) the delivery or pickup date. The app then emails the customer.
create or replace function public.order_schedule(p_order uuid, p_date date, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.credit_status is distinct from 'approved' then raise exception 'Accounting has to release the order first.'; end if;
  if p_date is null then raise exception 'Pick the delivery or pickup date.'; end if;
  update public.orders
     set scheduled_for = p_date, schedule_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         scheduled_by_name = public.my_name(), scheduled_at = now(),
         notify_status = null, notify_error = null
   where id = p_order;
end $$;

create or replace function public.order_mark_notified(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders set notify_status = p_status, notify_error = left(p_error, 500)
   where id = p_order and public.has_perm('order_desk');
$$;

-- CRM or warehouse: delivered / picked up.
create or replace function public.order_complete(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not (public.has_perm('order_desk') or public.has_perm('inventory')) then
    raise exception 'You don''t have access to close orders.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.scheduled_for is null then raise exception 'Schedule the order first.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is already %.', o.status; end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order;
end $$;

-- Staff without ordering access can't place orders (contractors always can, for their own company).
create or replace function public.can_order() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' and (role = 'customer' or role = 'admin' or 'ordering' = any(perms))
                     from public.profiles where id = auth.uid()), false)
$$;

-- Belt and braces: the database itself refuses orders from staff without ordering access.
-- (SQL Editor and other server-side inserts, with no signed-in user, are not affected.)
create or replace function public.check_can_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_order() then
    raise exception 'Your account can''t place orders. Ask an admin to turn on Ordering for you.';
  end if;
  return new;
end $$;
drop trigger if exists orders_can_order on public.orders;
create trigger orders_can_order before insert on public.orders
  for each row execute function public.check_can_order();

-- ---------- Price request approvals -----------------------------------
create table if not exists public.prf_reviews (
  submission_id    text primary key,           -- Jotform submission id
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  approved_at      timestamptz not null default now(),
  prices           jsonb not null default '{}'::jsonb,   -- { "AMBI-SEAL 5.0": "2.35", ... }
  note             text,
  email_status     text,
  email_error      text
);
alter table public.prf_reviews enable row level security;
drop policy if exists prf_reviews_read on public.prf_reviews;
drop policy if exists prf_reviews_write on public.prf_reviews;
create policy prf_reviews_read on public.prf_reviews for select to authenticated using (public.is_employee());
create policy prf_reviews_write on public.prf_reviews for all to authenticated
  using (public.has_perm('prf_approve')) with check (public.has_perm('prf_approve'));
revoke all on public.prf_reviews from anon;

-- ---------- Who may call what ----------------------------------------
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.admin_set_access(uuid, text, text[]) from public, anon;
revoke execute on function public.order_set_po(uuid, text) from public, anon;
revoke execute on function public.order_credit_decision(uuid, boolean, text) from public, anon;
revoke execute on function public.order_schedule(uuid, date, text) from public, anon;
revoke execute on function public.order_mark_notified(uuid, text, text) from public, anon;
revoke execute on function public.order_complete(uuid) from public, anon;
revoke execute on function public.can_order() from public, anon;
revoke execute on function public.my_name() from public, anon;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.admin_set_access(uuid, text, text[]) to authenticated;
grant execute on function public.order_set_po(uuid, text) to authenticated;
grant execute on function public.order_credit_decision(uuid, boolean, text) to authenticated;
grant execute on function public.order_schedule(uuid, date, text) to authenticated;
grant execute on function public.order_mark_notified(uuid, text, text) to authenticated;
grant execute on function public.order_complete(uuid) to authenticated;
grant execute on function public.can_order() to authenticated;
grant execute on function public.my_name() to authenticated;

-- ---------------------------------------------------------------- 0012
-- ---------------------------------------------------------------- delete my account
alter table public.orders alter column placed_by drop not null;
alter table public.orders drop constraint if exists orders_placed_by_fkey;
alter table public.orders add constraint orders_placed_by_fkey
  foreign key (placed_by) references public.profiles(id) on delete set null;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  my_role public.user_role;
  other_admins int;
begin
  if me is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select role into my_role from public.profiles where id = me;
  if my_role = 'admin' then
    select count(*) into other_admins from public.profiles
      where role = 'admin' and status = 'active' and id <> me;
    if other_admins = 0 then
      raise exception 'LAST_ADMIN';
    end if;
  end if;
  -- Removes the login; the profile goes with it (on delete cascade).
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- batts by square foot
alter table public.products add column if not exists sqft_per_unit numeric(10,2);

update public.products
   set sqft_per_unit = (regexp_match(name, '([0-9]+(?:\.[0-9]+)?)\s*S\s*/\s*F', 'i'))[1]::numeric
 where sqft_per_unit is null
   and category_id = 'fiberglass'
   and name ~* '^\s*R\s*-?\s*[0-9]{2}'                 -- batts are named by R-value (R11U, R38K ...)
   and name ~* '[0-9]+(\.[0-9]+)?\s*S\s*/\s*F';

-- ---------------------------------------------------------------- forms hub
create table if not exists public.form_reviews (
  submission_id    text primary key,                 -- Jotform submission id
  form_id          text not null,
  form_title       text,
  status           text not null check (status in ('approved', 'declined')),
  credit_limit     numeric(12,2),
  terms            text,
  note             text,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz not null default now()
);
create index if not exists form_reviews_form_idx on public.form_reviews(form_id);

alter table public.form_reviews enable row level security;
drop policy if exists form_reviews_admin on public.form_reviews;
create policy form_reviews_admin on public.form_reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------- 0013
create table if not exists public.hub_forms (
  form_id  text primary key,                          -- Jotform form id
  kind     text check (kind in ('credit', 'account', 'other')),
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

alter table public.hub_forms enable row level security;
drop policy if exists hub_forms_admin on public.hub_forms;
create policy hub_forms_admin on public.hub_forms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------- 0014
alter table public.profiles add column if not exists home_apps jsonb;  -- {"order": [...], "hidden": [...]}
grant update (home_apps) on public.profiles to authenticated;


-- ---------------------------------------------------------------- 0015
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


-- ---------------------------------------------------------------- 0016
create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  full_name       text,
  phone           text,
  role            public.user_role not null default 'customer',
  company_id      uuid references public.companies(id) on delete set null,
  branch_id       text references public.branches(id) on update cascade on delete set null,
  job_role        text,
  perms           text[] not null default '{}',
  note            text,                       -- the admin's personal note in the email
  token_hash      text not null,
  expires_at      timestamptz not null default now() + interval '30 days',
  invited_by      uuid references public.profiles(id) on delete set null,
  invited_by_name text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  email_status    text,                       -- sent | failed | not_configured
  accepted_at     timestamptz,
  accepted_by     uuid references public.profiles(id) on delete set null,
  cancelled_at    timestamptz
);
create unique index if not exists invites_token_idx on public.invites(token_hash);
create index if not exists invites_email_idx on public.invites(lower(email));

alter table public.invites enable row level security;
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Use an invite: set up the person's account the way the admin chose ----------
-- Only for the email the invite was made for, and only while it's open.
create or replace function public.apply_invite(p_user uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  em  text;
begin
  if coalesce(p_user::text, '') = '' or coalesce(p_hash, '') = '' then return false; end if;
  select lower(email) into em from public.profiles where id = p_user;
  if em is null then return false; end if;
  select * into inv from public.invites
   where token_hash = p_hash and accepted_at is null and cancelled_at is null and expires_at > now()
   for update;
  if inv.id is null or lower(inv.email) <> em then return false; end if;

  update public.profiles
     set role        = inv.role,
         status      = 'active',
         company_id  = case when inv.role = 'customer' then inv.company_id end,
         branch_id   = coalesce(inv.branch_id, branch_id),
         job_role    = case when inv.role = 'admin' then 'admin' when inv.role = 'employee' then inv.job_role end,
         perms       = case when inv.role = 'admin' then public.all_perms() when inv.role = 'employee' then inv.perms else '{}'::text[] end,
         full_name   = coalesce(nullif(trim(full_name), ''), inv.full_name),
         phone       = coalesce(nullif(trim(phone), ''), inv.phone),
         approved_at = now(),
         approved_by = inv.invited_by
   where id = p_user;
  update public.invites set accepted_at = now(), accepted_by = p_user where id = inv.id;
  -- Any other open invites for the same email are done too.
  update public.invites set cancelled_at = now()
   where lower(email) = em and id <> inv.id and accepted_at is null and cancelled_at is null;
  return true;
end $$;
revoke execute on function public.apply_invite(uuid, text) from public, anon, authenticated;

-- The person signed in (or just made their password) on the invite page.
create or replace function public.accept_invite(p_hash text) returns boolean
language sql security definer set search_path = public as $$
  select public.apply_invite(auth.uid(), p_hash)
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- What the invite page shows before the person has a login.
create or replace function public.invite_lookup(p_hash text)
returns table (email text, full_name text, phone text, kind text, company_name text, invited_by_name text, state text, has_account boolean)
language sql stable security definer set search_path = public as $$
  select i.email, i.full_name, i.phone,
         case when i.role = 'customer' then 'contractor' else 'employee' end,
         c.name, i.invited_by_name,
         case when i.accepted_at is not null then 'used'
              when i.cancelled_at is not null then 'cancelled'
              when i.expires_at <= now() then 'expired'
              else 'open' end,
         exists (select 1 from public.profiles p where lower(p.email) = lower(i.email))
    from public.invites i
    left join public.companies c on c.id = i.company_id
   where coalesce(p_hash, '') <> '' and i.token_hash = p_hash
   limit 1
$$;
revoke execute on function public.invite_lookup(text) from public;
grant execute on function public.invite_lookup(text) to anon, authenticated;

-- ---------- New logins: also use the invite they signed up with ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;


-- ---------------------------------------------------------------- 0017
create table if not exists public.expense_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  month          date not null,                       -- the 1st of the month
  receipt_ids    text[] not null default '{}',        -- Jotform submission ids on the report
  receipt_count  int not null default 0,
  total          numeric(12,2) not null default 0,
  card_total     numeric(12,2) not null default 0,
  personal_total numeric(12,2) not null default 0,   -- paid personally: owed back to the employee
  sent_at        timestamptz not null default now(),
  sent_to        text[] not null default '{}',
  email_status   text,                                -- sent | failed | not_configured
  unique (user_id, month)
);

alter table public.expense_reports enable row level security;
drop policy if exists expense_reports_read on public.expense_reports;
create policy expense_reports_read on public.expense_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists expense_reports_write on public.expense_reports;
create policy expense_reports_write on public.expense_reports for insert to authenticated
  with check (user_id = auth.uid() and public.is_employee() and public.is_active());
drop policy if exists expense_reports_update on public.expense_reports;
create policy expense_reports_update on public.expense_reports for update to authenticated
  using (user_id = auth.uid() and public.is_employee()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- 0018
-- Live stock from each branch's inventory spreadsheet (see 0018_inventory.sql).
-- ---------- Which workbook each branch uses ----------------------------
create table if not exists public.inventory_sheets (
  branch_id       text primary key references public.branches(id) on update cascade on delete cascade,
  share_url       text not null,
  file_name       text,
  drive_id        text,
  item_id         text,
  enabled         boolean not null default true,
  connected_at    timestamptz,     -- first good sync: PENDING ORDERS lines closed before this are left alone
  last_sync_at    timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  last_summary    jsonb,
  row_seen        jsonb,           -- lines typed straight into PENDING ORDERS and their last STATUS
  sync_lock_until timestamptz,
  sync_wanted_at  timestamptz,     -- something changed in the app that the sheet hasn't got yet
  updated_at      timestamptz not null default now()
);

-- ---------- Stock per branch and product -------------------------------
create table if not exists public.inventory (
  branch_id       text not null references public.branches(id) on update cascade on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  sku             text not null,          -- exactly as the sheet writes it
  on_hand         numeric(12,2),          -- TOTAL IN STOCK (blank = not counted)
  synced_on_hand  numeric(12,2),          -- TOTAL IN STOCK when the app and the sheet last agreed
  sheet_pending   numeric(12,2) not null default 0,  -- reserved by lines typed straight into PENDING ORDERS
  reorder_point   numeric(12,2),
  max_qty         numeric(12,2),
  unit_weight     numeric(12,3),
  last_counted    date,
  counted_by      text,
  count_dirty     boolean not null default false,    -- a count made in the app still has to reach the sheet
  on_sheet        boolean not null default true,
  sheet_row       int,
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  primary key (branch_id, product_id)
);
create index if not exists inventory_sku_idx on public.inventory(branch_id, sku);

-- ---------- App order lines that hold stock ----------------------------
create table if not exists public.inventory_lines (
  order_item_id bigint primary key references public.order_items(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete cascade,
  branch_id     text not null,
  product_id    uuid not null,
  sku           text not null,
  qty           numeric(12,2) not null,
  state         text not null default 'reserved',  -- reserved | done | cancelled
  done_by       text,                              -- app | sheet: where it was picked up / cancelled
  stock_taken   boolean not null default false,    -- already taken out of TOTAL IN STOCK
  sheet_row     int,
  sheet_status  text,                              -- STATUS on the sheet when the app last looked
  written_at    timestamptz,
  needs_write   boolean not null default true,
  updated_at    timestamptz not null default now()
);
do $$ begin
  alter table public.inventory_lines add constraint inventory_lines_state_check check (state in ('reserved', 'done', 'cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists inventory_lines_open_idx on public.inventory_lines(branch_id, product_id) where state = 'reserved';
create index if not exists inventory_lines_order_idx on public.inventory_lines(order_id);

-- ---------- What happened (shown in Admin > Inventory) -----------------
create table if not exists public.inventory_log (
  id         bigint generated always as identity primary key,
  branch_id  text,
  at         timestamptz not null default now(),
  kind       text not null,     -- count | received | removed | order | sheet | new_item | conflict | error
  sku        text,
  message    text not null,
  qty_before numeric(12,2),
  qty_after  numeric(12,2),
  by_name    text
);
create index if not exists inventory_log_at_idx on public.inventory_log(branch_id, at desc);

-- ---------- Server-only secrets (the Microsoft connection) -------------
-- Row-level security with no policies: only the app's server key can read or write it.
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;

-- ---------- Who sees what ----------------------------------------------
alter table public.inventory_sheets enable row level security;
alter table public.inventory        enable row level security;
alter table public.inventory_lines  enable row level security;
alter table public.inventory_log    enable row level security;

drop policy if exists inventory_sheets_read  on public.inventory_sheets;
drop policy if exists inventory_sheets_admin on public.inventory_sheets;
create policy inventory_sheets_read  on public.inventory_sheets for select to authenticated using (public.is_employee());
create policy inventory_sheets_admin on public.inventory_sheets for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Staff see the numbers. Contractors only get labels, through stock_for().
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated using (public.is_employee());

drop policy if exists inventory_lines_read on public.inventory_lines;
create policy inventory_lines_read on public.inventory_lines for select to authenticated using (public.is_employee());

drop policy if exists inventory_log_read on public.inventory_log;
create policy inventory_log_read on public.inventory_log for select to authenticated using (public.has_perm('inventory'));

-- ---------- Stock for the Order screen ---------------------------------
-- NET AVAILABLE = TOTAL IN STOCK - reserved on the sheet - reserved by open app orders.
-- Staff get the numbers; contractors get only the label (in | low | out).
create or replace function public.stock_for(p_branch text)
returns table (product_id uuid, on_hand numeric, pending numeric, net numeric, reorder_point numeric, label text)
language sql stable security definer set search_path = public as $$
  with r as (
    select l.product_id, sum(l.qty) as q
      from public.inventory_lines l
     where l.branch_id = p_branch and l.state = 'reserved'
     group by l.product_id
  ), v as (
    select i.product_id, i.on_hand, i.reorder_point,
           i.sheet_pending + coalesce(r.q, 0) as pending,
           i.on_hand - i.sheet_pending - coalesce(r.q, 0) as net
      from public.inventory i
      left join r on r.product_id = i.product_id
     where i.branch_id = p_branch and i.on_sheet
       and exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled)
  )
  select v.product_id,
         case when public.is_employee() then v.on_hand end,
         case when public.is_employee() then v.pending end,
         case when public.is_employee() then v.net end,
         case when public.is_employee() then v.reorder_point end,
         case when v.on_hand is null then null
              when v.net <= 0 then 'out'
              when v.net <= coalesce(v.reorder_point, 0) then 'low'
              else 'in' end
    from v
   where public.is_active()
$$;

-- ---------- An order is placed: hold the stock -------------------------
create or replace function public.inventory_reserve_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o   record;
  sku text;
begin
  if new.product_id is null then return new; end if;
  select id, branch_id, delivery_method, status into o from public.orders where id = new.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status in ('cancelled', 'completed') then return new; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled) then return new; end if;
  select i.sku into sku from public.inventory i where i.branch_id = o.branch_id and i.product_id = new.product_id and i.on_sheet;
  if sku is null then return new; end if;  -- not stocked at this branch: ships from the supplier
  insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
  values (new.id, new.order_id, o.branch_id, new.product_id, sku, new.qty)
  on conflict (order_item_id) do nothing;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  return new;
exception when others then
  -- Stock bookkeeping must never stop an order from going through.
  raise warning 'inventory_reserve_line: %', sqlerrm;
  return new;
end $$;

drop trigger if exists order_items_inventory on public.order_items;
create trigger order_items_inventory after insert on public.order_items
  for each row execute function public.inventory_reserve_line();

-- ---------- An order is cancelled, picked up / delivered, or reopened ---
create or replace function public.inventory_order_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l   record;
  who text := coalesce(public.my_name(), 'AMBITION');
  b   numeric;
begin
  if new.status is not distinct from old.status and new.ambit_po is not distinct from old.ambit_po then return new; end if;
  if not exists (select 1 from public.inventory_lines where order_id = new.id) then return new; end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.inventory_lines
       set state = 'cancelled', done_by = 'app', needs_write = true, updated_at = now()
     where order_id = new.id and state = 'reserved';
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (new.branch_id, 'order', 'ORD-' || new.order_no || ' cancelled: its stock is released.', who);

  elsif new.status = 'completed' and old.status <> 'completed' then
    -- Picked up or delivered: the stock leaves TOTAL IN STOCK (once per line).
    for l in select * from public.inventory_lines where order_id = new.id and state = 'reserved' loop
      if not l.stock_taken then
        update public.inventory set on_hand = on_hand - l.qty, updated_at = now(), updated_by_name = who
         where branch_id = l.branch_id and product_id = l.product_id and on_hand is not null
        returning on_hand + l.qty into b;
        insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
        values (l.branch_id, 'order', l.sku, 'ORD-' || new.order_no || ' picked up / delivered: ' || trim_scale(l.qty) || ' taken out of stock.', b, b - l.qty, who);
      end if;
    end loop;
    update public.inventory_lines
       set state = 'done', done_by = 'app', stock_taken = true, needs_write = true, updated_at = now()
     where order_id = new.id and state = 'reserved';

  elsif new.status in ('new', 'processing') and old.status in ('cancelled', 'completed') then
    -- Reopened: hold the stock again (and put back what the app took out when it was closed here).
    for l in select * from public.inventory_lines where order_id = new.id and state <> 'reserved' and done_by = 'app' loop
      if l.stock_taken then
        update public.inventory set on_hand = on_hand + l.qty, updated_at = now(), updated_by_name = who
         where branch_id = l.branch_id and product_id = l.product_id and on_hand is not null;
      end if;
    end loop;
    update public.inventory_lines
       set state = 'reserved', done_by = null, stock_taken = false, needs_write = true, updated_at = now()
     where order_id = new.id and state <> 'reserved' and done_by = 'app';
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (new.branch_id, 'order', 'ORD-' || new.order_no || ' reopened: its stock is reserved again.', who);
  end if;

  if new.ambit_po is distinct from old.ambit_po then
    update public.inventory_lines set needs_write = true, updated_at = now() where order_id = new.id;
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = new.branch_id;
  return new;
exception when others then
  -- Stock bookkeeping must never stop an order from moving on.
  raise warning 'inventory_order_changed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists orders_inventory on public.orders;
create trigger orders_inventory after update of status, ambit_po on public.orders
  for each row execute function public.inventory_order_changed();

-- ---------- Counts and stock changes made in the app -------------------
-- count = what's on the shelf now; received = add a delivery; removed = damaged, used, sent elsewhere.
create or replace function public.inventory_set_count(p_branch text, p_product uuid, p_qty numeric, p_mode text default 'count', p_note text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  i   public.inventory;
  v   numeric;
  who text := coalesce(public.my_name(), 'AMBITION');
  msg text;
begin
  if not public.has_perm('inventory') then raise exception 'You don''t have access to inventory.'; end if;
  if p_qty is null then raise exception 'Enter a number.'; end if;
  if p_mode not in ('count', 'received', 'removed') then raise exception 'Unknown stock change.'; end if;
  select * into i from public.inventory where branch_id = p_branch and product_id = p_product for update;
  if i.product_id is null or not i.on_sheet then raise exception 'That item isn''t on this location''s inventory sheet.'; end if;

  if p_mode = 'count' then
    if p_qty < 0 then raise exception 'A count can''t be below zero.'; end if;
    v := round(p_qty, 2);
    update public.inventory
       set on_hand = v, last_counted = (now() at time zone 'America/Chicago')::date, counted_by = left(who, 80),
           count_dirty = true, updated_at = now(), updated_by_name = who
     where branch_id = p_branch and product_id = p_product;
    msg := 'Counted ' || trim_scale(v) || ' in stock.';
  else
    if p_qty <= 0 then raise exception 'Enter how many.'; end if;
    v := coalesce(i.on_hand, 0) + case when p_mode = 'received' then round(p_qty, 2) else -round(p_qty, 2) end;
    update public.inventory set on_hand = v, updated_at = now(), updated_by_name = who
     where branch_id = p_branch and product_id = p_product;
    msg := case when p_mode = 'received' then 'Received ' || trim_scale(round(p_qty, 2)) || '.' else 'Removed ' || trim_scale(round(p_qty, 2)) || '.' end;
  end if;

  insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
  values (p_branch, p_mode, i.sku,
          msg || coalesce(' ' || nullif(left(trim(coalesce(p_note, '')), 200), ''), ''),
          i.on_hand, v, who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = p_branch;
  return v;
end $$;

-- ---------- Used only by the sync (the server's secret key) ------------
create or replace function public.inventory_try_lock(p_branch text, p_secs int default 120)
returns boolean
language sql security definer set search_path = public as $$
  update public.inventory_sheets
     set sync_lock_until = now() + make_interval(secs => p_secs)
   where branch_id = p_branch and (sync_lock_until is null or sync_lock_until < now())
  returning true
$$;

create or replace function public.inventory_unlock(p_branch text)
returns void
language sql security definer set search_path = public as $$
  update public.inventory_sheets set sync_lock_until = null where branch_id = p_branch
$$;

-- Add to / take from TOTAL IN STOCK in one step (never loses a change made at the same moment).
create or replace function public.inventory_bump(p_branch text, p_product uuid, p_delta numeric, p_kind text, p_message text)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  b numeric;
  a numeric;
  s text;
begin
  update public.inventory set on_hand = on_hand + p_delta, updated_at = now(), updated_by_name = 'Spreadsheet'
   where branch_id = p_branch and product_id = p_product and on_hand is not null
  returning on_hand - p_delta, on_hand, sku into b, a, s;
  insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
  values (p_branch, p_kind, s, p_message, b, a, 'Spreadsheet');
  return a;
end $$;

-- An app order line was marked "Picked Up / Completed" on the sheet: take it out of stock once.
create or replace function public.inventory_line_done_on_sheet(p_line bigint, p_status text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  l public.inventory_lines;
  n bigint;
begin
  update public.inventory_lines
     set state = 'done', done_by = 'sheet', stock_taken = true, sheet_status = p_status, needs_write = false, updated_at = now()
   where order_item_id = p_line and state = 'reserved' and not stock_taken
  returning * into l;
  if l.order_item_id is null then return false; end if;
  select order_no into n from public.orders where id = l.order_id;
  perform public.inventory_bump(l.branch_id, l.product_id, -l.qty, 'sheet',
    'ORD-' || n || ' marked Picked Up / Completed on the sheet: ' || trim_scale(l.qty) || ' taken out of stock.');
  return true;
end $$;

revoke all on function public.inventory_try_lock(text, int) from public, anon, authenticated;
revoke all on function public.inventory_unlock(text) from public, anon, authenticated;
revoke all on function public.inventory_bump(text, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.inventory_line_done_on_sheet(bigint, text) from public, anon, authenticated;
grant execute on function public.inventory_try_lock(text, int) to service_role;
grant execute on function public.inventory_unlock(text) to service_role;
grant execute on function public.inventory_bump(text, uuid, numeric, text, text) to service_role;
grant execute on function public.inventory_line_done_on_sheet(bigint, text) to service_role;

-- ---------- Oklahoma City's workbook -----------------------------------
insert into public.inventory_sheets (branch_id, share_url, file_name)
select 'okc',
       'https://netorg185513-my.sharepoint.com/:x:/g/personal/jeremiah_bryant_ambitpu_com/IQDSpd1vRPuoR5rMmCzWzXLpAXkstRq7Z2cWrjdTSofbHBA?e=BBRoZF',
       'NEW INVENTORY REPORT - 4708 South Council.xlsx'
 where exists (select 1 from public.branches where id = 'okc')
on conflict (branch_id) do nothing;

-- ---------------------------------------------------------------- 0019
-- Takeoff: measuring plans (see 0019_takeoff.sql).
-- ---------- The new permission ---------------------------------------
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff']
$$;

update public.profiles
   set perms = array_append(perms, 'takeoff')
 where role = 'employee' and job_role in ('crm', 'sales_rep') and not ('takeoff' = any(perms));

-- ---------- Takeoffs --------------------------------------------------
create table if not exists public.takeoffs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  customer        text,
  company_id      uuid references public.companies(id) on delete set null,
  address         text,
  due_date        date,
  status          text not null default 'in_progress',
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.takeoffs add constraint takeoffs_status_check check (status in ('in_progress', 'sent', 'won', 'lost'));
exception when duplicate_object then null; end $$;
create index if not exists takeoffs_updated_idx on public.takeoffs(updated_at desc);

-- One uploaded PDF (a plan set can be one file or several).
create table if not exists public.takeoff_files (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  path        text not null,           -- in the "plans" bucket
  file_name   text not null,
  size        bigint,
  pages       int,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_files_takeoff_idx on public.takeoff_files(takeoff_id);

-- One page of a plan PDF. Sizes are in PDF points (1/72 inch); ft_per_pt is the scale.
create table if not exists public.takeoff_sheets (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  file_id     uuid not null references public.takeoff_files(id) on delete cascade,
  page        int not null,
  name        text,
  width_pt    numeric,
  height_pt   numeric,
  ft_per_pt   numeric,                 -- real feet per PDF point (blank = scale not set)
  scale_label text,                    -- 1/4" = 1'-0"
  scale_source text,                   -- read | calibrated | picked
  sort        int not null default 0,
  unique (file_id, page)
);
create index if not exists takeoff_sheets_takeoff_idx on public.takeoff_sheets(takeoff_id);

-- What's being measured: exterior walls, attic floor, rim joist, can lights...
create table if not exists public.takeoff_items (
  id            uuid primary key default gen_random_uuid(),
  takeoff_id    uuid not null references public.takeoffs(id) on delete cascade,
  name          text not null,
  kind          text not null,         -- area | linear | count
  color         text not null default '#e33527',
  material      text,                  -- open_cell | closed_cell | blown_fiberglass | fiberglass_batts | ...
  thickness_in  numeric,
  r_value       text,
  height_ft     numeric,               -- linear: wall height, so walls give square feet
  pitch         numeric,               -- rise per 12 (6 = 6/12); sloped areas get the pitch factor
  deduct_sqft   numeric not null default 0,  -- openings (windows, doors) taken out
  hidden        boolean not null default false,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.takeoff_items add constraint takeoff_items_kind_check check (kind in ('area', 'linear', 'count'));
exception when duplicate_object then null; end $$;
create index if not exists takeoff_items_takeoff_idx on public.takeoff_items(takeoff_id);

-- Each shape drawn on a sheet: points in PDF points. Cutouts are taken out of an area.
create table if not exists public.takeoff_marks (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  item_id     uuid not null references public.takeoff_items(id) on delete cascade,
  sheet_id    uuid not null references public.takeoff_sheets(id) on delete cascade,
  points      jsonb not null,
  cutout      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_marks_takeoff_idx on public.takeoff_marks(takeoff_id);

-- Any change inside a takeoff moves it to the top of the list.
create or replace function public.touch_takeoff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.takeoffs set updated_at = now() where id = coalesce(new.takeoff_id, old.takeoff_id);
  return coalesce(new, old);
end $$;
drop trigger if exists takeoff_items_touch on public.takeoff_items;
create trigger takeoff_items_touch after insert or update or delete on public.takeoff_items for each row execute function public.touch_takeoff();
drop trigger if exists takeoff_marks_touch on public.takeoff_marks;
create trigger takeoff_marks_touch after insert or update or delete on public.takeoff_marks for each row execute function public.touch_takeoff();
drop trigger if exists takeoff_sheets_touch on public.takeoff_sheets;
create trigger takeoff_sheets_touch after insert or update on public.takeoff_sheets for each row execute function public.touch_takeoff();

-- ---------- Who sees what: staff with the Takeoff box ------------------
alter table public.takeoffs       enable row level security;
alter table public.takeoff_files  enable row level security;
alter table public.takeoff_sheets enable row level security;
alter table public.takeoff_items  enable row level security;
alter table public.takeoff_marks  enable row level security;

drop policy if exists takeoffs_team       on public.takeoffs;
drop policy if exists takeoff_files_team  on public.takeoff_files;
drop policy if exists takeoff_sheets_team on public.takeoff_sheets;
drop policy if exists takeoff_items_team  on public.takeoff_items;
drop policy if exists takeoff_marks_team  on public.takeoff_marks;
create policy takeoffs_team       on public.takeoffs       for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_files_team  on public.takeoff_files  for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_sheets_team on public.takeoff_sheets for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_items_team  on public.takeoff_items  for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_marks_team  on public.takeoff_marks  for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));

-- ---------- Plan files ------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plans', 'plans', false, 314572800, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists plans_read   on storage.objects;
drop policy if exists plans_insert on storage.objects;
drop policy if exists plans_delete on storage.objects;
create policy plans_read   on storage.objects for select to authenticated using (bucket_id = 'plans' and public.has_perm('takeoff'));
create policy plans_insert on storage.objects for insert to authenticated with check (bucket_id = 'plans' and public.has_perm('takeoff'));
create policy plans_delete on storage.objects for delete to authenticated using (bucket_id = 'plans' and public.has_perm('takeoff'));

-- =====================================================================
-- AMBIT Intelligence update 0020 - Ask AMBIT (the AI assistant)
-- * Knowledge it may use: Jeremiah's TSBs and teaching, AMBIT product docs, and code / HVAC /
--   science references an admin adds. Each piece is a "source", split into searchable chunks.
--   The SPFA library is never added.
-- * Conversations, feedback, daily limits, cost tracking, and the "Send to AMBIT's expert" inbox.
-- * Staff only at first; Admin > Ask AMBIT opens it to contractors.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Settings (one row) ----------------------------------------
create table if not exists public.ai_settings (
  id                    boolean primary key default true check (id),
  model                 text not null default 'claude-sonnet-5-5',
  open_to_customers     boolean not null default false,
  web_lookups           boolean not null default true,
  allowed_sites         text[] not null default array[
                          'codes.iccsafe.org', 'energycodes.gov', 'acca.org', 'ashrae.org', 'energy.gov',
                          'ornl.gov', 'nrel.gov', 'pnnl.gov', 'nist.gov', 'lbl.gov', 'osti.gov'],
  daily_limit_staff     int not null default 150,
  daily_limit_customer  int not null default 40,
  teachers              uuid[] not null default '{}',   -- who may add building-science teaching (blank = any admin)
  extra_rules           text,                           -- extra instructions from the teacher, added to the rules
  updated_at            timestamptz not null default now(),
  updated_by_name       text
);
insert into public.ai_settings (id) values (true) on conflict (id) do nothing;
-- Jeremiah teaches building science.
update public.ai_settings
   set teachers = array(select id from public.profiles where lower(email) in ('jeremiah.bryant@ambitpu.com') and role = 'admin')
 where teachers = '{}';

-- ---------- Knowledge ---------------------------------------------------
-- kind:   teaching (Jeremiah's TSBs and teaching) | product (AMBIT TDS/SDS/ESR/guides) | code (IECC/IRC/IBC)
--         | hvac (ACCA/ASHRAE/neutral) | science (neutral research) | app (how to use the app)
-- origin: document (from the Docs library) | upload (a PDF added in Admin) | note (written in the app)
--         | answer (an expert answer to a user's question)
create table if not exists public.ai_sources (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  origin          text not null,
  title           text not null,
  document_id     uuid unique references public.documents(id) on delete cascade,
  storage_path    text,
  file_name       text,
  body            text,
  pages           int,
  chars           int not null default 0,
  staff_only      boolean not null default false,
  enabled         boolean not null default true,
  status          text not null default 'ready',
  error           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.ai_sources add constraint ai_sources_kind_check check (kind in ('teaching', 'product', 'code', 'hvac', 'science', 'app'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_sources add constraint ai_sources_origin_check check (origin in ('document', 'upload', 'note', 'answer'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_sources add constraint ai_sources_status_check check (status in ('ready', 'empty', 'error'));
exception when duplicate_object then null; end $$;

create table if not exists public.ai_chunks (
  id        bigint generated always as identity primary key,
  source_id uuid not null references public.ai_sources(id) on delete cascade,
  page      int,
  seq       int not null default 0,
  title     text,
  body      text not null,
  tsv       tsvector generated always as (
              setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', body), 'B')) stored
);
create index if not exists ai_chunks_tsv_idx on public.ai_chunks using gin (tsv);
create index if not exists ai_chunks_source_idx on public.ai_chunks (source_id, seq);

-- ---------- Conversations ----------------------------------------------
create table if not exists public.ai_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default 'New question',
  unread      boolean not null default false,       -- an expert answered and they haven't looked yet
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_threads_user_idx on public.ai_threads (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id            bigint generated always as identity primary key,
  thread_id     uuid not null references public.ai_threads(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null,                      -- user | assistant | expert
  body          text not null default '',
  parts         jsonb,                              -- answer split into pieces with their source numbers
  sources       jsonb,                              -- [{n, title, kind, href, page, site}]
  no_source     boolean not null default false,     -- it had no approved source for part of the question
  model         text,
  input_tokens  int,
  output_tokens int,
  searches      int,
  cost_cents    numeric(10, 3),
  rating        smallint,                           -- 1 helpful, -1 not helpful
  feedback      text,
  author_name   text,                               -- expert answers
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.ai_messages add constraint ai_messages_role_check check (role in ('user', 'assistant', 'expert'));
exception when duplicate_object then null; end $$;
create index if not exists ai_messages_thread_idx on public.ai_messages (thread_id, id);
create index if not exists ai_messages_rating_idx on public.ai_messages (rating) where rating is not null;

-- Questions sent to AMBIT's expert
create table if not exists public.ai_questions (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid references public.ai_threads(id) on delete set null,
  message_id      bigint references public.ai_messages(id) on delete set null,  -- the answer they sent on
  user_id         uuid references public.profiles(id) on delete set null,
  user_name       text,
  user_company    text,
  question        text not null,
  draft           text,                             -- what the assistant said
  status          text not null default 'open',
  answer          text,
  answered_by     uuid references public.profiles(id) on delete set null,
  answered_by_name text,
  answered_at     timestamptz,
  source_id       uuid references public.ai_sources(id) on delete set null,
  created_at      timestamptz not null default now()
);
do $$ begin
  alter table public.ai_questions add constraint ai_questions_status_check check (status in ('open', 'answered', 'dismissed'));
exception when duplicate_object then null; end $$;
create index if not exists ai_questions_status_idx on public.ai_questions (status, created_at desc);

-- Daily use per person (kept apart from conversations so deleting a chat doesn't reset it)
create table if not exists public.ai_usage (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null default current_date,
  questions  int not null default 0,
  cost_cents numeric(12, 3) not null default 0,
  primary key (user_id, day)
);

-- ---------- Helpers -----------------------------------------------------
create or replace function public.ai_can_teach() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and coalesce((select teachers = '{}' or auth.uid() = any(teachers) from public.ai_settings), true)
$$;

-- May this person use Ask AMBIT right now?
create or replace function public.ai_can_use() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.status = 'active' and (p.role in ('employee', 'admin') or (select open_to_customers from public.ai_settings))
      from public.profiles p where p.id = auth.uid()), false)
$$;

-- Counts one question against today's limit. Returns how many are left (negative = over the limit).
create or replace function public.ai_take_question() returns int
language plpgsql security definer set search_path = public as $$
declare
  lim int;
  used int;
begin
  if not public.ai_can_use() then
    return -1;
  end if;
  select case when public.my_role() in ('employee', 'admin') then daily_limit_staff else daily_limit_customer end
    into lim from public.ai_settings;
  insert into public.ai_usage (user_id, day, questions) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set questions = public.ai_usage.questions + 1
  returning questions into used;
  return coalesce(lim, 50) - used;
end $$;

create or replace function public.ai_add_cost(p_cents numeric) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage set cost_cents = cost_cents + greatest(coalesce(p_cents, 0), 0)
   where user_id = auth.uid() and day = current_date
$$;

-- Knowledge search: any of the words, best matches first. Contractors never get staff-only sources.
create or replace function public.ai_search(q text, kinds text[] default null, max_rows int default 8)
returns table (chunk_id bigint, source_id uuid, kind text, origin text, title text, page int, body text,
               document_id uuid, rank real)
language plpgsql stable security definer set search_path = public as $$
declare
  query tsquery;
  staff boolean := public.my_role() in ('employee', 'admin');
begin
  if not public.ai_can_use() then
    return;
  end if;
  query := nullif(replace(plainto_tsquery('english', coalesce(q, ''))::text, ' & ', ' | '), '')::tsquery;
  if query is null then
    return;
  end if;
  return query
    select c.id, s.id, s.kind, s.origin, s.title, c.page, c.body, s.document_id,
           (ts_rank_cd(c.tsv, query, 32) * case s.kind when 'teaching' then 1.35 when 'product' then 1.1 else 1 end)::real as rank
      from public.ai_chunks c
      join public.ai_sources s on s.id = c.source_id
     where c.tsv @@ query
       and s.enabled and s.status = 'ready'
       and (staff or not s.staff_only)
       and (kinds is null or s.kind = any(kinds))
     order by rank desc
     limit least(greatest(coalesce(max_rows, 8), 1), 20);
end $$;

-- Puts a source's chunks in (replacing the old ones unless p_append), in one step (admins).
drop function if exists public.ai_replace_chunks(uuid, jsonb);
create or replace function public.ai_replace_chunks(p_source uuid, p_chunks jsonb, p_append boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text;
  n int;
begin
  select kind into k from public.ai_sources where id = p_source;
  if k is null then raise exception 'Source not found'; end if;
  if not public.is_admin() or (k = 'teaching' and not public.ai_can_teach()) then
    raise exception 'Not allowed';
  end if;
  if not coalesce(p_append, false) then
    delete from public.ai_chunks where source_id = p_source;
  end if;
  insert into public.ai_chunks (source_id, page, seq, title, body)
  select p_source, nullif(x->>'page', '')::int, (x->>'seq')::int, x->>'title', x->>'body'
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) x
   where length(coalesce(x->>'body', '')) > 0;
  get diagnostics n = row_count;
  update public.ai_sources
     set chars = coalesce((select sum(length(body)) from public.ai_chunks where source_id = p_source), 0),
         status = case when exists (select 1 from public.ai_chunks where source_id = p_source) then 'ready' else 'empty' end,
         error = null, updated_at = now()
   where id = p_source;
  return n;
end $$;

revoke execute on function public.ai_can_teach() from public, anon;
revoke execute on function public.ai_can_use() from public, anon;
revoke execute on function public.ai_take_question() from public, anon;
revoke execute on function public.ai_add_cost(numeric) from public, anon;
revoke execute on function public.ai_search(text, text[], int) from public, anon;
revoke execute on function public.ai_replace_chunks(uuid, jsonb, boolean) from public, anon;
grant execute on function public.ai_can_teach() to authenticated;
grant execute on function public.ai_can_use() to authenticated;
grant execute on function public.ai_take_question() to authenticated;
grant execute on function public.ai_add_cost(numeric) to authenticated;
grant execute on function public.ai_search(text, text[], int) to authenticated;
grant execute on function public.ai_replace_chunks(uuid, jsonb, boolean) to authenticated;

-- ---------- Who sees what -----------------------------------------------
alter table public.ai_settings  enable row level security;
alter table public.ai_sources   enable row level security;
alter table public.ai_chunks    enable row level security;
alter table public.ai_threads   enable row level security;
alter table public.ai_messages  enable row level security;
alter table public.ai_questions enable row level security;
alter table public.ai_usage     enable row level security;

drop policy if exists ai_settings_read   on public.ai_settings;
drop policy if exists ai_settings_admin  on public.ai_settings;
create policy ai_settings_read  on public.ai_settings for select to authenticated using (public.is_active());
create policy ai_settings_admin on public.ai_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Everyone who can use the assistant can see source titles (they're shown as citations);
-- admins manage them; only the teacher adds or changes building-science teaching.
drop policy if exists ai_sources_read   on public.ai_sources;
drop policy if exists ai_sources_insert on public.ai_sources;
drop policy if exists ai_sources_update on public.ai_sources;
drop policy if exists ai_sources_delete on public.ai_sources;
create policy ai_sources_read on public.ai_sources for select to authenticated
  using (public.is_admin() or (public.ai_can_use() and enabled and (not staff_only or public.my_role() in ('employee', 'admin'))));
create policy ai_sources_insert on public.ai_sources for insert to authenticated
  with check (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()));
create policy ai_sources_update on public.ai_sources for update to authenticated
  using (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()))
  with check (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()));
create policy ai_sources_delete on public.ai_sources for delete to authenticated
  using (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()));

drop policy if exists ai_chunks_admin on public.ai_chunks;
create policy ai_chunks_admin on public.ai_chunks for select to authenticated using (public.is_admin());

drop policy if exists ai_threads_own   on public.ai_threads;
drop policy if exists ai_threads_admin on public.ai_threads;
create policy ai_threads_own on public.ai_threads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.ai_can_use());
create policy ai_threads_admin on public.ai_threads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_messages_own_read   on public.ai_messages;
drop policy if exists ai_messages_own_insert on public.ai_messages;
drop policy if exists ai_messages_own_rate   on public.ai_messages;
drop policy if exists ai_messages_admin      on public.ai_messages;
create policy ai_messages_own_read on public.ai_messages for select to authenticated using (user_id = auth.uid());
create policy ai_messages_own_insert on public.ai_messages for insert to authenticated
  with check (user_id = auth.uid() and role in ('user', 'assistant') and public.ai_can_use()
              and exists (select 1 from public.ai_threads t where t.id = thread_id and t.user_id = auth.uid()));
create policy ai_messages_own_rate on public.ai_messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_messages_admin on public.ai_messages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_questions_own   on public.ai_questions;
drop policy if exists ai_questions_ask   on public.ai_questions;
drop policy if exists ai_questions_admin on public.ai_questions;
create policy ai_questions_own on public.ai_questions for select to authenticated using (user_id = auth.uid());
create policy ai_questions_ask on public.ai_questions for insert to authenticated
  with check (user_id = auth.uid() and status = 'open' and answer is null and public.ai_can_use());
create policy ai_questions_admin on public.ai_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- A rating can be changed; nothing else about a message can.
create or replace function public.ai_messages_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.body is distinct from old.body or new.parts is distinct from old.parts or new.sources is distinct from old.sources
     or new.role is distinct from old.role or new.thread_id is distinct from old.thread_id
     or new.cost_cents is distinct from old.cost_cents or new.no_source is distinct from old.no_source then
    raise exception 'Only the rating can be changed';
  end if;
  return new;
end $$;
drop trigger if exists ai_messages_guard on public.ai_messages;
create trigger ai_messages_guard before update on public.ai_messages for each row execute function public.ai_messages_guard();

-- ---------- Files (PDFs added in Admin > Ask AMBIT) ----------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge', 'knowledge', false, 52428800, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists knowledge_read   on storage.objects;
drop policy if exists knowledge_insert on storage.objects;
drop policy if exists knowledge_delete on storage.objects;
create policy knowledge_read on storage.objects for select to authenticated using (
  bucket_id = 'knowledge' and (public.is_admin() or exists (
    select 1 from public.ai_sources s
     where s.storage_path = name and s.enabled
       and public.ai_can_use() and (not s.staff_only or public.my_role() in ('employee', 'admin')))));
create policy knowledge_insert on storage.objects for insert to authenticated with check (bucket_id = 'knowledge' and public.is_admin());
create policy knowledge_delete on storage.objects for delete to authenticated using (bucket_id = 'knowledge' and public.is_admin());

select (select count(*) from public.ai_sources) as sources,
       (select coalesce(array_length(teachers, 1), 0) from public.ai_settings) as teachers_set;

-- =====================================================================
-- AMBIT Intelligence update 0021
-- * AI order intake: texted / emailed / handwritten orders become draft orders for staff to check.
-- * Photos in Ask AMBIT, and AMBIT complaint reports (CCR-2026-###) started from them.
-- * Smart reorder: each customer's usual items and rhythm, and customers who are overdue to order.
-- * Sales-tax exemption certificates: expiry warnings, contractor renewals, and orders from customers
--   with an expired certificate held at the credit check.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Photos (Ask AMBIT, order intake, complaint reports) ----------
-- Everyone uploads into their own folder (photos/<their id>/...). AMBIT staff can see every photo;
-- contractors only their own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_delete on storage.objects;
create policy photos_read on storage.objects for select to authenticated using (
  bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_employee()));
create policy photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
create policy photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

alter table public.ai_messages add column if not exists images text[];

-- ---------- AI order intake ---------------------------------------------
create table if not exists public.order_drafts (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  source_text     text,
  images          text[] not null default '{}',
  customer_text   text,                       -- the customer as the order named them
  matches         jsonb not null default '[]', -- customers it could be [{id, name, account_no, score}]
  company_id      uuid references public.companies(id) on delete set null,
  branch_id       text references public.branches(id) on update cascade on delete set null,
  delivery_method text,                       -- pickup | jobsite | dropship (blank = not said)
  ship_address    text,
  po_number       text,
  needed_by       date,
  notes           text,
  items           jsonb not null default '[]', -- [{raw, product_id, qty, confidence, note}]
  questions       text,                       -- what the reader couldn't tell
  status          text not null default 'draft',
  order_id        uuid references public.orders(id) on delete set null,
  model           text,
  cost_cents      numeric(10, 3),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.order_drafts add constraint order_drafts_status_check check (status in ('draft', 'opened', 'sent', 'discarded'));
exception when duplicate_object then null; end $$;
alter table public.order_drafts add column if not exists matches jsonb not null default '[]';
create index if not exists order_drafts_created_idx on public.order_drafts (created_at desc);

alter table public.order_drafts enable row level security;
drop policy if exists order_drafts_team on public.order_drafts;
create policy order_drafts_team on public.order_drafts for all to authenticated
  using (public.has_perm('ordering')) with check (public.has_perm('ordering'));

-- ---------- Complaint reports -------------------------------------------
create table if not exists public.complaint_reports (
  id                 uuid primary key default gen_random_uuid(),
  report_no          text unique,               -- CCR-2026-005, given when it's submitted
  report_year        int,
  report_seq         int,
  status             text not null default 'draft',
  created_by         uuid references public.profiles(id) on delete set null,
  created_by_name    text,
  created_by_role    public.user_role,
  company_id         uuid references public.companies(id) on delete set null,
  company_name       text,
  contact_name       text,
  contact_phone      text,
  contact_email      text,
  job_name           text,
  job_address        text,
  product            text,
  lot_numbers        text,
  sets_used          text,
  date_sprayed       date,
  application        text,                      -- where it was sprayed: walls, roof deck, attic floor...
  thickness          text,
  substrate          text,
  substrate_temp     text,
  substrate_moisture text,
  ambient_temp       text,
  humidity           text,
  equipment          text,                      -- proportioner, A/B temps, pressure, hose heat
  symptoms           text[] not null default '{}',
  description        text,
  ai_notes           text,                      -- what Ask AMBIT saw, with the TSBs it pointed to
  photos             text[] not null default '{}',
  thread_id          uuid references public.ai_threads(id) on delete set null,
  resolution         text,
  closed_by_name     text,
  closed_at          timestamptz,
  submitted_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
do $$ begin
  alter table public.complaint_reports add constraint complaint_reports_status_check check (status in ('draft', 'submitted', 'reviewing', 'closed'));
exception when duplicate_object then null; end $$;
create index if not exists complaint_reports_created_idx on public.complaint_reports (created_at desc);

alter table public.complaint_reports enable row level security;
drop policy if exists complaints_read   on public.complaint_reports;
drop policy if exists complaints_insert on public.complaint_reports;
drop policy if exists complaints_update on public.complaint_reports;
drop policy if exists complaints_delete on public.complaint_reports;
create policy complaints_read on public.complaint_reports for select to authenticated
  using (created_by = auth.uid() or public.has_perm('complaints') or public.is_admin()
         or (company_id is not null and company_id = public.my_company_id()));
create policy complaints_insert on public.complaint_reports for insert to authenticated
  with check (created_by = auth.uid() and status = 'draft' and public.is_active());
create policy complaints_update on public.complaint_reports for update to authenticated
  using ((created_by = auth.uid() and status = 'draft') or public.has_perm('complaints') or public.is_admin())
  with check ((created_by = auth.uid() and status = 'draft') or public.has_perm('complaints') or public.is_admin());
create policy complaints_delete on public.complaint_reports for delete to authenticated
  using ((created_by = auth.uid() and status = 'draft') or public.is_admin());

-- Submitting gives the report its number. Jeremiah filed CCR-2026-001 to -004 before the app, so 2026 continues at 005.
create or replace function public.complaint_submit(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.complaint_reports;
  y int := extract(year from now() at time zone 'America/Chicago')::int;
  n int;
begin
  select * into r from public.complaint_reports where id = p_id for update;
  if r.id is null then raise exception 'Report not found.'; end if;
  if r.created_by is distinct from auth.uid() and not public.has_perm('complaints') and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if r.report_no is not null then
    update public.complaint_reports set status = case when status = 'draft' then 'submitted' else status end,
           submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_id;
    return r.report_no;
  end if;
  perform pg_advisory_xact_lock(hashtext('complaint_no_' || y));
  select coalesce(max(report_seq), case when y = 2026 then 4 else 0 end) + 1 into n
    from public.complaint_reports where report_year = y;
  update public.complaint_reports
     set report_year = y, report_seq = n, report_no = 'CCR-' || y || '-' || lpad(n::text, 3, '0'),
         status = 'submitted', submitted_at = now(), updated_at = now()
   where id = p_id;
  return 'CCR-' || y || '-' || lpad(n::text, 3, '0');
end $$;
revoke execute on function public.complaint_submit(uuid) from public, anon;
grant execute on function public.complaint_submit(uuid) to authenticated;

-- ---------- Smart reorder -----------------------------------------------
-- A customer's usual items: bought at least twice, how often (median days between) and how many (median).
-- Runs with the caller's own rules: contractors only ever see their own company's orders.
create or replace function public.reorder_suggestions(p_company uuid default null)
returns table (product_id uuid, times int, usual_days numeric, usual_qty numeric, last_at timestamptz, next_due date)
language sql stable set search_path = public as $$
  with o as (
    select o.created_at, i.product_id, sum(i.qty) as qty
      from public.orders o join public.order_items i on i.order_id = o.id
     where o.company_id = coalesce(p_company, public.my_company_id())
       and o.status <> 'cancelled' and i.product_id is not null
     group by o.id, o.created_at, i.product_id
  ), g as (
    select product_id, created_at, qty,
           extract(epoch from created_at - lag(created_at) over (partition by product_id order by created_at)) / 86400.0 as gap
      from o
  ), s as (
    select product_id, count(*)::int as times,
           percentile_cont(0.5) within group (order by gap) filter (where gap >= 3) as usual_days,
           percentile_cont(0.5) within group (order by qty) as usual_qty,
           max(created_at) as last_at
      from g group by product_id having count(*) >= 2
  )
  select product_id, times, round(usual_days::numeric, 1), round(usual_qty::numeric, 2), last_at,
         (last_at at time zone 'America/Chicago')::date + round(usual_days)::int
    from s where usual_days is not null
$$;

-- Customers who usually order every so often and are now well past it (AMBIT staff).
create or replace function public.customers_due(p_limit int default 50)
returns table (company_id uuid, company_name text, orders int, usual_days numeric, last_at timestamptz,
               days_since int, days_over int, last_order_id uuid, phone text, contact_name text, account_no text)
language sql stable set search_path = public as $$
  with o as (
    select company_id, id, created_at from public.orders
     where company_id is not null and status <> 'cancelled' and public.is_employee()
  ), g as (
    select company_id, id, created_at,
           extract(epoch from created_at - lag(created_at) over (partition by company_id order by created_at)) / 86400.0 as gap
      from o
  ), s as (
    select company_id, count(*)::int as n,
           percentile_cont(0.5) within group (order by gap) filter (where gap >= 3) as usual,
           max(created_at) as last_at
      from g group by company_id having count(*) >= 3
  )
  select s.company_id, c.name, s.n, round(s.usual::numeric, 1), s.last_at,
         (current_date - (s.last_at at time zone 'America/Chicago')::date)::int,
         ((current_date - (s.last_at at time zone 'America/Chicago')::date) - round(s.usual))::int,
         (select o2.id from o o2 where o2.company_id = s.company_id order by o2.created_at desc limit 1),
         c.phone, c.contact_name, c.account_no
    from s join public.companies c on c.id = s.company_id
   where s.usual is not null and c.active
     and (current_date - (s.last_at at time zone 'America/Chicago')::date) > greatest(s.usual * 1.25, s.usual + 5)
   order by (current_date - (s.last_at at time zone 'America/Chicago')::date) / nullif(s.usual, 0) desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;
revoke execute on function public.reorder_suggestions(uuid) from public, anon;
revoke execute on function public.customers_due(int) from public, anon;
grant execute on function public.reorder_suggestions(uuid) to authenticated;
grant execute on function public.customers_due(int) to authenticated;

-- ---------- Sales-tax exemption certificates ------------------------------
alter table public.companies add column if not exists tax_exempt boolean not null default false;
alter table public.orders add column if not exists tax_note text;  -- e.g. "Charge sales tax: certificate expired"

create table if not exists public.tax_certificates (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  state            text,                    -- OK, TX, FL, AL...
  cert_number      text,
  kind             text,                    -- resale | exempt_org | agriculture | government | other
  issued_on        date,
  expires_on       date,
  no_expiration    boolean not null default false,
  file_path        text,                    -- in the tax-certs bucket: <company id>/<file>
  file_name        text,
  status           text not null default 'pending',
  note             text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  uploaded_by_role public.user_role,
  verified_by_name text,
  verified_at      timestamptz,
  remind_60_at     timestamptz,
  remind_30_at     timestamptz,
  remind_expired_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
do $$ begin
  alter table public.tax_certificates add constraint tax_certificates_status_check check (status in ('pending', 'verified', 'rejected', 'replaced'));
exception when duplicate_object then null; end $$;
create index if not exists tax_certificates_company_idx on public.tax_certificates (company_id, created_at desc);

-- Who manages certificates: Accounting (the credit check box) and admins.
create or replace function public.tax_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm('credit_check')
$$;

alter table public.tax_certificates enable row level security;
drop policy if exists tax_certs_read   on public.tax_certificates;
drop policy if exists tax_certs_insert on public.tax_certificates;
drop policy if exists tax_certs_manage on public.tax_certificates;
drop policy if exists tax_certs_delete on public.tax_certificates;
create policy tax_certs_read on public.tax_certificates for select to authenticated
  using (public.is_employee() or company_id = public.my_company_id());
create policy tax_certs_insert on public.tax_certificates for insert to authenticated
  with check (public.tax_manager() or (company_id = public.my_company_id() and status = 'pending' and public.is_active()));
create policy tax_certs_manage on public.tax_certificates for update to authenticated
  using (public.tax_manager()) with check (public.tax_manager());
create policy tax_certs_delete on public.tax_certificates for delete to authenticated
  using (public.tax_manager());

-- A customer's exemption right now: taxable | ok | expiring (60 days or less) | expired | pending | missing.
create or replace function public.company_tax_state(p_company uuid)
returns table (state text, expires_on date, days_left int, cert_id uuid, pending int)
language plpgsql stable security definer set search_path = public as $$
declare
  exempt boolean;
  v public.tax_certificates;
  today date := (now() at time zone 'America/Chicago')::date;
  pend int;
  anyv boolean;
begin
  if p_company is null or not (public.is_employee() or p_company = public.my_company_id()) then
    return;
  end if;
  select c.tax_exempt into exempt from public.companies c where c.id = p_company;
  select count(*) into pend from public.tax_certificates t where t.company_id = p_company and t.status = 'pending';
  select * into v from public.tax_certificates t
   where t.company_id = p_company and t.status = 'verified'
   order by t.no_expiration desc, t.expires_on desc nulls last limit 1;
  anyv := v.id is not null;
  -- Not marked tax-exempt: sales tax is charged as usual, so nothing is held (a certificate they sent
  -- still shows as waiting for Accounting through "pending"; verifying it marks them tax-exempt).
  if not coalesce(exempt, false) then
    return query select 'taxable'::text, null::date, null::int, null::uuid, pend;
  elsif anyv and (v.no_expiration or v.expires_on is null or v.expires_on >= today) then
    return query select case when not v.no_expiration and v.expires_on is not null and v.expires_on - today <= 60 then 'expiring' else 'ok' end,
                        v.expires_on, case when v.no_expiration or v.expires_on is null then null else (v.expires_on - today) end, v.id, pend;
  elsif anyv then
    return query select (case when pend > 0 then 'pending' else 'expired' end)::text, v.expires_on, (v.expires_on - today), v.id, pend;
  elsif pend > 0 then
    return query select 'pending'::text, null::date, null::int, null::uuid, pend;
  else
    return query select 'missing'::text, null::date, null::int, null::uuid, 0;
  end if;
end $$;

-- Every customer that's tax-exempt or has a certificate, with its state (Accounting's list).
create or replace function public.tax_overview()
returns table (company_id uuid, company_name text, account_no text, email text, state text, expires_on date,
               days_left int, pending int, cert_state text, cert_number text, last_order_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.account_no, c.email, s.state, s.expires_on, s.days_left, s.pending,
         t.state, t.cert_number,
         (select max(o.created_at) from public.orders o where o.company_id = c.id and o.status <> 'cancelled')
    from public.companies c
    cross join lateral public.company_tax_state(c.id) s
    left join public.tax_certificates t on t.id = s.cert_id
   where public.is_employee()
     and (c.tax_exempt or exists (select 1 from public.tax_certificates x where x.company_id = c.id))
$$;

-- Accounting verifies (or turns down) a certificate. Verifying marks the customer tax-exempt and
-- retires their older certificates for the same state.
create or replace function public.tax_cert_decide(p_cert uuid, p_verify boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tax_certificates;
begin
  if not public.tax_manager() then raise exception 'Only Accounting and admins can verify certificates.'; end if;
  select * into t from public.tax_certificates where id = p_cert for update;
  if t.id is null then raise exception 'Certificate not found.'; end if;
  if p_verify then
    if not t.no_expiration and t.expires_on is null then raise exception 'Add the expiration date (or tick "No expiration") first.'; end if;
    update public.tax_certificates set status = 'verified', verified_by_name = public.my_name(), verified_at = now(),
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note), updated_at = now()
     where id = p_cert;
    update public.tax_certificates set status = 'replaced', updated_at = now()
     where company_id = t.company_id and id <> p_cert and status = 'verified'
       and coalesce(state, '') = coalesce(t.state, '');
    update public.companies set tax_exempt = true where id = t.company_id;
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why it was turned down.'; end if;
    update public.tax_certificates set status = 'rejected', note = left(trim(p_note), 1000),
           verified_by_name = public.my_name(), verified_at = now(), updated_at = now()
     where id = p_cert;
  end if;
end $$;

-- Accounting marks a customer tax-exempt (or not).
create or replace function public.company_set_tax_exempt(p_company uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tax_manager() then raise exception 'Only Accounting and admins can change this.'; end if;
  update public.companies set tax_exempt = coalesce(p_on, false) where id = p_company;
end $$;
revoke execute on function public.company_set_tax_exempt(uuid, boolean) from public, anon;
grant execute on function public.company_set_tax_exempt(uuid, boolean) to authenticated;

revoke execute on function public.tax_manager() from public, anon;
revoke execute on function public.company_tax_state(uuid) from public, anon;
revoke execute on function public.tax_overview() from public, anon;
revoke execute on function public.tax_cert_decide(uuid, boolean, text) from public, anon;
grant execute on function public.tax_manager() to authenticated;
grant execute on function public.company_tax_state(uuid) to authenticated;
grant execute on function public.tax_overview() to authenticated;
grant execute on function public.tax_cert_decide(uuid, boolean, text) to authenticated;

-- The credit check now stops at an expired (or missing, or unverified) certificate, unless Accounting
-- chooses to charge sales tax on this order.
drop function if exists public.order_credit_decision(uuid, boolean, text);
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  ts text;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'The PO number has to be entered first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  if p_approve and o.company_id is not null then
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') and not coalesce(p_charge_tax, false) then
      raise exception 'This customer''s tax-exempt certificate is %. Verify a current certificate first, or choose "Charge sales tax on this order".',
        case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'waiting to be verified' end;
    end if;
  end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end
   where id = p_order;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean) to authenticated;

-- Certificate files: Accounting and admins see all; a contractor only their company's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tax-certs', 'tax-certs', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tax_certs_files_read   on storage.objects;
drop policy if exists tax_certs_files_insert on storage.objects;
drop policy if exists tax_certs_files_delete on storage.objects;
create policy tax_certs_files_read on storage.objects for select to authenticated using (
  bucket_id = 'tax-certs' and (public.is_employee() or (storage.foldername(name))[1] = public.my_company_id()::text));
create policy tax_certs_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'tax-certs' and (public.tax_manager() or (storage.foldername(name))[1] = public.my_company_id()::text));
create policy tax_certs_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'tax-certs' and public.tax_manager());

select (select count(*) from public.order_drafts) as drafts,
       (select count(*) from public.tax_certificates) as tax_certificates,
       (select count(*) from public.complaint_reports) as complaint_reports;

-- =====================================================================
-- AMBIT Intelligence update 0022
-- * "AMBIT PO #" is now "Sales Order #" (messages only; the column is still ambit_po).
-- * Spray foam resins (B side) are ordered by the drum, like ISO: unit "set" becomes "drum".
-- * Cancel an order (with a reason) and, for admins, delete a cancelled order for good.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Resins by the drum --------------------------------------------
update public.products
   set unit = 'drum'
 where category_id = 'ambit-foam' and lower(unit) in ('set', 'sets') and sku not ilike 'ISO%';
update public.order_items i
   set unit = 'drum'
  from public.products p
 where p.id = i.product_id and p.category_id = 'ambit-foam' and lower(i.unit) in ('set', 'sets');

-- ---------- Sales Order # wording -----------------------------------------
create or replace function public.order_set_po(p_order uuid, p_po text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  ts text;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'Enter the Sales Order # first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  if p_approve and o.company_id is not null then
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') and not coalesce(p_charge_tax, false) then
      raise exception 'This customer''s tax-exempt certificate is %. Verify a current certificate first, or choose "Charge sales tax on this order".',
        case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'waiting to be verified' end;
    end if;
  end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end
   where id = p_order;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean) to authenticated;

-- ---------- Cancel and delete ---------------------------------------------
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancelled_by_name text;
alter table public.orders add column if not exists cancelled_at timestamptz;

-- Admins and the order desk can cancel any open order; whoever placed it can cancel it until it has a
-- Sales Order #. Cancelling releases its stock (the inventory trigger marks the sheet lines Cancelled).
create or replace function public.order_cancel(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or public.has_perm('order_desk')
          or (o.placed_by = auth.uid() and o.ambit_po is null)) then
    raise exception 'Only an admin or the order desk can cancel this order now.';
  end if;
  if o.status = 'cancelled' then raise exception 'This order is already cancelled.'; end if;
  if o.status = 'completed' then raise exception 'This order is already picked up or delivered.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the order is cancelled.'; end if;
  update public.orders
     set status = 'cancelled', cancel_reason = left(trim(p_reason), 500),
         cancelled_by_name = public.my_name(), cancelled_at = now()
   where id = p_order;
end $$;

-- Admins only, and only a cancelled order (so its stock is released first). Waits until the inventory
-- sheet shows the lines as Cancelled, so the spreadsheet never keeps a reservation for a deleted order.
create or replace function public.order_delete(p_order uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.is_admin() then raise exception 'Only admins can delete orders.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'cancelled' then raise exception 'Cancel the order first, then delete it.'; end if;
  if exists (select 1 from public.inventory_lines l where l.order_id = p_order and l.sheet_row is not null and l.needs_write) then
    raise exception 'The inventory spreadsheet is still being updated for this order. Try again in a couple of minutes.';
  end if;
  delete from public.orders where id = p_order;
  return 'ORD-' || o.order_no;
end $$;

revoke execute on function public.order_cancel(uuid, text) from public, anon;
revoke execute on function public.order_delete(uuid) from public, anon;
grant execute on function public.order_cancel(uuid, text) to authenticated;
grant execute on function public.order_delete(uuid) to authenticated;

select (select count(*) from public.products where category_id = 'ambit-foam' and unit = 'drum') as foam_by_the_drum;


-- =====================================================================
-- AMBIT Intelligence update 0023 - Spray foam by lot
-- * The store sells one "ISO A-Side". Behind it the warehouse stocks several brands
--   (Covestro, Wanhua, Dow, Huntsman), each in lots with Mfg / Exp dates.
-- * AMBI-SEAL 5.0 and AMBI-TITE 204 HFO come in Summer and Winter versions.
-- * When an order is placed the app picks the drums: ISO from Covestro first, then
--   whichever lot expires soonest (no Exp date = 12 months after Mfg). Resins: the lot
--   that expires soonest. Expired lots are never picked automatically.
-- * Brands and lots are for AMBIT staff only (order page, warehouse PDF, spreadsheet).
-- * The spreadsheet gets a FOAM LOTS tab laid out like the old sheet (the app adds it
--   on its next sync), and foam's TOTAL IN STOCK on the COUNT SHEET adds up the lots.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Products ----------------------------------------------------
-- stock_of: this product is stocked under that one (ISO-COVESTRO is stocked under ISO A-Side).
-- pick_rank: which brand goes out first (lower first).
alter table public.products add column if not exists stock_of  uuid references public.products(id) on delete set null;
alter table public.products add column if not exists pick_rank int not null default 100;

-- The one ISO the store shows.
insert into public.products (sku, name, description, category_id, unit, image_url, active, sort)
select 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'Spray foam A side (pMDI) in 500 lb drums. Pairs with any AMBIT spray foam resin.',
       coalesce((select category_id from public.products where upper(sku) = 'ISO-COVESTRO'), 'ambit-foam'),
       'drum',
       (select image_url from public.products where upper(sku) = 'ISO-COVESTRO'),
       true, 0
 where not exists (select 1 from public.products where upper(sku) = 'ISO')
   and exists (select 1 from public.categories where id = coalesce((select category_id from public.products where upper(sku) = 'ISO-COVESTRO'), 'ambit-foam'));

-- Every ISO brand the warehouse keeps (only stocked, never sold by name).
insert into public.products (sku, name, category_id, unit, active, sort)
select v.sku, v.name, i.category_id, 'drum', false, 0
  from (values ('ISO-COVESTRO', 'ISO A-Side (pMDI), Covestro, 500 lb drum'),
               ('ISO-WANHUA',   'ISO A-Side (pMDI), Wanhua, 500 lb drum'),
               ('ISO-DOW',      'ISO A-Side (pMDI), Dow, 500 lb drum'),
               ('ISO-HUNTSMAN', 'ISO A-Side (pMDI), Huntsman, 500 lb drum')) v(sku, name)
  join public.products i on upper(i.sku) = 'ISO'
 where not exists (select 1 from public.products p where upper(p.sku) = v.sku);

update public.products b
   set stock_of = i.id,
       active = false,
       pick_rank = case when upper(b.sku) = 'ISO-COVESTRO' then 1 else 2 end,
       unit = 'drum'
  from public.products i
 where upper(i.sku) = 'ISO'
   and upper(b.sku) in ('ISO-COVESTRO', 'ISO-WANHUA', 'ISO-DOW', 'ISO-HUNTSMAN');

-- AMBIT staff can read products that aren't sold by name (the ISO brands show by name on Inventory and orders).
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated
  using (public.is_active() and (active or public.is_employee()));

-- A banner that pointed at a brand now points at ISO A-Side.
update public.promos m set product_id = b.stock_of
  from public.products b
 where m.product_id = b.id and b.stock_of is not null;

-- Winter versions of the resins (same price, picture and description as the regular one).
insert into public.products (sku, name, description, category_id, unit, list_price, customer_priced, image_url, active, sort, sqft_per_unit)
select s.sku || '-W', regexp_replace(s.name, '\s*\((Summer|Winter)\)\s*$', '', 'i') || ' (Winter)',
       s.description, s.category_id, s.unit, s.list_price, s.customer_priced, s.image_url, true, s.sort, s.sqft_per_unit
  from public.products s
 where upper(s.sku) in ('AMB-SEAL-50', 'AMB-TITE-20')
   and not exists (select 1 from public.products w where upper(w.sku) = upper(s.sku) || '-W');
update public.products
   set name = name || ' (Summer)'
 where upper(sku) in ('AMB-SEAL-50', 'AMB-TITE-20') and name !~* '\((summer|winter)\)\s*$';

-- ---------- Lots --------------------------------------------------------
-- One row per lot on the FOAM LOTS tab. The sheet owns Starting / Shipped In / Adj / dates;
-- the app adds what it picks up to Shipped Out (out_unsynced until it's written to the sheet).
create table if not exists public.inventory_lots (
  id            bigint generated always as identity primary key,
  branch_id     text not null references public.branches(id) on update cascade on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  sku           text not null,                     -- as the sheet writes it
  lot_no        text not null default '',          -- '' = a row with no lot number
  mfg           date,
  exp           date,
  use_by        date generated always as (coalesce(exp, (mfg + interval '12 months')::date)) stored,
  starting      numeric(12,2) not null default 0,
  shipped_out   numeric(12,2) not null default 0,  -- Shipped Out on the sheet
  shipped_in    numeric(12,2) not null default 0,
  adj           numeric(12,2) not null default 0,
  out_unsynced  numeric(12,2) not null default 0,  -- picked up in the app, not on the sheet yet
  remaining     numeric(12,2) generated always as (starting - shipped_out + shipped_in + adj - out_unsynced) stored,
  sheet_pending numeric(12,2) not null default 0,  -- held by lines typed into PENDING ORDERS with this lot
  label         text,                              -- Product column on the sheet
  notes         text,
  sheet_row     int,
  on_sheet      boolean not null default true,
  sort          int not null default 0,
  updated_at    timestamptz not null default now()
);
create unique index if not exists inventory_lots_key on public.inventory_lots(branch_id, product_id, upper(lot_no));
create index if not exists inventory_lots_product_idx on public.inventory_lots(branch_id, product_id);

alter table public.inventory_lots enable row level security;
grant select on public.inventory_lots to authenticated;
grant all on public.inventory_lots to service_role;
drop policy if exists inventory_lots_read on public.inventory_lots;
create policy inventory_lots_read on public.inventory_lots for select to authenticated using (public.is_employee());

-- ---------- Order lines: one per lot picked -----------------------------
alter table public.inventory_lines add column if not exists id bigint generated always as identity;
do $$ begin
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.inventory_lines'::regclass and c.contype = 'p'
                and pg_get_constraintdef(c.oid) ilike '%order_item_id%') then
    alter table public.inventory_lines drop constraint inventory_lines_pkey;
    alter table public.inventory_lines add constraint inventory_lines_pkey primary key (id);
  end if;
end $$;
create index if not exists inventory_lines_item_idx on public.inventory_lines(order_item_id);
alter table public.inventory_lines add column if not exists lot_id   bigint references public.inventory_lots(id) on delete set null;
alter table public.inventory_lines add column if not exists lot_no   text;
alter table public.inventory_lines add column if not exists prev_sku text;   -- moved to another brand: the SKU still on the sheet
create index if not exists inventory_lines_lot_idx on public.inventory_lines(lot_id) where state = 'reserved';

-- ---------- A product counted by lot: TOTAL IN STOCK = what's left in its lots ----
create or replace function public.inventory_lot_rollup(p_branch text, p_product uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  tot numeric;
  s   text;
begin
  if not exists (select 1 from public.inventory_lots where branch_id = p_branch and product_id = p_product) then return; end if;
  select coalesce(sum(remaining) filter (where on_sheet), 0), max(sku) into tot, s
    from public.inventory_lots where branch_id = p_branch and product_id = p_product;
  insert into public.inventory (branch_id, product_id, sku, on_hand, synced_on_hand, on_sheet, updated_by_name)
  values (p_branch, p_product, coalesce(s, (select sku from public.products where id = p_product)), tot, tot, true, 'FOAM LOTS')
  on conflict (branch_id, product_id) do update
     set on_hand = excluded.on_hand, synced_on_hand = excluded.on_hand, count_dirty = false,
         on_sheet = true, updated_at = now(), updated_by_name = 'FOAM LOTS'
   where public.inventory.on_hand is distinct from excluded.on_hand
      or public.inventory.synced_on_hand is distinct from excluded.on_hand
      or not public.inventory.on_sheet;
end $$;

create or replace function public.inventory_lots_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then perform public.inventory_lot_rollup(old.branch_id, old.product_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.branch_id <> old.branch_id or new.product_id <> old.product_id
                             or new.remaining is distinct from old.remaining or new.on_sheet is distinct from old.on_sheet) then
    perform public.inventory_lot_rollup(new.branch_id, new.product_id);
  end if;
  return null;
end $$;
drop trigger if exists inventory_lots_rollup on public.inventory_lots;
create trigger inventory_lots_rollup after insert or update or delete on public.inventory_lots
  for each row execute function public.inventory_lots_changed();

-- Every product counted by lot at a branch, in one go (the sync runs this so the totals always match the lots).
create or replace function public.inventory_lots_rollup_all(p_branch text)
returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct product_id from public.inventory_lots where branch_id = p_branch loop
    perform public.inventory_lot_rollup(p_branch, r.product_id);
  end loop;
end $$;

-- ---------- Stock for the Order screen ----------------------------------
-- As before, plus ISO A-Side: the total of every ISO brand in stock.
create or replace function public.stock_for(p_branch text)
returns table (product_id uuid, on_hand numeric, pending numeric, net numeric, reorder_point numeric, label text)
language sql stable security definer set search_path = public as $$
  with r as (
    select l.product_id, sum(l.qty) as q
      from public.inventory_lines l
     where l.branch_id = p_branch and l.state = 'reserved'
     group by l.product_id
  ), v0 as (
    select i.product_id, i.on_hand, i.reorder_point,
           i.sheet_pending + coalesce(r.q, 0) as pending,
           i.on_hand - i.sheet_pending - coalesce(r.q, 0) as net
      from public.inventory i
      left join r on r.product_id = i.product_id
     where i.branch_id = p_branch and i.on_sheet
       and exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled)
  ), g as (
    select p.stock_of as product_id, sum(v0.on_hand) as on_hand, sum(v0.reorder_point) as reorder_point,
           sum(v0.pending) as pending, sum(v0.net) as net
      from v0 join public.products p on p.id = v0.product_id
     where p.stock_of is not null
     group by p.stock_of
  ), v as (
    select v0.product_id, v0.on_hand, v0.reorder_point, v0.pending, v0.net from v0
    union all
    select g.product_id, g.on_hand, g.reorder_point, g.pending, g.net from g
     where not exists (select 1 from v0 where v0.product_id = g.product_id)
  )
  select v.product_id,
         case when public.is_employee() then v.on_hand end,
         case when public.is_employee() then v.pending end,
         case when public.is_employee() then v.net end,
         case when public.is_employee() then v.reorder_point end,
         case when v.on_hand is null then null
              when v.net <= 0 then 'out'
              when v.net <= coalesce(v.reorder_point, 0) then 'low'
              else 'in' end
    from v
   where public.is_active()
$$;

-- ---------- Picking the drums for an order line --------------------------
-- Brand order (pick_rank), then the lot that expires soonest, then the oldest. Expired lots are skipped.
-- Short on stock: the rest waits on the first-choice brand with no lot yet (pick it on the order page).
create or replace function public.inventory_pick(p_item bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it    public.order_items;
  o     record;
  cand  uuid[];
  need  numeric;
  take  numeric;
  lot   record;
  first record;
  today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  select id, branch_id, delivery_method, status into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status in ('cancelled', 'completed') then return; end if;
  if not exists (select 1 from public.inventory_sheets x where x.branch_id = o.branch_id and x.enabled) then return; end if;
  if exists (select 1 from public.inventory_lines where order_item_id = p_item) then return; end if;

  -- Two orders at the same moment never get the same drums.
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  if cand is null then cand := array[it.product_id]; end if;

  if exists (select 1 from public.inventory_lots l where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet) then
    need := it.qty;
    for lot in
      select l.id, l.product_id, l.sku, l.lot_no,
             l.remaining - l.sheet_pending
               - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = l.id and x.state = 'reserved'), 0) as avail
        from public.inventory_lots l
        join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
         and (l.use_by is null or l.use_by >= today)
       order by p.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      select l.product_id, l.sku into first
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
       order by p.pick_rank, l.use_by nulls last, l.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, need);
    end if;
  else
    -- No lots here: the item itself (or, for ISO A-Side, the first brand this branch stocks).
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;  -- not stocked at this branch: ships from the supplier
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;

create or replace function public.inventory_reserve_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.inventory_pick(new.id);
  return new;
exception when others then
  -- Stock bookkeeping must never stop an order from going through.
  raise warning 'inventory_reserve_line: %', sqlerrm;
  return new;
end $$;

-- ---------- Taking a line out of stock (or putting it back) --------------
-- A line from a lot changes that lot's Shipped Out; anything else changes TOTAL IN STOCK as before.
create or replace function public.inventory_line_stock(p_line bigint, p_sign int, p_kind text, p_what text, p_who text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_lines;
  lot public.inventory_lots;
  b   numeric;
  q   text;
begin
  select * into l from public.inventory_lines where id = p_line;
  if l.id is null then return; end if;
  q := trim_scale(l.qty)::text;
  if l.lot_id is not null then
    update public.inventory_lots set out_unsynced = out_unsynced - p_sign * l.qty, updated_at = now()
     where id = l.lot_id returning * into lot;
    if lot.id is not null then
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (l.branch_id, p_kind, l.sku,
              p_what || q || case when p_sign < 0 then ' taken out of lot ' else ' put back in lot ' end
                || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' (Shipped Out on FOAM LOTS).',
              lot.remaining - p_sign * l.qty, lot.remaining, p_who);
      update public.inventory_sheets set sync_wanted_at = now() where branch_id = l.branch_id;
      return;
    end if;
  end if;
  if exists (select 1 from public.inventory_lots x where x.branch_id = l.branch_id and x.product_id = l.product_id) then
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (l.branch_id, p_kind, l.sku,
            p_what || q || ' of ' || l.sku || ' had no lot picked, so FOAM LOTS wasn''t changed. Update Shipped Out on the right lot.', p_who);
    return;
  end if;
  update public.inventory set on_hand = on_hand + p_sign * l.qty, updated_at = now(), updated_by_name = p_who
   where branch_id = l.branch_id and product_id = l.product_id and on_hand is not null
  returning on_hand - p_sign * l.qty into b;
  insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
  values (l.branch_id, p_kind, l.sku, p_what || q || case when p_sign < 0 then ' taken out of stock.' else ' put back in stock.' end,
          b, b + p_sign * l.qty, p_who);
end $$;

-- ---------- An order is cancelled, picked up / delivered, or reopened ---
create or replace function public.inventory_order_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l   record;
  who text := coalesce(public.my_name(), 'AMBITION');
begin
  if new.status is not distinct from old.status and new.ambit_po is not distinct from old.ambit_po then return new; end if;
  if not exists (select 1 from public.inventory_lines where order_id = new.id) then return new; end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.inventory_lines
       set state = 'cancelled', done_by = 'app', needs_write = true, updated_at = now()
     where order_id = new.id and state = 'reserved';
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (new.branch_id, 'order', 'ORD-' || new.order_no || ' cancelled: its stock is released.', who);

  elsif new.status = 'completed' and old.status <> 'completed' then
    -- Picked up or delivered: the stock leaves (once per line).
    for l in select * from public.inventory_lines where order_id = new.id and state = 'reserved' and not stock_taken loop
      perform public.inventory_line_stock(l.id, -1, 'order', 'ORD-' || new.order_no || ' picked up / delivered: ', who);
    end loop;
    update public.inventory_lines
       set state = 'done', done_by = 'app', stock_taken = true, needs_write = true, updated_at = now()
     where order_id = new.id and state = 'reserved';

  elsif new.status in ('new', 'processing') and old.status in ('cancelled', 'completed') then
    -- Reopened: hold the stock again (and put back what the app took out when it was closed here).
    for l in select * from public.inventory_lines where order_id = new.id and state <> 'reserved' and done_by = 'app' and stock_taken loop
      perform public.inventory_line_stock(l.id, 1, 'order', 'ORD-' || new.order_no || ' reopened: ', who);
    end loop;
    update public.inventory_lines
       set state = 'reserved', done_by = null, stock_taken = false, needs_write = true, updated_at = now()
     where order_id = new.id and state <> 'reserved' and done_by = 'app';
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (new.branch_id, 'order', 'ORD-' || new.order_no || ' reopened: its stock is reserved again.', who);
  end if;

  if new.ambit_po is distinct from old.ambit_po then
    update public.inventory_lines set needs_write = true, updated_at = now() where order_id = new.id;
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = new.branch_id;
  return new;
exception when others then
  -- Stock bookkeeping must never stop an order from moving on.
  raise warning 'inventory_order_changed: %', sqlerrm;
  return new;
end $$;

-- An app order line was marked "Picked Up / Completed" on the sheet: take it out of stock once.
create or replace function public.inventory_line_done_on_sheet(p_line bigint, p_status text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  l public.inventory_lines;
  n bigint;
begin
  update public.inventory_lines
     set state = 'done', done_by = 'sheet', stock_taken = true, sheet_status = p_status, needs_write = false, updated_at = now()
   where id = p_line and state = 'reserved' and not stock_taken
  returning * into l;
  if l.id is null then return false; end if;
  select order_no into n from public.orders where id = l.order_id;
  perform public.inventory_line_stock(l.id, -1, 'sheet', 'ORD-' || n || ' marked Picked Up / Completed on the sheet: ', 'Spreadsheet');
  return true;
end $$;

-- A line typed straight into PENDING ORDERS with "[Lot ...]" in its Notes was picked up.
create or replace function public.inventory_lot_out(p_lot bigint, p_qty numeric, p_message text)
returns void
language plpgsql security definer set search_path = public as $$
declare lot public.inventory_lots;
begin
  update public.inventory_lots set out_unsynced = out_unsynced + p_qty, updated_at = now() where id = p_lot returning * into lot;
  if lot.id is null then return; end if;
  insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
  values (lot.branch_id, 'sheet', lot.sku, p_message, lot.remaining + p_qty, lot.remaining, 'Spreadsheet');
end $$;

-- The sync wrote Shipped Out to the sheet: fold what it wrote into the sheet's number.
create or replace function public.inventory_lot_written(p_lot bigint, p_sheet_out numeric, p_written numeric)
returns void
language sql security definer set search_path = public as $$
  update public.inventory_lots
     set shipped_out = p_sheet_out + p_written, out_unsynced = out_unsynced - p_written, updated_at = now()
   where id = p_lot
$$;

-- ---------- Changing the lot on an order (warehouse / order desk) -------
create or replace function public.inventory_lot_choices(p_line bigint)
returns table (lot_id bigint, product_id uuid, sku text, lot_no text, use_by date, exp date, mfg date,
               remaining numeric, available numeric, expired boolean, rank int)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.inventory_lines where id = p_line),
       it as (select i.product_id from public.order_items i join l on l.order_item_id = i.id),
       cand as (select p.id from public.products p where p.stock_of = (select product_id from it)
                union select product_id from it)
  select x.id, x.product_id, x.sku, x.lot_no, x.use_by, x.exp, x.mfg, x.remaining,
         x.remaining - x.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved' and r.id <> p_line), 0),
         coalesce(x.use_by < (now() at time zone 'America/Chicago')::date, false),
         p.pick_rank
    from public.inventory_lots x
    join public.products p on p.id = x.product_id
   where public.is_employee()
     and x.branch_id = (select branch_id from l) and x.on_sheet
     and x.product_id in (select id from cand)
   order by p.pick_rank, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
$$;

create or replace function public.inventory_repick(p_line bigint, p_lot bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l     public.inventory_lines;
  lot   public.inventory_lots;
  ok    boolean;
  avail numeric;
  n     bigint;
  who   text := coalesce(public.my_name(), 'AMBITION');
begin
  if not (public.is_admin() or public.has_perm('inventory') or public.has_perm('order_desk')) then
    raise exception 'Only the warehouse or the order desk can change lots.';
  end if;
  select * into l from public.inventory_lines where id = p_line for update;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  if l.state <> 'reserved' then
    raise exception 'This line is already %.', case l.state when 'done' then 'picked up' else 'cancelled' end;
  end if;
  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || l.branch_id));
  select * into lot from public.inventory_lots where id = p_lot;
  if lot.id is null or not lot.on_sheet or lot.branch_id <> l.branch_id then
    raise exception 'That lot isn''t on this location''s FOAM LOTS tab.';
  end if;
  select (lot.product_id = i.product_id or exists (select 1 from public.products p where p.id = lot.product_id and p.stock_of = i.product_id))
    into ok from public.order_items i where i.id = l.order_item_id;
  if not coalesce(ok, false) then raise exception 'That lot is a different product.'; end if;
  avail := lot.remaining - lot.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = lot.id and r.state = 'reserved' and r.id <> l.id), 0);
  if avail < l.qty then
    raise exception 'Lot % only has % available. Pick a lot with at least %.',
      coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(avail, 0)), trim_scale(l.qty);
  end if;
  update public.inventory_lines
     set lot_id = lot.id, lot_no = nullif(lot.lot_no, ''), product_id = lot.product_id,
         prev_sku = case when upper(sku) <> upper(lot.sku) then coalesce(prev_sku, sku) else prev_sku end,
         sku = lot.sku, needs_write = true, updated_at = now()
   where id = l.id;
  select order_no into n from public.orders where id = l.order_id;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (l.branch_id, 'order', lot.sku,
          'ORD-' || n || ': ' || trim_scale(l.qty) || ' moved to lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)')
            || coalesce(' (was ' || coalesce(l.lot_no, 'no lot') || case when upper(l.sku) <> upper(lot.sku) then ', ' || l.sku else '' end || ')', '') || '.',
          who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = l.branch_id;
  return coalesce(nullif(lot.lot_no, ''), '(no lot #)');
end $$;

-- ---------- Counts made in the app: foam is counted by lot on the sheet --
create or replace function public.inventory_set_count(p_branch text, p_product uuid, p_qty numeric, p_mode text default 'count', p_note text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  i   public.inventory;
  v   numeric;
  who text := coalesce(public.my_name(), 'AMBITION');
  msg text;
begin
  if not public.has_perm('inventory') then raise exception 'You don''t have access to inventory.'; end if;
  if p_qty is null then raise exception 'Enter a number.'; end if;
  if p_mode not in ('count', 'received', 'removed') then raise exception 'Unknown stock change.'; end if;
  if exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = p_product) then
    raise exception 'This item is counted by lot. Update its lots on the FOAM LOTS tab of the spreadsheet.';
  end if;
  select * into i from public.inventory where branch_id = p_branch and product_id = p_product for update;
  if i.product_id is null or not i.on_sheet then raise exception 'That item isn''t on this location''s inventory sheet.'; end if;

  if p_mode = 'count' then
    if p_qty < 0 then raise exception 'A count can''t be below zero.'; end if;
    v := round(p_qty, 2);
    update public.inventory
       set on_hand = v, last_counted = (now() at time zone 'America/Chicago')::date, counted_by = left(who, 80),
           count_dirty = true, updated_at = now(), updated_by_name = who
     where branch_id = p_branch and product_id = p_product;
    msg := 'Counted ' || trim_scale(v) || ' in stock.';
  else
    if p_qty <= 0 then raise exception 'Enter how many.'; end if;
    v := coalesce(i.on_hand, 0) + case when p_mode = 'received' then round(p_qty, 2) else -round(p_qty, 2) end;
    update public.inventory set on_hand = v, updated_at = now(), updated_by_name = who
     where branch_id = p_branch and product_id = p_product;
    msg := case when p_mode = 'received' then 'Received ' || trim_scale(round(p_qty, 2)) || '.' else 'Removed ' || trim_scale(round(p_qty, 2)) || '.' end;
  end if;

  insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
  values (p_branch, p_mode, i.sku,
          msg || coalesce(' ' || nullif(left(trim(coalesce(p_note, '')), 200), ''), ''),
          i.on_hand, v, who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = p_branch;
  return v;
end $$;

-- ---------- Smart reorder: a brand bought before is ISO A-Side now -------
create or replace function public.reorder_suggestions(p_company uuid default null)
returns table (product_id uuid, times int, usual_days numeric, usual_qty numeric, last_at timestamptz, next_due date)
language sql stable set search_path = public as $$
  with o as (
    select o.created_at, coalesce(p.stock_of, i.product_id) as product_id, sum(i.qty) as qty
      from public.orders o
      join public.order_items i on i.order_id = o.id
      left join public.products p on p.id = i.product_id
     where o.company_id = coalesce(p_company, public.my_company_id())
       and o.status <> 'cancelled' and i.product_id is not null
     group by o.id, o.created_at, coalesce(p.stock_of, i.product_id)
  ), g as (
    select product_id, created_at, qty,
           extract(epoch from created_at - lag(created_at) over (partition by product_id order by created_at)) / 86400.0 as gap
      from o
  ), s as (
    select product_id, count(*)::int as times,
           percentile_cont(0.5) within group (order by gap) filter (where gap >= 3) as usual_days,
           percentile_cont(0.5) within group (order by qty) as usual_qty,
           max(created_at) as last_at
      from g group by product_id having count(*) >= 2
  )
  select product_id, times, round(usual_days::numeric, 1), round(usual_qty::numeric, 2), last_at,
         (last_at at time zone 'America/Chicago')::date + round(usual_days)::int
    from s where usual_days is not null
$$;

-- Old orders and drafts that name a brand reorder as ISO A-Side.
create or replace function public.stock_parents()
returns table (product_id uuid, parent_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.stock_of from public.products p where p.stock_of is not null and public.is_active()
$$;
revoke all on function public.stock_parents() from public, anon;
grant execute on function public.stock_parents() to authenticated;

-- ---------- Who can run what ---------------------------------------------
revoke all on function public.inventory_lot_rollup(text, uuid) from public, anon, authenticated;
revoke all on function public.inventory_lots_rollup_all(text) from public, anon, authenticated;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;
revoke all on function public.inventory_line_stock(bigint, int, text, text, text) from public, anon, authenticated;
revoke all on function public.inventory_lot_out(bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.inventory_lot_written(bigint, numeric, numeric) from public, anon, authenticated;
revoke all on function public.inventory_lot_choices(bigint) from public, anon;
revoke all on function public.inventory_repick(bigint, bigint) from public, anon;
grant execute on function public.inventory_lots_rollup_all(text) to service_role;
grant execute on function public.inventory_pick(bigint) to service_role;
grant execute on function public.inventory_line_stock(bigint, int, text, text, text) to service_role;
grant execute on function public.inventory_lot_out(bigint, numeric, text) to service_role;
grant execute on function public.inventory_lot_written(bigint, numeric, numeric) to service_role;
grant execute on function public.inventory_lot_choices(bigint) to authenticated;
grant execute on function public.inventory_repick(bigint, bigint) to authenticated;

-- ---------- Oklahoma City's foam, from the old inventory sheet -----------
-- (No Exp date = 12 months after Mfg. Lots with neither go out last.)
insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, shipped_out, label, sort)
select 'okc', p.id, p.sku, v.lot, v.mfg::date, v.exp::date, v.starting, v.shipped, v.label, v.sort
  from (values
    ('ISO-COVESTRO',  'PA86002836', '2026-04-02', '2027-04-02', 44, 7, 'Covestro Iso (Metal Drums)', 1),
    ('ISO-COVESTRO',  'PA86002841', '2026-04-09', '2027-04-09', 78, 0, 'Covestro Iso (Metal Drums)', 2),
    ('ISO-COVESTRO',  'PA86002845', '2026-04-16', '2027-04-16', 80, 0, 'Covestro Iso (Metal Drums)', 3),
    ('ISO-DOW',       '',           null,         null,          0, 0, 'Dow Iso (Metal Drums)',      4),
    ('ISO-HUNTSMAN',  '',           null,         null,          0, 0, 'Huntsman Iso',               5),
    ('ISO-WANHUA',    '2605P0437',  '2026-05-10', null,         68, 0, 'Wanhua Iso (Metal Drums)',   6),
    ('ISO-WANHUA',    '2605P0499',  '2026-05-27', null,         72, 0, 'Wanhua Iso (Metal Drums)',   7),
    ('AMB-SEAL-50-W', 'LW8019',     '2026-10-14', null,         28, 1, 'AMBI-SEAL 5.0 Winter',       8),
    ('AMB-SEAL-50-W', 'LW8020',     '2026-10-20', null,         12, 0, 'AMBI-SEAL 5.0 Winter',       9),
    ('AMB-SEAL-50',   'L7989',      '2026-09-11', null,         32, 0, 'AMBI-SEAL 5.0 Summer',      10),
    ('AMB-TITE-20',   'L8002',      null,         null,          0, 0, 'AMBI-TITE 204 HFO Summer',  11),
    ('AMB-TITE-20',   'L8007',      null,         null,         24, 0, 'AMBI-TITE 204 HFO Summer',  12),
    ('AMB-TITE-20-W', 'LW8017',     '2026-10-19', null,         40, 6, 'AMBI-TITE 204 HFO Winter',  13)
  ) v(sku, lot, mfg, exp, starting, shipped, label, sort)
  join public.products p on upper(p.sku) = v.sku
 where exists (select 1 from public.branches where id = 'okc')
   and exists (select 1 from public.inventory_sheets where branch_id = 'okc')
   and not exists (select 1 from public.inventory_lots where branch_id = 'okc');

select (select count(*) from public.inventory_lots) as foam_lots,
       (select string_agg(sku || ' ' || trim_scale(on_hand), ', ' order by sku) from public.inventory
         where branch_id = 'okc' and product_id in (select product_id from public.inventory_lots)) as foam_in_stock,
       (select count(*) from public.products where stock_of is not null) as iso_brands;

-- =====================================================================
-- AMBIT Intelligence update 0024 - Order desk dashboard
-- One call gives the Order Desk page its charts: open orders by status and
-- by location, orders placed per day (or week), how long each step takes,
-- and the orders waiting longest. For admins, the order desk (CRM) and
-- credit approvals (accounting). Run once in Supabase > SQL Editor.
-- Safe to run again.
-- =====================================================================

-- p_days: 7, 30 or 90 days back (today included), or 0 for this year. Days are Central time.
-- p_branch: null = every location, 'dropship' = drop-ship orders, else a branch id.
create or replace function public.order_desk_stats(p_days int default 30, p_branch text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz     text := 'America/Chicago';
  today  date := (now() at time zone 'America/Chicago')::date;
  d0     date;
  since  timestamptz;
  weekly boolean;
  res    jsonb;
begin
  if not (public.is_admin() or public.has_perm('order_desk') or public.has_perm('credit_check')) then
    raise exception 'You don''t have access to the order desk.';
  end if;
  d0 := case when coalesce(p_days, 30) <= 0 then date_trunc('year', today)::date else today - (least(p_days, 366) - 1) end;
  since := d0::timestamp at time zone tz;
  weekly := coalesce(p_days, 30) <= 0 or p_days > 45;

  with o as (
    select x.*,
           (x.created_at at time zone tz)::date as placed_day
      from public.orders x
     where p_branch is null
        or (p_branch = 'dropship' and x.branch_id is null)
        or x.branch_id = p_branch
  ),
  opn as (
    select o.*,
           case o.stage
             when 'customer'  then coalesce(o.approval_sent_at, o.created_at)
             when 'needs_po'  then coalesce(o.approved_at, o.created_at)
             when 'credit'    then coalesce(o.po_at, o.created_at)
             when 'hold'      then coalesce(o.credit_at, o.created_at)
             when 'schedule'  then coalesce(o.credit_at, o.created_at)
             when 'scheduled' then case when o.scheduled_for < today then (o.scheduled_for + 1)::timestamp at time zone tz end
           end as waiting_since
      from o
     where o.stage not in ('completed', 'cancelled')
  ),
  buckets as (
    select g::date as d
      from generate_series(
             case when weekly then date_trunc('week', d0)::date else d0 end,
             today,
             case when weekly then interval '1 week' else interval '1 day' end) g
  ),
  steps as (
    select 'customer' as k, extract(epoch from approved_at - approval_sent_at) / 3600.0 as h
      from o where approval_sent_at is not null and approved_at >= since
    union all
    select 'po', extract(epoch from po_at - coalesce(approved_at, created_at)) / 3600.0
      from o where po_at >= since
    union all
    select 'credit', extract(epoch from credit_at - po_at) / 3600.0
      from o where credit_at >= since and po_at is not null and credit_status in ('approved', 'hold')
    union all
    select 'schedule', extract(epoch from scheduled_at - credit_at) / 3600.0
      from o where scheduled_at >= since and credit_at is not null and credit_status = 'approved'
  )
  select jsonb_build_object(
    'first', d0,
    'since', since,
    'today', today,
    'bucket', case when weekly then 'week' else 'day' end,
    'open', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from opn group by stage) s), '{}'::jsonb),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch', b, 'stage', stage, 'n', n))
                             from (select coalesce(branch_id, 'dropship') as b, stage, count(*) as n from opn group by 1, 2) s), '[]'::jsonb),
    'placed', (select count(*) from o where created_at >= since),
    'completed', (select count(*) from o where status = 'completed' and completed_at >= since),
    'cancelled', (select count(*) from o where status = 'cancelled' and coalesce(cancelled_at, created_at) >= since),
    'series', (select jsonb_agg(jsonb_build_object('d', b.d, 'n',
                 (select count(*) from o
                   where case when weekly then date_trunc('week', o.placed_day)::date else o.placed_day end = b.d
                     and o.placed_day >= d0))
                 order by b.d) from buckets b),
    'steps', coalesce((select jsonb_object_agg(k, jsonb_build_object('n', n, 'avg', round(avg_h::numeric, 2), 'median', round(med_h::numeric, 2)))
                         from (select k, count(*) as n, avg(h) as avg_h, percentile_cont(0.5) within group (order by h) as med_h
                                 from steps where h >= 0 group by k) s), '{}'::jsonb),
    'cycle', (select jsonb_build_object('n', count(*),
                       'avg', round((avg(extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2),
                       'median', round((percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2))
                from o where status = 'completed' and completed_at >= since and completed_at > created_at),
    'stuck', (select count(*) from opn where waiting_since is not null and (stage = 'scheduled' or waiting_since < now() - interval '24 hours')),
    'waiting', coalesce((select jsonb_agg(w) from (
                  select jsonb_build_object('id', id, 'order_no', order_no, 'company', company_name, 'stage', stage,
                                            'branch', branch_id, 'since', waiting_since,
                                            'hours', round((extract(epoch from now() - waiting_since) / 3600.0)::numeric, 1),
                                            'late', stage = 'scheduled', 'scheduled_for', scheduled_for) as w
                    from opn where waiting_since is not null
                   order by waiting_since
                   limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

revoke all on function public.order_desk_stats(int, text) from public, anon;
grant execute on function public.order_desk_stats(int, text) to authenticated;

select 'order desk dashboard ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0025 - Invoice #, signed BOL, item variance
-- * Sales Order # step: an Invoice # box next to it (both required) and an optional
--   invoice upload (PDF or photo).
-- * Delivered / Picked up: a photo or scan of the signed BOL is required.
-- * Item variance: admins (and anyone given the new "Item variance" box in
--   Admin > Accounts, e.g. the Warehouse Manager later) can load a different lot or a
--   different product type than the one picked. Every change is kept with who, when
--   and why. Changing lots is now theirs only.
-- * "Customer Approved without Email" on a scheduled order whose email didn't go out.
-- Files live in the private "order-files" storage bucket (AMBIT staff only).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- The new permission ---------------------------------------
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance']
$$;

-- ---------- New columns -----------------------------------------------
alter table public.orders add column if not exists invoice_no         text;
alter table public.orders add column if not exists notify_override_by text;
alter table public.orders add column if not exists notify_override_at timestamptz;

-- What the customer ordered, kept when a different type is loaded instead.
alter table public.order_items add column if not exists ordered_product_id uuid references public.products(id) on delete set null;
alter table public.order_items add column if not exists ordered_sku        text;
alter table public.order_items add column if not exists ordered_name       text;

-- ---------- Item variance log -----------------------------------------
create table if not exists public.order_variances (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders(id) on delete cascade,
  order_item_id bigint references public.order_items(id) on delete cascade,
  kind          text not null,           -- type | lot
  from_text     text,
  to_text       text,
  reason        text,
  stage         text,                    -- where the order was when it changed
  by_id         uuid references public.profiles(id) on delete set null,
  by_name       text,
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.order_variances add constraint order_variances_kind_check check (kind in ('type', 'lot'));
exception when duplicate_object then null; end $$;
create index if not exists order_variances_order_idx on public.order_variances(order_id, created_at);
alter table public.order_variances enable row level security;
drop policy if exists order_variances_read on public.order_variances;
create policy order_variances_read on public.order_variances for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.order_variances from anon, authenticated;
grant select on public.order_variances to authenticated;

-- ---------- Order files: invoices and signed BOLs ----------------------
create table if not exists public.order_files (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  kind             text not null,       -- invoice | bol
  path             text not null unique, -- in the order-files bucket: <order id>/<file>
  name             text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);
do $$ begin
  alter table public.order_files add constraint order_files_kind_check check (kind in ('invoice', 'bol'));
exception when duplicate_object then null; end $$;
create index if not exists order_files_order_idx on public.order_files(order_id, kind);
alter table public.order_files enable row level security;
drop policy if exists order_files_read on public.order_files;
create policy order_files_read on public.order_files for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.order_files from anon, authenticated;
grant select on public.order_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists order_files_obj_read   on storage.objects;
drop policy if exists order_files_obj_insert on storage.objects;
drop policy if exists order_files_obj_delete on storage.objects;
create policy order_files_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'order-files' and public.is_employee());
create policy order_files_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'order-files' and (public.has_perm('order_desk') or public.has_perm('inventory')));
create policy order_files_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'order-files' and public.is_admin());

-- Staff: put an uploaded file on the order (the app uploads it first).
create or replace function public.order_add_file(p_order uuid, p_kind text, p_path text, p_name text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  fid bigint;
begin
  if p_kind = 'invoice' and not public.has_perm('order_desk') then
    raise exception 'Only the order desk can add invoices.';
  elsif p_kind = 'bol' and not (public.has_perm('order_desk') or public.has_perm('inventory')) then
    raise exception 'Only the order desk or the warehouse can add the signed BOL.';
  elsif p_kind not in ('invoice', 'bol') then
    raise exception 'Unknown kind of file.';
  end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'Order not found.'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> p_order::text then raise exception 'That file isn''t in this order''s folder.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'order-files' and name = p_path) then
    raise exception 'The file didn''t finish uploading. Try again.';
  end if;
  insert into public.order_files (order_id, kind, path, name, uploaded_by, uploaded_by_name)
  values (p_order, p_kind, p_path, left(nullif(trim(coalesce(p_name, '')), ''), 200), auth.uid(), public.my_name())
  on conflict (path) do nothing
  returning id into fid;
  return fid;
end $$;

-- ---------- Sales Order # and Invoice # --------------------------------
create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  if coalesce(trim(p_invoice), '') = '' then raise exception 'Enter the Invoice # too.'; end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), invoice_no = left(trim(p_invoice), 60),
         po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- The old one-box version now needs the Invoice # as well.
create or replace function public.order_set_po(p_order uuid, p_po text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.order_set_numbers(p_order, p_po, (select invoice_no from public.orders where id = p_order));
end $$;

-- ---------- Delivered / picked up: the signed BOL first ----------------
create or replace function public.order_complete(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not (public.has_perm('order_desk') or public.has_perm('inventory')) then
    raise exception 'You don''t have access to close orders.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.scheduled_for is null then raise exception 'Schedule the order first.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is already %.', o.status; end if;
  if not exists (select 1 from public.order_files f where f.order_id = p_order and f.kind = 'bol') then
    raise exception 'Add a photo or scan of the signed BOL first.';
  end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order;
end $$;

-- ---------- Scheduled, but the customer couldn't be emailed -------------
create or replace function public.order_notify_override(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.scheduled_for is null then raise exception 'Schedule the order first.'; end if;
  update public.orders
     set notify_status = 'override', notify_error = null,
         notify_override_by = public.my_name(), notify_override_at = now()
   where id = p_order;
end $$;

-- ---------- Picking: a line swapped to another type doesn't count -------
create or replace function public.inventory_pick(p_item bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it    public.order_items;
  o     record;
  cand  uuid[];
  need  numeric;
  take  numeric;
  lot   record;
  first record;
  today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  select id, branch_id, delivery_method, status into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status in ('cancelled', 'completed') then return; end if;
  if not exists (select 1 from public.inventory_sheets x where x.branch_id = o.branch_id and x.enabled) then return; end if;
  if exists (select 1 from public.inventory_lines
              where order_item_id = p_item and not (state = 'cancelled' and done_by = 'swap')) then return; end if;

  -- Two orders at the same moment never get the same drums.
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  if cand is null then cand := array[it.product_id]; end if;

  if exists (select 1 from public.inventory_lots l where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet) then
    need := it.qty;
    for lot in
      select l.id, l.product_id, l.sku, l.lot_no,
             l.remaining - l.sheet_pending
               - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = l.id and x.state = 'reserved'), 0) as avail
        from public.inventory_lots l
        join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
         and (l.use_by is null or l.use_by >= today)
       order by p.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      select l.product_id, l.sku into first
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
       order by p.pick_rank, l.use_by nulls last, l.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, need);
    end if;
  else
    -- No lots here: the item itself (or, for ISO A-Side, the first brand this branch stocks).
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;  -- not stocked at this branch: ships from the supplier
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;

-- ---------- Item variance: a different product type ---------------------
-- Same category and unit, active products, and for spray foam the same side (ISO A-Side stays
-- A-Side: its brand is picked by lot; a resin stays a resin). What it was ordered as is kept on the line.
create or replace function public.product_is_a_side(p public.products) returns boolean
language sql immutable as $$
  select coalesce(p.name ilike '%A-Side%' or p.sku ilike 'ISO%', false)
$$;

create or replace function public.order_item_alternatives(p_item bigint)
returns table (product_id uuid, sku text, name text, on_hand numeric, available numeric)
language sql stable security definer set search_path = public as $$
  with it as (select i.*, o.branch_id from public.order_items i join public.orders o on o.id = i.order_id where i.id = p_item),
       cur as (select p.* from public.products p join it on p.id = it.product_id),
       st as (select * from public.stock_for((select branch_id from it)))
  select p.id, p.sku, p.name, st.on_hand, st.net
    from public.products p
    join cur on p.category_id is not distinct from cur.category_id
    join it on lower(p.unit) = lower(it.unit)
    left join st on st.product_id = p.id
   where public.has_perm('item_variance') and p.active and p.id <> cur.id
     and public.product_is_a_side(p) = public.product_is_a_side(cur)
   order by (p.id = (select ordered_product_id from it)) desc, p.name
$$;

create or replace function public.order_item_swap(p_item bigint, p_product uuid, p_reason text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  it   public.order_items;
  o    public.orders;
  np   public.products;
  cur  public.products;
  who  text := coalesce(public.my_name(), 'AMBITION');
  sheet boolean;
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change what''s loaded.';
  end if;
  select * into it from public.order_items where id = p_item for update;
  if it.id is null then raise exception 'That item isn''t on the order any more.'; end if;
  select * into o from public.orders where id = it.order_id for update;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'Wait until the customer approves the order.'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why it''s changing, for example "Out of Summer, loading Winter".';
  end if;
  if it.product_id = p_product then return it.name; end if;
  select * into np from public.products where id = p_product;
  if np.id is null or not np.active then raise exception 'Pick an active product.'; end if;
  select * into cur from public.products where id = it.product_id;
  if cur.id is null or np.category_id is distinct from cur.category_id or lower(np.unit) <> lower(it.unit)
     or public.product_is_a_side(np) <> public.product_is_a_side(cur) then
    raise exception 'Pick a product in the same category, sold by the %.', it.unit;
  end if;
  if exists (select 1 from public.inventory_lines where order_item_id = it.id and state = 'done') then
    raise exception 'Some of this item was already picked up, so it can''t be changed.';
  end if;

  sheet := o.branch_id is not null and exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled);
  if o.branch_id is not null then perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id)); end if;
  -- Let go of what was held for the old type. Lines already on the sheet show as Cancelled there.
  delete from public.inventory_lines where order_item_id = it.id and state = 'reserved' and sheet_row is null;
  update public.inventory_lines
     set state = 'cancelled', done_by = 'swap', needs_write = true, updated_at = now()
   where order_item_id = it.id and state = 'reserved';

  update public.order_items
     set ordered_product_id = case when it.ordered_sku is null then it.product_id else ordered_product_id end,
         ordered_sku  = coalesce(ordered_sku, it.sku),
         ordered_name = coalesce(ordered_name, it.name),
         product_id = np.id, sku = np.sku, name = np.name
   where id = it.id;
  -- Swapped back to what was ordered: no longer a variance.
  update public.order_items set ordered_product_id = null, ordered_sku = null, ordered_name = null
   where id = it.id and upper(ordered_sku) = upper(sku);

  -- Hold the new type (by lot for spray foam).
  perform public.inventory_pick(it.id);

  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, it.id, 'type', it.name || ' (' || it.sku || ')', np.name || ' (' || np.sku || ')', left(trim(p_reason), 500), o.stage, auth.uid(), who);
  if sheet then
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (o.branch_id, 'order', np.sku,
            'ORD-' || o.order_no || ': loading ' || trim_scale(it.qty) || ' ' || np.sku || ' instead of ' || it.sku || ' (' || left(trim(p_reason), 200) || ').', who);
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  end if;
  return np.name;
end $$;

-- ---------- Item variance: a different lot ------------------------------
-- Changing lots is for admins and the Item variance box now.
create or replace function public.inventory_repick(p_line bigint, p_lot bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l     public.inventory_lines;
  lot   public.inventory_lots;
  ok    boolean;
  avail numeric;
  n     bigint;
  who   text := coalesce(public.my_name(), 'AMBITION');
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  select * into l from public.inventory_lines where id = p_line for update;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  if l.state <> 'reserved' then
    raise exception 'This line is already %.', case l.state when 'done' then 'picked up' else 'cancelled' end;
  end if;
  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || l.branch_id));
  select * into lot from public.inventory_lots where id = p_lot;
  if lot.id is null or not lot.on_sheet or lot.branch_id <> l.branch_id then
    raise exception 'That lot isn''t on this location''s FOAM LOTS tab.';
  end if;
  select (lot.product_id = i.product_id or exists (select 1 from public.products p where p.id = lot.product_id and p.stock_of = i.product_id))
    into ok from public.order_items i where i.id = l.order_item_id;
  if not coalesce(ok, false) then raise exception 'That lot is a different product.'; end if;
  avail := lot.remaining - lot.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = lot.id and r.state = 'reserved' and r.id <> l.id), 0);
  if avail < l.qty then
    raise exception 'Lot % only has % available. Pick a lot with at least %.',
      coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(avail, 0)), trim_scale(l.qty);
  end if;
  update public.inventory_lines
     set lot_id = lot.id, lot_no = nullif(lot.lot_no, ''), product_id = lot.product_id,
         prev_sku = case when upper(sku) <> upper(lot.sku) then coalesce(prev_sku, sku) else prev_sku end,
         sku = lot.sku, needs_write = true, updated_at = now()
   where id = l.id;
  select order_no into n from public.orders where id = l.order_id;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (l.branch_id, 'order', lot.sku,
          'ORD-' || n || ': ' || trim_scale(l.qty) || ' moved to lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)')
            || coalesce(' (was ' || coalesce(l.lot_no, 'no lot') || case when upper(l.sku) <> upper(lot.sku) then ', ' || l.sku else '' end || ')', '') || '.',
          who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = l.branch_id;
  return coalesce(nullif(lot.lot_no, ''), '(no lot #)');
end $$;

create or replace function public.order_variance_lot(p_line bigint, p_lot bigint, p_reason text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_lines;
  lot public.inventory_lots;
  o   public.orders;
  res text;
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  select * into l from public.inventory_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  res := public.inventory_repick(p_line, p_lot);
  select * into lot from public.inventory_lots where id = p_lot;
  select * into o from public.orders where id = l.order_id;
  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, l.order_item_id, 'lot',
          trim_scale(l.qty) || ' × ' || l.sku || ' · ' || case when l.lot_id is null then 'no lot picked' else 'Lot ' || coalesce(l.lot_no, '(no lot #)') end,
          trim_scale(l.qty) || ' × ' || lot.sku || ' · Lot ' || res,
          nullif(left(trim(coalesce(p_reason, '')), 500), ''), o.stage, auth.uid(), coalesce(public.my_name(), 'AMBITION'));
  return res;
end $$;

-- ---------- Who can call what ------------------------------------------
revoke all on function public.order_add_file(uuid, text, text, text) from public, anon;
revoke all on function public.order_set_numbers(uuid, text, text) from public, anon;
revoke all on function public.order_notify_override(uuid) from public, anon;
revoke all on function public.order_item_alternatives(bigint) from public, anon;
revoke all on function public.order_item_swap(bigint, uuid, text) from public, anon;
revoke all on function public.order_variance_lot(bigint, bigint, text) from public, anon;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;
grant execute on function public.order_add_file(uuid, text, text, text) to authenticated;
grant execute on function public.order_set_numbers(uuid, text, text) to authenticated;
grant execute on function public.order_notify_override(uuid) to authenticated;
grant execute on function public.order_item_alternatives(bigint) to authenticated;
grant execute on function public.order_item_swap(bigint, uuid, text) to authenticated;
grant execute on function public.order_variance_lot(bigint, bigint, text) to authenticated;

select 'invoice, BOL and item variance ready' as status,
       (select count(*) from public.orders where stage = 'scheduled') as scheduled_orders_needing_a_bol;

-- =====================================================================
-- AMBIT Intelligence update 0026 - One Order Desk, home screen folders
-- * The Order Desk is for all staff: the order desk (CRM), credit approvals, the warehouse and
--   admins see every order; sales reps see the orders they placed (the dashboard too).
-- * Forms and links from Admin > Links can be put in a home screen folder.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.order_desk_stats(p_days int default 30, p_branch text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz     text := 'America/Chicago';
  today  date := (now() at time zone 'America/Chicago')::date;
  d0     date;
  since  timestamptz;
  weekly boolean;
  res    jsonb;
  mine   boolean;
begin
  -- Everyone who works orders sees all of them; a sales rep sees the orders they placed.
  if not public.is_employee() then raise exception 'You don''t have access to the order desk.'; end if;
  mine := not (public.is_admin() or public.has_perm('order_desk') or public.has_perm('credit_check') or public.has_perm('inventory'));
  if mine and not public.has_perm('ordering') then raise exception 'You don''t have access to the order desk.'; end if;
  d0 := case when coalesce(p_days, 30) <= 0 then date_trunc('year', today)::date else today - (least(p_days, 366) - 1) end;
  since := d0::timestamp at time zone tz;
  weekly := coalesce(p_days, 30) <= 0 or p_days > 45;

  with o as (
    select x.*,
           (x.created_at at time zone tz)::date as placed_day
      from public.orders x
     where (p_branch is null
            or (p_branch = 'dropship' and x.branch_id is null)
            or x.branch_id = p_branch)
       and (not mine or x.placed_by = auth.uid())
  ),
  opn as (
    select o.*,
           case o.stage
             when 'customer'  then coalesce(o.approval_sent_at, o.created_at)
             when 'needs_po'  then coalesce(o.approved_at, o.created_at)
             when 'credit'    then coalesce(o.po_at, o.created_at)
             when 'hold'      then coalesce(o.credit_at, o.created_at)
             when 'schedule'  then coalesce(o.credit_at, o.created_at)
             when 'scheduled' then case when o.scheduled_for < today then (o.scheduled_for + 1)::timestamp at time zone tz end
           end as waiting_since
      from o
     where o.stage not in ('completed', 'cancelled')
  ),
  buckets as (
    select g::date as d
      from generate_series(
             case when weekly then date_trunc('week', d0)::date else d0 end,
             today,
             case when weekly then interval '1 week' else interval '1 day' end) g
  ),
  steps as (
    select 'customer' as k, extract(epoch from approved_at - approval_sent_at) / 3600.0 as h
      from o where approval_sent_at is not null and approved_at >= since
    union all
    select 'po', extract(epoch from po_at - coalesce(approved_at, created_at)) / 3600.0
      from o where po_at >= since
    union all
    select 'credit', extract(epoch from credit_at - po_at) / 3600.0
      from o where credit_at >= since and po_at is not null and credit_status in ('approved', 'hold')
    union all
    select 'schedule', extract(epoch from scheduled_at - credit_at) / 3600.0
      from o where scheduled_at >= since and credit_at is not null and credit_status = 'approved'
  )
  select jsonb_build_object(
    'first', d0,
    'since', since,
    'today', today,
    'bucket', case when weekly then 'week' else 'day' end,
    'open', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from opn group by stage) s), '{}'::jsonb),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch', b, 'stage', stage, 'n', n))
                             from (select coalesce(branch_id, 'dropship') as b, stage, count(*) as n from opn group by 1, 2) s), '[]'::jsonb),
    'placed', (select count(*) from o where created_at >= since),
    'completed', (select count(*) from o where status = 'completed' and completed_at >= since),
    'cancelled', (select count(*) from o where status = 'cancelled' and coalesce(cancelled_at, created_at) >= since),
    'series', (select jsonb_agg(jsonb_build_object('d', b.d, 'n',
                 (select count(*) from o
                   where case when weekly then date_trunc('week', o.placed_day)::date else o.placed_day end = b.d
                     and o.placed_day >= d0))
                 order by b.d) from buckets b),
    'steps', coalesce((select jsonb_object_agg(k, jsonb_build_object('n', n, 'avg', round(avg_h::numeric, 2), 'median', round(med_h::numeric, 2)))
                         from (select k, count(*) as n, avg(h) as avg_h, percentile_cont(0.5) within group (order by h) as med_h
                                 from steps where h >= 0 group by k) s), '{}'::jsonb),
    'cycle', (select jsonb_build_object('n', count(*),
                       'avg', round((avg(extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2),
                       'median', round((percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2))
                from o where status = 'completed' and completed_at >= since and completed_at > created_at),
    'stuck', (select count(*) from opn where waiting_since is not null and (stage = 'scheduled' or waiting_since < now() - interval '24 hours')),
    'waiting', coalesce((select jsonb_agg(w) from (
                  select jsonb_build_object('id', id, 'order_no', order_no, 'company', company_name, 'stage', stage,
                                            'branch', branch_id, 'since', waiting_since,
                                            'hours', round((extract(epoch from now() - waiting_since) / 3600.0)::numeric, 1),
                                            'late', stage = 'scheduled', 'scheduled_for', scheduled_for) as w
                    from opn where waiting_since is not null
                   order by waiting_since
                   limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

revoke all on function public.order_desk_stats(int, text) from public, anon;
grant execute on function public.order_desk_stats(int, text) to authenticated;

-- ---------- Home screen folders for Admin > Links ------------------------
alter table public.links add column if not exists folder text;
do $$ begin
  alter table public.links add constraint links_folder_check check (folder is null or folder in ('main', 'sales', 'forms', 'learn', 'admin'));
exception when duplicate_object then null; end $$;

select 'one order desk ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0027 - Home widgets, spot checks, reconciliation, incoming deliveries
-- * Daily inventory spot check: each weekday the app picks one item per location (never the same
--   one twice until every item has had a turn). The warehouse manager counts it from Home; a
--   count that's off waits for an admin to approve before stock changes.
-- * Inventory reconciliation (quarterly): count everything in the app, send it in, an admin
--   approves, and the differences go onto the spreadsheet.
-- * Expected deliveries: incoming trucks with what's on them, on the warehouse calendar;
--   "Received" adds them to stock (spray foam as new lots on FOAM LOTS).
-- * A monthly sales goal per person (Admin > Accounts) for the Sales widget.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Counts: spot checks and reconciliations ---------------------
create table if not exists public.inventory_counts (
  id                bigint generated always as identity primary key,
  branch_id         text not null references public.branches(id) on update cascade on delete cascade,
  kind              text not null,                 -- spot | reconcile
  day               date,                          -- spot: the weekday it's for
  cycle             int not null default 1,        -- spot: every item once per cycle
  status            text not null default 'open',  -- open | matched | submitted | approved | rejected
  started_by_name   text,
  started_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  submitted_by_name text,
  reviewed_at       timestamptz,
  reviewed_by_name  text,
  review_note       text
);
do $$ begin
  alter table public.inventory_counts add constraint inventory_counts_kind_check check (kind in ('spot', 'reconcile'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.inventory_counts add constraint inventory_counts_status_check check (status in ('open', 'matched', 'submitted', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;
create unique index if not exists inventory_counts_spot_day on public.inventory_counts(branch_id, day) where kind = 'spot';
create index if not exists inventory_counts_status_idx on public.inventory_counts(status, branch_id);

create table if not exists public.inventory_count_lines (
  id              bigint generated always as identity primary key,
  count_id        bigint not null references public.inventory_counts(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  sku             text not null,
  name            text,
  unit            text,
  lot_id          bigint references public.inventory_lots(id) on delete set null,
  lot_no          text,
  system_qty      numeric(12,2),     -- what the app had when it was counted
  counted_qty     numeric(12,2),
  counted_at      timestamptz,
  counted_by_name text,
  note            text,
  applied         boolean not null default false
);
create index if not exists inventory_count_lines_count_idx on public.inventory_count_lines(count_id);
create index if not exists inventory_count_lines_product_idx on public.inventory_count_lines(product_id);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
drop policy if exists inventory_counts_read on public.inventory_counts;
drop policy if exists inventory_count_lines_read on public.inventory_count_lines;
create policy inventory_counts_read on public.inventory_counts for select to authenticated using (public.is_employee());
create policy inventory_count_lines_read on public.inventory_count_lines for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.inventory_counts, public.inventory_count_lines from anon, authenticated;
grant select on public.inventory_counts, public.inventory_count_lines to authenticated;

-- ---------- Lots: changes made in the app waiting to go onto FOAM LOTS ----
alter table public.inventory_lots add column if not exists adj_unsynced numeric(12,2) not null default 0;  -- approved count differences -> Adj
alter table public.inventory_lots add column if not exists in_unsynced  numeric(12,2) not null default 0;  -- received in the app -> Shipped In
alter table public.inventory_lots add column if not exists add_to_sheet boolean not null default false;    -- new lot received in the app: add its row

-- The sync wrote Adj or Shipped In: fold what it wrote into the sheet's number.
create or replace function public.inventory_lot_fold(p_lot bigint, p_col text, p_sheet numeric, p_written numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_col = 'adj' then
    update public.inventory_lots set adj = p_sheet + p_written, adj_unsynced = adj_unsynced - p_written, updated_at = now() where id = p_lot;
  elsif p_col = 'in' then
    update public.inventory_lots set shipped_in = p_sheet + p_written, in_unsynced = in_unsynced - p_written, updated_at = now() where id = p_lot;
  end if;
end $$;

-- What the app has for one count line right now (a lot's Remaining, or the item's TOTAL IN STOCK).
create or replace function public.count_system_qty(p_branch text, p_product uuid, p_lot bigint)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_lot is not null then (select remaining from public.inventory_lots where id = p_lot)
              else (select on_hand from public.inventory where branch_id = p_branch and product_id = p_product) end
$$;

-- ---------- Daily spot checks ---------------------------------------------
-- Makes sure every weekday (Central time) up to today has its item. Missed days stay open.
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
       where i.branch_id = p_branch and i.on_sheet
         and (i.on_hand is not null or exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = i.product_id and x.on_sheet))
         and not exists (select 1 from public.inventory_count_lines l join public.inventory_counts k on k.id = l.count_id
                          where k.branch_id = p_branch and k.kind = 'spot' and k.cycle = cyc and l.product_id = i.product_id)
       order by random() limit 1;
      if pid is null then
        -- Every item has had a turn: start the next round.
        cyc := cyc + 1;
        select i.product_id, i.sku, p.name, p.unit into pid, psku, pname, punit
          from public.inventory i join public.products p on p.id = i.product_id
         where i.branch_id = p_branch and i.on_sheet
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

-- A count is sent in: everything matched, or the differences wait for an admin.
create or replace function public.count_finish(p_count bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  off int;
  st  text;
begin
  select count(*) into off from public.inventory_count_lines
   where count_id = p_count and counted_qty is not null and counted_qty is distinct from coalesce(system_qty, 0);
  st := case when off = 0 then 'matched' else 'submitted' end;
  update public.inventory_counts
     set status = st, submitted_at = now(), submitted_by_name = public.my_name()
   where id = p_count and status = 'open';
  return st;
end $$;

-- Warehouse: one counted number. A spot check is sent in as soon as every line has its count.
create or replace function public.count_line_save(p_line bigint, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_count_lines;
  k   public.inventory_counts;
  sys numeric;
  st  text;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into l from public.inventory_count_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the count any more.'; end if;
  select * into k from public.inventory_counts where id = l.count_id for update;
  if k.status <> 'open' then raise exception 'This count was already sent in.'; end if;
  if p_qty is null then
    -- Cleared: not counted after all.
    update public.inventory_count_lines set counted_qty = null, system_qty = null, counted_at = null, counted_by_name = null where id = p_line;
    return jsonb_build_object('status', k.status);
  end if;
  if p_qty < 0 then raise exception 'A count can''t be below zero.'; end if;
  sys := public.count_system_qty(k.branch_id, l.product_id, l.lot_id);
  update public.inventory_count_lines
     set counted_qty = round(p_qty, 2), system_qty = sys, counted_at = now(), counted_by_name = public.my_name(),
         note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_line;
  st := k.status;
  if k.kind = 'spot' and not exists (select 1 from public.inventory_count_lines where count_id = k.id and counted_qty is null) then
    st := public.count_finish(k.id);
  end if;
  return jsonb_build_object('status', st);
end $$;

-- Warehouse: send a reconciliation in (lines left blank aren't changed).
create or replace function public.count_submit(p_count bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  k public.inventory_counts;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status <> 'open' then raise exception 'This count was already sent in.'; end if;
  if not exists (select 1 from public.inventory_count_lines where count_id = p_count and counted_qty is not null) then
    raise exception 'Count at least one item first.';
  end if;
  return public.count_finish(p_count);
end $$;

-- Warehouse or admin: start the quarterly reconciliation (or carry on with the one that's open).
create or replace function public.count_start_reconcile(p_branch text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c bigint;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then
    raise exception 'This location''s inventory isn''t in the app yet.';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile:' || p_branch));
  select id into c from public.inventory_counts where branch_id = p_branch and kind = 'reconcile' and status = 'open' order by id desc limit 1;
  if c is not null then return c; end if;
  insert into public.inventory_counts (branch_id, kind, status, started_by_name) values (p_branch, 'reconcile', 'open', public.my_name()) returning id into c;
  -- Every item on the COUNT SHEET (spray foam lot by lot), in sheet order.
  insert into public.inventory_count_lines (count_id, product_id, sku, name, unit, lot_id, lot_no)
  select c, i.product_id, coalesce(x.sku, i.sku), p.name, p.unit, x.id, nullif(x.lot_no, '')
    from public.inventory i
    join public.products p on p.id = i.product_id
    left join public.inventory_lots x on x.branch_id = i.branch_id and x.product_id = i.product_id and x.on_sheet
   where i.branch_id = p_branch and i.on_sheet
   order by i.sheet_row nulls last, x.use_by nulls last, x.id;
  return c;
end $$;

-- Admin: approve (the differences go into stock and onto the spreadsheet) or reject a count.
create or replace function public.count_review(p_count bigint, p_approve boolean, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k    public.inventory_counts;
  l    record;
  diff numeric;
  n    int := 0;
  who  text := coalesce(public.my_name(), 'AMBITION');
  what text;
  dt   date;
begin
  if not public.is_admin() then raise exception 'Only admins can approve counts.'; end if;
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status <> 'submitted' then raise exception 'This count isn''t waiting for approval.'; end if;
  what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
  if not p_approve then
    update public.inventory_counts set status = 'rejected', reviewed_at = now(), reviewed_by_name = who,
           review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_count;
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (k.branch_id, 'count', what || ' not approved' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '') || '. Stock wasn''t changed.', who);
    return 0;
  end if;
  for l in select * from public.inventory_count_lines where count_id = p_count and counted_qty is not null and not applied loop
    diff := l.counted_qty - coalesce(l.system_qty, 0);
    dt := coalesce((l.counted_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date);
    if l.lot_id is not null then
      if diff <> 0 then
        update public.inventory_lots set adj_unsynced = adj_unsynced + diff, updated_at = now() where id = l.lot_id;
        insert into public.inventory_log (branch_id, kind, sku, message, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': lot ' || coalesce(l.lot_no, '(no lot #)') || ' counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0))
                  || '). Adj on FOAM LOTS ' || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || who || '.',
                coalesce(l.counted_by_name, who));
        n := n + 1;
      end if;
    else
      update public.inventory
         set on_hand = coalesce(on_hand, 0) + diff, last_counted = dt, counted_by = left(coalesce(l.counted_by_name, who), 80),
             count_dirty = true, updated_at = now(), updated_by_name = who
       where branch_id = k.branch_id and product_id = l.product_id;
      if diff <> 0 then
        insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0)) || '), '
                  || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || who || '.',
                l.system_qty, l.counted_qty, coalesce(l.counted_by_name, who));
        n := n + 1;
      end if;
    end if;
    update public.inventory_count_lines set applied = true where id = l.id;
  end loop;
  update public.inventory_counts set status = 'approved', reviewed_at = now(), reviewed_by_name = who,
         review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_count;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = k.branch_id;
  return n;
end $$;

-- ---------- Expected deliveries (incoming trucks) -------------------------
create table if not exists public.inbound_deliveries (
  id               bigint generated always as identity primary key,
  branch_id        text not null references public.branches(id) on update cascade on delete cascade,
  vendor           text not null,
  expected_on      date not null,
  ref              text,                                -- PO #, BOL #, carrier
  note             text,
  status           text not null default 'expected',    -- expected | received | cancelled
  created_by_name  text,
  created_at       timestamptz not null default now(),
  received_at      timestamptz,
  received_by_name text
);
do $$ begin
  alter table public.inbound_deliveries add constraint inbound_status_check check (status in ('expected', 'received', 'cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists inbound_deliveries_day_idx on public.inbound_deliveries(branch_id, expected_on);

create table if not exists public.inbound_lines (
  id           bigint generated always as identity primary key,
  delivery_id  bigint not null references public.inbound_deliveries(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  sku          text not null,
  name         text,
  unit         text,
  qty          numeric(12,2) not null,
  received_qty numeric(12,2),
  lot_no       text,
  mfg          date,
  exp          date
);
create index if not exists inbound_lines_delivery_idx on public.inbound_lines(delivery_id);

alter table public.inbound_deliveries enable row level security;
alter table public.inbound_lines enable row level security;
drop policy if exists inbound_deliveries_read on public.inbound_deliveries;
drop policy if exists inbound_lines_read on public.inbound_lines;
create policy inbound_deliveries_read on public.inbound_deliveries for select to authenticated using (public.is_employee());
create policy inbound_lines_read on public.inbound_lines for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.inbound_deliveries, public.inbound_lines from anon, authenticated;
grant select on public.inbound_deliveries, public.inbound_lines to authenticated;

-- Add or change an expected delivery. p_lines: [{"product_id": "...", "qty": 4}]
create or replace function public.inbound_save(p_id bigint, p_branch text, p_vendor text, p_expected date, p_ref text, p_note text, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    public.inbound_deliveries;
  v_id bigint := p_id;
  ln   jsonb;
  p    public.products;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  if coalesce(trim(p_vendor), '') = '' then raise exception 'Who is it coming from?'; end if;
  if p_expected is null then raise exception 'Pick the day it''s expected.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if v_id is null then
    if not exists (select 1 from public.branches b where b.id = p_branch) then raise exception 'Pick the location.'; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, note, created_by_name)
    values (p_branch, left(trim(p_vendor), 120), p_expected, nullif(left(trim(coalesce(p_ref, '')), 120), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''), public.my_name())
    returning inbound_deliveries.id into v_id;
  else
    select * into d from public.inbound_deliveries where inbound_deliveries.id = p_id for update;
    if d.id is null then raise exception 'Delivery not found.'; end if;
    if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
    update public.inbound_deliveries
       set vendor = left(trim(p_vendor), 120), expected_on = p_expected, ref = nullif(left(trim(coalesce(p_ref, '')), 120), ''),
           note = nullif(left(trim(coalesce(p_note, '')), 500), '')
     where inbound_deliveries.id = p_id;
    delete from public.inbound_lines where delivery_id = p_id;
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where products.id = (ln ->> 'product_id')::uuid;
    if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
    if coalesce((ln ->> 'qty')::numeric, 0) <= 0 then raise exception 'Enter how many % are coming.', p.sku; end if;
    insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty)
    values (v_id, p.id, p.sku, p.name, p.unit, round((ln ->> 'qty')::numeric, 2));
  end loop;
  return v_id;
end $$;

create or replace function public.inbound_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  update public.inbound_deliveries set status = 'cancelled' where id = p_id and status = 'expected';
end $$;

-- Received. p_lines: [{"id": 12, "received_qty": 4, "lot_no": "PA123", "mfg": "2026-10-01", "exp": "2027-10-01"}]
-- Items counted by lot (spray foam) need a lot #: a new lot goes onto FOAM LOTS, a lot already there gets Shipped In.
create or replace function public.inbound_receive(p_id bigint, p_lines jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d   public.inbound_deliveries;
  ln  jsonb;
  l   public.inbound_lines;
  q   numeric;
  lot public.inventory_lots;
  ln_lot text;
  who text := coalesce(public.my_name(), 'AMBITION');
  b   numeric;
  n   int := 0;
  lotted boolean;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = p_id;
    if l.id is null then continue; end if;
    q := round(coalesce((ln ->> 'received_qty')::numeric, l.qty), 2);
    if q < 0 then raise exception 'Received can''t be below zero (%).', l.sku; end if;
    ln_lot := nullif(upper(trim(coalesce(ln ->> 'lot_no', ''))), '');
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    update public.inbound_lines
       set received_qty = q, lot_no = ln_lot, mfg = nullif(ln ->> 'mfg', '')::date, exp = nullif(ln ->> 'exp', '')::date
     where id = l.id;
    if q = 0 then continue; end if;
    if lotted then
      if ln_lot is null then raise exception 'Enter the lot # for % (spray foam is tracked by lot).', l.sku; end if;
      select * into lot from public.inventory_lots where branch_id = d.branch_id and product_id = l.product_id and upper(lot_no) = ln_lot;
      if lot.id is not null then
        update public.inventory_lots set in_unsynced = in_unsynced + q, updated_at = now() where id = lot.id;
      else
        insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
        values (d.branch_id, l.product_id, l.sku, ln_lot, nullif(ln ->> 'mfg', '')::date, nullif(ln ->> 'exp', '')::date, q,
                l.name, 'Received in the app from ' || d.vendor, false, true, 100000);
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || d.vendor || ', lot ' || ln_lot || ' (goes onto FOAM LOTS).', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + q, updated_at = now(), updated_by_name = who
       where branch_id = d.branch_id and product_id = l.product_id
      returning on_hand - q into b;
      if not found then
        raise exception '% isn''t on this location''s inventory sheet. Add it to the COUNT SHEET first.', l.sku;
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || d.vendor || '.', b, b + q, who);
    end if;
    n := n + 1;
  end loop;
  update public.inbound_deliveries set status = 'received', received_at = now(), received_by_name = who where id = p_id;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = d.branch_id;
  return n;
end $$;

-- ---------- Sales goal (Sales widget) -------------------------------------
alter table public.profiles add column if not exists monthly_goal numeric(12,2);
create or replace function public.admin_set_goal(p_user uuid, p_goal numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can set sales goals.'; end if;
  if p_goal is not null and p_goal < 0 then raise exception 'A goal can''t be below zero.'; end if;
  update public.profiles set monthly_goal = nullif(round(p_goal, 2), 0) where id = p_user;
end $$;

-- ---------- Who can call what ---------------------------------------------
revoke all on function public.inventory_lot_fold(bigint, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.inventory_lot_fold(bigint, text, numeric, numeric) to service_role;
revoke all on function public.count_system_qty(text, uuid, bigint) from public, anon;
revoke all on function public.count_finish(bigint) from public, anon, authenticated;
revoke all on function public.spot_check_ensure(text) from public, anon;
revoke all on function public.count_line_save(bigint, numeric, text) from public, anon;
revoke all on function public.count_submit(bigint) from public, anon;
revoke all on function public.count_start_reconcile(text) from public, anon;
revoke all on function public.count_review(bigint, boolean, text) from public, anon;
revoke all on function public.inbound_save(bigint, text, text, date, text, text, jsonb) from public, anon;
revoke all on function public.inbound_cancel(bigint) from public, anon;
revoke all on function public.inbound_receive(bigint, jsonb) from public, anon;
revoke all on function public.admin_set_goal(uuid, numeric) from public, anon;
grant execute on function public.count_system_qty(text, uuid, bigint) to authenticated;
grant execute on function public.spot_check_ensure(text) to authenticated;
grant execute on function public.count_line_save(bigint, numeric, text) to authenticated;
grant execute on function public.count_submit(bigint) to authenticated;
grant execute on function public.count_start_reconcile(text) to authenticated;
grant execute on function public.count_review(bigint, boolean, text) to authenticated;
grant execute on function public.inbound_save(bigint, text, text, date, text, text, jsonb) to authenticated;
grant execute on function public.inbound_cancel(bigint) to authenticated;
grant execute on function public.inbound_receive(bigint, jsonb) to authenticated;
grant execute on function public.admin_set_goal(uuid, numeric) to authenticated;

select 'home widgets, counts and incoming deliveries ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0028 - Sales reps, invoice prices, sales goals by category
-- * Each customer can have a sales rep (Admin > Customers). Every order credits the customer's
--   rep (set when it's placed; orders placed before a rep was assigned get them when one is).
--   Sales reps see their customers' orders on the Order desk too.
-- * The order desk enters the invoice prices (required for spray foam, fiberglass and anything
--   else priced per customer) with the Sales Order # and Invoice #. Order totals use them.
-- * Monthly sales goals per person in 8 groups (Admin > Sales goals). Sales reps are measured
--   on their customers' orders, warehouse managers on everything from their location.
--   Each product category belongs to a group (Admin > Products > Categories).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Sales rep on customers and orders ---------------------------
-- No foreign keys to profiles here: a second companies<->profiles link would confuse the app's lookups.
alter table public.companies add column if not exists sales_rep_id uuid;
alter table public.orders    add column if not exists sales_rep_id uuid;
create index if not exists companies_sales_rep_idx on public.companies (sales_rep_id);
create index if not exists orders_sales_rep_idx on public.orders (sales_rep_id, created_at);

-- An order credits its customer's rep (and the new customer's rep if the order is moved to another customer).
create or replace function public.orders_set_rep()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.sales_rep_id is null and new.company_id is not null then
      select c.sales_rep_id into new.sales_rep_id from public.companies c where c.id = new.company_id;
    end if;
  elsif new.company_id is distinct from old.company_id then
    new.sales_rep_id := (select c.sales_rep_id from public.companies c where c.id = new.company_id);
  end if;
  return new;
end $$;
drop trigger if exists orders_set_rep on public.orders;
create trigger orders_set_rep before insert or update of company_id on public.orders
  for each row execute function public.orders_set_rep();

-- A customer gets a rep: their orders that had nobody get that rep too (orders already credited stay put).
create or replace function public.companies_rep_fill()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sales_rep_id is not null and new.sales_rep_id is distinct from old.sales_rep_id then
    update public.orders set sales_rep_id = new.sales_rep_id where company_id = new.id and sales_rep_id is null;
  end if;
  return new;
end $$;
drop trigger if exists companies_rep_fill on public.companies;
create trigger companies_rep_fill after update of sales_rep_id on public.companies
  for each row execute function public.companies_rep_fill();

-- Reps see their customers' orders on the Order desk dashboard as well as the ones they placed.
create or replace function public.order_desk_stats(p_days int default 30, p_branch text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz     text := 'America/Chicago';
  today  date := (now() at time zone 'America/Chicago')::date;
  d0     date;
  since  timestamptz;
  weekly boolean;
  res    jsonb;
  mine   boolean;
begin
  -- Everyone who works orders sees all of them; a sales rep sees the orders they placed and their customers' orders.
  if not public.is_employee() then raise exception 'You don''t have access to the order desk.'; end if;
  mine := not (public.is_admin() or public.has_perm('order_desk') or public.has_perm('credit_check') or public.has_perm('inventory'));
  if mine and not public.has_perm('ordering') then raise exception 'You don''t have access to the order desk.'; end if;
  d0 := case when coalesce(p_days, 30) <= 0 then date_trunc('year', today)::date else today - (least(p_days, 366) - 1) end;
  since := d0::timestamp at time zone tz;
  weekly := coalesce(p_days, 30) <= 0 or p_days > 45;

  with o as (
    select x.*,
           (x.created_at at time zone tz)::date as placed_day
      from public.orders x
     where (p_branch is null
            or (p_branch = 'dropship' and x.branch_id is null)
            or x.branch_id = p_branch)
       and (not mine or x.placed_by = auth.uid() or x.sales_rep_id = auth.uid())
  ),
  opn as (
    select o.*,
           case o.stage
             when 'customer'  then coalesce(o.approval_sent_at, o.created_at)
             when 'needs_po'  then coalesce(o.approved_at, o.created_at)
             when 'credit'    then coalesce(o.po_at, o.created_at)
             when 'hold'      then coalesce(o.credit_at, o.created_at)
             when 'schedule'  then coalesce(o.credit_at, o.created_at)
             when 'scheduled' then case when o.scheduled_for < today then (o.scheduled_for + 1)::timestamp at time zone tz end
           end as waiting_since
      from o
     where o.stage not in ('completed', 'cancelled')
  ),
  buckets as (
    select g::date as d
      from generate_series(
             case when weekly then date_trunc('week', d0)::date else d0 end,
             today,
             case when weekly then interval '1 week' else interval '1 day' end) g
  ),
  steps as (
    select 'customer' as k, extract(epoch from approved_at - approval_sent_at) / 3600.0 as h
      from o where approval_sent_at is not null and approved_at >= since
    union all
    select 'po', extract(epoch from po_at - coalesce(approved_at, created_at)) / 3600.0
      from o where po_at >= since
    union all
    select 'credit', extract(epoch from credit_at - po_at) / 3600.0
      from o where credit_at >= since and po_at is not null and credit_status in ('approved', 'hold')
    union all
    select 'schedule', extract(epoch from scheduled_at - credit_at) / 3600.0
      from o where scheduled_at >= since and credit_at is not null and credit_status = 'approved'
  )
  select jsonb_build_object(
    'first', d0,
    'since', since,
    'today', today,
    'bucket', case when weekly then 'week' else 'day' end,
    'open', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from opn group by stage) s), '{}'::jsonb),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch', b, 'stage', stage, 'n', n))
                             from (select coalesce(branch_id, 'dropship') as b, stage, count(*) as n from opn group by 1, 2) s), '[]'::jsonb),
    'placed', (select count(*) from o where created_at >= since),
    'completed', (select count(*) from o where status = 'completed' and completed_at >= since),
    'cancelled', (select count(*) from o where status = 'cancelled' and coalesce(cancelled_at, created_at) >= since),
    'series', (select jsonb_agg(jsonb_build_object('d', b.d, 'n',
                 (select count(*) from o
                   where case when weekly then date_trunc('week', o.placed_day)::date else o.placed_day end = b.d
                     and o.placed_day >= d0))
                 order by b.d) from buckets b),
    'steps', coalesce((select jsonb_object_agg(k, jsonb_build_object('n', n, 'avg', round(avg_h::numeric, 2), 'median', round(med_h::numeric, 2)))
                         from (select k, count(*) as n, avg(h) as avg_h, percentile_cont(0.5) within group (order by h) as med_h
                                 from steps where h >= 0 group by k) s), '{}'::jsonb),
    'cycle', (select jsonb_build_object('n', count(*),
                       'avg', round((avg(extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2),
                       'median', round((percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2))
                from o where status = 'completed' and completed_at >= since and completed_at > created_at),
    'stuck', (select count(*) from opn where waiting_since is not null and (stage = 'scheduled' or waiting_since < now() - interval '24 hours')),
    'waiting', coalesce((select jsonb_agg(w) from (
                  select jsonb_build_object('id', id, 'order_no', order_no, 'company', company_name, 'stage', stage,
                                            'branch', branch_id, 'since', waiting_since,
                                            'hours', round((extract(epoch from now() - waiting_since) / 3600.0)::numeric, 1),
                                            'late', stage = 'scheduled', 'scheduled_for', scheduled_for) as w
                    from opn where waiting_since is not null
                   order by waiting_since
                   limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ---------- Invoice prices with the Sales Order # -----------------------
alter table public.orders add column if not exists priced_at      timestamptz;
alter table public.orders add column if not exists priced_by_name text;

-- p_prices: [{"id": <order_items.id>, "price": <price each>}]. Every line needs a price once this is saved
-- (spray foam, fiberglass and other customer-priced lines have none until the order desk enters it).
drop function if exists public.order_set_numbers(uuid, text, text);
create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text, p_prices jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  e    jsonb;
  pr   numeric;
  miss text;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  if coalesce(trim(p_invoice), '') = '' then raise exception 'Enter the Invoice # too.'; end if;
  if p_prices is not null then
    if jsonb_typeof(p_prices) <> 'array' then raise exception 'Prices are missing.'; end if;
    for e in select * from jsonb_array_elements(p_prices) loop
      if coalesce(e->>'price', '') = '' then continue; end if;
      begin
        pr := round((e->>'price')::numeric, 2);
      exception when others then
        raise exception 'A price isn''t a number: %', e->>'price';
      end;
      if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
      update public.order_items
         set unit_price = pr, line_total = round(pr * qty, 2)
       where id = (e->>'id')::bigint and order_id = p_order;
    end loop;
    select string_agg(i.sku, ', ' order by i.id) into miss
      from public.order_items i where i.order_id = p_order and i.unit_price is null;
    if miss is not null then raise exception 'Enter the price for %.', miss; end if;
    update public.orders
       set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
           priced_at = now(), priced_by_name = public.my_name()
     where id = p_order;
  end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), invoice_no = left(trim(p_invoice), 60),
         po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- ---------- Sales goals by category ------------------------------------
-- The 8 groups: foam, fiberglass, ppe, roof, guns, intumescent, sealants, supplies (everything else).
alter table public.categories add column if not exists goal_group text;
do $$ begin
  alter table public.categories add constraint categories_goal_group_check
    check (goal_group is null or goal_group in ('foam', 'fiberglass', 'ppe', 'roof', 'guns', 'intumescent', 'sealants', 'supplies'));
exception when duplicate_object then null; end $$;
update public.categories set goal_group = case id
    when 'ambit-foam' then 'foam'
    when 'spray-foam' then 'foam'
    when 'guns-parts' then 'guns'
    when 'fiberglass' then 'fiberglass'
    when 'personal-protective-equipment' then 'ppe'
    when 'roof-coatings-and-sealants' then 'roof'
    when 'guns-and-parts' then 'guns'
    when 'intumescent-coatings' then 'intumescent'
    when 'sealants-adhesives' then 'sealants'
    else 'supplies' end
 where goal_group is null;

create table if not exists public.sales_goals (
  person_id       uuid not null references public.profiles(id) on delete cascade,
  goal_group      text not null check (goal_group in ('foam', 'fiberglass', 'ppe', 'roof', 'guns', 'intumescent', 'sealants', 'supplies')),
  amount          numeric(12,2) not null check (amount > 0),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  primary key (person_id, goal_group)
);
alter table public.sales_goals enable row level security;
drop policy if exists sales_goals_read on public.sales_goals;
create policy sales_goals_read on public.sales_goals for select to authenticated
  using (public.is_admin() or person_id = auth.uid());

-- Admins: one person's monthly goals, e.g. {"foam": 40000, "fiberglass": 8000}. Blank or 0 = no goal.
create or replace function public.admin_set_sales_goals(p_person uuid, p_goals jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  k   text;
  v   text;
  amt numeric;
  who text := coalesce(public.my_name(), 'AMBIT');
begin
  if not public.is_admin() then raise exception 'Only admins can set sales goals.'; end if;
  if not exists (select 1 from public.profiles where id = p_person and role in ('employee', 'admin')) then
    raise exception 'Goals are for AMBIT staff.';
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_goals, '{}'::jsonb)) loop
    if k not in ('foam', 'fiberglass', 'ppe', 'roof', 'guns', 'intumescent', 'sealants', 'supplies') then
      raise exception 'Unknown goal group: %', k;
    end if;
    amt := nullif(regexp_replace(coalesce(v, ''), '[^0-9.]', '', 'g'), '')::numeric;
    if amt is null or amt = 0 then
      delete from public.sales_goals where person_id = p_person and goal_group = k;
    else
      insert into public.sales_goals (person_id, goal_group, amount, updated_at, updated_by_name)
      values (p_person, k, round(amt, 2), now(), who)
      on conflict (person_id, goal_group) do update set amount = excluded.amount, updated_at = now(), updated_by_name = who;
    end if;
  end loop;
end $$;

-- Progress for one month: what each person sold in each group against their goal. Sales reps count their
-- customers' orders (orders.sales_rep_id); warehouse managers count every order from their location.
-- Orders count in the month they were placed; a line counts once it has a price. Admins see everyone
-- (sales reps, warehouse managers and anyone with goals); others see only themselves.
create or replace function public.sales_goal_board(p_month date default null, p_person uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz  text := 'America/Chicago';
  m0  date := date_trunc('month', coalesce(p_month, (now() at time zone 'America/Chicago')::date))::date;
  t0  timestamptz;
  t1  timestamptz;
  who uuid := p_person;
  res jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.is_admin() then who := auth.uid(); end if;
  t0 := m0::timestamp at time zone tz;
  t1 := (m0 + interval '1 month')::timestamp at time zone tz;
  with people as (
    select p.id, coalesce(nullif(trim(p.full_name), ''), p.email) as name, p.job_role, p.branch_id,
           case when p.job_role = 'warehouse' then 'branch' else 'rep' end as basis
      from public.profiles p
     where p.status = 'active' and p.role in ('employee', 'admin')
       and case when who is not null then p.id = who
                else p.job_role in ('sales_rep', 'warehouse') or exists (select 1 from public.sales_goals g where g.person_id = p.id) end
  ),
  lines as (
    select o.id as order_id, o.sales_rep_id, o.branch_id, coalesce(c.goal_group, 'supplies') as grp, i.line_total
      from public.orders o
      join public.order_items i on i.order_id = o.id
      left join public.products pr on pr.id = i.product_id
      left join public.categories c on c.id = pr.category_id
     where o.status <> 'cancelled' and o.created_at >= t0 and o.created_at < t1
  ),
  mine as (
    select pe.id as person_id, l.*
      from people pe
      join lines l on (pe.basis = 'rep' and l.sales_rep_id = pe.id) or (pe.basis = 'branch' and l.branch_id = pe.branch_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pe.id, 'name', pe.name, 'job_role', pe.job_role, 'branch_id', pe.branch_id, 'basis', pe.basis,
           'goals', coalesce((select jsonb_object_agg(g.goal_group, g.amount) from public.sales_goals g where g.person_id = pe.id), '{}'::jsonb),
           'sold', coalesce((select jsonb_object_agg(x.grp, x.total)
                               from (select m.grp, sum(coalesce(m.line_total, 0)) as total from mine m where m.person_id = pe.id group by m.grp) x), '{}'::jsonb),
           'orders', (select count(distinct m.order_id) from mine m where m.person_id = pe.id),
           'waiting', (select count(distinct m.order_id) from mine m where m.person_id = pe.id and m.line_total is null)
         ) order by pe.basis desc, pe.name), '[]'::jsonb)
    into res
    from people pe;
  return jsonb_build_object('month', m0, 'people', res);
end $$;

-- ---------- Who can call what ------------------------------------------
revoke all on function public.order_desk_stats(int, text) from public, anon;
grant execute on function public.order_desk_stats(int, text) to authenticated;
revoke all on function public.order_set_numbers(uuid, text, text, jsonb) from public, anon;
grant execute on function public.order_set_numbers(uuid, text, text, jsonb) to authenticated;
revoke all on function public.admin_set_sales_goals(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_sales_goals(uuid, jsonb) to authenticated;
revoke all on function public.sales_goal_board(date, uuid) from public, anon;
grant execute on function public.sales_goal_board(date, uuid) to authenticated;

select 'sales reps, invoice prices and sales goals ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0029 - Customizable Home, Outlook cards
-- * Each person can move and hide the cards on their Home screen (Customize). The layout is
--   saved with their profile, so it follows them to every phone and computer.
-- * AMBIT staff can connect their own Outlook (Microsoft 365) to see their inbox and calendar
--   on Home. Each person's Microsoft sign-in is kept where only the app's server can read it.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- {"order": ["spot", "outlook-cal", ...], "hidden": ["tsb", ...]}
alter table public.profiles add column if not exists home_layout jsonb;
grant update (home_layout) on public.profiles to authenticated;

-- One Microsoft (Outlook) connection per person. Row-level security with no policies:
-- only the app's server key can read or write it (never the browser).
create table if not exists public.user_ms_tokens (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  account_email text,
  account_name  text,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  scopes        text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.user_ms_tokens enable row level security;
revoke all on public.user_ms_tokens from anon, authenticated;
grant select, insert, update, delete on public.user_ms_tokens to service_role;

select 'customizable home and outlook cards ready' as status;
-- =====================================================================
-- AMBIT Intelligence update 0030 - ISO priced per foam set
-- AMBIT prices spray foam by the set, so the ISO (A side) going with a closed-cell resin can have a
-- different price from the ISO going with an open-cell resin on the same order. When the order desk
-- enters invoice prices, an ISO line that goes with more than one resin now gets a price for each set:
--   price_parts = [{"with": <resin order item id, or null for extra ISO>, "qty": 12, "price": 1085.00}, ...]
-- The line's line_total is the sum of the sets and unit_price is the average per drum, so totals,
-- sales goals and reports keep working unchanged.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.order_items add column if not exists price_parts jsonb;

create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text, p_prices jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  it    public.order_items;
  e     jsonb;
  pt    jsonb;
  pr    numeric;
  pq    numeric;
  tot   numeric;
  n     numeric;
  parts jsonb;
  miss  text;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  if coalesce(trim(p_invoice), '') = '' then raise exception 'Enter the Invoice # too.'; end if;
  if p_prices is not null then
    if jsonb_typeof(p_prices) <> 'array' then raise exception 'Prices are missing.'; end if;
    for e in select * from jsonb_array_elements(p_prices) loop
      -- An ISO line priced per foam set: {"id": 12, "parts": [{"with": 34, "qty": 12, "price": 1085}, ...]}
      if jsonb_typeof(e->'parts') = 'array' and jsonb_array_length(e->'parts') > 0 then
        select * into it from public.order_items where id = (e->>'id')::bigint and order_id = p_order;
        if it.id is null then continue; end if;
        tot := 0; n := 0; parts := '[]'::jsonb;
        for pt in select * from jsonb_array_elements(e->'parts') loop
          if coalesce(pt->>'price', '') = '' then raise exception 'Enter every ISO price for %.', it.sku; end if;
          begin
            pr := round((pt->>'price')::numeric, 2);
            pq := (pt->>'qty')::numeric;
          exception when others then
            raise exception 'A price isn''t a number: %', pt->>'price';
          end;
          if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
          if pq is null or pq <= 0 then raise exception 'The % split isn''t right. Reload the page and try again.', it.sku; end if;
          tot := tot + round(pr * pq, 2);
          n := n + pq;
          parts := parts || jsonb_build_array(jsonb_build_object(
            'with', case when jsonb_typeof(pt->'with') = 'number' then (pt->>'with')::bigint end,
            'qty', pq,
            'price', pr));
        end loop;
        if n <> it.qty then
          raise exception 'The % prices cover % drums but the order has %. Reload the page and try again.', it.sku, trim_scale(n), trim_scale(it.qty);
        end if;
        update public.order_items
           set unit_price = round(tot / it.qty, 2), line_total = tot, price_parts = parts
         where id = it.id;
        continue;
      end if;
      if coalesce(e->>'price', '') = '' then continue; end if;
      begin
        pr := round((e->>'price')::numeric, 2);
      exception when others then
        raise exception 'A price isn''t a number: %', e->>'price';
      end;
      if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
      update public.order_items
         set unit_price = pr, line_total = round(pr * qty, 2), price_parts = null
       where id = (e->>'id')::bigint and order_id = p_order;
    end loop;
    select string_agg(i.sku, ', ' order by i.id) into miss
      from public.order_items i where i.order_id = p_order and i.unit_price is null;
    if miss is not null then raise exception 'Enter the price for %.', miss; end if;
    update public.orders
       set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
           priced_at = now(), priced_by_name = public.my_name()
     where id = p_order;
  end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), invoice_no = left(trim(p_invoice), 60),
         po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

revoke all on function public.order_set_numbers(uuid, text, text, jsonb) from public, anon;
grant execute on function public.order_set_numbers(uuid, text, text, jsonb) to authenticated;

select 'ISO priced per foam set ready' as status;
-- =====================================================================
-- AMBIT Intelligence update 0031 - AMBIT-OPS foundation (pilot week 1)
-- AMBIT-OPS is the contractor's own business software inside the app. Each AMBIT customer company can
-- get its own walled-off workspace: its team (owner, office, dispatcher, sales, crew), locations,
-- product library with AMBIT costs, labor rates and defaults, its own customers and properties, a lead
-- pipeline, notes and tasks, and a public website lead form.
-- * A contractor's data is visible only to that contractor's team. AMBIT staff can open a workspace
--   only while the owner has turned on "Let AMBIT help" (or for AMBIT's own demo workspaces), and
--   every visit is logged for the owner to see.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Workspaces live on the customer company ------------------------
alter table public.companies add column if not exists ops_enabled boolean not null default false;
alter table public.companies add column if not exists ops_enabled_at timestamptz;
alter table public.companies add column if not exists ops_demo boolean not null default false;
alter table public.companies add column if not exists ops_settings jsonb not null default '{}'::jsonb;
alter table public.companies add column if not exists ops_logo_path text;
alter table public.companies add column if not exists ops_support_until timestamptz;
alter table public.companies add column if not exists ops_form_token text;
create unique index if not exists companies_ops_form_token_idx on public.companies(ops_form_token) where ops_form_token is not null;

-- Disposable supplies can go on quotes; gun parts and tools can't.
alter table public.categories add column if not exists ops_quotable boolean not null default true;
update public.categories set ops_quotable = false
 where goal_group = 'guns' or id ~* '(^|-)tools?(-|$)';

-- ---------- People ------------------------------------------------------------
alter table public.profiles add column if not exists ops_role text;
do $$ begin
  alter table public.profiles add constraint profiles_ops_role_check
    check (ops_role is null or ops_role in ('owner', 'office', 'dispatcher', 'sales', 'crew_lead', 'crew', 'accounting', 'sub'));
exception when duplicate_object then null; end $$;
alter table public.profiles add column if not exists ops_location_id uuid;
alter table public.profiles add column if not exists ops_workspace uuid;  -- AMBIT staff: the contractor they're helping
alter table public.invites add column if not exists ops_role text;
alter table public.invites add column if not exists ops_location_id uuid;

-- ---------- Who is working in which workspace ---------------------------------
-- The contractor company the signed-in person is working in right now (null = none).
create or replace function public.ops_company() returns uuid
language sql stable security definer set search_path = public as $$
  select case
           when p.role = 'customer' and p.ops_role is not null then
             (select c.id from public.companies c where c.id = p.company_id and c.ops_enabled)
           when p.role in ('employee', 'admin') and p.ops_workspace is not null then
             (select c.id from public.companies c
               where c.id = p.ops_workspace and c.ops_enabled
                 and (c.ops_demo or coalesce(c.ops_support_until, '-infinity'::timestamptz) > now()))
         end
    from public.profiles p
   where p.id = auth.uid() and p.status = 'active'
$$;

-- Their role in it. AMBIT staff helping a contractor act as the owner would (and are logged).
create or replace function public.ops_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.ops_company() is null then null
              when p.role = 'customer' then p.ops_role
              else 'owner' end
    from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.ops_is(variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ops_role() = any(p_roles), false)
$$;

-- ---------- Locations -----------------------------------------------------------
create table if not exists public.ops_locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  address     text,
  phone       text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ops_locations_company_idx on public.ops_locations(company_id);

-- ---------- Product library (what the contractor installs and sells) ------------
-- kind: foam_oc | foam_cc | foam_roof | foam_other | blown | batt | bibs_mesh | removal | air_seal
--       | coating | intumescent | supply | labor | other
create table if not exists public.ops_products (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,  -- AMBIT catalog item
  ambit_skus     text[] not null default '{}',     -- foam sets: the ISO and resin AMBIT SKUs
  kind           text not null,
  name           text not null,
  sku            text,
  unit           text not null default 'each',      -- set | bag | each | pail | drum | gal | roll | sq ft
  cost           numeric(12,2),                     -- per unit
  cost_source    text not null default 'manual',    -- ambit (from their AMBIT invoice) | manual
  cost_note      text,
  yield_bf       numeric(10,1),                     -- foam: board feet per set
  lb_per_set     numeric(10,1),                     -- foam: pounds in one set (A + B)
  r_value        numeric(6,1),
  sqft_per_unit  numeric(12,2),                     -- batts: sq ft per bag
  coverage       jsonb,                             -- blown: manufacturer coverage chart (week 2)
  waste_pct      numeric(5,1) not null default 10,
  price          numeric(12,4),                     -- sell price per price_unit
  price_unit     text,                              -- bf | sqft | each | bag | set
  active         boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ops_products_company_idx on public.ops_products(company_id, kind, sort);

-- ---------- Customers, properties, leads --------------------------------------------
create table if not exists public.ops_customers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  kind          text not null default 'person' check (kind in ('person', 'company')),
  name          text not null,                   -- what everyone sees: "Jane Smith" or "Smith Homes"
  first_name    text,
  last_name     text,
  company_name  text,
  email         text,
  phone         text,
  phone2        text,
  notes         text,
  source        text,
  price_level   text not null default 'retail' check (price_level in ('retail', 'builder')),
  tax_exempt    boolean not null default false,
  import_batch  uuid,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ops_customers_company_idx on public.ops_customers(company_id, name);
create index if not exists ops_customers_phone_idx on public.ops_customers(company_id, (regexp_replace(coalesce(phone, ''), '\D', '', 'g')));
create index if not exists ops_customers_email_idx on public.ops_customers(company_id, lower(email));

create table if not exists public.ops_properties (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  customer_id  uuid not null references public.ops_customers(id) on delete cascade,
  label        text,                              -- "Home", "Lot 12", "Shop"
  street       text,
  city         text,
  state        text,
  zip          text,
  notes        text,
  gate_code    text,
  created_at   timestamptz not null default now()
);
create index if not exists ops_properties_customer_idx on public.ops_properties(customer_id);

create table if not exists public.ops_leads (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  number            int,
  customer_id       uuid not null references public.ops_customers(id) on delete cascade,
  property_id       uuid references public.ops_properties(id) on delete set null,
  location_id       uuid references public.ops_locations(id) on delete set null,
  title             text,
  stage             text not null default 'new',
  source            text,
  services          text[] not null default '{}',
  rep_id            uuid,
  value_est         numeric(12,2),
  notes             text,
  next_at           date,
  lost_reason       text,
  stage_changed_at  timestamptz not null default now(),
  won_at            timestamptz,
  lost_at           timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ops_leads_lost_reason check (stage <> 'lost' or coalesce(trim(lost_reason), '') <> '')
);
create index if not exists ops_leads_company_idx on public.ops_leads(company_id, stage);
create index if not exists ops_leads_customer_idx on public.ops_leads(customer_id);

-- Notes, calls, tasks and stage changes on a lead or a customer.
create table if not exists public.ops_notes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  lead_id          uuid references public.ops_leads(id) on delete cascade,
  customer_id      uuid references public.ops_customers(id) on delete cascade,
  kind             text not null default 'note' check (kind in ('note', 'call', 'email', 'text', 'task', 'stage', 'system')),
  body             text not null,
  due_on           date,
  done_at          timestamptz,
  assigned_to      uuid,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now()
);
create index if not exists ops_notes_lead_idx on public.ops_notes(lead_id, created_at);
create index if not exists ops_notes_customer_idx on public.ops_notes(customer_id, created_at);
create index if not exists ops_notes_tasks_idx on public.ops_notes(company_id, assigned_to) where kind = 'task' and done_at is null;

-- Per-workspace running numbers (lead #1001 ...).
create table if not exists public.ops_counters (
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null,
  n           int not null,
  primary key (company_id, kind)
);

-- AMBIT staff visits to a contractor's workspace.
create table if not exists public.ops_support_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  staff_id    uuid,
  staff_name  text,
  action      text not null default 'opened',
  at          timestamptz not null default now()
);
create index if not exists ops_support_log_company_idx on public.ops_support_log(company_id, at desc);

-- ---------- Row-level security: each workspace is walled off -------------------------
alter table public.ops_locations   enable row level security;
alter table public.ops_products    enable row level security;
alter table public.ops_customers   enable row level security;
alter table public.ops_properties  enable row level security;
alter table public.ops_leads       enable row level security;
alter table public.ops_notes       enable row level security;
alter table public.ops_counters    enable row level security;
alter table public.ops_support_log enable row level security;

drop policy if exists ops_locations_read  on public.ops_locations;
drop policy if exists ops_locations_write on public.ops_locations;
create policy ops_locations_read on public.ops_locations for select to authenticated
  using (company_id = public.ops_company());
create policy ops_locations_write on public.ops_locations for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office'));

drop policy if exists ops_products_read  on public.ops_products;
drop policy if exists ops_products_write on public.ops_products;
-- Costs and prices: never crews or subs (they get product names through their work orders).
create policy ops_products_read on public.ops_products for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales', 'accounting'));
create policy ops_products_write on public.ops_products for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office'));

-- Customers and properties: the office, dispatch, sales and accounting (not crews).
drop policy if exists ops_customers_read   on public.ops_customers;
drop policy if exists ops_customers_insert on public.ops_customers;
drop policy if exists ops_customers_update on public.ops_customers;
drop policy if exists ops_customers_delete on public.ops_customers;
create policy ops_customers_read on public.ops_customers for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales', 'accounting'));
create policy ops_customers_insert on public.ops_customers for insert to authenticated
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'));
create policy ops_customers_update on public.ops_customers for update to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'))
  with check (company_id = public.ops_company());
create policy ops_customers_delete on public.ops_customers for delete to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office'));

drop policy if exists ops_properties_read   on public.ops_properties;
drop policy if exists ops_properties_insert on public.ops_properties;
drop policy if exists ops_properties_update on public.ops_properties;
drop policy if exists ops_properties_delete on public.ops_properties;
create policy ops_properties_read on public.ops_properties for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales', 'accounting'));
create policy ops_properties_insert on public.ops_properties for insert to authenticated
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'));
create policy ops_properties_update on public.ops_properties for update to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'))
  with check (company_id = public.ops_company());
create policy ops_properties_delete on public.ops_properties for delete to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office'));

-- Leads: owner, office, dispatch and accounting see all; a sales rep sees the ones that are theirs.
drop policy if exists ops_leads_read   on public.ops_leads;
drop policy if exists ops_leads_insert on public.ops_leads;
drop policy if exists ops_leads_update on public.ops_leads;
drop policy if exists ops_leads_delete on public.ops_leads;
create policy ops_leads_read on public.ops_leads for select to authenticated
  using (company_id = public.ops_company()
         and (public.ops_is('owner', 'office', 'dispatcher', 'accounting')
              or (public.ops_is('sales') and (rep_id = auth.uid() or created_by = auth.uid()))));
create policy ops_leads_insert on public.ops_leads for insert to authenticated
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'));
create policy ops_leads_update on public.ops_leads for update to authenticated
  using (company_id = public.ops_company()
         and (public.ops_is('owner', 'office', 'dispatcher')
              or (public.ops_is('sales') and (rep_id = auth.uid() or created_by = auth.uid()))))
  with check (company_id = public.ops_company());
create policy ops_leads_delete on public.ops_leads for delete to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office'));

-- Notes follow what they're attached to: a rep never sees notes on someone else's lead.
drop policy if exists ops_notes_read   on public.ops_notes;
drop policy if exists ops_notes_insert on public.ops_notes;
drop policy if exists ops_notes_update on public.ops_notes;
drop policy if exists ops_notes_delete on public.ops_notes;
create policy ops_notes_read on public.ops_notes for select to authenticated
  using (company_id = public.ops_company()
         and public.ops_is('owner', 'office', 'dispatcher', 'sales', 'accounting')
         and (lead_id is null or exists (select 1 from public.ops_leads l where l.id = lead_id)));
create policy ops_notes_insert on public.ops_notes for insert to authenticated
  with check (company_id = public.ops_company()
              and public.ops_is('owner', 'office', 'dispatcher', 'sales')
              and created_by = auth.uid()
              and (lead_id is null or exists (select 1 from public.ops_leads l where l.id = lead_id)));
create policy ops_notes_update on public.ops_notes for update to authenticated
  using (company_id = public.ops_company()
         and (created_by = auth.uid() or assigned_to = auth.uid() or public.ops_is('owner', 'office')))
  with check (company_id = public.ops_company());
create policy ops_notes_delete on public.ops_notes for delete to authenticated
  using (company_id = public.ops_company() and (created_by = auth.uid() or public.ops_is('owner', 'office')));

-- Counters and the support log: read through the functions below only (owner reads the log).
drop policy if exists ops_support_log_read on public.ops_support_log;
create policy ops_support_log_read on public.ops_support_log for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner') or public.is_admin());

-- Teammates can see each other (names for reps and crews).
drop policy if exists profiles_ops_team on public.profiles;
create policy profiles_ops_team on public.profiles for select to authenticated
  using (role = 'customer' and company_id is not null and company_id = public.ops_company());

-- The owner and office see their own pending invites.
drop policy if exists invites_ops_read on public.invites;
create policy invites_ops_read on public.invites for select to authenticated
  using (role = 'customer' and company_id = public.ops_company() and public.ops_is('owner', 'office'));

-- ---------- Housekeeping triggers --------------------------------------------------------
create or replace function public.ops_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ops_products_touch on public.ops_products;
create trigger ops_products_touch before update on public.ops_products for each row execute function public.ops_touch();
drop trigger if exists ops_customers_touch on public.ops_customers;
create trigger ops_customers_touch before update on public.ops_customers for each row execute function public.ops_touch();

create or replace function public.ops_next(p_company uuid, p_kind text, p_start int default 1001) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.ops_counters (company_id, kind, n) values (p_company, p_kind, p_start)
  on conflict (company_id, kind) do update set n = public.ops_counters.n + 1
  returning n into v;
  return v;
end $$;
revoke all on function public.ops_next(uuid, text, int) from public, anon, authenticated;

-- A lead gets its number, and every stage change is written on its timeline.
create or replace function public.ops_leads_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce(public.my_name(), 'Website form');
begin
  if tg_op = 'INSERT' then
    new.number := coalesce(new.number, public.ops_next(new.company_id, 'lead'));
    new.stage_changed_at := now();
    if new.stage = 'won' then new.won_at := now(); end if;
    return new;
  end if;
  new.updated_at := now();
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    new.won_at := case when new.stage = 'won' then coalesce(old.won_at, now()) end;
    new.lost_at := case when new.stage = 'lost' then now() end;
    if new.stage <> 'lost' then new.lost_reason := null; end if;
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by, created_by_name)
    values (new.company_id, new.id, new.customer_id, 'stage',
            old.stage || '>' || new.stage || case when new.stage = 'lost' then ':' || coalesce(new.lost_reason, '') else '' end,
            auth.uid(), who);
  end if;
  return new;
end $$;
drop trigger if exists ops_leads_stamp_ins on public.ops_leads;
create trigger ops_leads_stamp_ins before insert on public.ops_leads for each row execute function public.ops_leads_stamp();
drop trigger if exists ops_leads_stamp_upd on public.ops_leads;
create trigger ops_leads_stamp_upd before update on public.ops_leads for each row execute function public.ops_leads_stamp();

-- ---------- AMBIT admins turn a workspace on -----------------------------------------------
-- p_products: the starting product library, built by the app from AMBIT's catalog and the customer's
-- own AMBIT invoice prices. Only added when the workspace has no products yet.
create or replace function public.admin_ops_enable(p_company uuid, p_on boolean, p_demo boolean, p_settings jsonb, p_products jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.companies;
  e jsonb;
  i int := 0;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can turn AMBIT-OPS on or off.'; end if;
  select * into c from public.companies where id = p_company for update;
  if c.id is null then raise exception 'Customer not found.'; end if;
  update public.companies
     set ops_enabled = coalesce(p_on, true),
         ops_enabled_at = case when coalesce(p_on, true) then coalesce(ops_enabled_at, now()) else ops_enabled_at end,
         ops_demo = coalesce(p_demo, ops_demo),
         ops_settings = case when ops_settings = '{}'::jsonb then coalesce(p_settings, '{}'::jsonb) else ops_settings end,
         ops_form_token = coalesce(ops_form_token, replace(gen_random_uuid()::text, '-', ''))
   where id = p_company;
  if coalesce(p_on, true) then
    if not exists (select 1 from public.ops_locations where company_id = p_company) then
      insert into public.ops_locations (company_id, name, address, phone)
      values (p_company, 'Main', nullif(trim(coalesce(c.ship_address, c.bill_address, '')), ''), c.phone);
    end if;
    if p_products is not null and jsonb_typeof(p_products) = 'array'
       and not exists (select 1 from public.ops_products where company_id = p_company) then
      for e in select * from jsonb_array_elements(p_products) loop
        i := i + 1;
        insert into public.ops_products (company_id, product_id, ambit_skus, kind, name, sku, unit, cost, cost_source, cost_note,
                                         yield_bf, lb_per_set, r_value, sqft_per_unit, waste_pct, price_unit, active, sort)
        values (p_company,
                nullif(e->>'product_id', '')::uuid,
                coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(e->'ambit_skus', '[]'::jsonb)) x), '{}'),
                e->>'kind', e->>'name', nullif(e->>'sku', ''), coalesce(nullif(e->>'unit', ''), 'each'),
                nullif(e->>'cost', '')::numeric, coalesce(nullif(e->>'cost_source', ''), 'manual'), nullif(e->>'cost_note', ''),
                nullif(e->>'yield_bf', '')::numeric, nullif(e->>'lb_per_set', '')::numeric, nullif(e->>'r_value', '')::numeric,
                nullif(e->>'sqft_per_unit', '')::numeric, coalesce(nullif(e->>'waste_pct', '')::numeric, 10),
                nullif(e->>'price_unit', ''), coalesce((e->>'active')::boolean, true), i);
      end loop;
    end if;
  else
    -- Off: nobody (and no AMBIT helper) can open it until it's turned back on. Nothing is deleted.
    update public.profiles set ops_workspace = null where ops_workspace = p_company;
  end if;
end $$;

-- Make someone the owner (an existing login of that company), or say who's who later from Team.
create or replace function public.admin_ops_set_owner(p_company uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can do this.'; end if;
  update public.profiles set ops_role = 'owner'
   where id = p_user and role = 'customer' and company_id = p_company;
  if not found then raise exception 'That person isn''t a login of this customer.'; end if;
end $$;

-- AMBIT staff open (or leave) a contractor's workspace. Logged for the owner.
create or replace function public.ops_open_workspace(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can open a contractor''s workspace.'; end if;
  if p_company is null then
    update public.profiles set ops_workspace = null where id = auth.uid();
    return;
  end if;
  select * into c from public.companies where id = p_company;
  if c.id is null or not c.ops_enabled then raise exception 'That contractor doesn''t have AMBIT-OPS turned on.'; end if;
  if not c.ops_demo and coalesce(c.ops_support_until, '-infinity'::timestamptz) <= now() then
    raise exception 'The owner hasn''t turned on "Let AMBIT help" for %.', c.name;
  end if;
  update public.profiles set ops_workspace = p_company where id = auth.uid();
  if not c.ops_demo then
    insert into public.ops_support_log (company_id, staff_id, staff_name, action) values (p_company, auth.uid(), public.my_name(), 'opened');
  end if;
end $$;

-- ---------- The owner's controls ----------------------------------------------------------------
create or replace function public.ops_save_settings(p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can change settings.'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Nothing to save.'; end if;
  update public.companies set ops_settings = ops_settings || p_patch where id = public.ops_company();
end $$;

create or replace function public.ops_set_logo(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can change the logo.'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> public.ops_company()::text then raise exception 'That logo isn''t yours.'; end if;
  update public.companies set ops_logo_path = p_path where id = public.ops_company();
end $$;

create or replace function public.ops_set_support(p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_is('owner') then raise exception 'Only the owner can let AMBIT help.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role <> 'customer') then
    raise exception 'Only the contractor''s own owner can change this.';
  end if;
  update public.companies
     set ops_support_until = case when coalesce(p_days, 0) > 0 then now() + make_interval(days => least(p_days, 90)) end
   where id = public.ops_company();
  insert into public.ops_support_log (company_id, staff_id, staff_name, action)
  values (public.ops_company(), auth.uid(), public.my_name(), case when coalesce(p_days, 0) > 0 then 'allowed ' || least(p_days, 90) || ' days' else 'turned off' end);
  if coalesce(p_days, 0) <= 0 then
    update public.profiles set ops_workspace = null where ops_workspace = public.ops_company() and role <> 'customer';
  end if;
end $$;

create or replace function public.ops_new_form_link() returns text
language plpgsql security definer set search_path = public as $$
declare t text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can do this.'; end if;
  update public.companies set ops_form_token = t where id = public.ops_company();
  return t;
end $$;

-- Team: change someone's role or location, or take them off the team.
create or replace function public.ops_set_member(p_user uuid, p_role text, p_location uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  co uuid := public.ops_company();
  cur text;
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can change the team.'; end if;
  select ops_role into cur from public.profiles where id = p_user and role = 'customer' and company_id = co;
  if not found then raise exception 'That person isn''t on your team.'; end if;
  if p_role is not null and p_role not in ('owner', 'office', 'dispatcher', 'sales', 'crew_lead', 'crew', 'accounting', 'sub') then
    raise exception 'Pick a role.';
  end if;
  if not public.ops_is('owner') and (cur = 'owner' or p_role = 'owner') then
    raise exception 'Only an owner can add or change an owner.';
  end if;
  if cur = 'owner' and coalesce(p_role, '') <> 'owner'
     and not exists (select 1 from public.profiles where company_id = co and role = 'customer' and ops_role = 'owner' and id <> p_user) then
    raise exception 'Your team needs at least one owner.';
  end if;
  if p_role is null then
    -- Off the team: no more access to this company's workspace or its AMBIT orders.
    update public.profiles set ops_role = null, ops_location_id = null, company_id = null where id = p_user;
  else
    update public.profiles
       set ops_role = p_role,
           ops_location_id = (select id from public.ops_locations where id = p_location and company_id = co)
     where id = p_user;
  end if;
end $$;

-- Invite someone to the team. The app makes the secret link and sends the email; only its hash is kept.
create or replace function public.ops_invite(p_email text, p_name text, p_phone text, p_role text, p_location uuid, p_hash text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  co uuid := public.ops_company();
  em text := lower(trim(coalesce(p_email, '')));
  p public.profiles;
  inv uuid;
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can invite people.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Type their email address.'; end if;
  if p_role not in ('owner', 'office', 'dispatcher', 'sales', 'crew_lead', 'crew', 'accounting', 'sub') then raise exception 'Pick their role.'; end if;
  if p_role = 'owner' and not public.ops_is('owner') then raise exception 'Only an owner can add another owner.'; end if;
  select * into p from public.profiles where lower(email) = em;
  if p.id is not null then
    if p.role <> 'customer' then raise exception 'That email belongs to an AMBIT employee account.'; end if;
    if p.company_id is not null and p.company_id <> co then raise exception 'That email already belongs to another company''s account.'; end if;
    if p.company_id = co then
      -- Already one of this company's logins: put them on the team now.
      update public.profiles
         set ops_role = p_role, status = 'active',
             ops_location_id = (select id from public.ops_locations where id = p_location and company_id = co),
             approved_at = coalesce(approved_at, now())
       where id = p.id;
      return null;
    end if;
    -- A login with no company yet: they join by signing in from the invite link (proves it's them).
  end if;
  update public.invites set cancelled_at = now()
   where lower(email) = em and accepted_at is null and cancelled_at is null;
  insert into public.invites (email, full_name, phone, role, company_id, ops_role, ops_location_id, token_hash, invited_by, invited_by_name)
  values (em, nullif(trim(p_name), ''), nullif(trim(p_phone), ''), 'customer', co, p_role,
          (select id from public.ops_locations where id = p_location and company_id = co),
          p_hash, auth.uid(), public.my_name())
  returning id into inv;
  return inv;
end $$;

create or replace function public.ops_invite_sent(p_invite uuid, p_status text) returns void
language sql security definer set search_path = public as $$
  update public.invites set sent_at = now(), email_status = left(p_status, 20)
   where id = p_invite and company_id = public.ops_company() and public.ops_is('owner', 'office')
$$;

create or replace function public.ops_cancel_invite(p_invite uuid) returns void
language sql security definer set search_path = public as $$
  update public.invites set cancelled_at = now()
   where id = p_invite and company_id = public.ops_company() and accepted_at is null and public.ops_is('owner', 'office')
$$;

-- Using an invite now also puts the person on the contractor's team with their role.
create or replace function public.apply_invite(p_user uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  em  text;
begin
  if coalesce(p_user::text, '') = '' or coalesce(p_hash, '') = '' then return false; end if;
  select lower(email) into em from public.profiles where id = p_user;
  if em is null then return false; end if;
  select * into inv from public.invites
   where token_hash = p_hash and accepted_at is null and cancelled_at is null and expires_at > now()
   for update;
  if inv.id is null or lower(inv.email) <> em then return false; end if;

  update public.profiles
     set role        = inv.role,
         status      = 'active',
         company_id  = case when inv.role = 'customer' then inv.company_id end,
         branch_id   = coalesce(inv.branch_id, branch_id),
         job_role    = case when inv.role = 'admin' then 'admin' when inv.role = 'employee' then inv.job_role end,
         perms       = case when inv.role = 'admin' then public.all_perms() when inv.role = 'employee' then inv.perms else '{}'::text[] end,
         ops_role    = case when inv.role = 'customer' then inv.ops_role end,
         ops_location_id = case when inv.role = 'customer' then inv.ops_location_id end,
         full_name   = coalesce(nullif(trim(full_name), ''), inv.full_name),
         phone       = coalesce(nullif(trim(phone), ''), inv.phone),
         approved_at = now(),
         approved_by = inv.invited_by
   where id = p_user;
  update public.invites set accepted_at = now(), accepted_by = p_user where id = inv.id;
  update public.invites set cancelled_at = now()
   where lower(email) = em and id <> inv.id and accepted_at is null and cancelled_at is null;
  return true;
end $$;
revoke execute on function public.apply_invite(uuid, text) from public, anon, authenticated;

-- ---------- Website lead form (no sign-in) -------------------------------------------------
create or replace function public.ops_lead_form(p_token text)
returns table (company_name text, logo_path text, services text[], color text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(c.ops_settings->>'display_name', ''), c.name), c.ops_logo_path,
         coalesce((select array_agg(x) from jsonb_array_elements_text(c.ops_settings->'services') x), '{}'),
         nullif(c.ops_settings->>'color', '')
    from public.companies c
   where coalesce(p_token, '') <> '' and c.ops_form_token = p_token and c.ops_enabled
   limit 1
$$;

create or replace function public.ops_lead_submit(p_token text, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  co      public.companies;
  nm      text := left(trim(coalesce(p_data->>'name', '')), 120);
  em      text := lower(left(trim(coalesce(p_data->>'email', '')), 160));
  ph      text := left(trim(coalesce(p_data->>'phone', '')), 40);
  digits  text := regexp_replace(coalesce(p_data->>'phone', ''), '\D', '', 'g');
  cust    uuid;
  prop    uuid;
  lead    uuid;
  msg     text := left(trim(coalesce(p_data->>'message', '')), 2000);
  svc     text[];
begin
  select * into co from public.companies where coalesce(p_token, '') <> '' and ops_form_token = p_token and ops_enabled;
  if co.id is null then raise exception 'This form isn''t taking requests right now.'; end if;
  if nm = '' then raise exception 'Please add your name.'; end if;
  if em = '' and length(digits) < 7 then raise exception 'Please add a phone number or an email so they can reach you.'; end if;
  if (select count(*) from public.ops_leads where company_id = co.id and source = 'Website form' and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many requests right now. Please call instead.';
  end if;
  select coalesce(array_agg(left(x, 60)), '{}') into svc from (select jsonb_array_elements_text(coalesce(p_data->'services', '[]'::jsonb)) x limit 10) s;

  -- Same person again (same phone or email): add the request to their record.
  select id into cust from public.ops_customers
   where company_id = co.id
     and ((length(digits) >= 7 and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = digits)
          or (em <> '' and lower(email) = em))
   order by created_at limit 1;
  if cust is null then
    insert into public.ops_customers (company_id, kind, name, first_name, last_name, email, phone, source)
    values (co.id, 'person', nm, split_part(nm, ' ', 1), nullif(trim(substr(nm, length(split_part(nm, ' ', 1)) + 1)), ''),
            nullif(em, ''), nullif(ph, ''), 'Website form')
    returning id into cust;
  end if;
  if coalesce(trim(p_data->>'street'), '') <> '' then
    select id into prop from public.ops_properties
     where customer_id = cust and lower(coalesce(street, '')) = lower(trim(p_data->>'street')) limit 1;
    if prop is null then
      insert into public.ops_properties (company_id, customer_id, street, city, state, zip)
      values (co.id, cust, left(trim(p_data->>'street'), 160), nullif(left(trim(coalesce(p_data->>'city', '')), 80), ''),
              nullif(upper(left(trim(coalesce(p_data->>'state', '')), 2)), ''), nullif(left(trim(coalesce(p_data->>'zip', '')), 10), ''))
      returning id into prop;
    end if;
  end if;
  insert into public.ops_leads (company_id, customer_id, property_id, location_id, stage, source, services, title)
  values (co.id, cust, prop, (select id from public.ops_locations where company_id = co.id order by sort, created_at limit 1),
          'new', 'Website form', svc, null)
  returning id into lead;
  if msg <> '' then
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by_name)
    values (co.id, lead, cust, 'note', msg, nm || ' (website form)');
  end if;
  return true;
end $$;

-- ---------- Spreadsheet import of customers ----------------------------------------------------
-- p_rows: [{name, kind, first_name, last_name, company_name, email, phone, street, city, state, zip, notes, source}]
create or replace function public.ops_import_customers(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  co     uuid := public.ops_company();
  batch  uuid := gen_random_uuid();
  r      jsonb;
  cust   uuid;
  added  int := 0;
  props  int := 0;
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can import customers.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Nothing to import.'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import up to 5,000 customers at a time.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(r->>'name'), '') = '' then continue; end if;
    insert into public.ops_customers (company_id, kind, name, first_name, last_name, company_name, email, phone, notes, source, import_batch, created_by)
    values (co, case when r->>'kind' = 'company' then 'company' else 'person' end, left(trim(r->>'name'), 120),
            nullif(left(trim(coalesce(r->>'first_name', '')), 60), ''), nullif(left(trim(coalesce(r->>'last_name', '')), 60), ''),
            nullif(left(trim(coalesce(r->>'company_name', '')), 120), ''), nullif(lower(left(trim(coalesce(r->>'email', '')), 160)), ''),
            nullif(left(trim(coalesce(r->>'phone', '')), 40), ''), nullif(left(trim(coalesce(r->>'notes', '')), 2000), ''),
            coalesce(nullif(left(trim(coalesce(r->>'source', '')), 60), ''), 'Import'), batch, auth.uid())
    returning id into cust;
    added := added + 1;
    if coalesce(trim(r->>'street'), '') <> '' then
      insert into public.ops_properties (company_id, customer_id, street, city, state, zip)
      values (co, cust, left(trim(r->>'street'), 160), nullif(left(trim(coalesce(r->>'city', '')), 80), ''),
              nullif(upper(left(trim(coalesce(r->>'state', '')), 2)), ''), nullif(left(trim(coalesce(r->>'zip', '')), 10), ''));
      props := props + 1;
    end if;
  end loop;
  return jsonb_build_object('batch', batch, 'customers', added, 'properties', props);
end $$;

-- Undo an import: removes the customers it added that have no leads yet.
create or replace function public.ops_undo_import(p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can undo an import.'; end if;
  delete from public.ops_customers c
   where c.company_id = public.ops_company() and c.import_batch = p_batch
     and not exists (select 1 from public.ops_leads l where l.customer_id = c.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Logos (shown on proposals and the lead form, so the bucket is public) ----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ops-logos', 'ops-logos', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists ops_logos_insert on storage.objects;
drop policy if exists ops_logos_update on storage.objects;
drop policy if exists ops_logos_delete on storage.objects;
create policy ops_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ops-logos' and split_part(name, '/', 1) = public.ops_company()::text and public.ops_is('owner', 'office'));
create policy ops_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'ops-logos' and split_part(name, '/', 1) = public.ops_company()::text and public.ops_is('owner', 'office'));
create policy ops_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ops-logos' and split_part(name, '/', 1) = public.ops_company()::text and public.ops_is('owner', 'office'));

-- ---------- Who can call what -----------------------------------------------------------------
revoke all on function public.ops_company() from public, anon;
revoke all on function public.ops_role() from public, anon;
revoke all on function public.ops_is(text[]) from public, anon;
grant execute on function public.ops_company() to authenticated;
grant execute on function public.ops_role() to authenticated;
grant execute on function public.ops_is(text[]) to authenticated;
revoke all on function public.admin_ops_enable(uuid, boolean, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.admin_ops_enable(uuid, boolean, boolean, jsonb, jsonb) to authenticated;
revoke all on function public.admin_ops_set_owner(uuid, uuid) from public, anon;
grant execute on function public.admin_ops_set_owner(uuid, uuid) to authenticated;
revoke all on function public.ops_open_workspace(uuid) from public, anon;
grant execute on function public.ops_open_workspace(uuid) to authenticated;
revoke all on function public.ops_save_settings(jsonb) from public, anon;
grant execute on function public.ops_save_settings(jsonb) to authenticated;
revoke all on function public.ops_set_logo(text) from public, anon;
grant execute on function public.ops_set_logo(text) to authenticated;
revoke all on function public.ops_set_support(int) from public, anon;
grant execute on function public.ops_set_support(int) to authenticated;
revoke all on function public.ops_new_form_link() from public, anon;
grant execute on function public.ops_new_form_link() to authenticated;
revoke all on function public.ops_set_member(uuid, text, uuid) from public, anon;
grant execute on function public.ops_set_member(uuid, text, uuid) to authenticated;
revoke all on function public.ops_invite(text, text, text, text, uuid, text) from public, anon;
grant execute on function public.ops_invite(text, text, text, text, uuid, text) to authenticated;
revoke all on function public.ops_invite_sent(uuid, text) from public, anon;
grant execute on function public.ops_invite_sent(uuid, text) to authenticated;
revoke all on function public.ops_cancel_invite(uuid) from public, anon;
grant execute on function public.ops_cancel_invite(uuid) to authenticated;
revoke all on function public.ops_import_customers(jsonb) from public, anon;
grant execute on function public.ops_import_customers(jsonb) to authenticated;
revoke all on function public.ops_undo_import(uuid) from public, anon;
grant execute on function public.ops_undo_import(uuid) to authenticated;
revoke all on function public.ops_lead_form(text) from public;
grant execute on function public.ops_lead_form(text) to anon, authenticated;
revoke all on function public.ops_lead_submit(text, jsonb) from public;
grant execute on function public.ops_lead_submit(text, jsonb) to anon, authenticated;
revoke all on function public.ops_leads_stamp() from public, anon, authenticated;

select 'AMBIT-OPS foundation ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0032 - AMBIT-OPS quotes and proposals (pilot week 2)
-- * Takeoff for contractors: a contractor's own takeoffs live in their workspace (only their team sees
--   them; AMBIT staff takeoffs stay as they are). Takeoff items get a work area (EW, CL ...) and can be
--   gable-shaped walls (attic demising walls sized from the roof pitch). The AI pre-scan's findings are kept
--   on the takeoff.
-- * Quotes: options (good, better, best), lines by work area, add-ons, margin with a floor that needs the
--   owner's OK, saved packages.
-- * Proposals: a private link the customer opens without signing in, picks an option and add-ons, and
--   signs. Opening and signing are written on the lead's timeline, and signing marks the lead won.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Takeoff: work areas, gable walls, AI pre-scan ------------------------------------
alter table public.takeoff_items add column if not exists area_code text;
alter table public.takeoff_items add column if not exists shape text;
do $$ begin
  alter table public.takeoff_items add constraint takeoff_items_shape_check check (shape is null or shape in ('gable'));
exception when duplicate_object then null; end $$;

alter table public.takeoffs add column if not exists ops_company_id uuid references public.companies(id) on delete cascade;
alter table public.takeoffs add column if not exists lead_id uuid;
alter table public.takeoffs add column if not exists ops_customer_id uuid;
alter table public.takeoffs add column if not exists ai_scan jsonb;
create index if not exists takeoffs_ops_company_idx on public.takeoffs(ops_company_id, updated_at desc) where ops_company_id is not null;

-- Who may open a takeoff: AMBIT staff with the Takeoff box (AMBIT's own takeoffs), or the office, dispatch
-- and sales of the contractor whose workspace it's in.
drop policy if exists takeoffs_team on public.takeoffs;
create policy takeoffs_team on public.takeoffs for all to authenticated
  using ((ops_company_id is null and public.has_perm('takeoff'))
         or (ops_company_id is not null and ops_company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales')))
  with check ((ops_company_id is null and public.has_perm('takeoff'))
              or (ops_company_id is not null and ops_company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales')));

-- Files, sheets, items and shapes follow their takeoff.
drop policy if exists takeoff_files_team  on public.takeoff_files;
drop policy if exists takeoff_sheets_team on public.takeoff_sheets;
drop policy if exists takeoff_items_team  on public.takeoff_items;
drop policy if exists takeoff_marks_team  on public.takeoff_marks;
create policy takeoff_files_team  on public.takeoff_files  for all to authenticated
  using (takeoff_id in (select t.id from public.takeoffs t)) with check (takeoff_id in (select t.id from public.takeoffs t));
create policy takeoff_sheets_team on public.takeoff_sheets for all to authenticated
  using (takeoff_id in (select t.id from public.takeoffs t)) with check (takeoff_id in (select t.id from public.takeoffs t));
create policy takeoff_items_team  on public.takeoff_items  for all to authenticated
  using (takeoff_id in (select t.id from public.takeoffs t)) with check (takeoff_id in (select t.id from public.takeoffs t));
create policy takeoff_marks_team  on public.takeoff_marks  for all to authenticated
  using (takeoff_id in (select t.id from public.takeoffs t)) with check (takeoff_id in (select t.id from public.takeoffs t));

-- Plan PDFs are stored under <takeoff id>/...
drop policy if exists plans_read   on storage.objects;
drop policy if exists plans_insert on storage.objects;
drop policy if exists plans_delete on storage.objects;
create policy plans_read   on storage.objects for select to authenticated
  using (bucket_id = 'plans' and split_part(name, '/', 1) in (select t.id::text from public.takeoffs t));
create policy plans_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and split_part(name, '/', 1) in (select t.id::text from public.takeoffs t));
create policy plans_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and split_part(name, '/', 1) in (select t.id::text from public.takeoffs t));

-- ---------- Product library: labor and coverage per product --------------------------------
alter table public.ops_products add column if not exists labor_key text;        -- which labor rate in Settings applies
alter table public.ops_products add column if not exists coverage_key text;     -- blown: which maker's coverage chart
alter table public.ops_products add column if not exists description text;      -- what customers read on the proposal

-- Turning a workspace on now also fills in each product's coverage chart and labor rate.
create or replace function public.admin_ops_enable(p_company uuid, p_on boolean, p_demo boolean, p_settings jsonb, p_products jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.companies;
  e jsonb;
  i int := 0;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can turn AMBIT-OPS on or off.'; end if;
  select * into c from public.companies where id = p_company for update;
  if c.id is null then raise exception 'Customer not found.'; end if;
  update public.companies
     set ops_enabled = coalesce(p_on, true),
         ops_enabled_at = case when coalesce(p_on, true) then coalesce(ops_enabled_at, now()) else ops_enabled_at end,
         ops_demo = coalesce(p_demo, ops_demo),
         ops_settings = case when ops_settings = '{}'::jsonb then coalesce(p_settings, '{}'::jsonb) else ops_settings end,
         ops_form_token = coalesce(ops_form_token, replace(gen_random_uuid()::text, '-', ''))
   where id = p_company;
  if coalesce(p_on, true) then
    if not exists (select 1 from public.ops_locations where company_id = p_company) then
      insert into public.ops_locations (company_id, name, address, phone)
      values (p_company, 'Main', nullif(trim(coalesce(c.ship_address, c.bill_address, '')), ''), c.phone);
    end if;
    if p_products is not null and jsonb_typeof(p_products) = 'array'
       and not exists (select 1 from public.ops_products where company_id = p_company) then
      for e in select * from jsonb_array_elements(p_products) loop
        i := i + 1;
        insert into public.ops_products (company_id, product_id, ambit_skus, kind, name, sku, unit, cost, cost_source, cost_note,
                                         yield_bf, lb_per_set, r_value, sqft_per_unit, waste_pct, price_unit, active, sort,
                                         coverage_key, labor_key, description)
        values (p_company,
                nullif(e->>'product_id', '')::uuid,
                coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(e->'ambit_skus', '[]'::jsonb)) x), '{}'),
                e->>'kind', e->>'name', nullif(e->>'sku', ''), coalesce(nullif(e->>'unit', ''), 'each'),
                nullif(e->>'cost', '')::numeric, coalesce(nullif(e->>'cost_source', ''), 'manual'), nullif(e->>'cost_note', ''),
                nullif(e->>'yield_bf', '')::numeric, nullif(e->>'lb_per_set', '')::numeric, nullif(e->>'r_value', '')::numeric,
                nullif(e->>'sqft_per_unit', '')::numeric, coalesce(nullif(e->>'waste_pct', '')::numeric, 10),
                nullif(e->>'price_unit', ''), coalesce((e->>'active')::boolean, true), i,
                nullif(e->>'coverage_key', ''), nullif(e->>'labor_key', ''), left(nullif(e->>'description', ''), 400));
      end loop;
    end if;
  else
    -- Off: nobody (and no AMBIT helper) can open it until it's turned back on. Nothing is deleted.
    update public.profiles set ops_workspace = null where ops_workspace = p_company;
  end if;
end $$;

-- ---------- Quotes -------------------------------------------------------------------------------
create table if not exists public.ops_quotes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  number           int,
  lead_id          uuid references public.ops_leads(id) on delete set null,
  customer_id      uuid not null references public.ops_customers(id) on delete cascade,
  property_id      uuid references public.ops_properties(id) on delete set null,
  takeoff_id       uuid references public.takeoffs(id) on delete set null,
  title            text,
  status           text not null default 'draft',
  price_level      text not null default 'retail',
  target_margin    numeric(5,2),
  floor_margin     numeric(5,2),
  burden_pct       numeric(5,2),
  tax_rate         numeric(6,3),
  tax_labor        boolean not null default false,
  tax_exempt       boolean not null default false,
  deposit_pct      numeric(5,2),
  intro            text,
  terms            text,
  valid_until      date,
  public_token     text,
  rep_id           uuid,
  created_by       uuid,
  needs_approval   boolean not null default false,
  approved_by_name text,
  approved_at      timestamptz,
  sent_at          timestamptz,
  viewed_at        timestamptz,
  view_count       int not null default 0,
  signed_at        timestamptz,
  signed_name      text,
  signed_email     text,
  signed_ip        text,
  signed_ua        text,
  signature        text,
  signed_option_id uuid,
  signed_addons    uuid[] not null default '{}',
  signed_total     numeric(12,2),
  declined_at      timestamptz,
  decline_reason   text,
  totals           jsonb not null default '{}'::jsonb,   -- per option: price, cost, margin, tax, total (worked out by the app)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
do $$ begin
  alter table public.ops_quotes add constraint ops_quotes_status_check check (status in ('draft', 'sent', 'viewed', 'signed', 'declined'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ops_quotes add constraint ops_quotes_level_check check (price_level in ('retail', 'builder'));
exception when duplicate_object then null; end $$;
create unique index if not exists ops_quotes_token_idx on public.ops_quotes(public_token) where public_token is not null;
create index if not exists ops_quotes_company_idx on public.ops_quotes(company_id, updated_at desc);
create index if not exists ops_quotes_lead_idx on public.ops_quotes(lead_id);

create table if not exists public.ops_quote_options (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  quote_id    uuid not null references public.ops_quotes(id) on delete cascade,
  name        text not null,
  note        text,
  sort        int not null default 0
);
create index if not exists ops_quote_options_quote_idx on public.ops_quote_options(quote_id, sort);

-- One line of work: a product over a measured area in a work area. option_id null = an add-on the
-- customer can tick. Sizes and money are worked out by the app (lib/ops/quote-calc.ts) and stored.
create table if not exists public.ops_quote_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  quote_id        uuid not null references public.ops_quotes(id) on delete cascade,
  option_id       uuid references public.ops_quote_options(id) on delete cascade,
  sort            int not null default 0,
  area_code       text,
  product_id      uuid references public.ops_products(id) on delete set null,
  kind            text not null default 'other',
  name            text not null,
  detail          text,
  measure         text not null default 'sqft',
  sqft            numeric(12,2),
  lf              numeric(12,2),
  height_ft       numeric(8,2),
  qty             numeric(12,2),
  depth_in        numeric(6,2),
  r_value         numeric(6,1),
  framing         text,
  hours           numeric(10,2),
  waste_pct       numeric(5,1),
  units           numeric(12,3),
  unit            text,
  bf              numeric(14,1),
  cost_material   numeric(12,2) not null default 0,
  cost_labor      numeric(12,2) not null default 0,
  price           numeric(12,2) not null default 0,
  price_locked    boolean not null default false,
  takeoff_item_id uuid,
  created_at      timestamptz not null default now()
);
create index if not exists ops_quote_lines_quote_idx on public.ops_quote_lines(quote_id, sort);

-- Saved packages: a set of lines to drop into any quote ("Attic R-49 blown", "New build open cell").
create table if not exists public.ops_packages (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  lines       jsonb not null default '[]'::jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ops_packages_company_idx on public.ops_packages(company_id, name);

alter table public.ops_quotes        enable row level security;
alter table public.ops_quote_options enable row level security;
alter table public.ops_quote_lines   enable row level security;
alter table public.ops_packages      enable row level security;

-- Quotes: owner, office, dispatch and accounting see all; a sales rep sees theirs (or ones on their leads).
drop policy if exists ops_quotes_read   on public.ops_quotes;
drop policy if exists ops_quotes_insert on public.ops_quotes;
drop policy if exists ops_quotes_update on public.ops_quotes;
drop policy if exists ops_quotes_delete on public.ops_quotes;
create policy ops_quotes_read on public.ops_quotes for select to authenticated
  using (company_id = public.ops_company()
         and (public.ops_is('owner', 'office', 'dispatcher', 'accounting')
              or (public.ops_is('sales') and (rep_id = auth.uid() or created_by = auth.uid()
                                              or lead_id in (select l.id from public.ops_leads l)))));
create policy ops_quotes_insert on public.ops_quotes for insert to authenticated
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'));
create policy ops_quotes_update on public.ops_quotes for update to authenticated
  using (company_id = public.ops_company()
         and (public.ops_is('owner', 'office', 'dispatcher')
              or (public.ops_is('sales') and (rep_id = auth.uid() or created_by = auth.uid()
                                              or lead_id in (select l.id from public.ops_leads l)))))
  with check (company_id = public.ops_company());
create policy ops_quotes_delete on public.ops_quotes for delete to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office'));

drop policy if exists ops_quote_options_all on public.ops_quote_options;
create policy ops_quote_options_all on public.ops_quote_options for all to authenticated
  using (quote_id in (select q.id from public.ops_quotes q))
  with check (company_id = public.ops_company() and quote_id in (select q.id from public.ops_quotes q));
drop policy if exists ops_quote_lines_all on public.ops_quote_lines;
create policy ops_quote_lines_all on public.ops_quote_lines for all to authenticated
  using (quote_id in (select q.id from public.ops_quotes q))
  with check (company_id = public.ops_company() and quote_id in (select q.id from public.ops_quotes q));

drop policy if exists ops_packages_read  on public.ops_packages;
drop policy if exists ops_packages_write on public.ops_packages;
create policy ops_packages_read on public.ops_packages for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'));
create policy ops_packages_write on public.ops_packages for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales'));

-- Quote numbers (#1001 ...) per workspace.
create or replace function public.ops_quotes_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.number := coalesce(new.number, public.ops_next(new.company_id, 'quote'));
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ops_quotes_stamp on public.ops_quotes;
create trigger ops_quotes_stamp before insert or update on public.ops_quotes for each row execute function public.ops_quotes_stamp();
revoke all on function public.ops_quotes_stamp() from public, anon, authenticated;

-- Stage changes made by the customer (signing a proposal) say so on the timeline.
create or replace function public.ops_leads_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce(public.my_name(), 'The customer');
begin
  if tg_op = 'INSERT' then
    new.number := coalesce(new.number, public.ops_next(new.company_id, 'lead'));
    new.stage_changed_at := now();
    if new.stage = 'won' then new.won_at := now(); end if;
    return new;
  end if;
  new.updated_at := now();
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    new.won_at := case when new.stage = 'won' then coalesce(old.won_at, now()) end;
    new.lost_at := case when new.stage = 'lost' then now() end;
    if new.stage <> 'lost' then new.lost_reason := null; end if;
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by, created_by_name)
    values (new.company_id, new.id, new.customer_id, 'stage',
            old.stage || '>' || new.stage || case when new.stage = 'lost' then ':' || coalesce(new.lost_reason, '') else '' end,
            auth.uid(), who);
  end if;
  return new;
end $$;
revoke all on function public.ops_leads_stamp() from public, anon, authenticated;

-- ---------- Saving a quote in one go (its options and lines) -----------------------------------
-- Runs as the person saving it, so the rules above still decide what they can change.
create or replace function public.ops_quote_save(p_quote uuid, p_fields jsonb, p_options jsonb, p_lines jsonb)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  q public.ops_quotes;
  co uuid := public.ops_company();
  o jsonb;
  l jsonb;
begin
  select * into q from public.ops_quotes where id = p_quote for update;
  if q.id is null then raise exception 'Quote not found.'; end if;
  if q.status = 'signed' then raise exception 'This quote is signed. Make a copy to change it.'; end if;
  update public.ops_quotes set
    title = left(nullif(trim(coalesce(p_fields->>'title', '')), ''), 140),
    property_id = nullif(p_fields->>'property_id', '')::uuid,
    price_level = case when p_fields->>'price_level' = 'builder' then 'builder' else 'retail' end,
    target_margin = nullif(p_fields->>'target_margin', '')::numeric,
    floor_margin = nullif(p_fields->>'floor_margin', '')::numeric,
    burden_pct = nullif(p_fields->>'burden_pct', '')::numeric,
    tax_rate = nullif(p_fields->>'tax_rate', '')::numeric,
    tax_labor = coalesce((p_fields->>'tax_labor')::boolean, false),
    tax_exempt = coalesce((p_fields->>'tax_exempt')::boolean, false),
    deposit_pct = nullif(p_fields->>'deposit_pct', '')::numeric,
    intro = left(nullif(p_fields->>'intro', ''), 4000),
    terms = left(nullif(p_fields->>'terms', ''), 8000),
    rep_id = nullif(p_fields->>'rep_id', '')::uuid,
    needs_approval = coalesce((p_fields->>'needs_approval')::boolean, false),
    -- A change after the owner's OK needs a new OK if it's still under the floor.
    approved_at = case when coalesce((p_fields->>'needs_approval')::boolean, false) then null else approved_at end,
    approved_by_name = case when coalesce((p_fields->>'needs_approval')::boolean, false) then null else approved_by_name end,
    totals = coalesce(p_fields->'totals', '{}'::jsonb)
  where id = p_quote;

  delete from public.ops_quote_lines where quote_id = p_quote;
  delete from public.ops_quote_options where quote_id = p_quote;
  for o in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    insert into public.ops_quote_options (id, company_id, quote_id, name, note, sort)
    values ((o->>'id')::uuid, co, p_quote, left(coalesce(nullif(trim(o->>'name'), ''), 'Option'), 60), left(nullif(o->>'note', ''), 500), coalesce((o->>'sort')::int, 0));
  end loop;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into public.ops_quote_lines (id, company_id, quote_id, option_id, sort, area_code, product_id, kind, name, detail, measure,
                                        sqft, lf, height_ft, qty, depth_in, r_value, framing, hours, waste_pct, units, unit, bf,
                                        cost_material, cost_labor, price, price_locked, takeoff_item_id)
    values ((l->>'id')::uuid, co, p_quote, nullif(l->>'option_id', '')::uuid, coalesce((l->>'sort')::int, 0), left(nullif(l->>'area_code', ''), 12),
            nullif(l->>'product_id', '')::uuid, coalesce(nullif(l->>'kind', ''), 'other'), left(coalesce(nullif(trim(l->>'name'), ''), 'Item'), 160),
            left(nullif(l->>'detail', ''), 400), coalesce(nullif(l->>'measure', ''), 'sqft'),
            nullif(l->>'sqft', '')::numeric, nullif(l->>'lf', '')::numeric, nullif(l->>'height_ft', '')::numeric, nullif(l->>'qty', '')::numeric,
            nullif(l->>'depth_in', '')::numeric, nullif(l->>'r_value', '')::numeric, left(nullif(l->>'framing', ''), 10), nullif(l->>'hours', '')::numeric,
            nullif(l->>'waste_pct', '')::numeric, nullif(l->>'units', '')::numeric, left(nullif(l->>'unit', ''), 20), nullif(l->>'bf', '')::numeric,
            coalesce(nullif(l->>'cost_material', '')::numeric, 0), coalesce(nullif(l->>'cost_labor', '')::numeric, 0),
            coalesce(nullif(l->>'price', '')::numeric, 0), coalesce((l->>'price_locked')::boolean, false), nullif(l->>'takeoff_item_id', '')::uuid);
  end loop;
end $$;

-- The owner (or office) OKs a quote that's under the lowest margin.
create or replace function public.ops_quote_approve(p_quote uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can approve a quote under the lowest margin.'; end if;
  update public.ops_quotes set approved_at = now(), approved_by_name = public.my_name(), needs_approval = false
   where id = p_quote and company_id = public.ops_company();
end $$;

-- Sent: gets its private link, the date it runs out, and the lead moves to "Quote sent".
create or replace function public.ops_quote_mark_sent(p_quote uuid, p_days int) returns text
language plpgsql security definer set search_path = public as $$
declare
  q public.ops_quotes;
  tok text;
begin
  select * into q from public.ops_quotes where id = p_quote and company_id = public.ops_company();
  if q.id is null then raise exception 'Quote not found.'; end if;
  if not public.ops_is('owner', 'office', 'dispatcher', 'sales') then raise exception 'You can''t send quotes.'; end if;
  if q.needs_approval and q.approved_at is null and not public.ops_is('owner', 'office') then
    raise exception 'This quote is under your lowest margin. The owner needs to approve it first.';
  end if;
  tok := coalesce(q.public_token, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  update public.ops_quotes
     set public_token = tok,
         status = case when status in ('signed', 'viewed') then status else 'sent' end,
         sent_at = coalesce(sent_at, now()),
         valid_until = coalesce(valid_until, (now() at time zone 'America/Chicago')::date + greatest(1, least(coalesce(p_days, 30), 365)))
   where id = p_quote;
  if q.lead_id is not null then
    update public.ops_leads set stage = 'quoted'
     where id = q.lead_id and stage in ('new', 'contacted', 'appointment');
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by, created_by_name)
    values (q.company_id, q.lead_id, q.customer_id, 'system', 'Quote #' || q.number || ' sent', auth.uid(), public.my_name());
  end if;
  return tok;
end $$;

-- ---------- The customer's side (no sign-in; the private link is the key) ----------------------
-- Everything the proposal page shows. Opening it the first time is noted on the lead.
create or replace function public.ops_proposal(p_token text, p_count boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  q public.ops_quotes;
  co public.companies;
  out jsonb;
begin
  if coalesce(length(p_token), 0) < 32 then return null; end if;
  select * into q from public.ops_quotes where public_token = p_token;
  if q.id is null then return null; end if;
  select * into co from public.companies where id = q.company_id and ops_enabled;
  if co.id is null then return null; end if;
  if p_count and q.status in ('sent', 'viewed') then
    update public.ops_quotes set view_count = view_count + 1, viewed_at = coalesce(viewed_at, now()),
           status = case when status = 'sent' then 'viewed' else status end
     where id = q.id;
    if q.viewed_at is null and q.lead_id is not null then
      insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by_name)
      values (q.company_id, q.lead_id, q.customer_id, 'system', 'The customer opened quote #' || q.number, 'Proposal');
    end if;
  end if;
  select jsonb_build_object(
    'quote', jsonb_build_object('id', q.id, 'number', q.number, 'title', q.title, 'status', q.status, 'intro', q.intro, 'terms', q.terms,
               'valid_until', q.valid_until, 'sent_at', q.sent_at, 'tax_rate', q.tax_rate, 'tax_exempt', q.tax_exempt, 'deposit_pct', q.deposit_pct,
               'totals', q.totals, 'signed_at', q.signed_at, 'signed_name', q.signed_name, 'signature', q.signature,
               'signed_option_id', q.signed_option_id, 'signed_addons', q.signed_addons, 'signed_total', q.signed_total,
               'declined_at', q.declined_at),
    'company', jsonb_build_object('name', coalesce(nullif(co.ops_settings->>'display_name', ''), co.name), 'logo_path', co.ops_logo_path,
               'phone', co.ops_settings->>'phone', 'email', co.ops_settings->>'email', 'website', co.ops_settings->>'website',
               'address', co.ops_settings->>'address', 'license_no', co.ops_settings->>'license_no', 'color', co.ops_settings->>'color',
               'show_line_prices', coalesce((co.ops_settings->>'show_line_prices')::boolean, false),
               'work_areas', coalesce(co.ops_settings->'work_areas', 'null'::jsonb)),
    'customer', (select jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone) from public.ops_customers c where c.id = q.customer_id),
    'property', (select jsonb_build_object('street', p.street, 'city', p.city, 'state', p.state, 'zip', p.zip) from public.ops_properties p where p.id = q.property_id),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'note', o.note) order by o.sort) from public.ops_quote_options o where o.quote_id = q.id), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'option_id', l.option_id, 'area_code', l.area_code, 'kind', l.kind, 'name', l.name,
               'detail', l.detail, 'measure', l.measure, 'sqft', l.sqft, 'lf', l.lf, 'qty', l.qty, 'bf', l.bf, 'depth_in', l.depth_in,
               'r_value', l.r_value, 'price', l.price, 'product_id', l.product_id) order by l.sort) from public.ops_quote_lines l where l.quote_id = q.id), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- The customer signs: the option and add-ons they picked, their typed name and drawn signature.
-- The total is worked out here from the quote's saved totals (what the contractor's app priced), never
-- taken from the customer's browser.
create or replace function public.ops_proposal_sign(p_token text, p_option uuid, p_addons uuid[], p_name text, p_email text,
                                                    p_signature text, p_ip text, p_ua text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  q public.ops_quotes;
  opt text;
  adds uuid[];
  total numeric;
begin
  select * into q from public.ops_quotes where public_token = p_token and coalesce(length(p_token), 0) >= 32 for update;
  if q.id is null then raise exception 'This proposal link isn''t valid.'; end if;
  if q.status = 'signed' then raise exception 'This proposal is already signed.'; end if;
  if q.status = 'declined' then raise exception 'This proposal was declined. Ask for a new one.'; end if;
  if q.status not in ('sent', 'viewed') then raise exception 'This proposal isn''t ready to sign.'; end if;
  if q.valid_until is not null and q.valid_until < (now() at time zone 'America/Chicago')::date then
    raise exception 'This proposal ran out on %. Ask for an updated one.', to_char(q.valid_until, 'Mon DD, YYYY');
  end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'Type your full name to sign.'; end if;
  if coalesce(length(p_signature), 0) < 50 or length(p_signature) > 300000 or p_signature !~ '^data:image/png;base64,' then
    raise exception 'Draw your signature in the box.';
  end if;
  select name into opt from public.ops_quote_options where id = p_option and quote_id = q.id;
  if opt is null then raise exception 'Pick one of the options.'; end if;
  adds := coalesce((select array_agg(l.id) from public.ops_quote_lines l
                     where l.quote_id = q.id and l.option_id is null and l.id = any(coalesce(p_addons, '{}'))), '{}');
  total := coalesce((q.totals->'options'->(p_option::text)->>'total')::numeric, 0)
         + coalesce((select sum(coalesce((q.totals->'addons'->(a::text)->>'total')::numeric, 0)) from unnest(adds) a), 0);
  update public.ops_quotes set
    status = 'signed', signed_at = now(), signed_name = left(trim(p_name), 120), signed_email = left(nullif(trim(lower(p_email)), ''), 160),
    signature = p_signature, signed_option_id = p_option, signed_addons = adds,
    signed_total = round(total, 2), signed_ip = left(p_ip, 60), signed_ua = left(p_ua, 300)
  where id = q.id;
  if q.lead_id is not null then
    update public.ops_leads set stage = 'won' where id = q.lead_id and stage <> 'won';
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by_name)
    values (q.company_id, q.lead_id, q.customer_id, 'system',
            'Quote #' || q.number || ' signed by ' || left(trim(p_name), 120) || ': ' || opt || ', $' || to_char(round(total, 2), 'FM999,999,990.00'),
            'Proposal');
  end if;
  return true;
end $$;

create or replace function public.ops_proposal_decline(p_token text, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare q public.ops_quotes;
begin
  select * into q from public.ops_quotes where public_token = p_token and coalesce(length(p_token), 0) >= 32 for update;
  if q.id is null or q.status not in ('sent', 'viewed') then raise exception 'This proposal can''t be declined.'; end if;
  update public.ops_quotes set status = 'declined', declined_at = now(), decline_reason = left(nullif(trim(p_reason), ''), 500) where id = q.id;
  if q.lead_id is not null then
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by_name)
    values (q.company_id, q.lead_id, q.customer_id, 'system',
            'The customer declined quote #' || q.number || coalesce(': ' || left(nullif(trim(p_reason), ''), 300), ''), 'Proposal');
  end if;
  return true;
end $$;

-- AMBIT's product sheets for the AMBIT products on a proposal (data sheets, code reports, warranty).
create or replace function public.ops_proposal_docs(p_token text) returns table (title text, doc_type text, url text)
language sql stable security definer set search_path = public as $$
  select d.title, d.doc_type, d.url
    from public.documents d
   where coalesce(length(p_token), 0) >= 32
     and d.active and d.audience = 'all' and d.url is not null
     and d.doc_type in ('TDS', 'ESR', 'CCRR', 'Warranty')
     and exists (
       select 1
         from public.ops_quotes q
         join public.ops_quote_lines l on l.quote_id = q.id
         join public.ops_products p on p.id = l.product_id
         cross join lateral unnest(d.products) f
        where q.public_token = p_token and p.product_id is not null
          and upper(p.name) like '%' || upper(f) || '%')
   order by case d.doc_type when 'TDS' then 0 when 'ESR' then 1 when 'CCRR' then 1 when 'Warranty' then 2 else 3 end, d.title
   limit 12
$$;
revoke all on function public.ops_proposal_docs(text) from public;
grant execute on function public.ops_proposal_docs(text) to anon, authenticated;

-- ---------- Who can call what -----------------------------------------------------------------
revoke all on function public.ops_quote_save(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.ops_quote_save(uuid, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.ops_quote_approve(uuid) from public, anon;
grant execute on function public.ops_quote_approve(uuid) to authenticated;
revoke all on function public.ops_quote_mark_sent(uuid, int) from public, anon;
grant execute on function public.ops_quote_mark_sent(uuid, int) to authenticated;
revoke all on function public.ops_proposal(text, boolean) from public;
grant execute on function public.ops_proposal(text, boolean) to anon, authenticated;
revoke all on function public.ops_proposal_sign(text, uuid, uuid[], text, text, text, text, text) from public;
grant execute on function public.ops_proposal_sign(text, uuid, uuid[], text, text, text, text, text) to anon, authenticated;
revoke all on function public.ops_proposal_decline(text, text) from public;
grant execute on function public.ops_proposal_decline(text, text) to anon, authenticated;

select 'AMBIT-OPS quotes and proposals ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0033 - AMBIT-OPS scheduling, rigs and stock (pilot week 3)
-- * Rigs and crews: each rig (a truck with a proportioner or a blowing machine) has a home shop, what it
--   does, how much it does in a day (open cell 1 set, closed cell 2 sets, 4,000 sq ft of blown or batts
--   to start) and a regular crew. Crew members can be people with a login or just a name.
-- * Jobs and trips: when a customer signs a quote (online, or the office records it), the job is made
--   with the signed work in one trip. The dispatcher can split it into more trips (foam now, blown
--   attic after drywall) and puts each trip on a rig on the rig board.
-- * Stock: the shop and each rig hold stock: ISO drums by maker and lot, resin drums by lot, bags and
--   supplies. AMBIT orders are added to the shop by themselves when AMBIT marks them picked up or
--   delivered. A stock check compares what the scheduled work needs with what's on hand.
-- * Crews see their next 7 days of trips (no prices).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Rigs and crews ----------------------------------------------------------------------
create table if not exists public.ops_rigs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  location_id     uuid references public.ops_locations(id) on delete set null,
  does            text[] not null default '{foam_oc,foam_cc}',  -- foam_oc foam_cc foam_roof blown batt coating other
  color           text,
  oc_sets_day     numeric(6,2) not null default 1,      -- open cell sets a day
  cc_sets_day     numeric(6,2) not null default 2,      -- closed cell (and roofing foam) sets a day
  sqft_day        numeric(10,0) not null default 4000,  -- blown, batts and other square-foot work a day
  notes           text,
  active          boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists ops_rigs_company_idx on public.ops_rigs(company_id, sort);

-- The people who go out on rigs. A login is optional (profile_id); a name is enough to schedule them.
create table if not exists public.ops_crew (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  name        text not null,
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ops_crew_company_idx on public.ops_crew(company_id, name);
create unique index if not exists ops_crew_profile_idx on public.ops_crew(company_id, profile_id) where profile_id is not null;

-- A rig's regular crew (copied onto each trip when it's scheduled; change it per trip).
create table if not exists public.ops_rig_crew (
  rig_id      uuid not null references public.ops_rigs(id) on delete cascade,
  crew_id     uuid not null references public.ops_crew(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  lead        boolean not null default false,
  primary key (rig_id, crew_id)
);

-- ---------- Jobs and trips ----------------------------------------------------------------------
create table if not exists public.ops_jobs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  number       int,
  quote_id     uuid references public.ops_quotes(id) on delete set null,
  option_id    uuid,
  customer_id  uuid not null references public.ops_customers(id) on delete cascade,
  property_id  uuid references public.ops_properties(id) on delete set null,
  lead_id      uuid references public.ops_leads(id) on delete set null,
  title        text,
  status       text not null default 'open',
  sold_total   numeric(12,2),
  crew_notes   text,     -- what the crew should know (access, pets, where to park)
  rep_id       uuid,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
do $$ begin
  alter table public.ops_jobs add constraint ops_jobs_status_check check (status in ('open', 'done', 'cancelled'));
exception when duplicate_object then null; end $$;
create unique index if not exists ops_jobs_quote_idx on public.ops_jobs(quote_id) where quote_id is not null;
create index if not exists ops_jobs_company_idx on public.ops_jobs(company_id, created_at desc);
create index if not exists ops_jobs_customer_idx on public.ops_jobs(customer_id);

create table if not exists public.ops_trips (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  job_id             uuid not null references public.ops_jobs(id) on delete cascade,
  seq                int not null default 1,
  name               text not null default 'Trip 1',
  name_auto          boolean not null default true,   -- the name follows what's in it until someone types one
  status             text not null default 'unscheduled',
  rig_id             uuid references public.ops_rigs(id) on delete set null,
  start_date         date,
  days               int not null default 1,
  end_date           date generated always as (start_date + (days - 1)) stored,
  start_time         time,
  notes              text,
  scheduled_by_name  text,
  scheduled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
do $$ begin
  alter table public.ops_trips add constraint ops_trips_status_check check (status in ('unscheduled', 'scheduled', 'in_progress', 'done', 'cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ops_trips add constraint ops_trips_days_check check (days between 1 and 60);
exception when duplicate_object then null; end $$;
create index if not exists ops_trips_company_idx on public.ops_trips(company_id, start_date);
create index if not exists ops_trips_job_idx on public.ops_trips(job_id, seq);
create index if not exists ops_trips_rig_idx on public.ops_trips(rig_id, start_date);

-- The signed work, copied from the quote. trip_id says which trip does it.
create table if not exists public.ops_job_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  job_id         uuid not null references public.ops_jobs(id) on delete cascade,
  trip_id        uuid references public.ops_trips(id) on delete set null,
  quote_line_id  uuid,
  sort           int not null default 0,
  area_code      text,
  product_id     uuid references public.ops_products(id) on delete set null,
  kind           text not null default 'other',
  name           text not null,
  detail         text,
  measure        text not null default 'sqft',
  sqft           numeric(12,2),
  lf             numeric(12,2),
  height_ft      numeric(8,2),
  qty            numeric(12,2),
  depth_in       numeric(6,2),
  r_value        numeric(6,1),
  framing        text,
  hours          numeric(10,2),
  units          numeric(12,3),
  unit           text,
  bf             numeric(14,1),
  price          numeric(12,2) not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists ops_job_lines_job_idx on public.ops_job_lines(job_id, sort);
create index if not exists ops_job_lines_trip_idx on public.ops_job_lines(trip_id);

create table if not exists public.ops_trip_crew (
  trip_id     uuid not null references public.ops_trips(id) on delete cascade,
  crew_id     uuid not null references public.ops_crew(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  lead        boolean not null default false,
  primary key (trip_id, crew_id)
);

-- How a quote became a sale: signed online, or recorded by the office (paper, in person).
alter table public.ops_quotes add column if not exists signed_method text;
alter table public.ops_quotes add column if not exists signed_note text;
alter table public.ops_quotes add column if not exists signed_by_name text;
update public.ops_quotes set signed_method = 'online' where status = 'signed' and signed_method is null;

-- ---------- Stock -------------------------------------------------------------------------------
-- One row per place (a shop or a rig), item and lot. item_key is the AMBIT SKU ("ISO", "AMB-SEAL-50",
-- a fiberglass SKU) or "ops:<product id>" for something not bought from AMBIT. ISO drums keep their
-- maker (Covestro, Wanhua). Drums can be partial (0.5).
create table if not exists public.ops_stock (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  place_kind      text not null,
  place_id        uuid not null,
  item_key        text not null,
  product_id      uuid references public.products(id) on delete set null,
  ops_product_id  uuid references public.ops_products(id) on delete set null,
  name            text not null,
  unit            text not null default 'each',
  maker           text not null default '',
  lot_no          text not null default '',
  qty             numeric(12,2) not null default 0,
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.ops_stock add constraint ops_stock_place_check check (place_kind in ('location', 'rig'));
exception when duplicate_object then null; end $$;
create unique index if not exists ops_stock_key_idx on public.ops_stock(company_id, place_kind, place_id, item_key, maker, lot_no);
create index if not exists ops_stock_company_idx on public.ops_stock(company_id, item_key);

create table if not exists public.ops_stock_moves (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null,       -- ambit_delivery | received | count | adjust | move | used
  item_key    text not null,
  name        text not null,
  unit        text,
  maker       text not null default '',
  lot_no      text not null default '',
  qty         numeric(12,2) not null,
  from_kind   text,
  from_id     uuid,
  to_kind     text,
  to_id       uuid,
  order_id    uuid,
  trip_id     uuid,
  note        text,
  by_name     text
);
create index if not exists ops_stock_moves_company_idx on public.ops_stock_moves(company_id, at desc);
create index if not exists ops_stock_moves_order_idx on public.ops_stock_moves(order_id) where order_id is not null;

-- Reorder points: when the shop and rigs together get down to this, it shows as low.
create table if not exists public.ops_stock_min (
  company_id  uuid not null references public.companies(id) on delete cascade,
  item_key    text not null,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  unit        text not null default 'each',
  min_qty     numeric(12,2) not null default 0,
  primary key (company_id, item_key)
);

-- ---------- Who sees what -----------------------------------------------------------------------
alter table public.ops_rigs        enable row level security;
alter table public.ops_crew        enable row level security;
alter table public.ops_rig_crew    enable row level security;
alter table public.ops_jobs        enable row level security;
alter table public.ops_trips       enable row level security;
alter table public.ops_job_lines   enable row level security;
alter table public.ops_trip_crew   enable row level security;
alter table public.ops_stock       enable row level security;
alter table public.ops_stock_moves enable row level security;
alter table public.ops_stock_min   enable row level security;

-- Rigs and crew names: the whole team reads them; the office and dispatch change them.
drop policy if exists ops_rigs_read  on public.ops_rigs;
drop policy if exists ops_rigs_write on public.ops_rigs;
create policy ops_rigs_read on public.ops_rigs for select to authenticated using (company_id = public.ops_company());
create policy ops_rigs_write on public.ops_rigs for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'));
drop policy if exists ops_crew_read  on public.ops_crew;
drop policy if exists ops_crew_write on public.ops_crew;
create policy ops_crew_read on public.ops_crew for select to authenticated using (company_id = public.ops_company());
create policy ops_crew_write on public.ops_crew for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'));
drop policy if exists ops_rig_crew_read  on public.ops_rig_crew;
drop policy if exists ops_rig_crew_write on public.ops_rig_crew;
create policy ops_rig_crew_read on public.ops_rig_crew for select to authenticated using (company_id = public.ops_company());
create policy ops_rig_crew_write on public.ops_rig_crew for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher')
              and rig_id in (select r.id from public.ops_rigs r) and crew_id in (select c.id from public.ops_crew c));

-- Jobs: owner, office, dispatch and accounting see all; a sales rep sees the jobs from their quotes.
-- Crews get their trips through ops_my_trips() (no prices).
drop policy if exists ops_jobs_read  on public.ops_jobs;
drop policy if exists ops_jobs_write on public.ops_jobs;
create policy ops_jobs_read on public.ops_jobs for select to authenticated
  using (company_id = public.ops_company()
         and (public.ops_is('owner', 'office', 'dispatcher', 'accounting')
              or (public.ops_is('sales') and (rep_id = auth.uid() or created_by = auth.uid()
                                              or quote_id in (select q.id from public.ops_quotes q)))));
create policy ops_jobs_write on public.ops_jobs for update to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'))
  with check (company_id = public.ops_company());
drop policy if exists ops_trips_read  on public.ops_trips;
drop policy if exists ops_trips_write on public.ops_trips;
create policy ops_trips_read on public.ops_trips for select to authenticated
  using (job_id in (select j.id from public.ops_jobs j));
create policy ops_trips_write on public.ops_trips for update to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'))
  with check (company_id = public.ops_company() and (rig_id is null or rig_id in (select r.id from public.ops_rigs r)));
drop policy if exists ops_job_lines_read on public.ops_job_lines;
create policy ops_job_lines_read on public.ops_job_lines for select to authenticated
  using (job_id in (select j.id from public.ops_jobs j));
drop policy if exists ops_trip_crew_read on public.ops_trip_crew;
create policy ops_trip_crew_read on public.ops_trip_crew for select to authenticated
  using (trip_id in (select t.id from public.ops_trips t));

-- Stock: the office, dispatch and accounting read it; changes go through the functions below.
drop policy if exists ops_stock_read on public.ops_stock;
create policy ops_stock_read on public.ops_stock for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'accounting', 'sales'));
drop policy if exists ops_stock_moves_read on public.ops_stock_moves;
create policy ops_stock_moves_read on public.ops_stock_moves for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'accounting'));
drop policy if exists ops_stock_min_read  on public.ops_stock_min;
drop policy if exists ops_stock_min_write on public.ops_stock_min;
create policy ops_stock_min_read on public.ops_stock_min for select to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'accounting', 'sales'));
create policy ops_stock_min_write on public.ops_stock_min for all to authenticated
  using (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'))
  with check (company_id = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher'));

-- ---------- Numbers and time stamps -------------------------------------------------------------
create or replace function public.ops_jobs_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.number := coalesce(new.number, public.ops_next(new.company_id, 'job'));
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ops_jobs_stamp on public.ops_jobs;
create trigger ops_jobs_stamp before insert or update on public.ops_jobs for each row execute function public.ops_jobs_stamp();
revoke all on function public.ops_jobs_stamp() from public, anon, authenticated;

drop trigger if exists ops_trips_touch on public.ops_trips;
create trigger ops_trips_touch before update on public.ops_trips for each row execute function public.ops_touch();

-- ---------- A signed quote becomes a job -----------------------------------------------------------
-- A short trip name from what's in it: "Spray foam", "Spray foam + blown-in".
create or replace function public.ops_trip_label(p_kinds text[]) returns text
language sql immutable as $$
  select coalesce(nullif(array_to_string(array(
           select distinct on (g) lbl from (
             select case when k like 'foam%' then 1 when k = 'blown' or k = 'bibs_mesh' then 2 when k = 'batt' then 3
                         when k in ('coating', 'intumescent') then 4 when k = 'removal' then 5 else 6 end as g,
                    case when k like 'foam%' then 'Spray foam' when k = 'blown' or k = 'bibs_mesh' then 'Blown-in'
                         when k = 'batt' then 'Batts' when k in ('coating', 'intumescent') then 'Coating'
                         when k = 'removal' then 'Removal' else null end as lbl
               from unnest(p_kinds) k) x
            where lbl is not null order by g), ' + '), ''), 'Trip')
$$;

-- Makes the job for a signed quote: the signed option and the add-ons the customer picked, all in
-- one trip to start. Safe to call twice (one job per quote).
create or replace function public.ops_make_job(p_quote uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  q public.ops_quotes;
  j uuid;
  t uuid;
begin
  select * into q from public.ops_quotes where id = p_quote;
  if q.id is null or q.status <> 'signed' then return null; end if;
  select id into j from public.ops_jobs where quote_id = q.id;
  if j is not null then return j; end if;
  insert into public.ops_jobs (company_id, quote_id, option_id, customer_id, property_id, lead_id, title, sold_total, rep_id, created_by)
  values (q.company_id, q.id, q.signed_option_id, q.customer_id, q.property_id, q.lead_id, q.title, q.signed_total, q.rep_id, q.created_by)
  returning id into j;
  insert into public.ops_job_lines (company_id, job_id, quote_line_id, sort, area_code, product_id, kind, name, detail, measure,
                                    sqft, lf, height_ft, qty, depth_in, r_value, framing, hours, units, unit, bf, price)
  select q.company_id, j, l.id, l.sort + case when l.option_id is null then 1000 else 0 end, l.area_code, l.product_id, l.kind, l.name, l.detail,
         l.measure, l.sqft, l.lf, l.height_ft, l.qty, l.depth_in, l.r_value, l.framing, l.hours, l.units, l.unit, l.bf, l.price
    from public.ops_quote_lines l
   where l.quote_id = q.id
     and (l.option_id = q.signed_option_id or (l.option_id is null and l.id = any(coalesce(q.signed_addons, '{}'))))
     and l.kind not in ('credit');
  insert into public.ops_trips (company_id, job_id, seq, name)
  values (q.company_id, j, 1, public.ops_trip_label(array(select kind from public.ops_job_lines where job_id = j)))
  returning id into t;
  update public.ops_job_lines set trip_id = t where job_id = j;
  return j;
end $$;
revoke all on function public.ops_make_job(uuid) from public, anon, authenticated;

-- Signing online also makes the job (same as 0032, plus the last step and how it was signed).
create or replace function public.ops_proposal_sign(p_token text, p_option uuid, p_addons uuid[], p_name text, p_email text,
                                                    p_signature text, p_ip text, p_ua text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  q public.ops_quotes;
  opt text;
  adds uuid[];
  total numeric;
begin
  select * into q from public.ops_quotes where public_token = p_token and coalesce(length(p_token), 0) >= 32 for update;
  if q.id is null then raise exception 'This proposal link isn''t valid.'; end if;
  if q.status = 'signed' then raise exception 'This proposal is already signed.'; end if;
  if q.status = 'declined' then raise exception 'This proposal was declined. Ask for a new one.'; end if;
  if q.status not in ('sent', 'viewed') then raise exception 'This proposal isn''t ready to sign.'; end if;
  if q.valid_until is not null and q.valid_until < (now() at time zone 'America/Chicago')::date then
    raise exception 'This proposal ran out on %. Ask for an updated one.', to_char(q.valid_until, 'Mon DD, YYYY');
  end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'Type your full name to sign.'; end if;
  if coalesce(length(p_signature), 0) < 50 or length(p_signature) > 300000 or p_signature !~ '^data:image/png;base64,' then
    raise exception 'Draw your signature in the box.';
  end if;
  select name into opt from public.ops_quote_options where id = p_option and quote_id = q.id;
  if opt is null then raise exception 'Pick one of the options.'; end if;
  adds := coalesce((select array_agg(l.id) from public.ops_quote_lines l
                     where l.quote_id = q.id and l.option_id is null and l.id = any(coalesce(p_addons, '{}'))), '{}');
  total := coalesce((q.totals->'options'->(p_option::text)->>'total')::numeric, 0)
         + coalesce((select sum(coalesce((q.totals->'addons'->(a::text)->>'total')::numeric, 0)) from unnest(adds) a), 0);
  update public.ops_quotes set
    status = 'signed', signed_at = now(), signed_name = left(trim(p_name), 120), signed_email = left(nullif(trim(lower(p_email)), ''), 160),
    signature = p_signature, signed_option_id = p_option, signed_addons = adds, signed_method = 'online',
    signed_total = round(total, 2), signed_ip = left(p_ip, 60), signed_ua = left(p_ua, 300)
  where id = q.id;
  if q.lead_id is not null then
    update public.ops_leads set stage = 'won' where id = q.lead_id and stage <> 'won';
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by_name)
    values (q.company_id, q.lead_id, q.customer_id, 'system',
            'Quote #' || q.number || ' signed by ' || left(trim(p_name), 120) || ': ' || opt || ', $' || to_char(round(total, 2), 'FM999,999,990.00'),
            'Proposal');
  end if;
  perform public.ops_make_job(q.id);
  return true;
end $$;

-- The customer said yes another way (a signed paper proposal, in person, by phone). The office
-- records it; it counts as signed and the job is made.
create or replace function public.ops_quote_mark_sold(p_quote uuid, p_option uuid, p_addons uuid[], p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  q public.ops_quotes;
  opt text;
  adds uuid[];
  total numeric;
  who text := coalesce(public.my_name(), 'The office');
  cust text;
begin
  select * into q from public.ops_quotes where id = p_quote and company_id = public.ops_company() for update;
  if q.id is null then raise exception 'Quote not found.'; end if;
  if not (public.ops_is('owner', 'office', 'dispatcher')
          or (public.ops_is('sales') and (q.rep_id = auth.uid() or q.created_by = auth.uid()))) then
    raise exception 'You can''t mark this quote sold.';
  end if;
  if q.status = 'signed' then raise exception 'This quote is already signed.'; end if;
  if q.status = 'declined' then raise exception 'The customer declined this quote. Make a copy for a new one.'; end if;
  if q.needs_approval and q.approved_at is null and not public.ops_is('owner', 'office') then
    raise exception 'This quote is under your lowest margin. The owner needs to approve it first.';
  end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say how the customer said yes (for example "Signed the paper proposal").'; end if;
  select name into opt from public.ops_quote_options where id = p_option and quote_id = q.id;
  if opt is null then raise exception 'Pick the option they chose.'; end if;
  adds := coalesce((select array_agg(l.id) from public.ops_quote_lines l
                     where l.quote_id = q.id and l.option_id is null and l.id = any(coalesce(p_addons, '{}'))), '{}');
  total := coalesce((q.totals->'options'->(p_option::text)->>'total')::numeric, 0)
         + coalesce((select sum(coalesce((q.totals->'addons'->(a::text)->>'total')::numeric, 0)) from unnest(adds) a), 0);
  select name into cust from public.ops_customers where id = q.customer_id;
  update public.ops_quotes set
    status = 'signed', signed_at = now(), signed_name = left(coalesce(cust, 'The customer'), 120),
    signed_option_id = p_option, signed_addons = adds, signed_total = round(total, 2),
    signed_method = 'office', signed_note = left(trim(p_note), 300), signed_by_name = who
  where id = q.id;
  if q.lead_id is not null then
    update public.ops_leads set stage = 'won' where id = q.lead_id and stage <> 'won';
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by, created_by_name)
    values (q.company_id, q.lead_id, q.customer_id, 'system',
            'Quote #' || q.number || ' sold: ' || opt || ', $' || to_char(round(total, 2), 'FM999,999,990.00') || ' (' || left(trim(p_note), 200) || ')',
            auth.uid(), who);
  end if;
  return public.ops_make_job(q.id);
end $$;

-- For a quote that was signed before jobs existed.
create or replace function public.ops_quote_make_job(p_quote uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can make jobs.'; end if;
  if not exists (select 1 from public.ops_quotes where id = p_quote and company_id = public.ops_company() and status = 'signed') then
    raise exception 'Only a signed quote becomes a job.';
  end if;
  return public.ops_make_job(p_quote);
end $$;

-- Every quote already signed gets its job now.
do $$ declare r record; begin
  for r in select q.id from public.ops_quotes q where q.status = 'signed' and not exists (select 1 from public.ops_jobs j where j.quote_id = q.id) loop
    perform public.ops_make_job(r.id);
  end loop;
end $$;

-- ---------- Trips: split, schedule, crew ----------------------------------------------------------
-- Moves the picked lines into another trip (p_trip null = a new trip). Unscheduled trips left empty go away.
create or replace function public.ops_lines_to_trip(p_lines uuid[], p_trip uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  co uuid := public.ops_company();
  jid uuid;
  t uuid := p_trip;
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can change trips.'; end if;
  select distinct job_id into jid from public.ops_job_lines where id = any(p_lines) and company_id = co;
  if jid is null then raise exception 'Pick the work to move.'; end if;
  if (select count(distinct job_id) from public.ops_job_lines where id = any(p_lines)) > 1 then raise exception 'Those lines are on different jobs.'; end if;
  if exists (select 1 from public.ops_job_lines l join public.ops_trips tr on tr.id = l.trip_id
              where l.id = any(p_lines) and tr.status in ('in_progress', 'done')) then
    raise exception 'Some of that work is already started or done.';
  end if;
  if t is null then
    insert into public.ops_trips (company_id, job_id, seq, name)
    values (co, jid, coalesce((select max(seq) from public.ops_trips where job_id = jid), 0) + 1, 'Trip')
    returning id into t;
  elsif not exists (select 1 from public.ops_trips where id = t and job_id = jid and status in ('unscheduled', 'scheduled')) then
    raise exception 'That trip can''t take more work.';
  end if;
  update public.ops_job_lines set trip_id = t where id = any(p_lines) and job_id = jid;
  if nullif(trim(coalesce(p_name, '')), '') is not null then
    update public.ops_trips set name = left(trim(p_name), 80), name_auto = false where id = t;
  end if;
  -- Names follow what's in each trip unless someone typed one.
  update public.ops_trips tr
     set name = public.ops_trip_label(array(select kind from public.ops_job_lines where trip_id = tr.id))
   where tr.job_id = jid and tr.name_auto
     and exists (select 1 from public.ops_job_lines l where l.trip_id = tr.id);
  delete from public.ops_trips tr
   where tr.job_id = jid and tr.status = 'unscheduled'
     and not exists (select 1 from public.ops_job_lines l where l.trip_id = tr.id);
  return t;
end $$;

-- Puts a trip on a rig: start day, how many days, an optional start time. The rig's regular crew
-- goes on the trip unless the trip already has one (or a crew is given).
create or replace function public.ops_trip_schedule(p_trip uuid, p_rig uuid, p_start date, p_days int, p_time time, p_crew uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  co uuid := public.ops_company();
  tr public.ops_trips;
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can schedule.'; end if;
  select * into tr from public.ops_trips where id = p_trip and company_id = co for update;
  if tr.id is null then raise exception 'Trip not found.'; end if;
  if tr.status in ('done', 'cancelled') then raise exception 'This trip is finished.'; end if;
  if p_rig is not null and not exists (select 1 from public.ops_rigs where id = p_rig and company_id = co) then raise exception 'Rig not found.'; end if;
  if p_start is null then raise exception 'Pick a day.'; end if;
  update public.ops_trips set rig_id = p_rig, start_date = p_start, days = greatest(1, least(coalesce(p_days, 1), 60)),
         start_time = p_time, status = case when status = 'in_progress' then status else 'scheduled' end,
         scheduled_by_name = public.my_name(), scheduled_at = now()
   where id = tr.id;
  if p_crew is not null then
    delete from public.ops_trip_crew where trip_id = tr.id and crew_id <> all(p_crew);
    insert into public.ops_trip_crew (trip_id, crew_id, company_id, lead)
    select tr.id, c.id, co, false from public.ops_crew c where c.id = any(p_crew) and c.company_id = co
    on conflict do nothing;
  elsif p_rig is not null and not exists (select 1 from public.ops_trip_crew where trip_id = tr.id) then
    insert into public.ops_trip_crew (trip_id, crew_id, company_id, lead)
    select tr.id, rc.crew_id, co, rc.lead from public.ops_rig_crew rc join public.ops_crew c on c.id = rc.crew_id and c.active
     where rc.rig_id = p_rig
    on conflict do nothing;
  end if;
end $$;

create or replace function public.ops_trip_unschedule(p_trip uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can schedule.'; end if;
  update public.ops_trips set status = 'unscheduled', start_date = null, start_time = null, rig_id = null
   where id = p_trip and company_id = public.ops_company() and status = 'scheduled';
  delete from public.ops_trip_crew where trip_id = p_trip and trip_id in (select id from public.ops_trips where status = 'unscheduled');
end $$;

-- The crew on a trip (and who leads it).
create or replace function public.ops_trip_set_crew(p_trip uuid, p_crew uuid[], p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := public.ops_company();
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can set crews.'; end if;
  if not exists (select 1 from public.ops_trips where id = p_trip and company_id = co) then raise exception 'Trip not found.'; end if;
  delete from public.ops_trip_crew where trip_id = p_trip;
  insert into public.ops_trip_crew (trip_id, crew_id, company_id, lead)
  select p_trip, c.id, co, c.id = p_lead from public.ops_crew c where c.id = any(coalesce(p_crew, '{}')) and c.company_id = co;
end $$;

-- A rig's regular crew.
create or replace function public.ops_rig_set_crew(p_rig uuid, p_crew uuid[], p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := public.ops_company();
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can set crews.'; end if;
  if not exists (select 1 from public.ops_rigs where id = p_rig and company_id = co) then raise exception 'Rig not found.'; end if;
  delete from public.ops_rig_crew where rig_id = p_rig;
  insert into public.ops_rig_crew (rig_id, crew_id, company_id, lead)
  select p_rig, c.id, co, c.id = p_lead from public.ops_crew c where c.id = any(coalesce(p_crew, '{}')) and c.company_id = co;
end $$;

-- Adds the team's crew logins to the crew list (crew leads, crew members, subs), once each.
create or replace function public.ops_crew_sync() returns int
language plpgsql security definer set search_path = public as $$
declare co uuid := public.ops_company(); n int;
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then return 0; end if;
  insert into public.ops_crew (company_id, profile_id, name, phone)
  select co, p.id, coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)), p.phone
    from public.profiles p
   where p.company_id = co and p.role = 'customer' and p.status = 'active' and p.ops_role in ('crew_lead', 'crew', 'sub')
     and not exists (select 1 from public.ops_crew c where c.company_id = co and c.profile_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- What a crew member sees: their next days of trips, no prices ---------------------------
create or replace function public.ops_my_trips(p_days int default 7) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select c.id from public.ops_crew c where c.company_id = public.ops_company() and c.profile_id = auth.uid() and c.active
  ), today as (select (now() at time zone 'America/Chicago')::date as d)
  select coalesce(jsonb_agg(x order by x->>'start_date', x->>'start_time'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', t.id, 'name', t.name, 'start_date', t.start_date, 'end_date', t.end_date, 'days', t.days, 'start_time', t.start_time,
      'status', t.status, 'notes', t.notes, 'job_number', j.number, 'crew_notes', j.crew_notes,
      'customer', cu.name, 'phone', cu.phone,
      'address', nullif(concat_ws(', ', pr.street, pr.city, pr.state), ''), 'gate_code', pr.gate_code, 'property_notes', pr.notes,
      'rig', r.name,
      'crew', (select jsonb_agg(jsonb_build_object('name', c.name, 'lead', tc.lead) order by tc.lead desc, c.name)
                 from public.ops_trip_crew tc join public.ops_crew c on c.id = tc.crew_id where tc.trip_id = t.id),
      'work', (select jsonb_agg(jsonb_build_object('area', l.area_code, 'name', l.name, 'detail', l.detail, 'sqft', l.sqft,
                                                   'depth_in', l.depth_in, 'r_value', l.r_value, 'units', l.units, 'unit', l.unit, 'kind', l.kind)
                                 order by l.sort)
                 from public.ops_job_lines l where l.trip_id = t.id)) as x
      from public.ops_trips t
      join public.ops_jobs j on j.id = t.job_id
      join public.ops_customers cu on cu.id = j.customer_id
      left join public.ops_properties pr on pr.id = j.property_id
      left join public.ops_rigs r on r.id = t.rig_id
     where t.company_id = public.ops_company()
       and t.status in ('scheduled', 'in_progress')
       and t.end_date >= (select d from today) and t.start_date <= (select d from today) + greatest(1, least(coalesce(p_days, 7), 14)) - 1
       and exists (select 1 from public.ops_trip_crew tc where tc.trip_id = t.id and tc.crew_id in (select id from me))
  ) s
$$;

-- ---------- Stock changes ------------------------------------------------------------------------
create or replace function public.ops_place_ok(p_company uuid, p_kind text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
           when 'location' then exists (select 1 from public.ops_locations where id = p_id and company_id = p_company)
           when 'rig' then exists (select 1 from public.ops_rigs where id = p_id and company_id = p_company)
           else false end
$$;

-- Adds (or takes away, with a negative qty) stock at a place and writes it in the log.
create or replace function public.ops_stock_bump(p_company uuid, p_kind text, p_place uuid, p_item jsonb, p_maker text, p_lot text,
                                                 p_qty numeric, p_move text, p_note text, p_order uuid, p_trip uuid, p_by text) returns void
language plpgsql security definer set search_path = public as $$
declare
  k text := upper(trim(coalesce(p_item->>'item_key', '')));
begin
  if k = '' or coalesce(p_qty, 0) = 0 then return; end if;
  insert into public.ops_stock (company_id, place_kind, place_id, item_key, product_id, ops_product_id, name, unit, maker, lot_no, qty)
  values (p_company, p_kind, p_place, k, nullif(p_item->>'product_id', '')::uuid, nullif(p_item->>'ops_product_id', '')::uuid,
          left(coalesce(nullif(trim(p_item->>'name'), ''), k), 160), coalesce(nullif(p_item->>'unit', ''), 'each'),
          left(trim(coalesce(p_maker, '')), 40), left(trim(coalesce(p_lot, '')), 60), p_qty)
  on conflict (company_id, place_kind, place_id, item_key, maker, lot_no)
  do update set qty = public.ops_stock.qty + excluded.qty, updated_at = now(),
                name = coalesce(nullif(excluded.name, ''), public.ops_stock.name);
  delete from public.ops_stock where company_id = p_company and place_kind = p_kind and place_id = p_place and item_key = k
     and maker = left(trim(coalesce(p_maker, '')), 40) and lot_no = left(trim(coalesce(p_lot, '')), 60) and qty = 0;
  insert into public.ops_stock_moves (company_id, kind, item_key, name, unit, maker, lot_no, qty, from_kind, from_id, to_kind, to_id, order_id, trip_id, note, by_name)
  values (p_company, p_move, k, left(coalesce(nullif(trim(p_item->>'name'), ''), k), 160), p_item->>'unit',
          left(trim(coalesce(p_maker, '')), 40), left(trim(coalesce(p_lot, '')), 60), abs(p_qty),
          case when p_qty < 0 then p_kind end, case when p_qty < 0 then p_place end,
          case when p_qty > 0 then p_kind end, case when p_qty > 0 then p_place end,
          p_order, p_trip, left(p_note, 300), p_by);
end $$;
revoke all on function public.ops_stock_bump(uuid, text, uuid, jsonb, text, text, numeric, text, text, uuid, uuid, text) from public, anon, authenticated;

-- Stock that came in some other way, or a starting count.
create or replace function public.ops_stock_add(p_kind text, p_place uuid, p_item jsonb, p_maker text, p_lot text, p_qty numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := public.ops_company();
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can change stock.'; end if;
  if not public.ops_place_ok(co, p_kind, p_place) then raise exception 'Pick the shop or rig.'; end if;
  if coalesce(p_qty, 0) <= 0 or p_qty > 100000 then raise exception 'Type how many.'; end if;
  perform public.ops_stock_bump(co, p_kind, p_place, p_item, p_maker, p_lot, p_qty, 'received', coalesce(nullif(trim(p_note), ''), 'Added by hand'), null, null, public.my_name());
end $$;

-- A count: sets one stock row to what's really there.
create or replace function public.ops_stock_count(p_stock uuid, p_qty numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.ops_stock;
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can change stock.'; end if;
  select * into s from public.ops_stock where id = p_stock and company_id = public.ops_company() for update;
  if s.id is null then raise exception 'Not found.'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Type what''s there.'; end if;
  perform public.ops_stock_bump(s.company_id, s.place_kind, s.place_id,
          jsonb_build_object('item_key', s.item_key, 'product_id', s.product_id, 'ops_product_id', s.ops_product_id, 'name', s.name, 'unit', s.unit),
          s.maker, s.lot_no, p_qty - s.qty, 'count', coalesce(nullif(trim(p_note), ''), 'Counted'), null, null, public.my_name());
end $$;

-- Moves stock between the shop and a rig (or rig to rig).
create or replace function public.ops_stock_move(p_stock uuid, p_to_kind text, p_to uuid, p_qty numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.ops_stock;
  item jsonb;
  who text := public.my_name();
begin
  if not public.ops_is('owner', 'office', 'dispatcher') then raise exception 'Only the office or dispatch can move stock.'; end if;
  select * into s from public.ops_stock where id = p_stock and company_id = public.ops_company() for update;
  if s.id is null then raise exception 'Not found.'; end if;
  if not public.ops_place_ok(s.company_id, p_to_kind, p_to) then raise exception 'Pick where it goes.'; end if;
  if s.place_kind = p_to_kind and s.place_id = p_to then raise exception 'It''s already there.'; end if;
  if coalesce(p_qty, 0) <= 0 or p_qty > s.qty then raise exception 'Move between 0 and %.', s.qty; end if;
  item := jsonb_build_object('item_key', s.item_key, 'product_id', s.product_id, 'ops_product_id', s.ops_product_id, 'name', s.name, 'unit', s.unit);
  update public.ops_stock set qty = qty - p_qty, updated_at = now() where id = s.id;
  delete from public.ops_stock where id = s.id and qty = 0;
  insert into public.ops_stock (company_id, place_kind, place_id, item_key, product_id, ops_product_id, name, unit, maker, lot_no, qty)
  values (s.company_id, p_to_kind, p_to, s.item_key, s.product_id, s.ops_product_id, s.name, s.unit, s.maker, s.lot_no, p_qty)
  on conflict (company_id, place_kind, place_id, item_key, maker, lot_no)
  do update set qty = public.ops_stock.qty + excluded.qty, updated_at = now();
  insert into public.ops_stock_moves (company_id, kind, item_key, name, unit, maker, lot_no, qty, from_kind, from_id, to_kind, to_id, by_name)
  values (s.company_id, 'move', s.item_key, s.name, s.unit, s.maker, s.lot_no, p_qty, s.place_kind, s.place_id, p_to_kind, p_to, who);
end $$;

-- ---------- AMBIT orders land in the contractor's shop -----------------------------------------------
-- When AMBIT marks an order picked up or delivered, its items go into the contractor's first shop:
-- foam by the lots AMBIT loaded (ISO by maker), the rest by item. Guns, parts and tools aren't stock.
create or replace function public.ops_ambit_delivery(p_order uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  loc uuid;
  it record;
  ln record;
  rest numeric;
  n int := 0;
  base text;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.company_id is null or o.status <> 'completed' then return 0; end if;
  if not exists (select 1 from public.companies where id = o.company_id and ops_enabled) then return 0; end if;
  if exists (select 1 from public.ops_stock_moves where order_id = o.id and kind = 'ambit_delivery') then return 0; end if;
  select id into loc from public.ops_locations where company_id = o.company_id order by sort, created_at limit 1;
  if loc is null then return 0; end if;
  for it in
    select i.* from public.order_items i
      left join public.products p on p.id = i.product_id
     where i.order_id = o.id and coalesce(i.qty, 0) > 0
       and coalesce(p.category_id, '') not in ('guns-and-parts', 'guns-parts', 'tools-and-accessories')
  loop
    base := upper(trim(coalesce(it.sku, '')));
    if base = '' then continue; end if;
    rest := it.qty;
    for ln in
      select l.sku, coalesce(l.lot_no, '') as lot_no, sum(l.qty) as qty
        from public.inventory_lines l
       where l.order_item_id = it.id and coalesce(l.state, '') <> 'cancelled' and coalesce(l.lot_no, '') <> ''
       group by l.sku, coalesce(l.lot_no, '')
    loop
      perform public.ops_stock_bump(o.company_id, 'location', loc,
              jsonb_build_object('item_key', case when upper(ln.sku) like 'ISO-%' or base like 'ISO-%' then 'ISO' else base end,
                                 'product_id', it.product_id, 'name', it.name, 'unit', it.unit),
              case when upper(ln.sku) like 'ISO-%' then initcap(lower(substr(ln.sku, 5))) else '' end,
              ln.lot_no, least(ln.qty, rest), 'ambit_delivery', 'AMBIT order ORD-' || o.order_no, o.id, null, 'AMBIT');
      rest := rest - least(ln.qty, rest);
      n := n + 1;
    end loop;
    if rest > 0 then
      perform public.ops_stock_bump(o.company_id, 'location', loc,
              jsonb_build_object('item_key', case when base like 'ISO-%' then 'ISO' else base end, 'product_id', it.product_id, 'name', it.name, 'unit', it.unit),
              case when base like 'ISO-%' then initcap(lower(substr(base, 5))) else '' end,
              '', rest, 'ambit_delivery', 'AMBIT order ORD-' || o.order_no, o.id, null, 'AMBIT');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ops_ambit_delivery(uuid) from public, anon, authenticated;

create or replace function public.ops_orders_delivered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.ops_ambit_delivery(new.id);
  end if;
  return new;
end $$;
drop trigger if exists ops_orders_delivered on public.orders;
create trigger ops_orders_delivered after update of status on public.orders
  for each row execute function public.ops_orders_delivered();
revoke all on function public.ops_orders_delivered() from public, anon, authenticated;

-- ---------- Who can call what ------------------------------------------------------------------
revoke all on function public.ops_quote_mark_sold(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.ops_quote_mark_sold(uuid, uuid, uuid[], text) to authenticated;
revoke all on function public.ops_quote_make_job(uuid) from public, anon;
grant execute on function public.ops_quote_make_job(uuid) to authenticated;
revoke all on function public.ops_lines_to_trip(uuid[], uuid, text) from public, anon;
grant execute on function public.ops_lines_to_trip(uuid[], uuid, text) to authenticated;
revoke all on function public.ops_trip_schedule(uuid, uuid, date, int, time, uuid[]) from public, anon;
grant execute on function public.ops_trip_schedule(uuid, uuid, date, int, time, uuid[]) to authenticated;
revoke all on function public.ops_trip_unschedule(uuid) from public, anon;
grant execute on function public.ops_trip_unschedule(uuid) to authenticated;
revoke all on function public.ops_trip_set_crew(uuid, uuid[], uuid) from public, anon;
grant execute on function public.ops_trip_set_crew(uuid, uuid[], uuid) to authenticated;
revoke all on function public.ops_rig_set_crew(uuid, uuid[], uuid) from public, anon;
grant execute on function public.ops_rig_set_crew(uuid, uuid[], uuid) to authenticated;
revoke all on function public.ops_crew_sync() from public, anon;
grant execute on function public.ops_crew_sync() to authenticated;
revoke all on function public.ops_my_trips(int) from public, anon;
grant execute on function public.ops_my_trips(int) to authenticated;
revoke all on function public.ops_place_ok(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.ops_stock_add(text, uuid, jsonb, text, text, numeric, text) from public, anon;
grant execute on function public.ops_stock_add(text, uuid, jsonb, text, text, numeric, text) to authenticated;
revoke all on function public.ops_stock_count(uuid, numeric, text) from public, anon;
grant execute on function public.ops_stock_count(uuid, numeric, text) to authenticated;
revoke all on function public.ops_stock_move(uuid, text, uuid, numeric) from public, anon;
grant execute on function public.ops_stock_move(uuid, text, uuid, numeric) to authenticated;

select 'AMBIT-OPS scheduling, rigs and stock ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0034 - Deleted orders go to a log that can be undone
-- * Deleting an order no longer erases it. The whole order (its lines, the lots it was holding, its
--   files and item changes) is saved in the Deleted orders log first, then taken out of the app.
-- * Only the order keepers (Jeremiah) see that log and can put an order back: same order #, same
--   lines and lots, and (by default) open again with its stock reserved again.
-- * Cancelling remembers where the order was (New or Processing), so putting it back returns it there.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.orders add column if not exists status_before_cancel text;

-- ---------- Who can see the log and undo a delete -------------------------------------------------
-- No policies on purpose: nobody can read or change this list from the app; only the functions below use it.
create table if not exists public.order_keepers (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  added_at    timestamptz not null default now()
);
alter table public.order_keepers enable row level security;
insert into public.order_keepers (profile_id)
select id from public.profiles where lower(email) = 'jeremiah.bryant@ambitpu.com'
on conflict do nothing;

create or replace function public.is_order_keeper() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_keepers k join public.profiles p on p.id = k.profile_id
                  where k.profile_id = auth.uid() and p.status = 'active')
$$;

-- ---------- The log -----------------------------------------------------------------------------
create table if not exists public.orders_deleted (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null,
  order_no           bigint not null,
  company_name       text,
  placed_by_name     text,
  placed_at          timestamptz,
  status_before      text,             -- where it was before it was cancelled (new / processing)
  cancel_reason      text,
  cancelled_by_name  text,
  cancelled_at       timestamptz,
  est_subtotal       numeric(12,2),
  item_count         int,
  snapshot           jsonb not null,   -- order, items, lines, variances, files, drafts
  deleted_at         timestamptz not null default now(),
  deleted_by         uuid,
  deleted_by_name    text,
  restored_at        timestamptz,
  restored_by_name   text
);
create index if not exists orders_deleted_at_idx on public.orders_deleted (deleted_at desc);
alter table public.orders_deleted enable row level security;
drop policy if exists orders_deleted_keepers on public.orders_deleted;
create policy orders_deleted_keepers on public.orders_deleted for select to authenticated
  using (public.is_order_keeper());

-- ---------- Cancel: remember where the order was ----------------------------------------------------
-- Same as 0022, plus status_before_cancel.
create or replace function public.order_cancel(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or public.has_perm('order_desk')
          or (o.placed_by = auth.uid() and o.ambit_po is null)) then
    raise exception 'Only an admin or the order desk can cancel this order now.';
  end if;
  if o.status = 'cancelled' then raise exception 'This order is already cancelled.'; end if;
  if o.status = 'completed' then raise exception 'This order is already picked up or delivered.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the order is cancelled.'; end if;
  update public.orders
     set status = 'cancelled', cancel_reason = left(trim(p_reason), 500),
         cancelled_by_name = public.my_name(), cancelled_at = now(),
         status_before_cancel = o.status::text
   where id = p_order;
end $$;

-- ---------- Delete: save everything to the log, then take it out of the app --------------------------
create or replace function public.order_delete(p_order uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.is_admin() then raise exception 'Only admins can delete orders.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'cancelled' then raise exception 'Cancel the order first, then delete it.'; end if;
  if exists (select 1 from public.inventory_lines l where l.order_id = p_order and l.sheet_row is not null and l.needs_write) then
    raise exception 'The inventory spreadsheet is still being updated for this order. Try again in a couple of minutes.';
  end if;
  insert into public.orders_deleted (order_id, order_no, company_name, placed_by_name, placed_at, status_before, cancel_reason,
                                     cancelled_by_name, cancelled_at, est_subtotal, item_count, snapshot, deleted_by, deleted_by_name)
  values (o.id, o.order_no, o.company_name, o.placed_by_name, o.created_at, o.status_before_cancel, o.cancel_reason,
          o.cancelled_by_name, o.cancelled_at, o.est_subtotal,
          (select count(*) from public.order_items x where x.order_id = o.id),
          jsonb_build_object(
            'order',     to_jsonb(o),
            'items',     coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.order_items x where x.order_id = o.id), '[]'::jsonb),
            'lines',     coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.inventory_lines x where x.order_id = o.id), '[]'::jsonb),
            'variances', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.order_variances x where x.order_id = o.id), '[]'::jsonb),
            'files',     coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.order_files x where x.order_id = o.id), '[]'::jsonb),
            'drafts',    coalesce((select jsonb_agg(x.id) from public.order_drafts x where x.order_id = o.id), '[]'::jsonb)),
          auth.uid(), public.my_name());
  delete from public.orders where id = p_order;
  return 'ORD-' || o.order_no;
end $$;

-- ---------- Putting it back ------------------------------------------------------------------------
-- Inserts saved rows into a table exactly as they were (same ids). Columns added since the save are left
-- to their defaults; generated columns are worked out again.
create or replace function public.restore_rows(p_table regclass, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  cols text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return; end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and (p_rows->0) ? a.attname;
  if cols is null then return; end if;
  execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, $1)',
                 p_table, cols, cols, p_table)
    using p_rows;
end $$;

-- Back to New / Processing (where it was before it was cancelled); the inventory trigger holds its stock again.
create or replace function public.order_reopen_now(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders
     set status = case when status_before_cancel in ('new', 'processing') then status_before_cancel else 'new' end::public.order_status,
         cancel_reason = null, cancelled_by_name = null, cancelled_at = null, status_before_cancel = null
   where id = p_order and status = 'cancelled';
end $$;

create or replace function public.order_restore(p_log uuid, p_reopen boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare
  d public.orders_deleted;
  s jsonb;
begin
  if not public.is_order_keeper() then raise exception 'Only Jeremiah can put deleted orders back.'; end if;
  select * into d from public.orders_deleted where id = p_log for update;
  if d.id is null then raise exception 'That deleted order wasn''t found.'; end if;
  if d.restored_at is not null then raise exception 'ORD-% is already back in the app.', d.order_no; end if;
  if exists (select 1 from public.orders where id = d.order_id) then raise exception 'That order is already in the app.'; end if;
  if exists (select 1 from public.orders where order_no = d.order_no) then
    raise exception 'Another order is using ORD-% now, so this one can''t take it back.', d.order_no;
  end if;
  s := d.snapshot;
  perform public.restore_rows('public.orders', jsonb_build_array(s->'order'));
  perform public.restore_rows('public.order_items', s->'items');      -- a cancelled order doesn't pick stock here
  perform public.restore_rows('public.inventory_lines', s->'lines');   -- its own lines and lots come back instead
  perform public.restore_rows('public.order_variances', s->'variances');
  perform public.restore_rows('public.order_files', s->'files');
  update public.order_drafts set order_id = d.order_id
   where order_id is null and id in (select x::uuid from jsonb_array_elements_text(coalesce(s->'drafts', '[]'::jsonb)) x);
  update public.orders_deleted set restored_at = now(), restored_by_name = public.my_name() where id = d.id;
  if p_reopen then perform public.order_reopen_now(d.order_id); end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = s->'order'->>'branch_id';
  return 'ORD-' || d.order_no;
end $$;

-- ---------- Who can call what ------------------------------------------------------------------
revoke all on function public.restore_rows(regclass, jsonb) from public, anon, authenticated;
revoke all on function public.order_reopen_now(uuid) from public, anon, authenticated;
revoke all on function public.is_order_keeper() from public, anon;
grant execute on function public.is_order_keeper() to authenticated;
revoke all on function public.order_restore(uuid, boolean) from public, anon;
grant execute on function public.order_restore(uuid, boolean) to authenticated;
revoke execute on function public.order_cancel(uuid, text) from public, anon;
revoke execute on function public.order_delete(uuid) from public, anon;
grant execute on function public.order_cancel(uuid, text) to authenticated;
grant execute on function public.order_delete(uuid) to authenticated;

select 'Deleted orders log ready' as status,
       (select count(*) from public.order_keepers) as order_keepers;

-- =====================================================================
-- AMBIT Intelligence update 0035 - COD Only / No Checks Allowed
-- * Accounting ticks "COD Only" and/or "No Checks Allowed" when they release an order. The warehouse sees it on
--   the pickup / delivery step, the order desk list and the warehouse PDF (never on the customer's copy).
-- * The customer remembers it: the next order's boxes start the way they were last time.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.orders    add column if not exists pay_cod       boolean not null default false;
alter table public.orders    add column if not exists pay_no_checks boolean not null default false;
alter table public.companies add column if not exists pay_cod       boolean not null default false;
alter table public.companies add column if not exists pay_no_checks boolean not null default false;

-- Same as 0022, plus the two payment boxes (left out = unchanged, so older screens keep working).
drop function if exists public.order_credit_decision(uuid, boolean, text, boolean);
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false,
                                                        p_cod boolean default null, p_no_checks boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  ts text;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'Enter the Sales Order # first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  if p_approve and o.company_id is not null then
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') and not coalesce(p_charge_tax, false) then
      raise exception 'This customer''s tax-exempt certificate is %. Verify a current certificate first, or choose "Charge sales tax on this order".',
        case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'waiting to be verified' end;
    end if;
  end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end,
         pay_cod       = case when p_approve then coalesce(p_cod, pay_cod) else pay_cod end,
         pay_no_checks = case when p_approve then coalesce(p_no_checks, pay_no_checks) else pay_no_checks end
   where id = p_order;
  -- The customer's next order starts the same way.
  if p_approve and o.company_id is not null and (p_cod is not null or p_no_checks is not null) then
    update public.companies
       set pay_cod = coalesce(p_cod, pay_cod), pay_no_checks = coalesce(p_no_checks, pay_no_checks)
     where id = o.company_id;
  end if;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean) to authenticated;

select 'COD Only / No Checks Allowed ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0036 - AMBIT-OPS work orders (pilot week 4)
-- * Every trip gets a work order the crew fills in on their phone at the job, even with no signal
--   (the phone keeps the changes and sends them when it can; sending twice never doubles anything).
-- * Time clock: each crew member drives / on site / clocked out; a crew lead can clock the whole crew.
-- * Material: sets used with the A-side maker and lot and the B-side lot (bags for fiberglass). What's
--   used comes off the trip's rig (or its shop when the lot isn't on the rig).
-- * The Spray Job Data Log (SDL-01) for each spray day: site and substrate readings, equipment, drum
--   temps, application and yield by area, quality checks, safety and re-occupancy.
-- * Photos (before, after, issues) and the finish: the sprayer signs, the customer signs on the phone.
-- * The office reviews it; the contractor chooses (Settings > Work orders, on by default) whether
--   finished spray logs go to AMBIT tech support. AMBIT staff with "Spray job data log" read only those.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Work orders: one per trip ------------------------------------------------------------
create table if not exists public.ops_work_orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  trip_id               uuid not null references public.ops_trips(id) on delete cascade,
  job_id                uuid not null references public.ops_jobs(id) on delete cascade,
  status                text not null default 'open',     -- open | done | reviewed
  started_at            timestamptz,
  finished_at           timestamptz,
  finished_by_name      text,
  sprayer_crew_id       uuid references public.ops_crew(id) on delete set null,
  sprayer_name          text,
  sprayer_cert          text,
  sprayer_signed_at     timestamptz,
  customer_name         text,
  customer_sig          text,                              -- PNG data URL
  customer_signed_at    timestamptz,
  customer_absent       boolean not null default false,
  customer_absent_note  text,
  issue                 text,
  issue_affected        text,                              -- yes | no | unsure
  tech_contacted        boolean,
  corrective            text,
  notes                 text,
  share_ambit           boolean not null default false,
  shared_at             timestamptz,
  reviewed_by_name      text,
  reviewed_at           timestamptz,
  review_note           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
do $$ begin
  alter table public.ops_work_orders add constraint ops_work_orders_status_check check (status in ('open', 'done', 'reviewed'));
exception when duplicate_object then null; end $$;
create unique index if not exists ops_work_orders_trip_idx on public.ops_work_orders(trip_id);
create index if not exists ops_work_orders_company_idx on public.ops_work_orders(company_id, status, updated_at desc);
create index if not exists ops_work_orders_job_idx on public.ops_work_orders(job_id);
create index if not exists ops_work_orders_shared_idx on public.ops_work_orders(shared_at desc) where share_ambit;

-- The spray log for one day of the trip. Sections are kept as the form's fields (jsonb).
create table if not exists public.ops_wo_days (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  wo_id            uuid not null references public.ops_work_orders(id) on delete cascade,
  work_date        date not null,
  conditions       jsonb not null default '{}'::jsonb,   -- sky, wind, meter, readings start/mid/end, prep, primer
  equipment        jsonb not null default '{}'::jsonb,   -- proportioner, gun, chamber, hose, readings, ratio check
  material         jsonb not null default '{}'::jsonb,   -- drum temps, B-side mixed, coating
  quality          jsonb not null default '{}'::jsonb,   -- density cup, adhesion, cell structure ...
  safety           jsonb not null default '{}'::jsonb,   -- ventilation, re-entry ...
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
create unique index if not exists ops_wo_days_key on public.ops_wo_days(wo_id, work_date);

-- Time clock. The phone makes the id, so sending the same punch again only updates it.
create table if not exists public.ops_wo_time (
  id              uuid primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  wo_id           uuid not null references public.ops_work_orders(id) on delete cascade,
  crew_id         uuid not null references public.ops_crew(id) on delete cascade,
  kind            text not null default 'site',            -- drive | site
  started_at      timestamptz not null,
  ended_at        timestamptz,
  by_name         text,
  edited_by_name  text,
  edited_at       timestamptz,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.ops_wo_time add constraint ops_wo_time_kind_check check (kind in ('drive', 'site'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ops_wo_time add constraint ops_wo_time_order_check check (ended_at is null or ended_at >= started_at);
exception when duplicate_object then null; end $$;
create index if not exists ops_wo_time_wo_idx on public.ops_wo_time(wo_id, started_at);
create index if not exists ops_wo_time_crew_idx on public.ops_wo_time(crew_id, started_at desc);

-- Material used. qty is sets for foam, bags for fiberglass. taken = what came off stock (so a change
-- or a delete puts back exactly that).
create table if not exists public.ops_wo_materials (
  id              uuid primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  wo_id           uuid not null references public.ops_work_orders(id) on delete cascade,
  work_date       date,
  ops_product_id  uuid references public.ops_products(id) on delete set null,
  kind            text not null default 'other',
  name            text not null,
  unit            text not null default 'set',
  qty             numeric(10,2) not null default 0,
  a_maker         text,
  a_lot           text,
  b_key           text,
  b_lot           text,
  lot             text,
  serials         text,
  measure         jsonb,                                  -- what the crew read: lbs / gallons / stroke counter
  taken           jsonb not null default '[]'::jsonb,
  by_name         text,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists ops_wo_materials_wo_idx on public.ops_wo_materials(wo_id, created_at);

-- Application and yield, area by area (board feet = sq ft x average thickness).
create table if not exists public.ops_wo_areas (
  id              uuid primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  wo_id           uuid not null references public.ops_work_orders(id) on delete cascade,
  work_date       date,
  job_line_id     uuid references public.ops_job_lines(id) on delete set null,
  area_code       text,
  name            text,
  substrate       text,
  ops_product_id  uuid references public.ops_products(id) on delete set null,
  kind            text,
  sqft            numeric(12,1),
  thick_in        numeric(6,2),
  passes          int,
  bf              numeric(14,1) generated always as (round(coalesce(sqft, 0) * coalesce(thick_in, 0), 1)) stored,
  sort            int not null default 0,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists ops_wo_areas_wo_idx on public.ops_wo_areas(wo_id, sort);

create table if not exists public.ops_wo_photos (
  id          uuid primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  wo_id       uuid not null references public.ops_work_orders(id) on delete cascade,
  work_date   date,
  kind        text not null default 'other',              -- before | after | issue | other
  path        text not null,
  caption     text,
  taken_at    timestamptz,
  by_name     text,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now()
);
do $$ begin
  alter table public.ops_wo_photos add constraint ops_wo_photos_kind_check check (kind in ('before', 'after', 'issue', 'other'));
exception when duplicate_object then null; end $$;
create index if not exists ops_wo_photos_wo_idx on public.ops_wo_photos(wo_id, created_at);
create unique index if not exists ops_wo_photos_path_idx on public.ops_wo_photos(path);

-- ---------- Who sees what -----------------------------------------------------------------------
-- Is the signed-in person on this trip's crew?
create or replace function public.ops_my_trip(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ops_trip_crew tc join public.ops_crew c on c.id = tc.crew_id
                  where tc.trip_id = p_trip and c.profile_id = auth.uid() and c.company_id = public.ops_company())
$$;

alter table public.ops_work_orders  enable row level security;
alter table public.ops_wo_days      enable row level security;
alter table public.ops_wo_time      enable row level security;
alter table public.ops_wo_materials enable row level security;
alter table public.ops_wo_areas     enable row level security;
alter table public.ops_wo_photos    enable row level security;

-- Whoever can see the job (office, dispatch, accounting, the sales rep) or is on the trip's crew; AMBIT
-- staff with "Spray job data log" read the ones the contractor sends to AMBIT. Changes go through
-- ops_wo_sync() only.
drop policy if exists ops_work_orders_read on public.ops_work_orders;
create policy ops_work_orders_read on public.ops_work_orders for select to authenticated
  using ((company_id = public.ops_company() and (job_id in (select j.id from public.ops_jobs j) or public.ops_my_trip(trip_id)))
         or (share_ambit and public.has_perm('spray_log')));
drop policy if exists ops_wo_days_read on public.ops_wo_days;
create policy ops_wo_days_read on public.ops_wo_days for select to authenticated
  using (wo_id in (select w.id from public.ops_work_orders w));
drop policy if exists ops_wo_time_read on public.ops_wo_time;
create policy ops_wo_time_read on public.ops_wo_time for select to authenticated
  using (wo_id in (select w.id from public.ops_work_orders w));
drop policy if exists ops_wo_materials_read on public.ops_wo_materials;
create policy ops_wo_materials_read on public.ops_wo_materials for select to authenticated
  using (wo_id in (select w.id from public.ops_work_orders w));
drop policy if exists ops_wo_areas_read on public.ops_wo_areas;
create policy ops_wo_areas_read on public.ops_wo_areas for select to authenticated
  using (wo_id in (select w.id from public.ops_work_orders w));
drop policy if exists ops_wo_photos_read on public.ops_wo_photos;
create policy ops_wo_photos_read on public.ops_wo_photos for select to authenticated
  using (wo_id in (select w.id from public.ops_work_orders w));
revoke insert, update, delete on public.ops_work_orders, public.ops_wo_days, public.ops_wo_time, public.ops_wo_materials,
  public.ops_wo_areas, public.ops_wo_photos from anon, authenticated;
grant select on public.ops_work_orders, public.ops_wo_days, public.ops_wo_time, public.ops_wo_materials,
  public.ops_wo_areas, public.ops_wo_photos to authenticated;

-- Job photos: private, under <workspace>/<trip>/<photo>.jpg. The workspace's team adds and reads them;
-- AMBIT staff with "Spray job data log" read the ones on logs sent to AMBIT.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ops-photos', 'ops-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists ops_photos_insert on storage.objects;
drop policy if exists ops_photos_update on storage.objects;
drop policy if exists ops_photos_read on storage.objects;
create policy ops_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ops-photos' and split_part(name, '/', 1) = public.ops_company()::text);
create policy ops_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'ops-photos' and split_part(name, '/', 1) = public.ops_company()::text);
create policy ops_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'ops-photos'
         and (split_part(name, '/', 1) = public.ops_company()::text
              or (public.has_perm('spray_log')
                  and exists (select 1 from public.ops_wo_photos p join public.ops_work_orders w on w.id = p.wo_id
                               where p.path = storage.objects.name and w.share_ambit and not p.deleted))));

-- ---------- What the crew's phone downloads -----------------------------------------------------
-- One trip with everything the field app needs (no prices).
create or replace function public.ops_field_trip(p_trip uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'seq', t.seq, 'status', t.status, 'start_date', t.start_date, 'end_date', t.end_date,
    'days', t.days, 'start_time', t.start_time, 'notes', t.notes,
    'job', jsonb_build_object('id', j.id, 'number', j.number, 'title', j.title, 'crew_notes', j.crew_notes),
    'customer', jsonb_build_object('name', cu.name, 'phone', cu.phone),
    'address', nullif(concat_ws(', ', pr.street, pr.city, nullif(concat_ws(' ', pr.state, pr.zip), '')), ''),
    'gate_code', pr.gate_code, 'property_notes', pr.notes,
    'rig', case when r.id is null then null else jsonb_build_object('id', r.id, 'name', r.name, 'location_id', r.location_id) end,
    'crew', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'lead', tc.lead, 'login', c.profile_id is not null,
                                                          'me', c.profile_id = auth.uid()) order by tc.lead desc, c.name), '[]'::jsonb)
               from public.ops_trip_crew tc join public.ops_crew c on c.id = tc.crew_id where tc.trip_id = t.id),
    'work', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'area', l.area_code, 'name', l.name, 'detail', l.detail, 'kind', l.kind,
                                                          'product_id', l.product_id, 'sqft', l.sqft, 'depth_in', l.depth_in, 'r_value', l.r_value,
                                                          'units', l.units, 'unit', l.unit, 'bf', l.bf) order by l.sort), '[]'::jsonb)
               from public.ops_job_lines l where l.trip_id = t.id),
    'stock', (select coalesce(jsonb_agg(jsonb_build_object('place', s.place_kind, 'item_key', s.item_key, 'name', s.name, 'unit', s.unit,
                                                           'maker', s.maker, 'lot_no', s.lot_no, 'qty', s.qty) order by s.place_kind desc, s.item_key, s.maker, s.lot_no), '[]'::jsonb)
                from public.ops_stock s
               where s.company_id = t.company_id and s.qty <> 0
                 and ((s.place_kind = 'rig' and s.place_id = t.rig_id) or (s.place_kind = 'location' and s.place_id = r.location_id))),
    'wo', case when w.id is null then null else jsonb_build_object(
            'id', w.id, 'status', w.status, 'started_at', w.started_at, 'finished_at', w.finished_at, 'finished_by_name', w.finished_by_name,
            'sprayer_crew_id', w.sprayer_crew_id, 'sprayer_name', w.sprayer_name, 'sprayer_cert', w.sprayer_cert,
            'customer_name', w.customer_name, 'customer_signed', w.customer_sig is not null, 'customer_signed_at', w.customer_signed_at,
            'customer_absent', w.customer_absent, 'customer_absent_note', w.customer_absent_note,
            'issue', w.issue, 'issue_affected', w.issue_affected, 'tech_contacted', w.tech_contacted, 'corrective', w.corrective,
            'notes', w.notes, 'share_ambit', w.share_ambit, 'reviewed_at', w.reviewed_at, 'review_note', w.review_note) end,
    'days_log', (select coalesce(jsonb_agg(jsonb_build_object('date', d.work_date, 'conditions', d.conditions, 'equipment', d.equipment,
                                                              'material', d.material, 'quality', d.quality, 'safety', d.safety,
                                                              'updated_by_name', d.updated_by_name) order by d.work_date), '[]'::jsonb)
                   from public.ops_wo_days d where d.wo_id = w.id),
    'time', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'crew', x.crew_id, 'kind', x.kind, 'start', x.started_at, 'end', x.ended_at,
                                                          'by', x.by_name) order by x.started_at), '[]'::jsonb)
               from public.ops_wo_time x where x.wo_id = w.id and not x.deleted),
    'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'date', m.work_date, 'product', m.ops_product_id, 'kind', m.kind,
                                                               'name', m.name, 'unit', m.unit, 'qty', m.qty, 'a_maker', m.a_maker, 'a_lot', m.a_lot,
                                                               'b_key', m.b_key, 'b_lot', m.b_lot, 'lot', m.lot, 'serials', m.serials,
                                                               'measure', m.measure, 'taken', m.taken, 'by', m.by_name) order by m.created_at), '[]'::jsonb)
                    from public.ops_wo_materials m where m.wo_id = w.id and not m.deleted),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'date', a.work_date, 'line', a.job_line_id, 'area', a.area_code,
                                                           'name', a.name, 'substrate', a.substrate, 'product', a.ops_product_id, 'kind', a.kind,
                                                           'sqft', a.sqft, 'thick', a.thick_in, 'passes', a.passes, 'sort', a.sort) order by a.sort, a.created_at), '[]'::jsonb)
                from public.ops_wo_areas a where a.wo_id = w.id and not a.deleted),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'date', p.work_date, 'kind', p.kind, 'path', p.path, 'caption', p.caption,
                                                            'taken_at', p.taken_at, 'by', p.by_name) order by p.created_at), '[]'::jsonb)
                 from public.ops_wo_photos p where p.wo_id = w.id and not p.deleted)
  )
  from public.ops_trips t
  join public.ops_jobs j on j.id = t.job_id
  join public.ops_customers cu on cu.id = j.customer_id
  left join public.ops_properties pr on pr.id = j.property_id
  left join public.ops_rigs r on r.id = t.rig_id
  left join public.ops_work_orders w on w.trip_id = t.id
  where t.id = p_trip
$$;

-- Everything for the field app: the trips the person is on (the office sees every trip in the window),
-- the products (names and yields, no prices), the crew list and the settings that change the form.
create or replace function public.ops_field_bundle() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  co      uuid := public.ops_company();
  today   date := (now() at time zone 'America/Chicago')::date;
  office  boolean := public.ops_is('owner', 'office', 'dispatcher');
  s       jsonb;
  cname   text;
begin
  if co is null then raise exception 'Sign in to your company''s workspace first.'; end if;
  select coalesce(ops_settings, '{}'::jsonb), name into s, cname from public.companies where id = co;
  return jsonb_build_object(
    'company', co,
    'role', public.ops_role(),
    'office', office,
    'lead', public.ops_is('crew_lead'),
    'me', (select c.id from public.ops_crew c where c.company_id = co and c.profile_id = auth.uid() and c.active limit 1),
    'me_name', public.my_name(),
    'today', today,
    'at', now(),
    'settings', jsonb_build_object(
      'brand', coalesce(nullif(trim(s->>'display_name'), ''), cname),
      'measure_unit', coalesce(nullif(s->>'measure_unit', ''), 'lbs'),
      'work_areas', s->'work_areas',
      'share_logs', coalesce((s->>'share_logs')::boolean, true)),
    'crew', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'login', c.profile_id is not null) order by c.name), '[]'::jsonb)
               from public.ops_crew c where c.company_id = co and c.active),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'unit', p.unit, 'yield_bf', p.yield_bf,
                                                              'lb_per_set', p.lb_per_set, 'skus', p.ambit_skus, 'sku', coalesce(cp.sku, p.sku))
                                           order by p.kind, p.sort, p.name), '[]'::jsonb)
                   from public.ops_products p left join public.products cp on cp.id = p.product_id
                  where p.company_id = co and p.active and p.kind not in ('labor')),
    'trips', (select coalesce(jsonb_agg(public.ops_field_trip(x.id) order by x.start_date nulls last, x.start_time nulls last, x.seq), '[]'::jsonb)
                from (select t.id, t.start_date, t.start_time, t.seq
                        from public.ops_trips t
                        join public.ops_jobs j on j.id = t.job_id and j.status <> 'cancelled'
                        left join public.ops_work_orders w on w.trip_id = t.id
                       where t.company_id = co and t.status <> 'cancelled'
                         and (public.ops_my_trip(t.id) or office)
                         and ((t.status in ('scheduled', 'in_progress') and t.start_date <= today + 7 and t.end_date >= today - 14)
                              or (w.status = 'open' and t.start_date >= today - 60)
                              or w.finished_at > now() - interval '2 days')
                       order by t.start_date, t.start_time
                       limit 80) x)
  );
end $$;

-- Merges a change into a saved section key by key, all the way down (one reading never wipes out another).
create or replace function public.ops_jsonb_merge(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case
           when b is null then a
           when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
             (select coalesce(jsonb_object_agg(k, case when a ? k and b ? k then public.ops_jsonb_merge(a -> k, b -> k)
                                                       when b ? k then b -> k else a -> k end), '{}'::jsonb)
                from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) keys)
           else b end
$$;

-- ---------- Saving what the phone sends ---------------------------------------------------------
-- Takes what one material line uses off stock: from the trip's rig, or the rig's shop when that lot
-- isn't on the rig. Gives back what was taken (so a change or delete can put exactly that back).
create or replace function public.ops_wo_take(p_co uuid, p_trip uuid, p_rig uuid, p_job_no int, p_lines jsonb, p_qty numeric, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  shop  uuid;
  ln    jsonb;
  st    public.ops_stock;
  out   jsonb := '[]'::jsonb;
begin
  if p_rig is null or coalesce(p_qty, 0) <= 0 then return out; end if;
  select location_id into shop from public.ops_rigs where id = p_rig;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    st := null;
    select * into st from public.ops_stock
     where company_id = p_co and place_kind = 'rig' and place_id = p_rig and item_key = ln->>'item_key'
       and maker = coalesce(ln->>'maker', '') and lot_no = coalesce(ln->>'lot', '') limit 1;
    if st.id is null and shop is not null then
      select * into st from public.ops_stock
       where company_id = p_co and place_kind = 'location' and place_id = shop and item_key = ln->>'item_key'
         and maker = coalesce(ln->>'maker', '') and lot_no = coalesce(ln->>'lot', '') limit 1;
    end if;
    if st.id is null then continue; end if;   -- not in the app's stock: recorded on the work order only
    perform public.ops_stock_bump(p_co, st.place_kind, st.place_id,
            jsonb_build_object('item_key', st.item_key, 'product_id', st.product_id, 'ops_product_id', st.ops_product_id, 'name', st.name, 'unit', st.unit),
            st.maker, st.lot_no, -p_qty, 'used', 'Job #' || p_job_no || ' work order', null, p_trip, p_by);
    out := out || jsonb_build_object('place', st.place_kind, 'place_id', st.place_id, 'item_key', st.item_key, 'product_id', st.product_id,
                                     'ops_product_id', st.ops_product_id, 'name', st.name, 'unit', st.unit, 'maker', st.maker, 'lot', st.lot_no, 'qty', p_qty);
  end loop;
  return out;
end $$;

create or replace function public.ops_wo_untake(p_co uuid, p_trip uuid, p_taken jsonb, p_by text) returns void
language plpgsql security definer set search_path = public as $$
declare tk jsonb;
begin
  for tk in select * from jsonb_array_elements(coalesce(p_taken, '[]'::jsonb)) loop
    perform public.ops_stock_bump(p_co, tk->>'place', (tk->>'place_id')::uuid,
            jsonb_build_object('item_key', tk->>'item_key', 'product_id', tk->>'product_id', 'ops_product_id', tk->>'ops_product_id', 'name', tk->>'name', 'unit', tk->>'unit'),
            tk->>'maker', tk->>'lot', (tk->>'qty')::numeric, 'adjust', 'Work order changed: put back', null, p_trip, p_by);
  end loop;
end $$;

-- One change from the phone (or the office). Raises a plain-words error when it can't be saved.
create or replace function public.ops_wo_apply(p_co uuid, p_office boolean, p_who text, op jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t       text := op->>'t';
  tr      public.ops_trips;
  jb      public.ops_jobs;
  w       public.ops_work_orders;
  lead    boolean;
  mine    boolean;
  cr      public.ops_crew;
  pr      public.ops_products;
  sku     text;
  v_id    uuid;
  v_start timestamptz;
  v_end   timestamptz;
  v_date  date;
  v_qty   numeric;
  v_del   boolean := coalesce((op->>'deleted')::boolean, false);
  lines   jsonb;
  old     public.ops_wo_materials;
  taken   jsonb;
  sect    text;
  sig     text;
  s       jsonb;
begin
  begin
    tr := null;
    select * into tr from public.ops_trips where id = (op->>'trip')::uuid and company_id = p_co;
  exception when invalid_text_representation then
    raise exception 'That trip isn''t in this workspace.';
  end;
  if tr.id is null then raise exception 'That trip isn''t in this workspace any more.'; end if;
  mine := public.ops_my_trip(tr.id);
  if not (p_office or mine) then raise exception 'You''re not on the crew for this trip.'; end if;
  if tr.status = 'cancelled' then raise exception 'This trip was cancelled.'; end if;
  select * into jb from public.ops_jobs where id = tr.job_id;
  if jb.status = 'cancelled' then raise exception 'This job was cancelled.'; end if;
  lead := p_office or public.ops_is('crew_lead')
          or exists (select 1 from public.ops_trip_crew tc join public.ops_crew c on c.id = tc.crew_id
                      where tc.trip_id = tr.id and tc.lead and c.profile_id = auth.uid());

  insert into public.ops_work_orders (company_id, trip_id, job_id) values (p_co, tr.id, tr.job_id)
  on conflict (trip_id) do nothing;
  select * into w from public.ops_work_orders where trip_id = tr.id for update;

  -- Office-only steps.
  if t = 'review' then
    if not p_office then raise exception 'Only the office reviews work orders.'; end if;
    if w.status = 'open' then raise exception 'The crew hasn''t finished this work order yet.'; end if;
    update public.ops_work_orders set status = 'reviewed', reviewed_by_name = p_who, reviewed_at = now(),
           review_note = nullif(left(trim(coalesce(op->>'note', '')), 1000), ''), updated_at = now() where id = w.id;
    return;
  elsif t = 'reopen' then
    if not p_office then raise exception 'Only the office can reopen a work order.'; end if;
    update public.ops_work_orders set status = 'open', reviewed_at = null, reviewed_by_name = null, updated_at = now() where id = w.id;
    update public.ops_trips set status = 'in_progress', updated_at = now() where id = tr.id and status = 'done';
    update public.ops_jobs set status = 'open' where id = tr.job_id and status = 'done';
    return;
  end if;

  -- Finished: the crew's phones can still send time punches, and changes made before the finish
  -- (a phone that was out of signal when the lead finished). Anything newer needs the office.
  if w.status = 'done' and not p_office and t <> 'time'
     and coalesce(nullif(op->>'at', '')::timestamptz, now()) > w.finished_at + interval '2 minutes' then
    raise exception 'This work order is finished. Ask the office to reopen it if something needs to change.';
  end if;
  if w.status = 'done' and t = 'finish' then return; end if;   -- finished twice (two phones): the first one stands
  if w.status = 'reviewed' then
    raise exception 'This work order was reviewed. Reopen it first to change it.';
  end if;

  -- Something is happening on this trip.
  if tr.status = 'scheduled' then update public.ops_trips set status = 'in_progress', updated_at = now() where id = tr.id; end if;

  if t = 'time' then
    v_id := (op->>'id')::uuid;
    if v_id is null then raise exception 'That change is missing its id.'; end if;
    select * into cr from public.ops_crew where id = (op->>'crew')::uuid and company_id = p_co;
    if cr.id is null then raise exception 'That crew member isn''t on this team.'; end if;
    if not lead and cr.profile_id is distinct from auth.uid() then raise exception 'Only the crew lead can clock someone else in or out.'; end if;
    v_start := (op->>'start')::timestamptz;
    v_end := nullif(op->>'end', '')::timestamptz;
    if v_start is null then raise exception 'The time is missing.'; end if;
    if v_start > now() + interval '15 minutes' or v_end > now() + interval '15 minutes' then raise exception 'That time is in the future. Check the phone''s clock.'; end if;
    if v_start < now() - interval '45 days' then raise exception 'That''s too far back to change here. Ask the office.'; end if;
    if v_end is not null and v_end < v_start then raise exception 'Clock-out is before clock-in.'; end if;
    if v_end is not null and v_end - v_start > interval '24 hours' then raise exception 'One punch can''t be longer than 24 hours.'; end if;
    if exists (select 1 from public.ops_wo_time where id = v_id and wo_id <> w.id) then raise exception 'That time punch belongs to another work order.'; end if;
    insert into public.ops_wo_time (id, company_id, wo_id, crew_id, kind, started_at, ended_at, by_name, deleted)
    values (v_id, p_co, w.id, cr.id, case when op->>'kind' = 'drive' then 'drive' else 'site' end, v_start, v_end, p_who, v_del)
    on conflict (id) do update
      set crew_id = excluded.crew_id, kind = excluded.kind, started_at = excluded.started_at, ended_at = excluded.ended_at,
          deleted = excluded.deleted, updated_at = now(),
          edited_by_name = case when public.ops_wo_time.by_name is distinct from p_who then p_who else public.ops_wo_time.edited_by_name end,
          edited_at = case when public.ops_wo_time.by_name is distinct from p_who then now() else public.ops_wo_time.edited_at end;
    -- A helper the lead clocked in who wasn't scheduled goes on the trip's crew.
    if not v_del then
      insert into public.ops_trip_crew (trip_id, crew_id, company_id, lead) values (tr.id, cr.id, p_co, false) on conflict do nothing;
    end if;
    update public.ops_work_orders
       set started_at = (select min(started_at) from public.ops_wo_time where wo_id = w.id and not deleted), updated_at = now()
     where id = w.id;

  elsif t = 'day' then
    v_date := (op->>'date')::date;
    if v_date is null or v_date < coalesce(tr.start_date, v_date) - 7 or v_date > (now() at time zone 'America/Chicago')::date + 1 then
      raise exception 'That day doesn''t fit this trip.';
    end if;
    foreach sect in array array['conditions', 'equipment', 'material', 'quality', 'safety'] loop
      if op ? sect and (jsonb_typeof(op->sect) <> 'object' or length((op->sect)::text) > 12000) then
        raise exception 'The % section is too long.', sect;
      end if;
    end loop;
    insert into public.ops_wo_days (company_id, wo_id, work_date, conditions, equipment, material, quality, safety, updated_by_name)
    values (p_co, w.id, v_date, coalesce(op->'conditions', '{}'), coalesce(op->'equipment', '{}'), coalesce(op->'material', '{}'),
            coalesce(op->'quality', '{}'), coalesce(op->'safety', '{}'), p_who)
    on conflict (wo_id, work_date) do update
      set conditions = public.ops_jsonb_merge(public.ops_wo_days.conditions, coalesce(op->'conditions', '{}')),
          equipment  = public.ops_jsonb_merge(public.ops_wo_days.equipment,  coalesce(op->'equipment', '{}')),
          material   = public.ops_jsonb_merge(public.ops_wo_days.material,   coalesce(op->'material', '{}')),
          quality    = public.ops_jsonb_merge(public.ops_wo_days.quality,    coalesce(op->'quality', '{}')),
          safety     = public.ops_jsonb_merge(public.ops_wo_days.safety,     coalesce(op->'safety', '{}')),
          updated_at = now(), updated_by_name = p_who;

  elsif t = 'mat' then
    v_id := (op->>'id')::uuid;
    if v_id is null then raise exception 'That change is missing its id.'; end if;
    select * into old from public.ops_wo_materials where id = v_id;
    if old.id is not null and old.wo_id <> w.id then raise exception 'That material line belongs to another work order.'; end if;
    pr := null;
    if nullif(op->>'product', '') is not null then
      select * into pr from public.ops_products where id = (op->>'product')::uuid and company_id = p_co;
      if pr.id is null then raise exception 'That product isn''t in this workspace.'; end if;
    end if;
    v_qty := coalesce(nullif(op->>'qty', '')::numeric, 0);
    if v_qty < 0 or v_qty > 10000 then raise exception 'Check how many were used.'; end if;
    if not v_del and v_qty = 0 then raise exception 'Type how many were used.'; end if;
    -- What it takes off stock.
    lines := '[]'::jsonb;
    if not v_del and coalesce(pr.kind, op->>'kind', '') like 'foam%' then
      if nullif(trim(coalesce(op->>'a_lot', '')), '') is not null then
        lines := lines || jsonb_build_object('item_key', 'ISO', 'maker', left(trim(coalesce(op->>'a_maker', '')), 40), 'lot', left(trim(op->>'a_lot'), 60));
      end if;
      if nullif(trim(coalesce(op->>'b_lot', '')), '') is not null then
        lines := lines || jsonb_build_object('item_key', upper(trim(coalesce(nullif(op->>'b_key', ''), pr.ambit_skus[2], pr.sku, ''))),
                                             'maker', '', 'lot', left(trim(op->>'b_lot'), 60));
      end if;
    elsif not v_del and pr.id is not null then
      select upper(trim(cp.sku)) into sku from public.products cp where cp.id = pr.product_id;
      lines := jsonb_build_array(jsonb_build_object('item_key', coalesce(sku, nullif(upper(trim(pr.ambit_skus[1])), ''), upper('OPS:' || pr.id::text)),
                                                    'maker', '', 'lot', left(trim(coalesce(op->>'lot', '')), 60)));
    end if;
    -- Same as before: leave stock alone. Otherwise put back what it took and take again.
    if old.id is not null and not old.deleted and not v_del and old.qty = v_qty
       and coalesce(old.a_maker, '') = left(trim(coalesce(op->>'a_maker', '')), 40) and coalesce(old.a_lot, '') = left(trim(coalesce(op->>'a_lot', '')), 60)
       and coalesce(old.b_key, '') = upper(trim(coalesce(op->>'b_key', ''))) and coalesce(old.b_lot, '') = left(trim(coalesce(op->>'b_lot', '')), 60)
       and coalesce(old.lot, '') = left(trim(coalesce(op->>'lot', '')), 60) and old.ops_product_id is not distinct from pr.id then
      taken := old.taken;
    else
      if old.id is not null and not old.deleted then perform public.ops_wo_untake(p_co, tr.id, old.taken, p_who); end if;
      taken := case when v_del then '[]'::jsonb else public.ops_wo_take(p_co, tr.id, tr.rig_id, jb.number, lines, v_qty, p_who) end;
    end if;
    insert into public.ops_wo_materials (id, company_id, wo_id, work_date, ops_product_id, kind, name, unit, qty, a_maker, a_lot, b_key, b_lot, lot, serials, measure, taken, by_name, deleted)
    values (v_id, p_co, w.id, nullif(op->>'date', '')::date, pr.id, coalesce(pr.kind, nullif(op->>'kind', ''), 'other'),
            left(coalesce(pr.name, nullif(trim(op->>'name'), ''), 'Material'), 160),
            coalesce(case when coalesce(pr.kind, '') like 'foam%' then 'set' end, pr.unit, nullif(op->>'unit', ''), 'each'),
            v_qty, nullif(left(trim(coalesce(op->>'a_maker', '')), 40), ''), nullif(left(trim(coalesce(op->>'a_lot', '')), 60), ''),
            nullif(upper(trim(coalesce(op->>'b_key', ''))), ''), nullif(left(trim(coalesce(op->>'b_lot', '')), 60), ''),
            nullif(left(trim(coalesce(op->>'lot', '')), 60), ''), nullif(left(trim(coalesce(op->>'serials', '')), 300), ''),
            case when jsonb_typeof(op->'measure') = 'object' and length((op->'measure')::text) < 2000 then op->'measure' end,
            taken, p_who, v_del)
    on conflict (id) do update
      set work_date = excluded.work_date, ops_product_id = excluded.ops_product_id, kind = excluded.kind, name = excluded.name, unit = excluded.unit,
          qty = excluded.qty, a_maker = excluded.a_maker, a_lot = excluded.a_lot, b_key = excluded.b_key, b_lot = excluded.b_lot,
          lot = excluded.lot, serials = excluded.serials, measure = excluded.measure, taken = excluded.taken, deleted = excluded.deleted, updated_at = now();

  elsif t = 'area' then
    v_id := (op->>'id')::uuid;
    if v_id is null then raise exception 'That change is missing its id.'; end if;
    if exists (select 1 from public.ops_wo_areas where id = v_id and wo_id <> w.id) then raise exception 'That area belongs to another work order.'; end if;
    if coalesce(nullif(op->>'sqft', '')::numeric, 0) not between 0 and 1000000 then raise exception 'Check the square feet.'; end if;
    if coalesce(nullif(op->>'thick', '')::numeric, 0) not between 0 and 48 then raise exception 'Check the thickness (inches).'; end if;
    if coalesce(nullif(op->>'passes', '')::int, 0) not between 0 and 30 then raise exception 'Check the number of passes.'; end if;
    pr := null;
    if nullif(op->>'product', '') is not null then
      select * into pr from public.ops_products where id = (op->>'product')::uuid and company_id = p_co;
    end if;
    insert into public.ops_wo_areas (id, company_id, wo_id, work_date, job_line_id, area_code, name, substrate, ops_product_id, kind, sqft, thick_in, passes, sort, deleted)
    values (v_id, p_co, w.id, nullif(op->>'date', '')::date,
            (select l.id from public.ops_job_lines l where l.id = nullif(op->>'line', '')::uuid and l.job_id = tr.job_id),
            nullif(left(trim(coalesce(op->>'area', '')), 12), ''), nullif(left(trim(coalesce(op->>'name', '')), 120), ''),
            nullif(left(trim(coalesce(op->>'substrate', '')), 60), ''), pr.id, coalesce(pr.kind, nullif(op->>'kind', '')),
            nullif(op->>'sqft', '')::numeric, nullif(op->>'thick', '')::numeric, nullif(op->>'passes', '')::int,
            coalesce(nullif(op->>'sort', '')::int, 0), v_del)
    on conflict (id) do update
      set work_date = excluded.work_date, job_line_id = excluded.job_line_id, area_code = excluded.area_code, name = excluded.name,
          substrate = excluded.substrate, ops_product_id = excluded.ops_product_id, kind = excluded.kind, sqft = excluded.sqft,
          thick_in = excluded.thick_in, passes = excluded.passes, sort = excluded.sort, deleted = excluded.deleted, updated_at = now();

  elsif t = 'photo' then
    v_id := (op->>'id')::uuid;
    if v_id is null then raise exception 'That change is missing its id.'; end if;
    if exists (select 1 from public.ops_wo_photos where id = v_id and wo_id <> w.id) then raise exception 'That photo belongs to another work order.'; end if;
    if coalesce(op->>'path', '') not like p_co::text || '/' || tr.id::text || '/%' then raise exception 'That photo isn''t in this trip''s folder.'; end if;
    if not v_del and not exists (select 1 from storage.objects o where o.bucket_id = 'ops-photos' and o.name = op->>'path') then
      raise exception 'The photo didn''t finish uploading. It will try again.';
    end if;
    insert into public.ops_wo_photos (id, company_id, wo_id, work_date, kind, path, caption, taken_at, by_name, deleted)
    values (v_id, p_co, w.id, nullif(op->>'date', '')::date,
            case when op->>'kind' in ('before', 'after', 'issue') then op->>'kind' else 'other' end,
            op->>'path', nullif(left(trim(coalesce(op->>'caption', '')), 300), ''),
            coalesce(nullif(op->>'taken_at', '')::timestamptz, now()), p_who, v_del)
    on conflict (id) do update
      set kind = excluded.kind, caption = excluded.caption, deleted = excluded.deleted, work_date = excluded.work_date;

  elsif t = 'wo' then
    update public.ops_work_orders
       set issue = case when op ? 'issue' then nullif(left(trim(coalesce(op->>'issue', '')), 2000), '') else issue end,
           issue_affected = case when op ? 'issue_affected' then case when op->>'issue_affected' in ('yes', 'no', 'unsure') then op->>'issue_affected' end else issue_affected end,
           tech_contacted = case when op ? 'tech_contacted' then nullif(op->>'tech_contacted', '')::boolean else tech_contacted end,
           corrective = case when op ? 'corrective' then nullif(left(trim(coalesce(op->>'corrective', '')), 2000), '') else corrective end,
           notes = case when op ? 'notes' then nullif(left(trim(coalesce(op->>'notes', '')), 4000), '') else notes end,
           sprayer_crew_id = case when op ? 'sprayer_crew_id' then (select c.id from public.ops_crew c where c.id = nullif(op->>'sprayer_crew_id', '')::uuid and c.company_id = p_co) else sprayer_crew_id end,
           sprayer_cert = case when op ? 'sprayer_cert' then nullif(left(trim(coalesce(op->>'sprayer_cert', '')), 120), '') else sprayer_cert end,
           updated_at = now()
     where id = w.id;

  elsif t = 'finish' then
    sig := op->>'customer_sig';
    if coalesce((op->>'customer_absent')::boolean, false) then
      if coalesce(trim(op->>'customer_absent_note'), '') = '' then raise exception 'Say why the customer couldn''t sign.'; end if;
    else
      if coalesce(trim(op->>'customer_name'), '') = '' then raise exception 'Type the customer''s name.'; end if;
      if sig is null or sig not like 'data:image/png;base64,%' or length(sig) < 200 then raise exception 'The customer''s signature is missing.'; end if;
      if length(sig) > 400000 then raise exception 'The signature is too large. Clear it and sign again.'; end if;
    end if;
    if coalesce(trim(op->>'sprayer_name'), '') = '' then raise exception 'The sprayer types their full name to sign the log.'; end if;
    select coalesce(ops_settings, '{}'::jsonb) into s from public.companies where id = p_co;
    update public.ops_work_orders
       set status = 'done', finished_at = coalesce(least(nullif(op->>'at', '')::timestamptz, now()), now()), finished_by_name = p_who,
           sprayer_crew_id = coalesce((select c.id from public.ops_crew c where c.id = nullif(op->>'sprayer_crew', '')::uuid and c.company_id = p_co), sprayer_crew_id),
           sprayer_name = left(trim(op->>'sprayer_name'), 120),
           sprayer_cert = coalesce(nullif(left(trim(coalesce(op->>'sprayer_cert', '')), 120), ''), sprayer_cert),
           sprayer_signed_at = now(),
           customer_absent = coalesce((op->>'customer_absent')::boolean, false),
           customer_absent_note = case when coalesce((op->>'customer_absent')::boolean, false) then left(trim(op->>'customer_absent_note'), 500) end,
           customer_name = case when coalesce((op->>'customer_absent')::boolean, false) then null else left(trim(op->>'customer_name'), 120) end,
           customer_sig = case when coalesce((op->>'customer_absent')::boolean, false) then null else sig end,
           customer_signed_at = case when coalesce((op->>'customer_absent')::boolean, false) then null else now() end,
           share_ambit = coalesce((s->>'share_logs')::boolean, true),
           shared_at = case when coalesce((s->>'share_logs')::boolean, true) then coalesce(shared_at, now()) else null end,
           updated_at = now()
     where id = w.id;
    update public.ops_trips set status = 'done', updated_at = now() where id = tr.id;
    update public.ops_jobs set status = 'done'
     where id = tr.job_id and status = 'open'
       and not exists (select 1 from public.ops_trips x where x.job_id = tr.job_id and x.status not in ('done', 'cancelled'));

  else
    raise exception 'Unknown change "%".', coalesce(t, '');
  end if;
end $$;

-- The phone's (or the office's) changes, in order. Each one saves or fails on its own, so one bad
-- change never holds up the rest; the phone keeps only the ones that failed for a passing reason.
create or replace function public.ops_wo_sync(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  co      uuid := public.ops_company();
  office  boolean := public.ops_is('owner', 'office', 'dispatcher');
  who     text := coalesce(public.my_name(), 'Crew');
  op      jsonb;
  i       int := 0;
  res     jsonb := '[]'::jsonb;
begin
  if co is null then raise exception 'Sign in to your company''s workspace first.'; end if;
  if jsonb_typeof(p_ops) <> 'array' then raise exception 'Nothing to save.'; end if;
  if jsonb_array_length(p_ops) > 300 then raise exception 'Too many changes at once.'; end if;
  for op in select * from jsonb_array_elements(p_ops) loop
    begin
      if jsonb_typeof(op) <> 'object' then raise exception 'That change is unreadable.'; end if;
      perform public.ops_wo_apply(co, office, who, op);
      res := res || jsonb_build_object('i', i, 'ok', true);
    exception when others then
      res := res || jsonb_build_object('i', i, 'ok', false, 'error', sqlerrm);
    end;
    i := i + 1;
  end loop;
  return jsonb_build_object('results', res, 'at', now());
end $$;

-- ---------- One work order, everything on it (office review, the PDF, AMBIT tech support) -----------
-- The office, dispatch, accounting, the sales rep on the job and the trip's crew read it in the
-- workspace; AMBIT staff with "Spray job data log" read the ones the contractor sends to AMBIT
-- (no customer phone or email, no prices).
create or replace function public.ops_wo_detail(p_wo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w     public.ops_work_orders;
  mine  boolean;
  ambit boolean;
begin
  select * into w from public.ops_work_orders where id = p_wo;
  if w.id is null then return null; end if;
  mine := w.company_id = public.ops_company()
          and (public.ops_is('owner', 'office', 'dispatcher', 'accounting') or public.ops_my_trip(w.trip_id)
               or (public.ops_is('sales') and exists (select 1 from public.ops_jobs j where j.id = w.job_id and (j.rep_id = auth.uid() or j.created_by = auth.uid()))));
  ambit := w.share_ambit and public.has_perm('spray_log');
  if not (mine or ambit) then return null; end if;
  return (
    select jsonb_build_object(
      'wo', to_jsonb(w),
      'mine', mine,
      'company', jsonb_build_object('id', co.id, 'name', co.name, 'brand', coalesce(nullif(trim(co.ops_settings->>'display_name'), ''), co.name),
                                    'logo', co.ops_logo_path, 'phone', co.ops_settings->>'phone', 'license_no', co.ops_settings->>'license_no',
                                    'measure_unit', coalesce(co.ops_settings->>'measure_unit', 'lbs')),
      'trip', jsonb_build_object('id', t.id, 'name', t.name, 'seq', t.seq, 'status', t.status, 'start_date', t.start_date, 'end_date', t.end_date, 'days', t.days),
      'job', jsonb_build_object('id', j.id, 'number', j.number, 'title', j.title),
      'customer', jsonb_build_object('name', cu.name, 'phone', case when mine then cu.phone end, 'email', case when mine then cu.email end),
      'property', jsonb_build_object('street', pr.street, 'city', pr.city, 'state', pr.state, 'zip', pr.zip),
      'rig', case when r.id is null then null else jsonb_build_object('id', r.id, 'name', r.name) end,
      'crew', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'lead', tc.lead) order by tc.lead desc, c.name), '[]'::jsonb)
                 from public.ops_trip_crew tc join public.ops_crew c on c.id = tc.crew_id where tc.trip_id = t.id),
      'days', (select coalesce(jsonb_agg(to_jsonb(d) order by d.work_date), '[]'::jsonb) from public.ops_wo_days d where d.wo_id = w.id),
      'time', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'crew', x.crew_id, 'name', c.name, 'kind', x.kind, 'start', x.started_at, 'end', x.ended_at,
                                                            'by', x.by_name, 'edited_by', x.edited_by_name) order by x.started_at), '[]'::jsonb)
                 from public.ops_wo_time x left join public.ops_crew c on c.id = x.crew_id where x.wo_id = w.id and not x.deleted),
      'materials', (select coalesce(jsonb_agg(to_jsonb(m) - 'company_id' order by m.created_at), '[]'::jsonb) from public.ops_wo_materials m where m.wo_id = w.id and not m.deleted),
      'areas', (select coalesce(jsonb_agg(to_jsonb(a) - 'company_id' order by a.sort, a.created_at), '[]'::jsonb) from public.ops_wo_areas a where a.wo_id = w.id and not a.deleted),
      'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'date', p.work_date, 'kind', p.kind, 'path', p.path, 'caption', p.caption, 'taken_at', p.taken_at, 'by', p.by_name) order by p.created_at), '[]'::jsonb)
                   from public.ops_wo_photos p where p.wo_id = w.id and not p.deleted),
      'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'yield_bf', p.yield_bf, 'lb_per_set', p.lb_per_set)), '[]'::jsonb)
                     from public.ops_products p
                    where p.id in (select m.ops_product_id from public.ops_wo_materials m where m.wo_id = w.id and not m.deleted
                                   union select a.ops_product_id from public.ops_wo_areas a where a.wo_id = w.id and not a.deleted))
    )
    from public.ops_trips t
    join public.ops_jobs j on j.id = t.job_id
    join public.ops_customers cu on cu.id = j.customer_id
    join public.companies co on co.id = w.company_id
    left join public.ops_properties pr on pr.id = j.property_id
    left join public.ops_rigs r on r.id = t.rig_id
    where t.id = w.trip_id
  );
end $$;

-- Work order settings (owner and office): send finished spray logs to AMBIT tech support or not.
create or replace function public.ops_set_share_logs(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := public.ops_company();
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or office can change this.'; end if;
  update public.companies set ops_settings = coalesce(ops_settings, '{}'::jsonb) || jsonb_build_object('share_logs', coalesce(p_on, true)) where id = co;
end $$;

-- AMBIT staff seen a shared log (so it shows as new until someone opens it).
alter table public.ops_work_orders add column if not exists ambit_seen_at timestamptz;
alter table public.ops_work_orders add column if not exists ambit_seen_by text;
create or replace function public.ops_wo_ambit_seen(p_wo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('spray_log') then return; end if;
  update public.ops_work_orders set ambit_seen_at = now(), ambit_seen_by = public.my_name()
   where id = p_wo and share_ambit and ambit_seen_at is null;
end $$;

-- AMBIT tech support's list: finished spray logs contractors send to AMBIT, newest first.
create or replace function public.ops_ambit_spray_logs(p_days int default 90) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_perm('spray_log') then '[]'::jsonb else coalesce((
    select jsonb_agg(x order by x->>'finished_at' desc) from (
      select jsonb_build_object(
        'id', w.id, 'finished_at', w.finished_at, 'shared_at', w.shared_at, 'seen_at', w.ambit_seen_at, 'seen_by', w.ambit_seen_by,
        'company', coalesce(nullif(trim(co.ops_settings->>'display_name'), ''), co.name), 'company_id', co.id,
        'job_number', j.number, 'trip_seq', t.seq, 'customer', cu.name, 'city', nullif(concat_ws(', ', pr.city, pr.state), ''),
        'sprayer', w.sprayer_name, 'issue', w.issue is not null, 'affected', w.issue_affected, 'tech_contacted', w.tech_contacted,
        'foam', (select string_agg(distinct m.name, ', ') from public.ops_wo_materials m where m.wo_id = w.id and not m.deleted and m.kind like 'foam%'),
        'sets', (select sum(m.qty) from public.ops_wo_materials m where m.wo_id = w.id and not m.deleted and m.kind like 'foam%')
      ) as x
      from public.ops_work_orders w
      join public.ops_trips t on t.id = w.trip_id
      join public.ops_jobs j on j.id = w.job_id
      join public.ops_customers cu on cu.id = j.customer_id
      join public.companies co on co.id = w.company_id
      left join public.ops_properties pr on pr.id = j.property_id
      where w.share_ambit and w.status in ('done', 'reviewed') and w.finished_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)))
      order by w.finished_at desc
      limit 300
    ) s), '[]'::jsonb) end
$$;

-- ---------- Who can call what ------------------------------------------------------------------
revoke all on function public.ops_ambit_spray_logs(int) from public, anon;
grant execute on function public.ops_ambit_spray_logs(int) to authenticated;
revoke all on function public.ops_wo_detail(uuid) from public, anon;
grant execute on function public.ops_wo_detail(uuid) to authenticated;
revoke all on function public.ops_set_share_logs(boolean) from public, anon;
grant execute on function public.ops_set_share_logs(boolean) to authenticated;
revoke all on function public.ops_wo_ambit_seen(uuid) from public, anon;
grant execute on function public.ops_wo_ambit_seen(uuid) to authenticated;
revoke all on function public.ops_jsonb_merge(jsonb, jsonb) from public, anon;
grant execute on function public.ops_jsonb_merge(jsonb, jsonb) to authenticated;
revoke all on function public.ops_my_trip(uuid) from public, anon;
grant execute on function public.ops_my_trip(uuid) to authenticated;
revoke all on function public.ops_field_trip(uuid) from public, anon, authenticated;
revoke all on function public.ops_field_bundle() from public, anon;
grant execute on function public.ops_field_bundle() to authenticated;
revoke all on function public.ops_wo_take(uuid, uuid, uuid, int, jsonb, numeric, text) from public, anon, authenticated;
revoke all on function public.ops_wo_untake(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.ops_wo_apply(uuid, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.ops_wo_sync(jsonb) from public, anon;
grant execute on function public.ops_wo_sync(jsonb) to authenticated;

select 'AMBIT-OPS work orders ready' as status;
-- =====================================================================
-- AMBIT Intelligence update 0037 - Inventory Hub for warehouse managers
-- * Three new permissions, turned on or off per person in Admin > Users:
--     receiving   - Receiving Reports: upload a BOL (photo or PDF), the app fills it in, the manager checks it
--     transfers   - send stock to another AMBIT location (lots go with the drums)
--     inv_reports - the Inventory Hub dashboard and reports (KPIs, charts, aging, expiring lots)
--   Everyone who has Inventory today gets all three, so nobody loses anything.
-- * Receiving Reports: what the BOL said and what actually came, with the BOL attached. Stock and
--   FOAM LOTS update when the manager taps Receive (same as Incoming deliveries).
-- * Transfers: stock comes off the sending location when it's sent and shows as an incoming delivery
--   at the other location until it's received there.
-- Files live in the private "inventory-files" storage bucket (AMBIT staff only).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Permissions -----------------------------------------------------------------------
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports']
$$;

update public.profiles p
   set perms = p.perms || array(select x from unnest(array['receiving', 'transfers', 'inv_reports']) x where not x = any(p.perms))
 where p.role = 'employee' and p.perms is not null and 'inventory' = any(p.perms)
   and not (array['receiving', 'transfers', 'inv_reports'] <@ p.perms);

create or replace function public.can_receive() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('inventory') or public.has_perm('receiving')
$$;

-- ---------- Receiving Reports: more on each delivery ------------------------------------------
alter table public.inbound_deliveries add column if not exists bol_no        text;
alter table public.inbound_deliveries add column if not exists po_no         text;
alter table public.inbound_deliveries add column if not exists carrier       text;
alter table public.inbound_deliveries add column if not exists files         jsonb not null default '[]'::jsonb;  -- [{path, name}] in inventory-files
alter table public.inbound_deliveries add column if not exists read_by_ai    boolean not null default false;
alter table public.inbound_deliveries add column if not exists ai_cost_cents numeric(10,3);
alter table public.inbound_deliveries add column if not exists transfer_id   bigint;
alter table public.inbound_lines      add column if not exists note          text;
create index if not exists inbound_deliveries_received_idx on public.inbound_deliveries(branch_id, received_at desc) where status = 'received';

-- ---------- Transfers between AMBIT locations -------------------------------------------------
create table if not exists public.inventory_transfers (
  id                bigint generated always as identity (start with 1001) primary key,
  from_branch       text not null references public.branches(id) on update cascade,
  to_branch         text not null references public.branches(id) on update cascade,
  status            text not null default 'in_transit',   -- in_transit | received | cancelled
  arrive_on         date,
  ref               text,                                  -- BOL # / trailer / driver
  note              text,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  received_at       timestamptz,
  received_by_name  text,
  cancelled_at      timestamptz,
  cancelled_by_name text,
  delivery_id       bigint references public.inbound_deliveries(id) on delete set null
);
do $$ begin
  alter table public.inventory_transfers add constraint inventory_transfers_status_check check (status in ('in_transit', 'received', 'cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists inventory_transfers_from_idx on public.inventory_transfers(from_branch, created_at desc);
create index if not exists inventory_transfers_to_idx on public.inventory_transfers(to_branch, created_at desc);

create table if not exists public.inventory_transfer_lines (
  id           bigint generated always as identity primary key,
  transfer_id  bigint not null references public.inventory_transfers(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  sku          text not null,
  name         text,
  unit         text,
  qty          numeric(12,2) not null,
  lot_id       bigint references public.inventory_lots(id) on delete set null,
  lot_no       text,
  mfg          date,
  exp          date
);
create index if not exists inventory_transfer_lines_idx on public.inventory_transfer_lines(transfer_id);

do $$ begin
  alter table public.inbound_deliveries add constraint inbound_deliveries_transfer_fk foreign key (transfer_id) references public.inventory_transfers(id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_lines enable row level security;
drop policy if exists inventory_transfers_read on public.inventory_transfers;
drop policy if exists inventory_transfer_lines_read on public.inventory_transfer_lines;
create policy inventory_transfers_read on public.inventory_transfers for select to authenticated using (public.is_employee());
create policy inventory_transfer_lines_read on public.inventory_transfer_lines for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.inventory_transfers, public.inventory_transfer_lines from anon, authenticated;
grant select on public.inventory_transfers, public.inventory_transfer_lines to authenticated;

-- ---------- Files (BOLs, packing slips) ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-files', 'inventory-files', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inventory_files_obj_read   on storage.objects;
drop policy if exists inventory_files_obj_insert on storage.objects;
drop policy if exists inventory_files_obj_delete on storage.objects;
create policy inventory_files_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'inventory-files' and public.is_employee());
create policy inventory_files_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'inventory-files' and (public.can_receive() or public.has_perm('transfers')));
create policy inventory_files_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'inventory-files' and public.is_admin());

-- ---------- Expected deliveries: receiving staff too; transfers are changed on the transfer ----------
create or replace function public.inbound_save(p_id bigint, p_branch text, p_vendor text, p_expected date, p_ref text, p_note text, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    public.inbound_deliveries;
  v_id bigint := p_id;
  ln   jsonb;
  p    public.products;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  if coalesce(trim(p_vendor), '') = '' then raise exception 'Who is it coming from?'; end if;
  if p_expected is null then raise exception 'Pick the day it''s expected.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if v_id is null then
    if not exists (select 1 from public.branches b where b.id = p_branch) then raise exception 'Pick the location.'; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, note, created_by_name)
    values (p_branch, left(trim(p_vendor), 120), p_expected, nullif(left(trim(coalesce(p_ref, '')), 120), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''), public.my_name())
    returning inbound_deliveries.id into v_id;
  else
    select * into d from public.inbound_deliveries where inbound_deliveries.id = p_id for update;
    if d.id is null then raise exception 'Delivery not found.'; end if;
    if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
    if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. Change it on the transfer.'; end if;
    update public.inbound_deliveries
       set vendor = left(trim(p_vendor), 120), expected_on = p_expected, ref = nullif(left(trim(coalesce(p_ref, '')), 120), ''),
           note = nullif(left(trim(coalesce(p_note, '')), 500), '')
     where inbound_deliveries.id = p_id;
    delete from public.inbound_lines where delivery_id = p_id;
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where products.id = (ln ->> 'product_id')::uuid;
    if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
    if coalesce((ln ->> 'qty')::numeric, 0) <= 0 then raise exception 'Enter how many % are coming.', p.sku; end if;
    insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty)
    values (v_id, p.id, p.sku, p.name, p.unit, round((ln ->> 'qty')::numeric, 2));
  end loop;
  return v_id;
end $$;

create or replace function public.inbound_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. The sending location cancels it (its stock goes back).'; end if;
  update public.inbound_deliveries set status = 'cancelled' where id = p_id and status = 'expected';
end $$;

-- Received. p_lines: [{"id": 12, "received_qty": 4, "lot_no": "PA123", "mfg": "2026-10-01", "exp": "2027-10-01"}]
-- Items counted by lot (spray foam) need a lot #: a new lot goes onto FOAM LOTS, a lot already there gets Shipped In.
-- A transfer from another AMBIT location is marked received too.
create or replace function public.inbound_receive(p_id bigint, p_lines jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d   public.inbound_deliveries;
  ln  jsonb;
  l   public.inbound_lines;
  q   numeric;
  lot public.inventory_lots;
  ln_lot text;
  who text := coalesce(public.my_name(), 'AMBITION');
  b   numeric;
  n   int := 0;
  lotted boolean;
  src text;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
  src := case when d.transfer_id is not null then d.vendor || ' (transfer T-' || d.transfer_id || ')' else d.vendor end;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = p_id;
    if l.id is null then continue; end if;
    q := round(coalesce((ln ->> 'received_qty')::numeric, l.qty), 2);
    if q < 0 then raise exception 'Received can''t be below zero (%).', l.sku; end if;
    ln_lot := nullif(upper(trim(coalesce(ln ->> 'lot_no', ''))), '');
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    update public.inbound_lines
       set received_qty = q, lot_no = coalesce(ln_lot, lot_no),
           mfg = coalesce(nullif(ln ->> 'mfg', '')::date, mfg), exp = coalesce(nullif(ln ->> 'exp', '')::date, exp)
     where id = l.id
     returning * into l;
    if q = 0 then continue; end if;
    if lotted then
      ln_lot := nullif(upper(trim(coalesce(l.lot_no, ''))), '');
      if ln_lot is null then raise exception 'Enter the lot # for % (spray foam is tracked by lot).', l.sku; end if;
      select * into lot from public.inventory_lots where branch_id = d.branch_id and product_id = l.product_id and upper(lot_no) = ln_lot;
      if lot.id is not null then
        update public.inventory_lots set in_unsynced = in_unsynced + q, updated_at = now() where id = lot.id;
      else
        insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
        values (d.branch_id, l.product_id, l.sku, ln_lot, l.mfg, l.exp, q,
                l.name, 'Received in the app from ' || src, false, true, 100000);
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || src || ', lot ' || ln_lot || ' (goes onto FOAM LOTS).', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + q, updated_at = now(), updated_by_name = who
       where branch_id = d.branch_id and product_id = l.product_id
      returning on_hand - q into b;
      if not found then
        raise exception '% isn''t on this location''s inventory sheet. Add it to the COUNT SHEET first.', l.sku;
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || src || '.', b, b + q, who);
    end if;
    n := n + 1;
  end loop;
  update public.inbound_deliveries set status = 'received', received_at = now(), received_by_name = who where id = p_id;
  if d.transfer_id is not null then
    update public.inventory_transfers set status = 'received', received_at = now(), received_by_name = who
     where id = d.transfer_id and status = 'in_transit';
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = d.branch_id;
  return n;
end $$;

-- ---------- Receiving Report: what the BOL said and what came, received in one go --------------------
-- p_head:  {"vendor", "bol_no", "po_no", "carrier", "received_on", "note", "files": [{path, name}], "read_by_ai", "ai_cost_cents"}
-- p_lines: [{"id" (a line already on the delivery), "product_id", "qty" (on the BOL / expected), "received_qty",
--            "lot_no", "mfg", "exp", "note"}]
-- New report: p_id null. Against an expected delivery (or a transfer): p_id is that delivery.
create or replace function public.inbound_receive_report(p_id bigint, p_branch text, p_head jsonb, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d      public.inbound_deliveries;
  v_id   bigint := p_id;
  ln     jsonb;
  p      public.products;
  l      public.inbound_lines;
  keep   bigint[] := '{}';
  recv   jsonb := '[]'::jsonb;
  q      numeric;
  rq     numeric;
  v_day  date := coalesce(nullif(p_head ->> 'received_on', '')::date, (now() at time zone 'America/Chicago')::date);
  v_vendor text := left(trim(coalesce(p_head ->> 'vendor', '')), 120);
  v_files jsonb := case when jsonb_typeof(p_head -> 'files') = 'array' then p_head -> 'files' else '[]'::jsonb end;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if exists (select 1 from jsonb_array_elements(v_files) f where coalesce(f ->> 'path', '') !~ '^[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$') then
    raise exception 'One of the files isn''t from this app.';
  end if;

  if v_id is null then
    if v_vendor = '' then raise exception 'Who is it from (the shipper on the BOL)?'; end if;
    if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then raise exception 'Pick the location it came to.'; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, created_by_name)
    values (p_branch, v_vendor, v_day, public.my_name())
    returning id into v_id;
  end if;
  select * into d from public.inbound_deliveries where id = v_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;

  update public.inbound_deliveries
     set vendor        = case when d.transfer_id is null and v_vendor <> '' then v_vendor else d.vendor end,
         bol_no        = coalesce(nullif(left(trim(coalesce(p_head ->> 'bol_no', '')), 60), ''), d.bol_no),
         po_no         = coalesce(nullif(left(trim(coalesce(p_head ->> 'po_no', '')), 60), ''), d.po_no),
         carrier       = coalesce(nullif(left(trim(coalesce(p_head ->> 'carrier', '')), 80), ''), d.carrier),
         note          = coalesce(nullif(left(trim(coalesce(p_head ->> 'note', '')), 500), ''), d.note),
         files         = d.files || v_files,
         read_by_ai    = d.read_by_ai or coalesce((p_head ->> 'read_by_ai')::boolean, false),
         ai_cost_cents = coalesce(d.ai_cost_cents, 0) + coalesce((p_head ->> 'ai_cost_cents')::numeric, 0)
   where id = v_id;

  for ln in select * from jsonb_array_elements(p_lines) loop
    rq := round(coalesce(nullif(ln ->> 'received_qty', '')::numeric, 0), 2);
    q  := round(coalesce(nullif(ln ->> 'qty', '')::numeric, rq), 2);
    if rq < 0 or q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    l := null;
    if nullif(ln ->> 'id', '') is not null then
      select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = v_id;
    end if;
    if l.id is not null then
      if d.transfer_id is null then
        select * into p from public.products where id = coalesce(nullif(ln ->> 'product_id', '')::uuid, l.product_id);
        if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
        update public.inbound_lines
           set product_id = p.id, sku = p.sku, name = p.name, unit = p.unit, qty = q,
               note = nullif(left(trim(coalesce(ln ->> 'note', '')), 300), '')
         where id = l.id;
      else
        update public.inbound_lines set note = nullif(left(trim(coalesce(ln ->> 'note', '')), 300), '') where id = l.id;
      end if;
    else
      if d.transfer_id is not null then raise exception 'Items can''t be added to a transfer here. Receive what came; anything extra goes on its own Receiving Report.'; end if;
      select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
      if p.id is null then raise exception 'Pick the item for every line (or remove the line).'; end if;
      insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty, note)
      values (v_id, p.id, p.sku, p.name, p.unit, q, nullif(left(trim(coalesce(ln ->> 'note', '')), 300), ''))
      returning * into l;
    end if;
    keep := keep || l.id;
    recv := recv || jsonb_build_object(
      'id', l.id, 'received_qty', rq,
      'lot_no', case when d.transfer_id is null then nullif(trim(coalesce(ln ->> 'lot_no', '')), '') else l.lot_no end,
      'mfg', case when d.transfer_id is null then nullif(ln ->> 'mfg', '') else l.mfg::text end,
      'exp', case when d.transfer_id is null then nullif(ln ->> 'exp', '') else l.exp::text end);
  end loop;

  -- Lines left off the report: nothing came (an expected line) or the line was removed (a new report).
  if d.transfer_id is null then
    delete from public.inbound_lines where delivery_id = v_id and not (id = any(keep));
  else
    for l in select * from public.inbound_lines where delivery_id = v_id and not (id = any(keep)) loop
      recv := recv || jsonb_build_object('id', l.id, 'received_qty', 0);
    end loop;
  end if;

  perform public.inbound_receive(v_id, recv);
  return v_id;
end $$;

-- ---------- Transfers ---------------------------------------------------------------------------
-- Sent: the stock comes off here now (lots: Shipped Out on FOAM LOTS) and the other location gets an
-- incoming delivery with the same lots, to receive when it gets there.
-- p_lines: [{"product_id": "...", "qty": 4, "lot_id": 12 (spray foam: which lot)}]
create or replace function public.transfer_send(p_from text, p_to text, p_arrive date, p_ref text, p_note text, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t      public.inventory_transfers;
  ln     jsonb;
  p      public.products;
  lot    public.inventory_lots;
  inv    public.inventory;
  q      numeric;
  avail  numeric;
  held   numeric;
  who    text := coalesce(public.my_name(), 'AMBITION');
  fromn  text;
  ton    text;
  del    bigint;
begin
  if not (public.is_admin() or public.has_perm('transfers')) then raise exception 'You don''t have access to transfers.'; end if;
  if p_from = p_to then raise exception 'Pick a different location to send it to.'; end if;
  select b.name || ' ' || b.state into fromn from public.branches b where b.id = p_from;
  select b.name || ' ' || b.state into ton from public.branches b where b.id = p_to;
  if fromn is null or ton is null then raise exception 'Pick both locations.'; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_from and s.enabled) then raise exception '% has no inventory spreadsheet connected.', fromn; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_to and s.enabled) then raise exception '% has no inventory spreadsheet connected.', ton; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;

  insert into public.inventory_transfers (from_branch, to_branch, arrive_on, ref, note, created_by_name)
  values (p_from, p_to, coalesce(p_arrive, (now() at time zone 'America/Chicago')::date),
          nullif(left(trim(coalesce(p_ref, '')), 120), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''), who)
  returning * into t;

  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
    if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
    q := round(coalesce(nullif(ln ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then raise exception 'Enter how many % to send.', p.sku; end if;

    -- The other location has to stock it (on its COUNT SHEET, or counted by lot there).
    if not exists (select 1 from public.inventory i where i.branch_id = p_to and i.product_id = p.id and i.on_sheet)
       and not exists (select 1 from public.inventory_lots x where x.branch_id = p_to and x.product_id = p.id) then
      raise exception '% isn''t on %''s inventory sheet. Add a row for it on their COUNT SHEET first.', p.sku, ton;
    end if;

    if exists (select 1 from public.inventory_lots x where x.branch_id = p_from and x.product_id = p.id) then
      select * into lot from public.inventory_lots where id = nullif(ln ->> 'lot_id', '')::bigint and branch_id = p_from and product_id = p.id and on_sheet;
      if lot.id is null then raise exception 'Pick the lot for % (spray foam is sent by lot).', p.sku; end if;
      select coalesce(sum(x.qty), 0) into held from public.inventory_lines x where x.lot_id = lot.id and x.state = 'reserved';
      avail := lot.remaining - lot.sheet_pending - held;
      if q > avail then raise exception 'Lot % of % has % available to send (% asked).', lot.lot_no, p.sku, trim_scale(greatest(avail, 0)), trim_scale(q); end if;
      update public.inventory_lots set out_unsynced = out_unsynced + q, updated_at = now() where id = lot.id;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (p_from, 'transfer', p.sku, trim_scale(q) || ' sent to ' || ton || ' (transfer T-' || t.id || ') from lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' (Shipped Out on FOAM LOTS).',
              lot.remaining, lot.remaining - q, who);
      insert into public.inventory_transfer_lines (transfer_id, product_id, sku, name, unit, qty, lot_id, lot_no, mfg, exp)
      values (t.id, p.id, p.sku, p.name, p.unit, q, lot.id, nullif(lot.lot_no, ''), lot.mfg, lot.exp);
    else
      select * into inv from public.inventory where branch_id = p_from and product_id = p.id and on_sheet;
      if inv.product_id is null then raise exception '% isn''t on %''s inventory sheet.', p.sku, fromn; end if;
      select coalesce(sum(x.qty), 0) into held from public.inventory_lines x where x.branch_id = p_from and x.product_id = p.id and x.state = 'reserved';
      avail := coalesce(inv.on_hand, 0) - held - coalesce(inv.sheet_pending, 0);
      if q > avail then raise exception '% has % % available to send (% asked).', fromn, trim_scale(greatest(avail, 0)), p.sku, trim_scale(q); end if;
      update public.inventory set on_hand = on_hand - q, updated_at = now(), updated_by_name = who
       where branch_id = p_from and product_id = p.id;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (p_from, 'transfer', p.sku, trim_scale(q) || ' sent to ' || ton || ' (transfer T-' || t.id || ').', inv.on_hand, inv.on_hand - q, who);
      insert into public.inventory_transfer_lines (transfer_id, product_id, sku, name, unit, qty)
      values (t.id, p.id, p.sku, p.name, p.unit, q);
    end if;
  end loop;

  -- The other location's incoming delivery, with the lots already on it.
  insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, note, created_by_name, transfer_id)
  values (p_to, 'AMBIT ' || fromn, t.arrive_on, 'Transfer T-' || t.id || coalesce(' · ' || t.ref, ''), t.note, who, t.id)
  returning id into del;
  insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty, lot_no, mfg, exp)
  select del, product_id, sku, name, unit, qty, lot_no, mfg, exp from public.inventory_transfer_lines where transfer_id = t.id order by id;
  update public.inventory_transfers set delivery_id = del where id = t.id;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = p_from;
  return t.id;
end $$;

-- Not sent after all (only before the other location receives it): the stock goes back.
create or replace function public.transfer_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t   public.inventory_transfers;
  l   public.inventory_transfer_lines;
  lot public.inventory_lots;
  who text := coalesce(public.my_name(), 'AMBITION');
  b   numeric;
begin
  if not (public.is_admin() or public.has_perm('transfers')) then raise exception 'You don''t have access to transfers.'; end if;
  select * into t from public.inventory_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found.'; end if;
  if t.status <> 'in_transit' then raise exception 'This transfer was already %.', replace(t.status, '_', ' '); end if;
  if exists (select 1 from public.inbound_deliveries where id = t.delivery_id and status = 'received') then raise exception 'It was already received at the other location.'; end if;
  for l in select * from public.inventory_transfer_lines where transfer_id = p_id loop
    if l.lot_id is not null then
      select * into lot from public.inventory_lots where id = l.lot_id for update;
      if lot.id is null then continue; end if;
      if lot.out_unsynced >= l.qty then
        update public.inventory_lots set out_unsynced = out_unsynced - l.qty, updated_at = now() where id = lot.id;
      else
        update public.inventory_lots set in_unsynced = in_unsynced + l.qty, updated_at = now() where id = lot.id;  -- already on the sheet as Shipped Out
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (t.from_branch, 'transfer', l.sku, trim_scale(l.qty) || ' put back in lot ' || coalesce(l.lot_no, '(no lot #)') || ': transfer T-' || t.id || ' cancelled.', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + l.qty, updated_at = now(), updated_by_name = who
       where branch_id = t.from_branch and product_id = l.product_id
      returning on_hand - l.qty into b;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (t.from_branch, 'transfer', l.sku, trim_scale(l.qty) || ' put back in stock: transfer T-' || t.id || ' cancelled.', b, b + l.qty, who);
    end if;
  end loop;
  update public.inbound_deliveries set status = 'cancelled' where id = t.delivery_id and status = 'expected';
  update public.inventory_transfers set status = 'cancelled', cancelled_at = now(), cancelled_by_name = who where id = p_id;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = t.from_branch;
end $$;

-- ---------- Who can call what ------------------------------------------------------------------
revoke all on function public.can_receive() from public, anon;
revoke all on function public.inbound_receive_report(bigint, text, jsonb, jsonb) from public, anon;
revoke all on function public.transfer_send(text, text, date, text, text, jsonb) from public, anon;
revoke all on function public.transfer_cancel(bigint) from public, anon;
grant execute on function public.can_receive() to authenticated;
grant execute on function public.inbound_receive_report(bigint, text, jsonb, jsonb) to authenticated;
grant execute on function public.transfer_send(text, text, date, text, text, jsonb) to authenticated;
grant execute on function public.transfer_cancel(bigint) to authenticated;

select 'inventory hub ready' as status;


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

-- =====================================================================
-- AMBIT Intelligence update 0040 - Admins edit a person's name, phone and email
-- * Admin > Accounts: an admin can fix someone's name, cell phone or login email after they've
--   joined (the app changes the login itself on the server; this saves the account's copy).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.admin_update_profile(p_user uuid, p_full_name text, p_phone text, p_email text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change accounts.';
  end if;
  if p_email is not null and exists (select 1 from public.profiles where lower(email) = lower(btrim(p_email)) and id <> p_user) then
    raise exception 'Another account already uses %.', lower(btrim(p_email));
  end if;
  update public.profiles
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         phone     = nullif(btrim(p_phone), ''),
         email     = coalesce(nullif(lower(btrim(p_email)), ''), email)
   where id = p_user;
  if not found then
    raise exception 'That account no longer exists.';
  end if;
end $$;
revoke all on function public.admin_update_profile(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_profile(uuid, text, text, text) to authenticated;

select 'admin profile edits ready' as status;

-- =====================================================================
-- AMBIT Intelligence update 0041 - Receiving approval, lot / batch tracking, and editing orders
-- * Receiving Reports wait for an admin: whoever unloads the truck fills in the report and taps
--   "Send for approval"; stock and the location's spreadsheet only change when an admin approves it
--   (an admin's own report goes straight in). Each line can say how many arrived damaged (they don't
--   go into stock).
-- * Lot / Batch # and Expiration for anything that expires (Admin > Products: "Track lot & expiration",
--   plus a shelf life so the expiration fills itself in from the Mfg date). Spray foam drums keep using
--   FOAM LOTS; everything else is logged on a RECEIVED LOTS tab on the location's spreadsheet.
-- * Edit order: AMBIT staff add items or change / remove quantities on an open order. Once the CRM has
--   entered the Sales Order # and Invoice #, an edit sends the order back to the CRM ("Invoice update");
--   when the new Invoice # and prices are in, credit is checked again only if the total went up.
-- * Approve without customer email approval: staff can move an order past the customer step.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Products: lot & expiration -------------------------------------------------------------
alter table public.products add column if not exists track_lots boolean not null default false;
alter table public.products add column if not exists shelf_life_months int;
do $$ begin
  alter table public.products add constraint products_shelf_life_check check (shelf_life_months is null or shelf_life_months between 1 and 120);
exception when duplicate_object then null; end $$;

-- The first time only: everything that expires is tracked (an admin can switch any product off).
do $$ begin
  if not exists (select 1 from public.products where track_lots) then
    update public.products set track_lots = true
     where category_id in ('ambit-foam', 'spray-foam', 'gun-foam', 'sealants-adhesives', 'intumescent-coatings',
                           'roof-coatings-and-sealants', 'alpha-chemicals');
    update public.products set shelf_life_months = 12 where category_id = 'ambit-foam' and shelf_life_months is null;
  end if;
end $$;

-- ---------- Receiving Reports: waiting for an admin ------------------------------------------------
alter table public.inbound_deliveries drop constraint if exists inbound_status_check;
alter table public.inbound_deliveries add constraint inbound_status_check
  check (status in ('expected', 'submitted', 'received', 'cancelled'));
alter table public.inbound_deliveries add column if not exists submitted_at      timestamptz;
alter table public.inbound_deliveries add column if not exists submitted_by_name text;
alter table public.inbound_deliveries add column if not exists approved_at       timestamptz;
alter table public.inbound_deliveries add column if not exists approved_by_name  text;
alter table public.inbound_deliveries add column if not exists sent_back_at      timestamptz;
alter table public.inbound_deliveries add column if not exists sent_back_by_name text;
alter table public.inbound_deliveries add column if not exists sent_back_note    text;
alter table public.inbound_lines      add column if not exists damaged_qty       numeric(12,2) not null default 0;
create index if not exists inbound_deliveries_submitted_idx on public.inbound_deliveries(submitted_at) where status = 'submitted';

-- Lots / batches of everything that isn't counted on FOAM LOTS (it's logged on RECEIVED LOTS).
create table if not exists public.inventory_batches (
  id               bigint generated always as identity primary key,
  branch_id        text not null references public.branches(id) on update cascade on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  sku              text not null,
  name             text,
  lot_no           text not null,
  mfg              date,
  exp              date,
  qty              numeric(12,2) not null,
  received_on      date not null,
  delivery_id      bigint references public.inbound_deliveries(id) on delete set null,
  vendor           text,
  bol_no           text,
  received_by_name text,
  approved_by_name text,
  on_sheet         boolean not null default false,
  sheet_row        int,
  created_at       timestamptz not null default now()
);
create index if not exists inventory_batches_exp_idx on public.inventory_batches(branch_id, exp);
create index if not exists inventory_batches_product_idx on public.inventory_batches(branch_id, product_id, received_on desc);
create index if not exists inventory_batches_sheet_idx on public.inventory_batches(branch_id) where not on_sheet;
alter table public.inventory_batches enable row level security;
drop policy if exists inventory_batches_read on public.inventory_batches;
drop policy if exists inventory_batches_private on public.inventory_batches;
create policy inventory_batches_read on public.inventory_batches for select to authenticated using (public.is_employee());
create policy inventory_batches_private on public.inventory_batches as restrictive for select to authenticated
  using (not (product_id = any(coalesce((select public.hidden_products()), '{}'::uuid[]))));
revoke insert, update, delete on public.inventory_batches from anon, authenticated;
grant select on public.inventory_batches to authenticated;
grant all on public.inventory_batches to service_role;  -- the spreadsheet sync

-- Received. p_lines: [{"id": 12, "received_qty": 4, "damaged_qty": 0, "lot_no": "PA123", "mfg": "2026-10-01", "exp": "2027-10-01"}]
-- Anyone who receives saves what came; it only goes into stock when an admin receives or approves it.
-- Spray foam on FOAM LOTS needs a lot #; anything with "Track lot & expiration" needs a lot / batch # and
-- an expiration (filled in from the Mfg date and shelf life when there is one). Damaged doesn't go into stock.
create or replace function public.inbound_receive(p_id bigint, p_lines jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d      public.inbound_deliveries;
  ln     jsonb;
  l      public.inbound_lines;
  p      public.products;
  q      numeric;
  dq     numeric;
  g      numeric;
  lot    public.inventory_lots;
  ln_lot text;
  who    text := coalesce(public.my_name(), 'AMBITION');
  admin  boolean := public.is_admin();
  b      numeric;
  n      int := 0;
  lotted boolean;
  src    text;
  v_day  date;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status = 'submitted' and not admin then raise exception 'This Receiving Report is waiting for an admin to approve it.'; end if;
  if d.status not in ('expected', 'submitted') then raise exception 'This delivery was already %.', d.status; end if;
  src := case when d.transfer_id is not null then d.vendor || ' (transfer T-' || d.transfer_id || ')' else d.vendor end;

  -- 1. What came, line by line.
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = p_id;
    if l.id is null then continue; end if;
    q  := round(coalesce(nullif(ln ->> 'received_qty', '')::numeric, l.qty), 2);
    dq := round(coalesce(nullif(ln ->> 'damaged_qty', '')::numeric, 0), 2);
    if q < 0 or dq < 0 then raise exception 'Quantities can''t be below zero (%).', l.sku; end if;
    if dq > q then raise exception 'More % arrived damaged (%) than came (%).', l.sku, trim_scale(dq), trim_scale(q); end if;
    update public.inbound_lines
       set received_qty = q, damaged_qty = dq,
           lot_no = coalesce(nullif(upper(trim(coalesce(ln ->> 'lot_no', ''))), ''), lot_no),
           mfg = coalesce(nullif(ln ->> 'mfg', '')::date, mfg),
           exp = coalesce(nullif(ln ->> 'exp', '')::date, exp)
     where id = l.id;
  end loop;

  -- 2. Lot numbers and expirations on everything that goes into stock.
  for l in select * from public.inbound_lines where delivery_id = p_id order by id loop
    g := coalesce(l.received_qty, 0) - coalesce(l.damaged_qty, 0);
    if g <= 0 then continue; end if;
    select * into p from public.products where id = l.product_id;
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    if nullif(trim(coalesce(l.lot_no, '')), '') is null and (lotted or coalesce(p.track_lots, false)) then
      raise exception 'Enter the lot / batch # for %.', l.sku;
    end if;
    if not lotted and coalesce(p.track_lots, false) then
      if l.exp is null and l.mfg is not null and p.shelf_life_months is not null then
        update public.inbound_lines set exp = (l.mfg + make_interval(months => p.shelf_life_months))::date where id = l.id;
      elsif l.exp is null then
        raise exception 'Enter the expiration date for % (or its Mfg date%).', l.sku,
          case when p.shelf_life_months is null then ' and a shelf life in Admin > Products' else '' end;
      end if;
    end if;
  end loop;

  -- 3. Not an admin: it waits for one.
  if not admin then
    update public.inbound_deliveries
       set status = 'submitted', submitted_at = now(), submitted_by_name = who, received_by_name = who,
           sent_back_at = null, sent_back_by_name = null, sent_back_note = null
     where id = p_id;
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (d.branch_id, 'received', 'Receiving Report from ' || src || ' sent to an admin for approval (stock changes once it''s approved).', who);
    return (select count(*) from public.inbound_lines where delivery_id = p_id and coalesce(received_qty, 0) > 0)::int;
  end if;

  -- 4. An admin: into stock (and the spreadsheet).
  v_day := coalesce((d.submitted_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date);
  for l in select * from public.inbound_lines where delivery_id = p_id order by id loop
    q  := coalesce(l.received_qty, 0);
    dq := coalesce(l.damaged_qty, 0);
    g  := q - dq;
    if dq > 0 then
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, trim_scale(dq) || ' arrived damaged from ' || src || ' (not put in stock).', who);
    end if;
    if g <= 0 then continue; end if;
    select * into p from public.products where id = l.product_id;
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    if lotted then
      ln_lot := nullif(upper(trim(coalesce(l.lot_no, ''))), '');
      select * into lot from public.inventory_lots where branch_id = d.branch_id and product_id = l.product_id and upper(lot_no) = ln_lot;
      if lot.id is not null then
        update public.inventory_lots set in_unsynced = in_unsynced + g, updated_at = now() where id = lot.id;
      else
        insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
        values (d.branch_id, l.product_id, l.sku, ln_lot, l.mfg, l.exp, g, l.name, 'Received in the app from ' || src, false, true, 100000);
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(g) || ' from ' || src || ', lot ' || ln_lot || ' (goes onto FOAM LOTS).', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + g, updated_at = now(), updated_by_name = who
       where branch_id = d.branch_id and product_id = l.product_id
      returning on_hand - g into b;
      if not found then
        raise exception '% isn''t on this location''s inventory sheet. Add it to the COUNT SHEET first.', l.sku;
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (d.branch_id, 'received', l.sku,
              'Received ' || trim_scale(g) || ' from ' || src || coalesce(', lot ' || nullif(upper(trim(coalesce(l.lot_no, ''))), ''), '') || '.',
              b, b + g, who);
      if coalesce(p.track_lots, false) and nullif(trim(coalesce(l.lot_no, '')), '') is not null then
        insert into public.inventory_batches (branch_id, product_id, sku, name, lot_no, mfg, exp, qty, received_on, delivery_id,
                                              vendor, bol_no, received_by_name, approved_by_name)
        values (d.branch_id, l.product_id, l.sku, l.name, upper(trim(l.lot_no)), l.mfg, l.exp, g, v_day, d.id,
                src, d.bol_no, coalesce(d.submitted_by_name, who), who);
      end if;
    end if;
    n := n + 1;
  end loop;
  update public.inbound_deliveries
     set status = 'received', received_at = now(), received_by_name = coalesce(d.submitted_by_name, who),
         approved_at = now(), approved_by_name = who, sent_back_at = null, sent_back_by_name = null, sent_back_note = null
   where id = p_id;
  if d.transfer_id is not null then
    update public.inventory_transfers set status = 'received', received_at = now(), received_by_name = coalesce(d.submitted_by_name, who)
     where id = d.transfer_id and status = 'in_transit';
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = d.branch_id;
  return n;
end $$;

-- Receiving Report: what the BOL said and what came (see 0037). An admin can still change a report that's
-- waiting for approval; everyone else changes it while it's open.
create or replace function public.inbound_receive_report(p_id bigint, p_branch text, p_head jsonb, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d      public.inbound_deliveries;
  v_id   bigint := p_id;
  ln     jsonb;
  p      public.products;
  l      public.inbound_lines;
  keep   bigint[] := '{}';
  recv   jsonb := '[]'::jsonb;
  q      numeric;
  rq     numeric;
  v_day  date := coalesce(nullif(p_head ->> 'received_on', '')::date, (now() at time zone 'America/Chicago')::date);
  v_vendor text := left(trim(coalesce(p_head ->> 'vendor', '')), 120);
  v_files jsonb := case when jsonb_typeof(p_head -> 'files') = 'array' then p_head -> 'files' else '[]'::jsonb end;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if exists (select 1 from jsonb_array_elements(v_files) f where coalesce(f ->> 'path', '') !~ '^[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$') then
    raise exception 'One of the files isn''t from this app.';
  end if;

  if v_id is null then
    if v_vendor = '' then raise exception 'Who is it from (the shipper on the BOL)?'; end if;
    if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then raise exception 'Pick the location it came to.'; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, created_by_name)
    values (p_branch, v_vendor, v_day, public.my_name())
    returning id into v_id;
  end if;
  select * into d from public.inbound_deliveries where id = v_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status = 'submitted' and not public.is_admin() then raise exception 'This Receiving Report is waiting for an admin to approve it.'; end if;
  if d.status not in ('expected', 'submitted') then raise exception 'This delivery was already %.', d.status; end if;

  update public.inbound_deliveries
     set vendor        = case when d.transfer_id is null and v_vendor <> '' then v_vendor else d.vendor end,
         bol_no        = coalesce(nullif(left(trim(coalesce(p_head ->> 'bol_no', '')), 60), ''), d.bol_no),
         po_no         = coalesce(nullif(left(trim(coalesce(p_head ->> 'po_no', '')), 60), ''), d.po_no),
         carrier       = coalesce(nullif(left(trim(coalesce(p_head ->> 'carrier', '')), 80), ''), d.carrier),
         note          = coalesce(nullif(left(trim(coalesce(p_head ->> 'note', '')), 500), ''), d.note),
         files         = d.files || v_files,
         read_by_ai    = d.read_by_ai or coalesce((p_head ->> 'read_by_ai')::boolean, false),
         ai_cost_cents = coalesce(d.ai_cost_cents, 0) + coalesce((p_head ->> 'ai_cost_cents')::numeric, 0)
   where id = v_id;

  for ln in select * from jsonb_array_elements(p_lines) loop
    rq := round(coalesce(nullif(ln ->> 'received_qty', '')::numeric, 0), 2);
    q  := round(coalesce(nullif(ln ->> 'qty', '')::numeric, rq), 2);
    if rq < 0 or q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    l := null;
    if nullif(ln ->> 'id', '') is not null then
      select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = v_id;
    end if;
    if l.id is not null then
      if d.transfer_id is null then
        select * into p from public.products where id = coalesce(nullif(ln ->> 'product_id', '')::uuid, l.product_id);
        if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
        update public.inbound_lines
           set product_id = p.id, sku = p.sku, name = p.name, unit = p.unit, qty = q,
               note = nullif(left(trim(coalesce(ln ->> 'note', '')), 300), '')
         where id = l.id;
      else
        update public.inbound_lines set note = nullif(left(trim(coalesce(ln ->> 'note', '')), 300), '') where id = l.id;
      end if;
    else
      if d.transfer_id is not null then raise exception 'Items can''t be added to a transfer here. Receive what came; anything extra goes on its own Receiving Report.'; end if;
      select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
      if p.id is null then raise exception 'Pick the item for every line (or remove the line).'; end if;
      insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty, note)
      values (v_id, p.id, p.sku, p.name, p.unit, q, nullif(left(trim(coalesce(ln ->> 'note', '')), 300), ''))
      returning * into l;
    end if;
    keep := keep || l.id;
    recv := recv || jsonb_build_object(
      'id', l.id, 'received_qty', rq,
      'damaged_qty', round(coalesce(nullif(ln ->> 'damaged_qty', '')::numeric, 0), 2),
      'lot_no', case when d.transfer_id is null then nullif(trim(coalesce(ln ->> 'lot_no', '')), '') else l.lot_no end,
      'mfg', case when d.transfer_id is null then nullif(ln ->> 'mfg', '') else l.mfg::text end,
      'exp', case when d.transfer_id is null then nullif(ln ->> 'exp', '') else l.exp::text end);
  end loop;

  if d.transfer_id is null then
    delete from public.inbound_lines where delivery_id = v_id and not (id = any(keep));
  else
    for l in select * from public.inbound_lines where delivery_id = v_id and not (id = any(keep)) loop
      recv := recv || jsonb_build_object('id', l.id, 'received_qty', 0);
    end loop;
  end if;

  perform public.inbound_receive(v_id, recv);
  return v_id;
end $$;

-- Admin: approve a Receiving Report as it was sent (stock and the spreadsheet update).
create or replace function public.inbound_approve(p_id bigint)
returns int
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.is_admin() then raise exception 'Only an admin can approve Receiving Reports.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'submitted' then raise exception 'This Receiving Report isn''t waiting for approval (it''s %).', d.status; end if;
  return public.inbound_receive(p_id, '[]'::jsonb);
end $$;

-- Admin: send a report back to whoever received it, with what to fix. Nothing went into stock.
create or replace function public.inbound_send_back(p_id bigint, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.is_admin() then raise exception 'Only an admin can send a Receiving Report back.'; end if;
  if length(coalesce(trim(p_note), '')) < 3 then raise exception 'Say what needs fixing.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'submitted' then raise exception 'This Receiving Report isn''t waiting for approval.'; end if;
  update public.inbound_deliveries
     set status = 'expected', sent_back_at = now(), sent_back_by_name = public.my_name(), sent_back_note = left(trim(p_note), 500)
   where id = p_id;
  insert into public.inventory_log (branch_id, kind, message, by_name)
  values (d.branch_id, 'received', 'Receiving Report from ' || d.vendor || ' sent back: ' || left(trim(p_note), 300), public.my_name());
end $$;

create or replace function public.inbound_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. The sending location cancels it (its stock goes back).'; end if;
  update public.inbound_deliveries set status = 'cancelled'
   where id = p_id and (status = 'expected' or (status = 'submitted' and public.is_admin()));
end $$;

-- The spreadsheet sync marks batches once they're on RECEIVED LOTS.
create or replace function public.inventory_batches_written(p_ids bigint[], p_rows int[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_batches b set on_sheet = true, sheet_row = r.row_no
    from unnest(p_ids, p_rows) as r(id, row_no)
   where b.id = r.id;
end $$;

revoke all on function public.inbound_approve(bigint) from public, anon;
revoke all on function public.inbound_send_back(bigint, text) from public, anon;
revoke all on function public.inventory_batches_written(bigint[], int[]) from public, anon, authenticated;
grant execute on function public.inventory_batches_written(bigint[], int[]) to service_role;
grant execute on function public.inbound_approve(bigint) to authenticated;
grant execute on function public.inbound_send_back(bigint, text) to authenticated;

-- ---------- Orders: editing --------------------------------------------------------------------------
alter table public.orders add column if not exists revision               int not null default 1;
alter table public.orders add column if not exists invoice_update_at      timestamptz;
alter table public.orders add column if not exists invoice_update_by_name text;
alter table public.orders add column if not exists invoiced_total         numeric(12,2);

create table if not exists public.order_edits (
  id                      bigint generated always as identity primary key,
  order_id                uuid not null references public.orders(id) on delete cascade,
  revision                int not null,
  edited_by               uuid,
  edited_by_name          text,
  edited_at               timestamptz not null default now(),
  stage_before            text,
  changes                 jsonb not null,   -- [{sku, name, unit, from, to}]
  total_before            numeric(12,2),
  note                    text,
  invoice_updated_at      timestamptz,
  invoice_updated_by_name text,
  total_after             numeric(12,2),
  credit_reopened         boolean
);
create index if not exists order_edits_order_idx on public.order_edits(order_id, edited_at);
alter table public.order_edits enable row level security;
drop policy if exists order_edits_read on public.order_edits;
create policy order_edits_read on public.order_edits for select to authenticated
  using (public.is_employee() and exists (select 1 from public.orders o where o.id = order_edits.order_id));
revoke insert, update, delete on public.order_edits from anon, authenticated;
grant select on public.order_edits to authenticated;
grant all on public.order_edits to service_role;

-- Where each order sits, now with "invoice_update": edited after the Invoice # was in, back with the CRM.
do $$ begin
  if not exists (select 1 from pg_attrdef a join pg_attribute t on t.attrelid = a.adrelid and t.attnum = a.adnum
                  where a.adrelid = 'public.orders'::regclass and t.attname = 'stage'
                    and pg_get_expr(a.adbin, a.adrelid) like '%invoice_update_at%') then
    alter table public.orders drop column if exists stage;
    alter table public.orders add column stage text generated always as (
      case
        when status = 'cancelled' then 'cancelled'
        when status = 'completed' then 'completed'
        when approval_status in ('pending', 'changes_requested') then 'customer'
        when ambit_po is null then 'needs_po'
        when invoice_update_at is not null then 'invoice_update'
        when credit_status = 'hold' then 'hold'
        when credit_status is distinct from 'approved' then 'credit'
        when scheduled_for is null then 'schedule'
        else 'scheduled'
      end) stored;
    create index if not exists orders_stage_idx on public.orders(stage);
  end if;
end $$;

-- A line taken off an order keeps its stock line, so the spreadsheet can show it as Cancelled.
alter table public.inventory_lines alter column order_item_id drop not null;
alter table public.inventory_lines drop constraint if exists inventory_lines_order_item_id_fkey;
alter table public.inventory_lines add constraint inventory_lines_order_item_id_fkey
  foreign key (order_item_id) references public.order_items(id) on delete set null;
alter table public.order_variances drop constraint if exists order_variances_order_item_id_fkey;
alter table public.order_variances add constraint order_variances_order_item_id_fkey
  foreign key (order_item_id) references public.order_items(id) on delete set null;

-- Holding stock for a line (0025), now also again after an edit releases the old amount.
create or replace function public.inventory_pick(p_item bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it    public.order_items;
  o     record;
  cand  uuid[];
  need  numeric;
  take  numeric;
  lot   record;
  first record;
  today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  select id, branch_id, delivery_method, status into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status in ('cancelled', 'completed') then return; end if;
  if not exists (select 1 from public.inventory_sheets x where x.branch_id = o.branch_id and x.enabled) then return; end if;
  if exists (select 1 from public.inventory_lines
              where order_item_id = p_item and not (state = 'cancelled' and done_by in ('swap', 'edit'))) then return; end if;

  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  if cand is null then cand := array[it.product_id]; end if;

  if exists (select 1 from public.inventory_lots l where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet) then
    need := it.qty;
    for lot in
      select l.id, l.product_id, l.sku, l.lot_no,
             l.remaining - l.sheet_pending
               - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = l.id and x.state = 'reserved'), 0) as avail
        from public.inventory_lots l
        join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
         and (l.use_by is null or l.use_by >= today)
       order by p.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      select l.product_id, l.sku into first
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
       order by p.pick_rank, l.use_by nulls last, l.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, need);
    end if;
  else
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;

-- AMBIT staff edit an open order. p_lines is the whole order after the edit:
--   [{"id": 12, "qty": 4}]            a line already on it (qty 0 takes it off)
--   [{"product_id": "...", "qty": 2}] a new line
-- Changed lines let go of their stock (the spreadsheet shows those rows Cancelled) and hold the new amount.
-- Once the Sales Order # is in, the order goes back to the CRM for an invoice update.
create or replace function public.order_edit(p_order uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders;
  it       public.order_items;
  e        jsonb;
  q        numeric;
  pr       record;
  who      text := coalesce(public.my_name(), 'AMBIT');
  changes  jsonb := '[]'::jsonb;
  before   numeric;
  stage0   text;
  invoiced boolean;
  rev      int;
begin
  if not public.is_employee() or not (public.is_admin() or public.has_perm('ordering') or public.has_perm('order_desk')) then
    raise exception 'You don''t have access to edit orders.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %. Place a new order instead.', o.status; end if;
  before := o.est_subtotal;
  stage0 := o.stage;
  invoiced := o.ambit_po is not null;

  -- Lines already on the order
  for it in select * from public.order_items where order_id = p_order order by id loop
    select x into e from jsonb_array_elements(p_lines) x where nullif(x ->> 'id', '')::bigint = it.id limit 1;
    q := case when e is null then 0 else round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2) end;
    if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    if q = it.qty then continue; end if;
    if exists (select 1 from public.inventory_lines where order_item_id = it.id and state = 'done') then
      raise exception '% was already picked up on the spreadsheet, so it can''t be changed here.', it.sku;
    end if;
    update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now()
     where order_item_id = it.id and state = 'reserved';
    changes := changes || jsonb_build_object('sku', it.sku, 'name', it.name, 'unit', it.unit, 'from', it.qty, 'to', q);
    if q = 0 then
      delete from public.order_items where id = it.id;
    else
      update public.order_items
         set qty = q,
             unit_price = case when price_parts is null then unit_price end,
             line_total = case when price_parts is null and unit_price is not null then round(unit_price * q, 2) end,
             price_parts = null
       where id = it.id;
      perform public.inventory_pick(it.id);
    end if;
  end loop;

  -- New lines (priced like a new order: the CRM puts the invoice price on them)
  for e in select * from jsonb_array_elements(p_lines) loop
    if nullif(e ->> 'id', '') is not null then continue; end if;
    q := round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false) and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p left join public.categories c on c.id = p.category_id
     where p.id = nullif(e ->> 'product_id', '')::uuid and p.active;
    if pr.id is null then raise exception 'One of the new items isn''t available any more. Reload and try again.'; end if;
    if exists (select 1 from public.order_items where order_id = p_order and product_id = pr.id) then
      raise exception '% is already on this order. Change its quantity instead.', pr.sku;
    end if;
    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (p_order, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end, pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end);
    changes := changes || jsonb_build_object('sku', pr.sku, 'name', pr.name, 'unit', pr.unit, 'from', 0, 'to', q);
  end loop;

  if jsonb_array_length(changes) = 0 then raise exception 'Nothing changed.'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'An order needs at least one item. Cancel the order instead.';
  end if;
  -- ISO priced per foam set: the sets may have changed, so the CRM prices it again.
  update public.order_items set unit_price = null, line_total = null, price_parts = null
   where order_id = p_order and price_parts is not null;

  update public.orders
     set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
         has_customer_pricing = exists (select 1 from public.order_items i where i.order_id = p_order and i.customer_priced),
         revision = revision + 1,
         invoiced_total = case when invoiced then coalesce(invoiced_total, before) else invoiced_total end,
         invoice_update_at = case when invoiced then coalesce(invoice_update_at, now()) else invoice_update_at end,
         invoice_update_by_name = case when invoiced then who else invoice_update_by_name end
   where id = p_order
  returning revision into rev;

  insert into public.order_edits (order_id, revision, edited_by, edited_by_name, stage_before, changes, total_before, note)
  values (p_order, rev, auth.uid(), who, stage0, changes, before, nullif(left(trim(coalesce(p_note, '')), 500), ''));
  if o.branch_id is not null then
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  end if;
  return jsonb_build_object('revision', rev, 'invoice_update', invoiced,
                            'customer', o.approval_status in ('pending', 'changes_requested'), 'changes', changes);
end $$;

-- CRM: the new Invoice # and prices are in after an edit (call right after order_set_numbers).
-- Credit is checked again only when the total went up.
create or replace function public.order_invoice_update_done(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders;
  newt   numeric;
  oldt   numeric;
  reopen boolean;
  ch     jsonb;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.invoice_update_at is null then return jsonb_build_object('was', false); end if;
  if exists (select 1 from public.order_items i where i.order_id = p_order and i.unit_price is null and not i.customer_priced) then
    raise exception 'Enter the invoice price for every line first.';
  end if;
  newt := coalesce(o.est_subtotal, 0);
  oldt := coalesce(o.invoiced_total, newt);
  reopen := newt > oldt + 0.004 and o.credit_status = 'approved';
  update public.orders
     set invoice_update_at = null, invoice_update_by_name = null, invoiced_total = newt,
         credit_status = case when reopen then 'pending' else credit_status end,
         credit_note = case when reopen then 'Check again: the order was edited and the total went from $' || to_char(oldt, 'FM999,999,990.00')
                                              || ' to $' || to_char(newt, 'FM999,999,990.00') || '.' else credit_note end
   where id = p_order;
  select coalesce(jsonb_agg(c order by e.id), '[]'::jsonb) into ch
    from public.order_edits e, jsonb_array_elements(e.changes) c
   where e.order_id = p_order and e.invoice_updated_at is null;
  update public.order_edits
     set invoice_updated_at = now(), invoice_updated_by_name = public.my_name(), total_after = newt, credit_reopened = reopen
   where order_id = p_order and invoice_updated_at is null;
  return jsonb_build_object('was', true, 'reopened', reopen, 'before', oldt, 'after', newt, 'changes', ch);
end $$;

-- Closing an order: not while it's waiting for an invoice update or a credit check.
create or replace function public.order_complete(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not (public.has_perm('order_desk') or public.has_perm('inventory')) then
    raise exception 'You don''t have access to close orders.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.scheduled_for is null then raise exception 'Schedule the order first.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is already %.', o.status; end if;
  if o.invoice_update_at is not null then raise exception 'This order was edited. The CRM updates the invoice first.'; end if;
  if o.credit_status is distinct from 'approved' then raise exception 'Credit has to be approved (again) before this order is picked up or delivered.'; end if;
  if not exists (select 1 from public.order_files f where f.order_id = p_order and f.kind = 'bol') then
    raise exception 'Add a photo or scan of the signed BOL first.';
  end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order;
end $$;

-- Staff: approve an order without the customer's email approval (by phone, in person, or not needed).
create or replace function public.order_approve_without_customer(p_order uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me public.profiles;
begin
  if not public.is_employee() then raise exception 'Only AMBIT staff can approve orders.'; end if;
  select * into me from public.profiles where id = auth.uid();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status not in ('pending', 'changes_requested', 'not_required') then raise exception 'This order is not waiting for the customer.'; end if;
  update public.orders
     set approval_status = 'approved', approval_method = 'staff_recorded',
         approved_at = now(), approved_by_name = coalesce(me.full_name, me.email),
         approval_note = left(coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Approved without customer email approval'), 500),
         approval_token_hash = null,
         email_status = 'pending', email_error = null
   where id = p_order;
end $$;

revoke all on function public.order_edit(uuid, jsonb, text) from public, anon;
revoke all on function public.order_invoice_update_done(uuid) from public, anon;
revoke all on function public.order_approve_without_customer(uuid, text) from public, anon;
grant execute on function public.order_edit(uuid, jsonb, text) to authenticated;
grant execute on function public.order_invoice_update_done(uuid) to authenticated;
grant execute on function public.order_approve_without_customer(uuid, text) to authenticated;

select 'receiving approval, lot tracking and order edits ready' as status;
-- =====================================================================
-- AMBIT Intelligence update 0042 - "Customer Has Already Paid"
-- * Accounting can tick "Customer Has Already Paid" when they release an order (next to COD Only and No Checks
--   Allowed). The warehouse sees PAID: nothing to collect at pickup / delivery. Ticking it clears COD Only and
--   No Checks Allowed on that order (nothing to collect), but the customer's usual COD / No Checks setting is kept
--   for their next order. It isn't remembered for the next order: every payment is its own.
-- * If the order is edited later and the total goes up, credit is checked again and "already paid" comes off
--   (they paid the old total, not the difference).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.orders add column if not exists pay_prepaid boolean not null default false;

-- Same as 0035, plus p_prepaid (left out = unchanged, so older screens keep working).
drop function if exists public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean);
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false,
                                                        p_cod boolean default null, p_no_checks boolean default null,
                                                        p_prepaid boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  ts   text;
  paid boolean;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'Enter the Sales Order # first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  if p_approve and o.company_id is not null then
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') and not coalesce(p_charge_tax, false) then
      raise exception 'This customer''s tax-exempt certificate is %. Verify a current certificate first, or choose "Charge sales tax on this order".',
        case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'waiting to be verified' end;
    end if;
  end if;
  paid := p_approve and coalesce(p_prepaid, o.pay_prepaid, false);
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end,
         pay_prepaid   = case when p_approve then paid else pay_prepaid end,
         pay_cod       = case when paid then false when p_approve then coalesce(p_cod, pay_cod) else pay_cod end,
         pay_no_checks = case when paid then false when p_approve then coalesce(p_no_checks, pay_no_checks) else pay_no_checks end
   where id = p_order;
  -- The customer's next order starts the same way (not when they paid this one up front).
  if p_approve and not paid and o.company_id is not null and (p_cod is not null or p_no_checks is not null) then
    update public.companies
       set pay_cod = coalesce(p_cod, pay_cod), pay_no_checks = coalesce(p_no_checks, pay_no_checks)
     where id = o.company_id;
  end if;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean, boolean) to authenticated;

-- Same as 0041: the CRM's invoice update after an edit. When the total went up and credit opens again, an order
-- that was already paid isn't any more (only the old total was).
create or replace function public.order_invoice_update_done(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders;
  newt   numeric;
  oldt   numeric;
  reopen boolean;
  ch     jsonb;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.invoice_update_at is null then return jsonb_build_object('was', false); end if;
  if exists (select 1 from public.order_items i where i.order_id = p_order and i.unit_price is null and not i.customer_priced) then
    raise exception 'Enter the invoice price for every line first.';
  end if;
  newt := coalesce(o.est_subtotal, 0);
  oldt := coalesce(o.invoiced_total, newt);
  reopen := newt > oldt + 0.004 and o.credit_status = 'approved';
  update public.orders
     set invoice_update_at = null, invoice_update_by_name = null, invoiced_total = newt,
         credit_status = case when reopen then 'pending' else credit_status end,
         pay_prepaid = case when reopen then false else pay_prepaid end,
         credit_note = case when reopen then 'Check again: the order was edited and the total went from $' || to_char(oldt, 'FM999,999,990.00')
                                              || ' to $' || to_char(newt, 'FM999,999,990.00') || '.'
                                              || case when o.pay_prepaid then ' The customer had already paid the old total: tick Customer Has Already Paid again only once they''ve paid the difference.' else '' end
                            else credit_note end
   where id = p_order;
  select coalesce(jsonb_agg(c order by e.id), '[]'::jsonb) into ch
    from public.order_edits e, jsonb_array_elements(e.changes) c
   where e.order_id = p_order and e.invoice_updated_at is null;
  update public.order_edits
     set invoice_updated_at = now(), invoice_updated_by_name = public.my_name(), total_after = newt, credit_reopened = reopen
   where order_id = p_order and invoice_updated_at is null;
  return jsonb_build_object('was', true, 'reopened', reopen, 'before', oldt, 'after', newt, 'changes', ch);
end $$;
revoke all on function public.order_invoice_update_done(uuid) from public, anon;
grant execute on function public.order_invoice_update_done(uuid) to authenticated;

select 'Customer Has Already Paid ready' as status;
-- =====================================================================
-- AMBIT Intelligence update 0043 - Who gets the credit check emails
-- * Admin > Email alerts: tick the people who get "Credit check needed" emails (when the CRM enters the Sales Order #,
--   and "check again" after an edit raises the total). Admins can be on the list too.
-- * The first time: Kevin Lall, Melinda Gunn, Jeremiah Bryant and Al Rearick.
-- Run once in Supabase > SQL Editor. Safe to run again (it never changes the list once someone is on it).
-- =====================================================================

alter table public.profiles add column if not exists notify_credit boolean not null default false;

do $$ begin
  if not exists (select 1 from public.profiles where notify_credit) then
    update public.profiles set notify_credit = true
     where status = 'active' and role in ('admin', 'employee')
       and lower(email) in ('kevin.lall@ambitpu.com', 'melinda.gunn@ambitpu.com', 'jeremiah.bryant@ambitpu.com', 'al.rearick@ambitpu.com');
  end if;
end $$;

-- Admin: the whole list at once (everyone else comes off it).
create or replace function public.set_credit_emails(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can change who gets the credit check emails.'; end if;
  update public.profiles set notify_credit = (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'))
   where notify_credit is distinct from (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'));
  select count(*) into n from public.profiles where notify_credit and status = 'active';
  if n = 0 then raise exception 'Pick at least one person, or nobody will be told when an order needs a credit check.'; end if;
  return n;
end $$;
revoke all on function public.set_credit_emails(uuid[]) from public, anon;
grant execute on function public.set_credit_emails(uuid[]) to authenticated;

select 'credit check emails: ' || string_agg(full_name, ', ' order by full_name) as status
  from public.profiles where notify_credit and status = 'active';
-- =====================================================================
-- AMBIT Intelligence update 0044 - Custom foam orders
-- * "Make Custom Foam Order" on the order screen (AMBIT staff): order a specific ISO brand (Covestro, Dow,
--   Huntsman, Wanhua) and any resins straight from a location's inventory, instead of the store's one
--   "ISO A-Side" (where the app picks the brand). The warehouse holds that exact brand, soonest-expiring lot first.
-- * place_order: AMBIT staff may order an ISO brand by name (brands are stocked under ISO A-Side and aren't
--   sold by name in the store, so contractors still can't). Otherwise unchanged from 0015.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Placing an order: AMBIT staff can order an ISO brand by name ----------
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
     where p.id = (item->>'product_id')::uuid
       and (p.active or (p.stock_of is not null and me.role in ('admin', 'employee')));
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

select 'custom foam orders ready' as status;
-- =====================================================================
-- AMBIT Intelligence update 0045 - Who can add new customers
-- * New customers need a credit application and credit approval first, so only admins and staff with the new
--   "Add new customers" box can create one. Everyone else (sales reps, warehouse, techs, CRM) taps
--   "Request a new customer": the details are emailed to the credit team, nothing is created.
-- * The Accounting job role gets the box by default; an admin can tick it for anyone in Admin > Accounts.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports', 'add_customers']
$$;

-- Accounting adds customers (they do the credit vetting).
update public.profiles
   set perms = perms || array['add_customers']
 where role = 'employee' and job_role = 'accounting' and perms is not null and not ('add_customers' = any(perms));

-- The database itself refuses a new customer from anyone else (not only the app's screens).
drop policy if exists companies_employee_insert on public.companies;
create policy companies_employee_insert on public.companies for insert to authenticated
  with check (public.is_employee() and public.has_perm('add_customers')
              and source = 'app' and needs_qb_setup and created_by = auth.uid());

select 'add customers: ' || coalesce(string_agg(full_name, ', ' order by full_name), 'admins only') as status
  from public.profiles where status = 'active' and role = 'employee' and 'add_customers' = any(perms);
-- =====================================================================
-- AMBIT Intelligence update 0046 - Admins correct completed orders
-- * Edit order on a completed order (picked up or delivered), admins only. For each changed line, what was taken
--   out of stock goes back in and the corrected amount is taken out (lots too: soonest-expiring first), so the
--   location's spreadsheet ends up right. Lines that didn't change aren't touched.
-- * The order then goes to the order desk's "Invoice update" step (it stays completed): the CRM updates the invoice
--   and enters the new Invoice # and prices. Credit isn't opened again (the goods are gone); if the total changed,
--   the credit team is emailed to collect or credit the difference, and the customer gets the updated order.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Holding stock for a line: also while an admin corrects a completed order ----------
create or replace function public.inventory_pick(p_item bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it    public.order_items;
  o     record;
  cand  uuid[];
  need  numeric;
  take  numeric;
  lot   record;
  first record;
  today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  select id, branch_id, delivery_method, status into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status = 'cancelled' then return; end if;
  -- A completed order only holds stock while an admin corrects it (order_edit turns it into stock taken).
  if o.status = 'completed' and coalesce(current_setting('ambit.pick_closed', true), '') <> 'on' then return; end if;
  if not exists (select 1 from public.inventory_sheets x where x.branch_id = o.branch_id and x.enabled) then return; end if;
  if exists (select 1 from public.inventory_lines
              where order_item_id = p_item and not (state = 'cancelled' and done_by in ('swap', 'edit'))) then return; end if;

  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  if cand is null then cand := array[it.product_id]; end if;

  if exists (select 1 from public.inventory_lots l where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet) then
    need := it.qty;
    for lot in
      select l.id, l.product_id, l.sku, l.lot_no,
             l.remaining - l.sheet_pending
               - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = l.id and x.state = 'reserved'), 0) as avail
        from public.inventory_lots l
        join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
         and (l.use_by is null or l.use_by >= today)
       order by p.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      select l.product_id, l.sku into first
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
       order by p.pick_rank, l.use_by nulls last, l.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, need);
    end if;
  else
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;

-- ---------- Editing an order: admins can correct a completed one ----------
create or replace function public.order_edit(p_order uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders;
  it       public.order_items;
  e        jsonb;
  q        numeric;
  pr       record;
  who      text := coalesce(public.my_name(), 'AMBIT');
  changes  jsonb := '[]'::jsonb;
  before   numeric;
  stage0   text;
  invoiced boolean;
  rev      int;
  closed   boolean;
  l        public.inventory_lines;
  tag      text;
begin
  if not public.is_employee() or not (public.is_admin() or public.has_perm('ordering') or public.has_perm('order_desk')) then
    raise exception 'You don''t have access to edit orders.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled. Place a new order instead.'; end if;
  -- A completed order (picked up or delivered): only an admin corrects it. What was taken out of stock for a
  -- changed line goes back in, and the corrected amount is taken out again.
  closed := o.status = 'completed';
  if closed and not public.is_admin() then raise exception 'This order is completed. Only an admin can correct a completed order.'; end if;
  tag := 'ORD-' || o.order_no || ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end || ': ';
  if closed then perform set_config('ambit.pick_closed', 'on', true); end if;
  before := o.est_subtotal;
  stage0 := o.stage;
  invoiced := o.ambit_po is not null;

  -- Lines already on the order
  for it in select * from public.order_items where order_id = p_order order by id loop
    select x into e from jsonb_array_elements(p_lines) x where nullif(x ->> 'id', '')::bigint = it.id limit 1;
    q := case when e is null then 0 else round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2) end;
    if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    if q = it.qty then continue; end if;
    if not closed and exists (select 1 from public.inventory_lines where order_item_id = it.id and state = 'done') then
      raise exception '% was already picked up on the spreadsheet, so it can''t be changed here.', it.sku;
    end if;
    if closed then
      for l in select * from public.inventory_lines where order_item_id = it.id and state = 'done' and stock_taken loop
        perform public.inventory_line_stock(l.id, 1, 'order', tag, who);
      end loop;
    end if;
    update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now()
     where order_item_id = it.id and state in ('reserved', 'done');
    changes := changes || jsonb_build_object('sku', it.sku, 'name', it.name, 'unit', it.unit, 'from', it.qty, 'to', q);
    if q = 0 then
      delete from public.order_items where id = it.id;
    else
      update public.order_items
         set qty = q,
             unit_price = case when price_parts is null then unit_price end,
             line_total = case when price_parts is null and unit_price is not null then round(unit_price * q, 2) end,
             price_parts = null
       where id = it.id;
      perform public.inventory_pick(it.id);
    end if;
  end loop;

  -- New lines (priced like a new order: the CRM puts the invoice price on them)
  for e in select * from jsonb_array_elements(p_lines) loop
    if nullif(e ->> 'id', '') is not null then continue; end if;
    q := round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false) and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p left join public.categories c on c.id = p.category_id
     where p.id = nullif(e ->> 'product_id', '')::uuid and p.active;
    if pr.id is null then raise exception 'One of the new items isn''t available any more. Reload and try again.'; end if;
    if exists (select 1 from public.order_items where order_id = p_order and product_id = pr.id) then
      raise exception '% is already on this order. Change its quantity instead.', pr.sku;
    end if;
    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (p_order, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end, pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end);
    changes := changes || jsonb_build_object('sku', pr.sku, 'name', pr.name, 'unit', pr.unit, 'from', 0, 'to', q);
  end loop;

  if jsonb_array_length(changes) = 0 then raise exception 'Nothing changed.'; end if;
  -- Completed: the corrected amounts were picked (soonest-expiring lot first) and leave stock now.
  if closed then
    for l in select * from public.inventory_lines where order_id = p_order and state = 'reserved' loop
      perform public.inventory_line_stock(l.id, -1, 'order', tag, who);
    end loop;
    update public.inventory_lines set state = 'done', done_by = 'app', stock_taken = true, needs_write = true, updated_at = now()
     where order_id = p_order and state = 'reserved';
    perform set_config('ambit.pick_closed', '', true);
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'An order needs at least one item. Cancel the order instead.';
  end if;
  -- ISO priced per foam set: the sets may have changed, so the CRM prices it again.
  update public.order_items set unit_price = null, line_total = null, price_parts = null
   where order_id = p_order and price_parts is not null;

  update public.orders
     set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
         has_customer_pricing = exists (select 1 from public.order_items i where i.order_id = p_order and i.customer_priced),
         revision = revision + 1,
         invoiced_total = case when invoiced then coalesce(invoiced_total, before) else invoiced_total end,
         invoice_update_at = case when invoiced then coalesce(invoice_update_at, now()) else invoice_update_at end,
         invoice_update_by_name = case when invoiced then who else invoice_update_by_name end
   where id = p_order
  returning revision into rev;

  insert into public.order_edits (order_id, revision, edited_by, edited_by_name, stage_before, changes, total_before, note)
  values (p_order, rev, auth.uid(), who, stage0, changes, before, nullif(left(trim(coalesce(p_note, '')), 500), ''));
  if o.branch_id is not null then
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  end if;
  return jsonb_build_object('revision', rev, 'invoice_update', invoiced, 'closed', closed,
                            'customer', o.approval_status in ('pending', 'changes_requested'), 'changes', changes);
end $$;

-- ---------- The CRM's invoice update after an edit: no credit re-check on a completed order ----------
create or replace function public.order_invoice_update_done(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders;
  newt   numeric;
  oldt   numeric;
  reopen boolean;
  closed boolean;
  ch     jsonb;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.invoice_update_at is null then return jsonb_build_object('was', false); end if;
  if exists (select 1 from public.order_items i where i.order_id = p_order and i.unit_price is null and not i.customer_priced) then
    raise exception 'Enter the invoice price for every line first.';
  end if;
  newt := coalesce(o.est_subtotal, 0);
  oldt := coalesce(o.invoiced_total, newt);
  -- Corrected after pickup or delivery: the goods are gone, so credit isn't opened again; the credit team is told
  -- to collect (or credit) the difference instead.
  closed := o.status = 'completed';
  reopen := not closed and newt > oldt + 0.004 and o.credit_status = 'approved';
  update public.orders
     set invoice_update_at = null, invoice_update_by_name = null, invoiced_total = newt,
         credit_status = case when reopen then 'pending' else credit_status end,
         pay_prepaid = case when reopen then false else pay_prepaid end,
         credit_note = case when reopen then 'Check again: the order was edited and the total went from $' || to_char(oldt, 'FM999,999,990.00')
                                              || ' to $' || to_char(newt, 'FM999,999,990.00') || '.'
                                              || case when o.pay_prepaid then ' The customer had already paid the old total: tick Customer Has Already Paid again only once they''ve paid the difference.' else '' end
                            else credit_note end
   where id = p_order;
  select coalesce(jsonb_agg(c order by e.id), '[]'::jsonb) into ch
    from public.order_edits e, jsonb_array_elements(e.changes) c
   where e.order_id = p_order and e.invoice_updated_at is null;
  update public.order_edits
     set invoice_updated_at = now(), invoice_updated_by_name = public.my_name(), total_after = newt, credit_reopened = reopen
   where order_id = p_order and invoice_updated_at is null;
  return jsonb_build_object('was', true, 'reopened', reopen, 'closed', closed, 'before', oldt, 'after', newt, 'changes', ch);
end $$;

-- ---------- Sales Order # / Invoice # / prices: also on a completed order waiting for its invoice update ----------
create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text, p_prices jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  it    public.order_items;
  e     jsonb;
  pt    jsonb;
  pr    numeric;
  pq    numeric;
  tot   numeric;
  n     numeric;
  parts jsonb;
  miss  text;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' or (o.status = 'completed' and o.invoice_update_at is null) then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  if coalesce(trim(p_invoice), '') = '' then raise exception 'Enter the Invoice # too.'; end if;
  if p_prices is not null then
    if jsonb_typeof(p_prices) <> 'array' then raise exception 'Prices are missing.'; end if;
    for e in select * from jsonb_array_elements(p_prices) loop
      -- An ISO line priced per foam set: {"id": 12, "parts": [{"with": 34, "qty": 12, "price": 1085}, ...]}
      if jsonb_typeof(e->'parts') = 'array' and jsonb_array_length(e->'parts') > 0 then
        select * into it from public.order_items where id = (e->>'id')::bigint and order_id = p_order;
        if it.id is null then continue; end if;
        tot := 0; n := 0; parts := '[]'::jsonb;
        for pt in select * from jsonb_array_elements(e->'parts') loop
          if coalesce(pt->>'price', '') = '' then raise exception 'Enter every ISO price for %.', it.sku; end if;
          begin
            pr := round((pt->>'price')::numeric, 2);
            pq := (pt->>'qty')::numeric;
          exception when others then
            raise exception 'A price isn''t a number: %', pt->>'price';
          end;
          if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
          if pq is null or pq <= 0 then raise exception 'The % split isn''t right. Reload the page and try again.', it.sku; end if;
          tot := tot + round(pr * pq, 2);
          n := n + pq;
          parts := parts || jsonb_build_array(jsonb_build_object(
            'with', case when jsonb_typeof(pt->'with') = 'number' then (pt->>'with')::bigint end,
            'qty', pq,
            'price', pr));
        end loop;
        if n <> it.qty then
          raise exception 'The % prices cover % drums but the order has %. Reload the page and try again.', it.sku, trim_scale(n), trim_scale(it.qty);
        end if;
        update public.order_items
           set unit_price = round(tot / it.qty, 2), line_total = tot, price_parts = parts
         where id = it.id;
        continue;
      end if;
      if coalesce(e->>'price', '') = '' then continue; end if;
      begin
        pr := round((e->>'price')::numeric, 2);
      exception when others then
        raise exception 'A price isn''t a number: %', e->>'price';
      end;
      if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
      update public.order_items
         set unit_price = pr, line_total = round(pr * qty, 2), price_parts = null
       where id = (e->>'id')::bigint and order_id = p_order;
    end loop;
    select string_agg(i.sku, ', ' order by i.id) into miss
      from public.order_items i where i.order_id = p_order and i.unit_price is null;
    if miss is not null then raise exception 'Enter the price for %.', miss; end if;
    update public.orders
       set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
           priced_at = now(), priced_by_name = public.my_name()
     where id = p_order;
  end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), invoice_no = left(trim(p_invoice), 60),
         po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- ---------- Where each order sits: a corrected completed order waits for its invoice update ----------
do $$
declare expr text;
begin
  select pg_get_expr(a.adbin, a.adrelid) into expr
    from pg_attrdef a join pg_attribute t on t.attrelid = a.adrelid and t.attnum = a.adnum
   where a.adrelid = 'public.orders'::regclass and t.attname = 'stage';
  if expr is null or (length(expr) - length(replace(expr, 'invoice_update_at', ''))) / length('invoice_update_at') < 2 then
    alter table public.orders drop column if exists stage;
    alter table public.orders add column stage text generated always as (
      case
        when status = 'cancelled' then 'cancelled'
        when status = 'completed' and invoice_update_at is not null then 'invoice_update'
        when status = 'completed' then 'completed'
        when approval_status in ('pending', 'changes_requested') then 'customer'
        when ambit_po is null then 'needs_po'
        when invoice_update_at is not null then 'invoice_update'
        when credit_status = 'hold' then 'hold'
        when credit_status is distinct from 'approved' then 'credit'
        when scheduled_for is null then 'schedule'
        else 'scheduled'
      end) stored;
    create index if not exists orders_stage_idx on public.orders(stage);
  end if;
end $$;

select 'admins can correct completed orders' as status;

-- =====================================================================
-- AMBIT Intelligence update 0047 - Custom foam order: pick the exact lot / batch
-- * "Make Custom Foam Order" (AMBIT staff) lists every lot of each ISO brand and resin at the location (lot #,
--   made and expiry dates, drums available), so staff can order exact drums: 4 from lot PA86002836, 2 from lot
--   PA86002841. Anything not given a lot is still picked by the app (soonest-expiring first).
-- * place_order takes the lots picked (p_lots). The database checks each one: right location, right product,
--   not expired, and enough drums still available, so two people can't hold the same drums.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Lots for the order screen (staff) ----------
-- Every lot with drums left on a location's FOAM LOTS tab, with what's still free to order.
create or replace function public.order_lot_choices(p_branch text default null)
returns table (lot_id bigint, branch_id text, product_id uuid, sku text, lot_no text, mfg date, exp date, use_by date,
               remaining numeric, available numeric, expired boolean)
language sql stable set search_path = public as $$
  select x.id, x.branch_id, x.product_id, x.sku, x.lot_no, x.mfg, x.exp, x.use_by, x.remaining,
         x.remaining - x.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved'), 0),
         coalesce(x.use_by < (now() at time zone 'America/Chicago')::date, false)
    from public.inventory_lots x
   where public.is_employee() and public.is_active()
     and (p_branch is null or x.branch_id = p_branch)
     and x.on_sheet and x.remaining > 0
     and exists (select 1 from public.inventory_sheets s where s.branch_id = x.branch_id and s.enabled)
   order by x.branch_id, x.product_id, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
$$;

-- ---------- Holding the lots picked for one order line ----------
-- Runs inside place_order, right after the line is added (the app has already held drums soonest-expiring first;
-- those are swapped for the lots picked). Not callable on its own.
create or replace function public.order_item_pick_lots(p_item bigint, p_lots jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it     public.order_items;
  o      record;
  e      jsonb;
  lot    record;
  first  record;
  q      numeric;
  picked numeric := 0;
  need   numeric;
  take   numeric;
  cand   uuid[];
  seen   bigint[] := '{}';
  today  date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  if p_lots is null or jsonb_typeof(p_lots) <> 'array' or jsonb_array_length(p_lots) = 0 then return; end if;
  select id, branch_id, delivery_method into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' then
    raise exception 'Lots can only be picked when the order comes from an AMBIT location (not drop ship).';
  end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled) then
    raise exception 'This location''s inventory spreadsheet isn''t connected, so lots can''t be picked here.';
  end if;

  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  cand := coalesce(cand, '{}') || it.product_id;

  -- What the app held on its own for this line is replaced by the lots picked.
  delete from public.inventory_lines where order_item_id = it.id and state = 'reserved' and sheet_row is null;

  for e in select * from jsonb_array_elements(p_lots) loop
    q := round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select x.id, x.branch_id, x.product_id, x.sku, x.lot_no, x.on_sheet, x.use_by,
           x.remaining - x.sheet_pending
             - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved'), 0) as avail
      into lot
      from public.inventory_lots x
     where x.id = nullif(e ->> 'lot_id', '')::bigint;
    if lot.id is null or lot.branch_id <> o.branch_id or not lot.on_sheet then
      raise exception 'A lot picked for % isn''t on this location''s FOAM LOTS tab any more. Reload the page and pick again.', it.sku;
    end if;
    if not (lot.product_id = any(cand)) then
      raise exception 'Lot % is %, not %. Reload the page and pick again.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lot.sku, it.sku;
    end if;
    if lot.id = any(seen) then
      raise exception 'Lot % is on the order twice for %. Reload the page and pick again.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), it.sku;
    end if;
    seen := seen || lot.id;
    if lot.use_by is not null and lot.use_by < today then
      raise exception 'Lot % of % expired on %. Pick another lot.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lot.sku, to_char(lot.use_by, 'FMMM/FMDD/YYYY');
    end if;
    if q > lot.avail then
      raise exception 'Lot % of % only has % available now. Reload the page and pick again.',
        coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lot.sku, trim_scale(greatest(lot.avail, 0));
    end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
    values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, q, lot.id, nullif(lot.lot_no, ''));
    picked := picked + q;
  end loop;

  if picked > it.qty then
    raise exception 'The lots picked for % add up to % but the order has %. Reload the page and pick again.', it.sku, trim_scale(picked), trim_scale(it.qty);
  end if;

  -- The rest of the line (no lot picked): soonest-expiring lot first, like any order.
  need := it.qty - picked;
  if need > 0 then
    for lot in
      select x.id, x.product_id, x.sku, x.lot_no,
             x.remaining - x.sheet_pending
               - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved'), 0) as avail
        from public.inventory_lots x
        join public.products p on p.id = x.product_id
       where x.branch_id = o.branch_id and x.product_id = any(cand) and x.on_sheet
         and (x.use_by is null or x.use_by >= today)
       order by p.pick_rank, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      -- Short on stock: the rest waits with no lot yet (pick it on the order page later).
      select x.product_id, x.sku into first
        from public.inventory_lots x join public.products p on p.id = x.product_id
       where x.branch_id = o.branch_id and x.product_id = any(cand) and x.on_sheet
       order by p.pick_rank, x.use_by nulls last, x.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, coalesce(first.product_id, it.product_id), coalesce(first.sku, it.sku), need);
    end if;
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.order_item_pick_lots(bigint, jsonb) from public, anon, authenticated;

-- ---------- Placing an order: AMBIT staff can pick the lots ----------
-- Same as 0044, plus p_lots: [{"product_id": "...", "lot_id": 12, "qty": 4}, ...] (staff only).
drop function if exists public.place_order(jsonb, text, text, text, text, date, text, uuid, text);
create or replace function public.place_order(
  p_items           jsonb,
  p_delivery_method text,
  p_branch_id       text default null,
  p_ship_address    text default null,
  p_po_number       text default null,
  p_needed_by       date default null,
  p_notes           text default null,
  p_company_id      uuid default null,
  p_customer_name   text default null,
  p_lots            jsonb default null
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
  v_item   bigint;
  v_lots   jsonb;
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
  if p_lots is not null and jsonb_typeof(p_lots) = 'array' and jsonb_array_length(p_lots) > 0
     and me.role not in ('admin', 'employee') then
    raise exception 'Only AMBIT staff can pick lots.';
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
     where p.id = (item->>'product_id')::uuid
       and (p.active or (p.stock_of is not null and me.role in ('admin', 'employee')));
    if not found then
      raise exception 'An item in your order is no longer available. Please refresh and try again.';
    end if;

    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (new_id, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end,
            pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end)
    returning id into v_item;

    -- Staff picked the exact lots (custom foam order): hold those drums.
    if p_lots is not null and jsonb_typeof(p_lots) = 'array' and me.role in ('admin', 'employee') then
      select jsonb_agg(x) into v_lots from jsonb_array_elements(p_lots) x where x ->> 'product_id' = pr.id::text;
      if v_lots is not null then perform public.order_item_pick_lots(v_item, v_lots); end if;
    end if;

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
revoke all on function public.place_order(jsonb, text, text, text, text, date, text, uuid, text, jsonb) from public, anon;
grant execute on function public.place_order(jsonb, text, text, text, text, date, text, uuid, text, jsonb) to authenticated;
revoke all on function public.order_lot_choices(text) from public, anon;
grant execute on function public.order_lot_choices(text) to authenticated;

select 'custom foam lots ready' as status,
       (select count(*) from public.inventory_lots where on_sheet and remaining > 0) as lots_with_drums;
-- =====================================================================
-- AMBIT Intelligence update 0048 - AMBIT-OPS demo data and logo colors
-- * Admin > AMBIT-OPS: "Fill with sample jobs" loads a year of realistic work into an AMBIT demo workspace
--   (never a real contractor's): about 300 jobs from new leads to fully costed work orders, repeat builder
--   customers, rigs, crews, chemical on the shelf, sets, lot numbers, time and yield. Sample customers use
--   example.com emails and 555-01xx phone numbers, logs are never shared with AMBIT, and nothing is emailed.
--   "Delete demo" removes a demo workspace and everything in it.
-- * ops_set_theme: the colors picked from a contractor's logo, used for their buttons, widgets and charts.
-- * ops_kpis: the numbers on the AMBIT-OPS Home screen in one call.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Logo colors (owner or office) ----------
create or replace function public.ops_set_theme(p_theme jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t jsonb := '{}'::jsonb;
  k text;
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can change the colors.'; end if;
  if p_theme is not null and jsonb_typeof(p_theme) = 'object' then
    foreach k in array array['primary', 'secondary'] loop
      if coalesce(p_theme ->> k, '') ~* '^#[0-9a-f]{6}$' then t := t || jsonb_build_object(k, lower(p_theme ->> k)); end if;
    end loop;
    if jsonb_typeof(p_theme -> 'palette') = 'array' then
      t := t || jsonb_build_object('palette', (select coalesce(jsonb_agg(lower(x)), '[]'::jsonb) from (
        select x from jsonb_array_elements_text(p_theme -> 'palette') x where x ~* '^#[0-9a-f]{6}$' limit 8) s));
    end if;
    t := t || jsonb_build_object('from', coalesce(nullif(p_theme ->> 'from', ''), 'logo'), 'at', now());
  end if;
  update public.companies
     set ops_settings = case when t ? 'primary'
                             then coalesce(ops_settings, '{}'::jsonb) || jsonb_build_object('theme', t, 'color', t ->> 'primary')
                             else coalesce(ops_settings, '{}'::jsonb) - 'theme' - 'color' end
   where id = public.ops_company();
end $$;
revoke all on function public.ops_set_theme(jsonb) from public, anon;
grant execute on function public.ops_set_theme(jsonb) to authenticated;

-- ---------- Small helpers for the sample data (not callable from the app) ----------
create or replace function public.ops_demo_pick(p text[]) returns text
language sql volatile as $$ select p[1 + floor(random() * array_length(p, 1))::int] $$;
create or replace function public.ops_demo_rnd(a numeric, b numeric) returns numeric
language sql volatile as $$ select a + (b - a) * random()::numeric $$;
revoke all on function public.ops_demo_pick(text[]) from public, anon, authenticated;
revoke all on function public.ops_demo_rnd(numeric, numeric) from public, anon, authenticated;

-- ---------- Fill an AMBIT demo workspace with a year of sample work ----------
create or replace function public.admin_ops_demo_fill(p_company uuid, p_me uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        public.companies;
  co       uuid := p_company;
  me       uuid := coalesce(p_me, auth.uid());
  today    date := (now() at time zone 'America/Chicago')::date;
  tz       text := 'America/Chicago';
  sig      text := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABaCAYAAAACcWsdAAAEIUlEQVR42u3dW26jQBBAUWxlC/7O/peVby+C+YrEWA7m0Y+q5lwp0ijJBNrQl6rqB7d5nicAyMDdRwCAsACAsAAQFgAQFgAQFgDCAgDCAgDCAkBYAEBYAEBYAAgLAAgLAAgLAGEBAGEBAGEBICwAICwAICwAhAUAhAUAr3z5CMbl8fj+76WTz+fPzacCERbCy+qv7wGEhXCyIi0QFgAQFkrxfP7c1K4wCrd5nqVOAxWml216bcvazwARVuBO/VctR40HIKwUBens0voUQS2/R8wgrKSykh4Bk4mjU4KC9PLfS6E9Ht9zVpGNLuARa48QYe2e9b1WpB4h1R0hLVR7JCyywmXqkyCsYdNE56+tIKzw0VW2tGnvOWZNC9+NgpIWYUkFdYRUkZXpGoQFtZFU18ADhrDUOwaYLDra57HlvD1gCOsyHfmKqUb0tvU+v9+lXGtLukBYXWWFfNFVjQeMjRAJK9XTOLLwriDmnnKwESJh6TzqehbJSz8Jy4z28WR8JIKsVXesuRHimqCIaxpz8XNNWS0XRkdZFK1OF2ORfKsHxe/vlbjWmaeI3EUHMIWl/b5iRyOnM/f61mOWiOpq9cm7G/babS2dQi0j0QgR5JnzWDtujXP6TTuXXyWE0lKOy2PVkNY9e8TTqm4VaU5W1HrT642asf5Su2Pv3UTyk7jOnFtpObaYAnKvdcFb3KiK7Dk6eQ9pnX3A7F0kf2bjwTPHOlKs/+uYR+X46VhT1KJ7z8iqVSeIFF2VuhlatGvPYEWvAYWz9aG953r0949GMntGWs9GS7Wu2z1j7SjCFrmjFvr3tutdlBvlXYgllmRFOEaJ/3tEjj3a1jwlrF3rufJ+3tGmMnxKyc9uOV2yjS3S1pYPsT2pZCs5tnhQfWVJnaK88abXnKysEd3el3v0bufR6KVXutTi/lsLQlr3v3uGjnbF13O9dvIRitQ9/t6WdrWYCDpKCWHLyGJKYZVqTERZ1Tz26/SAqCnwnvR0a2rYY2S5VJpt19OBZrqfmQ3cI0/ukaptne9Ss+01i7mfpNWjPldTLK0jZMLqnGZEL663LAhHG+IvvddU7Q79TpatojmyKsttnudwkzuzjASWiAqitfVTm862uWcU+WnWt73npYRFhpejXuSSi2yjtHUtKi4RLeytd7W4Xq1G7cgqQYS1tWNmHQk8GnFEFvO7qLj0+Y4+n86yscTCWrtBW4Tp0aQVvbP2Lv6j7pIgwqowKpPpImx9mmaKIkd4kFxlnzbC8kJMKe/gaRuZENalO0KE2eEiE58/YSH1fCoyAWEhZMpLJiAskAkwec0XmQAYS1hkAiBVhEUmAKZJDQvAZPEzABAWAMICAMICAMICQFgAQFgAQFgACAsACAsACAsAYQEAYQEAYQEgLAAgLAAgLABD8Q/Io9Li4uc1wQAAAABJRU5ErkJggg==';
  -- places, products, rigs, crew
  loc1 uuid; loc2 uuid;
  p_oc uuid; p_cc uuid; p_blown uuid; p_r13 uuid; p_r19 uuid; p_r30 uuid; p_air uuid; p_rem uuid;
  rig_oc1 uuid; rig_cc uuid; rig_oc2 uuid; rig_blow uuid;
  crew uuid[] := '{}'; crew_names text[] := array['Marcus Reed','Tyler Hughes','Jose Alvarez','Cody Watkins','Brandon Pierce','Luis Ortega','Dalton Price','Kyle Simmons','Eli Navarro','Trent Baxter','Austin Cole'];
  cid uuid;
  -- customers
  builders uuid[] := '{}'; builder_names text[] := array['Redbud Custom Homes','Prairie Oak Builders','Canyon Creek Homes','Hearthstone Construction','Ironwood Builders','Cimarron Homes','Bluestem Development','Tall Grass Homes','Red Earth Builders','Arbuckle Custom Homes','Keystone Residential','Summit Ridge Homes','Twin Lakes Construction','Pioneer Homes','Frontier Barns & Shops','Oak Hollow Builders','Legacy Post Frame','Heritage Custom Homes','Stillwater Homes','Sooner Steel Buildings','Chisholm Trail Builders','River Bend Homes','Black Mesa Construction','Turner Falls Homes','Wildflower Homes'];
  subdivisions text[] := array['Prairie Oak Estates','Cedar Ridge','Hidden Creek','Stone Mill','Fox Run','Windsong','Bison Meadows','Copper Creek','Saddle Club','Quail Hollow','Lakeview Pointe','Silver Leaf'];
  homeowners uuid[] := '{}'; home_props uuid[] := '{}';
  firsts text[] := array['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Chris','Karen','Daniel','Lisa','Matthew','Nancy','Anthony','Betty','Mark','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Josh','Michelle','Kevin','Carol','Brian','Amanda','Jason','Melissa','Ryan','Stephanie','Jacob','Rebecca','Gary','Laura','Nick','Heather'];
  lasts text[] := array['Smith','Johnson','Williams','Brown','Jones','Miller','Davis','Garcia','Wilson','Anderson','Taylor','Thomas','Moore','Jackson','Martin','Lee','Thompson','White','Harris','Clark','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Hill','Green','Adams','Baker','Nelson','Carter','Mitchell','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins','Stewart','Morris','Rogers','Cook','Morgan','Bell','Murphy','Bailey','Cooper','Howard','Ward','Cox','Brooks','Gray','James','Bennett','Wood'];
  streets text[] := array['Oak','Cedar','Pecan','Redbud','Meadow','Prairie View','Lakeshore','Willow','Hickory','Sycamore','Elm','Bluff','Timber','Ridge','Briarwood','Cottonwood','Post Oak','Mesquite','Sandstone','Wheatfield','Harvest','Indian Hills','Coffee Creek','Covell','Waterloo','Memorial','Britton','Hefner','Sooner','Douglas'];
  sfx text[] := array['Dr','Ln','Rd','Ct','Ave','St','Way','Cir','Trl','Pl'];
  cities text[] := array['Oklahoma City|73120','Edmond|73013','Edmond|73034','Norman|73072','Moore|73160','Yukon|73099','Mustang|73064','Piedmont|73078','Midwest City|73130','Choctaw|73020','Guthrie|73044','Shawnee|74804','Tulsa|74137','Broken Arrow|74012','Owasso|74055','Bixby|74008','Jenks|74037','Sand Springs|74063','Stillwater|74074','Chickasha|73018'];
  sources text[] := array['Website form','Phone call','Referral','Google','Facebook','Angi / HomeAdvisor','AMBIT referral','Referral','Google'];
  lost_reasons text[] := array['Price','Timing','Went with a competitor','No response','Price','Went with a competitor'];
  shops text[] := array['30x40','40x60','40x60','50x80','30x50','60x100','40x80','24x36'];
  -- per job
  phases text[] := '{}';
  ph text; i int; k int; n int;
  is_builder boolean; cust uuid; prop uuid; cname text;
  mix text; title text; lvl text;
  l_kind text[]; l_prod uuid[]; l_area text[]; l_name text[]; l_detail text[]; l_sqft numeric[]; l_depth numeric[]; l_r numeric[];
  l_units numeric[]; l_unit text[]; l_bf numeric[]; l_cm numeric[]; l_cl numeric[]; l_price numeric[];
  sq numeric; dp numeric; rv numeric; u numeric; pp numeric; w int; h int; perim numeric;
  price numeric; cost numeric; margin numeric;
  d_lead date; d_sent date; d_sign date; d_start date; d_done date; v_days int; sets_oc numeric; sets_cc numeric; sqft_fg numeric;
  v_lead uuid; v_quote uuid; v_opt uuid; v_job uuid; v_trip uuid; v_wo uuid; rig uuid;
  stage text; qstatus text; rep uuid;
  yf numeric; os numeric; sets numeric; dd date; t0 timestamptz; cm uuid; lead_crew uuid; lead_name text;
  shop_idx int;
  counts jsonb;
  hp int := 0;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can load sample data.'; end if;
  select * into c from public.companies where id = co;
  if c.id is null then raise exception 'Workspace not found.'; end if;
  if not c.ops_demo then raise exception 'Sample data only goes into AMBIT demo workspaces, never a real contractor''s.'; end if;
  perform setseed(0.4242);

  -- Start clean (this workspace only).
  delete from public.ops_notes where company_id = co;
  delete from public.ops_work_orders where company_id = co;
  delete from public.ops_jobs where company_id = co;
  delete from public.ops_quotes where company_id = co;
  delete from public.ops_leads where company_id = co;
  delete from public.ops_customers where company_id = co;
  delete from public.ops_stock_moves where company_id = co;
  delete from public.ops_stock where company_id = co;
  delete from public.ops_stock_min where company_id = co;
  delete from public.ops_rig_crew where company_id = co;
  delete from public.ops_crew where company_id = co;
  delete from public.ops_rigs where company_id = co;
  delete from public.ops_packages where company_id = co;
  delete from public.ops_products where company_id = co;
  delete from public.ops_locations where company_id = co;
  delete from public.ops_counters where company_id = co;

  execute 'alter table public.ops_leads disable trigger ops_leads_stamp_ins';
  execute 'alter table public.ops_leads disable trigger ops_leads_stamp_upd';
  execute 'alter table public.ops_quotes disable trigger ops_quotes_stamp';
  execute 'alter table public.ops_jobs disable trigger ops_jobs_stamp';

  -- Company settings (keeps any logo colors already picked).
  update public.companies
     set ops_enabled = true, ops_enabled_at = coalesce(ops_enabled_at, now()),
         ops_form_token = coalesce(ops_form_token, replace(gen_random_uuid()::text, '-', '')),
         ops_settings = coalesce(ops_settings, '{}'::jsonb) || jsonb_build_object(
           'display_name', coalesce(nullif(ops_settings ->> 'display_name', ''), name),
           'phone', '(405) 555-0142', 'email', 'office@example.com', 'website', 'example.com',
           'address', '4100 N Portland Ave, Oklahoma City, OK 73112', 'license_no', 'OK-INS-55821',
           'target_margin', 45, 'builder_margin', 32, 'floor_margin', 25, 'burden_pct', 18, 'deposit_pct', 30,
           'min_job', 1200, 'quote_days', 30, 'share_logs', false,
           'reviewed', jsonb_build_object('products', true, 'labor', true, 'form', true))
   where id = co;

  insert into public.ops_locations (company_id, name, address, phone, sort) values (co, 'Oklahoma City (HQ)', '4100 N Portland Ave, Oklahoma City, OK 73112', '(405) 555-0142', 0) returning id into loc1;
  insert into public.ops_locations (company_id, name, address, phone, sort) values (co, 'Tulsa', '6110 S 129th E Ave, Tulsa, OK 74134', '(918) 555-0177', 1) returning id into loc2;

  insert into public.ops_products (company_id, ambit_skus, kind, name, sku, unit, cost, cost_source, yield_bf, lb_per_set, waste_pct, price, price_unit, labor_key, description, sort)
  values (co, '{ISO,AMB-SEAL-50}', 'foam_oc', 'Open cell foam (AMBI-SEAL 5.0)', 'AMB-SEAL-50', 'set', 2050, 'ambit', 16500, 950, 10, 0.48, 'bf', 'foam_oc', 'Half-pound open cell spray foam. Seals and insulates in one step.', 1) returning id into p_oc;
  insert into public.ops_products (company_id, ambit_skus, kind, name, sku, unit, cost, cost_source, yield_bf, lb_per_set, waste_pct, price, price_unit, labor_key, description, sort)
  values (co, '{ISO,AMB-TITE-20}', 'foam_cc', 'Closed cell foam (AMBI-TITE 204 HFO)', 'AMB-TITE-20', 'set', 2780, 'ambit', 3700, 975, 10, 1.25, 'bf', 'foam_cc', 'Two-pound closed cell spray foam. Air, vapor and water barrier.', 2) returning id into p_cc;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, waste_pct, price, price_unit, labor_key, coverage_key, description, sort)
  values (co, 'blown', 'Blown fiberglass (Jet Stream Ultra)', 'JSU', 'bag', 31, 'ambit', 38, 5, 1.2, 'sqft', 'blown_attic', 'jetstream', 'Loose-fill fiberglass blown to the R-value on the proposal.', 3) returning id into p_blown;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, sqft_per_unit, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'batt', 'R-13 batts, 2x4 walls', 'R13-15', 'bag', 44, 'ambit', 13, 88, 5, 0.85, 'sqft', 'batt_r11_13', 4) returning id into p_r13;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, sqft_per_unit, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'batt', 'R-19 batts, 2x6 walls', 'R19-15', 'bag', 43, 'ambit', 19, 49, 5, 1.25, 'sqft', 'batt_r19', 5) returning id into p_r19;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, sqft_per_unit, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'batt', 'R-30 batts, ceilings', 'R30-24', 'bag', 56, 'ambit', 30, 40, 5, 1.65, 'sqft', 'batt_r30_38', 6) returning id into p_r30;
  insert into public.ops_products (company_id, kind, name, unit, cost, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'air_seal', 'Air sealing (top plates and penetrations)', 'each', 0, 0, 85, 'each', 'air_seal', 7) returning id into p_air;
  insert into public.ops_products (company_id, kind, name, unit, cost, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'removal', 'Old insulation removal', 'each', 0, 0, 1.1, 'sqft', 'removal', 8) returning id into p_rem;

  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Rig 1 · Graco E-30', loc1, '{foam_oc,foam_cc}', '#14b8a6', 2, 2.5, 4000, 1) returning id into rig_oc1;
  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Rig 2 · Reactor H-XP3', loc1, '{foam_cc,foam_oc,foam_roof}', '#f5b53f', 1.5, 3, 4000, 2) returning id into rig_cc;
  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Rig 3 · Tulsa', loc2, '{foam_oc,foam_cc}', '#38bdf8', 2, 2.5, 4000, 3) returning id into rig_oc2;
  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Blow Truck · Krendl', loc1, '{blown,batt,other}', '#a78bfa', 0, 0, 3500, 4) returning id into rig_blow;

  foreach cname in array crew_names loop
    insert into public.ops_crew (company_id, name, phone) values (co, cname, '(405) 555-01' || lpad((10 + coalesce(array_length(crew, 1), 0))::text, 2, '0'))
    returning id into cid;
    crew := crew || cid;
  end loop;
  insert into public.ops_rig_crew (rig_id, crew_id, company_id, lead) values
    (rig_oc1, crew[1], co, true), (rig_oc1, crew[2], co, false), (rig_oc1, crew[3], co, false),
    (rig_cc, crew[4], co, true), (rig_cc, crew[5], co, false),
    (rig_oc2, crew[6], co, true), (rig_oc2, crew[7], co, false), (rig_oc2, crew[8], co, false),
    (rig_blow, crew[9], co, true), (rig_blow, crew[10], co, false);

  -- Builders (repeat customers) and homeowners.
  foreach cname in array builder_names loop
    insert into public.ops_customers (company_id, kind, name, company_name, first_name, last_name, email, phone, source, price_level, created_at, updated_at)
    values (co, 'company', cname, cname, public.ops_demo_pick(firsts), public.ops_demo_pick(lasts),
            'office@' || regexp_replace(lower(cname), '[^a-z]+', '', 'g') || '.example.com',
            '(405) 555-01' || lpad((floor(random() * 90) + 10)::text, 2, '0'), 'Builder', 'builder',
            now() - (400 + floor(random() * 300)) * interval '1 day', now())
    returning id into cid;
    builders := builders || cid;
  end loop;
  for i in 1..200 loop
    declare fn text := public.ops_demo_pick(firsts); ln text := public.ops_demo_pick(lasts); city text := public.ops_demo_pick(cities); pid uuid;
    begin
      insert into public.ops_customers (company_id, kind, name, first_name, last_name, email, phone, source, price_level, created_at, updated_at)
      values (co, 'person', fn || ' ' || ln, fn, ln, lower(fn || '.' || ln || i) || '@example.com',
              '(' || public.ops_demo_pick(array['405','405','918','580']) || ') 555-01' || lpad((floor(random() * 90) + 10)::text, 2, '0'),
              public.ops_demo_pick(sources), 'retail', now() - (floor(random() * 420)) * interval '1 day', now())
      returning id into cid;
      insert into public.ops_properties (company_id, customer_id, label, street, city, state, zip, gate_code)
      values (co, cid, 'Home', (floor(random() * 18000) + 100)::text || ' ' || public.ops_demo_pick(streets) || ' ' || public.ops_demo_pick(sfx),
              split_part(city, '|', 1), 'OK', split_part(city, '|', 2), case when random() < 0.08 then lpad((floor(random() * 9000) + 1000)::text, 4, '0') end)
      returning id into pid;
      homeowners := homeowners || cid;
      home_props := home_props || pid;
    end;
  end loop;

  -- Which step each sample job is at: 150 fully job-costed, 150 spread across the rest of the workflow.
  phases := array_fill('costed'::text, array[150])
         || array_fill('lead_new'::text, array[14]) || array_fill('lead_contacted'::text, array[10]) || array_fill('lead_appt'::text, array[12])
         || array_fill('quote_draft'::text, array[8]) || array_fill('quote_sent'::text, array[18]) || array_fill('quote_followup'::text, array[10])
         || array_fill('lost'::text, array[14]) || array_fill('won'::text, array[14]) || array_fill('scheduled'::text, array[26])
         || array_fill('in_progress'::text, array[6]) || array_fill('done_review'::text, array[18]);

  for i in 1..array_length(phases, 1) loop
    ph := phases[i];
    -- Customer: builders come back again and again; homeowners mostly once (a few twice).
    is_builder := random() < case when ph = 'costed' then 0.45 else 0.35 end;
    if is_builder then
      cust := builders[1 + floor(power(random(), 1.7) * array_length(builders, 1))::int];
      insert into public.ops_properties (company_id, customer_id, label, street, city, state, zip, notes)
      values (co, cust, 'Lot ' || (floor(random() * 60) + 1), (floor(random() * 9000) + 1000)::text || ' ' || public.ops_demo_pick(streets) || ' ' || public.ops_demo_pick(sfx),
              split_part(public.ops_demo_pick(cities), '|', 1), 'OK', null, public.ops_demo_pick(subdivisions))
      returning id into prop;
      lvl := 'builder';
    else
      if hp > 10 and random() < 0.12 then
        k := 1 + floor(random() * hp)::int;
      else
        hp := least(hp + 1, array_length(homeowners, 1));
        k := hp;
      end if;
      cust := homeowners[k];
      prop := home_props[k];
      lvl := 'retail';
    end if;
    select name into cname from public.ops_customers where id = cust;

    -- What the job is.
    mix := case when is_builder then public.ops_demo_pick(array['oc_house','oc_house','oc_house','oc_house','batt_new','batt_new','batt_new','oc_blown','oc_blown','cc_shop'])
                else public.ops_demo_pick(array['oc_attic','oc_attic','oc_attic','oc_attic','oc_attic','blown_attic','blown_attic','blown_attic','blown_attic','blown_attic','cc_crawl','cc_crawl','cc_crawl','cc_shop','cc_shop','cc_shop','cc_shop','oc_house','oc_house','oc_house']) end;
    l_kind := '{}'; l_prod := '{}'; l_area := '{}'; l_name := '{}'; l_detail := '{}'; l_sqft := '{}'; l_depth := '{}'; l_r := '{}';
    l_units := '{}'; l_unit := '{}'; l_bf := '{}'; l_cm := '{}'; l_cl := '{}'; l_price := '{}';

    -- foam line helper (inline): sqft sq, depth dp, product p_oc/p_cc
    if mix in ('oc_house', 'oc_blown') then
      title := case when is_builder then 'New build: ' else 'Whole house: ' end || case when mix = 'oc_house' then 'walls + roofline, open cell' else 'open cell walls + blown attic' end;
      sq := round(public.ops_demo_rnd(1400, 3400)); dp := 3.5;
      l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'EW'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 13.0;
      if mix = 'oc_house' then
        sq := round(public.ops_demo_rnd(1200, 2800)); dp := public.ops_demo_pick(array['5.5','5.5','6'])::numeric;
        l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'RL'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || round(dp * 3.7, 1);
      else
        sq := round(public.ops_demo_rnd(1300, 2600)); rv := 38;
        l_kind := l_kind || 'blown'::text; l_prod := l_prod || p_blown; l_area := l_area || 'CL'::text; l_name := l_name || 'Blown fiberglass'::text; l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
      end if;
    elsif mix = 'oc_attic' then
      title := public.ops_demo_pick(array['Attic encapsulation, open cell','Roofline + gables, open cell','Bonus room and attic, open cell','Attic conversion, open cell']);
      sq := round(public.ops_demo_rnd(900, 2100)); dp := public.ops_demo_pick(array['5.5','6','6.5'])::numeric;
      l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'RL'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || round(dp * 3.7, 1);
      if random() < 0.45 then
        sq := round(public.ops_demo_rnd(180, 520)); dp := 3.5;
        l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'KW'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 13.0;
      end if;
    elsif mix = 'cc_shop' then
      shop_idx := 1 + floor(random() * array_length(shops, 1))::int;
      w := split_part(shops[shop_idx], 'x', 1)::int; h := split_part(shops[shop_idx], 'x', 2)::int;
      title := 'Metal shop ' || shops[shop_idx] || ', closed cell';
      perim := 2 * (w + h) * public.ops_demo_pick(array['12','14','14','16'])::numeric;
      dp := public.ops_demo_pick(array['1.5','2','2'])::numeric;
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'EW'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || round(perim * 0.92); l_depth := l_depth || dp; l_r := l_r || round(dp * 7, 1);
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'RL'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || round(w * h * 1.06); l_depth := l_depth || dp; l_r := l_r || round(dp * 7, 1);
    elsif mix = 'cc_crawl' then
      title := public.ops_demo_pick(array['Crawlspace walls + rim joist, closed cell','Crawlspace encapsulation, closed cell','Rim joist + band, closed cell']);
      sq := round(public.ops_demo_rnd(520, 1300)); dp := 2;
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'EW'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 14.0;
      sq := round(public.ops_demo_rnd(160, 340)); dp := 3;
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'RJ'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 21.0;
    elsif mix = 'blown_attic' then
      rv := public.ops_demo_pick(array['38','49','49','60'])::numeric;
      title := 'Attic top-off to R-' || rv || ', blown';
      sq := round(public.ops_demo_rnd(1200, 3000));
      l_kind := l_kind || 'blown'::text; l_prod := l_prod || p_blown; l_area := l_area || 'CL'::text; l_name := l_name || 'Blown fiberglass'::text; l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
      if random() < 0.35 then
        l_kind := l_kind || 'air_seal'::text; l_prod := l_prod || p_air; l_area := l_area || 'CL'::text; l_name := l_name || 'Air sealing'::text; l_sqft := l_sqft || null::numeric; l_depth := l_depth || null::numeric; l_r := l_r || null::numeric;
      end if;
    else -- batt_new
      title := 'New build: batts + blown attic';
      sq := round(public.ops_demo_rnd(1800, 3800)); rv := public.ops_demo_pick(array['13','13','19'])::numeric;
      l_kind := l_kind || 'batt'::text; l_prod := l_prod || case when rv = 13 then p_r13 else p_r19 end; l_area := l_area || 'EW'::text; l_name := l_name || ('R-' || rv || ' batts'); l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
      sq := round(public.ops_demo_rnd(1300, 2700)); rv := 38;
      l_kind := l_kind || 'blown'::text; l_prod := l_prod || p_blown; l_area := l_area || 'CL'::text; l_name := l_name || 'Blown fiberglass'::text; l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
    end if;

    -- Size, cost and price each line.
    price := 0; cost := 0; sets_oc := 0; sets_cc := 0; sqft_fg := 0;
    for k in 1..array_length(l_kind, 1) loop
      if l_kind[k] = 'foam_oc' then
        l_bf[k] := round(l_sqft[k] * l_depth[k], 1); l_units[k] := round(l_bf[k] / 16500 * 1.1, 3); l_unit[k] := 'set';
        l_cm[k] := round(l_units[k] * 2050, 2); l_cl[k] := round(l_units[k] * 500, 2);
        pp := case when lvl = 'builder' then public.ops_demo_rnd(0.36, 0.44) else public.ops_demo_rnd(0.42, 0.56) end;
        l_price[k] := round(l_bf[k] * pp); sets_oc := sets_oc + l_units[k];
        l_detail[k] := l_depth[k] || '" · ' || to_char(l_bf[k], 'FM999,999') || ' bd ft';
      elsif l_kind[k] = 'foam_cc' then
        l_bf[k] := round(l_sqft[k] * l_depth[k], 1); l_units[k] := round(l_bf[k] / 3700 * 1.1, 3); l_unit[k] := 'set';
        l_cm[k] := round(l_units[k] * 2780, 2); l_cl[k] := round(l_units[k] * 450, 2);
        pp := case when lvl = 'builder' then public.ops_demo_rnd(1.02, 1.18) else public.ops_demo_rnd(1.15, 1.45) end;
        l_price[k] := round(l_bf[k] * pp); sets_cc := sets_cc + l_units[k];
        l_detail[k] := l_depth[k] || '" · ' || to_char(l_bf[k], 'FM999,999') || ' bd ft';
      elsif l_kind[k] = 'blown' then
        l_bf[k] := null; u := ceil(l_sqft[k] / case l_r[k] when 38 then 54 when 49 then 41 when 60 then 33 else 70 end * 1.05); l_units[k] := u; l_unit[k] := 'bag';
        l_cm[k] := round(u * 31, 2); l_cl[k] := round(l_sqft[k] * 0.05, 2);
        pp := case l_r[k] when 38 then public.ops_demo_rnd(1.05, 1.3) when 49 then public.ops_demo_rnd(1.3, 1.55) else public.ops_demo_rnd(1.55, 1.85) end;
        if lvl = 'builder' then pp := pp * 0.88; end if;
        l_price[k] := round(l_sqft[k] * pp); sqft_fg := sqft_fg + l_sqft[k];
        l_detail[k] := 'R-' || l_r[k] || ' · ' || u || ' bags';
      elsif l_kind[k] = 'batt' then
        l_bf[k] := null; u := ceil(l_sqft[k] / case l_r[k] when 13 then 88 when 19 then 49 else 40 end * 1.05); l_units[k] := u; l_unit[k] := 'bag';
        l_cm[k] := round(u * case l_r[k] when 13 then 44 when 19 then 43 else 56 end, 2); l_cl[k] := round(l_sqft[k] * case l_r[k] when 13 then 0.04 else 0.05 end, 2);
        pp := case l_r[k] when 13 then public.ops_demo_rnd(0.78, 0.92) else public.ops_demo_rnd(1.15, 1.32) end;
        l_price[k] := round(l_sqft[k] * pp); sqft_fg := sqft_fg + l_sqft[k];
        l_detail[k] := 'R-' || l_r[k] || ' · ' || u || ' bags';
      else -- air sealing
        l_bf[k] := null; l_units[k] := round(public.ops_demo_rnd(4, 8)); l_unit[k] := 'hr';
        l_cm[k] := round(public.ops_demo_rnd(60, 140), 2); l_cl[k] := round(l_units[k] * 28, 2);
        l_price[k] := round(l_units[k] * 85 + l_cm[k] * 1.5); l_detail[k] := l_units[k] || ' hours';
      end if;
      price := price + l_price[k]; cost := cost + l_cm[k] + l_cl[k];
    end loop;
    if price < 1200 then l_price[1] := l_price[1] + (1200 - price); price := 1200; end if;
    margin := case when price > 0 then round((price - cost) / price * 100, 2) end;

    -- When it happened.
    v_days := greatest(1, ceil(greatest(sets_oc / 2.0, sets_cc / 2.6, sqft_fg / 3500.0))::int);
    rig := case when sets_cc > sets_oc then rig_cc when sets_oc > 0 then case when random() < 0.35 then rig_oc2 else rig_oc1 end else rig_blow end;
    d_done := null; d_start := null; d_sign := null; d_sent := null;
    if ph = 'costed' then
      d_start := today - (5 + floor(power(random(), 0.9) * 360))::int;
      if extract(isodow from d_start) > 5 then d_start := d_start - (extract(isodow from d_start)::int - 5); end if;
      d_done := d_start + (v_days - 1);
      d_sign := d_start - (4 + floor(random() * 26))::int;
      d_sent := d_sign - (1 + floor(random() * 12))::int;
      d_lead := d_sent - (2 + floor(random() * 12))::int;
    elsif ph = 'done_review' then
      d_start := today - (v_days + floor(random() * 9))::int;
      if extract(isodow from d_start) > 5 then d_start := d_start - (extract(isodow from d_start)::int - 5); end if;
      d_done := d_start + (v_days - 1);
      d_sign := d_start - (5 + floor(random() * 20))::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'in_progress' then
      v_days := greatest(v_days, 2); d_start := today - floor(random() * 2)::int;
      d_sign := d_start - (6 + floor(random() * 20))::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'scheduled' then
      d_start := today + case when i % 7 = 0 then 0 else (1 + floor(power(random(), 1.3) * 21))::int end;
      if d_start > today and extract(isodow from d_start) > 5 then d_start := d_start + (8 - extract(isodow from d_start)::int); end if;
      d_sign := today - (2 + floor(random() * 20))::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'won' then
      d_sign := today - floor(random() * 10)::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'quote_followup' then
      d_sent := today - (10 + floor(random() * 16))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'quote_sent' then
      d_sent := today - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'lost' then
      d_sent := today - (12 + floor(random() * 80))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'quote_draft' then
      d_lead := today - (2 + floor(random() * 9))::int;
    else
      d_lead := today - floor(random() * case ph when 'lead_new' then 4 else 14 end)::int;
    end if;

    stage := case ph when 'lead_new' then 'new' when 'lead_contacted' then 'contacted' when 'lead_appt' then 'appointment' when 'quote_draft' then 'appointment'
                     when 'quote_sent' then 'quoted' when 'quote_followup' then 'follow_up' when 'lost' then 'lost' else 'won' end;
    rep := case when me is not null and random() < 0.6 then me end;
    insert into public.ops_leads (company_id, customer_id, property_id, location_id, title, stage, source, services, rep_id, value_est, next_at,
                                  lost_reason, stage_changed_at, won_at, lost_at, created_by, created_at, updated_at)
    values (co, cust, prop, case when rig = rig_oc2 then loc2 else loc1 end, title, stage,
            case when is_builder then 'Builder' else public.ops_demo_pick(sources) end,
            case when mix like 'oc%' or mix like 'cc%' then '{Spray foam insulation}'::text[] when mix = 'blown_attic' then '{Blown-in insulation}'::text[] else '{Batt insulation,Blown-in insulation}'::text[] end,
            rep, round(price, -2),
            case ph when 'lead_new' then case when random() < 0.5 then today end
                    when 'lead_contacted' then today + (floor(random() * 5) - 2)::int
                    when 'lead_appt' then today + floor(random() * 7)::int
                    when 'quote_draft' then today + floor(random() * 3)::int
                    when 'quote_sent' then today + (floor(random() * 7) - 2)::int
                    when 'quote_followup' then today + (floor(random() * 6) - 3)::int end,
            case when ph = 'lost' then public.ops_demo_pick(lost_reasons) end,
            ((coalesce(d_sign, d_sent, d_lead) + time '10:00') at time zone tz),
            case when stage = 'won' then ((d_sign + time '14:00') at time zone tz) end,
            case when ph = 'lost' then ((d_sent + (5 + floor(random() * 20))::int + time '11:00') at time zone tz) end,
            me, ((d_lead + time '09:00' + floor(random() * 480) * interval '1 minute') at time zone tz), now())
    returning id into v_lead;
    if ph <> 'lead_new' then
      insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by, created_by_name, created_at)
      values (co, v_lead, cust, 'call', public.ops_demo_pick(array[
                'Called and set a time to look at it.', 'Talked through options. Wants pricing on foam vs blown.', 'Left a voicemail, texted pictures of a similar job.',
                'Walked the job with the super. Plans in hand.', 'Customer asked about the energy savings. Sent the AMBIT TSB on attic encapsulation.']),
              me, 'Office', ((d_lead + 1 + time '15:00') at time zone tz));
    end if;
    if ph in ('lead_new', 'lead_contacted', 'lead_appt') then continue; end if;

    -- The quote.
    qstatus := case ph when 'quote_draft' then 'draft' when 'quote_sent' then case when random() < 0.5 then 'viewed' else 'sent' end
                       when 'quote_followup' then 'viewed' when 'lost' then case when random() < 0.5 then 'declined' else 'viewed' end else 'signed' end;
    v_quote := gen_random_uuid(); v_opt := gen_random_uuid();
    insert into public.ops_quotes (id, company_id, lead_id, customer_id, property_id, title, status, price_level, target_margin, floor_margin, deposit_pct,
                                   valid_until, public_token, rep_id, created_by, sent_at, viewed_at, view_count, signed_at, signed_name, signed_email,
                                   signed_option_id, signed_total, signed_method, declined_at, decline_reason, totals, created_at, updated_at)
    values (v_quote, co, v_lead, cust, prop, title, qstatus, lvl, case when lvl = 'builder' then 32 else 45 end, 25, 30,
            coalesce(d_sent, today) + 30, replace(gen_random_uuid()::text, '-', ''), rep, me,
            case when qstatus <> 'draft' then ((d_sent + time '16:00') at time zone tz) end,
            case when qstatus in ('viewed', 'signed', 'declined') then ((d_sent + 1 + time '19:30') at time zone tz) end,
            case when qstatus in ('viewed', 'signed', 'declined') then 1 + floor(random() * 5)::int else 0 end,
            case when qstatus = 'signed' then ((d_sign + time '14:00') at time zone tz) end,
            case when qstatus = 'signed' then cname end, null,
            case when qstatus = 'signed' then v_opt end, case when qstatus = 'signed' then price end,
            case when qstatus = 'signed' then case when random() < 0.7 then 'online' else 'office' end end,
            case when qstatus = 'declined' then ((d_sent + 6 + time '12:00') at time zone tz) end,
            case when qstatus = 'declined' then public.ops_demo_pick(array['Price','Going with a cheaper bid','Putting it off until spring']) end,
            jsonb_build_object('options', jsonb_build_object(v_opt::text, jsonb_build_object('price', price, 'cost', round(cost, 2), 'margin', margin, 'min_adj', 0, 'tax', 0, 'total', price, 'deposit', round(price * 0.3, 2))),
                               'addons', '{}'::jsonb, 'below_floor', '[]'::jsonb),
            ((coalesce(d_sent, today) - 1 + time '13:00') at time zone tz),
            ((coalesce(d_sign, d_sent, today) + time '16:00') at time zone tz));
    insert into public.ops_quote_options (id, company_id, quote_id, name, sort) values (v_opt, co, v_quote, 'Recommended', 0);
    for k in 1..array_length(l_kind, 1) loop
      insert into public.ops_quote_lines (company_id, quote_id, option_id, sort, area_code, product_id, kind, name, detail, measure, sqft, depth_in, r_value,
                                          waste_pct, units, unit, bf, cost_material, cost_labor, price, hours)
      values (co, v_quote, v_opt, k, l_area[k], l_prod[k], l_kind[k], l_name[k], l_detail[k], case when l_kind[k] = 'air_seal' then 'hours' else 'sqft' end,
              l_sqft[k], l_depth[k], l_r[k], case when l_kind[k] like 'foam%' then 10 else 5 end, l_units[k], l_unit[k], l_bf[k], l_cm[k], l_cl[k], l_price[k],
              case when l_kind[k] = 'air_seal' then l_units[k] end);
    end loop;
    if qstatus <> 'signed' then continue; end if;

    -- The job, its trip and (once it's out there) the work order.
    perform public.ops_make_job(v_quote);
    select id into v_job from public.ops_jobs where quote_id = v_quote;
    update public.ops_jobs set created_at = ((d_sign + time '14:05') at time zone tz), rep_id = rep,
                              status = case when ph in ('costed', 'done_review') then 'done' else 'open' end,
                              crew_notes = case when random() < 0.3 then public.ops_demo_pick(array['Dogs in the backyard, use the side gate.','Park on the street, new driveway.','Super is Mike, call 30 min out.','Power at the panel in the garage.','Mask off the HVAC before spraying.']) end
     where id = v_job;
    select id into v_trip from public.ops_trips where job_id = v_job;
    if ph = 'won' then continue; end if;
    update public.ops_trips
       set status = case ph when 'scheduled' then 'scheduled' when 'in_progress' then 'in_progress' else 'done' end,
           rig_id = rig, start_date = d_start, days = v_days, start_time = time '07:30',
           scheduled_by_name = 'Office', scheduled_at = ((d_sign + 1 + time '09:00') at time zone tz)
     where id = v_trip;
    insert into public.ops_trip_crew (trip_id, crew_id, company_id, lead)
    select v_trip, rc.crew_id, co, rc.lead from public.ops_rig_crew rc where rc.rig_id = rig;
    if ph = 'scheduled' then continue; end if;

    select rc.crew_id, cr.name into lead_crew, lead_name from public.ops_rig_crew rc join public.ops_crew cr on cr.id = rc.crew_id where rc.rig_id = rig and rc.lead;
    -- How the job really went: yield (how far each set went) and overspray (thicker than sold).
    yf := case when random() < 0.12 then public.ops_demo_rnd(0.76, 0.88) when random() < 0.08 then public.ops_demo_rnd(1.06, 1.12) else public.ops_demo_rnd(0.93, 1.05) end;
    os := case when random() < 0.15 then public.ops_demo_rnd(1.08, 1.18) else public.ops_demo_rnd(1.0, 1.06) end;
    v_wo := gen_random_uuid();
    insert into public.ops_work_orders (id, company_id, trip_id, job_id, status, started_at, finished_at, finished_by_name, sprayer_crew_id, sprayer_name, sprayer_cert,
                                        sprayer_signed_at, customer_name, customer_sig, customer_signed_at, customer_absent, customer_absent_note, share_ambit,
                                        reviewed_by_name, reviewed_at, review_note, created_at, updated_at)
    values (v_wo, co, v_trip, v_job, case ph when 'costed' then 'reviewed' when 'done_review' then 'done' else 'open' end,
            ((d_start + time '07:42') at time zone tz),
            case when ph <> 'in_progress' then ((d_start + v_days - 1 + time '16:10' + floor(random() * 90) * interval '1 minute') at time zone tz) end,
            case when ph <> 'in_progress' then lead_name end, lead_crew, lead_name, 'SPFA PCP ' || (10000 + floor(random() * 89999))::int,
            case when ph <> 'in_progress' then ((d_start + v_days - 1 + time '16:00') at time zone tz) end,
            case when ph <> 'in_progress' and not is_builder then cname end,
            case when ph <> 'in_progress' and not is_builder then sig end,
            case when ph <> 'in_progress' and not is_builder then ((d_start + v_days - 1 + time '16:20') at time zone tz) end,
            ph <> 'in_progress' and is_builder, case when ph <> 'in_progress' and is_builder then 'Builder job: super walked it with the crew lead.' end,
            false,
            case when ph = 'costed' then 'Office' end,
            case when ph = 'costed' then ((d_start + v_days + 1 + time '10:00') at time zone tz) end,
            case when ph = 'costed' and yf < 0.9 then 'Low yield. Check the A/B temps and pressure on this rig.' end,
            ((d_start + time '07:40') at time zone tz), now());
    for k in 0..(case when ph = 'in_progress' then today - d_start else v_days - 1 end) loop
      dd := d_start + k;
      insert into public.ops_wo_days (company_id, wo_id, work_date, conditions, equipment, material, quality, safety, updated_by_name)
      values (co, v_wo, dd,
              jsonb_build_object('sky', public.ops_demo_pick(array['Clear','Clear','Partly cloudy','Overcast','Indoors']), 'wind', public.ops_demo_pick(array['Calm','Light','Light','Moderate']),
                'meter', 'Fluke 62 + Delmhorst J-2000',
                'readings', jsonb_build_object(
                  'start', jsonb_build_object('time', '7:45 AM', 'ambient', round(public.ops_demo_rnd(48, 78)), 'rh', round(public.ops_demo_rnd(35, 70)), 'substrate', round(public.ops_demo_rnd(50, 76)), 'wood_mc', round(public.ops_demo_rnd(9, 15))),
                  'mid', jsonb_build_object('time', '12:15 PM', 'ambient', round(public.ops_demo_rnd(62, 92)), 'rh', round(public.ops_demo_rnd(28, 60)), 'substrate', round(public.ops_demo_rnd(60, 90)), 'wood_mc', round(public.ops_demo_rnd(9, 14))),
                  'end', jsonb_build_object('time', '3:45 PM', 'ambient', round(public.ops_demo_rnd(58, 88)), 'rh', round(public.ops_demo_rnd(30, 62)), 'substrate', round(public.ops_demo_rnd(58, 86)), 'wood_mc', round(public.ops_demo_rnd(9, 14))))),
              jsonb_build_object('proportioner', case when rig = rig_cc then 'Graco Reactor H-XP3' else 'Graco Reactor E-30' end, 'gun', 'Graco Fusion AP'),
              '{}'::jsonb,
              case when sets_oc + sets_cc > 0 then jsonb_build_object('cup_mass_g', round(public.ops_demo_rnd(case when sets_cc > sets_oc then 15 else 4 end, case when sets_cc > sets_oc then 17 else 5 end), 1), 'cup_ml', 500) else '{}'::jsonb end,
              '{}'::jsonb, lead_name);
      foreach cid in array (select array_agg(tc.crew_id) from public.ops_trip_crew tc where tc.trip_id = v_trip) loop
        t0 := ((dd + time '06:50' + floor(random() * 25) * interval '1 minute') at time zone tz);
        insert into public.ops_wo_time (id, company_id, wo_id, crew_id, kind, started_at, ended_at, by_name)
        values (gen_random_uuid(), co, v_wo, cid, 'drive', t0, t0 + (30 + floor(random() * 40)) * interval '1 minute', lead_name);
        t0 := ((dd + time '07:45' + floor(random() * 10) * interval '1 minute') at time zone tz);
        insert into public.ops_wo_time (id, company_id, wo_id, crew_id, kind, started_at, ended_at, by_name)
        values (gen_random_uuid(), co, v_wo, cid, 'site', t0,
                case when ph = 'in_progress' and dd = today then null else t0 + (390 + floor(random() * 180)) * interval '1 minute' end, lead_name);
      end loop;
    end loop;
    -- Material used and what was sprayed or blown, line by line.
    for k in 1..array_length(l_kind, 1) loop
      if ph = 'in_progress' and k > 1 then exit; end if;
      if l_kind[k] like 'foam%' then
        sq := round(l_sqft[k] * public.ops_demo_rnd(0.98, 1.03), 1);
        dp := round(l_depth[k] * os * case when ph = 'in_progress' then 0.5 else 1 end, 2);
        sets := round(sq * dp / (case when l_kind[k] = 'foam_oc' then 16500 else 3700 end * yf), 2);
        insert into public.ops_wo_materials (id, company_id, wo_id, work_date, ops_product_id, kind, name, unit, qty, a_maker, a_lot, b_key, b_lot, by_name)
        values (gen_random_uuid(), co, v_wo, d_start, l_prod[k], l_kind[k], l_name[k], 'set', sets,
                public.ops_demo_pick(array['Covestro','Covestro','Wanhua','Huntsman']),
                public.ops_demo_pick(array['PA86002836','PA86002841','PA86002845','PA86009001','2605P0437','2605P0499','GEO17020']),
                case when l_kind[k] = 'foam_oc' then 'AMB-SEAL-50' else 'AMB-TITE-20' end,
                case when l_kind[k] = 'foam_oc' then public.ops_demo_pick(array['L7989','L8000','L8007','WS2610A']) else public.ops_demo_pick(array['LW8017','LW8019','LW8020','L7976']) end,
                lead_name);
        insert into public.ops_wo_areas (id, company_id, wo_id, work_date, job_line_id, area_code, name, substrate, ops_product_id, kind, sqft, thick_in, passes, sort)
        select gen_random_uuid(), co, v_wo, d_start, jl.id, l_area[k], l_name[k], public.ops_demo_pick(array['Wood framing','OSB roof deck','Metal panel','Concrete block']),
               l_prod[k], l_kind[k], sq, dp, case when l_kind[k] = 'foam_cc' then ceil(dp / 1.5)::int else 1 end, k
          from public.ops_job_lines jl where jl.job_id = v_job and jl.sort = k limit 1;
      elsif l_kind[k] in ('blown', 'batt') then
        u := ceil(l_units[k] * public.ops_demo_rnd(0.96, 1.09) * case when ph = 'in_progress' then 0.5 else 1 end);
        insert into public.ops_wo_materials (id, company_id, wo_id, work_date, ops_product_id, kind, name, unit, qty, lot, by_name)
        values (gen_random_uuid(), co, v_wo, d_start, l_prod[k], l_kind[k], l_name[k], 'bag', u, 'FG' || (240000 + floor(random() * 9999))::int, lead_name);
        insert into public.ops_wo_areas (id, company_id, wo_id, work_date, job_line_id, area_code, name, substrate, ops_product_id, kind, sqft, thick_in, sort)
        select gen_random_uuid(), co, v_wo, d_start, jl.id, l_area[k], l_name[k], 'Attic floor', l_prod[k], l_kind[k], round(l_sqft[k] * public.ops_demo_rnd(0.98, 1.02), 1), null, k
          from public.ops_job_lines jl where jl.job_id = v_job and jl.sort = k limit 1;
      end if;
    end loop;
  end loop;

  -- Leads that didn't buy over the year (so the win rate looks like real life).
  for i in 1..160 loop
    k := 1 + floor(random() * array_length(homeowners, 1))::int;
    d_lead := today - (14 + floor(random() * 350))::int;
    insert into public.ops_leads (company_id, customer_id, property_id, location_id, title, stage, source, services, value_est, lost_reason,
                                  stage_changed_at, lost_at, created_by, created_at, updated_at)
    values (co, homeowners[k], home_props[k], loc1,
            public.ops_demo_pick(array['Attic encapsulation, open cell','Attic top-off to R-49, blown','Metal shop 40x60, closed cell','Crawlspace encapsulation, closed cell','Whole house: walls + roofline, open cell']),
            'lost', public.ops_demo_pick(sources), '{Spray foam insulation}'::text[], round(public.ops_demo_rnd(2500, 16000), -2), public.ops_demo_pick(lost_reasons),
            ((d_lead + 9 + time '11:00') at time zone tz), ((d_lead + 9 + time '11:00') at time zone tz), me, ((d_lead + time '10:00') at time zone tz), now());
  end loop;

  -- Tasks for whoever loaded the demo (the follow-ups on their Home screen).
  if me is not null then
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, due_on, assigned_to, created_by, created_by_name, created_at)
    select co, l.id, l.customer_id, 'task',
           public.ops_demo_pick(array['Call back about the quote','Send the foam vs blown comparison','Confirm the walk-through time','Follow up: proposal viewed twice, not signed','Get the plans from the builder','Text photos of a similar job']),
           today + (floor(random() * 8) - 3)::int, me, me, 'Office', now() - interval '2 days'
      from (select x.id, x.customer_id from public.ops_leads x
             where x.company_id = co and x.stage in ('contacted', 'appointment', 'quoted', 'follow_up')
             order by x.number nulls last, x.id limit 40) l
     where random() < 0.32;
  end if;

  -- Chemical and fiberglass on the shelf and on the rigs.
  insert into public.ops_stock (company_id, place_kind, place_id, item_key, name, unit, maker, lot_no, qty) values
    (co, 'location', loc1, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86009001', 6),
    (co, 'location', loc1, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Wanhua', '2605P0499', 2),
    (co, 'location', loc1, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'L8007', 5),
    (co, 'location', loc1, 'AMB-TITE-20', 'AMBI-TITE 204 HFO Resin (B-Side), 475 lb drum', 'drum', '', 'LW8020', 2),
    (co, 'location', loc1, 'JSU', 'Jet Stream Ultra blowing wool', 'bag', '', 'FG244118', 140),
    (co, 'location', loc2, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86009002', 2),
    (co, 'location', loc2, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'WS2610A', 1),
    (co, 'rig', rig_oc1, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86002845', 1.5),
    (co, 'rig', rig_oc1, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'L8000', 1.5),
    (co, 'rig', rig_cc, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Wanhua', '2605P0437', 1),
    (co, 'rig', rig_cc, 'AMB-TITE-20', 'AMBI-TITE 204 HFO Resin (B-Side), 475 lb drum', 'drum', '', 'LW8019', 0.5),
    (co, 'rig', rig_oc2, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86009002', 1),
    (co, 'rig', rig_oc2, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'WS2610A', 1),
    (co, 'rig', rig_blow, 'JSU', 'Jet Stream Ultra blowing wool', 'bag', '', 'FG244118', 60);
  insert into public.ops_stock_min (company_id, item_key, name, unit, min_qty) values
    (co, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 8),
    (co, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', 4),
    (co, 'AMB-TITE-20', 'AMBI-TITE 204 HFO Resin (B-Side), 475 lb drum', 'drum', 4),
    (co, 'JSU', 'Jet Stream Ultra blowing wool', 'bag', 120);

  -- Numbers in the order things happened.
  update public.ops_leads l set number = 1000 + r.n from (select id, row_number() over (order by created_at, id) n from public.ops_leads where company_id = co) r where l.id = r.id;
  update public.ops_quotes q set number = 1000 + r.n from (select id, row_number() over (order by created_at, id) n from public.ops_quotes where company_id = co) r where q.id = r.id;
  update public.ops_jobs j set number = 1000 + r.n from (select id, row_number() over (order by created_at, id) n from public.ops_jobs where company_id = co) r where j.id = r.id;
  insert into public.ops_counters (company_id, kind, n)
  select co, v.kk, coalesce(v.mm, 1000) from (values
    ('lead', (select max(number) from public.ops_leads where company_id = co)),
    ('quote', (select max(number) from public.ops_quotes where company_id = co)),
    ('job', (select max(number) from public.ops_jobs where company_id = co))) v(kk, mm)
  on conflict (company_id, kind) do update set n = excluded.n;

  execute 'alter table public.ops_leads enable trigger ops_leads_stamp_ins';
  execute 'alter table public.ops_leads enable trigger ops_leads_stamp_upd';
  execute 'alter table public.ops_quotes enable trigger ops_quotes_stamp';
  execute 'alter table public.ops_jobs enable trigger ops_jobs_stamp';

  select jsonb_build_object(
    'customers', (select count(*) from public.ops_customers where company_id = co),
    'leads', (select count(*) from public.ops_leads where company_id = co),
    'quotes', (select count(*) from public.ops_quotes where company_id = co),
    'jobs', (select count(*) from public.ops_jobs where company_id = co),
    'costed', (select count(*) from public.ops_work_orders where company_id = co and status = 'reviewed'),
    'to_review', (select count(*) from public.ops_work_orders where company_id = co and status = 'done'),
    'scheduled', (select count(*) from public.ops_trips where company_id = co and status = 'scheduled')) into counts;
  return counts;
end $$;
revoke all on function public.admin_ops_demo_fill(uuid, uuid) from public, anon;
grant execute on function public.admin_ops_demo_fill(uuid, uuid) to authenticated;

-- ---------- Delete an AMBIT demo workspace (and everything in it) ----------
create or replace function public.admin_ops_demo_delete(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can delete a demo.'; end if;
  select * into c from public.companies where id = p_company;
  if c.id is null then return; end if;
  if not c.ops_demo then raise exception 'Only AMBIT demo workspaces can be deleted here.'; end if;
  if exists (select 1 from public.orders where company_id = c.id) or exists (select 1 from public.profiles where company_id = c.id) then
    raise exception 'This company has real orders or logins, so it can''t be deleted as a demo.';
  end if;
  update public.profiles set ops_workspace = null where ops_workspace = c.id;
  delete from public.companies where id = c.id;
end $$;
revoke all on function public.admin_ops_demo_delete(uuid) from public, anon;
grant execute on function public.admin_ops_demo_delete(uuid) to authenticated;

-- ---------- Home screen numbers (one trip to the database) ----------
-- Everything the Home widgets show for the workspace: sales, profit on finished jobs, backlog, pipeline,
-- yield against target, today's crews, chemical on hand against the schedule, and what needs a look.
create or replace function public.ops_kpis() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  co      uuid := public.ops_company();
  today   date := (now() at time zone 'America/Chicago')::date;
  m0      date := date_trunc('month', today)::date;
  st      jsonb;
  lab_oc  numeric;
  lab_cc  numeric;
  out     jsonb;
begin
  if co is null or not public.ops_is('owner', 'office', 'dispatcher', 'accounting', 'sales') then return null; end if;
  select ops_settings into st from public.companies where id = co;
  select coalesce(max((x ->> 'rate')::numeric) filter (where x ->> 'key' = 'foam_oc'), 500),
         coalesce(max((x ->> 'rate')::numeric) filter (where x ->> 'key' = 'foam_cc'), 450)
    into lab_oc, lab_cc
    from jsonb_array_elements(case when jsonb_typeof(st -> 'labor') = 'array' then st -> 'labor' else '[]'::jsonb end) x;

  with
  wo as (  -- finished work orders: when, what it sold for, what it really cost
    select w.id, w.job_id, w.trip_id, w.status, t.rig_id,
           coalesce((w.finished_at at time zone 'America/Chicago')::date, t.end_date) as done_on,
           j.sold_total, j.customer_id
      from public.ops_work_orders w
      join public.ops_trips t on t.id = w.trip_id
      join public.ops_jobs j on j.id = w.job_id
     where w.company_id = co and w.status in ('done', 'reviewed')
  ),
  mat as (
    select m.wo_id, m.kind, sum(m.qty) qty, sum(m.qty * coalesce(p.cost, 0)) cost
      from public.ops_wo_materials m left join public.ops_products p on p.id = m.ops_product_id
     where m.company_id = co and not m.deleted group by 1, 2
  ),
  area as (
    select a.wo_id, a.kind, sum(a.bf) bf from public.ops_wo_areas a where a.company_id = co and not a.deleted group by 1, 2
  ),
  sold as (  -- what each job sold, by line kind (board feet and quoted labor)
    select jl.job_id, jl.kind, sum(coalesce(jl.bf, 0)) bf, sum(coalesce(ql.cost_labor, 0)) labor
      from public.ops_job_lines jl left join public.ops_quote_lines ql on ql.id = jl.quote_line_id
     where jl.company_id = co group by 1, 2
  ),
  jobcost as (
    select wo.id, wo.job_id, wo.done_on, wo.rig_id, wo.customer_id, coalesce(wo.sold_total, 0) revenue,
           coalesce((select sum(cost) from mat where mat.wo_id = wo.id), 0)
           + coalesce((select sum(case mat.kind when 'foam_oc' then mat.qty * lab_oc when 'foam_cc' then mat.qty * lab_cc else 0 end) from mat where mat.wo_id = wo.id), 0)
           + coalesce((select sum(labor) from sold where sold.job_id = wo.job_id and sold.kind not like 'foam%'), 0) as cost
      from wo
  ),
  months as (
    select generate_series(m0 - interval '11 months', m0, interval '1 month')::date as m
  ),
  yield as (
    select mat.kind, wo.rig_id, sum(area.bf) bf, sum(mat.qty) sets, sum(mat.cost) cost
      from mat join wo on wo.id = mat.wo_id
      join area on area.wo_id = mat.wo_id and area.kind = mat.kind
     where mat.kind like 'foam%' and wo.done_on >= today - 90
     group by grouping sets ((mat.kind), (mat.kind, wo.rig_id))
  ),
  target as (
    select kind, max(yield_bf) y, max(cost) c from public.ops_products where company_id = co and kind like 'foam%' and active group by 1
  ),
  waste as (  -- sets used beyond what the sold board feet needed at the target yield (last 90 days)
    select coalesce(sum(greatest(mat.qty - s.bf / nullif(tg.y, 0), 0) * tg.c), 0) dollars,
           coalesce(sum(greatest(mat.qty - s.bf / nullif(tg.y, 0), 0)), 0) sets
      from mat join wo on wo.id = mat.wo_id
      join sold s on s.job_id = wo.job_id and s.kind = mat.kind
      join target tg on tg.kind = mat.kind
     where mat.kind like 'foam%' and wo.done_on >= today - 90
  ),
  leads as (
    select l.* from public.ops_leads l where l.company_id = co
  ),
  trips as (
    select t.*, j.number job_no, j.title, j.sold_total, c.name customer, pr.city, r.name rig, r.color rig_color,
           exists (select 1 from public.ops_work_orders w where w.trip_id = t.id and w.status = 'open') wo_open
      from public.ops_trips t
      join public.ops_jobs j on j.id = t.job_id
      join public.ops_customers c on c.id = j.customer_id
      left join public.ops_properties pr on pr.id = j.property_id
      left join public.ops_rigs r on r.id = t.rig_id
     where t.company_id = co and t.status in ('scheduled', 'in_progress') and t.start_date is not null
  ),
  need as (  -- sets the next 14 days of trips will use
    select jl.kind, sum(coalesce(jl.units, 0)) sets
      from public.ops_job_lines jl join trips t on t.id = jl.trip_id
     where t.start_date <= today + 14 and jl.kind like 'foam%' group by 1
  ),
  onhand as (
    select item_key, sum(qty) qty from public.ops_stock where company_id = co group by 1
  )
  select jsonb_build_object(
    'today', today,
    'sold', jsonb_build_object(
      'month', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed' and (q.signed_at at time zone 'America/Chicago')::date >= m0), 0),
      'prev', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed'
                         and (q.signed_at at time zone 'America/Chicago')::date >= (m0 - interval '1 month')::date
                         and (q.signed_at at time zone 'America/Chicago')::date < (m0 - interval '1 month')::date + (today - m0) + 1), 0),
      'prev_full', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed'
                         and (q.signed_at at time zone 'America/Chicago')::date >= (m0 - interval '1 month')::date and (q.signed_at at time zone 'America/Chicago')::date < m0), 0),
      'jobs', (select count(*) from public.ops_quotes q where q.company_id = co and q.status = 'signed' and (q.signed_at at time zone 'America/Chicago')::date >= m0)),
    'months', (select jsonb_agg(jsonb_build_object(
                 'm', to_char(months.m, 'YYYY-MM'),
                 'revenue', coalesce((select sum(revenue) from jobcost where date_trunc('month', done_on) = months.m), 0),
                 'cost', coalesce((select sum(cost) from jobcost where date_trunc('month', done_on) = months.m), 0),
                 'jobs', (select count(*) from jobcost where date_trunc('month', done_on) = months.m),
                 'sold', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed'
                                    and date_trunc('month', q.signed_at at time zone 'America/Chicago') = months.m), 0)) order by months.m) from months),
    'backlog', jsonb_build_object(
      'value', coalesce((select sum(j.sold_total) from public.ops_jobs j where j.company_id = co and j.status = 'open'), 0),
      'jobs', (select count(*) from public.ops_jobs j where j.company_id = co and j.status = 'open'),
      'unscheduled', (select count(*) from public.ops_trips t join public.ops_jobs j on j.id = t.job_id where t.company_id = co and t.status = 'unscheduled' and j.status = 'open'),
      'weekly', coalesce((select sum(revenue) from jobcost where done_on > today - 84), 0) / 12.0),
    'pipeline', jsonb_build_object(
      'stages', (select coalesce(jsonb_agg(jsonb_build_object('key', stage, 'count', n, 'value', v)), '[]'::jsonb) from (
                   select stage, count(*) n, coalesce(sum(value_est), 0) v from leads where stage not in ('won', 'lost') group by stage) s),
      'won90', (select count(*) from leads where stage = 'won' and stage_changed_at > now() - interval '90 days'),
      'lost90', (select count(*) from leads where stage = 'lost' and stage_changed_at > now() - interval '90 days'),
      'quotes_out', coalesce((select sum((select max((o.value ->> 'total')::numeric) from jsonb_each(q.totals -> 'options') o)) from public.ops_quotes q where q.company_id = co and q.status in ('sent', 'viewed')), 0),
      'quotes_out_n', (select count(*) from public.ops_quotes q where q.company_id = co and q.status in ('sent', 'viewed')),
      'due', (select count(*) from leads where stage not in ('won', 'lost') and next_at <= today),
      'new7', (select count(*) from leads where created_at > now() - interval '7 days')),
    'yield', jsonb_build_object(
      'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', y.kind, 'bf', y.bf, 'sets', y.sets, 'actual', round(y.bf / nullif(y.sets, 0)), 'target', tg.y) order by y.kind), '[]'::jsonb)
                  from yield y left join target tg on tg.kind = y.kind where y.rig_id is null),
      'rigs', (select coalesce(jsonb_agg(jsonb_build_object('rig', r.name, 'color', r.color, 'kind', y.kind, 'actual', round(y.bf / nullif(y.sets, 0)), 'target', tg.y, 'sets', y.sets) order by r.sort, y.kind), '[]'::jsonb)
                 from yield y join public.ops_rigs r on r.id = y.rig_id left join target tg on tg.kind = y.kind),
      'waste_dollars', (select round(dollars) from waste), 'waste_sets', (select round(sets, 1) from waste)),
    'today_trips', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'job_id', job_id, 'job_no', job_no, 'title', title, 'customer', customer, 'city', city, 'rig', rig, 'color', rig_color,
                                                          'status', status, 'start', start_date, 'end', end_date, 'day', today - start_date + 1, 'days', days, 'wo_open', wo_open) order by rig, start_date), '[]'::jsonb)
                      from trips where today between start_date and end_date),
    'week', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', (select count(*) from trips where d between start_date and end_date))
                                         order by d), '[]'::jsonb) from generate_series(today, today + 13, interval '1 day') g(d)),
    'rigs', (select count(*) from public.ops_rigs where company_id = co and active),
    'work_orders', jsonb_build_object(
      'review', (select count(*) from public.ops_work_orders where company_id = co and status = 'done'),
      'open', (select count(*) from public.ops_work_orders where company_id = co and status = 'open')),
    'chem', jsonb_build_object(
      'oc_need', coalesce((select sets from need where kind = 'foam_oc'), 0),
      'cc_need', coalesce((select sets from need where kind = 'foam_cc'), 0),
      'iso', coalesce((select qty from onhand where item_key = 'ISO'), 0),
      'oc', coalesce((select sum(qty) from onhand where item_key like 'AMB-SEAL%'), 0),
      'cc', coalesce((select sum(qty) from onhand where item_key like 'AMB-TITE%'), 0)),
    'attention', jsonb_build_object(
      'low_yield', (select coalesce(jsonb_agg(x order by x ->> 'pct'), '[]'::jsonb) from (
                     select jsonb_build_object('job_id', wo.job_id, 'job_no', j.number, 'customer', c.name, 'kind', mat.kind,
                                               'pct', round(area.bf / nullif(mat.qty, 0) / nullif(tg.y, 0) * 100), 'done_on', wo.done_on) x
                       from wo join mat on mat.wo_id = wo.id and mat.kind like 'foam%'
                       join area on area.wo_id = wo.id and area.kind = mat.kind
                       join target tg on tg.kind = mat.kind
                       join public.ops_jobs j on j.id = wo.job_id join public.ops_customers c on c.id = j.customer_id
                      where wo.done_on >= today - 45 and area.bf / nullif(mat.qty, 0) < tg.y * 0.9
                      order by area.bf / nullif(mat.qty, 0) / nullif(tg.y, 0) limit 5) s),
      'hot_quotes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                     select jsonb_build_object('id', q.id, 'number', q.number, 'customer', c.name, 'views', q.view_count,
                                               'total', (select max((o.value ->> 'total')::numeric) from jsonb_each(q.totals -> 'options') o)) x
                       from public.ops_quotes q join public.ops_customers c on c.id = q.customer_id
                      where q.company_id = co and q.status = 'viewed' order by q.view_count desc, q.viewed_at desc limit 5) s)),
    'customers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                   select jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'jobs', count(*), 'revenue', sum(j.sold_total)) x
                     from public.ops_jobs j join public.ops_customers c on c.id = j.customer_id
                    where j.company_id = co and j.created_at > now() - interval '12 months' and j.status <> 'cancelled'
                    group by c.id, c.name, c.kind order by sum(j.sold_total) desc limit 6) s)
  ) into out;
  return out;
end $$;
revoke all on function public.ops_kpis() from public, anon;
grant execute on function public.ops_kpis() to authenticated;

select 'demo data and logo colors ready' as status;

-- 0049 AMBIT Intelligence in AMBIT-OPS (the pulsing atom button).
--
-- Everyone working in an AMBIT-OPS workspace can use AMBIT Intelligence there: their own business data
-- (through their own login and the existing walls) plus AMBIT's approved product knowledge. It counts
-- toward the same daily question limit and cost tracking as Ask AMBIT (Admin -> Ask AMBIT sets the
-- contractor limit). The Ask AMBIT screen itself stays staff-only until "Open to contractors" is on.
--
-- Run once in Supabase -> SQL Editor. Safe to run again.

create or replace function public.ai_can_use() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.status = 'active'
       and (p.role in ('employee', 'admin')
            or (select open_to_customers from public.ai_settings)
            or public.ops_company() is not null)
      from public.profiles p where p.id = auth.uid()), false)
$$;

revoke execute on function public.ai_can_use() from public, anon;
grant execute on function public.ai_can_use() to authenticated;
-- =====================================================================
-- AMBIT Intelligence update 0050 - Expense reports, version 2
-- * Receipts live in the app (photo + AI read), each one can be tied to a customer.
-- * Chase card charges come in (statement upload now, "Connect Chase" automatically later) and every
--   charge is checked against the receipts. Each month goes to the expense approvers once every charge
--   has a receipt (or a reason), and an approver approves it or sends it back.
-- * An approvers-only expense dashboard.
-- * Admin > Expense reports picks the approvers. The first time: Jeremiah Bryant, Kim Hight, Kevin Lall.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Who approves expense reports ------------------------------
alter table public.profiles add column if not exists expense_approver boolean not null default false;

do $$ begin
  if not exists (select 1 from public.profiles where expense_approver) then
    update public.profiles set expense_approver = true
     where status = 'active' and role in ('admin', 'employee')
       and lower(email) in ('jeremiah.bryant@ambitpu.com', 'kim.hight@ambitpu.com', 'kevin.lall@ambitpu.com');
  end if;
end $$;

create or replace function public.is_expense_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and expense_approver and role in ('admin', 'employee'))
$$;
revoke all on function public.is_expense_approver() from public, anon;
grant execute on function public.is_expense_approver() to authenticated;

-- Admins: the whole list at once (everyone else comes off it).
create or replace function public.set_expense_approvers(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can change who approves expense reports.'; end if;
  update public.profiles set expense_approver = (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'))
   where expense_approver is distinct from (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'));
  select count(*) into n from public.profiles where expense_approver and status = 'active';
  if n = 0 then raise exception 'Pick at least one approver, or nobody can approve expense reports.'; end if;
  return n;
end $$;
revoke all on function public.set_expense_approvers(uuid[]) from public, anon;
grant execute on function public.set_expense_approvers(uuid[]) to authenticated;

-- ---------- Receipts ---------------------------------------------------
create table if not exists public.expense_receipts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  bought_on        date not null,
  vendor           text not null default '',
  amount           numeric(12,2) not null check (amount >= 0),     -- what was paid, tip included
  tip              numeric(12,2) check (tip is null or tip >= 0),
  category         text not null default 'Other',
  paid_with        text not null default 'card' check (paid_with in ('card', 'personal')),
  card_last4       text check (card_last4 is null or card_last4 ~ '^\d{4}$'),
  company_id       uuid references public.companies(id) on delete set null,   -- the customer it was for
  customer_name    text,                                                      -- typed, or that customer's name
  purpose          text,
  attendees        text,                                                      -- meals and entertainment
  notes            text,
  photos           text[] not null default '{}',   -- paths in the "receipts" bucket, or Jotform photo links
  no_photo_reason  text,                           -- lost receipt: why there's no photo
  ai               jsonb,                          -- what the AI read off the photo
  source           text not null default 'app' check (source in ('app', 'jotform')),
  jotform_id       text unique,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists expense_receipts_user_day on public.expense_receipts(user_id, bought_on);
create index if not exists expense_receipts_company on public.expense_receipts(company_id) where company_id is not null;

-- ---------- Company cards (last 4 -> employee) -------------------------
create table if not exists public.expense_cards (
  last4            text primary key check (last4 ~ '^\d{4}$'),
  user_id          uuid references public.profiles(id) on delete set null,
  label            text,
  plaid_account_id text unique,
  updated_at       timestamptz not null default now()
);

-- ---------- Statement uploads and syncs (the history list) ------------
create table if not exists public.expense_imports (
  id         uuid primary key default gen_random_uuid(),
  source     text not null check (source in ('upload', 'plaid')),
  file_name  text,
  rows       int not null default 0,
  added      int not null default 0,
  skipped    int not null default 0,
  date_from  date,
  date_to    date,
  by_id      uuid references public.profiles(id) on delete set null,
  by_name    text,
  at         timestamptz not null default now()
);

-- ---------- Card charges (from the Chase statement or the bank link) ---
create table if not exists public.expense_charges (
  id             uuid primary key default gen_random_uuid(),
  source         text not null check (source in ('upload', 'plaid')),
  external_id    text not null unique,      -- upload: a fingerprint of the line; plaid: 'plaid:<id>'
  plaid_id       text unique,               -- also set when an uploaded line is later seen through the bank link
  card_last4     text,
  user_id        uuid references public.profiles(id) on delete set null,
  txn_date       date not null,
  post_date      date,
  description    text not null default '',
  merchant       text,
  bank_category  text,
  kind           text not null default 'purchase' check (kind in ('purchase', 'return', 'fee', 'payment', 'other')),
  amount         numeric(12,2) not null,    -- positive = money spent, negative = a return or credit
  receipt_id     uuid unique references public.expense_receipts(id) on delete set null,
  match_how      text check (match_how in ('auto', 'manual')),
  excused_note   text,                      -- an approver said no receipt is needed
  excused_by     uuid references public.profiles(id) on delete set null,
  category       text,                      -- for excused charges (no receipt to say)
  removed        boolean not null default false,
  import_id      uuid references public.expense_imports(id) on delete set null,   -- which upload it came in
  imported_by    uuid references public.profiles(id) on delete set null,
  imported_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists expense_charges_user_day on public.expense_charges(user_id, txn_date);
create index if not exists expense_charges_open on public.expense_charges(txn_date) where receipt_id is null and not removed;
alter table public.expense_charges add column if not exists import_id uuid references public.expense_imports(id) on delete set null;

-- ---------- The bank link (server only: no one can read the tokens) --
create table if not exists public.expense_bank_links (
  id            uuid primary key default gen_random_uuid(),
  item_id       text not null unique,
  access_token  text not null,
  institution   text,
  cursor        text,
  status        text not null default 'ok',     -- ok | error | needs_login
  error         text,
  last_sync_at  timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------- Monthly reports: approval -----------------------------------
alter table public.expense_reports add column if not exists status           text not null default 'sent';
alter table public.expense_reports add column if not exists submitted_at     timestamptz;
alter table public.expense_reports add column if not exists auto_submitted   boolean not null default false;
alter table public.expense_reports add column if not exists charge_count     int not null default 0;
alter table public.expense_reports add column if not exists approved_by      uuid references public.profiles(id) on delete set null;
alter table public.expense_reports add column if not exists approved_by_name text;
alter table public.expense_reports add column if not exists approved_at      timestamptz;
alter table public.expense_reports add column if not exists returned_at      timestamptz;
alter table public.expense_reports add column if not exists review_note      text;
do $$ begin
  alter table public.expense_reports add constraint expense_reports_status_check check (status in ('sent', 'submitted', 'approved', 'returned'));
exception when duplicate_object then null; end $$;

-- ---------- Security rules ---------------------------------------------
alter table public.expense_receipts   enable row level security;
alter table public.expense_cards      enable row level security;
alter table public.expense_charges    enable row level security;
alter table public.expense_imports    enable row level security;
alter table public.expense_bank_links enable row level security;   -- no rules: only the server's own key

drop policy if exists expense_receipts_read   on public.expense_receipts;
drop policy if exists expense_receipts_insert on public.expense_receipts;
drop policy if exists expense_receipts_update on public.expense_receipts;
create policy expense_receipts_read on public.expense_receipts for select to authenticated
  using (user_id = auth.uid() or public.is_expense_approver());
create policy expense_receipts_insert on public.expense_receipts for insert to authenticated
  with check ((user_id = auth.uid() and public.is_employee()) or public.is_expense_approver());
create policy expense_receipts_update on public.expense_receipts for update to authenticated
  using ((user_id = auth.uid() and public.is_employee()) or public.is_expense_approver())
  with check ((user_id = auth.uid() and public.is_employee()) or public.is_expense_approver());

drop policy if exists expense_cards_read  on public.expense_cards;
drop policy if exists expense_cards_write on public.expense_cards;
create policy expense_cards_read on public.expense_cards for select to authenticated
  using (user_id = auth.uid() or public.is_expense_approver());
create policy expense_cards_write on public.expense_cards for all to authenticated
  using (public.is_expense_approver()) with check (public.is_expense_approver());

drop policy if exists expense_charges_read  on public.expense_charges;
drop policy if exists expense_charges_write on public.expense_charges;
create policy expense_charges_read on public.expense_charges for select to authenticated
  using (user_id = auth.uid() or public.is_expense_approver());
create policy expense_charges_write on public.expense_charges for all to authenticated
  using (public.is_expense_approver()) with check (public.is_expense_approver());

drop policy if exists expense_imports_read  on public.expense_imports;
drop policy if exists expense_imports_write on public.expense_imports;
create policy expense_imports_read on public.expense_imports for select to authenticated using (public.is_expense_approver());
create policy expense_imports_write on public.expense_imports for all to authenticated using (public.is_expense_approver()) with check (public.is_expense_approver());

-- Reports: the employee reads their own; approvers (and admins) read all. Only approvers write directly;
-- employees send theirs with expense_submit().
drop policy if exists expense_reports_read   on public.expense_reports;
drop policy if exists expense_reports_write  on public.expense_reports;
drop policy if exists expense_reports_update on public.expense_reports;
create policy expense_reports_read on public.expense_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_expense_approver());
create policy expense_reports_write on public.expense_reports for insert to authenticated
  with check (public.is_expense_approver());
create policy expense_reports_update on public.expense_reports for update to authenticated
  using (public.is_expense_approver()) with check (public.is_expense_approver());

-- ---------- Receipt photos (private) -----------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_read   on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_delete on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_expense_approver()));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text and public.is_employee());
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Locked months ------------------------------------------------
-- Once a month is sent for approval (or approved), the employee can't change its receipts or matches
-- until an approver sends it back. Approvers can still fix things (a customer, a category).
create or replace function public.expense_month_status(p_user uuid, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select status from public.expense_reports where user_id = p_user and month = date_trunc('month', p_day)::date
$$;
revoke all on function public.expense_month_status(uuid, date) from public, anon;

create or replace function public.expense_check_month(p_user uuid, p_day date) returns void
language plpgsql stable security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null or public.is_expense_approver() then return; end if;
  st := public.expense_month_status(p_user, p_day);
  if st = 'approved' then
    raise exception '% is already approved, so it can''t be changed.', to_char(p_day, 'FMMonth YYYY');
  elsif st = 'submitted' then
    raise exception '% was already sent for approval, so it''s locked. Ask an approver to send it back if something needs fixing.', to_char(p_day, 'FMMonth YYYY');
  end if;
end $$;
revoke all on function public.expense_check_month(uuid, date) from public, anon;

create or replace function public.expense_receipts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_expense_approver() and new.user_id <> old.user_id then
      raise exception 'A receipt can''t be moved to someone else.';
    end if;
    perform public.expense_check_month(old.user_id, old.bought_on);
  end if;
  perform public.expense_check_month(new.user_id, new.bought_on);
  if cardinality(new.photos) = 0 and nullif(trim(coalesce(new.no_photo_reason, '')), '') is null and new.deleted_at is null then
    raise exception 'Add a photo of the receipt, or say why there isn''t one.';
  end if;
  -- A deleted receipt lets go of its card charge (which then needs a receipt again).
  if tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
    update public.expense_charges set receipt_id = null, match_how = null, updated_at = now() where receipt_id = new.id;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists expense_receipts_guard on public.expense_receipts;
create trigger expense_receipts_guard before insert or update on public.expense_receipts
  for each row execute function public.expense_receipts_guard();

-- ---------- Matching card charges to receipts --------------------------
-- 1. Same person, same amount, bought within 4 days of the charge.
-- 2. Same person, meals and entertainment: the charge can be up to 35% more than the receipt (the tip).
-- 3. A charge on a card nobody is assigned to: one receipt from anyone with the exact amount within 3 days
--    (and only when exactly one receipt fits); the charge then belongs to that person.
-- p_user null = everyone. Returns how many charges were matched.
create or replace function public.expense_auto_match(p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  rid uuid;
  n int := 0;
  pass int;
begin
  if auth.uid() is not null and not public.is_expense_approver() and p_user is distinct from auth.uid() then
    raise exception 'You can only match your own receipts.';
  end if;
  for pass in 1..2 loop
    for c in
      select ch.* from public.expense_charges ch
       where ch.receipt_id is null and not ch.removed and ch.kind = 'purchase' and ch.excused_note is null
         and ch.user_id is not null and (p_user is null or ch.user_id = p_user)
         and public.expense_month_status(ch.user_id, ch.txn_date) is distinct from 'approved'
       order by ch.txn_date, ch.amount desc
    loop
      select r.id into rid from public.expense_receipts r
       where r.user_id = c.user_id and r.deleted_at is null and r.paid_with = 'card'
         and (r.card_last4 is null or c.card_last4 is null or r.card_last4 = c.card_last4)
         and abs(r.bought_on - c.txn_date) <= 4
         and not exists (select 1 from public.expense_charges x where x.receipt_id = r.id)
         and case when pass = 1 then abs(r.amount - c.amount) < 0.005
                  else r.category in ('Meals', 'Customer entertainment') and c.amount > r.amount and c.amount <= round(r.amount * 1.35, 2) end
       order by abs(r.bought_on - c.txn_date), abs(r.amount - c.amount), r.created_at
       limit 1;
      if rid is not null then
        update public.expense_charges set receipt_id = rid, match_how = 'auto', updated_at = now() where id = c.id;
        n := n + 1;
      end if;
    end loop;
  end loop;

  if p_user is null then
    for c in
      select ch.* from public.expense_charges ch
       where ch.receipt_id is null and not ch.removed and ch.kind = 'purchase' and ch.excused_note is null and ch.user_id is null
       order by ch.txn_date
    loop
      if (select count(*) from public.expense_receipts r
           where r.deleted_at is null and r.paid_with = 'card' and abs(r.amount - c.amount) < 0.005 and abs(r.bought_on - c.txn_date) <= 3
             and (r.card_last4 is null or c.card_last4 is null or r.card_last4 = c.card_last4)
             and not exists (select 1 from public.expense_charges x where x.receipt_id = r.id)) = 1 then
        select r.id into rid from public.expense_receipts r
         where r.deleted_at is null and r.paid_with = 'card' and abs(r.amount - c.amount) < 0.005 and abs(r.bought_on - c.txn_date) <= 3
           and (r.card_last4 is null or c.card_last4 is null or r.card_last4 = c.card_last4)
           and not exists (select 1 from public.expense_charges x where x.receipt_id = r.id);
        update public.expense_charges ch set receipt_id = rid, match_how = 'auto', updated_at = now(),
               user_id = (select user_id from public.expense_receipts where id = rid)
         where ch.id = c.id;
        n := n + 1;
      end if;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.expense_auto_match(uuid) from public, anon;
grant execute on function public.expense_auto_match(uuid) to authenticated, service_role;

-- Link a charge to a receipt by hand (p_receipt null = unlink). The receipt becomes "paid with the card".
create or replace function public.expense_link(p_charge uuid, p_receipt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.expense_charges;
  r public.expense_receipts;
  appr boolean := public.is_expense_approver();
begin
  select * into c from public.expense_charges where id = p_charge;
  if c.id is null or (not appr and c.user_id is distinct from auth.uid()) then raise exception 'That card charge wasn''t found.'; end if;
  if c.user_id is not null then perform public.expense_check_month(c.user_id, c.txn_date); end if;
  if p_receipt is null then
    update public.expense_charges set receipt_id = null, match_how = null, updated_at = now() where id = p_charge;
    return;
  end if;
  select * into r from public.expense_receipts where id = p_receipt and deleted_at is null;
  if r.id is null or (not appr and r.user_id <> auth.uid()) then raise exception 'That receipt wasn''t found.'; end if;
  if c.user_id is not null and c.user_id <> r.user_id then raise exception 'That receipt belongs to someone else.'; end if;
  perform public.expense_check_month(r.user_id, r.bought_on);
  update public.expense_charges set receipt_id = null, match_how = null, updated_at = now() where receipt_id = p_receipt and id <> p_charge;
  update public.expense_charges set receipt_id = p_receipt, match_how = 'manual', user_id = r.user_id, updated_at = now() where id = p_charge;
  if r.paid_with <> 'card' then update public.expense_receipts set paid_with = 'card' where id = p_receipt; end if;
end $$;
revoke all on function public.expense_link(uuid, uuid) from public, anon;
grant execute on function public.expense_link(uuid, uuid) to authenticated;

-- Approvers: "no receipt needed" for a charge (a subscription, a bank fee), with a category. p_note null = undo.
create or replace function public.expense_excuse(p_charge uuid, p_note text, p_category text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can do that.'; end if;
  update public.expense_charges
     set excused_note = nullif(trim(coalesce(p_note, '')), ''),
         excused_by = case when nullif(trim(coalesce(p_note, '')), '') is null then null else auth.uid() end,
         category = case when nullif(trim(coalesce(p_note, '')), '') is null then null else coalesce(nullif(p_category, ''), 'Other') end,
         updated_at = now()
   where id = p_charge and receipt_id is null;
  if not found then raise exception 'That charge wasn''t found, or it already has a receipt.'; end if;
end $$;
revoke all on function public.expense_excuse(uuid, text, text) from public, anon;
grant execute on function public.expense_excuse(uuid, text, text) to authenticated;

-- Approvers: whose card is which. Charges on that card that aren't matched yet move to that person.
create or replace function public.expense_set_card(p_last4 text, p_user uuid, p_label text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can do that.'; end if;
  if p_last4 !~ '^\d{4}$' then raise exception 'A card is the last 4 digits, like 1234.'; end if;
  insert into public.expense_cards (last4, user_id, label, updated_at) values (p_last4, p_user, nullif(trim(coalesce(p_label, '')), ''), now())
  on conflict (last4) do update set user_id = excluded.user_id, label = coalesce(excluded.label, public.expense_cards.label), updated_at = now();
  update public.expense_charges set user_id = p_user, updated_at = now()
   where card_last4 = p_last4 and receipt_id is null and user_id is distinct from p_user
     and (user_id is null or public.expense_month_status(user_id, txn_date) is distinct from 'approved');
  get diagnostics n = row_count;
  perform public.expense_auto_match(p_user);
  return n;
end $$;
revoke all on function public.expense_set_card(text, uuid, text) from public, anon;
grant execute on function public.expense_set_card(text, uuid, text) to authenticated;

-- Approvers: give one charge to a person (a card shared by two people, or a card nobody has yet).
create or replace function public.expense_assign_charge(p_charge uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can do that.'; end if;
  update public.expense_charges set user_id = p_user, updated_at = now() where id = p_charge and receipt_id is null;
  if not found then raise exception 'That charge wasn''t found, or it already has a receipt.'; end if;
  if p_user is not null then perform public.expense_auto_match(p_user); end if;
end $$;
revoke all on function public.expense_assign_charge(uuid, uuid) from public, anon;
grant execute on function public.expense_assign_charge(uuid, uuid) to authenticated;

-- ---------- Sending a month for approval -------------------------------
-- What's still missing for one person's month: card purchases with no receipt and no "no receipt needed".
create or replace function public.expense_missing(p_user uuid, p_month date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.expense_charges
   where user_id = p_user and txn_date >= date_trunc('month', p_month)::date
     and txn_date < (date_trunc('month', p_month) + interval '1 month')::date
     and kind = 'purchase' and not removed and receipt_id is null and excused_note is null
$$;
revoke all on function public.expense_missing(uuid, date) from public, anon;

-- The work itself (the employee's button and the daily job both use it). Returns the totals and who to tell.
create or replace function public.expense_submit_for(p_user uuid, p_month date, p_auto boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  e date := (date_trunc('month', p_month) + interval '1 month')::date;
  today date := (now() at time zone 'America/Chicago')::date;
  st text;
  miss int;
  n_rec int; n_chg int;
  ids text[];
  card numeric(12,2); pers numeric(12,2);
  rid uuid;
  who public.profiles;
begin
  select * into who from public.profiles where id = p_user;
  if who.id is null then raise exception 'That person wasn''t found.'; end if;
  if e > today then raise exception 'You can send % for approval once the month is over (on %).', to_char(m, 'FMMonth'), to_char(e, 'FMMonth FMDD'); end if;
  st := public.expense_month_status(p_user, m);
  if st = 'submitted' then raise exception '% was already sent for approval.', to_char(m, 'FMMonth YYYY'); end if;
  if st = 'approved' then raise exception '% is already approved.', to_char(m, 'FMMonth YYYY'); end if;
  perform public.expense_auto_match(p_user);
  miss := public.expense_missing(p_user, m);
  if miss > 0 then
    raise exception '% still % a receipt. Add the receipt, or tap "Lost receipt" and say what it was for.',
      case when miss = 1 then '1 card charge' else miss || ' card charges' end, case when miss = 1 then 'needs' else 'need' end;
  end if;

  select count(*), coalesce(array_agg(r.id::text order by r.bought_on), '{}'),
         coalesce(sum(r.amount) filter (where r.paid_with = 'personal'), 0)
    into n_rec, ids, pers
    from public.expense_receipts r
   where r.user_id = p_user and r.deleted_at is null and r.bought_on >= m and r.bought_on < e;
  -- The card total: what the bank charged (matched or not), plus card receipts the bank hasn't shown yet.
  select count(*), coalesce(sum(c.amount), 0) into n_chg, card
    from public.expense_charges c
   where c.user_id = p_user and not c.removed and c.kind in ('purchase', 'return', 'fee') and c.txn_date >= m and c.txn_date < e;
  card := card + coalesce((select sum(r.amount) from public.expense_receipts r
                            where r.user_id = p_user and r.deleted_at is null and r.paid_with = 'card' and r.bought_on >= m and r.bought_on < e
                              and not exists (select 1 from public.expense_charges c where c.receipt_id = r.id and not c.removed)), 0);
  if n_rec = 0 and n_chg = 0 then raise exception 'There''s nothing for % yet.', to_char(m, 'FMMonth YYYY'); end if;

  insert into public.expense_reports (user_id, month, receipt_ids, receipt_count, charge_count, total, card_total, personal_total,
                                      sent_at, sent_to, email_status, status, submitted_at, auto_submitted, review_note, returned_at,
                                      approved_by, approved_by_name, approved_at)
  values (p_user, m, ids, n_rec, n_chg, card + pers, card, pers, now(), '{}', null, 'submitted', now(), p_auto, null, null, null, null, null)
  on conflict (user_id, month) do update
     set receipt_ids = excluded.receipt_ids, receipt_count = excluded.receipt_count, charge_count = excluded.charge_count,
         total = excluded.total, card_total = excluded.card_total, personal_total = excluded.personal_total,
         sent_at = now(), email_status = null, status = 'submitted', submitted_at = now(), auto_submitted = p_auto,
         approved_by = null, approved_by_name = null, approved_at = null
  returning id into rid;

  return jsonb_build_object(
    'id', rid, 'month', to_char(m, 'YYYY-MM'), 'receipts', n_rec, 'charges', n_chg,
    'total', card + pers, 'card', card, 'personal', pers,
    'name', coalesce(nullif(who.full_name, ''), who.email), 'email', who.email,
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('email', p.email, 'name', p.full_name))
                             from public.profiles p where p.expense_approver and p.status = 'active' and p.id <> p_user), '[]'::jsonb));
end $$;
revoke all on function public.expense_submit_for(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.expense_submit_for(uuid, date, boolean) to service_role;

-- The employee's "Send for approval" button.
create or replace function public.expense_submit(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_employee() and public.is_active()) then raise exception 'Sign in with your AMBIT login first.'; end if;
  return public.expense_submit_for(auth.uid(), p_month, false);
end $$;
revoke all on function public.expense_submit(date) from public, anon;
grant execute on function public.expense_submit(date) to authenticated;

-- Approvers: approve a month, or send it back with a note. Nobody approves their own report.
create or replace function public.expense_review(p_user uuid, p_month date, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  rep public.expense_reports;
  me public.profiles;
  who public.profiles;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can approve reports.'; end if;
  if p_user = auth.uid() then raise exception 'Another approver has to approve your own report.'; end if;
  select * into rep from public.expense_reports where user_id = p_user and month = m;
  if rep.id is null then raise exception 'That report hasn''t been sent yet.'; end if;
  if p_approve and rep.status = 'approved' then raise exception 'It''s already approved.'; end if;
  if not p_approve and note is null then raise exception 'Say what needs fixing, so they know what to change.'; end if;
  if p_approve and public.expense_missing(p_user, m) > 0 then
    raise exception 'Some card charges in that month still have no receipt. Send it back, or mark them "No receipt needed".';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select * into who from public.profiles where id = p_user;
  if p_approve then
    update public.expense_reports
       set status = 'approved', approved_by = me.id, approved_by_name = coalesce(nullif(me.full_name, ''), me.email), approved_at = now(),
           review_note = note, returned_at = null
     where id = rep.id;
  else
    update public.expense_reports
       set status = 'returned', returned_at = now(), review_note = note, approved_by = null, approved_by_name = null, approved_at = null
     where id = rep.id;
  end if;
  return jsonb_build_object('id', rep.id, 'month', to_char(m, 'YYYY-MM'), 'status', case when p_approve then 'approved' else 'returned' end,
    'name', coalesce(nullif(who.full_name, ''), who.email), 'email', who.email,
    'by', coalesce(nullif(me.full_name, ''), me.email), 'total', rep.total, 'personal', rep.personal_total);
end $$;
revoke all on function public.expense_review(uuid, date, boolean, text) from public, anon;
grant execute on function public.expense_review(uuid, date, boolean, text) to authenticated;

-- What the bank link looks like (no tokens).
create or replace function public.expense_bank_status()
returns table (id uuid, institution text, status text, error text, last_sync_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.institution, l.status, l.error, l.last_sync_at, l.created_at
    from public.expense_bank_links l where public.is_expense_approver() order by l.created_at
$$;
revoke all on function public.expense_bank_status() from public, anon;
grant execute on function public.expense_bank_status() to authenticated;

-- ---------- The expense dashboard (approvers only) ---------------------
-- Every dollar counts once: a receipt matched to a card charge counts at what the bank charged; a receipt
-- the bank hasn't shown counts at the receipt's amount; a card charge with no receipt counts as "No receipt".
create or replace function public.expense_kpis(p_from date, p_to date, p_branch text default null, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  span int := greatest(1, p_to - p_from + 1);
  pf date := p_from - (p_to - p_from + 1);
  pt date := p_from - 1;
  t0 date := (date_trunc('month', p_to) - interval '11 months')::date;
  today date := (now() at time zone 'America/Chicago')::date;
  res jsonb;
begin
  if not public.is_expense_approver() then raise exception 'Only expense approvers can see the expense dashboard.'; end if;

  with xl as (
    select l.*, coalesce(nullif(p.full_name, ''), p.email, case when l.card is not null then 'Card ••' || l.card || ' (not assigned)' else 'Not assigned' end) as emp_name,
           p.branch_id, b.name as branch, p.job_role
    from (
      select r.user_id, null::text as card, r.bought_on as day, coalesce(c.amount, r.amount) as amount, r.category, r.company_id,
             case when r.company_id is not null then r.company_id::text
                  when nullif(trim(r.customer_name), '') is not null then 'n:' || lower(regexp_replace(trim(r.customer_name), '\s+', ' ', 'g')) end as cust_key,
             coalesce(co.name, nullif(trim(r.customer_name), '')) as customer, nullif(trim(r.vendor), '') as vendor, r.id as receipt_id,
             c.id as charge_id, c.id is not null as on_card, r.paid_with = 'personal' and c.id is null as personal, false as missing, false as overdue,
             nullif(trim(coalesce(r.attendees, '')), '') is not null as has_people
        from public.expense_receipts r
        left join public.expense_charges c on c.receipt_id = r.id and not c.removed
        left join public.companies co on co.id = r.company_id
       where r.deleted_at is null and r.bought_on between least(t0, pf) and p_to
      union all
      select c.user_id, c.card_last4, c.txn_date, c.amount,
             case when c.kind = 'return' then 'Returns & credits' when c.kind = 'fee' then 'Bank fees'
                  when c.excused_note is not null then coalesce(c.category, 'Other') else 'No receipt' end,
             null, null, null, coalesce(nullif(c.merchant, ''), c.description), null, c.id, true, false,
             c.kind = 'purchase' and c.excused_note is null, c.kind = 'purchase' and c.excused_note is null and c.txn_date < today - 30, false
        from public.expense_charges c
       where c.receipt_id is null and not c.removed and c.kind in ('purchase', 'fee', 'return') and c.txn_date between least(t0, pf) and p_to
    ) l
    left join public.profiles p on p.id = l.user_id
    left join public.branches b on b.id = p.branch_id
    where (p_branch is null or p.branch_id = p_branch) and (p_user is null or l.user_id = p_user)
  ),
  cur as (select * from xl where day between p_from and p_to),
  prev as (select * from xl where day between pf and pt),
  pkey as (select coalesce(user_id::text, 'card:' || coalesce(card, '?')) as k, * from cur),
  tot as (
    select coalesce(sum(amount), 0) as spend, count(receipt_id) as receipts, count(*) filter (where missing) as missing_n,
           coalesce(sum(amount) filter (where missing), 0) as missing_amt, count(*) filter (where overdue) as overdue_n,
           coalesce(sum(amount) filter (where personal), 0) as personal, coalesce(sum(amount) filter (where on_card), 0) as card,
           coalesce(sum(amount) filter (where cust_key is not null), 0) as tied,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals,
           -- meals with guests, or customer entertainment, that no customer is named for
           coalesce(sum(amount) filter (where cust_key is null and (category = 'Customer entertainment' or (category = 'Meals' and has_people))), 0) as meals_untied,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           count(distinct user_id) as people, count(distinct cust_key) as customers
      from cur
  ),
  ptot as (
    select coalesce(sum(amount), 0) as spend,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           count(*) filter (where missing) as missing_n
      from prev
  ),
  cats as (
    select category, sum(amount) as amount, count(*) as n,
           coalesce((select sum(amount) from prev p where p.category = c.category), 0) as prev
      from cur c group by category order by sum(amount) desc
  ),
  emps as (
    select k, max(user_id::text) as user_id, max(emp_name) as name, max(branch) as branch, max(job_role) as job_role,
           sum(amount) as amount, count(*) as n, count(*) filter (where missing) as missing_n,
           coalesce(sum(amount) filter (where missing), 0) as missing_amt, count(*) filter (where overdue) as overdue_n,
           count(distinct cust_key) as customers, count(distinct day) filter (where cust_key is not null) as visit_days,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           coalesce(sum(amount) filter (where personal), 0) as personal
      from pkey group by k
  ),
  matrix as (select k, category, sum(amount) as amount, count(*) as n from pkey group by k, category),
  months as (
    select to_char(day, 'YYYY-MM') as m, category, sum(amount) as amount from xl
     where day between t0 and p_to group by 1, 2
  ),
  branches_ as (select coalesce(branch, 'No location') as branch, sum(amount) as amount, count(distinct user_id) as people from cur group by 1),
  cust as (
    select cust_key, max(customer) as customer, (array_agg(company_id) filter (where company_id is not null))[1] as company_id,
           sum(amount) as amount, count(*) as n, count(distinct day) as days, count(distinct user_id) as people, max(day) as last_day,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals
      from cur where cust_key is not null group by cust_key
  ),
  cust_emp as (
    select cust_key, user_id, max(emp_name) as name, sum(amount) as amount, count(distinct day) as days
      from cur where cust_key is not null group by cust_key, user_id
  ),
  sales as (
    select o.company_id, sum(coalesce(o.invoiced_total, o.est_subtotal)) as sales, count(*) as orders
      from public.orders o
     where o.status <> 'cancelled' and (o.created_at at time zone 'America/Chicago')::date between p_from and p_to
       and o.company_id in (select company_id from cust where company_id is not null)
     group by o.company_id
  ),
  d as (select distinct user_id, cust_key, day from cur where cust_key is not null and user_id is not null),
  w as (select a.user_id, a.cust_key, (select count(*) from d b where b.user_id = a.user_id and b.cust_key = a.cust_key and b.day >= a.day and b.day < a.day + 30) as n from d a),
  rep as (select user_id, cust_key, max(n) as max30 from w group by 1, 2 having max(n) >= 3),
  rep2 as (
    select r.user_id, r.cust_key, r.max30, max(c.emp_name) as name, max(c.customer) as customer, sum(c.amount) as amount,
           count(distinct c.day) as days, max(c.day) as last_day,
           coalesce(sum(c.amount) filter (where c.category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           coalesce(sum(c.amount) filter (where c.category in ('Meals', 'Customer entertainment')), 0) as meals
      from rep r join cur c on c.user_id = r.user_id and c.cust_key = r.cust_key
     group by r.user_id, r.cust_key, r.max30
  ),
  big as (select * from cur where amount > 0 order by amount desc limit 12),
  vend as (select vendor, sum(amount) as amount, count(*) as n from cur where vendor is not null and amount > 0 group by vendor order by sum(amount) desc limit 10)
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', pf, 'prev_to', pt, 'days', span,
    'totals', (select to_jsonb(tot) from tot),
    'prev', (select to_jsonb(ptot) from ptot),
    'categories', coalesce((select jsonb_agg(to_jsonb(cats)) from cats), '[]'),
    'employees', coalesce((select jsonb_agg(to_jsonb(e) - 'k' || jsonb_build_object('key', e.k,
                      'top_category', (select m.category from matrix m where m.k = e.k and m.amount > 0 order by m.amount desc limit 1))
                      order by e.amount desc) from emps e), '[]'),
    'matrix', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'category', category, 'amount', amount, 'n', n)) from matrix), '[]'),
    'months', coalesce((select jsonb_agg(to_jsonb(months) order by m) from months), '[]'),
    'branches', coalesce((select jsonb_agg(to_jsonb(branches_) order by amount desc) from branches_), '[]'),
    'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'key', c.cust_key, 'customer', c.customer, 'company_id', c.company_id, 'amount', c.amount, 'n', c.n, 'days', c.days,
        'people', c.people, 'last_day', c.last_day, 'travel', c.travel, 'meals', c.meals,
        'sales', s.sales, 'orders', s.orders,
        'by', (select jsonb_agg(jsonb_build_object('user_id', ce.user_id, 'name', ce.name, 'amount', ce.amount, 'days', ce.days) order by ce.amount desc)
                 from cust_emp ce where ce.cust_key = c.cust_key))
      order by c.amount desc) from (select * from cust order by amount desc limit 40) c left join sales s on s.company_id = c.company_id), '[]'),
    'repeat', coalesce((select jsonb_agg(to_jsonb(rep2) order by rep2.max30 desc, rep2.amount desc) from (select * from rep2 order by max30 desc, amount desc limit 30) rep2), '[]'),
    'biggest', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'name', emp_name, 'vendor', vendor, 'category', category, 'customer', customer,
        'amount', amount, 'receipt_id', receipt_id, 'missing', missing) order by amount desc) from big), '[]'),
    'vendors', coalesce((select jsonb_agg(to_jsonb(vend) order by amount desc) from vend), '[]')
  ) into res;
  return res;
end $$;
revoke all on function public.expense_kpis(date, date, text, uuid) from public, anon;
grant execute on function public.expense_kpis(date, date, text, uuid) to authenticated;

select 'expense approvers: ' || coalesce(string_agg(full_name, ', ' order by full_name), 'nobody yet') as status
  from public.profiles where expense_approver and status = 'active';
-- =====================================================================
-- AMBIT Intelligence update 0051 - Expense reports: demo data
-- * Five made-up employees (marked as demo; they can't sign in and get no email) with about five months of
--   receipts, Chase card charges and monthly reports, tied to AMBIT customers, so the approval screens and the
--   expense dashboard can be shown before real employees start.
-- * Admin > Expense reports > Setup: "Delete demo data" takes all of it away (and "Load demo data" puts it back).
-- Run once in Supabase > SQL Editor. Safe to run again (it never loads the demo twice).
-- =====================================================================

alter table public.profiles        add column if not exists demo boolean not null default false;
alter table public.expense_charges add column if not exists demo boolean not null default false;
alter table public.expense_cards   add column if not exists demo boolean not null default false;
alter table public.expense_imports add column if not exists demo boolean not null default false;

-- Staff logins must be @ambitpu.com; the made-up demo employees are the one exception (they can't sign in).
alter table public.profiles drop constraint if exists staff_must_be_ambit;
alter table public.profiles add constraint staff_must_be_ambit check (role = 'customer' or email like '%@ambitpu.com' or demo) not valid;

-- Small helpers (not callable from the app).
create or replace function public.xd_pick(p text[]) returns text
language sql volatile as $$ select p[1 + floor(random() * array_length(p, 1))::int] $$;
create or replace function public.xd_rnd(a numeric, b numeric) returns numeric
language sql volatile as $$ select round(a + (b - a) * random()::numeric, 2) $$;
revoke all on function public.xd_pick(text[]) from public, anon, authenticated;
revoke all on function public.xd_rnd(numeric, numeric) from public, anon, authenticated;

-- One demo purchase: the receipt (with a made-up photo, or a lost-receipt reason) and its card charge.
-- p_tip_after: a tip added after the receipt was printed (the card is charged more). p_no_receipt: only the charge.
create or replace function public.xd_buy(
  p_user uuid, p_card text, p_day date, p_vendor text, p_amount numeric, p_cat text,
  p_company uuid default null, p_customer text default null, p_purpose text default null, p_people text default null,
  p_personal boolean default false, p_tip_after numeric default 0, p_lost text default null, p_no_receipt boolean default false,
  p_import uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := gen_random_uuid();
  at timestamptz := (p_day + time '17:30' + (floor(random() * 240) || ' minutes')::interval) at time zone 'America/Chicago';
  ch_day date := p_day + case when random() < 0.25 then 1 else 0 end;
begin
  if not p_no_receipt then
    insert into public.expense_receipts (id, user_id, bought_on, vendor, amount, category, paid_with, card_last4, company_id, customer_name,
                                         purpose, attendees, photos, no_photo_reason, created_at)
    values (rid, p_user, p_day, p_vendor, p_amount, p_cat, case when p_personal then 'personal' else 'card' end,
            case when p_personal then null else p_card end, p_company,
            coalesce((select name from public.companies where id = p_company), p_customer), p_purpose, p_people,
            case when p_lost is null then array['demo:' || rid::text] else '{}' end, p_lost, at);
  end if;
  if not p_personal then
    insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, bank_category, kind,
                                        amount, receipt_id, match_how, demo, import_id, imported_at)
    values ('upload', 'demo:' || gen_random_uuid()::text, p_card, p_user, ch_day, ch_day + 1,
            upper(p_vendor) || ' #' || (100 + floor(random() * 899))::text, p_vendor,
            case p_cat when 'Fuel' then 'Gas' when 'Meals' then 'Food & Drink' when 'Customer entertainment' then 'Entertainment'
                       when 'Lodging' then 'Travel' when 'Airfare & travel' then 'Travel' when 'Shipping' then 'Shipping' else 'Shopping' end,
            'purchase', p_amount + coalesce(p_tip_after, 0), case when p_no_receipt then null else rid end,
            case when p_no_receipt then null else 'auto' end, true, p_import, at);
  end if;
  return case when p_no_receipt then null else rid end;
end $$;
revoke all on function public.xd_buy(uuid, text, date, text, numeric, text, uuid, text, text, text, boolean, numeric, text, boolean, uuid) from public, anon, authenticated;

-- ---------- Load the demo ------------------------------------------------
create or replace function public.expense_demo_fill() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  first_m date := (date_trunc('month', (now() at time zone 'America/Chicago')::date) - interval '5 months')::date;
  d date;
  dow int;
  mo int;
  m date;
  r numeric;
  i int;
  c int;
  cust uuid[];
  br text[];
  appr uuid[];
  appr_name text[];
  ty uuid; mr uuid; dw uuid; lo uuid; bc uuid;
  imp uuid;
  people jsonb;
  p jsonb;
  uid uuid;
  ids uuid[] := '{}';
  cards text[] := '{}';
  l4 text;
  pick uuid;
  fav uuid;
  amt numeric;
  tip numeric;
  n_rec int;
  n_chg int;
  st jsonb;
  has_aud boolean;
  col text;
begin
  if auth.uid() is not null and not public.is_expense_approver() then raise exception 'Only an expense approver can load the demo.'; end if;
  if exists (select 1 from public.profiles where demo) then raise exception 'The demo is already loaded. Delete it first (Admin > Expense reports > Setup).'; end if;
  perform setseed(0.4242);

  -- AMBIT customers with the most orders lately (so the dashboard's "cost of sales" has real sales next to it).
  select array_agg(id) into cust from (
    select c.id
      from public.companies c
      left join public.orders o on o.company_id = c.id and o.status <> 'cancelled' and o.created_at > now() - interval '240 days'
     where c.active
     group by c.id
     order by coalesce(sum(coalesce(o.invoiced_total, o.est_subtotal)), 0) desc, c.name
     limit 14) x;
  if coalesce(array_length(cust, 1), 0) < 14 then raise exception 'The demo needs at least 14 customers in the customer list.'; end if;
  select array_agg(id order by sort) into br from public.branches where active;
  br := br || array[br[1], br[1], br[1], br[1], br[1]];
  select array_agg(id order by (lower(email) in ('kevin.lall@ambitpu.com', 'kim.hight@ambitpu.com')) desc, full_name),
         array_agg(coalesce(full_name, email) order by (lower(email) in ('kevin.lall@ambitpu.com', 'kim.hight@ambitpu.com')) desc, full_name)
    into appr, appr_name
    from public.profiles where expense_approver and status = 'active';

  -- ---- five made-up employees (no password, blocked from signing in, an address that can't get email)
  has_aud := exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud');
  people := '[{"k":"ty","name":"Tyler Brooks","job":"tech","br":1},{"k":"mr","name":"Marcus Reed","job":"sales_rep","br":2},
              {"k":"dw","name":"Dana Whitfield","job":"sales_rep","br":5},{"k":"lo","name":"Luis Ortega","job":"tech","br":3},
              {"k":"bc","name":"Brandon Cole","job":"warehouse","br":1}]'::jsonb;
  c := 0;
  for p in select * from jsonb_array_elements(people) loop
    c := c + 1;
    uid := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, banned_until)
    values (uid, 'demo.' || replace(lower(p->>'name'), ' ', '.') || '@expense-demo.invalid',
            jsonb_build_object('full_name', p->>'name', 'demo', true), '{"provider":"demo"}'::jsonb, now() - interval '200 days', now(), '2999-12-31');
    if has_aud then
      execute 'update auth.users set aud = ''authenticated'', role = ''authenticated'', instance_id = ''00000000-0000-0000-0000-000000000000'' where id = $1' using uid;
    end if;
    -- Supabase's sign-in service expects these as empty text, not missing.
    for col in select column_name from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
                  and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'email_change',
                                      'phone_change', 'phone_change_token', 'reauthentication_token') loop
      execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', col, col) using uid;
    end loop;
    update public.profiles
       set full_name = p->>'name', role = 'employee', status = 'disabled', job_role = p->>'job', branch_id = br[(p->>'br')::int], demo = true
     where id = uid;
    -- A card number nobody real has.
    l4 := null;
    for i in 0..40 loop
      if not exists (select 1 from public.expense_cards where last4 = (9101 + c + i * 7)::text) then l4 := (9101 + c + i * 7)::text; exit; end if;
    end loop;
    insert into public.expense_cards (last4, user_id, label, demo) values (l4, uid, split_part(p->>'name', ' ', 1) || '''s card (demo)', true);
    ids := ids || uid;
    cards := cards || l4;
  end loop;
  ty := ids[1]; mr := ids[2]; dw := ids[3]; lo := ids[4]; bc := ids[5];

  insert into public.expense_imports (source, file_name, rows, added, skipped, date_from, date_to, by_name, at, demo)
  values ('upload', 'Chase activity (demo).CSV', 0, 0, 0, first_m, today - 1, 'Demo', now() - interval '1 day', true)
  returning id into imp;

  -- ---- day by day
  d := first_m;
  while d < today loop
    dow := extract(isodow from d)::int;
    mo := (extract(year from d) * 12 + extract(month from d))::int - (extract(year from first_m) * 12 + extract(month from first_m))::int; -- 0..5

    if dow <= 5 then
      -- Tyler (tech, OKC): rig service calls, more and more at one customer.
      if random() < 0.24 + mo * 0.04 then
        r := random();
        pick := case when r < 0.45 + mo * 0.06 then cust[3] when r < 0.85 then cust[6] else cust[9] end;
        perform public.xd_buy(ty, cards[1], d, public.xd_pick(array['OnCue', 'Love''s', 'QuikTrip', 'OnCue']), public.xd_rnd(52, 96), 'Fuel', pick, null,
                              public.xd_pick(array['Rig service call', 'Gun rebuild on site', 'Proportioner troubleshooting', 'Hose heat problem']), null, false, 0, null, false, imp);
        if pick = cust[9] then
          perform public.xd_buy(ty, cards[1], d, 'Hampton Inn Amarillo', public.xd_rnd(124, 169), 'Lodging', pick, null, 'Overnight: proportioner rebuild', null, false, 0, null, false, imp);
          perform public.xd_buy(ty, cards[1], d, public.xd_pick(array['Whataburger', 'Chili''s', 'Braum''s']), public.xd_rnd(13, 31), 'Meals', null, null, 'Dinner on the road', null, false, 0, null, false, imp);
        end if;
        if random() < 0.16 then
          perform public.xd_buy(ty, cards[1], d, public.xd_pick(array['Northern Tool', 'Graco parts counter', 'Fastenal']), public.xd_rnd(78, 285), 'Tools & supplies', pick, null,
                                public.xd_pick(array['Proportioner seals', 'Gun mix chamber', 'Heated hose repair kit']), null, false, 0, null, false, imp);
        end if;
      end if;

      -- Marcus (sales, Arlington): lunches and outings, more and more with one customer that doesn't buy much.
      if random() < 0.30 + mo * 0.03 then
        r := random();
        fav := cust[13];
        pick := case when r < 0.40 + mo * 0.07 then fav when r < 0.75 then cust[2] else cust[5] end;
        amt := public.xd_rnd(68, 245);
        tip := case when random() < 0.35 then round((amt * (0.17 + random() * 0.05))::numeric, 2) else 0 end;
        perform public.xd_buy(mr, cards[2], d, public.xd_pick(array['Texas Land & Cattle', 'Pappadeaux', 'Saltgrass Steak House', 'Chuy''s', 'Joe T. Garcia''s']), amt, 'Meals', pick, null,
                              public.xd_pick(array['Lunch: fall orders', 'Lunch: closed-cell pricing', 'Lunch with the owner', 'Lunch: new crew lead']),
                              public.xd_pick(array['Owner and office manager', 'Owner', 'Owner and crew lead', 'Estimator']), false, tip, null, false, imp);
        if random() < 0.45 then
          perform public.xd_buy(mr, cards[2], d, public.xd_pick(array['QuikTrip', 'RaceTrac', 'Buc-ee''s']), public.xd_rnd(44, 76), 'Fuel', pick, null, 'Customer visit', null, false, 0, null, false, imp);
        end if;
        if random() < 0.11 + mo * 0.02 then
          perform public.xd_buy(mr, cards[2], d + 1, public.xd_pick(array['Topgolf', 'Texas Rangers tickets', 'Main Event']), public.xd_rnd(185, 540), 'Customer entertainment', pick, null,
                                'Customer appreciation', public.xd_pick(array['Owner and 2 crew', 'Owner and wife', 'Crew of 4']), false, 0, null, false, imp);
        end if;
      end if;

      -- Luis (tech, San Marcos): startups and training, supplies, now and then paid personally or a lost receipt.
      if random() < 0.27 then
        r := random();
        pick := case when r < 0.45 then cust[7] when r < 0.85 then cust[10] else null end;
        perform public.xd_buy(lo, cards[4], d, public.xd_pick(array['Buc-ee''s', 'Valero', 'H-E-B Fuel']), public.xd_rnd(48, 88), 'Fuel', pick,
                              case when pick is null then 'Hill Country Insulation (prospect)' end,
                              public.xd_pick(array['Rig startup and training', 'Startup: new rig', 'Spray training']), null, false, 0,
                              case when random() < 0.06 then 'The pump didn''t print a receipt' end, false, imp);
        if random() < 0.38 then
          perform public.xd_buy(lo, cards[4], d, public.xd_pick(array['Home Depot', 'Lowe''s', 'Ace Hardware']), public.xd_rnd(19, 182), 'Tools & supplies', pick,
                                case when pick is null then 'Hill Country Insulation (prospect)' end,
                                public.xd_pick(array['Poly, tape and masking', 'Generator fuel cans', 'Shop supplies']), null, random() < 0.12, 0, null, false, imp);
        end if;
      end if;

      -- Brandon (warehouse / delivery driver, OKC): diesel for deliveries.
      if random() < 0.36 then
        r := random();
        perform public.xd_buy(bc, cards[5], d, public.xd_pick(array['Love''s Travel Stop', 'Pilot', 'OnCue']), public.xd_rnd(118, 286), 'Fuel',
                              case when r < 0.35 then cust[1 + floor(random() * 14)::int] end, null, 'Box truck: deliveries', null, false, 0, null, false, imp);
      end if;
    end if;

    -- Dana (sales, Mobile): a trip to a big customer each month, local lunches every week.
    if extract(day from d) = 11 + (mo % 3) and d + 2 < today then
      pick := case when mo % 2 = 0 then cust[1] else cust[4] end;
      perform public.xd_buy(dw, cards[3], d, 'Southwest Airlines', public.xd_rnd(286, 468), 'Airfare & travel', pick, null, 'Site visit and crew training', null, false, 0, null, false, imp);
      perform public.xd_buy(dw, cards[3], d + 1, 'Hertz', public.xd_rnd(142, 228), 'Airfare & travel', pick, null, 'Rental car', null, false, 0, null, false, imp);
      perform public.xd_buy(dw, cards[3], d + 2, public.xd_pick(array['Courtyard by Marriott', 'Hilton Garden Inn', 'Hampton Inn & Suites']), public.xd_rnd(318, 512), 'Lodging', pick, null, '2 nights', null, false, 0, null, false, imp);
      amt := public.xd_rnd(162, 318);
      perform public.xd_buy(dw, cards[3], d + 1, public.xd_pick(array['Ruth''s Chris', 'Fleming''s', 'Wintzell''s Oyster House']), amt, 'Customer entertainment', pick, null, 'Dinner with the crew leads',
                            'Owner and 3 crew leads', false, round(amt * 0.2, 2), null, false, imp);
    elsif dow between 2 and 4 and random() < 0.32 then
      pick := case when random() < 0.5 then cust[8] else cust[11] end;
      perform public.xd_buy(dw, cards[3], d, public.xd_pick(array['Felix''s Fish Camp', 'Saucy Q', 'Panera Bread', 'Chick-fil-A']), public.xd_rnd(24, 118), 'Meals', pick, null, 'Lunch meeting',
                            public.xd_pick(array['Owner', 'Owner and estimator', 'Office manager']), false, 0, null, false, imp);
      if random() < 0.5 then
        perform public.xd_buy(dw, cards[3], d, public.xd_pick(array['Shell', 'Circle K', 'Chevron']), public.xd_rnd(38, 66), 'Fuel', pick, null, 'Customer visit', null, false, 0, null, false, imp);
      end if;
    end if;

    -- Once a month: shipping, Brandon's fleet GPS (an approver marks it "no receipt needed"), truck work.
    if extract(day from d) = 6 then
      perform public.xd_buy(bc, cards[5], d, 'The UPS Store', public.xd_rnd(34, 138), 'Shipping', cust[1 + floor(random() * 14)::int], null, 'Shipped gun parts to a customer', null, false, 0, null, false, imp);
      insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, demo, import_id,
                                          excused_note, excused_by, category)
      values ('upload', 'demo:' || gen_random_uuid()::text, cards[5], bc, d, d + 1, 'FLEETTRACK *GPS SUBSCRIPTION', 'Fleettrack GPS', 'purchase', 39.00, true, imp,
              'Monthly truck GPS subscription (autopay)', appr[1], 'Other');
    end if;
    if d = first_m + 34 then
      perform public.xd_buy(bc, cards[5], d, 'Discount Tire', 768.40, 'Vehicle & equipment repair', null, null, 'Box truck: 4 tires', null, false, 0, null, false, imp);
    end if;
    if d = first_m + 101 then
      perform public.xd_buy(bc, cards[5], d, 'Jiffy Lube', 342.19, 'Vehicle & equipment repair', null, null, 'Box truck: oil change and brakes', null, false, 0, null, false, imp);
      perform public.xd_buy(dw, cards[3], d, 'ICC code seminar', 395.00, 'Training & events', null, null, 'Energy code update class', null, false, 0, null, false, imp);
    end if;
    d := d + 1;
  end loop;

  -- ---- a few things worth showing
  m := (date_trunc('month', today) - interval '1 month')::date;  -- last month
  -- Marcus: a big dinner with no customer on it (the approver sends the month back for it).
  perform public.xd_buy(mr, cards[2], m + 20, 'Eddie V''s Prime Seafood', 412.88, 'Customer entertainment', null, null, 'Dinner', null, false, 70, null, false, imp);
  -- Luis: a charge last month with no receipt yet (his month can't go for approval), and a return.
  perform public.xd_buy(lo, cards[4], m + 26, 'QuikTrip', 64.12, 'Fuel', null, null, null, null, false, 0, null, true, imp);
  insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, demo, import_id)
  values ('upload', 'demo:' || gen_random_uuid()::text, cards[4], lo, m + 9, m + 10, 'HOME DEPOT RETURN', 'Home Depot', 'return', -45.18, true, imp);
  -- Lost receipts (explained, no photo) and things paid with their own money (paid back to them).
  perform public.xd_buy(lo, cards[4], first_m + 72, 'Valero', 61.20, 'Fuel', cust[7], null, 'Rig startup and training', null, false, 0, 'The pump didn''t print a receipt', false, imp);
  perform public.xd_buy(ty, cards[1], first_m + 110, 'Casey''s', 58.44, 'Fuel', cust[3], null, 'Rig service call', null, false, 0, 'Receipt blew out of the truck window', false, imp);
  perform public.xd_buy(dw, cards[3], first_m + 43, 'Uber', 38.75, 'Airfare & travel', cust[4], null, 'Airport to the hotel', null, true, 0, null, false, imp);
  perform public.xd_buy(mr, cards[2], first_m + 128, 'DFW Airport Parking', 24.00, 'Airfare & travel', null, null, 'Parking for the regional meeting', null, true, 0, null, false, imp);
  -- This month: charges still waiting for receipts.
  perform public.xd_buy(ty, cards[1], least(today - 1, date_trunc('month', today)::date + 1), 'Amazon', 86.40, 'Tools & supplies', null, null, null, null, false, 0, null, true, imp);
  perform public.xd_buy(mr, cards[2], least(today - 1, date_trunc('month', today)::date + 2), 'Pappadeaux', 238.55, 'Meals', null, null, null, null, false, 0, null, true, imp);
  -- A charge on a card nobody is assigned to.
  insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, demo, import_id)
  values ('upload', 'demo:' || gen_random_uuid()::text, '9199', null, m + 27, m + 28, 'SHERWIN-WILLIAMS #7741', 'Sherwin-Williams', 'purchase', 57.36, true, imp);

  -- ---- monthly reports: older months approved; last month a mix (approved, waiting, sent back, not sent)
  for c in 1..5 loop
    uid := ids[c];
    m := first_m;
    while m < date_trunc('month', today)::date loop
      begin
        st := public.expense_submit_for(uid, m, c = 5);
        if m < (date_trunc('month', today) - interval '1 month')::date or c in (1, 3) then
          update public.expense_reports
             set status = 'approved', submitted_at = (m + interval '1 month' + interval '2 days' + interval '15 hours'), sent_at = (m + interval '1 month' + interval '2 days' + interval '15 hours'),
                 approved_by = appr[1 + (extract(month from m)::int % greatest(1, coalesce(array_length(appr, 1), 1)))],
                 approved_by_name = coalesce(appr_name[1 + (extract(month from m)::int % greatest(1, coalesce(array_length(appr_name, 1), 1)))], 'Kevin Lall'),
                 approved_at = (m + interval '1 month' + interval '4 days' + interval '10 hours'), email_status = 'demo'
           where user_id = uid and month = m;
        elsif c = 2 then
          update public.expense_reports
             set status = 'returned', submitted_at = (m + interval '1 month' + interval '2 days' + interval '9 hours'), returned_at = (m + interval '1 month' + interval '4 days' + interval '11 hours'),
                 review_note = 'Which customer was the Eddie V''s dinner on the 21st for? Add the customer and who was there, then send it again.', email_status = 'demo'
           where user_id = uid and month = m;
        else
          update public.expense_reports set submitted_at = (m + interval '1 month' + interval '3 days' + interval '6 hours'), email_status = 'demo' where user_id = uid and month = m;
        end if;
      exception when others then
        null;  -- a month with a charge still missing its receipt stays unsent (Luis, last month)
      end;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  select count(*) into n_rec from public.expense_receipts where user_id = any(ids);
  select count(*) into n_chg from public.expense_charges where demo;
  update public.expense_imports set rows = n_chg, added = n_chg where id = imp;
  return jsonb_build_object('people', 5, 'receipts', n_rec, 'charges', n_chg, 'from', first_m, 'to', today - 1);
end $$;
revoke all on function public.expense_demo_fill() from public, anon;
grant execute on function public.expense_demo_fill() to authenticated;

-- ---------- Delete the demo ----------------------------------------------
create or replace function public.expense_demo_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
  n_rec int;
  n_chg int;
begin
  if auth.uid() is not null and not public.is_expense_approver() then raise exception 'Only an expense approver can delete the demo.'; end if;
  select coalesce(array_agg(id), '{}') into ids from public.profiles where demo;
  select count(*) into n_rec from public.expense_receipts where user_id = any(ids);
  delete from public.expense_charges where demo or user_id = any(ids);
  get diagnostics n_chg = row_count;
  delete from public.expense_cards where demo or user_id = any(ids);
  delete from public.expense_imports where demo;
  delete from public.expense_reports where user_id = any(ids);
  delete from public.expense_receipts where user_id = any(ids);
  delete from auth.users where id = any(ids);   -- their profiles go with them
  return jsonb_build_object('people', coalesce(array_length(ids, 1), 0), 'receipts', n_rec, 'charges', n_chg);
end $$;
revoke all on function public.expense_demo_clear() from public, anon;
grant execute on function public.expense_demo_clear() to authenticated;

-- Load it now (only if it isn't there yet).
select case when exists (select 1 from public.profiles where demo) then 'Expense demo: already loaded'
            else 'Expense demo loaded: ' || public.expense_demo_fill()::text end as status;

-- =====================================================================
-- AMBIT Intelligence update 0052 - Fixing counts, automatic approval, variance report
-- * Admins can fix a counted number on a spot check or reconciliation that's waiting for approval
--   ("Edit count"). The number first counted is kept and shown ("was 786").
-- * A count that matches what the app has is approved automatically (by AMBIT A.I.), and its
--   LAST COUNTED / COUNTED BY go onto the COUNT SHEET like an approved count. Spot checks already
--   marked "Matched" become "Approved".
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.inventory_count_lines add column if not exists first_qty     numeric(12,2);  -- what was counted before an admin fixed it
alter table public.inventory_count_lines add column if not exists fixed_by_name text;
alter table public.inventory_count_lines add column if not exists fixed_at      timestamptz;

-- Puts a count's numbers into stock and marks it approved: an admin's Approve, or automatically when it
-- matched the app. Called only from the functions below (not by the app directly).
create or replace function public.count_apply(p_count bigint, p_who text, p_note text default null, p_auto boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k     public.inventory_counts;
  l     record;
  diff  numeric;
  n     int := 0;
  m     int := 0;
  what  text;
  dt    date;
  fl    record;
begin
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status not in ('submitted', 'matched') then raise exception 'This count isn''t waiting for approval.'; end if;
  what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
  for l in select * from public.inventory_count_lines where count_id = p_count and counted_qty is not null and not applied order by id loop
    m := m + 1;
    diff := l.counted_qty - coalesce(l.system_qty, 0);
    dt := coalesce((l.counted_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date);
    if l.lot_id is not null then
      if diff <> 0 then
        update public.inventory_lots set adj_unsynced = adj_unsynced + diff, updated_at = now() where id = l.lot_id;
        insert into public.inventory_log (branch_id, kind, sku, message, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': lot ' || coalesce(l.lot_no, '(no lot #)') || ' counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0))
                  || '). Adj on FOAM LOTS ' || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || p_who || '.',
                coalesce(l.counted_by_name, p_who));
        n := n + 1;
      end if;
    else
      -- A later count already on the row (typed on the sheet, or approved first) keeps its date and name.
      update public.inventory
         set on_hand = coalesce(on_hand, 0) + diff,
             counted_by = case when last_counted is null or last_counted <= dt then left(coalesce(l.counted_by_name, p_who), 80) else counted_by end,
             last_counted = case when last_counted is null or last_counted <= dt then dt else last_counted end,
             count_dirty = true, updated_at = now(), updated_by_name = p_who
       where branch_id = k.branch_id and product_id = l.product_id;
      if diff <> 0 then
        insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0)) || '), '
                  || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || p_who || '.',
                l.system_qty, l.counted_qty, coalesce(l.counted_by_name, p_who));
        n := n + 1;
      end if;
    end if;
    update public.inventory_count_lines set applied = true where id = l.id;
  end loop;
  update public.inventory_counts
     set status = 'approved', reviewed_at = now(), reviewed_by_name = p_who,
         review_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
   where id = p_count;
  if p_auto and n = 0 then
    select sku, counted_qty into fl from public.inventory_count_lines where count_id = p_count and counted_qty is not null order by id limit 1;
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (k.branch_id, 'count', case when k.kind = 'spot' then fl.sku end,
            case when k.kind = 'spot'
                 then 'Spot check: ' || coalesce(fl.sku, '') || ' counted '
                      || case when m > 1 then 'lot by lot (' || m || ' lots)' else trim_scale(fl.counted_qty)::text end
                      || ', matched the app. Approved automatically.'
                 else 'Inventory reconciliation: all ' || m || ' counted ' || case when m = 1 then 'item' else 'items' end
                      || ' matched the app. Approved automatically.' end,
            coalesce(k.submitted_by_name, p_who));
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = k.branch_id;
  return n;
end $$;

-- A count is sent in. If everything matched it's approved automatically; otherwise it waits for an admin.
create or replace function public.count_finish(p_count bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  off int;
  st  text;
begin
  select count(*) into off from public.inventory_count_lines
   where count_id = p_count and counted_qty is not null and counted_qty is distinct from coalesce(system_qty, 0);
  st := case when off = 0 then 'matched' else 'submitted' end;
  update public.inventory_counts
     set status = st, submitted_at = now(), submitted_by_name = public.my_name()
   where id = p_count and status = 'open';
  if st = 'matched' then
    perform public.count_apply(p_count, 'AMBIT A.I.', 'Matched what the app had, so it was approved automatically.', true);
    st := 'approved';
  end if;
  return st;
end $$;

-- Warehouse: one counted number. A spot check is sent in as soon as every line has its count.
create or replace function public.count_line_save(p_line bigint, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_count_lines;
  k   public.inventory_counts;
  sys numeric;
  st  text;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into l from public.inventory_count_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the count any more.'; end if;
  select * into k from public.inventory_counts where id = l.count_id for update;
  if k.status <> 'open' then raise exception 'This count was already sent in.'; end if;
  if p_qty is null then
    -- Cleared: not counted after all.
    update public.inventory_count_lines set counted_qty = null, system_qty = null, counted_at = null, counted_by_name = null where id = p_line;
    return jsonb_build_object('status', k.status, 'branch', k.branch_id);
  end if;
  if p_qty < 0 then raise exception 'A count can''t be below zero.'; end if;
  sys := public.count_system_qty(k.branch_id, l.product_id, l.lot_id);
  update public.inventory_count_lines
     set counted_qty = round(p_qty, 2), system_qty = sys, counted_at = now(), counted_by_name = public.my_name(),
         note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_line;
  st := k.status;
  if k.kind = 'spot' and not exists (select 1 from public.inventory_count_lines where count_id = k.id and counted_qty is null) then
    st := public.count_finish(k.id);
  end if;
  return jsonb_build_object('status', st, 'branch', k.branch_id);
end $$;

-- Admin: approve (the differences go into stock and onto the spreadsheet) or don't approve a count.
create or replace function public.count_review(p_count bigint, p_approve boolean, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k    public.inventory_counts;
  who  text := coalesce(public.my_name(), 'AMBITION');
  what text;
begin
  if not public.is_admin() then raise exception 'Only admins can approve counts.'; end if;
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status <> 'submitted' then raise exception 'This count isn''t waiting for approval.'; end if;
  if not p_approve then
    what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
    update public.inventory_counts set status = 'rejected', reviewed_at = now(), reviewed_by_name = who,
           review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_count;
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (k.branch_id, 'count', what || ' not approved' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '') || '. Stock wasn''t changed.', who);
    return 0;
  end if;
  return public.count_apply(p_count, who, p_note, false);
end $$;

-- Admin: fix one counted number on a count that's waiting for approval (someone missed a display
-- item, typed 68 for 86...). The first number counted is kept. If everything now matches the app,
-- it's approved automatically.
create or replace function public.count_line_fix(p_line bigint, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l    public.inventory_count_lines;
  k    public.inventory_counts;
  who  text := coalesce(public.my_name(), 'Admin');
  what text;
  q    numeric;
  off  int;
begin
  if not public.is_admin() then raise exception 'Only admins can fix a count.'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'Type the right count (0 or more).'; end if;
  q := round(p_qty, 2);
  select * into l from public.inventory_count_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the count any more.'; end if;
  select * into k from public.inventory_counts where id = l.count_id for update;
  if k.status <> 'submitted' then raise exception 'Only a count that''s waiting for approval can be fixed.'; end if;
  if l.counted_qty is null then raise exception 'That item wasn''t counted, so it isn''t part of this count.'; end if;
  if l.counted_qty = q then
    return jsonb_build_object('status', k.status, 'branch', k.branch_id, 'changed', false);
  end if;
  what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
  update public.inventory_count_lines
     set first_qty = coalesce(first_qty, counted_qty), counted_qty = q, fixed_by_name = who, fixed_at = now(),
         note = coalesce(nullif(left(trim(coalesce(p_note, '')), 300), ''), note)
   where id = p_line;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (k.branch_id, 'count', l.sku,
          what || ' (' || to_char(coalesce(k.day, (k.submitted_at at time zone 'America/Chicago')::date), 'Mon FMDD') || '): '
            || case when l.lot_no is not null then 'lot ' || l.lot_no || ' ' else '' end
            || 'count fixed from ' || trim_scale(l.counted_qty) || ' to ' || trim_scale(q)
            || coalesce(' (counted by ' || l.counted_by_name || ')', '')
            || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '') || '.',
          who);
  select count(*) into off from public.inventory_count_lines
   where count_id = k.id and counted_qty is not null and counted_qty is distinct from coalesce(system_qty, 0);
  if off = 0 then
    perform public.count_apply(k.id, who, 'Count fixed by ' || who || '. It then matched what the app had, so it was approved automatically.', true);
    return jsonb_build_object('status', 'approved', 'branch', k.branch_id, 'changed', true);
  end if;
  return jsonb_build_object('status', 'submitted', 'branch', k.branch_id, 'changed', true);
end $$;

-- Spot checks already marked "Matched" become "Approved" (their stock was already right).
update public.inventory_count_lines set applied = true
 where count_id in (select id from public.inventory_counts where status = 'matched') and counted_qty is not null;
update public.inventory_counts
   set status = 'approved', reviewed_at = coalesce(submitted_at, now()), reviewed_by_name = 'AMBIT A.I.',
       review_note = coalesce(review_note, 'Matched what the app had, so it was approved automatically.')
 where status = 'matched';

revoke all on function public.count_apply(bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.count_line_fix(bigint, numeric, text) from public, anon;
grant execute on function public.count_line_fix(bigint, numeric, text) to authenticated;

select 'Update 0052 done: ' || (select count(*) from public.inventory_counts where status = 'approved' and reviewed_by_name = 'AMBIT A.I.')
       || ' matched counts approved automatically.' as status;

-- =====================================================================
-- AMBIT Intelligence update 0053 - Teachable takeoff AI
-- * The AI reads each plan sheet and draws the shapes itself (walls, ceilings, floors, slab...). Its
--   shapes are dashed until someone accepts or edits them; shapes on elevations are for reference only
--   and never counted. Windows and doors it finds are kept per sheet.
-- * Teaching: a correction typed on a sheet can be remembered as a rule for all plans or for one
--   builder. Rules go into every future reading. AMBIT's rules apply to every takeoff; a contractor's
--   own rules apply only to their takeoffs. Deleting a takeoff keeps the rules learned on it.
-- * Every AI call is logged (sheet, result, tokens) so bad reads can be reviewed.
-- * Templates: a finished takeoff saved as a template; a new takeoff can start from it (no AI needed).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Takeoffs, sheets, items, shapes ---------------------------------------------------
alter table public.takeoffs add column if not exists builder       text;
alter table public.takeoffs add column if not exists ai_read       jsonb;    -- the latest cross-sheet check (facts, alerts, windows) and which alerts were checked
alter table public.takeoffs add column if not exists is_template   boolean not null default false;
alter table public.takeoffs add column if not exists template_name text;
alter table public.takeoffs add column if not exists from_template uuid;     -- the template it was started from (no link: templates can be deleted)
create index if not exists takeoffs_templates_idx on public.takeoffs(is_template) where is_template;

alter table public.takeoff_sheets add column if not exists ai    jsonb;        -- the AI's last reading of this sheet (shapes in pixels of the picture it saw)
alter table public.takeoff_sheets add column if not exists ai_at timestamptz;

alter table public.takeoff_items add column if not exists assembly text;      -- slab, exterior_walls, knee_walls ... (lib/takeoff/assemblies.ts)
alter table public.takeoff_items add column if not exists ai       boolean not null default false;  -- set up by the AI

alter table public.takeoff_marks add column if not exists ai   boolean not null default false;  -- drawn by the AI and not checked yet (dashed)
alter table public.takeoff_marks add column if not exists ref  boolean not null default false;  -- for reference only (elevations, sections): never counted
alter table public.takeoff_marks add column if not exists note text;                            -- "over garage", "master bedroom tray"

-- ---------- Windows and doors the AI found ------------------------------------------------------
create table if not exists public.takeoff_components (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  sheet_id    uuid references public.takeoff_sheets(id) on delete cascade,
  kind        text not null default 'window',   -- window | door | garage_door | opening
  code        text,                              -- 3050, 2868, 16'-0" x 8'-0"
  width_ft    numeric,
  height_ft   numeric,
  qty         int not null default 1,
  side        text,                              -- front | rear | left | right | interior | unknown
  wall        text,                              -- the assembly it sits in (exterior_walls, garage_partition_walls ...)
  label       text,                              -- F1, R2 ...
  x           numeric,                           -- where on the sheet, PDF points
  y           numeric,
  ai          boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_components_takeoff_idx on public.takeoff_components(takeoff_id);
alter table public.takeoff_components enable row level security;
drop policy if exists takeoff_components_team on public.takeoff_components;
create policy takeoff_components_team on public.takeoff_components for all to authenticated
  using (takeoff_id in (select t.id from public.takeoffs t)) with check (takeoff_id in (select t.id from public.takeoffs t));

-- Who works on AMBIT's own takeoffs (and its rules), or on one contractor's.
create or replace function public.takeoff_team(p_company uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_company is null then public.has_perm('takeoff')
              else p_company = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales') end
$$;

-- ---------- Rules taught to the AI ----------------------------------------------------------------
create table if not exists public.takeoff_ai_rules (
  id                uuid primary key default gen_random_uuid(),
  text              text not null,
  kind              text not null default 'plans',      -- plans | photos
  builder           text,                               -- blank = every builder
  ops_company_id    uuid references public.companies(id) on delete cascade,  -- blank = AMBIT's rules (every takeoff)
  active            boolean not null default true,
  source            text not null default 'correction', -- correction | manual | import
  source_takeoff_id uuid references public.takeoffs(id) on delete set null,
  source_sheet      text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
do $$ begin
  alter table public.takeoff_ai_rules add constraint takeoff_ai_rules_kind_check check (kind in ('plans', 'photos'));
exception when duplicate_object then null; end $$;
create index if not exists takeoff_ai_rules_scope_idx on public.takeoff_ai_rules(ops_company_id, active, created_at);
alter table public.takeoff_ai_rules enable row level security;
drop policy if exists takeoff_ai_rules_team on public.takeoff_ai_rules;
create policy takeoff_ai_rules_team on public.takeoff_ai_rules for all to authenticated
  using (public.takeoff_team(ops_company_id)) with check (public.takeoff_team(ops_company_id));

-- ---------- Every correction typed, remembered or not --------------------------------------------
create table if not exists public.takeoff_ai_corrections (
  id              uuid primary key default gen_random_uuid(),
  takeoff_id      uuid references public.takeoffs(id) on delete set null,
  sheet_id        uuid,
  sheet_name      text,
  builder         text,
  text            text not null,
  remember        text not null default 'once',   -- once | all | builder
  rule_id         uuid references public.takeoff_ai_rules(id) on delete set null,
  ops_company_id  uuid references public.companies(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists takeoff_ai_corrections_idx on public.takeoff_ai_corrections(ops_company_id, created_at desc);
alter table public.takeoff_ai_corrections enable row level security;
drop policy if exists takeoff_ai_corrections_team on public.takeoff_ai_corrections;
create policy takeoff_ai_corrections_team on public.takeoff_ai_corrections for all to authenticated
  using (public.takeoff_team(ops_company_id)) with check (public.takeoff_team(ops_company_id));

-- ---------- Every AI call (to review bad reads and turn them into better rules) ------------------
create table if not exists public.takeoff_ai_calls (
  id              uuid primary key default gen_random_uuid(),
  takeoff_id      uuid references public.takeoffs(id) on delete set null,
  sheet_id        uuid,
  sheet_name      text,
  kind            text not null,                -- read | correct | reconcile
  model           text,
  ok              boolean not null default true,
  error           text,
  input_tokens    int,
  output_tokens   int,
  cost_cents      numeric(10,3),
  ms              int,
  rules           int,                          -- how many rules were in the prompt
  result          jsonb,
  ops_company_id  uuid references public.companies(id) on delete cascade,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists takeoff_ai_calls_idx on public.takeoff_ai_calls(ops_company_id, created_at desc);
alter table public.takeoff_ai_calls enable row level security;
drop policy if exists takeoff_ai_calls_team on public.takeoff_ai_calls;
create policy takeoff_ai_calls_team on public.takeoff_ai_calls for all to authenticated
  using (public.takeoff_team(ops_company_id)) with check (public.takeoff_team(ops_company_id));

-- The rules for one takeoff's prompts: AMBIT's, plus the contractor's own on their takeoffs; every
-- builder's, plus the ones for this takeoff's builder. Oldest first.
create or replace function public.takeoff_rules_for(p_takeoff uuid, p_kind text default 'plans')
returns table (id uuid, text text, builder text, mine boolean)
language sql stable security definer set search_path = public as $$
  with t as (
    select x.ops_company_id, lower(trim(coalesce(x.builder, ''))) as b
      from public.takeoffs x
     where x.id = p_takeoff and public.takeoff_team(x.ops_company_id)
  )
  select r.id, r.text, r.builder, r.ops_company_id is not null
    from public.takeoff_ai_rules r, t
   where r.active and r.kind = coalesce(p_kind, 'plans')
     and (r.ops_company_id is null or r.ops_company_id = t.ops_company_id)
     and (r.builder is null or trim(r.builder) = '' or lower(trim(r.builder)) = t.b)
   order by r.ops_company_id nulls first, r.created_at, r.id
$$;

revoke all on function public.takeoff_team(uuid) from public, anon;
revoke all on function public.takeoff_rules_for(uuid, text) from public, anon;
grant execute on function public.takeoff_team(uuid) to authenticated;
grant execute on function public.takeoff_rules_for(uuid, text) to authenticated;
grant select, insert, update, delete on public.takeoff_components, public.takeoff_ai_rules, public.takeoff_ai_corrections to authenticated;
grant select, insert on public.takeoff_ai_calls to authenticated;

select 'Update 0053 done: takeoff AI rules, corrections, call log, windows and doors, templates.' as status;

-- =====================================================================
-- AMBIT Intelligence update 0054 - Academy lessons with graded quizzes
-- * A course holds numbered lessons. A lesson has a video (private "academy" bucket), a short summary,
--   a graded multiple-choice quiz and a pass mark (80 percent unless changed).
-- * Students never see the right answers before they answer: the answer and explanation columns can't
--   be read; academy_submit() grades on the server, saves the attempt and only then sends the answers back.
-- * Admins build lessons in Admin > Academy and see everyone's results there.
-- * Seeds lesson 1 "What Is Heat?" and lesson 2 "Heat Flow 101" in Building science fundamentals,
--   both as drafts until their videos are uploaded and Jeremiah signs them off.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.academy_lessons (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  number      int not null default 1,
  title       text not null,
  summary     text,
  minutes     int,
  video_path  text,
  status      text not null default 'draft' check (status in ('draft', 'live')),
  pass_pct    int not null default 80 check (pass_pct between 1 and 100),
  discussion  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists academy_lessons_course on public.academy_lessons (course_id, number);

create table if not exists public.academy_questions (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.academy_lessons(id) on delete cascade,
  sort       int not null default 0,
  prompt     text not null,
  choices    text[] not null check (cardinality(choices) between 2 and 6),
  answer     int not null,          -- which choice is right, counted from 0
  explain    text,
  constraint academy_questions_answer check (answer >= 0 and answer < cardinality(choices))
);
create index if not exists academy_questions_lesson on public.academy_questions (lesson_id, sort);

create table if not exists public.academy_attempts (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.academy_lessons(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  answers     jsonb not null default '{}'::jsonb,   -- {question id: choice picked}
  score       int not null,
  total       int not null,
  passed      boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists academy_attempts_user on public.academy_attempts (user_id, lesson_id, created_at desc);
create index if not exists academy_attempts_lesson on public.academy_attempts (lesson_id, created_at desc);

alter table public.academy_lessons   enable row level security;
alter table public.academy_questions enable row level security;
alter table public.academy_attempts  enable row level security;

-- Lessons: live lessons of a course the person may see; admins see drafts too.
drop policy if exists academy_lessons_read  on public.academy_lessons;
drop policy if exists academy_lessons_admin on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to authenticated
  using (public.is_admin() or (status = 'live' and exists (
    select 1 from public.courses c where c.id = course_id and public.can_see(c.audience))));
create policy academy_lessons_admin on public.academy_lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Questions: readable with their lesson, but never the answer or the explanation.
drop policy if exists academy_questions_read  on public.academy_questions;
drop policy if exists academy_questions_admin on public.academy_questions;
create policy academy_questions_read on public.academy_questions for select to authenticated
  using (exists (select 1 from public.academy_lessons l where l.id = lesson_id));
create policy academy_questions_admin on public.academy_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke select on public.academy_questions from anon, authenticated;
grant select (id, lesson_id, sort, prompt, choices) on public.academy_questions to authenticated;

-- Attempts: your own, or everyone's for admins. Saved only by academy_submit().
drop policy if exists academy_attempts_read   on public.academy_attempts;
drop policy if exists academy_attempts_delete on public.academy_attempts;
create policy academy_attempts_read on public.academy_attempts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy academy_attempts_delete on public.academy_attempts for delete to authenticated
  using (public.is_admin());
revoke insert, update on public.academy_attempts from anon, authenticated;

-- The answer key, for the admin lesson editor only.
create or replace function public.academy_answer_key(p_lesson uuid)
returns table (id uuid, answer int, explain text)
language sql stable security definer set search_path = public as $$
  select q.id, q.answer, q.explain from public.academy_questions q
  where q.lesson_id = p_lesson and public.is_admin()
$$;
revoke all on function public.academy_answer_key(uuid) from public, anon;
grant execute on function public.academy_answer_key(uuid) to authenticated;

-- Grade a quiz: p_answers = {"<question id>": <choice picked, from 0>, ...}.
create or replace function public.academy_submit(p_lesson uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lesson  public.academy_lessons;
  v_total   int := 0;
  v_score   int := 0;
  v_results jsonb := '[]'::jsonb;
  v_pick    int;
  v_right   boolean;
  v_passed  boolean;
  q         record;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Sign in first.';
  end if;
  select * into v_lesson from public.academy_lessons l where l.id = p_lesson;
  if not found then raise exception 'That lesson isn''t there any more.'; end if;
  if not public.is_admin() and (v_lesson.status <> 'live' or not exists (
      select 1 from public.courses c where c.id = v_lesson.course_id and public.can_see(c.audience))) then
    raise exception 'That lesson isn''t open yet.';
  end if;
  for q in select * from public.academy_questions where lesson_id = p_lesson order by sort, id loop
    v_total := v_total + 1;
    v_pick := case when jsonb_typeof(p_answers -> q.id::text) = 'number' then (p_answers ->> q.id::text)::int end;
    v_right := coalesce(v_pick = q.answer, false);
    if v_right then v_score := v_score + 1; end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', q.id, 'picked', v_pick, 'answer', q.answer, 'correct', v_right, 'explain', q.explain));
  end loop;
  if v_total = 0 then raise exception 'This lesson has no quiz yet.'; end if;
  v_passed := v_score * 100 >= v_lesson.pass_pct * v_total;
  insert into public.academy_attempts (lesson_id, user_id, answers, score, total, passed)
  values (p_lesson, auth.uid(), coalesce(p_answers, '{}'::jsonb), v_score, v_total, v_passed);
  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_passed,
    'pass_pct', v_lesson.pass_pct, 'results', v_results);
end $$;
revoke all on function public.academy_submit(uuid, jsonb) from public, anon;
grant execute on function public.academy_submit(uuid, jsonb) to authenticated;

-- Lesson videos: private bucket; anyone signed in and active can watch, only admins upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy', 'academy', false, 524288000, array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists academy_files_read   on storage.objects;
drop policy if exists academy_files_insert on storage.objects;
drop policy if exists academy_files_update on storage.objects;
drop policy if exists academy_files_delete on storage.objects;
create policy academy_files_read   on storage.objects for select to authenticated using (bucket_id = 'academy' and public.is_active());
create policy academy_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'academy' and public.is_admin());
create policy academy_files_update on storage.objects for update to authenticated using (bucket_id = 'academy' and public.is_admin());
create policy academy_files_delete on storage.objects for delete to authenticated using (bucket_id = 'academy' and public.is_admin());

-- ---------- The first two lessons (drafts) ----------------------------
do $$
declare
  v_course uuid;
  l1 uuid := 'acade001-0000-4000-8000-000000000001';
  l2 uuid := 'acade002-0000-4000-8000-000000000002';
begin
  select id into v_course from public.courses where title = 'Building science fundamentals' order by sort limit 1;
  if v_course is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Building science fundamentals', 'Heat, air and moisture movement', 6, 45, 1)
    returning id into v_course;
  end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values (l1, v_course, 1, 'What Is Heat?',
    'Molecules are always moving, temperature tells you how fast, and heat is energy moving from hotter to colder. Plus what a BTU is.',
    5, 'Where have you seen something expand or move on a job because it got hot?')
  on conflict (id) do nothing;
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values (l2, v_course, 2, 'Heat Flow 101',
    'The three ways heat moves (conduction, convection and radiation), what R-value measures, and the one equation for heat loss through a wall.',
    8, 'Describe the coldest room you''ve been called about. Which of the three modes was the main culprit, and what told you so?')
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = l1) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (l1, 1, 'Temperature measures:',
      array['How much a material weighs', 'How much moisture it holds', 'How fast its molecules are moving, on average', 'How much air is trapped in it'], 2,
      'Temperature is the average speed of the molecules: faster means hotter.'),
    (l1, 2, 'The molecules in an ice cube are:',
      array['Vibrating in place', 'Completely still', 'Flying around freely like a gas', 'Only moving once it starts to melt'], 0,
      'Molecules are always moving. In a solid they''re packed tight and jiggle in place.'),
    (l1, 3, 'One end of a steel bar is heated. What happens?',
      array['The molecules slow down and the bar shrinks', 'The molecules speed up, push slightly farther apart, and the bar gets a little longer', 'Nothing changes until the steel melts', 'Only the heated end changes; the rest stays the same'], 1,
      'Faster molecules take up a little more room, so materials expand when they heat up.'),
    (l1, 4, 'On its own, heat flows:',
      array['From colder to hotter', 'From hotter to colder', 'Only upward', 'Only through metal'], 1,
      'Heat is energy on the move, and on its own it always flows from hotter to colder.'),
    (l1, 5, 'One BTU is the heat it takes to:',
      array['Boil a gallon of water', 'Heat a room by one degree', 'Melt a pound of ice', 'Warm one pound of water by one degree Fahrenheit'], 3,
      'That''s the definition of a British thermal unit, roughly the heat of one kitchen match.');
  end if;

  if not exists (select 1 from public.academy_questions where lesson_id = l2) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (l2, 1, 'On its own, heat always flows:',
      array['From cold to warm', 'From warm to cold', 'Upward', 'Toward the outside of a building'], 1,
      'Heat moves from warm to cold, always, and never the other way on its own.'),
    (l2, 2, 'You double the temperature difference across a wall and change nothing else. The heat flow through the wall:',
      array['Doubles', 'Halves', 'Stays the same', 'Quadruples'], 0,
      'Heat flow = area x delta T / R, so twice the delta T means twice the heat flow.'),
    (l2, 3, 'A 500-square-foot wall, 40 degrees of temperature difference, R-10. About how many BTUs per hour are leaving?',
      array['200', '2,000', '20,000', '125'], 1,
      '500 x 40 = 20,000, divided by R-10 = 2,000 BTU per hour.'),
    (l2, 4, 'A batt installed with an air gap behind it loses most of its performance to:',
      array['Conduction', 'Convection', 'Radiation', 'Compression'], 1,
      'Air loops through the gap and carries heat around the insulation. R-value only measures conduction.');
  end if;
end $$;

select 'Update 0054 done: Academy lessons with videos and graded quizzes; lessons 1 and 2 added as drafts.' as status;

-- =====================================================================
-- AMBIT Intelligence update 0055 - Moisture lesson 1 "The Dew Point"
-- * Adds lesson 1 of the "Moisture, dew point & substrate prep" course: relative humidity, reading a
--   dew point off the psychrometric chart in three moves, and why vapor has to be stopped before it
--   reaches a cold metal roof (IRC R806.5 item 4 in climate zones 5 to 8).
-- * Graded 5-question quiz, pass mark 80 percent (4 of 5). Added as a draft until the video is uploaded
--   in Admin > Academy and Jeremiah signs it off.
-- Needs update 0054 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
declare
  v_course uuid;
  m1 uuid := 'acade003-0000-4000-8000-000000000003';
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;

  select id into v_course from public.courses where title = 'Moisture, dew point & substrate prep' order by sort limit 1;
  if v_course is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Moisture, dew point & substrate prep', 'Reading conditions before you spray', 4, 30, 3)
    returning id into v_course;
  end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values (m1, v_course, 1, 'The Dew Point',
    'Relative humidity is how full the air is with water vapor, and the dew point is where it''s completely full. Read a dew point off the psychrometric chart in three moves, and see why vapor has to be stopped before it reaches a cold roof.',
    5, 'When was the last time a customer blamed spray foam for high humidity, and what was the dew point that day?')
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = m1) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (m1, 1, 'The dew point is:',
      array['The outdoor temperature at night', 'The temperature at which the air is 100% full of water vapor, so any colder and water condenses', 'The relative humidity at noon', 'The temperature of the ground'], 1,
      'Relative humidity is how full the air is with water vapor. At the dew point it''s completely full.'),
    (m1, 2, 'On a psychrometric chart you''ve found the dry bulb temperature and the relative humidity curve. To read the dew point, you move:',
      array['Straight up', 'Straight right', 'Straight left to the 100% curve', 'Straight down to the bottom'], 2,
      'The 100% curve is the dew point scale, so straight left from your point gives the dew point.'),
    (m1, 3, 'It''s 85°F at 65% relative humidity, and the dew point is about 72°F. Which surface will get wet?',
      array['A wall at 80°F', 'An AC line at 60°F', 'A roof deck at 140°F', 'A window at 75°F'], 1,
      'Only a surface colder than the dew point collects condensation, and 60°F is below 72°F.'),
    (m1, 4, 'Inside it''s 70°F at 40% relative humidity (dew point about 45°F). The metal roof is at 10°F with open cell foam under it and no vapor retarder. What happens?',
      array['Vapor passes through the foam and condenses on the cold metal', 'Nothing, because the foam stops the vapor', 'The metal warms above 45°F', 'It only happens in summer'], 0,
      'Open cell isn''t a vapor retarder, so the vapor reaches the metal, which is far below the dew point.'),
    (m1, 5, 'In climate zones 5 to 8, the IRC says air-impermeable insulation in an unvented attic must:',
      array['Be at least 6 inches thick', 'Be covered with drywall', 'Be a Class II vapor retarder, or have a Class II vapor retarder coating on it', 'Be closed cell only'], 2,
      'IRC R806.5. Open cell meets it with a Class II vapor retarder coating.');
  end if;
end $$;

select 'Update 0055 done: Moisture lesson 1 "The Dew Point" added as a draft with its 5-question quiz.' as status;

-- =====================================================================
-- AMBIT Intelligence update 0056 - Academy lessons in Spanish
-- * A lesson can have a Spanish version: its own title, video, summary and graded quiz, linked to the
--   English lesson (translation_of). Students see an English / Español switch on the lesson, and the app
--   remembers the language each person picks (profiles.academy_lang).
-- * A lesson counts as passed in either language.
-- * Adds the Spanish version of lesson 1, "¿Qué es el calor?", with its 5-question quiz, as a draft until
--   its video is uploaded and the Spanish is approved.
-- Needs update 0054 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;
end $$;

alter table public.academy_lessons add column if not exists lang text not null default 'en';
alter table public.academy_lessons add column if not exists translation_of uuid references public.academy_lessons(id) on delete cascade;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'academy_lessons_lang') then
    alter table public.academy_lessons add constraint academy_lessons_lang check (lang in ('en', 'es'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'academy_lessons_translation') then
    alter table public.academy_lessons add constraint academy_lessons_translation
      check (translation_of is null or (translation_of <> id and lang <> 'en'));
  end if;
end $$;
create unique index if not exists academy_lessons_one_per_lang on public.academy_lessons (translation_of, lang) where translation_of is not null;

-- The language each person wants their lessons in (null = English).
alter table public.profiles add column if not exists academy_lang text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_academy_lang') then
    alter table public.profiles add constraint profiles_academy_lang check (academy_lang is null or academy_lang in ('en', 'es'));
  end if;
end $$;

create or replace function public.academy_set_lang(p_lang text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_lang not in ('en', 'es') then raise exception 'Pick English or Spanish.'; end if;
  update public.profiles set academy_lang = p_lang where id = auth.uid();
end $$;
revoke all on function public.academy_set_lang(text) from public, anon;
grant execute on function public.academy_set_lang(text) to authenticated;

-- ---------- Lesson 1 in Spanish (draft) ----------------------------
do $$
declare
  l1 uuid := 'acade001-0000-4000-8000-000000000001';
  es uuid := 'acade001-e500-4000-8000-000000000001';
begin
  if not exists (select 1 from public.academy_lessons where id = l1) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, '¿Qué es el calor?',
    'Las moléculas siempre se están moviendo, la temperatura te dice qué tan rápido, y el calor es energía que va de lo más caliente a lo más frío. Además, qué es un BTU.',
    4, '¿Dónde has visto algo dilatarse o moverse en una obra porque se calentó?', 'es', l1, l.pass_pct
  from public.academy_lessons l where l.id = l1
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'La temperatura mide:',
      array['Cuánto pesa un material', 'Cuánta humedad contiene', 'Qué tan rápido se mueven sus moléculas, en promedio', 'Cuánto aire tiene atrapado'], 2,
      'La temperatura es la velocidad promedio de las moléculas: más rápido significa más caliente.'),
    (es, 2, 'Las moléculas de un cubo de hielo:',
      array['Vibran en su lugar', 'Están completamente quietas', 'Vuelan libremente como un gas', 'Solo se mueven cuando el hielo empieza a derretirse'], 0,
      'Las moléculas siempre se mueven. En un sólido están muy juntas y vibran en su lugar.'),
    (es, 3, 'Se calienta un extremo de una barra de acero. ¿Qué pasa?',
      array['Las moléculas se frenan y la barra se encoge', 'Las moléculas se aceleran, se separan un poco y la barra se alarga un poquito', 'Nada cambia hasta que el acero se derrite', 'Solo cambia el extremo caliente; el resto queda igual'], 1,
      'Las moléculas más rápidas ocupan un poco más de espacio, por eso los materiales se dilatan al calentarse.'),
    (es, 4, 'Por sí solo, el calor fluye:',
      array['De lo más frío a lo más caliente', 'De lo más caliente a lo más frío', 'Solo hacia arriba', 'Solo a través del metal'], 1,
      'El calor es energía en movimiento y, por sí solo, siempre fluye de lo más caliente a lo más frío.'),
    (es, 5, 'Un BTU es el calor que se necesita para:',
      array['Hervir un galón de agua', 'Calentar un cuarto un grado', 'Derretir una libra de hielo', 'Calentar una libra de agua un grado Fahrenheit'], 3,
      'Esa es la definición de la unidad térmica británica, más o menos el calor de un cerillo de cocina.');
  end if;
end $$;

select 'Update 0056 done: Academy lessons can have a Spanish version; lesson 1 "¿Qué es el calor?" added as a draft.' as status;

-- =====================================================================
-- AMBIT Intelligence update 0057 - Academy segments 1 and 2: ten new lessons
-- * Building science fundamentals, lessons 3 to 8: R-Value & ASTM C518, Weighted R-Value & Assembly
--   Design, Infiltration & Exfiltration, Stack Effect & Neutral Pressure Planes, Climate Zones,
--   Latent Load & Sensible Load.
-- * Moisture, dew point & substrate prep, lessons 2 to 5: Air vs. Moisture vs. Vapor Barriers,
--   Diffusion & ASTM E96, Vapor Drive & Condensation (Cold Climate), Vapor Drive & Condensation (Hot Climate).
-- * Each lesson gets a graded 5-question quiz, pass mark 80 percent (4 of 5). All ten are added as
--   drafts until the videos are uploaded in Admin > Academy and Jeremiah signs them off.
-- Needs updates 0054 and 0055 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
declare
  v_bs uuid;
  v_mo uuid;
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;

  select id into v_bs from public.courses where title = 'Building science fundamentals' order by sort limit 1;
  if v_bs is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Building science fundamentals', 'Heat, air and moisture movement', 8, 45, 1)
    returning id into v_bs;
  end if;
  select id into v_mo from public.courses where title = 'Moisture, dew point & substrate prep' order by sort limit 1;
  if v_mo is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Moisture, dew point & substrate prep', 'Reading conditions before you spray', 5, 30, 3)
    returning id into v_mo;
  end if;
  update public.courses set lessons = greatest(coalesce(lessons, 0), 8) where id = v_bs;
  update public.courses set lessons = greatest(coalesce(lessons, 0), 5) where id = v_mo;


  -- Building science lesson 3: R-Value & ASTM C518
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade103-0000-4000-8000-000000000103', v_bs, 3, 'R-Value & ASTM C518',
    'What an R-value measures, how the ASTM C518 test measures it, and why temperature, moisture and age change it.',
    4, 'Have you seen insulation that didn''t perform like its label? What do you think was going on?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade103-0000-4000-8000-000000000103') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade103-0000-4000-8000-000000000103', 1, 'R-value measures:',
      array['How airtight a material is', 'How much moisture a material blocks', 'Resistance to heat flow by conduction', 'How much heat a material stores'], 2,
      'R-value is resistance to heat flow by conduction. Air leakage and moisture are separate properties.'),
    ('acade103-0000-4000-8000-000000000103', 2, 'Two inches of a material rated R-3.5 per inch gives about:',
      array['R-3.5', 'R-7', 'R-12.25', 'R-1.75'], 1,
      'R-values add: 2 inches × R-3.5 per inch = R-7.'),
    ('acade103-0000-4000-8000-000000000103', 3, 'ASTM C518 measures R-value by:',
      array['Placing the sample between a hot plate and a cold plate and measuring the heat flow through it', 'Blowing air through the sample', 'Soaking the sample in water', 'Burning the sample'], 0,
      'C518 is the heat flow meter test: hot plate, cold plate, and sensors that measure heat passing through.'),
    ('acade103-0000-4000-8000-000000000103', 4, 'Closed cell foam is sold on an "aged" R-value because:',
      array['It gets thicker over time', 'It absorbs heat as it ages', 'The code requires all products to be tested after ten years', 'The blowing agent in its cells slowly trades places with air, so R-value drops a little and then levels off'], 3,
      'Blowing agent slowly diffuses out and air diffuses in, so R-value settles to a lower, stable aged value.'),
    ('acade103-0000-4000-8000-000000000103', 5, 'Which of these does an R-value NOT account for?',
      array['The material''s thickness', 'Air leaking through and around the insulation', 'Conduction through the material', 'The type of material'], 1,
      'R-value describes conduction only. Air leaks and framing are why real walls differ from the label.');
  end if;

  -- Building science lesson 4: Weighted R-Value & Assembly Design
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade104-0000-4000-8000-000000000104', v_bs, 4, 'Weighted R-Value & Assembly Design',
    'How layers add in series, how framing creates a parallel path, and how to work out the real R-value of a whole wall.',
    4, 'Think of a wall you insulated recently. What was bridging the insulation, and how could the assembly have been designed better?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade104-0000-4000-8000-000000000104') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade104-0000-4000-8000-000000000104', 1, 'Heat moving straight through the layers of a wall (drywall, insulation, sheathing) meets resistances that:',
      array['Add together', 'Multiply', 'Average out', 'Only the biggest one counts'], 0,
      'Layers in series add their R-values.'),
    ('acade104-0000-4000-8000-000000000104', 2, 'Why is a wall with R-13 batts less than R-13 overall?',
      array['The drywall cancels part of the batt', 'Batts lose half their R-value in a wall', 'Wood framing conducts heat more easily than the insulation, creating paths around it', 'Air films subtract R-value'], 2,
      'Studs, plates and headers are a thermal bridge: a shortcut for heat around the insulation.'),
    ('acade104-0000-4000-8000-000000000104', 3, 'To combine the cavity path and the stud path, you:',
      array['Average the R-values', 'Average the U-factors weighted by area, then take one over the result', 'Add the R-values', 'Use the higher R-value'], 1,
      'The paths are in parallel, so you area-weight the U-factors and flip back to R.'),
    ('acade104-0000-4000-8000-000000000104', 4, 'In a typical 2x4 wood-framed wall, framing covers about:',
      array['5% of the wall', '25% of the wall', '50% of the wall', '75% of the wall'], 1,
      'About a quarter of a typical wood-framed wall is framing.'),
    ('acade104-0000-4000-8000-000000000104', 5, 'One inch of R-5 continuous insulation over the outside of the studs:',
      array['Only helps the cavity path', 'Lowers the wall''s R-value', 'Does nothing for a framed wall', 'Adds its R-value to both the cavity path and the stud path'], 3,
      'Because it runs over the studs, it adds to both paths, so the whole wall gains nearly R-6.');
  end if;

  -- Building science lesson 5: Infiltration & Exfiltration
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade105-0000-4000-8000-000000000105', v_bs, 5, 'Infiltration & Exfiltration',
    'What infiltration and exfiltration are, what drives air through a building, what that air carries, and how a blower door measures it.',
    4, 'What''s the leakiest spot you''ve found in a house, and how did you seal it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade105-0000-4000-8000-000000000105') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade105-0000-4000-8000-000000000105', 1, 'Exfiltration is:',
      array['Outside air leaking in', 'Air moved by a ventilation fan', 'Inside air leaking out', 'Heat moving through a wall'], 2,
      'Exfiltration is inside air leaking out; infiltration is outside air leaking in.'),
    ('acade105-0000-4000-8000-000000000105', 2, 'Air leaks through a hole in the building only when:',
      array['There''s a pressure difference across the hole', 'The insulation is wet', 'It''s colder outside', 'The HVAC is off'], 0,
      'No pressure difference, no airflow. Wind, the stack effect and fans create it.'),
    ('acade105-0000-4000-8000-000000000105', 3, 'Which of these does NOT drive air leakage?',
      array['Wind', 'The stack effect', 'Exhaust fans and dryers', 'The R-value of the insulation'], 3,
      'R-value is about conduction. The drivers are wind, stack effect and mechanical systems.'),
    ('acade105-0000-4000-8000-000000000105', 4, 'Fiberglass batts in a wall cavity:',
      array['Stop all air leakage', 'Slow conduction, but air passes right through them', 'Are a Class I vapor retarder', 'Make the wall airtight if they''re compressed'], 1,
      'Fibrous insulation isn''t an air barrier. Air sealing takes a continuous air barrier.'),
    ('acade105-0000-4000-8000-000000000105', 5, 'Under the IRC, a new home in climate zone 3 must test at or below:',
      array['3 ACH50', '5 ACH50', '7 ACH50', '10 ACH50'], 0,
      'The IRC limit is 3 ACH50 in climate zones 3 through 8, and 5 ACH50 in the hottest zones.');
  end if;

  -- Building science lesson 6: Stack Effect & Neutral Pressure Planes
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade106-0000-4000-8000-000000000106', v_bs, 6, 'Stack Effect & Neutral Pressure Planes',
    'How warm air rising drives air leakage, where the neutral pressure plane sits and why it moves, and which leaks to seal first.',
    4, 'Where have you seen the stack effect on a job: frost in the attic, stains, or a hot upstairs?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade106-0000-4000-8000-000000000106') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade106-0000-4000-8000-000000000106', 1, 'In winter, the stack effect pushes air:',
      array['Out near the top of the house and in near the bottom', 'In near the top and out near the bottom', 'Only through windows', 'Only when the wind blows'], 0,
      'Warm air rises, pushes out up high, and pulls cold air in down low.'),
    ('acade106-0000-4000-8000-000000000106', 2, 'The neutral pressure plane is:',
      array['The attic floor', 'The ground level of the house', 'The height where inside and outside air pressures are equal', 'Where the thermostat is mounted'], 2,
      'Above it the house pushes out; below it the house pulls in.'),
    ('acade106-0000-4000-8000-000000000106', 3, 'The stack effect gets stronger when:',
      array['The insulation is thicker', 'The building is taller or the temperature difference is larger', 'The house is painted a darker color', 'It rains'], 1,
      'Stack pressure grows with height above or below the neutral plane and with the temperature difference.'),
    ('acade106-0000-4000-8000-000000000106', 4, 'If most of a home''s leaks are up high in the attic floor, the neutral pressure plane:',
      array['Moves down', 'Stays exactly halfway up', 'Disappears', 'Moves up toward the leaks'], 3,
      'The neutral plane moves toward the biggest leaks, so more of the house pulls in outside air.'),
    ('acade106-0000-4000-8000-000000000106', 5, 'In summer with the air conditioning running, the stack effect:',
      array['Gets much stronger than in winter', 'Stops completely', 'Reverses: cool air leaks out low and hot air is pulled in high', 'Only affects the basement'], 2,
      'It flips, and it''s weaker because the temperature difference is smaller.');
  end if;

  -- Building science lesson 7: Climate Zones (Thermal & Moisture)
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade107-0000-4000-8000-000000000107', v_bs, 7, 'Climate Zones (Thermal & Moisture)',
    'How climate zone numbers and letters work, what the zone controls in the code, and where to look yours up.',
    4, 'What climate zone do you work in most, and what changes in your recommendations when you cross into the next one?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade107-0000-4000-8000-000000000107') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade107-0000-4000-8000-000000000107', 1, 'A climate zone''s number mainly tells you:',
      array['How hot or cold the climate is', 'How much it rains', 'The local code edition', 'The soil type'], 0,
      'The numbers run from hot to cold, based on yearly heating and cooling needs.'),
    ('acade107-0000-4000-8000-000000000107', 2, 'The letter after the number (A, B or C) stands for:',
      array['Altitude, Building type, Coast', 'Attic, Basement, Crawlspace', 'Air, Barrier, Ceiling', 'Moist, Dry, Marine'], 3,
      'A is moist, B is dry, C is marine.'),
    ('acade107-0000-4000-8000-000000000107', 3, 'Oklahoma City is in climate zone:',
      array['1A', '3A', '5B', '7'], 1,
      'Oklahoma County is zone 3A.'),
    ('acade107-0000-4000-8000-000000000107', 4, 'Under the IRC, frame walls need a Class I or II vapor retarder on the interior side in:',
      array['Zones 1–3', 'Zones 5–8 and Marine 4', 'All zones', 'Only zone 8'], 1,
      'IRC R702.7: zones 5, 6, 7, 8 and Marine 4, unless the wall meets one of the code''s alternatives.'),
    ('acade107-0000-4000-8000-000000000107', 5, 'Where do you look up a county''s climate zone?',
      array['IRC Table N1101.7 (IECC Table R301.1)', 'The AC data plate', 'ASTM C518', 'The foam''s data sheet'], 0,
      'IRC Table N1101.7 and IECC Table R301.1 list every county''s zone.');
  end if;

  -- Building science lesson 8: Latent Load & Sensible Load
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade108-0000-4000-8000-000000000108', v_bs, 8, 'Latent Load & Sensible Load',
    'The difference between sensible and latent load, why foamed homes can get clammy, and how to match the HVAC system to the house.',
    4, 'Have you had a humidity call after a foam job? What size was the AC, and what fixed it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade108-0000-4000-8000-000000000108') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade108-0000-4000-8000-000000000108', 1, 'Sensible heat is heat that:',
      array['Is hidden in water vapor', 'Only comes from people', 'Changes the air''s temperature and shows on a thermometer', 'Can''t be removed by an AC'], 2,
      'Sensible heat changes temperature. Latent heat is the energy in water vapor.'),
    ('acade108-0000-4000-8000-000000000108', 2, 'Latent heat is:',
      array['Heat from the sun', 'The heat tied up in water vapor; removing it dries the air without changing its temperature', 'Heat that moves through walls', 'Heat from lights'], 1,
      'Removing latent heat means condensing water out of the air.'),
    ('acade108-0000-4000-8000-000000000108', 3, 'Condensing one pound of water out of the air removes about:',
      array['1 BTU', '100 BTU', '1,060 BTU', '10,000 BTU'], 2,
      'The latent heat of water is a little over 1,000 BTU per pound.'),
    ('acade108-0000-4000-8000-000000000108', 4, 'After a house is foamed, the AC short-cycles and humidity rises. The most likely reason is:',
      array['The foam is releasing moisture', 'The thermostat is broken', 'The latent load disappeared', 'The sensible load dropped, so the AC satisfies the thermostat before removing enough water'], 3,
      'Foam cuts the sensible load; the latent load stays, so an oversized AC runs too briefly to dehumidify.'),
    ('acade108-0000-4000-8000-000000000108', 5, 'Which is used to size cooling equipment to the house''s loads?',
      array['ASTM C518', 'IRC R806.5', 'ACCA Manual J and Manual S', 'ASTM E96'], 2,
      'Manual J calculates the loads; Manual S selects equipment to match them.');
  end if;

  -- Moisture lesson 2: Air vs. Moisture vs. Vapor Barriers
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade202-0000-4000-8000-000000000202', v_mo, 2, 'Air vs. Moisture vs. Vapor Barriers',
    'What water-resistive barriers, air barriers and vapor retarders each do, the three vapor retarder classes, and which jobs open and closed cell foam do.',
    4, 'Where have you seen a wall fail because the wrong barrier was used, or one was missing?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade202-0000-4000-8000-000000000202') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade202-0000-4000-8000-000000000202', 1, 'House wrap behind siding is mainly a:',
      array['Water-resistive barrier that sheds liquid water but lets vapor through', 'Class I vapor retarder', 'Thermal insulation', 'Radiant barrier'], 0,
      'A water-resistive barrier stops rain but is usually vapor-open so the wall can dry.'),
    ('acade202-0000-4000-8000-000000000202', 2, 'To work, an air barrier must be:',
      array['At least 6 mil thick', 'Painted', 'Installed only in the attic', 'Continuous around the whole building, sealed at every joint and hole'], 3,
      'One unsealed gap and the air finds it.'),
    ('acade202-0000-4000-8000-000000000202', 3, 'Under the IRC, a Class II vapor retarder is rated at:',
      array['0.1 perm or less', 'More than 0.1 up to 1.0 perm', 'More than 1 up to 10 perms', 'More than 10 perms'], 1,
      'Class I ≤ 0.1, Class II > 0.1 to 1.0, Class III > 1.0 to 10 perms.'),
    ('acade202-0000-4000-8000-000000000202', 4, 'Kraft-faced batts are an example of a:',
      array['Class I vapor retarder', 'Class II vapor retarder', 'Class III vapor retarder', 'Water-resistive barrier'], 1,
      'The IRC lists kraft-faced fiberglass batts as Class II.'),
    ('acade202-0000-4000-8000-000000000202', 5, 'Open cell foam at full thickness is:',
      array['An air barrier and a Class I vapor retarder', 'An air barrier, but vapor moves through it', 'Neither an air barrier nor a vapor retarder', 'A water-resistive barrier'], 1,
      'Open cell stops air but is vapor-open; closed cell at about 2 inches usually reaches Class II.');
  end if;

  -- Moisture lesson 3: Diffusion & ASTM E96
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade203-0000-4000-8000-000000000203', v_mo, 3, 'Diffusion & ASTM E96',
    'How vapor diffuses through materials, what a perm measures, how the ASTM E96 cup test works, and why thickness matters.',
    4, 'Pick a foam you spray: what are its perms at your usual thickness, and what vapor retarder class does that make it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade203-0000-4000-8000-000000000203') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade203-0000-4000-8000-000000000203', 1, 'Vapor diffusion moves water vapor:',
      array['Through solid materials, from higher vapor pressure to lower', 'Only through holes and cracks', 'Only upward', 'Only when it rains'], 0,
      'Diffusion goes straight through materials, from more vapor to less.'),
    ('acade203-0000-4000-8000-000000000203', 2, 'A lower perm rating means the material:',
      array['Lets more vapor through', 'Has a higher R-value', 'Blocks vapor better', 'Is a better air barrier'], 2,
      'Lower perms, tighter to vapor.'),
    ('acade203-0000-4000-8000-000000000203', 3, 'ASTM E96 measures perms by:',
      array['Heating one side of the sample', 'Sealing a sample over a cup and weighing how much vapor passes through over time', 'Pressurizing a house', 'Soaking the sample in water'], 1,
      'The cup holds a desiccant (dry cup) or water (wet cup); the weight change shows the vapor that moved.'),
    ('acade203-0000-4000-8000-000000000203', 4, 'If you double the thickness of a uniform material, its perm rating:',
      array['Doubles', 'Stays the same', 'Drops to zero', 'Roughly halves'], 3,
      'Permeance is inversely proportional to thickness.'),
    ('acade203-0000-4000-8000-000000000203', 5, 'The IRC''s vapor retarder classes are based on which ASTM E96 method?',
      array['Either one', 'The wet cup (water) method', 'The dry cup (desiccant) method', 'Neither; they use ASTM C518'], 2,
      'The classes are based on the dry cup method.');
  end if;

  -- Moisture lesson 4: Vapor Drive & Condensation (Cold Climate)
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade204-0000-4000-8000-000000000204', v_mo, 4, 'Vapor Drive & Condensation (Cold Climate)',
    'Why vapor drives outward in winter, where it condenses in walls and roofs, and the three ways to prevent it.',
    4, 'In your area, what''s the coldest surface in a typical wall in January, and what keeps moisture off it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade204-0000-4000-8000-000000000204') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade204-0000-4000-8000-000000000204', 1, 'In a cold-climate winter, vapor drives:',
      array['From inside to outside', 'From outside to inside', 'Only downward', 'Nowhere; cold air holds no vapor'], 0,
      'Warm indoor air holds more vapor, so vapor pressure is higher inside.'),
    ('acade204-0000-4000-8000-000000000204', 2, 'Indoor air at 70°F and 35% relative humidity has a dew point of about:',
      array['20°F', '41°F', '55°F', '70°F'], 1,
      '70°F at 35% RH has a dew point of about 41°F.'),
    ('acade204-0000-4000-8000-000000000204', 3, 'In a cold-climate wall, condensation usually forms first on:',
      array['The back of the drywall', 'The siding', 'The face of the insulation', 'The back of the exterior sheathing'], 3,
      'It''s the first surface the vapor reaches that''s below the indoor dew point.'),
    ('acade204-0000-4000-8000-000000000204', 4, 'Most of the moisture that reaches a cold wall cavity arrives by:',
      array['Diffusion through drywall', 'Air leakage', 'Rain', 'The air conditioner'], 1,
      'Air leaks carry far more moisture than diffusion, so air seal first.'),
    ('acade204-0000-4000-8000-000000000204', 5, 'Closed cell foam sprayed against the sheathing helps because it:',
      array['Keeps the sheathing warmer and slows the vapor', 'Makes the wall vapor-open', 'Adds moisture to the wall', 'Only works in summer'], 0,
      'It warms the condensing surface and acts as a vapor retarder.');
  end if;

  -- Moisture lesson 5: Vapor Drive & Condensation (Hot Climate)
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade205-0000-4000-8000-000000000205', v_mo, 5, 'Vapor Drive & Condensation (Hot Climate)',
    'Why vapor drives inward in hot, humid weather, where summer condensation forms, and how foam and HVAC choices prevent it.',
    4, 'Have you seen sweating ducts, or mold behind vinyl wallpaper? What fixed it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade205-0000-4000-8000-000000000205') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade205-0000-4000-8000-000000000205', 1, 'In a hot, humid summer with the AC running, vapor drives:',
      array['From inside to outside', 'Only upward', 'From outside to inside', 'Nowhere'], 2,
      'The hot, humid outdoor air holds more vapor than the cooled indoor air.'),
    ('acade205-0000-4000-8000-000000000205', 2, 'Outdoor air at 90°F and 60% relative humidity has a dew point of about:',
      array['55°F', '60°F', '74°F', '90°F'], 2,
      '90°F at 60% RH has a dew point of about 74°F.'),
    ('acade205-0000-4000-8000-000000000205', 3, 'Why is vinyl wallpaper on an air-conditioned exterior wall a problem in hot, humid climates?',
      array['It adds R-value', 'It traps inward-moving vapor against the cool wall, where it can condense and grow mold', 'It lets the wall dry too fast', 'It stops the AC from working'], 1,
      'A low-perm interior layer traps the vapor on the cold side.'),
    ('acade205-0000-4000-8000-000000000205', 4, 'A duct carrying 55°F air through a vented attic full of air with a 74°F dew point will:',
      array['Stay dry', 'Freeze', 'Heat up the attic', 'Sweat'], 3,
      'Any surface below the dew point collects condensation.'),
    ('acade205-0000-4000-8000-000000000205', 5, 'Under the IRC, interior vapor retarders on frame walls are required in:',
      array['All climate zones', 'Zones 1–3', 'Zones 5–8 and Marine 4 only', 'Only warm-humid areas'], 2,
      'They''re required only in the cold zones; in warm-humid areas they should be avoided.');
  end if;
end $$;

select 'Update 0057 done: ten Academy lessons (Building science 3 to 8, Moisture 2 to 5) added as drafts with their quizzes.' as status;


-- =====================================================================
-- AMBIT Intelligence update 0058 - Academy: a light version of each lesson video
-- * A lesson can have a second video made for Light mode (white background). People who use the app
--   in Light mode (Profile > Appearance > Light, or Auto when their phone or computer is set to light)
--   see the light video; everyone else sees the main (dark) one. A lesson with no light video shows
--   its main video to everyone, as before.
-- * Admins upload it on the lesson's page, under "Light-mode video". Spanish versions can have one too.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.academy_lessons add column if not exists video_path_light text;

comment on column public.academy_lessons.video_path_light is
  'Optional light-mode copy of the lesson video (path in the private "academy" bucket). Shown to people using the app in Light mode.';

select 'Update 0058 done: Academy lessons can have a light-mode video.' as status;
