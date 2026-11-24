-- 0108: Unofficial estimates.
--  * A sales rep builds an estimate for a customer: items and quantities only. Prices come from the customer's
--    price list (their own prices, else the base prices) and can't be changed on the estimate.
--  * Delivered estimates go to the CRMs, who add the quoted freight. The sales tax comes from the tax rate table
--    (the AMBIT location for pickups, the ZIP or state for deliveries); a customer with a current exemption pays none.
--  * Once it has freight and tax, the rep or a CRM emails it to the customer as an "Unofficial estimate" PDF.
--  * Converting it starts an order with the same customer, delivery and items, at that day's prices.
--  * New permissions: Estimates (build and send them; sales reps and CRMs) and Estimates: add freight (CRMs).
-- Run AFTER 0106. Safe to run again.

-- ---------------------------------------------------------------- permissions
create or replace function public.all_perms() returns text[]
language sql immutable as $fn$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports', 'add_customers', 'prices', 'estimates', 'estimate_freight']
$fn$;
update public.profiles set perms = array_append(perms, 'estimates')
 where role = 'employee' and job_role in ('sales_rep', 'crm') and perms is not null and not ('estimates' = any(perms));
update public.profiles set perms = array_append(perms, 'estimate_freight')
 where role = 'employee' and job_role = 'crm' and perms is not null and not ('estimate_freight' = any(perms));

create or replace function public.can_estimate() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.has_perm('estimates') or public.has_perm('estimate_freight')
$fn$;
create or replace function public.can_estimate_freight() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.has_perm('estimate_freight')
$fn$;

-- Base prices per sq ft need 6 decimals to land on the exact bag price (60.84 / 240.25 sq ft).
alter table public.base_prices alter column price type numeric(12,6);

-- ---------------------------------------------------------------- sales tax rates
-- kind 'branch': an AMBIT location (pickups); 'zip': a 5-digit ZIP; 'state': a state, for any ZIP without its own rate.
create table if not exists public.tax_rates (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('branch', 'zip', 'state')),
  key             text not null,
  rate            numeric(6,4) not null check (rate >= 0 and rate < 30),
  tax_freight     boolean not null default true,
  label           text,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  unique (kind, key)
);
alter table public.tax_rates enable row level security;
drop policy if exists tax_rates_read on public.tax_rates;
create policy tax_rates_read on public.tax_rates for select to authenticated using (public.is_employee());

-- Accounting (and admins) keep the rates. p: {"kind","key","rate" (blank removes it),"tax_freight","label"}
create or replace function public.tax_rate_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $fn$
declare k text := p->>'kind'; ky text := upper(trim(coalesce(p->>'key', ''))); r numeric;
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only Accounting and admins change tax rates.'; end if;
  if k not in ('branch', 'zip', 'state') then raise exception 'Pick a location, a ZIP or a state.'; end if;
  if k = 'branch' then ky := lower(ky); end if;
  if k = 'zip' and ky !~ '^\d{5}$' then raise exception 'A ZIP is 5 digits.'; end if;
  if k = 'state' and ky !~ '^[A-Z]{2}$' then raise exception 'A state is 2 letters, like TX.'; end if;
  if coalesce(p->>'rate', '') = '' then
    delete from public.tax_rates where kind = k and key = ky;
    return;
  end if;
  begin
    r := round((p->>'rate')::numeric, 4);
  exception when others then
    raise exception 'Type the rate as a percent, like 8.25.';
  end;
  if r < 0 or r >= 30 then raise exception 'A tax rate of % percent looks wrong.', r; end if;
  insert into public.tax_rates (kind, key, rate, tax_freight, label, updated_by_name, updated_at)
  values (k, ky, r, coalesce((p->>'tax_freight')::boolean, true), nullif(left(trim(coalesce(p->>'label', '')), 80), ''), public.my_name(), now())
  on conflict (kind, key) do update set rate = excluded.rate, tax_freight = excluded.tax_freight, label = excluded.label,
    updated_by_name = excluded.updated_by_name, updated_at = now();
end $fn$;
revoke all on function public.tax_rate_save(jsonb) from public, anon;
grant execute on function public.tax_rate_save(jsonb) to authenticated;

-- The rate for a pickup at an AMBIT location, or a delivery to a ZIP / state.
create or replace function public.tax_rate_for(p_delivery text, p_branch text, p_state text, p_zip text)
returns table (rate numeric, tax_freight boolean, source text)
language sql stable security definer set search_path = public as $fn$
  select t.rate, t.tax_freight,
         case t.kind when 'branch' then 'Pickup at ' || coalesce((select b.name from public.branches b where b.id = t.key), upper(t.key))
                     when 'zip' then 'ZIP ' || t.key else 'State of ' || t.key end || coalesce(' (' || t.label || ')', '')
    from public.tax_rates t
   where (p_delivery = 'pickup' and t.kind = 'branch' and t.key = lower(coalesce(p_branch, '')))
      or (p_delivery <> 'pickup' and t.kind = 'zip' and t.key = left(coalesce(p_zip, ''), 5))
      or (p_delivery <> 'pickup' and t.kind = 'state' and t.key = upper(coalesce(p_state, '')))
   order by case t.kind when 'branch' then 1 when 'zip' then 2 else 3 end
   limit 1
$fn$;

-- ---------------------------------------------------------------- pricing a list of items (an estimate)
-- p_lines: [{"product_id", "qty"}] in order. The same rules as orders (0106): the customer's own price, else the base
-- price (an item priced each with no customer price: its list price, or its sale price while on sale); foam resin
-- at $/lb x the drum's lbs; ISO at the $/lb of the resin each drum goes with x 500 lb.
create or replace function public.price_lines(p_company uuid, p_lines jsonb, p_on date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  ln     jsonb;
  pr     record;
  p      public.products;
  u      numeric;
  q      numeric;
  out    jsonb := '[]'::jsonb;
  resins jsonb := '[]'::jsonb;
  i      int := 0;
  rs     jsonb;
  left_q numeric;
  take   numeric;
  parts  jsonb;
  tot    numeric;
  first_lb numeric;
  own_lb numeric;
  iso_lbs numeric;
  p0     numeric;
  same   boolean;
  day    date := coalesce(p_on, (now() at time zone 'America/Chicago')::date);
begin
  -- A customer's prices: staff who build estimates or keep prices only.
  if not (public.can_estimate() or public.can_price()) then raise exception 'You don''t have access to customer prices.'; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into p from public.products where id = (ln->>'product_id')::uuid;
    if p.id is null then continue; end if;
    q := coalesce((ln->>'qty')::numeric, 0);
    if q <= 0 then continue; end if;
    select * into pr from public.price_for(p_company, p.id, day);
    u := null;
    if pr.price is not null then
      if pr.source = 'base' and pr.basis = 'unit' then
        u := case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end;
      else
        u := public.price_per_unit(pr.price, pr.basis, p.id);
      end if;
    end if;
    if p.category_id = 'ambit-foam' and p.unit ~* '^drums?$' and p.sku !~* '^ISO' then
      resins := resins || jsonb_build_object('i', i, 'qty', q, 'lb', case when pr.basis = 'lb' then pr.price end);
    end if;
    out := out || jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'qty', q,
      'iso', p.category_id = 'ambit-foam' and p.unit ~* '^drums?$' and p.sku ~* '^ISO',
      'unit_price', u, 'line_total', case when u is null then null else round(u * q, 2) end,
      'basis', pr.basis, 'per', pr.price, 'source', pr.source, 'price_parts', null);
    i := i + 1;
  end loop;

  -- ISO lines, paired with the resins in order.
  for i in 0 .. jsonb_array_length(out) - 1 loop
    continue when not (out->i->>'iso')::boolean;
    iso_lbs := coalesce(public.price_lbs((out->i->>'product_id')::uuid), 500);
    own_lb := case when out->i->>'source' = 'customer' and out->i->>'basis' = 'lb' then (out->i->>'per')::numeric end;
    first_lb := (select (r->>'lb')::numeric from jsonb_array_elements(resins) r where r->>'lb' is not null limit 1);
    left_q := (out->i->>'qty')::numeric; parts := '[]'::jsonb; tot := 0;
    for rs in select * from jsonb_array_elements(resins) loop
      exit when left_q <= 0;
      take := least(left_q, (rs->>'qty')::numeric);
      continue when take <= 0;
      if rs->>'lb' is null then parts := null; exit; end if;
      parts := parts || jsonb_build_object('with', (rs->>'i')::int, 'qty', take, 'price', round((rs->>'lb')::numeric * iso_lbs, 2));
      tot := tot + round((rs->>'lb')::numeric * iso_lbs, 2) * take;
      resins := (select jsonb_agg(case when (r->>'i') = (rs->>'i') then jsonb_set(r, '{qty}', to_jsonb((r->>'qty')::numeric - take)) else r end) from jsonb_array_elements(resins) r);
      left_q := left_q - take;
    end loop;
    -- (a resin with no $/lb, or extra ISO with nothing to price it by: the ISO keeps its own price list price)
    continue when parts is null;
    if left_q > 0 then
      continue when coalesce(own_lb, first_lb) is null;
      parts := parts || jsonb_build_object('with', null, 'qty', left_q, 'price', round(coalesce(own_lb, first_lb) * iso_lbs, 2));
      tot := tot + round(coalesce(own_lb, first_lb) * iso_lbs, 2) * left_q;
    end if;
    continue when jsonb_array_length(parts) = 0;
    p0 := (parts->0->>'price')::numeric;
    same := not exists (select 1 from jsonb_array_elements(parts) x where (x->>'price')::numeric <> p0);
    out := jsonb_set(out, array[i::text], (out->i) || jsonb_build_object(
      'unit_price', case when same then p0 else round(tot / (out->i->>'qty')::numeric, 2) end,
      'line_total', round(tot, 2),
      'price_parts', case when same then null else parts end,
      'source', 'customer'));
  end loop;
  return out;
end $fn$;
revoke all on function public.price_lines(uuid, jsonb, date) from public, anon;
grant execute on function public.price_lines(uuid, jsonb, date) to authenticated;

-- ---------------------------------------------------------------- estimates
create table if not exists public.estimates (
  id                uuid primary key default gen_random_uuid(),
  est_no            bigint generated always as identity (start with 1001),
  company_id        uuid not null references public.companies(id) on delete cascade,
  company_name      text not null,
  status            text not null default 'draft' check (status in ('draft', 'needs_freight', 'ready', 'sent', 'converted', 'cancelled')),
  created_by        uuid,
  created_by_name   text,
  created_by_email  text,
  delivery_method   text not null default 'pickup' check (delivery_method in ('pickup', 'jobsite')),
  branch_id         text references public.branches(id) on update cascade on delete set null,
  ship_address      text,
  ship_state        text,
  ship_zip          text,
  customer_note     text,
  staff_note        text,
  priced_on         date,
  subtotal          numeric(12,2) not null default 0,
  has_unpriced      boolean not null default false,
  freight           numeric(12,2),
  freight_note      text,
  freight_by_name   text,
  freight_at        timestamptz,
  tax_rate          numeric(6,4),
  tax_rate_manual   boolean not null default false,
  tax_freight       boolean not null default true,
  tax_source        text,
  tax_exempt        boolean not null default false,
  tax               numeric(12,2),
  total             numeric(12,2),
  valid_until       date,
  sent_at           timestamptz,
  sent_to           text,
  sent_by_name      text,
  order_id          uuid references public.orders(id) on delete set null,
  converted_at      timestamptz,
  converted_by_name text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists estimates_status on public.estimates(status, created_at desc);
create index if not exists estimates_company on public.estimates(company_id, created_at desc);
create table if not exists public.estimate_items (
  id          bigint generated always as identity primary key,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  sort        int not null default 0,
  product_id  uuid references public.products(id) on delete set null,
  sku         text not null,
  name        text not null,
  unit        text not null default 'each',
  qty         numeric(12,2) not null check (qty > 0),
  unit_price  numeric(12,2),
  line_total  numeric(12,2),
  price_parts jsonb,
  basis       text,
  per_price   numeric(12,4),
  price_source text
);
create index if not exists estimate_items_est on public.estimate_items(estimate_id, sort);
alter table public.estimates enable row level security;
alter table public.estimate_items enable row level security;
drop policy if exists estimates_read on public.estimates;
drop policy if exists estimate_items_read on public.estimate_items;
create policy estimates_read on public.estimates for select to authenticated using (public.can_estimate() or public.is_admin() or public.has_perm('order_desk'));
create policy estimate_items_read on public.estimate_items for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = estimate_items.estimate_id));

alter table public.order_drafts add column if not exists estimate_id uuid references public.estimates(id) on delete set null;

-- Today's prices, tax and total. Keeps the freight; looks the tax rate up again unless a CRM typed one.
create or replace function public.estimate_recalc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  e   public.estimates;
  lines jsonb;
  ln  jsonb;
  k   int := 0;
  t   record;
  ex  text;
  sub numeric;
  base numeric;
  ids bigint[];
begin
  select * into e from public.estimates where id = p_id;
  if e.id is null then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty) order by sort, id), '[]'::jsonb), array_agg(id order by sort, id)
    into lines, ids from public.estimate_items where estimate_id = p_id and product_id is not null;
  lines := public.price_lines(e.company_id, lines);
  for ln in select * from jsonb_array_elements(lines) loop
    k := k + 1;
    update public.estimate_items
       set unit_price = (ln->>'unit_price')::numeric, line_total = (ln->>'line_total')::numeric,
           price_parts = case when jsonb_typeof(ln->'price_parts') = 'array' then ln->'price_parts' end,
           basis = ln->>'basis', per_price = (ln->>'per')::numeric, price_source = ln->>'source'
     where id = ids[k];
  end loop;
  select coalesce(sum(line_total), 0), bool_or(unit_price is null) into sub, e.has_unpriced from public.estimate_items where estimate_id = p_id;
  select x.state into ex from public.company_tax_state(e.company_id) x;
  e.tax_exempt := coalesce(ex in ('ok', 'expiring'), false);
  if not e.tax_rate_manual then
    select * into t from public.tax_rate_for(e.delivery_method, e.branch_id, e.ship_state, e.ship_zip);
    e.tax_rate := t.rate;
    e.tax_freight := coalesce(t.tax_freight, true);
    e.tax_source := t.source;
  end if;
  base := sub + case when e.tax_freight then coalesce(e.freight, 0) else 0 end;
  e.tax := case when e.tax_exempt then 0 when e.tax_rate is null then null else round(base * e.tax_rate / 100, 2) end;
  update public.estimates
     set subtotal = round(sub, 2), has_unpriced = coalesce(e.has_unpriced, false), tax_exempt = e.tax_exempt, tax_rate = e.tax_rate,
         tax_freight = e.tax_freight, tax_source = case when e.tax_rate_manual then coalesce(e.tax_source, 'Typed in') else e.tax_source end,
         tax = e.tax,
         total = round(sub + coalesce(e.freight, 0) + coalesce(e.tax, 0), 2),
         priced_on = (now() at time zone 'America/Chicago')::date, updated_at = now()
   where id = p_id;
end $fn$;
revoke all on function public.estimate_recalc(uuid) from public, anon, authenticated;

-- Build or change an estimate (items and quantities only: prices come from the price list).
-- p: {"id" (blank = new), "company_id", "delivery_method", "branch_id", "ship_address", "ship_state", "ship_zip",
--     "customer_note", "staff_note", "items": [{"product_id", "qty"}]}
create or replace function public.estimate_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  e    public.estimates;
  co   public.companies;
  me   public.profiles;
  v_id uuid := nullif(p->>'id', '')::uuid;
  ln   jsonb;
  pr   public.products;
  n    int := 0;
  dm   text := case when p->>'delivery_method' = 'jobsite' then 'jobsite' else 'pickup' end;
begin
  if not public.can_estimate() then raise exception 'You don''t have access to estimates.'; end if;
  select * into me from public.profiles where id = auth.uid();
  select * into co from public.companies where id = (p->>'company_id')::uuid;
  if co.id is null then raise exception 'Pick the customer.'; end if;
  if dm = 'pickup' and coalesce(p->>'branch_id', '') = '' then raise exception 'Pick the AMBIT location they''ll pick up at.'; end if;
  if dm = 'jobsite' and (length(trim(coalesce(p->>'ship_address', ''))) < 3 or coalesce(p->>'ship_zip', '') !~ '^\d{5}') then
    raise exception 'Add the address to deliver to, with its ZIP.';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Add at least one item.'; end if;
  if v_id is not null then
    select * into e from public.estimates where id = v_id for update;
    if e.id is null then raise exception 'Estimate not found.'; end if;
    if e.status in ('converted', 'cancelled') then raise exception 'This estimate is %. Start a new one.', e.status; end if;
  end if;

  if e.id is null then
    insert into public.estimates (company_id, company_name, created_by, created_by_name, created_by_email, delivery_method, branch_id,
                                  ship_address, ship_state, ship_zip, customer_note, staff_note, valid_until)
    values (co.id, co.name, auth.uid(), coalesce(public.my_name(), me.email), me.email, dm, nullif(p->>'branch_id', ''),
            case when dm = 'jobsite' then left(trim(p->>'ship_address'), 300) end,
            case when dm = 'jobsite' then upper(left(trim(coalesce(p->>'ship_state', '')), 2)) end,
            case when dm = 'jobsite' then left(trim(p->>'ship_zip'), 5) end,
            nullif(left(trim(coalesce(p->>'customer_note', '')), 2000), ''), nullif(left(trim(coalesce(p->>'staff_note', '')), 2000), ''),
            (now() at time zone 'America/Chicago')::date + 30)
    returning * into e;
  else
    update public.estimates
       set company_id = co.id, company_name = co.name, delivery_method = dm, branch_id = nullif(p->>'branch_id', ''),
           ship_address = case when dm = 'jobsite' then left(trim(p->>'ship_address'), 300) end,
           ship_state = case when dm = 'jobsite' then upper(left(trim(coalesce(p->>'ship_state', '')), 2)) end,
           ship_zip = case when dm = 'jobsite' then left(trim(p->>'ship_zip'), 5) end,
           customer_note = nullif(left(trim(coalesce(p->>'customer_note', '')), 2000), ''),
           staff_note = nullif(left(trim(coalesce(p->>'staff_note', '')), 2000), ''),
           -- a delivered estimate that changes goes back to the CRMs to check the freight
           status = case when e.status in ('ready', 'sent') and dm = 'jobsite' then 'needs_freight'
                         when e.status = 'needs_freight' and dm = 'pickup' then 'ready' else e.status end,
           updated_at = now()
     where id = e.id;
    delete from public.estimate_items where estimate_id = e.id;
  end if;
  for ln in select * from jsonb_array_elements(p->'items') loop
    select * into pr from public.products where id = (ln->>'product_id')::uuid and active;
    if pr.id is null or coalesce((ln->>'qty')::numeric, 0) <= 0 then continue; end if;
    n := n + 1;
    insert into public.estimate_items (estimate_id, sort, product_id, sku, name, unit, qty)
    values (e.id, n, pr.id, pr.sku, pr.name, pr.unit, round((ln->>'qty')::numeric, 2));
  end loop;
  if n = 0 then raise exception 'Add at least one item.'; end if;
  perform public.estimate_recalc(e.id);
  return e.id;
end $fn$;
revoke all on function public.estimate_save(jsonb) from public, anon;
grant execute on function public.estimate_save(jsonb) to authenticated;

-- The rep is done: a pickup is ready to send (no freight); a delivery goes to the CRMs for freight.
create or replace function public.estimate_submit(p_id uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare e public.estimates;
begin
  if not public.can_estimate() then raise exception 'You don''t have access to estimates.'; end if;
  select * into e from public.estimates where id = p_id for update;
  if e.id is null then raise exception 'Estimate not found.'; end if;
  if e.status <> 'draft' then return e.status; end if;
  update public.estimates
     set status = case when delivery_method = 'pickup' then 'ready' else 'needs_freight' end,
         freight = case when delivery_method = 'pickup' then 0 else freight end, updated_at = now()
   where id = p_id
  returning status into e.status;
  perform public.estimate_recalc(p_id);
  return e.status;
end $fn$;
revoke all on function public.estimate_submit(uuid) from public, anon;
grant execute on function public.estimate_submit(uuid) to authenticated;

-- A CRM adds the quoted freight (and may type the tax rate and change how long it's good for).
-- p: {"freight", "freight_note", "tax_rate" (blank = from the rate table), "tax_freight", "valid_until"}
create or replace function public.estimate_set_freight(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $fn$
declare e public.estimates; f numeric; r numeric; v date;
begin
  if not public.can_estimate_freight() then raise exception 'Only CRMs and admins add freight to estimates.'; end if;
  select * into e from public.estimates where id = p_id for update;
  if e.id is null then raise exception 'Estimate not found.'; end if;
  if e.status in ('converted', 'cancelled') then raise exception 'This estimate is %.', e.status; end if;
  begin
    f := round(nullif(regexp_replace(coalesce(p->>'freight', ''), '[$,\s]', '', 'g'), '')::numeric, 2);
    r := round(nullif(regexp_replace(coalesce(p->>'tax_rate', ''), '[%\s]', '', 'g'), '')::numeric, 4);
    v := nullif(p->>'valid_until', '')::date;
  exception when others then
    raise exception 'Freight is a dollar amount (like 350.00) and the tax rate a percent (like 8.25).';
  end;
  if f is null then raise exception 'Type the freight (0 if there''s none).'; end if;
  if f < 0 then raise exception 'Freight can''t be below zero.'; end if;
  if r is not null and (r < 0 or r >= 30) then raise exception 'A tax rate of % percent looks wrong.', r; end if;
  update public.estimates
     set freight = f, freight_note = nullif(left(trim(coalesce(p->>'freight_note', '')), 300), ''),
         freight_by_name = public.my_name(), freight_at = now(),
         tax_rate_manual = r is not null,
         tax_rate = case when r is not null then r else tax_rate end,
         tax_freight = case when r is not null then coalesce((p->>'tax_freight')::boolean, true) else tax_freight end,
         tax_source = case when r is not null then 'Typed in by ' || coalesce(public.my_name(), 'a CRM') else tax_source end,
         valid_until = coalesce(v, valid_until),
         status = case when status in ('draft', 'needs_freight') then 'ready' else status end,
         updated_at = now()
   where id = p_id;
  perform public.estimate_recalc(p_id);
end $fn$;
revoke all on function public.estimate_set_freight(uuid, jsonb) from public, anon;
grant execute on function public.estimate_set_freight(uuid, jsonb) to authenticated;

-- Prices again at today's price list (before sending, or any time).
create or replace function public.estimate_reprice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_estimate() then raise exception 'You don''t have access to estimates.'; end if;
  perform public.estimate_recalc(p_id);
end $fn$;
revoke all on function public.estimate_reprice(uuid) from public, anon;
grant execute on function public.estimate_reprice(uuid) to authenticated;

-- The app emailed it.
create or replace function public.estimate_mark_sent(p_id uuid, p_to text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_estimate() then raise exception 'You don''t have access to estimates.'; end if;
  update public.estimates
     set status = case when status in ('ready', 'sent') then 'sent' else status end, sent_at = now(), sent_to = left(p_to, 300),
         sent_by_name = public.my_name(), updated_at = now()
   where id = p_id;
end $fn$;
revoke all on function public.estimate_mark_sent(uuid, text) from public, anon;
grant execute on function public.estimate_mark_sent(uuid, text) to authenticated;

create or replace function public.estimate_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_estimate() then raise exception 'You don''t have access to estimates.'; end if;
  update public.estimates set status = 'cancelled', updated_at = now() where id = p_id and status not in ('converted', 'cancelled');
end $fn$;
revoke all on function public.estimate_cancel(uuid) from public, anon;
grant execute on function public.estimate_cancel(uuid) to authenticated;

-- Turn it into an order: a ready-to-check order on the order screen with the same customer, delivery and items.
-- Placing it prices it at that day's prices (0106) and marks the estimate converted.
create or replace function public.estimate_to_draft(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare e public.estimates; d uuid; who text := coalesce(public.my_name(), 'AMBIT');
begin
  if not (public.is_admin() or public.has_perm('ordering')) then raise exception 'Placing orders takes the Ordering permission.'; end if;
  select * into e from public.estimates where id = p_id;
  if e.id is null then raise exception 'Estimate not found.'; end if;
  if e.status = 'converted' then raise exception 'This estimate is already an order.'; end if;
  if e.status = 'cancelled' then raise exception 'This estimate was cancelled.'; end if;
  insert into public.order_drafts (created_by, created_by_name, source_text, customer_text, company_id, branch_id, delivery_method,
                                   ship_address, notes, items, status, estimate_id)
  values (auth.uid(), who, 'Estimate EST-' || e.est_no, e.company_name, e.company_id, e.branch_id, e.delivery_method, e.ship_address,
          left(concat_ws(' ', 'From estimate EST-' || e.est_no || '.',
                         case when coalesce(e.freight, 0) > 0 then 'Quoted freight $' || to_char(e.freight, 'FM999,999,990.00') || coalesce(' (' || e.freight_note || ')', '') || '.' end,
                         e.customer_note), 2000),
          (select coalesce(jsonb_agg(jsonb_build_object('raw', i.sku || ' ' || i.name, 'product_id', i.product_id, 'qty', i.qty, 'confidence', 1, 'note', null) order by i.sort), '[]'::jsonb)
             from public.estimate_items i where i.estimate_id = p_id and i.product_id is not null),
          'draft', p_id)
  returning id into d;
  return d;
end $fn$;
revoke all on function public.estimate_to_draft(uuid) from public, anon;
grant execute on function public.estimate_to_draft(uuid) to authenticated;

-- When that order is placed, the estimate is converted.
create or replace function public.order_drafts_estimate() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.estimate_id is not null and new.order_id is not null and old.order_id is distinct from new.order_id then
    update public.estimates
       set status = 'converted', order_id = new.order_id, converted_at = now(), converted_by_name = new.created_by_name, updated_at = now()
     where id = new.estimate_id;
  end if;
  return null;
end $fn$;
revoke all on function public.order_drafts_estimate() from public, anon, authenticated;
drop trigger if exists order_drafts_estimate on public.order_drafts;
create trigger order_drafts_estimate after update of order_id on public.order_drafts
  for each row execute function public.order_drafts_estimate();

-- Check: the new tables.
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tax_rates', 'estimates', 'estimate_items')) as "New tables (3)",
       (select count(*) from public.profiles where 'estimates' = any(perms)) as "Staff who can build estimates";
