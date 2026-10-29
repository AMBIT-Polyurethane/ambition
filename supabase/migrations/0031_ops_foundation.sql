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
