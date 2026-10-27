-- =====================================================================
-- AMBIT Intelligence update 0025 - Invoice #, signed BOL, item variance
-- * Sales Order # step: an Invoice # box next to it (both required) and an optional
--   invoice upload (PDF or photo).
-- * Delivered / Picked up: a photo or scan of the signed BOL is required.
-- * Item variance: admins (and anyone given the new "Item variance" box in
--   Admin > Accounts, e.g. the Warehouse Manager later) can load a different lot or a
--   different product type than the one picked. Every change is kept with who, when
--   and why. Changing lots is now theirs only.
-- * "Customer Approved without Email" on a scheduled order whose email didn't go out.
-- Files live in the private "order-files" storage bucket (AMBIT staff only).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- The new permission ---------------------------------------
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance']
$$;

-- ---------- New columns -----------------------------------------------
alter table public.orders add column if not exists invoice_no         text;
alter table public.orders add column if not exists notify_override_by text;
alter table public.orders add column if not exists notify_override_at timestamptz;

-- What the customer ordered, kept when a different type is loaded instead.
alter table public.order_items add column if not exists ordered_product_id uuid references public.products(id) on delete set null;
alter table public.order_items add column if not exists ordered_sku        text;
alter table public.order_items add column if not exists ordered_name       text;

-- ---------- Item variance log -----------------------------------------
create table if not exists public.order_variances (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders(id) on delete cascade,
  order_item_id bigint references public.order_items(id) on delete cascade,
  kind          text not null,           -- type | lot
  from_text     text,
  to_text       text,
  reason        text,
  stage         text,                    -- where the order was when it changed
  by_id         uuid references public.profiles(id) on delete set null,
  by_name       text,
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.order_variances add constraint order_variances_kind_check check (kind in ('type', 'lot'));
exception when duplicate_object then null; end $$;
create index if not exists order_variances_order_idx on public.order_variances(order_id, created_at);
alter table public.order_variances enable row level security;
drop policy if exists order_variances_read on public.order_variances;
create policy order_variances_read on public.order_variances for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.order_variances from anon, authenticated;
grant select on public.order_variances to authenticated;

-- ---------- Order files: invoices and signed BOLs ----------------------
create table if not exists public.order_files (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  kind             text not null,       -- invoice | bol
  path             text not null unique, -- in the order-files bucket: <order id>/<file>
  name             text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);
do $$ begin
  alter table public.order_files add constraint order_files_kind_check check (kind in ('invoice', 'bol'));
exception when duplicate_object then null; end $$;
create index if not exists order_files_order_idx on public.order_files(order_id, kind);
alter table public.order_files enable row level security;
drop policy if exists order_files_read on public.order_files;
create policy order_files_read on public.order_files for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.order_files from anon, authenticated;
grant select on public.order_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists order_files_obj_read   on storage.objects;
drop policy if exists order_files_obj_insert on storage.objects;
drop policy if exists order_files_obj_delete on storage.objects;
create policy order_files_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'order-files' and public.is_employee());
create policy order_files_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'order-files' and (public.has_perm('order_desk') or public.has_perm('inventory')));
create policy order_files_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'order-files' and public.is_admin());

-- Staff: put an uploaded file on the order (the app uploads it first).
create or replace function public.order_add_file(p_order uuid, p_kind text, p_path text, p_name text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  fid bigint;
begin
  if p_kind = 'invoice' and not public.has_perm('order_desk') then
    raise exception 'Only the order desk can add invoices.';
  elsif p_kind = 'bol' and not (public.has_perm('order_desk') or public.has_perm('inventory')) then
    raise exception 'Only the order desk or the warehouse can add the signed BOL.';
  elsif p_kind not in ('invoice', 'bol') then
    raise exception 'Unknown kind of file.';
  end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'Order not found.'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> p_order::text then raise exception 'That file isn''t in this order''s folder.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'order-files' and name = p_path) then
    raise exception 'The file didn''t finish uploading. Try again.';
  end if;
  insert into public.order_files (order_id, kind, path, name, uploaded_by, uploaded_by_name)
  values (p_order, p_kind, p_path, left(nullif(trim(coalesce(p_name, '')), ''), 200), auth.uid(), public.my_name())
  on conflict (path) do nothing
  returning id into fid;
  return fid;
end $$;

-- ---------- Sales Order # and Invoice # --------------------------------
create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  if coalesce(trim(p_invoice), '') = '' then raise exception 'Enter the Invoice # too.'; end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), invoice_no = left(trim(p_invoice), 60),
         po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- The old one-box version now needs the Invoice # as well.
create or replace function public.order_set_po(p_order uuid, p_po text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.order_set_numbers(p_order, p_po, (select invoice_no from public.orders where id = p_order));
end $$;

-- ---------- Delivered / picked up: the signed BOL first ----------------
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
  if not exists (select 1 from public.order_files f where f.order_id = p_order and f.kind = 'bol') then
    raise exception 'Add a photo or scan of the signed BOL first.';
  end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order;
end $$;

-- ---------- Scheduled, but the customer couldn't be emailed -------------
create or replace function public.order_notify_override(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.scheduled_for is null then raise exception 'Schedule the order first.'; end if;
  update public.orders
     set notify_status = 'override', notify_error = null,
         notify_override_by = public.my_name(), notify_override_at = now()
   where id = p_order;
end $$;

-- ---------- Picking: a line swapped to another type doesn't count -------
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
              where order_item_id = p_item and not (state = 'cancelled' and done_by = 'swap')) then return; end if;

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

-- ---------- Item variance: a different product type ---------------------
-- Same category and unit, active products, and for spray foam the same side (ISO A-Side stays
-- A-Side: its brand is picked by lot; a resin stays a resin). What it was ordered as is kept on the line.
create or replace function public.product_is_a_side(p public.products) returns boolean
language sql immutable as $$
  select coalesce(p.name ilike '%A-Side%' or p.sku ilike 'ISO%', false)
$$;

create or replace function public.order_item_alternatives(p_item bigint)
returns table (product_id uuid, sku text, name text, on_hand numeric, available numeric)
language sql stable security definer set search_path = public as $$
  with it as (select i.*, o.branch_id from public.order_items i join public.orders o on o.id = i.order_id where i.id = p_item),
       cur as (select p.* from public.products p join it on p.id = it.product_id),
       st as (select * from public.stock_for((select branch_id from it)))
  select p.id, p.sku, p.name, st.on_hand, st.net
    from public.products p
    join cur on p.category_id is not distinct from cur.category_id
    join it on lower(p.unit) = lower(it.unit)
    left join st on st.product_id = p.id
   where public.has_perm('item_variance') and p.active and p.id <> cur.id
     and public.product_is_a_side(p) = public.product_is_a_side(cur)
   order by (p.id = (select ordered_product_id from it)) desc, p.name
$$;

create or replace function public.order_item_swap(p_item bigint, p_product uuid, p_reason text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  it   public.order_items;
  o    public.orders;
  np   public.products;
  cur  public.products;
  who  text := coalesce(public.my_name(), 'AMBITION');
  sheet boolean;
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change what''s loaded.';
  end if;
  select * into it from public.order_items where id = p_item for update;
  if it.id is null then raise exception 'That item isn''t on the order any more.'; end if;
  select * into o from public.orders where id = it.order_id for update;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'Wait until the customer approves the order.'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why it''s changing, for example "Out of Summer, loading Winter".';
  end if;
  if it.product_id = p_product then return it.name; end if;
  select * into np from public.products where id = p_product;
  if np.id is null or not np.active then raise exception 'Pick an active product.'; end if;
  select * into cur from public.products where id = it.product_id;
  if cur.id is null or np.category_id is distinct from cur.category_id or lower(np.unit) <> lower(it.unit)
     or public.product_is_a_side(np) <> public.product_is_a_side(cur) then
    raise exception 'Pick a product in the same category, sold by the %.', it.unit;
  end if;
  if exists (select 1 from public.inventory_lines where order_item_id = it.id and state = 'done') then
    raise exception 'Some of this item was already picked up, so it can''t be changed.';
  end if;

  sheet := o.branch_id is not null and exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled);
  if o.branch_id is not null then perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id)); end if;
  -- Let go of what was held for the old type. Lines already on the sheet show as Cancelled there.
  delete from public.inventory_lines where order_item_id = it.id and state = 'reserved' and sheet_row is null;
  update public.inventory_lines
     set state = 'cancelled', done_by = 'swap', needs_write = true, updated_at = now()
   where order_item_id = it.id and state = 'reserved';

  update public.order_items
     set ordered_product_id = case when it.ordered_sku is null then it.product_id else ordered_product_id end,
         ordered_sku  = coalesce(ordered_sku, it.sku),
         ordered_name = coalesce(ordered_name, it.name),
         product_id = np.id, sku = np.sku, name = np.name
   where id = it.id;
  -- Swapped back to what was ordered: no longer a variance.
  update public.order_items set ordered_product_id = null, ordered_sku = null, ordered_name = null
   where id = it.id and upper(ordered_sku) = upper(sku);

  -- Hold the new type (by lot for spray foam).
  perform public.inventory_pick(it.id);

  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, it.id, 'type', it.name || ' (' || it.sku || ')', np.name || ' (' || np.sku || ')', left(trim(p_reason), 500), o.stage, auth.uid(), who);
  if sheet then
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (o.branch_id, 'order', np.sku,
            'ORD-' || o.order_no || ': loading ' || trim_scale(it.qty) || ' ' || np.sku || ' instead of ' || it.sku || ' (' || left(trim(p_reason), 200) || ').', who);
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  end if;
  return np.name;
end $$;

-- ---------- Item variance: a different lot ------------------------------
-- Changing lots is for admins and the Item variance box now.
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
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
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

create or replace function public.order_variance_lot(p_line bigint, p_lot bigint, p_reason text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_lines;
  lot public.inventory_lots;
  o   public.orders;
  res text;
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  select * into l from public.inventory_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  res := public.inventory_repick(p_line, p_lot);
  select * into lot from public.inventory_lots where id = p_lot;
  select * into o from public.orders where id = l.order_id;
  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, l.order_item_id, 'lot',
          trim_scale(l.qty) || ' × ' || l.sku || ' · ' || case when l.lot_id is null then 'no lot picked' else 'Lot ' || coalesce(l.lot_no, '(no lot #)') end,
          trim_scale(l.qty) || ' × ' || lot.sku || ' · Lot ' || res,
          nullif(left(trim(coalesce(p_reason, '')), 500), ''), o.stage, auth.uid(), coalesce(public.my_name(), 'AMBITION'));
  return res;
end $$;

-- ---------- Who can call what ------------------------------------------
revoke all on function public.order_add_file(uuid, text, text, text) from public, anon;
revoke all on function public.order_set_numbers(uuid, text, text) from public, anon;
revoke all on function public.order_notify_override(uuid) from public, anon;
revoke all on function public.order_item_alternatives(bigint) from public, anon;
revoke all on function public.order_item_swap(bigint, uuid, text) from public, anon;
revoke all on function public.order_variance_lot(bigint, bigint, text) from public, anon;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;
grant execute on function public.order_add_file(uuid, text, text, text) to authenticated;
grant execute on function public.order_set_numbers(uuid, text, text) to authenticated;
grant execute on function public.order_notify_override(uuid) to authenticated;
grant execute on function public.order_item_alternatives(bigint) to authenticated;
grant execute on function public.order_item_swap(bigint, uuid, text) to authenticated;
grant execute on function public.order_variance_lot(bigint, bigint, text) to authenticated;

select 'invoice, BOL and item variance ready' as status,
       (select count(*) from public.orders where stage = 'scheduled') as scheduled_orders_needing_a_bol;
