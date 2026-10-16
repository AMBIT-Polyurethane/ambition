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
