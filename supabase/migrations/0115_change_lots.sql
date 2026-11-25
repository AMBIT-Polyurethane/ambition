-- 0115: Inventory > Change lots. Without opening the spreadsheet:
--  * Move drums of a lot to another product, e.g. Covestro ISO drums sold as Alpha AP ISO, or AMBIT resin as Alpha
--    resin. The drums come off the lot's Adj on FOAM LOTS and onto the same lot # under the new product (its Adj when
--    that lot is already there, or a new row the app adds under the product's group). ISO only changes to ISO and
--    resin to resin, and only between products sold the same way (drum to drum).
--  * Fix a lot's dates (expiration and/or made-on). Every row of that lot # at the location gets the new date, and
--    the app writes it onto FOAM LOTS.
--  Admins, and people with the Item variance box (the same people who can change an order's lot), make these changes.
--  Every change is kept (who, when, how many, why) and shown on the page.
-- Run AFTER the update with the Change lots page is live (push first, then this). Run once in Supabase > SQL Editor.
-- Safe to run again.

-- A date fixed in the app, waiting to be written onto FOAM LOTS (the sync writes it, then clears it).
alter table public.inventory_lots add column if not exists exp_set date;
alter table public.inventory_lots add column if not exists mfg_set date;

create table if not exists public.inventory_lot_changes (
  id          bigint generated always as identity primary key,
  branch_id   text not null,
  kind        text not null check (kind in ('product', 'dates')),
  lot_no      text,
  from_lot_id bigint references public.inventory_lots(id) on delete set null,
  to_lot_id   bigint references public.inventory_lots(id) on delete set null,
  from_sku    text,
  to_sku      text,
  qty         numeric(12,2),
  old_exp     date,
  new_exp     date,
  old_mfg     date,
  new_mfg     date,
  note        text,
  by_id       uuid,
  by_name     text,
  created_at  timestamptz not null default now()
);
create index if not exists inventory_lot_changes_branch on public.inventory_lot_changes (branch_id, created_at desc);
alter table public.inventory_lot_changes enable row level security;
drop policy if exists inventory_lot_changes_read on public.inventory_lot_changes;
create policy inventory_lot_changes_read on public.inventory_lot_changes for select to authenticated
  using (public.is_admin() or public.has_perm('item_variance') or public.has_perm('inventory'));

-- What's free on a lot right now: left on FOAM LOTS (plus changes not written yet), less lines typed on PENDING
-- ORDERS, app orders waiting on it and drums held for a customer.
create or replace function public.inventory_lot_free(p_lot bigint) returns numeric
language sql stable security definer set search_path = public as $fn$
  select l.remaining + l.in_unsynced + l.adj_unsynced - l.sheet_pending
         - coalesce((select sum(i.qty) from public.inventory_lines i where i.lot_id = l.id and i.state = 'reserved'), 0)
         - coalesce((select sum(h.qty) from public.inventory_holds h
                      where h.lot_id = l.id and h.released_at is null and h.until >= (now() at time zone 'America/Chicago')::date), 0)
    from public.inventory_lots l where l.id = p_lot
$fn$;
revoke all on function public.inventory_lot_free(bigint) from public, anon;
grant execute on function public.inventory_lot_free(bigint) to authenticated;

-- Move p_qty drums of a lot to another product (same lot #, same location).
create or replace function public.inventory_lot_switch(p_lot bigint, p_qty numeric, p_product uuid, p_note text) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  s public.inventory_lots; t public.inventory_lots; sp public.products; tp public.products;
  free numeric; tid bigint; made boolean := false; who text := coalesce(public.my_name(), 'AMBIT A.I.');
  iso_s boolean; iso_t boolean;
begin
  if not (public.is_admin() or public.has_perm('item_variance')) then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty <> round(p_qty, 2) then raise exception 'Type how many drums to change.'; end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Say why (for example: sold as Alpha AP ISO).'; end if;
  select * into s from public.inventory_lots where id = p_lot for update;
  if s.id is null or not s.on_sheet then raise exception 'That lot isn''t on FOAM LOTS any more.'; end if;
  if s.product_id = p_product then raise exception 'Pick a different product.'; end if;
  select * into sp from public.products where id = s.product_id;
  select * into tp from public.products where id = p_product;
  -- Sellable products, or a brand's stock item (Covestro ISO, Wanhua ISO … are stock of ISO, so they aren't sold by name).
  if tp.id is null or not (tp.active or tp.stock_of is not null) then raise exception 'Pick the product the drums are changing to.'; end if;
  if coalesce(lower(sp.unit), '') <> coalesce(lower(tp.unit), '') then
    raise exception '% comes by the % and % by the %, so drums can''t move between them.', sp.sku, coalesce(sp.unit, '?'), tp.sku, coalesce(tp.unit, '?');
  end if;
  iso_s := upper(sp.sku) like '%ISO%'; iso_t := upper(tp.sku) like '%ISO%';
  if iso_s <> iso_t then raise exception 'ISO can only change to another ISO, and resin to another resin.'; end if;
  if not exists (select 1 from public.inventory i where i.branch_id = s.branch_id and i.product_id = p_product and i.on_sheet) then
    raise exception '% isn''t on this location''s COUNT SHEET yet. Add it there first.', tp.sku;
  end if;
  free := public.inventory_lot_free(s.id);
  if p_qty > free then
    raise exception 'Only % free on lot % (the rest is on open orders or held for a customer).', trim_scale(greatest(free, 0)), coalesce(nullif(s.lot_no, ''), '(no lot #)');
  end if;

  update public.inventory_lots set adj_unsynced = adj_unsynced - p_qty, updated_at = now() where id = s.id;

  -- The same lot # under the new product: on FOAM LOTS already, or waiting to be added.
  select * into t from public.inventory_lots x
   where x.branch_id = s.branch_id and x.product_id = p_product and (x.on_sheet or x.add_to_sheet)
     and public.lot_key(x.lot_no) = public.lot_key(s.lot_no)
   order by x.on_sheet desc, x.id limit 1 for update;
  if t.id is not null and t.on_sheet then
    update public.inventory_lots set adj_unsynced = adj_unsynced + p_qty, updated_at = now() where id = t.id;
    tid := t.id;
  elsif t.id is not null then
    update public.inventory_lots set starting = starting + p_qty, updated_at = now() where id = t.id;
    tid := t.id;
  else
    insert into public.inventory_lots (branch_id, product_id, sku, lot_no, mfg, exp, starting, label, notes, on_sheet, add_to_sheet, sort)
    values (s.branch_id, p_product, tp.sku, s.lot_no, coalesce(s.mfg_set, s.mfg), coalesce(s.exp_set, s.exp), p_qty, tp.name,
            'Changed from ' || sp.sku || ' in the app', false, true, 100000)
    returning id into tid;
    made := true;
  end if;

  insert into public.inventory_lot_changes (branch_id, kind, lot_no, from_lot_id, to_lot_id, from_sku, to_sku, qty, note, by_id, by_name)
  values (s.branch_id, 'product', s.lot_no, s.id, tid, sp.sku, tp.sku, p_qty, left(trim(p_note), 300), auth.uid(), who);
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (s.branch_id, 'adjust', sp.sku, 'Lot ' || coalesce(nullif(s.lot_no, ''), '(no lot #)') || ': ' || trim_scale(p_qty) || ' changed to ' || tp.sku
          || ' (Adj on FOAM LOTS). ' || left(trim(p_note), 200), who),
         (s.branch_id, 'adjust', tp.sku, 'Lot ' || coalesce(nullif(s.lot_no, ''), '(no lot #)') || ': ' || trim_scale(p_qty) || ' changed from ' || sp.sku
          || case when made then ' (new row on FOAM LOTS).' else ' (Adj on FOAM LOTS).' end, who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = s.branch_id;
  return trim_scale(p_qty) || ' of lot ' || coalesce(nullif(s.lot_no, ''), '(no lot #)') || ' changed from ' || sp.sku || ' to ' || tp.sku
         || '. The spreadsheet catches up within 2 minutes.';
end $fn$;
revoke all on function public.inventory_lot_switch(bigint, numeric, uuid, text) from public, anon;
grant execute on function public.inventory_lot_switch(bigint, numeric, uuid, text) to authenticated;

-- Fix a lot's expiration and/or made-on date. Every row of that lot # at the location gets it (it's one lot from the
-- maker, whatever product it's sold as now).
create or replace function public.inventory_lot_dates(p_lot bigint, p_exp date, p_mfg date, p_note text) returns text
language plpgsql security definer set search_path = public as $fn$
declare s public.inventory_lots; r record; n int := 0; who text := coalesce(public.my_name(), 'AMBIT A.I.');
begin
  if not (public.is_admin() or public.has_perm('item_variance')) then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  if p_exp is null and p_mfg is null then raise exception 'Type the right date.'; end if;
  select * into s from public.inventory_lots where id = p_lot;
  if s.id is null then raise exception 'That lot isn''t there any more.'; end if;
  if p_exp is not null and p_mfg is not null and p_exp <= p_mfg then raise exception 'The expiration date has to be after the made-on date.'; end if;
  for r in select * from public.inventory_lots x
            where x.id = s.id
               or (x.branch_id = s.branch_id and (x.on_sheet or x.add_to_sheet) and coalesce(s.lot_no, '') <> ''
                   and public.lot_key(x.lot_no) = public.lot_key(s.lot_no))
            for update loop
    if (p_exp is null or p_exp is not distinct from coalesce(r.exp_set, r.exp)) and (p_mfg is null or p_mfg is not distinct from coalesce(r.mfg_set, r.mfg)) then
      continue;
    end if;
    update public.inventory_lots
       set exp = coalesce(p_exp, exp), mfg = coalesce(p_mfg, mfg),
           exp_set = case when p_exp is not null and on_sheet then p_exp else exp_set end,
           mfg_set = case when p_mfg is not null and on_sheet then p_mfg else mfg_set end,
           updated_at = now()
     where id = r.id;
    insert into public.inventory_lot_changes (branch_id, kind, lot_no, from_lot_id, from_sku, old_exp, new_exp, old_mfg, new_mfg, note, by_id, by_name)
    values (r.branch_id, 'dates', r.lot_no, r.id, r.sku, r.exp, coalesce(p_exp, r.exp), r.mfg, coalesce(p_mfg, r.mfg), nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid(), who);
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (r.branch_id, 'adjust', r.sku, 'Lot ' || coalesce(nullif(r.lot_no, ''), '(no lot #)') || ' dates fixed'
            || case when p_exp is not null then ': expires ' || to_char(p_exp, 'MM/DD/YYYY') || ' (was ' || coalesce(to_char(r.exp, 'MM/DD/YYYY'), 'blank') || ')' else '' end
            || case when p_mfg is not null then '; made ' || to_char(p_mfg, 'MM/DD/YYYY') || ' (was ' || coalesce(to_char(r.mfg, 'MM/DD/YYYY'), 'blank') || ')' else '' end
            || '.', who);
    n := n + 1;
  end loop;
  if n = 0 then return 'Those are already the dates on lot ' || coalesce(nullif(s.lot_no, ''), '(no lot #)') || '.'; end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = s.branch_id;
  return 'Lot ' || coalesce(nullif(s.lot_no, ''), '(no lot #)') || ' fixed on ' || n || ' row' || case when n = 1 then '' else 's' end
         || '. The spreadsheet catches up within 2 minutes.';
end $fn$;
revoke all on function public.inventory_lot_dates(bigint, date, date, text) from public, anon;
grant execute on function public.inventory_lot_dates(bigint, date, date, text) to authenticated;

notify pgrst, 'reload schema';

-- Check: should say 1.
select count(*) as "Change lots table (1)" from information_schema.tables where table_schema = 'public' and table_name = 'inventory_lot_changes';
