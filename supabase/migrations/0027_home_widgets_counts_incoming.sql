-- =====================================================================
-- AMBIT Intelligence update 0027 - Home widgets, spot checks, reconciliation, incoming deliveries
-- * Daily inventory spot check: each weekday the app picks one item per location (never the same
--   one twice until every item has had a turn). The warehouse manager counts it from Home; a
--   count that's off waits for an admin to approve before stock changes.
-- * Inventory reconciliation (quarterly): count everything in the app, send it in, an admin
--   approves, and the differences go onto the spreadsheet.
-- * Expected deliveries: incoming trucks with what's on them, on the warehouse calendar;
--   "Received" adds them to stock (spray foam as new lots on FOAM LOTS).
-- * A monthly sales goal per person (Admin > Accounts) for the Sales widget.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Counts: spot checks and reconciliations ---------------------
create table if not exists public.inventory_counts (
  id                bigint generated always as identity primary key,
  branch_id         text not null references public.branches(id) on update cascade on delete cascade,
  kind              text not null,                 -- spot | reconcile
  day               date,                          -- spot: the weekday it's for
  cycle             int not null default 1,        -- spot: every item once per cycle
  status            text not null default 'open',  -- open | matched | submitted | approved | rejected
  started_by_name   text,
  started_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  submitted_by_name text,
  reviewed_at       timestamptz,
  reviewed_by_name  text,
  review_note       text
);
do $$ begin
  alter table public.inventory_counts add constraint inventory_counts_kind_check check (kind in ('spot', 'reconcile'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.inventory_counts add constraint inventory_counts_status_check check (status in ('open', 'matched', 'submitted', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;
create unique index if not exists inventory_counts_spot_day on public.inventory_counts(branch_id, day) where kind = 'spot';
create index if not exists inventory_counts_status_idx on public.inventory_counts(status, branch_id);

create table if not exists public.inventory_count_lines (
  id              bigint generated always as identity primary key,
  count_id        bigint not null references public.inventory_counts(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  sku             text not null,
  name            text,
  unit            text,
  lot_id          bigint references public.inventory_lots(id) on delete set null,
  lot_no          text,
  system_qty      numeric(12,2),     -- what the app had when it was counted
  counted_qty     numeric(12,2),
  counted_at      timestamptz,
  counted_by_name text,
  note            text,
  applied         boolean not null default false
);
create index if not exists inventory_count_lines_count_idx on public.inventory_count_lines(count_id);
create index if not exists inventory_count_lines_product_idx on public.inventory_count_lines(product_id);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
drop policy if exists inventory_counts_read on public.inventory_counts;
drop policy if exists inventory_count_lines_read on public.inventory_count_lines;
create policy inventory_counts_read on public.inventory_counts for select to authenticated using (public.is_employee());
create policy inventory_count_lines_read on public.inventory_count_lines for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.inventory_counts, public.inventory_count_lines from anon, authenticated;
grant select on public.inventory_counts, public.inventory_count_lines to authenticated;

-- ---------- Lots: changes made in the app waiting to go onto FOAM LOTS ----
alter table public.inventory_lots add column if not exists adj_unsynced numeric(12,2) not null default 0;  -- approved count differences -> Adj
alter table public.inventory_lots add column if not exists in_unsynced  numeric(12,2) not null default 0;  -- received in the app -> Shipped In
alter table public.inventory_lots add column if not exists add_to_sheet boolean not null default false;    -- new lot received in the app: add its row

-- The sync wrote Adj or Shipped In: fold what it wrote into the sheet's number.
create or replace function public.inventory_lot_fold(p_lot bigint, p_col text, p_sheet numeric, p_written numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_col = 'adj' then
    update public.inventory_lots set adj = p_sheet + p_written, adj_unsynced = adj_unsynced - p_written, updated_at = now() where id = p_lot;
  elsif p_col = 'in' then
    update public.inventory_lots set shipped_in = p_sheet + p_written, in_unsynced = in_unsynced - p_written, updated_at = now() where id = p_lot;
  end if;
end $$;

-- What the app has for one count line right now (a lot's Remaining, or the item's TOTAL IN STOCK).
create or replace function public.count_system_qty(p_branch text, p_product uuid, p_lot bigint)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_lot is not null then (select remaining from public.inventory_lots where id = p_lot)
              else (select on_hand from public.inventory where branch_id = p_branch and product_id = p_product) end
$$;

-- ---------- Daily spot checks ---------------------------------------------
-- Makes sure every weekday (Central time) up to today has its item. Missed days stay open.
create or replace function public.spot_check_ensure(p_branch text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  last  date;
  d     date;
  cyc   int;
  c     bigint;
  pid   uuid;
  psku  text;
  pname text;
  punit text;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then return; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then return; end if;
  perform pg_advisory_xact_lock(hashtext('spot_check:' || p_branch));
  select max(day) into last from public.inventory_counts where branch_id = p_branch and kind = 'spot';
  d := greatest(coalesce(last + 1, today), today - 21);
  while d <= today loop
    if extract(isodow from d) between 1 and 5 then
      select coalesce(max(cycle), 1) into cyc from public.inventory_counts where branch_id = p_branch and kind = 'spot';
      pid := null;
      -- Something actually stocked here that hasn't had its turn this cycle.
      select i.product_id, i.sku, p.name, p.unit into pid, psku, pname, punit
        from public.inventory i join public.products p on p.id = i.product_id
       where i.branch_id = p_branch and i.on_sheet
         and (i.on_hand is not null or exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = i.product_id and x.on_sheet))
         and not exists (select 1 from public.inventory_count_lines l join public.inventory_counts k on k.id = l.count_id
                          where k.branch_id = p_branch and k.kind = 'spot' and k.cycle = cyc and l.product_id = i.product_id)
       order by random() limit 1;
      if pid is null then
        -- Every item has had a turn: start the next round.
        cyc := cyc + 1;
        select i.product_id, i.sku, p.name, p.unit into pid, psku, pname, punit
          from public.inventory i join public.products p on p.id = i.product_id
         where i.branch_id = p_branch and i.on_sheet
           and (i.on_hand is not null or exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = i.product_id and x.on_sheet))
         order by random() limit 1;
      end if;
      if pid is not null then
        c := null;
        insert into public.inventory_counts (branch_id, kind, day, cycle, status, started_by_name)
        values (p_branch, 'spot', d, cyc, 'open', 'AMBIT A.I.')
        on conflict do nothing
        returning id into c;
        if c is not null then
          if exists (select 1 from public.inventory_lots x where x.branch_id = p_branch and x.product_id = pid and x.on_sheet) then
            insert into public.inventory_count_lines (count_id, product_id, sku, name, unit, lot_id, lot_no)
            select c, pid, x.sku, pname, punit, x.id, nullif(x.lot_no, '')
              from public.inventory_lots x
             where x.branch_id = p_branch and x.product_id = pid and x.on_sheet
             order by x.use_by nulls last, x.id;
          else
            insert into public.inventory_count_lines (count_id, product_id, sku, name, unit) values (c, pid, psku, pname, punit);
          end if;
        end if;
      end if;
    end if;
    d := d + 1;
  end loop;
end $$;

-- A count is sent in: everything matched, or the differences wait for an admin.
create or replace function public.count_finish(p_count bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  off int;
  st  text;
begin
  select count(*) into off from public.inventory_count_lines
   where count_id = p_count and counted_qty is not null and counted_qty is distinct from coalesce(system_qty, 0);
  st := case when off = 0 then 'matched' else 'submitted' end;
  update public.inventory_counts
     set status = st, submitted_at = now(), submitted_by_name = public.my_name()
   where id = p_count and status = 'open';
  return st;
end $$;

-- Warehouse: one counted number. A spot check is sent in as soon as every line has its count.
create or replace function public.count_line_save(p_line bigint, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_count_lines;
  k   public.inventory_counts;
  sys numeric;
  st  text;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into l from public.inventory_count_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the count any more.'; end if;
  select * into k from public.inventory_counts where id = l.count_id for update;
  if k.status <> 'open' then raise exception 'This count was already sent in.'; end if;
  if p_qty is null then
    -- Cleared: not counted after all.
    update public.inventory_count_lines set counted_qty = null, system_qty = null, counted_at = null, counted_by_name = null where id = p_line;
    return jsonb_build_object('status', k.status);
  end if;
  if p_qty < 0 then raise exception 'A count can''t be below zero.'; end if;
  sys := public.count_system_qty(k.branch_id, l.product_id, l.lot_id);
  update public.inventory_count_lines
     set counted_qty = round(p_qty, 2), system_qty = sys, counted_at = now(), counted_by_name = public.my_name(),
         note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_line;
  st := k.status;
  if k.kind = 'spot' and not exists (select 1 from public.inventory_count_lines where count_id = k.id and counted_qty is null) then
    st := public.count_finish(k.id);
  end if;
  return jsonb_build_object('status', st);
end $$;

-- Warehouse: send a reconciliation in (lines left blank aren't changed).
create or replace function public.count_submit(p_count bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  k public.inventory_counts;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status <> 'open' then raise exception 'This count was already sent in.'; end if;
  if not exists (select 1 from public.inventory_count_lines where count_id = p_count and counted_qty is not null) then
    raise exception 'Count at least one item first.';
  end if;
  return public.count_finish(p_count);
end $$;

-- Warehouse or admin: start the quarterly reconciliation (or carry on with the one that's open).
create or replace function public.count_start_reconcile(p_branch text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c bigint;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then
    raise exception 'This location''s inventory isn''t in the app yet.';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile:' || p_branch));
  select id into c from public.inventory_counts where branch_id = p_branch and kind = 'reconcile' and status = 'open' order by id desc limit 1;
  if c is not null then return c; end if;
  insert into public.inventory_counts (branch_id, kind, status, started_by_name) values (p_branch, 'reconcile', 'open', public.my_name()) returning id into c;
  -- Every item on the COUNT SHEET (spray foam lot by lot), in sheet order.
  insert into public.inventory_count_lines (count_id, product_id, sku, name, unit, lot_id, lot_no)
  select c, i.product_id, coalesce(x.sku, i.sku), p.name, p.unit, x.id, nullif(x.lot_no, '')
    from public.inventory i
    join public.products p on p.id = i.product_id
    left join public.inventory_lots x on x.branch_id = i.branch_id and x.product_id = i.product_id and x.on_sheet
   where i.branch_id = p_branch and i.on_sheet
   order by i.sheet_row nulls last, x.use_by nulls last, x.id;
  return c;
end $$;

-- Admin: approve (the differences go into stock and onto the spreadsheet) or reject a count.
create or replace function public.count_review(p_count bigint, p_approve boolean, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k    public.inventory_counts;
  l    record;
  diff numeric;
  n    int := 0;
  who  text := coalesce(public.my_name(), 'AMBITION');
  what text;
  dt   date;
begin
  if not public.is_admin() then raise exception 'Only admins can approve counts.'; end if;
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status <> 'submitted' then raise exception 'This count isn''t waiting for approval.'; end if;
  what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
  if not p_approve then
    update public.inventory_counts set status = 'rejected', reviewed_at = now(), reviewed_by_name = who,
           review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_count;
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (k.branch_id, 'count', what || ' not approved' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '') || '. Stock wasn''t changed.', who);
    return 0;
  end if;
  for l in select * from public.inventory_count_lines where count_id = p_count and counted_qty is not null and not applied loop
    diff := l.counted_qty - coalesce(l.system_qty, 0);
    dt := coalesce((l.counted_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date);
    if l.lot_id is not null then
      if diff <> 0 then
        update public.inventory_lots set adj_unsynced = adj_unsynced + diff, updated_at = now() where id = l.lot_id;
        insert into public.inventory_log (branch_id, kind, sku, message, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': lot ' || coalesce(l.lot_no, '(no lot #)') || ' counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0))
                  || '). Adj on FOAM LOTS ' || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || who || '.',
                coalesce(l.counted_by_name, who));
        n := n + 1;
      end if;
    else
      update public.inventory
         set on_hand = coalesce(on_hand, 0) + diff, last_counted = dt, counted_by = left(coalesce(l.counted_by_name, who), 80),
             count_dirty = true, updated_at = now(), updated_by_name = who
       where branch_id = k.branch_id and product_id = l.product_id;
      if diff <> 0 then
        insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0)) || '), '
                  || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || who || '.',
                l.system_qty, l.counted_qty, coalesce(l.counted_by_name, who));
        n := n + 1;
      end if;
    end if;
    update public.inventory_count_lines set applied = true where id = l.id;
  end loop;
  update public.inventory_counts set status = 'approved', reviewed_at = now(), reviewed_by_name = who,
         review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_count;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = k.branch_id;
  return n;
end $$;

-- ---------- Expected deliveries (incoming trucks) -------------------------
create table if not exists public.inbound_deliveries (
  id               bigint generated always as identity primary key,
  branch_id        text not null references public.branches(id) on update cascade on delete cascade,
  vendor           text not null,
  expected_on      date not null,
  ref              text,                                -- PO #, BOL #, carrier
  note             text,
  status           text not null default 'expected',    -- expected | received | cancelled
  created_by_name  text,
  created_at       timestamptz not null default now(),
  received_at      timestamptz,
  received_by_name text
);
do $$ begin
  alter table public.inbound_deliveries add constraint inbound_status_check check (status in ('expected', 'received', 'cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists inbound_deliveries_day_idx on public.inbound_deliveries(branch_id, expected_on);

create table if not exists public.inbound_lines (
  id           bigint generated always as identity primary key,
  delivery_id  bigint not null references public.inbound_deliveries(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  sku          text not null,
  name         text,
  unit         text,
  qty          numeric(12,2) not null,
  received_qty numeric(12,2),
  lot_no       text,
  mfg          date,
  exp          date
);
create index if not exists inbound_lines_delivery_idx on public.inbound_lines(delivery_id);

alter table public.inbound_deliveries enable row level security;
alter table public.inbound_lines enable row level security;
drop policy if exists inbound_deliveries_read on public.inbound_deliveries;
drop policy if exists inbound_lines_read on public.inbound_lines;
create policy inbound_deliveries_read on public.inbound_deliveries for select to authenticated using (public.is_employee());
create policy inbound_lines_read on public.inbound_lines for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.inbound_deliveries, public.inbound_lines from anon, authenticated;
grant select on public.inbound_deliveries, public.inbound_lines to authenticated;

-- Add or change an expected delivery. p_lines: [{"product_id": "...", "qty": 4}]
create or replace function public.inbound_save(p_id bigint, p_branch text, p_vendor text, p_expected date, p_ref text, p_note text, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    public.inbound_deliveries;
  v_id bigint := p_id;
  ln   jsonb;
  p    public.products;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  if coalesce(trim(p_vendor), '') = '' then raise exception 'Who is it coming from?'; end if;
  if p_expected is null then raise exception 'Pick the day it''s expected.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if v_id is null then
    if not exists (select 1 from public.branches b where b.id = p_branch) then raise exception 'Pick the location.'; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, note, created_by_name)
    values (p_branch, left(trim(p_vendor), 120), p_expected, nullif(left(trim(coalesce(p_ref, '')), 120), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''), public.my_name())
    returning inbound_deliveries.id into v_id;
  else
    select * into d from public.inbound_deliveries where inbound_deliveries.id = p_id for update;
    if d.id is null then raise exception 'Delivery not found.'; end if;
    if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
    update public.inbound_deliveries
       set vendor = left(trim(p_vendor), 120), expected_on = p_expected, ref = nullif(left(trim(coalesce(p_ref, '')), 120), ''),
           note = nullif(left(trim(coalesce(p_note, '')), 500), '')
     where inbound_deliveries.id = p_id;
    delete from public.inbound_lines where delivery_id = p_id;
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where products.id = (ln ->> 'product_id')::uuid;
    if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
    if coalesce((ln ->> 'qty')::numeric, 0) <= 0 then raise exception 'Enter how many % are coming.', p.sku; end if;
    insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty)
    values (v_id, p.id, p.sku, p.name, p.unit, round((ln ->> 'qty')::numeric, 2));
  end loop;
  return v_id;
end $$;

create or replace function public.inbound_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  update public.inbound_deliveries set status = 'cancelled' where id = p_id and status = 'expected';
end $$;

-- Received. p_lines: [{"id": 12, "received_qty": 4, "lot_no": "PA123", "mfg": "2026-10-01", "exp": "2027-10-01"}]
-- Items counted by lot (spray foam) need a lot #: a new lot goes onto FOAM LOTS, a lot already there gets Shipped In.
create or replace function public.inbound_receive(p_id bigint, p_lines jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d   public.inbound_deliveries;
  ln  jsonb;
  l   public.inbound_lines;
  q   numeric;
  lot public.inventory_lots;
  ln_lot text;
  who text := coalesce(public.my_name(), 'AMBITION');
  b   numeric;
  n   int := 0;
  lotted boolean;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = p_id;
    if l.id is null then continue; end if;
    q := round(coalesce((ln ->> 'received_qty')::numeric, l.qty), 2);
    if q < 0 then raise exception 'Received can''t be below zero (%).', l.sku; end if;
    ln_lot := nullif(upper(trim(coalesce(ln ->> 'lot_no', ''))), '');
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    update public.inbound_lines
       set received_qty = q, lot_no = ln_lot, mfg = nullif(ln ->> 'mfg', '')::date, exp = nullif(ln ->> 'exp', '')::date
     where id = l.id;
    if q = 0 then continue; end if;
    if lotted then
      if ln_lot is null then raise exception 'Enter the lot # for % (spray foam is tracked by lot).', l.sku; end if;
      select * into lot from public.inventory_lots where branch_id = d.branch_id and product_id = l.product_id and upper(lot_no) = ln_lot;
      if lot.id is not null then
        update public.inventory_lots set in_unsynced = in_unsynced + q, updated_at = now() where id = lot.id;
      else
        insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
        values (d.branch_id, l.product_id, l.sku, ln_lot, nullif(ln ->> 'mfg', '')::date, nullif(ln ->> 'exp', '')::date, q,
                l.name, 'Received in the app from ' || d.vendor, false, true, 100000);
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || d.vendor || ', lot ' || ln_lot || ' (goes onto FOAM LOTS).', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + q, updated_at = now(), updated_by_name = who
       where branch_id = d.branch_id and product_id = l.product_id
      returning on_hand - q into b;
      if not found then
        raise exception '% isn''t on this location''s inventory sheet. Add it to the COUNT SHEET first.', l.sku;
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || d.vendor || '.', b, b + q, who);
    end if;
    n := n + 1;
  end loop;
  update public.inbound_deliveries set status = 'received', received_at = now(), received_by_name = who where id = p_id;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = d.branch_id;
  return n;
end $$;

-- ---------- Sales goal (Sales widget) -------------------------------------
alter table public.profiles add column if not exists monthly_goal numeric(12,2);
create or replace function public.admin_set_goal(p_user uuid, p_goal numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can set sales goals.'; end if;
  if p_goal is not null and p_goal < 0 then raise exception 'A goal can''t be below zero.'; end if;
  update public.profiles set monthly_goal = nullif(round(p_goal, 2), 0) where id = p_user;
end $$;

-- ---------- Who can call what ---------------------------------------------
revoke all on function public.inventory_lot_fold(bigint, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.inventory_lot_fold(bigint, text, numeric, numeric) to service_role;
revoke all on function public.count_system_qty(text, uuid, bigint) from public, anon;
revoke all on function public.count_finish(bigint) from public, anon, authenticated;
revoke all on function public.spot_check_ensure(text) from public, anon;
revoke all on function public.count_line_save(bigint, numeric, text) from public, anon;
revoke all on function public.count_submit(bigint) from public, anon;
revoke all on function public.count_start_reconcile(text) from public, anon;
revoke all on function public.count_review(bigint, boolean, text) from public, anon;
revoke all on function public.inbound_save(bigint, text, text, date, text, text, jsonb) from public, anon;
revoke all on function public.inbound_cancel(bigint) from public, anon;
revoke all on function public.inbound_receive(bigint, jsonb) from public, anon;
revoke all on function public.admin_set_goal(uuid, numeric) from public, anon;
grant execute on function public.count_system_qty(text, uuid, bigint) to authenticated;
grant execute on function public.spot_check_ensure(text) to authenticated;
grant execute on function public.count_line_save(bigint, numeric, text) to authenticated;
grant execute on function public.count_submit(bigint) to authenticated;
grant execute on function public.count_start_reconcile(text) to authenticated;
grant execute on function public.count_review(bigint, boolean, text) to authenticated;
grant execute on function public.inbound_save(bigint, text, text, date, text, text, jsonb) to authenticated;
grant execute on function public.inbound_cancel(bigint) to authenticated;
grant execute on function public.inbound_receive(bigint, jsonb) to authenticated;
grant execute on function public.admin_set_goal(uuid, numeric) to authenticated;

select 'home widgets, counts and incoming deliveries ready' as status;
