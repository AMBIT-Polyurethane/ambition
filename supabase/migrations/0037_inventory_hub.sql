-- =====================================================================
-- AMBIT Intelligence update 0037 - Inventory Hub for warehouse managers
-- * Three new permissions, turned on or off per person in Admin > Users:
--     receiving   - Receiving Reports: upload a BOL (photo or PDF), the app fills it in, the manager checks it
--     transfers   - send stock to another AMBIT location (lots go with the drums)
--     inv_reports - the Inventory Hub dashboard and reports (KPIs, charts, aging, expiring lots)
--   Everyone who has Inventory today gets all three, so nobody loses anything.
-- * Receiving Reports: what the BOL said and what actually came, with the BOL attached. Stock and
--   FOAM LOTS update when the manager taps Receive (same as Incoming deliveries).
-- * Transfers: stock comes off the sending location when it's sent and shows as an incoming delivery
--   at the other location until it's received there.
-- Files live in the private "inventory-files" storage bucket (AMBIT staff only).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Permissions -----------------------------------------------------------------------
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports']
$$;

update public.profiles p
   set perms = p.perms || array(select x from unnest(array['receiving', 'transfers', 'inv_reports']) x where not x = any(p.perms))
 where p.role = 'employee' and p.perms is not null and 'inventory' = any(p.perms)
   and not (array['receiving', 'transfers', 'inv_reports'] <@ p.perms);

create or replace function public.can_receive() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('inventory') or public.has_perm('receiving')
$$;

-- ---------- Receiving Reports: more on each delivery ------------------------------------------
alter table public.inbound_deliveries add column if not exists bol_no        text;
alter table public.inbound_deliveries add column if not exists po_no         text;
alter table public.inbound_deliveries add column if not exists carrier       text;
alter table public.inbound_deliveries add column if not exists files         jsonb not null default '[]'::jsonb;  -- [{path, name}] in inventory-files
alter table public.inbound_deliveries add column if not exists read_by_ai    boolean not null default false;
alter table public.inbound_deliveries add column if not exists ai_cost_cents numeric(10,3);
alter table public.inbound_deliveries add column if not exists transfer_id   bigint;
alter table public.inbound_lines      add column if not exists note          text;
create index if not exists inbound_deliveries_received_idx on public.inbound_deliveries(branch_id, received_at desc) where status = 'received';

-- ---------- Transfers between AMBIT locations -------------------------------------------------
create table if not exists public.inventory_transfers (
  id                bigint generated always as identity (start with 1001) primary key,
  from_branch       text not null references public.branches(id) on update cascade,
  to_branch         text not null references public.branches(id) on update cascade,
  status            text not null default 'in_transit',   -- in_transit | received | cancelled
  arrive_on         date,
  ref               text,                                  -- BOL # / trailer / driver
  note              text,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  received_at       timestamptz,
  received_by_name  text,
  cancelled_at      timestamptz,
  cancelled_by_name text,
  delivery_id       bigint references public.inbound_deliveries(id) on delete set null
);
do $$ begin
  alter table public.inventory_transfers add constraint inventory_transfers_status_check check (status in ('in_transit', 'received', 'cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists inventory_transfers_from_idx on public.inventory_transfers(from_branch, created_at desc);
create index if not exists inventory_transfers_to_idx on public.inventory_transfers(to_branch, created_at desc);

create table if not exists public.inventory_transfer_lines (
  id           bigint generated always as identity primary key,
  transfer_id  bigint not null references public.inventory_transfers(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  sku          text not null,
  name         text,
  unit         text,
  qty          numeric(12,2) not null,
  lot_id       bigint references public.inventory_lots(id) on delete set null,
  lot_no       text,
  mfg          date,
  exp          date
);
create index if not exists inventory_transfer_lines_idx on public.inventory_transfer_lines(transfer_id);

do $$ begin
  alter table public.inbound_deliveries add constraint inbound_deliveries_transfer_fk foreign key (transfer_id) references public.inventory_transfers(id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_lines enable row level security;
drop policy if exists inventory_transfers_read on public.inventory_transfers;
drop policy if exists inventory_transfer_lines_read on public.inventory_transfer_lines;
create policy inventory_transfers_read on public.inventory_transfers for select to authenticated using (public.is_employee());
create policy inventory_transfer_lines_read on public.inventory_transfer_lines for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.inventory_transfers, public.inventory_transfer_lines from anon, authenticated;
grant select on public.inventory_transfers, public.inventory_transfer_lines to authenticated;

-- ---------- Files (BOLs, packing slips) ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-files', 'inventory-files', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inventory_files_obj_read   on storage.objects;
drop policy if exists inventory_files_obj_insert on storage.objects;
drop policy if exists inventory_files_obj_delete on storage.objects;
create policy inventory_files_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'inventory-files' and public.is_employee());
create policy inventory_files_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'inventory-files' and (public.can_receive() or public.has_perm('transfers')));
create policy inventory_files_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'inventory-files' and public.is_admin());

-- ---------- Expected deliveries: receiving staff too; transfers are changed on the transfer ----------
create or replace function public.inbound_save(p_id bigint, p_branch text, p_vendor text, p_expected date, p_ref text, p_note text, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  d    public.inbound_deliveries;
  v_id bigint := p_id;
  ln   jsonb;
  p    public.products;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
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
    if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. Change it on the transfer.'; end if;
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
declare d public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. The sending location cancels it (its stock goes back).'; end if;
  update public.inbound_deliveries set status = 'cancelled' where id = p_id and status = 'expected';
end $$;

-- Received. p_lines: [{"id": 12, "received_qty": 4, "lot_no": "PA123", "mfg": "2026-10-01", "exp": "2027-10-01"}]
-- Items counted by lot (spray foam) need a lot #: a new lot goes onto FOAM LOTS, a lot already there gets Shipped In.
-- A transfer from another AMBIT location is marked received too.
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
  src text;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Delivery not found.'; end if;
  if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;
  src := case when d.transfer_id is not null then d.vendor || ' (transfer T-' || d.transfer_id || ')' else d.vendor end;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.inbound_lines where id = (ln ->> 'id')::bigint and delivery_id = p_id;
    if l.id is null then continue; end if;
    q := round(coalesce((ln ->> 'received_qty')::numeric, l.qty), 2);
    if q < 0 then raise exception 'Received can''t be below zero (%).', l.sku; end if;
    ln_lot := nullif(upper(trim(coalesce(ln ->> 'lot_no', ''))), '');
    lotted := exists (select 1 from public.inventory_lots x where x.branch_id = d.branch_id and x.product_id = l.product_id);
    update public.inbound_lines
       set received_qty = q, lot_no = coalesce(ln_lot, lot_no),
           mfg = coalesce(nullif(ln ->> 'mfg', '')::date, mfg), exp = coalesce(nullif(ln ->> 'exp', '')::date, exp)
     where id = l.id
     returning * into l;
    if q = 0 then continue; end if;
    if lotted then
      ln_lot := nullif(upper(trim(coalesce(l.lot_no, ''))), '');
      if ln_lot is null then raise exception 'Enter the lot # for % (spray foam is tracked by lot).', l.sku; end if;
      select * into lot from public.inventory_lots where branch_id = d.branch_id and product_id = l.product_id and upper(lot_no) = ln_lot;
      if lot.id is not null then
        update public.inventory_lots set in_unsynced = in_unsynced + q, updated_at = now() where id = lot.id;
      else
        insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
        values (d.branch_id, l.product_id, l.sku, ln_lot, l.mfg, l.exp, q,
                l.name, 'Received in the app from ' || src, false, true, 100000);
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || src || ', lot ' || ln_lot || ' (goes onto FOAM LOTS).', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + q, updated_at = now(), updated_by_name = who
       where branch_id = d.branch_id and product_id = l.product_id
      returning on_hand - q into b;
      if not found then
        raise exception '% isn''t on this location''s inventory sheet. Add it to the COUNT SHEET first.', l.sku;
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (d.branch_id, 'received', l.sku, 'Received ' || trim_scale(q) || ' from ' || src || '.', b, b + q, who);
    end if;
    n := n + 1;
  end loop;
  update public.inbound_deliveries set status = 'received', received_at = now(), received_by_name = who where id = p_id;
  if d.transfer_id is not null then
    update public.inventory_transfers set status = 'received', received_at = now(), received_by_name = who
     where id = d.transfer_id and status = 'in_transit';
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = d.branch_id;
  return n;
end $$;

-- ---------- Receiving Report: what the BOL said and what came, received in one go --------------------
-- p_head:  {"vendor", "bol_no", "po_no", "carrier", "received_on", "note", "files": [{path, name}], "read_by_ai", "ai_cost_cents"}
-- p_lines: [{"id" (a line already on the delivery), "product_id", "qty" (on the BOL / expected), "received_qty",
--            "lot_no", "mfg", "exp", "note"}]
-- New report: p_id null. Against an expected delivery (or a transfer): p_id is that delivery.
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
  if d.status <> 'expected' then raise exception 'This delivery was already %.', d.status; end if;

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
      'lot_no', case when d.transfer_id is null then nullif(trim(coalesce(ln ->> 'lot_no', '')), '') else l.lot_no end,
      'mfg', case when d.transfer_id is null then nullif(ln ->> 'mfg', '') else l.mfg::text end,
      'exp', case when d.transfer_id is null then nullif(ln ->> 'exp', '') else l.exp::text end);
  end loop;

  -- Lines left off the report: nothing came (an expected line) or the line was removed (a new report).
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

-- ---------- Transfers ---------------------------------------------------------------------------
-- Sent: the stock comes off here now (lots: Shipped Out on FOAM LOTS) and the other location gets an
-- incoming delivery with the same lots, to receive when it gets there.
-- p_lines: [{"product_id": "...", "qty": 4, "lot_id": 12 (spray foam: which lot)}]
create or replace function public.transfer_send(p_from text, p_to text, p_arrive date, p_ref text, p_note text, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t      public.inventory_transfers;
  ln     jsonb;
  p      public.products;
  lot    public.inventory_lots;
  inv    public.inventory;
  q      numeric;
  avail  numeric;
  held   numeric;
  who    text := coalesce(public.my_name(), 'AMBITION');
  fromn  text;
  ton    text;
  del    bigint;
begin
  if not (public.is_admin() or public.has_perm('transfers')) then raise exception 'You don''t have access to transfers.'; end if;
  if p_from = p_to then raise exception 'Pick a different location to send it to.'; end if;
  select b.name || ' ' || b.state into fromn from public.branches b where b.id = p_from;
  select b.name || ' ' || b.state into ton from public.branches b where b.id = p_to;
  if fromn is null or ton is null then raise exception 'Pick both locations.'; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_from and s.enabled) then raise exception '% has no inventory spreadsheet connected.', fromn; end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_to and s.enabled) then raise exception '% has no inventory spreadsheet connected.', ton; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;

  insert into public.inventory_transfers (from_branch, to_branch, arrive_on, ref, note, created_by_name)
  values (p_from, p_to, coalesce(p_arrive, (now() at time zone 'America/Chicago')::date),
          nullif(left(trim(coalesce(p_ref, '')), 120), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''), who)
  returning * into t;

  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
    if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
    q := round(coalesce(nullif(ln ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then raise exception 'Enter how many % to send.', p.sku; end if;

    -- The other location has to stock it (on its COUNT SHEET, or counted by lot there).
    if not exists (select 1 from public.inventory i where i.branch_id = p_to and i.product_id = p.id and i.on_sheet)
       and not exists (select 1 from public.inventory_lots x where x.branch_id = p_to and x.product_id = p.id) then
      raise exception '% isn''t on %''s inventory sheet. Add a row for it on their COUNT SHEET first.', p.sku, ton;
    end if;

    if exists (select 1 from public.inventory_lots x where x.branch_id = p_from and x.product_id = p.id) then
      select * into lot from public.inventory_lots where id = nullif(ln ->> 'lot_id', '')::bigint and branch_id = p_from and product_id = p.id and on_sheet;
      if lot.id is null then raise exception 'Pick the lot for % (spray foam is sent by lot).', p.sku; end if;
      select coalesce(sum(x.qty), 0) into held from public.inventory_lines x where x.lot_id = lot.id and x.state = 'reserved';
      avail := lot.remaining - lot.sheet_pending - held;
      if q > avail then raise exception 'Lot % of % has % available to send (% asked).', lot.lot_no, p.sku, trim_scale(greatest(avail, 0)), trim_scale(q); end if;
      update public.inventory_lots set out_unsynced = out_unsynced + q, updated_at = now() where id = lot.id;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (p_from, 'transfer', p.sku, trim_scale(q) || ' sent to ' || ton || ' (transfer T-' || t.id || ') from lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' (Shipped Out on FOAM LOTS).',
              lot.remaining, lot.remaining - q, who);
      insert into public.inventory_transfer_lines (transfer_id, product_id, sku, name, unit, qty, lot_id, lot_no, mfg, exp)
      values (t.id, p.id, p.sku, p.name, p.unit, q, lot.id, nullif(lot.lot_no, ''), lot.mfg, lot.exp);
    else
      select * into inv from public.inventory where branch_id = p_from and product_id = p.id and on_sheet;
      if inv.product_id is null then raise exception '% isn''t on %''s inventory sheet.', p.sku, fromn; end if;
      select coalesce(sum(x.qty), 0) into held from public.inventory_lines x where x.branch_id = p_from and x.product_id = p.id and x.state = 'reserved';
      avail := coalesce(inv.on_hand, 0) - held - coalesce(inv.sheet_pending, 0);
      if q > avail then raise exception '% has % % available to send (% asked).', fromn, trim_scale(greatest(avail, 0)), p.sku, trim_scale(q); end if;
      update public.inventory set on_hand = on_hand - q, updated_at = now(), updated_by_name = who
       where branch_id = p_from and product_id = p.id;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (p_from, 'transfer', p.sku, trim_scale(q) || ' sent to ' || ton || ' (transfer T-' || t.id || ').', inv.on_hand, inv.on_hand - q, who);
      insert into public.inventory_transfer_lines (transfer_id, product_id, sku, name, unit, qty)
      values (t.id, p.id, p.sku, p.name, p.unit, q);
    end if;
  end loop;

  -- The other location's incoming delivery, with the lots already on it.
  insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, note, created_by_name, transfer_id)
  values (p_to, 'AMBIT ' || fromn, t.arrive_on, 'Transfer T-' || t.id || coalesce(' · ' || t.ref, ''), t.note, who, t.id)
  returning id into del;
  insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty, lot_no, mfg, exp)
  select del, product_id, sku, name, unit, qty, lot_no, mfg, exp from public.inventory_transfer_lines where transfer_id = t.id order by id;
  update public.inventory_transfers set delivery_id = del where id = t.id;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = p_from;
  return t.id;
end $$;

-- Not sent after all (only before the other location receives it): the stock goes back.
create or replace function public.transfer_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t   public.inventory_transfers;
  l   public.inventory_transfer_lines;
  lot public.inventory_lots;
  who text := coalesce(public.my_name(), 'AMBITION');
  b   numeric;
begin
  if not (public.is_admin() or public.has_perm('transfers')) then raise exception 'You don''t have access to transfers.'; end if;
  select * into t from public.inventory_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found.'; end if;
  if t.status <> 'in_transit' then raise exception 'This transfer was already %.', replace(t.status, '_', ' '); end if;
  if exists (select 1 from public.inbound_deliveries where id = t.delivery_id and status = 'received') then raise exception 'It was already received at the other location.'; end if;
  for l in select * from public.inventory_transfer_lines where transfer_id = p_id loop
    if l.lot_id is not null then
      select * into lot from public.inventory_lots where id = l.lot_id for update;
      if lot.id is null then continue; end if;
      if lot.out_unsynced >= l.qty then
        update public.inventory_lots set out_unsynced = out_unsynced - l.qty, updated_at = now() where id = lot.id;
      else
        update public.inventory_lots set in_unsynced = in_unsynced + l.qty, updated_at = now() where id = lot.id;  -- already on the sheet as Shipped Out
      end if;
      insert into public.inventory_log (branch_id, kind, sku, message, by_name)
      values (t.from_branch, 'transfer', l.sku, trim_scale(l.qty) || ' put back in lot ' || coalesce(l.lot_no, '(no lot #)') || ': transfer T-' || t.id || ' cancelled.', who);
    else
      update public.inventory set on_hand = coalesce(on_hand, 0) + l.qty, updated_at = now(), updated_by_name = who
       where branch_id = t.from_branch and product_id = l.product_id
      returning on_hand - l.qty into b;
      insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
      values (t.from_branch, 'transfer', l.sku, trim_scale(l.qty) || ' put back in stock: transfer T-' || t.id || ' cancelled.', b, b + l.qty, who);
    end if;
  end loop;
  update public.inbound_deliveries set status = 'cancelled' where id = t.delivery_id and status = 'expected';
  update public.inventory_transfers set status = 'cancelled', cancelled_at = now(), cancelled_by_name = who where id = p_id;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = t.from_branch;
end $$;

-- ---------- Who can call what ------------------------------------------------------------------
revoke all on function public.can_receive() from public, anon;
revoke all on function public.inbound_receive_report(bigint, text, jsonb, jsonb) from public, anon;
revoke all on function public.transfer_send(text, text, date, text, text, jsonb) from public, anon;
revoke all on function public.transfer_cancel(bigint) from public, anon;
grant execute on function public.can_receive() to authenticated;
grant execute on function public.inbound_receive_report(bigint, text, jsonb, jsonb) to authenticated;
grant execute on function public.transfer_send(text, text, date, text, text, jsonb) to authenticated;
grant execute on function public.transfer_cancel(bigint) to authenticated;

select 'inventory hub ready' as status;
