-- =====================================================================
-- AMBITION update 0018 - Live stock from each branch's inventory spreadsheet
-- (Oklahoma City first; the other branches follow the same way later.)
-- * The branch's Excel workbook (OneDrive / SharePoint) is the stock count. The app
--   reads it every couple of minutes and writes back what changes in the app.
-- * Orders reserve stock the moment they're placed (PENDING ORDERS tab, "Pending
--   Pickup"), cancelling releases it, and picking up / delivering takes it out of
--   TOTAL IN STOCK. A physical count on the sheet always wins.
-- * Contractors only see In stock / Low / Ships from supplier, never the numbers.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

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

select (select count(*) from public.inventory_sheets) as inventory_sheets,
       (select count(*) from public.inventory) as stocked_items;
