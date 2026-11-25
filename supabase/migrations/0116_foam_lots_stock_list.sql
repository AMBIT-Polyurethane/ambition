-- 0116: Foam lots and the stock list in A.I., still in step with the location spreadsheets.
--  * Inventory > Foam lots: every lot the way the FOAM LOTS tab shows it, each lot's whole history, and Fix count
--    (a count difference, a damaged drum, a drum used here). Admins (and people with the Item variance box) fix any
--    amount; a location's warehouse manager fixes up to 2 drums at a time there, and more waits for an admin's OK.
--    Fixes go onto FOAM LOTS (Adj) within 2 minutes.
--  * Stock: an item's Max, preferred vendor and lead time are set in the app and written onto the COUNT SHEET.
--  * Stock: add an item to a location. The app adds its row to that location's COUNT SHEET.
-- Run AFTER 0115, once the update with these screens is live (push first, then this). Run once in Supabase >
-- SQL Editor. Safe to run again.

-- ---------------------------------------------------------------- lot fixes, and the ones waiting for an admin
alter table public.inventory_lot_changes add column if not exists status text not null default 'done';
alter table public.inventory_lot_changes add column if not exists reason text;
alter table public.inventory_lot_changes add column if not exists decided_by_name text;
alter table public.inventory_lot_changes add column if not exists decided_at timestamptz;
alter table public.inventory_lot_changes add column if not exists decide_note text;
alter table public.inventory_lot_changes drop constraint if exists inventory_lot_changes_kind_check;
alter table public.inventory_lot_changes add constraint inventory_lot_changes_kind_check check (kind in ('product', 'dates', 'adjust'));
alter table public.inventory_lot_changes drop constraint if exists inventory_lot_changes_status_check;
alter table public.inventory_lot_changes add constraint inventory_lot_changes_status_check check (status in ('done', 'waiting', 'denied'));
create index if not exists inventory_lot_changes_waiting on public.inventory_lot_changes (branch_id) where status = 'waiting';

-- Who can fix a lot's count at a location: 'full' (admins, Item variance box), 'limited' (inventory people; a
-- warehouse manager only at their own location: 2 drums at a time, more needs an admin), or null.
create or replace function public.lot_fixer(p_branch text) returns text
language sql stable security definer set search_path = public as $fn$
  select case
    when public.is_admin() or public.has_perm('item_variance') then 'full'
    when public.has_perm('inventory') and exists (
      select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.job_role, '') <> 'warehouse' or p.branch_id = p_branch)) then 'limited'
  end
$fn$;
revoke all on function public.lot_fixer(text) from public, anon;
grant execute on function public.lot_fixer(text) to authenticated;

-- Fix a lot's count. p_reason: 'count' (p_qty = how many are really there), 'damaged' or 'used' (p_qty drums came off).
create or replace function public.inventory_lot_fix(p_lot bigint, p_reason text, p_qty numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  s public.inventory_lots; lvl text; left_now numeric; d numeric; cid bigint; who text := coalesce(public.my_name(), 'AMBIT A.I.');
  lot text; what text;
begin
  select * into s from public.inventory_lots where id = p_lot for update;
  if s.id is null or not s.on_sheet then raise exception 'That lot isn''t on FOAM LOTS any more.'; end if;
  lot := coalesce(nullif(s.lot_no, ''), '(no lot #)');
  lvl := public.lot_fixer(s.branch_id);
  if lvl is null then raise exception 'Admins and this location''s warehouse manager fix lot counts.'; end if;
  if p_reason is null or p_reason not in ('count', 'damaged', 'used') then raise exception 'Pick what happened.'; end if;
  if p_qty is null or p_qty < 0 or p_qty <> round(p_qty, 2) or p_qty > 10000 then raise exception 'Type a number of drums.'; end if;
  left_now := s.remaining + s.in_unsynced + s.adj_unsynced;
  d := case when p_reason = 'count' then p_qty - left_now else -p_qty end;
  if d = 0 then raise exception 'That''s what lot % has already (%).', lot, trim_scale(left_now); end if;
  if left_now + d < 0 then raise exception 'Lot % only has % on hand.', lot, trim_scale(left_now); end if;
  if p_reason <> 'count' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Add a short note (what happened to the drum).'; end if;
  what := case p_reason when 'count' then 'Count: ' || trim_scale(p_qty) || ' there (was ' || trim_scale(left_now) || ')'
                        when 'damaged' then trim_scale(p_qty) || ' damaged' else trim_scale(p_qty) || ' used here' end;
  if lvl = 'full' or abs(d) <= 2 then
    update public.inventory_lots set adj_unsynced = adj_unsynced + d, updated_at = now() where id = s.id;
    insert into public.inventory_lot_changes (branch_id, kind, status, reason, lot_no, from_lot_id, from_sku, qty, note, by_id, by_name)
    values (s.branch_id, 'adjust', 'done', p_reason, s.lot_no, s.id, s.sku, d, nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid(), who)
    returning id into cid;
    insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
    values (s.branch_id, 'adjust', s.sku, 'Lot ' || lot || ': ' || what || ' (Adj on FOAM LOTS).' || coalesce(' ' || nullif(left(trim(coalesce(p_note, '')), 200), ''), ''),
            left_now, left_now + d, who);
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = s.branch_id;
    return jsonb_build_object('status', 'done', 'id', cid,
      'msg', 'Lot ' || lot || ' is now ' || trim_scale(left_now + d) || '. The spreadsheet catches up within 2 minutes.');
  end if;
  if exists (select 1 from public.inventory_lot_changes c where c.from_lot_id = s.id and c.status = 'waiting') then
    raise exception 'Lot % already has a fix waiting for an admin.', lot;
  end if;
  insert into public.inventory_lot_changes (branch_id, kind, status, reason, lot_no, from_lot_id, from_sku, qty, note, by_id, by_name)
  values (s.branch_id, 'adjust', 'waiting', p_reason, s.lot_no, s.id, s.sku, d, nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid(), who)
  returning id into cid;
  return jsonb_build_object('status', 'waiting', 'id', cid,
    'msg', 'More than 2 drums, so it went to an admin to OK. Lot ' || lot || ' stays at ' || trim_scale(left_now) || ' until then.');
end $fn$;
revoke all on function public.inventory_lot_fix(bigint, text, numeric, text) from public, anon;
grant execute on function public.inventory_lot_fix(bigint, text, numeric, text) to authenticated;

-- Admins: OK or turn down a fix that's waiting.
create or replace function public.inventory_lot_decide(p_change bigint, p_ok boolean, p_note text) returns text
language plpgsql security definer set search_path = public as $fn$
declare c public.inventory_lot_changes; s public.inventory_lots; left_now numeric; who text := coalesce(public.my_name(), 'Admin'); lot text;
begin
  if not (public.is_admin() or public.has_perm('item_variance')) then raise exception 'Only admins OK lot fixes.'; end if;
  select * into c from public.inventory_lot_changes where id = p_change for update;
  if c.id is null or c.status <> 'waiting' then raise exception 'That fix isn''t waiting any more.'; end if;
  lot := coalesce(nullif(c.lot_no, ''), '(no lot #)');
  if not coalesce(p_ok, false) then
    update public.inventory_lot_changes set status = 'denied', decided_by_name = who, decided_at = now(), decide_note = nullif(left(trim(coalesce(p_note, '')), 300), '') where id = c.id;
    return 'Turned down. Lot ' || lot || ' stays as it is.';
  end if;
  select * into s from public.inventory_lots where id = c.from_lot_id for update;
  if s.id is null or not s.on_sheet then raise exception 'That lot isn''t on FOAM LOTS any more.'; end if;
  left_now := s.remaining + s.in_unsynced + s.adj_unsynced;
  if left_now + c.qty < 0 then raise exception 'Lot % only has % on hand now, so this can''t take % off.', lot, trim_scale(left_now), trim_scale(-c.qty); end if;
  update public.inventory_lots set adj_unsynced = adj_unsynced + c.qty, updated_at = now() where id = s.id;
  update public.inventory_lot_changes set status = 'done', decided_by_name = who, decided_at = now(), decide_note = nullif(left(trim(coalesce(p_note, '')), 300), '') where id = c.id;
  insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
  values (s.branch_id, 'adjust', s.sku, 'Lot ' || lot || ': ' || trim_scale(c.qty) || ' (' || coalesce(c.reason, 'fix') || ', asked by ' || coalesce(c.by_name, '?')
          || ', OK''d by ' || who || ') onto Adj on FOAM LOTS.', left_now, left_now + c.qty, who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = s.branch_id;
  return 'OK''d. Lot ' || lot || ' is now ' || trim_scale(left_now + c.qty) || '. The spreadsheet catches up within 2 minutes.';
end $fn$;
revoke all on function public.inventory_lot_decide(bigint, boolean, text) from public, anon;
grant execute on function public.inventory_lot_decide(bigint, boolean, text) to authenticated;

-- ---------------------------------------------------------------- an item's settings, set in the app
alter table public.inventory add column if not exists vendor text;
alter table public.inventory add column if not exists lead_days int;
alter table public.inventory add column if not exists max_app boolean not null default false;      -- Max set in the app: written to the COUNT SHEET
alter table public.inventory add column if not exists supply_app boolean not null default false;   -- Vendor and lead time set in the app: same
alter table public.inventory add column if not exists add_to_sheet boolean not null default false; -- added in the app: the sync adds its COUNT SHEET row
alter table public.inventory add column if not exists added_by_name text;

-- Reorder point, Max, vendor and lead time for one item at one location (null = leave blank).
create or replace function public.inventory_item_settings(p_branch text, p_product uuid, p_rop numeric, p_max numeric, p_vendor text, p_lead int) returns text
language plpgsql security definer set search_path = public as $fn$
declare who text := coalesce(public.my_name(), 'AMBIT A.I.'); r public.inventory;
begin
  if not public.can_set_rop(p_branch) then raise exception 'Admins, CRMs and this location''s warehouse manager change an item''s settings.'; end if;
  if (p_rop is not null and p_rop < 0) or (p_max is not null and p_max < 0) then raise exception 'Use 0 or more.'; end if;
  if p_rop is not null and p_max is not null and p_max > 0 and p_max < p_rop then raise exception 'Max has to be at least the reorder point.'; end if;
  if p_lead is not null and (p_lead < 0 or p_lead > 365) then raise exception 'Lead time is a number of business days (0 to 365).'; end if;
  select * into r from public.inventory where branch_id = p_branch and product_id = p_product for update;
  if r.product_id is null then raise exception 'That item isn''t on this location''s list.'; end if;
  update public.inventory
     set reorder_point = case when p_rop is null then null else round(p_rop, 2) end, rop_app = true, rop_set_by_name = who, rop_set_at = now(),
         max_qty = case when p_max is null then null else round(p_max, 2) end, max_app = true,
         vendor = nullif(left(trim(coalesce(p_vendor, '')), 120), ''), lead_days = p_lead, supply_app = true,
         updated_at = now()
   where branch_id = p_branch and product_id = p_product;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (p_branch, 'settings', r.sku, 'Settings: reorder at ' || coalesce(trim_scale(p_rop)::text, 'blank') || ', max ' || coalesce(trim_scale(p_max)::text, 'blank')
          || ', vendor ' || coalesce(nullif(trim(coalesce(p_vendor, '')), ''), 'blank') || ', lead ' || coalesce(p_lead::text || ' days', 'blank') || '.', who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = p_branch;
  return 'Saved. The COUNT SHEET catches up within 2 minutes.';
end $fn$;
revoke all on function public.inventory_item_settings(text, uuid, numeric, numeric, text, int) from public, anon;
grant execute on function public.inventory_item_settings(text, uuid, numeric, numeric, text, int) to authenticated;

-- Put a product on a location's list. The sync adds its row to the COUNT SHEET (with its group).
create or replace function public.inventory_item_add(p_branch text, p_product uuid, p_on_hand numeric, p_rop numeric, p_max numeric, p_vendor text, p_lead int) returns text
language plpgsql security definer set search_path = public as $fn$
declare who text := coalesce(public.my_name(), 'AMBIT A.I.'); p public.products; r public.inventory;
begin
  if not public.can_set_rop(p_branch) then raise exception 'Admins, CRMs and this location''s warehouse manager add items.'; end if;
  if not exists (select 1 from public.inventory_sheets where branch_id = p_branch and enabled) then raise exception 'This location has no spreadsheet connected.'; end if;
  select * into p from public.products where id = p_product;
  if p.id is null or not (p.active or p.stock_of is not null) then raise exception 'Pick a product.'; end if;
  if (p_on_hand is not null and p_on_hand < 0) or (p_rop is not null and p_rop < 0) or (p_max is not null and p_max < 0) then raise exception 'Use 0 or more.'; end if;
  select * into r from public.inventory where branch_id = p_branch and product_id = p_product for update;
  if r.product_id is not null and (r.on_sheet or r.add_to_sheet) then raise exception '% is already on this location''s list.', p.sku; end if;
  if r.product_id is null then
    insert into public.inventory (branch_id, product_id, sku, on_hand, synced_on_hand, reorder_point, rop_app, rop_set_by_name, rop_set_at, max_qty, max_app,
                                  vendor, lead_days, supply_app, last_counted, counted_by, on_sheet, add_to_sheet, added_by_name)
    values (p_branch, p_product, p.sku, p_on_hand, p_on_hand, p_rop, true, who, now(), p_max, true,
            nullif(left(trim(coalesce(p_vendor, '')), 120), ''), p_lead, true,
            case when p_on_hand is null then null else (now() at time zone 'America/Chicago')::date end, case when p_on_hand is null then null else who end,
            false, true, who);
  else
    update public.inventory
       set sku = p.sku, on_hand = p_on_hand, synced_on_hand = p_on_hand, reorder_point = p_rop, rop_app = true, rop_set_by_name = who, rop_set_at = now(),
           max_qty = p_max, max_app = true, vendor = nullif(left(trim(coalesce(p_vendor, '')), 120), ''), lead_days = p_lead, supply_app = true,
           last_counted = case when p_on_hand is null then null else (now() at time zone 'America/Chicago')::date end,
           counted_by = case when p_on_hand is null then null else who end, add_to_sheet = true, added_by_name = who, updated_at = now()
     where branch_id = p_branch and product_id = p_product;
  end if;
  insert into public.inventory_log (branch_id, kind, sku, message, qty_after, by_name)
  values (p_branch, 'new_item', p.sku, p.sku || ' added to this location in the app' || case when p_on_hand is null then '' else ', ' || trim_scale(p_on_hand) || ' on hand' end
          || ' (its COUNT SHEET row is added within 2 minutes).', p_on_hand, who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = p_branch;
  return p.sku || ' is on the list. Its row goes onto the COUNT SHEET within 2 minutes.';
end $fn$;
revoke all on function public.inventory_item_add(text, uuid, numeric, numeric, numeric, text, int) from public, anon;
grant execute on function public.inventory_item_add(text, uuid, numeric, numeric, numeric, text, int) to authenticated;

notify pgrst, 'reload schema';

-- Check: should say 3 (lot fix, item settings, add an item).
select count(*) as "New functions (3)" from pg_proc where proname in ('inventory_lot_fix', 'inventory_item_settings', 'inventory_item_add');
