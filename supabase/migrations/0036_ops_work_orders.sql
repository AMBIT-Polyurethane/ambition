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
