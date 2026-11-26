-- 0120: Retire a location's inventory spreadsheet. After this, AMBIT Intelligence is the only inventory record for
-- that location: the app stops reading and writing the workbook (keep the file as a frozen archive).
--  * Admin > Inventory > a location > "Retire the spreadsheet" runs one last sync, then calls inventory_retire_sheet.
--  * Anything the app was holding "to be written to the spreadsheet" is applied for good: drums received or fixed in
--    the app (Shipped In / Adj), pickups (Shipped Out), and items or lots added in the app (now on the list).
--  * From then on, the same happens the moment it's saved (the two triggers below), so nothing waits for a sync.
-- Run once in Supabase > SQL Editor. Safe to run again.

alter table public.inventory_sheets add column if not exists retired_at timestamptz;
alter table public.inventory_sheets add column if not exists retired_by_name text;

create or replace function public.inventory_sheet_retired(p_branch text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.inventory_sheets where branch_id = p_branch and retired_at is not null)
$fn$;

-- Lots at a retired location: what used to wait for the spreadsheet goes straight into the lot.
-- (Named so it runs after inventory_lots_same_lot, which needs add_to_sheet to spot the same lot typed another way.)
create or replace function public.inventory_lots_app_owned() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.inventory_sheet_retired(new.branch_id) then return new; end if;
  if new.in_unsynced <> 0 then new.shipped_in := new.shipped_in + new.in_unsynced; new.in_unsynced := 0; end if;
  if new.adj_unsynced <> 0 then new.adj := new.adj + new.adj_unsynced; new.adj_unsynced := 0; end if;
  if new.out_unsynced <> 0 then new.shipped_out := new.shipped_out + new.out_unsynced; new.out_unsynced := 0; end if;
  if tg_op = 'INSERT' or new.add_to_sheet then new.on_sheet := true; new.add_to_sheet := false; end if;
  return new;
end $fn$;
drop trigger if exists inventory_lots_zz_app_owned on public.inventory_lots;
create trigger inventory_lots_zz_app_owned before insert or update on public.inventory_lots
  for each row execute function public.inventory_lots_app_owned();

-- Items at a retired location: added in the app = on the list right away; nothing is waiting to be written.
create or replace function public.inventory_app_owned() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.inventory_sheet_retired(new.branch_id) then return new; end if;
  if tg_op = 'INSERT' or new.add_to_sheet then new.on_sheet := true; new.add_to_sheet := false; end if;
  new.synced_on_hand := new.on_hand;
  new.count_dirty := false;
  return new;
end $fn$;
drop trigger if exists inventory_zz_app_owned on public.inventory;
create trigger inventory_zz_app_owned before insert or update on public.inventory
  for each row execute function public.inventory_app_owned();

-- Admin: retire a location's spreadsheet (the app runs one last sync first).
create or replace function public.inventory_retire_sheet(p_branch text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  who text := coalesce(public.my_name(), 'Admin');
  n_lots int := 0;
  n_items int := 0;
begin
  if not public.is_admin() then raise exception 'Only an admin can retire a spreadsheet.'; end if;
  if not exists (select 1 from public.inventory_sheets where branch_id = p_branch and enabled) then
    raise exception 'This location''s inventory isn''t live in the app.';
  end if;
  if public.inventory_sheet_retired(p_branch) then
    return jsonb_build_object('already', true);
  end if;
  if exists (select 1 from public.inventory_sheets where branch_id = p_branch and sync_lock_until > now()) then
    raise exception 'A sync with the spreadsheet is running right now. Try again in a minute.';
  end if;
  update public.inventory_sheets set retired_at = now(), retired_by_name = who, updated_at = now() where branch_id = p_branch;
  -- The triggers above apply whatever was waiting.
  update public.inventory_lots set updated_at = now()
   where branch_id = p_branch and (in_unsynced <> 0 or adj_unsynced <> 0 or out_unsynced <> 0 or add_to_sheet);
  get diagnostics n_lots = row_count;
  update public.inventory set updated_at = now()
   where branch_id = p_branch and (add_to_sheet or count_dirty or synced_on_hand is distinct from on_hand);
  get diagnostics n_items = row_count;
  perform public.inventory_lots_rollup_all(p_branch);
  update public.inventory_lines set needs_write = false where branch_id = p_branch and needs_write;
  insert into public.inventory_log (branch_id, kind, message, by_name)
  values (p_branch, 'sheet', 'Spreadsheet retired: AMBIT Intelligence is now the only inventory record for this location. '
          || n_lots || ' lot' || case when n_lots = 1 then '' else 's' end || ' and ' || n_items || ' item' || case when n_items = 1 then '' else 's' end
          || ' finished what was waiting for the spreadsheet.', who);
  return jsonb_build_object('lots', n_lots, 'items', n_items);
end $fn$;
revoke all on function public.inventory_retire_sheet(text) from public, anon;
grant execute on function public.inventory_retire_sheet(text) to authenticated;

notify pgrst, 'reload schema';

-- Check: should say 1.
select count(*) as "Retire sheets ready (1)" from information_schema.columns where table_schema = 'public' and table_name = 'inventory_sheets' and column_name = 'retired_at';
