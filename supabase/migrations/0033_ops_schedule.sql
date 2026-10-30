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
