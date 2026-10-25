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
