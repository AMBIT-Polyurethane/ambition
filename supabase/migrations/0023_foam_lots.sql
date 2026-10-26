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
