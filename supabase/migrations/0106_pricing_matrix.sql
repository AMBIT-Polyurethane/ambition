-- 0106: every price fills in by itself when an order is placed, from one pricing matrix.
--  * Base prices: what anyone pays who has no price of their own. For most items that's the list price; spray foam
--    has a base price per lb and fiberglass batts per sq ft.
--  * Each customer's own prices (customer_prices, as before) override the base.
--  * The pricing dashboard changes many prices at once: pick customers (or all of them, and/or the base prices),
--    pick items or whole groups, then raise them by a %, by an amount ($/lb for foam, $/sq ft for batts, $ each for
--    the rest), or set a new price, from a date. Every change is kept as a batch that can be undone.
--  * Orders price themselves when they're placed (and when items are added or changed), from the matrix: resin drums
--    at the customer's $/lb x the drum's lbs, ISO drums at the $/lb of the resin they go with x 500 lb. The order desk
--    still checks the prices against the invoice.
--  * The foam price spreadsheet comes in through an import list (update 0107) that matches its customers.
-- Safe to run again.

-- ---------------------------------------------------------------- who can change prices: its own permission
create or replace function public.all_perms() returns text[]
language sql immutable as $fn$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports', 'add_customers', 'prices']
$fn$;
create or replace function public.can_price() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.has_perm('prf_approve') or public.has_perm('prices')
$fn$;

-- ---------------------------------------------------------------- what's needed on products and customers
alter table public.products add column if not exists drum_lbs numeric(8,2);
alter table public.products drop constraint if exists products_drum_lbs_check;
alter table public.products add constraint products_drum_lbs_check check (drum_lbs is null or drum_lbs > 0);
update public.products p set drum_lbs = v.lbs
  from (values ('ISO', 500), ('AMB-TITE-20', 475), ('AMB-TITE-20-W', 475), ('AMB-SEAL-50', 450), ('AMB-SEAL-50-W', 450),
               ('AMB-JACK', 425), ('AMB-ROOF-28', 475)) as v(sku, lbs)
 where upper(p.sku) = v.sku and p.drum_lbs is null;

alter table public.companies add column if not exists price_note text;
alter table public.order_items add column if not exists price_source text;

alter table public.customer_prices drop constraint if exists customer_prices_source_check;
alter table public.customer_prices add constraint customer_prices_source_check
  check (source in ('manual', 'price_request', 'import', 'netsuite', 'bulk'));

-- ---------------------------------------------------------------- base prices for foam (per lb) and batts (per sq ft)
create table if not exists public.base_prices (
  product_id      uuid primary key references public.products(id) on delete cascade,
  price           numeric(12,4) not null check (price >= 0),
  basis           text not null check (basis in ('unit', 'lb', 'sqft')),
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
alter table public.base_prices enable row level security;
drop policy if exists base_prices_read on public.base_prices;
create policy base_prices_read on public.base_prices for select to authenticated using (public.is_employee());

-- Foam is priced per lb, fiberglass batts per sq ft (blow-in per bag), everything else per unit (as lib/prices.ts).
create or replace function public.price_basis(p_category text, p_name text) returns text
language sql immutable as $fn$
  select case when p_category = 'ambit-foam' then 'lb'
              when p_category in ('fiberglass', 'batts') then
                case when coalesce(p_name, '') ~* '(jet ?stream|climate ?pro|blow|loose ?fill|\ml77\M|propink|insul ?safe)' then 'unit' else 'sqft' end
              else 'unit' end
$fn$;

-- Pounds in one drum: the product's own number, else from its name ("... 500 lb drum").
create or replace function public.price_lbs(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $fn$
  select coalesce(p.drum_lbs, nullif(substring(p.name from '(\d{2,4})\s*lbs?\M'), '')::numeric)
    from public.products p where p.id = p_product
$fn$;

-- The base price, per its basis: base_prices for foam and batts, the list price for everything else.
create or replace function public.price_base(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $fn$
  select coalesce(b.price, case when public.price_basis(p.category_id, p.name) = 'unit' then p.list_price end)
    from public.products p left join public.base_prices b on b.product_id = p.id
   where p.id = p_product
$fn$;

-- One unit's price (a drum, a bag, each) from a price per lb, per sq ft or per unit.
create or replace function public.price_per_unit(p_price numeric, p_basis text, p_product uuid) returns numeric
language sql stable security definer set search_path = public as $fn$
  select case when p_price is null then null
              when p_basis = 'lb' then case when public.price_lbs(p.id) > 0 then round(p_price * public.price_lbs(p.id), 2) end
              when p_basis = 'sqft' then case when p.sqft_per_unit > 0 then round(p_price * p.sqft_per_unit, 2) end
              else round(p_price, 2) end
    from public.products p where p.id = p_product
$fn$;

-- What a customer pays for an item on a day: their own price, else the base price.
create or replace function public.price_for(p_company uuid, p_product uuid, p_on date default null)
returns table (price numeric, basis text, source text)
language sql stable security definer set search_path = public as $fn$
  select x.price, x.basis, x.source from (
    select cp.price, cp.basis, 'customer'::text as source, 1 as rank
      from public.customer_prices cp
     where cp.company_id = p_company and cp.product_id = p_product
       and cp.effective_on <= coalesce(p_on, (now() at time zone 'America/Chicago')::date)
       and (cp.expires_on is null or cp.expires_on >= coalesce(p_on, (now() at time zone 'America/Chicago')::date))
    union all
    select public.price_base(p.id), coalesce(b.basis, public.price_basis(p.category_id, p.name)), 'base', 2
      from public.products p left join public.base_prices b on b.product_id = p.id where p.id = p_product
  ) x
  where x.price is not null
  order by x.rank
  limit 1
$fn$;

-- ---------------------------------------------------------------- changes, now or from a date, kept in batches
create table if not exists public.price_batches (
  id              bigint generated always as identity primary key,
  label           text not null,
  method          text not null check (method in ('pct', 'add', 'set')),
  amount          numeric(12,4) not null,
  effective_on    date not null,
  only_own        boolean not null default true,
  customers       int not null default 0,
  products        int not null default 0,
  changes         int not null default 0,
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by_name  text
);
create table if not exists public.price_changes (
  id           bigint generated always as identity primary key,
  batch_id     bigint not null references public.price_batches(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete cascade,   -- null: the base price
  product_id   uuid not null references public.products(id) on delete cascade,
  basis        text not null check (basis in ('unit', 'lb', 'sqft')),
  old_price    numeric(12,4),
  had_own      boolean not null default false,
  new_price    numeric(12,4) not null check (new_price >= 0),
  effective_on date not null,
  applied_at   timestamptz,
  cancelled_at timestamptz
);
create index if not exists price_changes_batch on public.price_changes(batch_id);
create index if not exists price_changes_due on public.price_changes(effective_on) where applied_at is null and cancelled_at is null;
create index if not exists price_changes_cp on public.price_changes(company_id, product_id) where applied_at is null and cancelled_at is null;
alter table public.price_batches enable row level security;
alter table public.price_changes enable row level security;
drop policy if exists price_batches_read on public.price_batches;
drop policy if exists price_changes_read on public.price_changes;
create policy price_batches_read on public.price_batches for select to authenticated using (public.is_employee());
create policy price_changes_read on public.price_changes for select to authenticated using (public.is_employee());

-- Writes one price: a customer's own (null removes it) or the base (company null).
create or replace function public.price_write(p_company uuid, p_product uuid, p_price numeric, p_basis text, p_source text, p_ref text, p_on date, p_who text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if p_company is null then
    if p_basis = 'unit' and not exists (select 1 from public.base_prices where product_id = p_product) then
      update public.products set list_price = round(p_price, 2), updated_at = now() where id = p_product;
    elsif p_price is null then
      delete from public.base_prices where product_id = p_product;
    else
      insert into public.base_prices (product_id, price, basis, updated_by_name, updated_at)
      values (p_product, p_price, p_basis, p_who, now())
      on conflict (product_id) do update set price = excluded.price, basis = excluded.basis, updated_by_name = excluded.updated_by_name, updated_at = now();
    end if;
    return;
  end if;
  if p_price is null then
    delete from public.customer_prices where company_id = p_company and product_id = p_product;
  else
    insert into public.customer_prices (company_id, product_id, price, basis, effective_on, source, source_ref, updated_by_name, updated_at)
    values (p_company, p_product, p_price, p_basis, coalesce(p_on, (now() at time zone 'America/Chicago')::date), p_source, p_ref, p_who, now())
    on conflict (company_id, product_id) do update
      set price = excluded.price, basis = excluded.basis, effective_on = excluded.effective_on, source = excluded.source,
          source_ref = excluded.source_ref, updated_by_name = excluded.updated_by_name, updated_at = now();
  end if;
  insert into public.customer_price_history (company_id, product_id, price, basis, source, changed_by_name)
  values (p_company, p_product, p_price, case when p_price is null then null else p_basis end, case when p_price is null then 'removed' else p_source end, p_who);
end $fn$;
revoke all on function public.price_write(uuid, uuid, numeric, text, text, text, date, text) from public, anon, authenticated;

-- Changes whose day has come take effect (run before prices are read or an order is priced).
create or replace function public.price_apply_due() returns int
language plpgsql security definer set search_path = public as $fn$
declare r record; n int := 0;
begin
  for r in
    select c.*, b.created_by_name
      from public.price_changes c join public.price_batches b on b.id = c.batch_id
     where c.applied_at is null and c.cancelled_at is null and c.effective_on <= (now() at time zone 'America/Chicago')::date
     order by c.effective_on, c.id
     for update of c skip locked
  loop
    perform public.price_write(r.company_id, r.product_id, r.new_price, r.basis, 'bulk', 'Price change #' || r.batch_id, r.effective_on, coalesce(r.created_by_name, 'Price change'));
    update public.price_changes set applied_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $fn$;
revoke all on function public.price_apply_due() from public, anon;
grant execute on function public.price_apply_due() to authenticated;

-- The pricing dashboard: preview (p_apply false) or make a change to many prices at once.
-- p: {"customers": [uuid], "all_customers": bool, "include_base": bool, "products": [uuid], "method": "pct"|"add"|"set",
--     "amount": number, "effective_on": "YYYY-MM-DD", "only_own": bool, "note": text}
-- pct: raise by that %. add: add that amount to the price as it's kept ($/lb for foam, $/sq ft for batts, $ each).
-- set: that price. only_own: change only customers who have their own price (the rest follow the base price);
-- off, a customer without one gets their own, worked out from the base price.
create or replace function public.price_bulk(p jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  meth   text := p->>'method';
  amt    numeric;
  today  date := (now() at time zone 'America/Chicago')::date;
  eff    date;
  own_only  boolean := coalesce((p->>'only_own')::boolean, true);
  incl_base boolean := coalesce((p->>'include_base')::boolean, false);
  v_c    uuid[];
  v_p    uuid[];
  total  int;
  bid    bigint;
  who    text := coalesce(public.my_name(), 'AMBIT');
  out    jsonb;
begin
  if not public.can_price() then raise exception 'Only admins and price approvers change prices.'; end if;
  if meth not in ('pct', 'add', 'set') then raise exception 'Pick how to change the prices.'; end if;
  begin
    amt := (p->>'amount')::numeric;
  exception when others then
    raise exception 'Type the amount as a number, like 10 or 0.10.';
  end;
  if amt is null then raise exception 'Type the amount.'; end if;
  if meth = 'pct' and (amt <= -90 or amt > 500) then raise exception 'A change of % percent looks wrong.', amt; end if;
  if meth = 'set' and amt < 0 then raise exception 'A price can''t be below zero.'; end if;
  begin
    eff := coalesce(nullif(p->>'effective_on', '')::date, today);
  exception when others then
    raise exception 'The start date isn''t a date.';
  end;
  if eff < today then raise exception 'Pick today or a later day to start.'; end if;
  v_p := array(select (jsonb_array_elements_text(coalesce(p->'products', '[]'::jsonb)))::uuid);
  if coalesce((p->>'all_customers')::boolean, false) then
    v_c := array(select id from public.companies where active);
  else
    v_c := array(select (jsonb_array_elements_text(coalesce(p->'customers', '[]'::jsonb)))::uuid);
  end if;
  if cardinality(v_p) = 0 then raise exception 'Pick at least one item.'; end if;
  if cardinality(v_c) = 0 and not incl_base then raise exception 'Pick at least one customer, or the base prices.'; end if;

  drop table if exists pg_temp.price_plan;
  create temp table price_plan on commit drop as
  with prods as (
    select pr.id, pr.sku, pr.name, pr.unit, public.price_basis(pr.category_id, pr.name) as basis, public.price_base(pr.id) as base
      from public.products pr where pr.id = any(v_p)
  ), rows as (
    select c.id as company_id, c.name as company, d.id as product_id, d.sku, d.name as product, d.unit,
           coalesce(cp.basis, d.basis) as basis, cp.price as own_price, d.base,
           cp.price is not null as had_own
      from public.companies c cross join prods d
      left join public.customer_prices cp on cp.company_id = c.id and cp.product_id = d.id
     where c.id = any(v_c)
    union all
    select null::uuid, 'Base price', d.id, d.sku, d.name, d.unit, d.basis, null::numeric, d.base, false
      from prods d where incl_base
  ), start as (
    select r.*,
           case when r.company_id is null then r.base when r.had_own then r.own_price when own_only then null else r.base end as old_price
      from rows r
     where r.company_id is null or r.had_own or not own_only
  )
  select s.*,
         case meth
           when 'pct' then round(s.old_price * (1 + amt / 100), case when s.basis = 'sqft' then 3 else 2 end)
           when 'add' then round(s.old_price + amt, case when s.basis = 'sqft' then 3 else 2 end)
           else round(amt, case when s.basis = 'sqft' then 3 else 2 end)
         end as new_price
    from start s;
  delete from price_plan where new_price is null or new_price < 0 or new_price is not distinct from old_price;
  select count(*) into total from price_plan;
  if total > 60000 then raise exception 'That''s % price changes at once. Pick fewer customers or items.', total; end if;

  if not p_apply then
    select jsonb_build_object(
      'changes', total,
      'customers', (select count(distinct company_id) from price_plan where company_id is not null),
      'base', (select count(*) from price_plan where company_id is null),
      'products', (select count(distinct product_id) from price_plan),
      'up', (select count(*) from price_plan where new_price > coalesce(old_price, 0)),
      'down', (select count(*) from price_plan where new_price < old_price),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('company', company, 'company_id', company_id, 'sku', sku, 'product', product, 'unit', unit,
                                                             'basis', basis, 'old', old_price, 'new', new_price, 'own', had_own) order by company_id nulls first, company, sku)
                          from (select * from price_plan order by company_id nulls first, company, sku limit 400) t), '[]'::jsonb))
      into out;
    return out;
  end if;

  if total = 0 then raise exception 'Nothing would change.'; end if;
  insert into public.price_batches (label, method, amount, effective_on, only_own, customers, products, changes, note, created_by, created_by_name)
  values (
    left(coalesce(nullif(trim(p->>'label'), ''),
      case meth when 'pct' then (case when amt >= 0 then '+' else '' end) || trim_scale(amt) || '%'
                when 'add' then (case when amt >= 0 then '+$' else '-$' end) || trim_scale(abs(amt))
                else 'Set to $' || trim_scale(amt) end), 120),
    meth, amt, eff, own_only,
    (select count(distinct company_id) from price_plan where company_id is not null),
    (select count(distinct product_id) from price_plan), total,
    nullif(left(trim(coalesce(p->>'note', '')), 500), ''), auth.uid(), who)
  returning id into bid;
  insert into public.price_changes (batch_id, company_id, product_id, basis, old_price, had_own, new_price, effective_on)
  select bid, company_id, product_id, basis, old_price, had_own, new_price, eff from price_plan;
  if eff <= today then perform public.price_apply_due(); end if;
  return jsonb_build_object('batch', bid, 'changes', total, 'effective_on', eff, 'now', eff <= today);
end $fn$;
revoke all on function public.price_bulk(jsonb, boolean) from public, anon;
grant execute on function public.price_bulk(jsonb, boolean) to authenticated;

-- Undo a batch: changes still waiting are cancelled; prices it set go back to what they were (unless they've been
-- changed again since).
create or replace function public.price_bulk_undo(p_batch bigint) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  b   public.price_batches;
  r   record;
  cur numeric;
  n   int := 0;
  k   int := 0;
  w   int := 0;
  who text := coalesce(public.my_name(), 'AMBIT');
begin
  if not public.can_price() then raise exception 'Only admins and price approvers change prices.'; end if;
  select * into b from public.price_batches where id = p_batch for update;
  if b.id is null then raise exception 'That price change isn''t there.'; end if;
  if b.undone_at is not null then raise exception 'That price change was already undone.'; end if;
  update public.price_changes set cancelled_at = now() where batch_id = p_batch and applied_at is null and cancelled_at is null;
  get diagnostics k = row_count;
  for r in select * from public.price_changes where batch_id = p_batch and applied_at is not null order by id desc loop
    if r.company_id is null then
      cur := public.price_base(r.product_id);
    else
      select price into cur from public.customer_prices where company_id = r.company_id and product_id = r.product_id;
    end if;
    if cur is distinct from r.new_price then
      w := w + 1;  -- changed again since: left alone
      continue;
    end if;
    if r.company_id is null then
      perform public.price_write(null, r.product_id, r.old_price, r.basis, 'bulk', 'Undo #' || p_batch, null, who);
    else
      perform public.price_write(r.company_id, r.product_id, case when r.had_own then r.old_price end, r.basis, 'bulk', 'Undo #' || p_batch, null, who);
    end if;
    n := n + 1;
  end loop;
  update public.price_batches set undone_at = now(), undone_by_name = who where id = p_batch;
  return jsonb_build_object('reverted', n, 'cancelled', k, 'kept', w);
end $fn$;
revoke all on function public.price_bulk_undo(bigint) from public, anon;
grant execute on function public.price_bulk_undo(bigint) to authenticated;

-- Base prices typed on the Base prices page: [{"product_id", "price" (null = none), "basis"}].
create or replace function public.base_prices_save(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare ln jsonb; n int := 0; v numeric; who text := coalesce(public.my_name(), 'AMBIT'); bas text; pid uuid;
begin
  if not public.can_price() then raise exception 'Only admins and price approvers change prices.'; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pid := (ln->>'product_id')::uuid;
    bas := case when ln->>'basis' in ('unit', 'lb', 'sqft') then ln->>'basis' else 'unit' end;
    v := case when coalesce(ln->>'price', '') = '' then null else round((ln->>'price')::numeric, 4) end;
    if v < 0 then raise exception 'Prices can''t be negative.'; end if;
    if bas = 'unit' and not exists (select 1 from public.base_prices where product_id = pid) then
      update public.products set list_price = round(v, 2), updated_at = now() where id = pid and list_price is distinct from round(v, 2);
    elsif v is null then
      delete from public.base_prices where product_id = pid;
    else
      insert into public.base_prices (product_id, price, basis, updated_by_name, updated_at) values (pid, v, bas, who, now())
      on conflict (product_id) do update set price = excluded.price, basis = excluded.basis, updated_by_name = excluded.updated_by_name, updated_at = now()
      where base_prices.price is distinct from excluded.price or base_prices.basis is distinct from excluded.basis;
    end if;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $fn$;
revoke all on function public.base_prices_save(jsonb) from public, anon;
grant execute on function public.base_prices_save(jsonb) to authenticated;

-- ---------------------------------------------------------------- orders price themselves
-- Prices every line of an order that isn't invoice-priced yet (or only p_item once it is) from the matrix.
-- Resin drums: $/lb x the drum's lbs. ISO drums: the $/lb of the resin each goes with x 500 lb, split by resin
-- when they differ (as the order desk enters them). An item priced per unit with no customer price keeps the
-- price it was ordered at (list or sale price). Returns and exchanges are priced by hand.
create or replace function public.order_autoprice(p_order uuid, p_item bigint default null) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  o      public.orders;
  it     record;
  pr     record;
  u      numeric;
  day    date;
  resins jsonb := '[]'::jsonb;
  rs     jsonb;
  iso    record;
  left_q numeric;
  take   numeric;
  parts  jsonb;
  tot    numeric;
  first_lb numeric;
  own_lb numeric;
  iso_lbs numeric;
  same   boolean;
  p0     numeric;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.company_id is null or o.status = 'cancelled' or coalesce(o.kind, 'sale') <> 'sale' then return; end if;
  perform public.price_apply_due();
  day := (o.created_at at time zone 'America/Chicago')::date;
  if day < (now() at time zone 'America/Chicago')::date then day := (now() at time zone 'America/Chicago')::date; end if;

  -- Every line but ISO (and keep each resin's $/lb for the ISO that goes with it).
  for it in
    select i.id, i.qty, i.unit_price, i.product_id, i.sku, i.unit, p.category_id
      from public.order_items i left join public.products p on p.id = i.product_id
     where i.order_id = p_order order by i.id
  loop
    if it.product_id is null then continue; end if;
    select * into pr from public.price_for(o.company_id, it.product_id, day);
    if it.category_id = 'ambit-foam' and it.unit ~* '^drums?$' then
      if it.sku ~* '^ISO' then continue; end if;
      resins := resins || jsonb_build_object('id', it.id, 'qty', it.qty, 'lb', case when pr.basis = 'lb' then pr.price end);
    end if;
    if not (o.priced_at is null or it.id = p_item) then continue; end if;
    if pr.price is null or (pr.source = 'base' and pr.basis = 'unit') then continue; end if;
    u := public.price_per_unit(pr.price, pr.basis, it.product_id);
    if u is null then continue; end if;
    update public.order_items set unit_price = u, line_total = round(u * qty, 2), price_parts = null, price_source = pr.source
     where id = it.id and (unit_price is distinct from u or line_total is distinct from round(u * qty, 2) or price_source is distinct from pr.source);
  end loop;

  -- ISO drums, by the resin each goes with (in order), like the order sheet pairs them.
  for iso in
    select i.id, i.qty, i.product_id, p.category_id
      from public.order_items i join public.products p on p.id = i.product_id
     where i.order_id = p_order and p.category_id = 'ambit-foam' and i.unit ~* '^drums?$' and i.sku ~* '^ISO'
     order by i.id
  loop
    if not (o.priced_at is null or iso.id = p_item) then continue; end if;
    iso_lbs := coalesce(public.price_lbs(iso.product_id), 500);
    select case when x.basis = 'lb' then x.price end into own_lb from public.price_for(o.company_id, iso.product_id, day) x where x.source = 'customer';
    first_lb := (select (r->>'lb')::numeric from jsonb_array_elements(resins) r where r->>'lb' is not null limit 1);
    left_q := iso.qty; parts := '[]'::jsonb; tot := 0;
    for rs in select * from jsonb_array_elements(resins) loop
      exit when left_q <= 0;
      take := least(left_q, (rs->>'qty')::numeric);
      if take <= 0 then continue; end if;
      if rs->>'lb' is null then parts := null; exit; end if;
      parts := parts || jsonb_build_object('with', (rs->>'id')::bigint, 'qty', take, 'price', round((rs->>'lb')::numeric * iso_lbs, 2));
      tot := tot + round((rs->>'lb')::numeric * iso_lbs, 2) * take;
      -- that resin's drums now have their ISO
      resins := (select jsonb_agg(case when (r->>'id') = (rs->>'id') then jsonb_set(r, '{qty}', to_jsonb((r->>'qty')::numeric - take)) else r end) from jsonb_array_elements(resins) r);
      left_q := left_q - take;
    end loop;
    if parts is null then continue; end if;
    if left_q > 0 then
      if coalesce(own_lb, first_lb) is null then continue; end if;
      parts := parts || jsonb_build_object('with', null, 'qty', left_q, 'price', round(coalesce(own_lb, first_lb) * iso_lbs, 2));
      tot := tot + round(coalesce(own_lb, first_lb) * iso_lbs, 2) * left_q;
    end if;
    if jsonb_array_length(parts) = 0 then continue; end if;
    p0 := (parts->0->>'price')::numeric;
    same := not exists (select 1 from jsonb_array_elements(parts) x where (x->>'price')::numeric <> p0);
    update public.order_items
       set unit_price = case when same then p0 else round(tot / qty, 2) end,
           line_total = round(tot, 2),
           price_parts = case when same or jsonb_array_length(parts) < 2 then null else parts end,
           price_source = 'customer'
     where id = iso.id;
  end loop;

  if o.priced_at is null then
    update public.orders
       set est_subtotal = coalesce((select sum(i.line_total) from public.order_items i where i.order_id = p_order and i.line_total is not null), 0),
           has_customer_pricing = exists (select 1 from public.order_items i where i.order_id = p_order and i.customer_priced and i.unit_price is null)
     where id = p_order
       and (est_subtotal, has_customer_pricing) is distinct from (
            coalesce((select sum(i.line_total) from public.order_items i where i.order_id = p_order and i.line_total is not null), 0),
            exists (select 1 from public.order_items i where i.order_id = p_order and i.customer_priced and i.unit_price is null));
  end if;
end $fn$;
revoke all on function public.order_autoprice(uuid, bigint) from public, anon, authenticated;

-- At the end of each change, after every line is in: an order placed, a line added, a quantity or item changed.
create or replace function public.order_items_autoprice() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- Pricing never stops an order from going in: if it fails, the order desk prices it from the invoice as before.
  begin
    perform public.order_autoprice(new.order_id, new.id);
  exception when others then
    raise warning 'order_autoprice % failed: %', new.order_id, sqlerrm;
  end;
  return null;
end $fn$;
revoke all on function public.order_items_autoprice() from public, anon, authenticated;
drop trigger if exists order_items_autoprice on public.order_items;
create constraint trigger order_items_autoprice after insert or update of qty, product_id on public.order_items
  deferrable initially deferred for each row execute function public.order_items_autoprice();

-- Check: foam drums with their pounds, and the new tables.
select (select count(*) from public.products where drum_lbs is not null) as "Products with drum lbs",
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('base_prices', 'price_batches', 'price_changes')) as "New tables (3)";
