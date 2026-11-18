-- =====================================================================
-- 0083: Fix what went out works on orders that have NO lots recorded at all (older orders like ORD-1007):
--   enter the lots that went out for an item's whole amount and they come off FOAM LOTS. An order with no
--   location says so (set it with Edit details first).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.order_relot_items(p_order uuid, p_items jsonb, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  o       public.orders;
  it      public.order_items;
  cur     public.products;
  np      public.products;
  lot     public.inventory_lots;
  l       public.inventory_lines;
  e       jsonb;
  s       jsonb;
  why     text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
  who     text := coalesce(public.my_name(), 'AMBIT');
  tag     text;
  total   numeric;
  newt    numeric;
  q       numeric;
  mine    numeric;
  nid     bigint;
  from_t  text;
  to_t    text;
  flag    text;
  allsame boolean;
  bases   uuid[];
  lots_n  int;
  n       int := 0;
  pid     uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can change what was loaded after pickup.'; end if;
  if why is null then raise exception 'Say why it''s changing, for example "Packing slip shows all 22 from lot LW7991".'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'completed' then
    raise exception 'This order hasn''t been picked up or shipped yet. Change its lots on the item variance table.';
  end if;
  if o.branch_id is null then
    raise exception 'This order has no location, so its lots can''t be recorded. Set the location first (Edit details on the order).';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));
  tag := 'ORD-' || o.order_no || ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end || ': ';

  for e in select * from jsonb_array_elements(p_items) loop
    select * into it from public.order_items where id = nullif(e ->> 'item', '')::bigint and order_id = p_order for update;
    if it.id is null then raise exception 'One of the items isn''t on this order any more. Reload the page.'; end if;
    select * into cur from public.products where id = it.product_id;
    select coalesce(sum(x.qty), 0) into total from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done';
    select coalesce(sum(round((x ->> 'qty')::numeric, 2)), 0) into newt
      from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) x where coalesce((x ->> 'qty')::numeric, 0) > 0;
    -- 0083: nothing was recorded as going out (an older order): record what did, the item's whole amount.
    if total = 0 and newt = it.qty then total := newt; end if;
    if newt <> total then
      raise exception '%: what you entered adds up to %, but % went out. To change how many went out, use Edit order.',
        it.name, trim_scale(newt), trim_scale(total);
    end if;

    -- The same as now? Then leave this item alone. (A lot: "l<id>"; counted by total: "p<product>".)
    if not exists (
      (select case when x.lot_id is not null then 'l' || x.lot_id else 'p' || x.product_id end, round(sum(x.qty), 2)
         from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1
       except
       select case when nullif(x ->> 'lot', '') is not null then 'l' || (x ->> 'lot') else 'p' || lower(x ->> 'product') end, round(sum((x ->> 'qty')::numeric), 2)
         from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) x where coalesce((x ->> 'qty')::numeric, 0) > 0 group by 1)
      union all
      (select case when nullif(x ->> 'lot', '') is not null then 'l' || (x ->> 'lot') else 'p' || lower(x ->> 'product') end, round(sum((x ->> 'qty')::numeric), 2)
         from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) x where coalesce((x ->> 'qty')::numeric, 0) > 0 group by 1
       except
       select case when x.lot_id is not null then 'l' || x.lot_id else 'p' || x.product_id end, round(sum(x.qty), 2)
         from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1)) then
      continue;
    end if;

    -- Every lot has to be at this location and have had that many on it; any product can take the item's place.
    for s in select * from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) loop
      q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
      if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
      if q = 0 then continue; end if;
      if nullif(s ->> 'lot', '') is null then
        -- Counted by total on the COUNT SHEET.
        select * into np from public.products where id = nullif(s ->> 'product', '')::uuid;
        if np.id is null then raise exception 'One of those products isn''t in the app. Reload the page.'; end if;
        if exists (select 1 from public.inventory_lots x where x.branch_id = o.branch_id and x.product_id = np.id and x.on_sheet) then
          raise exception '% is counted by lot at this location: put the drums on its lots instead.', np.name;
        end if;
        continue;
      end if;
      select * into lot from public.inventory_lots where id = nullif(s ->> 'lot', '')::bigint;
      if lot.id is null or lot.branch_id <> o.branch_id then raise exception 'One of those lots isn''t at this location. Reload the page.'; end if;
      select coalesce(sum(x.qty), 0) into mine from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' and x.lot_id = lot.id;
      if not lot.on_sheet and q > mine then
        raise exception 'Lot % isn''t on FOAM LOTS any more, so drums can''t be added to it.', coalesce(nullif(lot.lot_no, ''), '(no lot #)');
      end if;
      if q > lot.remaining + mine then
        raise exception 'Lot % shows only % on FOAM LOTS, so % can''t have come from it. Check the lot number.',
          coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(lot.remaining + mine, 0)), trim_scale(q);
      end if;
    end loop;

    select string_agg(trim_scale(z.q) || ' × ' || z.label, ' + ' order by z.label) into from_t
      from (select x.sku || ' · ' || coalesce('Lot ' || x.lot_no, 'no lot') as label, sum(x.qty) as q
              from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1) z;
    from_t := coalesce(from_t, 'no lot recorded');

    -- What the app had recorded goes back…
    for l in select * from public.inventory_lines where order_item_id = it.id and state = 'done' order by id loop
      if l.stock_taken then perform public.inventory_line_stock(l.id, 1, 'order', tag, who); end if;
      update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now() where id = l.id;
    end loop;

    -- …and what really went out comes off.
    allsame := true; bases := '{}'; lots_n := 0; flag := null; to_t := null;
    for s in select * from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) loop
      q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
      if q <= 0 then continue; end if;
      lots_n := lots_n + 1;
      if nullif(s ->> 'lot', '') is null then
        select * into np from public.products where id = nullif(s ->> 'product', '')::uuid;
        insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no, state, done_by, stock_taken, needs_write)
        values (it.id, o.id, o.branch_id, np.id, np.sku, q, null, null, 'done', 'app', true, true)
        returning id into nid;
        to_t := concat_ws(' + ', to_t, trim_scale(q) || ' × ' || np.sku || ' (counted by total)');
      else
        select * into lot from public.inventory_lots where id = nullif(s ->> 'lot', '')::bigint;
        select * into np from public.products where id = lot.product_id;
        if public.inventory_lot_held(lot.id, o.company_id) > 0 then
          flag := concat_ws('; ', flag, 'used drums held for ' || public.inventory_lot_hold_text(lot.id, o.company_id));
        end if;
        insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no, state, done_by, stock_taken, needs_write)
        values (it.id, o.id, o.branch_id, lot.product_id, lot.sku, q, lot.id, nullif(lot.lot_no, ''), 'done', 'app', true, true)
        returning id into nid;
        to_t := concat_ws(' + ', to_t, trim_scale(q) || ' × ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)'));
      end if;
      if not (np.id = cur.id or coalesce(np.stock_of = cur.id, false)) then
        allsame := false;
        bases := array_append(bases, coalesce(np.stock_of, np.id));
      end if;
      perform public.inventory_line_stock(nid, -1, 'order', tag, who);
    end loop;

    -- Everything that went out is one other product (another brand, Summer for Winter, drums for a tote, another
    -- resin): the order item follows, and keeps what was ordered.
    if not allsame and cardinality(bases) = lots_n and (select count(distinct b) from unnest(bases) b) = 1 then
      select * into np from public.products where id = bases[1];
      update public.order_items
         set ordered_product_id = case when it.ordered_sku is null then it.product_id else ordered_product_id end,
             ordered_sku  = coalesce(ordered_sku, it.sku),
             ordered_name = coalesce(ordered_name, it.name),
             product_id = np.id, sku = np.sku, name = np.name
       where id = it.id;
      update public.order_items set ordered_product_id = null, ordered_sku = null, ordered_name = null
       where id = it.id and upper(ordered_sku) = upper(sku);
    end if;

    insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
    values (o.id, it.id, case when allsame then 'lot' else 'type' end, from_t, to_t,
            concat_ws(' · ', why, case when flag is not null then initcap(left(flag, 1)) || substr(flag, 2) end), 'after_pickup', auth.uid(), who);
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (o.branch_id, 'order', it.sku, tag || it.name || ': ' || from_t || ' → ' || to_t || ' (' || why || ').' || coalesce(' Note: ' || flag || '.', ''), who);
    n := n + 1;
  end loop;

  if n = 0 then raise exception 'Nothing changed.'; end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  return n;
end $$;

select 'Ready (should be 1)' as "Check", count(*) as "Count" from pg_proc
 where proname = 'order_relot_items' and pronamespace = 'public'::regnamespace
   and prosrc like '%0083%';
