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
