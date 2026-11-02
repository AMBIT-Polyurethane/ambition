-- =====================================================================
-- AMBIT Intelligence update 0041 - Receiving approval, lot / batch tracking, and editing orders
-- * Receiving Reports wait for an admin: whoever unloads the truck fills in the report and taps
--   "Send for approval"; stock and the location's spreadsheet only change when an admin approves it
--   (an admin's own report goes straight in). Each line can say how many arrived damaged (they don't
--   go into stock).
-- * Lot / Batch # and Expiration for anything that expires (Admin > Products: "Track lot & expiration",
--   plus a shelf life so the expiration fills itself in from the Mfg date). Spray foam drums keep using
--   FOAM LOTS; everything else is logged on a RECEIVED LOTS tab on the location's spreadsheet.
-- * Edit order: AMBIT staff add items or change / remove quantities on an open order. Once the CRM has
--   entered the Sales Order # and Invoice #, an edit sends the order back to the CRM ("Invoice update");
--   when the new Invoice # and prices are in, credit is checked again only if the total went up.
-- * Approve without customer email approval: staff can move an order past the customer step.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Products: lot & expiration -------------------------------------------------------------
alter table public.products add column if not exists track_lots boolean not null default false;
alter table public.products add column if not exists shelf_life_months int;
do $$ begin
  alter table public.products add constraint products_shelf_life_check check (shelf_life_months is null or shelf_life_months between 1 and 120);
exception when duplicate_object then null; end $$;

-- The first time only: everything that expires is tracked (an admin can switch any product off).
do $$ begin
  if not exists (select 1 from public.products where track_lots) then
    update public.products set track_lots = true
     where category_id in ('ambit-foam', 'spray-foam', 'gun-foam', 'sealants-adhesives', 'intumescent-coatings',
                           'roof-coatings-and-sealants', 'alpha-chemicals');
    update public.products set shelf_life_months = 12 where category_id = 'ambit-foam' and shelf_life_months is null;
  end if;
end $$;

-- ---------- Receiving Reports: waiting for an admin ------------------------------------------------
alter table public.inbound_deliveries drop constraint if exists inbound_status_check;
alter table public.inbound_deliveries add constraint inbound_status_check
  check (status in ('expected', 'submitted', 'received', 'cancelled'));
alter table public.inbound_deliveries add column if not exists submitted_at      timestamptz;
alter table public.inbound_deliveries add column if not exists submitted_by_name text;
alter table public.inbound_deliveries add column if not exists approved_at       timestamptz;
alter table public.inbound_deliveries add column if not exists approved_by_name  text;
alter table public.inbound_deliveries add column if not exists sent_back_at      timestamptz;
alter table public.inbound_deliveries add column if not exists sent_back_by_name text;
alter table public.inbound_deliveries add column if not exists sent_back_note    text;
alter table public.inbound_lines      add column if not exists damaged_qty       numeric(12,2) not null default 0;
create index if not exists inbound_deliveries_submitted_idx on public.inbound_deliveries(submitted_at) where status = 'submitted';

-- Lots / batches of everything that isn't counted on FOAM LOTS (it's logged on RECEIVED LOTS).
create table if not exists public.inventory_batches (
  id               bigint generated always as identity primary key,
  branch_id        text not null references public.branches(id) on update cascade on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  sku              text not null,
  name             text,
  lot_no           text not null,
  mfg              date,
  exp              date,
  qty              numeric(12,2) not null,
  received_on      date not null,
  delivery_id      bigint references public.inbound_deliveries(id) on delete set null,
  vendor           text,
  bol_no           text,
  received_by_name text,
  approved_by_name text,
  on_sheet         boolean not null default false,
  sheet_row        int,
  created_at       timestamptz not null default now()
);
create index if not exists inventory_batches_exp_idx on public.inventory_batches(branch_id, exp);
create index if not exists inventory_batches_product_idx on public.inventory_batches(branch_id, product_id, received_on desc);
create index if not exists inventory_batches_sheet_idx on public.inventory_batches(branch_id) where not on_sheet;
alter table public.inventory_batches enable row level security;
drop policy if exists inventory_batches_read on public.inventory_batches;
drop policy if exists inventory_batches_private on public.inventory_batches;
create policy inventory_batches_read on public.inventory_batches for select to authenticated using (public.is_employee());
create policy inventory_batches_private on public.inventory_batches as restrictive for select to authenticated
  using (not (product_id = any(coalesce((select public.hidden_products()), '{}'::uuid[]))));
revoke insert, update, delete on public.inventory_batches from anon, authenticated;
grant select on public.inventory_batches to authenticated;
grant all on public.inventory_batches to service_role;  -- the spreadsheet sync

-- Received. p_lines: [{"id": 12, "received_qty": 4, "damaged_qty": 0, "lot_no": "PA123", "mfg": "2026-10-01", "exp": "2027-10-01"}]
-- Anyone who receives saves what came; it only goes into stock when an admin receives or approves it.
-- Spray foam on FOAM LOTS needs a lot #; anything with "Track lot & expiration" needs a lot / batch # and
-- an expiration (filled in from the Mfg date and shelf life when there is one). Damaged doesn't go into stock.
create or replace function public.inbound_receive(p_id bigint, p_lines jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d      public.inbound_deliveries;
  ln     jsonb;
  l      public.inbound_lines;
  p      public.products;
  q      numeric;
  dq     numeric;
  g      numeric;
  lot    public.inventory_lots;
  ln_lot text;
  who    text := coalesce(public.my_name(), 'AMBITION');
  admin  boolean := public.is_admin();
  b      numeric;
  n      int := 0;
  lotted boolean;
  src    text;
  v_day  date;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status = 'submitted' and not admin then raise exception 'This Receiving Report is waiting for an admin to approve it.'; end if;
  if d.status not in ('expected', 'submitted') then raise exception 'This delivery was already %.', d.status; end if;
  src := case when d.transfer_id is not null then d.vendor || ' (transfer T-' || d.transfer_id || ')' else d.vendor end;

  -- 1. What came, line by line.
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = p_id;
    if l.id is null then continue; end if;
    q  := round(coalesce(nullif(ln ->> 'received_qty', '')::numeric, l.qty), 2);
    dq := round(coalesce(nullif(ln ->> 'damaged_qty', '')::numeric, 0), 2);
    if q < 0 or dq < 0 then raise exception 'Quantities can''t be below zero (%).', l.sku; end if;
    if dq > q then raise exception 'More % arrived damaged (%) than came (%).', l.sku, trim_scale(dq), trim_scale(q); end if;
    update public.inbound_lines
       set received_qty = q, damaged_qty = dq,
           lot_no = coalesce(nullif(upper(trim(coalesce(ln ->> 'lot_no', ''))), ''), lot_no),
           mfg = coalesce(nullif(ln ->> 'mfg', '')::date, mfg),
           exp = coalesce(nullif(ln ->> 'exp', '')::date, exp)
     where id = l.id;
  end loop;

  -- 2. Lot numbers and expirations on everything that goes into stock.
  for l in select * from public.inbound_lines where delivery_id = p_id order by id loop
    g := coalesce(l.received_qty, 0) - coalesce(l.damaged_qty, 0);
    if g <= 0 then continue; end if;
    select * into p from public.products where id = l.product_id;
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    if nullif(trim(coalesce(l.lot_no, '')), '') is null and (lotted or coalesce(p.track_lots, false)) then
      raise exception 'Enter the lot / batch # for %.', l.sku;
    end if;
    if not lotted and coalesce(p.track_lots, false) then
      if l.exp is null and l.mfg is not null and p.shelf_life_months is not null then
        update public.inbound_lines set exp = (l.mfg + make_interval(months => p.shelf_life_months))::date where id = l.id;
      elsif l.exp is null then
        raise exception 'Enter the expiration date for % (or its Mfg date%).', l.sku,
          case when p.shelf_life_months is null then ' and a shelf life in Admin > Products' else '' end;
      end if;
    end if;
  end loop;

  -- 3. Not an admin: it waits for one.
  if not admin then
    update public.inbound_deliveries
       set status = 'submitted', submitted_at = now(), submitted_by_name = who, received_by_name = who,
           sent_back_at = null, sent_back_by_name = null, sent_back_note = null
     where id = p_id;
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (d.branch_id, 'received', 'Receiving Report from ' || src || ' sent to an admin for approval (stock changes once it''s approved).', who);
    return (select count(*) from public.inbound_lines where delivery_id = p_id and coalesce(received_qty, 0) > 0)::int;
  end if;

  -- 4. An admin: into stock (and the spreadsheet).
  v_day := coalesce((d.submitted_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date);
  for l in select * from public.inbound_lines where delivery_id = p_id order by id loop
    q  := coalesce(l.received_qty, 0);
    dq := coalesce(l.damaged_qty, 0);
    g  := q - dq;
    if dq > 0 then
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, trim_scale(dq) || ' arrived damaged from ' || src || ' (not put in stock).', who);
    end if;
    if g <= 0 then continue; end if;
    select * into p from public.products where id = l.product_id;
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    if lotted then
      ln_lot := nullif(upper(trim(coalesce(l.lot_no, ''))), '');
      select * into lot from public.inventory_lots where branch_id = d.branch_id and product_id = l.product_id and upper(lot_no) = ln_lot;
      if lot.id is not null then
        update public.inventory_lots set in_unsynced = in_unsynced + g, updated_at = now() where id = lot.id;
      else
        insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
        values (d.branch_id, l.product_id, l.sku, ln_lot, l.mfg, l.exp, g, l.name, 'Received in the app from ' || src, false, true, 100000);
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(g) || ' from ' || src || ', lot ' || ln_lot || ' (goes onto FOAM LOTS).', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + g, updated_at = now(), updated_by_name = who
       where branch_id = d.branch_id and product_id = l.product_id
      returning on_hand - g into b;
      if not found then
        raise exception '% isn''t on this location''s inventory sheet. Add it to the COUNT SHEET first.', l.sku;
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (d.branch_id, 'received', l.sku,
              'Received ' || trim_scale(g) || ' from ' || src || coalesce(', lot ' || nullif(upper(trim(coalesce(l.lot_no, ''))), ''), '') || '.',
              b, b + g, who);
      if coalesce(p.track_lots, false) and nullif(trim(coalesce(l.lot_no, '')), '') is not null then
        insert into public.inventory_batches (branch_id, product_id, sku, name, lot_no, mfg, exp, qty, received_on, delivery_id,
                                              vendor, bol_no, received_by_name, approved_by_name)
        values (d.branch_id, l.product_id, l.sku, l.name, upper(trim(l.lot_no)), l.mfg, l.exp, g, v_day, d.id,
                src, d.bol_no, coalesce(d.submitted_by_name, who), who);
      end if;
    end if;
    n := n + 1;
  end loop;
  update public.inbound_deliveries
     set status = 'received', received_at = now(), received_by_name = coalesce(d.submitted_by_name, who),
         approved_at = now(), approved_by_name = who, sent_back_at = null, sent_back_by_name = null, sent_back_note = null
   where id = p_id;
  if d.transfer_id is not null then
    update public.inventory_transfers set status = 'received', received_at = now(), received_by_name = coalesce(d.submitted_by_name, who)
     where id = d.transfer_id and status = 'in_transit';
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = d.branch_id;
  return n;
end $$;

-- Receiving Report: what the BOL said and what came (see 0037). An admin can still change a report that's
-- waiting for approval; everyone else changes it while it's open.
create or replace function public.inbound_receive_report(p_id bigint, p_branch text, p_head jsonb, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d      public.inbound_deliveries;
  v_id   bigint := p_id;
  ln     jsonb;
  p      public.products;
  l      public.inbound_lines;
  keep   bigint[] := '{}';
  recv   jsonb := '[]'::jsonb;
  q      numeric;
  rq     numeric;
  v_day  date := coalesce(nullif(p_head ->> 'received_on', '')::date, (now() at time zone 'America/Chicago')::date);
  v_vendor text := left(trim(coalesce(p_head ->> 'vendor', '')), 120);
  v_files jsonb := case when jsonb_typeof(p_head -> 'files') = 'array' then p_head -> 'files' else '[]'::jsonb end;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  if exists (select 1 from jsonb_array_elements(v_files) f where coalesce(f ->> 'path', '') !~ '^[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$') then
    raise exception 'One of the files isn''t from this app.';
  end if;

  if v_id is null then
    if v_vendor = '' then raise exception 'Who is it from (the shipper on the BOL)?'; end if;
    if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then raise exception 'Pick the location it came to.'; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, created_by_name)
    values (p_branch, v_vendor, v_day, public.my_name())
    returning id into v_id;
  end if;
  select * into d from public.inbound_deliveries where id = v_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status = 'submitted' and not public.is_admin() then raise exception 'This Receiving Report is waiting for an admin to approve it.'; end if;
  if d.status not in ('expected', 'submitted') then raise exception 'This delivery was already %.', d.status; end if;

  update public.inbound_deliveries
     set vendor        = case when d.transfer_id is null and v_vendor <> '' then v_vendor else d.vendor end,
         bol_no        = coalesce(nullif(left(trim(coalesce(p_head ->> 'bol_no', '')), 60), ''), d.bol_no),
         po_no         = coalesce(nullif(left(trim(coalesce(p_head ->> 'po_no', '')), 60), ''), d.po_no),
         carrier       = coalesce(nullif(left(trim(coalesce(p_head ->> 'carrier', '')), 80), ''), d.carrier),
         note          = coalesce(nullif(left(trim(coalesce(p_head ->> 'note', '')), 500), ''), d.note),
         files         = d.files || v_files,
         read_by_ai    = d.read_by_ai or coalesce((p_head ->> 'read_by_ai')::boolean, false),
         ai_cost_cents = coalesce(d.ai_cost_cents, 0) + coalesce((p_head ->> 'ai_cost_cents')::numeric, 0)
   where id = v_id;

  for ln in select * from jsonb_array_elements(p_lines) loop
    rq := round(coalesce(nullif(ln ->> 'received_qty', '')::numeric, 0), 2);
    q  := round(coalesce(nullif(ln ->> 'qty', '')::numeric, rq), 2);
    if rq < 0 or q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    l := null;
    if nullif(ln ->> 'id', '') is not null then
      select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = v_id;
    end if;
    if l.id is not null then
      if d.transfer_id is null then
        select * into p from public.products where id = coalesce(nullif(ln ->> 'product_id', '')::uuid, l.product_id);
        if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
        update public.inbound_lines
           set product_id = p.id, sku = p.sku, name = p.name, unit = p.unit, qty = q,
               note = nullif(left(trim(coalesce(ln ->> 'note', '')), 300), '')
         where id = l.id;
      else
        update public.inbound_lines set note = nullif(left(trim(coalesce(ln ->> 'note', '')), 300), '') where id = l.id;
      end if;
    else
      if d.transfer_id is not null then raise exception 'Items can''t be added to a transfer here. Receive what came; anything extra goes on its own Receiving Report.'; end if;
      select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
      if p.id is null then raise exception 'Pick the item for every line (or remove the line).'; end if;
      insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty, note)
      values (v_id, p.id, p.sku, p.name, p.unit, q, nullif(left(trim(coalesce(ln ->> 'note', '')), 300), ''))
      returning * into l;
    end if;
    keep := keep || l.id;
    recv := recv || jsonb_build_object(
      'id', l.id, 'received_qty', rq,
      'damaged_qty', round(coalesce(nullif(ln ->> 'damaged_qty', '')::numeric, 0), 2),
      'lot_no', case when d.transfer_id is null then nullif(trim(coalesce(ln ->> 'lot_no', '')), '') else l.lot_no end,
      'mfg', case when d.transfer_id is null then nullif(ln ->> 'mfg', '') else l.mfg::text end,
      'exp', case when d.transfer_id is null then nullif(ln ->> 'exp', '') else l.exp::text end);
  end loop;

  if d.transfer_id is null then
    delete from public.inbound_lines where delivery_id = v_id and not (id = any(keep));
  else
    for l in select * from public.inbound_lines where delivery_id = v_id and not (id = any(keep)) loop
      recv := recv || jsonb_build_object('id', l.id, 'received_qty', 0);
    end loop;
  end if;

  perform public.inbound_receive(v_id, recv);
  return v_id;
end $$;

-- Admin: approve a Receiving Report as it was sent (stock and the spreadsheet update).
create or replace function public.inbound_approve(p_id bigint)
returns int
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.is_admin() then raise exception 'Only an admin can approve Receiving Reports.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'submitted' then raise exception 'This Receiving Report isn''t waiting for approval (it''s %).', d.status; end if;
  return public.inbound_receive(p_id, '[]'::jsonb);
end $$;

-- Admin: send a report back to whoever received it, with what to fix. Nothing went into stock.
create or replace function public.inbound_send_back(p_id bigint, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.is_admin() then raise exception 'Only an admin can send a Receiving Report back.'; end if;
  if length(coalesce(trim(p_note), '')) < 3 then raise exception 'Say what needs fixing.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'submitted' then raise exception 'This Receiving Report isn''t waiting for approval.'; end if;
  update public.inbound_deliveries
     set status = 'expected', sent_back_at = now(), sent_back_by_name = public.my_name(), sent_back_note = left(trim(p_note), 500)
   where id = p_id;
  insert into public.inventory_log (branch_id, kind, message, by_name)
  values (d.branch_id, 'received', 'Receiving Report from ' || d.vendor || ' sent back: ' || left(trim(p_note), 300), public.my_name());
end $$;

create or replace function public.inbound_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. The sending location cancels it (its stock goes back).'; end if;
  update public.inbound_deliveries set status = 'cancelled'
   where id = p_id and (status = 'expected' or (status = 'submitted' and public.is_admin()));
end $$;

-- The spreadsheet sync marks batches once they're on RECEIVED LOTS.
create or replace function public.inventory_batches_written(p_ids bigint[], p_rows int[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_batches b set on_sheet = true, sheet_row = r.row_no
    from unnest(p_ids, p_rows) as r(id, row_no)
   where b.id = r.id;
end $$;

revoke all on function public.inbound_approve(bigint) from public, anon;
revoke all on function public.inbound_send_back(bigint, text) from public, anon;
revoke all on function public.inventory_batches_written(bigint[], int[]) from public, anon, authenticated;
grant execute on function public.inventory_batches_written(bigint[], int[]) to service_role;
grant execute on function public.inbound_approve(bigint) to authenticated;
grant execute on function public.inbound_send_back(bigint, text) to authenticated;

-- ---------- Orders: editing --------------------------------------------------------------------------
alter table public.orders add column if not exists revision               int not null default 1;
alter table public.orders add column if not exists invoice_update_at      timestamptz;
alter table public.orders add column if not exists invoice_update_by_name text;
alter table public.orders add column if not exists invoiced_total         numeric(12,2);

create table if not exists public.order_edits (
  id                      bigint generated always as identity primary key,
  order_id                uuid not null references public.orders(id) on delete cascade,
  revision                int not null,
  edited_by               uuid,
  edited_by_name          text,
  edited_at               timestamptz not null default now(),
  stage_before            text,
  changes                 jsonb not null,   -- [{sku, name, unit, from, to}]
  total_before            numeric(12,2),
  note                    text,
  invoice_updated_at      timestamptz,
  invoice_updated_by_name text,
  total_after             numeric(12,2),
  credit_reopened         boolean
);
create index if not exists order_edits_order_idx on public.order_edits(order_id, edited_at);
alter table public.order_edits enable row level security;
drop policy if exists order_edits_read on public.order_edits;
create policy order_edits_read on public.order_edits for select to authenticated
  using (public.is_employee() and exists (select 1 from public.orders o where o.id = order_edits.order_id));
revoke insert, update, delete on public.order_edits from anon, authenticated;
grant select on public.order_edits to authenticated;
grant all on public.order_edits to service_role;

-- Where each order sits, now with "invoice_update": edited after the Invoice # was in, back with the CRM.
do $$ begin
  if not exists (select 1 from pg_attrdef a join pg_attribute t on t.attrelid = a.adrelid and t.attnum = a.adnum
                  where a.adrelid = 'public.orders'::regclass and t.attname = 'stage'
                    and pg_get_expr(a.adbin, a.adrelid) like '%invoice_update_at%') then
    alter table public.orders drop column if exists stage;
    alter table public.orders add column stage text generated always as (
      case
        when status = 'cancelled' then 'cancelled'
        when status = 'completed' then 'completed'
        when approval_status in ('pending', 'changes_requested') then 'customer'
        when ambit_po is null then 'needs_po'
        when invoice_update_at is not null then 'invoice_update'
        when credit_status = 'hold' then 'hold'
        when credit_status is distinct from 'approved' then 'credit'
        when scheduled_for is null then 'schedule'
        else 'scheduled'
      end) stored;
    create index if not exists orders_stage_idx on public.orders(stage);
  end if;
end $$;

-- A line taken off an order keeps its stock line, so the spreadsheet can show it as Cancelled.
alter table public.inventory_lines alter column order_item_id drop not null;
alter table public.inventory_lines drop constraint if exists inventory_lines_order_item_id_fkey;
alter table public.inventory_lines add constraint inventory_lines_order_item_id_fkey
  foreign key (order_item_id) references public.order_items(id) on delete set null;
alter table public.order_variances drop constraint if exists order_variances_order_item_id_fkey;
alter table public.order_variances add constraint order_variances_order_item_id_fkey
  foreign key (order_item_id) references public.order_items(id) on delete set null;

-- Holding stock for a line (0025), now also again after an edit releases the old amount.
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
  if exists (select 1 from public.inventory_lines
              where order_item_id = p_item and not (state = 'cancelled' and done_by in ('swap', 'edit'))) then return; end if;

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
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;

-- AMBIT staff edit an open order. p_lines is the whole order after the edit:
--   [{"id": 12, "qty": 4}]            a line already on it (qty 0 takes it off)
--   [{"product_id": "...", "qty": 2}] a new line
-- Changed lines let go of their stock (the spreadsheet shows those rows Cancelled) and hold the new amount.
-- Once the Sales Order # is in, the order goes back to the CRM for an invoice update.
create or replace function public.order_edit(p_order uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders;
  it       public.order_items;
  e        jsonb;
  q        numeric;
  pr       record;
  who      text := coalesce(public.my_name(), 'AMBIT');
  changes  jsonb := '[]'::jsonb;
  before   numeric;
  stage0   text;
  invoiced boolean;
  rev      int;
begin
  if not public.is_employee() or not (public.is_admin() or public.has_perm('ordering') or public.has_perm('order_desk')) then
    raise exception 'You don''t have access to edit orders.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %. Place a new order instead.', o.status; end if;
  before := o.est_subtotal;
  stage0 := o.stage;
  invoiced := o.ambit_po is not null;

  -- Lines already on the order
  for it in select * from public.order_items where order_id = p_order order by id loop
    select x into e from jsonb_array_elements(p_lines) x where nullif(x ->> 'id', '')::bigint = it.id limit 1;
    q := case when e is null then 0 else round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2) end;
    if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    if q = it.qty then continue; end if;
    if exists (select 1 from public.inventory_lines where order_item_id = it.id and state = 'done') then
      raise exception '% was already picked up on the spreadsheet, so it can''t be changed here.', it.sku;
    end if;
    update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now()
     where order_item_id = it.id and state = 'reserved';
    changes := changes || jsonb_build_object('sku', it.sku, 'name', it.name, 'unit', it.unit, 'from', it.qty, 'to', q);
    if q = 0 then
      delete from public.order_items where id = it.id;
    else
      update public.order_items
         set qty = q,
             unit_price = case when price_parts is null then unit_price end,
             line_total = case when price_parts is null and unit_price is not null then round(unit_price * q, 2) end,
             price_parts = null
       where id = it.id;
      perform public.inventory_pick(it.id);
    end if;
  end loop;

  -- New lines (priced like a new order: the CRM puts the invoice price on them)
  for e in select * from jsonb_array_elements(p_lines) loop
    if nullif(e ->> 'id', '') is not null then continue; end if;
    q := round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false) and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p left join public.categories c on c.id = p.category_id
     where p.id = nullif(e ->> 'product_id', '')::uuid and p.active;
    if pr.id is null then raise exception 'One of the new items isn''t available any more. Reload and try again.'; end if;
    if exists (select 1 from public.order_items where order_id = p_order and product_id = pr.id) then
      raise exception '% is already on this order. Change its quantity instead.', pr.sku;
    end if;
    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (p_order, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end, pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end);
    changes := changes || jsonb_build_object('sku', pr.sku, 'name', pr.name, 'unit', pr.unit, 'from', 0, 'to', q);
  end loop;

  if jsonb_array_length(changes) = 0 then raise exception 'Nothing changed.'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'An order needs at least one item. Cancel the order instead.';
  end if;
  -- ISO priced per foam set: the sets may have changed, so the CRM prices it again.
  update public.order_items set unit_price = null, line_total = null, price_parts = null
   where order_id = p_order and price_parts is not null;

  update public.orders
     set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
         has_customer_pricing = exists (select 1 from public.order_items i where i.order_id = p_order and i.customer_priced),
         revision = revision + 1,
         invoiced_total = case when invoiced then coalesce(invoiced_total, before) else invoiced_total end,
         invoice_update_at = case when invoiced then coalesce(invoice_update_at, now()) else invoice_update_at end,
         invoice_update_by_name = case when invoiced then who else invoice_update_by_name end
   where id = p_order
  returning revision into rev;

  insert into public.order_edits (order_id, revision, edited_by, edited_by_name, stage_before, changes, total_before, note)
  values (p_order, rev, auth.uid(), who, stage0, changes, before, nullif(left(trim(coalesce(p_note, '')), 500), ''));
  if o.branch_id is not null then
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  end if;
  return jsonb_build_object('revision', rev, 'invoice_update', invoiced,
                            'customer', o.approval_status in ('pending', 'changes_requested'), 'changes', changes);
end $$;

-- CRM: the new Invoice # and prices are in after an edit (call right after order_set_numbers).
-- Credit is checked again only when the total went up.
create or replace function public.order_invoice_update_done(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders;
  newt   numeric;
  oldt   numeric;
  reopen boolean;
  ch     jsonb;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.invoice_update_at is null then return jsonb_build_object('was', false); end if;
  if exists (select 1 from public.order_items i where i.order_id = p_order and i.unit_price is null and not i.customer_priced) then
    raise exception 'Enter the invoice price for every line first.';
  end if;
  newt := coalesce(o.est_subtotal, 0);
  oldt := coalesce(o.invoiced_total, newt);
  reopen := newt > oldt + 0.004 and o.credit_status = 'approved';
  update public.orders
     set invoice_update_at = null, invoice_update_by_name = null, invoiced_total = newt,
         credit_status = case when reopen then 'pending' else credit_status end,
         credit_note = case when reopen then 'Check again: the order was edited and the total went from $' || to_char(oldt, 'FM999,999,990.00')
                                              || ' to $' || to_char(newt, 'FM999,999,990.00') || '.' else credit_note end
   where id = p_order;
  select coalesce(jsonb_agg(c order by e.id), '[]'::jsonb) into ch
    from public.order_edits e, jsonb_array_elements(e.changes) c
   where e.order_id = p_order and e.invoice_updated_at is null;
  update public.order_edits
     set invoice_updated_at = now(), invoice_updated_by_name = public.my_name(), total_after = newt, credit_reopened = reopen
   where order_id = p_order and invoice_updated_at is null;
  return jsonb_build_object('was', true, 'reopened', reopen, 'before', oldt, 'after', newt, 'changes', ch);
end $$;

-- Closing an order: not while it's waiting for an invoice update or a credit check.
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
  if o.invoice_update_at is not null then raise exception 'This order was edited. The CRM updates the invoice first.'; end if;
  if o.credit_status is distinct from 'approved' then raise exception 'Credit has to be approved (again) before this order is picked up or delivered.'; end if;
  if not exists (select 1 from public.order_files f where f.order_id = p_order and f.kind = 'bol') then
    raise exception 'Add a photo or scan of the signed BOL first.';
  end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order;
end $$;

-- Staff: approve an order without the customer's email approval (by phone, in person, or not needed).
create or replace function public.order_approve_without_customer(p_order uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me public.profiles;
begin
  if not public.is_employee() then raise exception 'Only AMBIT staff can approve orders.'; end if;
  select * into me from public.profiles where id = auth.uid();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status not in ('pending', 'changes_requested', 'not_required') then raise exception 'This order is not waiting for the customer.'; end if;
  update public.orders
     set approval_status = 'approved', approval_method = 'staff_recorded',
         approved_at = now(), approved_by_name = coalesce(me.full_name, me.email),
         approval_note = left(coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Approved without customer email approval'), 500),
         approval_token_hash = null,
         email_status = 'pending', email_error = null
   where id = p_order;
end $$;

revoke all on function public.order_edit(uuid, jsonb, text) from public, anon;
revoke all on function public.order_invoice_update_done(uuid) from public, anon;
revoke all on function public.order_approve_without_customer(uuid, text) from public, anon;
grant execute on function public.order_edit(uuid, jsonb, text) to authenticated;
grant execute on function public.order_invoice_update_done(uuid) to authenticated;
grant execute on function public.order_approve_without_customer(uuid, text) to authenticated;

select 'receiving approval, lot tracking and order edits ready' as status;
