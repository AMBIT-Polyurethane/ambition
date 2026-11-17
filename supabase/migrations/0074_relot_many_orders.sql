-- =====================================================================
-- AMBIT Intelligence update 0074 - Fix the lots on many orders at once (BOL audit)
-- * "Fix what went out" saves one order at a time, and won't let a lot give more drums than FOAM LOTS shows left.
--   When the warehouse swapped lots between orders (order A took LW8034 but the app says LW8033, order B the other way
--   round), neither order can be saved first. This does the whole list in one go: every recorded drum goes back on its
--   lot, then every drum the packing slips show comes off its lot. Nothing is saved unless every order checks out.
-- * Afterwards it lists any lot that ends up below zero on FOAM LOTS: the packing slips say more drums came off it than
--   the sheet had, so count that lot.
-- * Fix what went out on one order: a Summer drum on a Winter item now switches the order item too.
-- Run once in Supabase > SQL Editor, AFTER 0073. Safe to run again.
-- =====================================================================

-- p_fixes: [{"order": 1029, "sku": "ISO", "lots": [{"lot": "PA86002851", "qty": 6}, …], "why": "Packing slip shows …"}, …]
-- "lot" is the lot number as FOAM LOTS writes it at the order's location. Each item's drums must add up to what went out.
create or replace function public.order_relot_bulk(p_fixes jsonb, p_reason text default null, p_by text default null)
returns table (result text, order_no int, item text, detail text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  f       jsonb;
  s       jsonb;
  p       jsonb;
  plan    jsonb := '[]'::jsonb;
  newl    jsonb;
  o       public.orders;
  it      public.order_items;
  cur     public.products;
  np      public.products;
  lot     public.inventory_lots;
  l       public.inventory_lines;
  who     text := coalesce(public.my_name(), nullif(trim(coalesce(p_by, '')), ''), 'Admin');
  why     text;
  tag     text;
  q       numeric;
  total   numeric;
  newt    numeric;
  mine    numeric;
  nid     bigint;
  lid     bigint;
  cnt     int;
  from_t  text;
  to_t    text;
  flag    text;
  allsame boolean;
  bases   uuid[];
  lots_n  int;
  touched bigint[] := '{}';
  brs     text[] := '{}';
begin
  -- Admins in the app, or whoever runs it in the Supabase SQL editor (that's the database owner already).
  if not (public.is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only an admin can change what was loaded after pickup.';
  end if;
  if jsonb_typeof(p_fixes) is distinct from 'array' or jsonb_array_length(p_fixes) = 0 then raise exception 'Nothing to save.'; end if;

  -- 1. Check every order and work out which FOAM LOTS row each lot number means. Nothing changes yet.
  for f in select * from jsonb_array_elements(p_fixes) loop
    select * into o from public.orders x where x.order_no = nullif(f ->> 'order', '')::int;
    if o.id is null then raise exception 'ORD-%: not found.', f ->> 'order'; end if;
    if o.status <> 'completed' then raise exception 'ORD-%: hasn''t been picked up or shipped yet.', o.order_no; end if;
    -- The item by its SKU (or the SKU it was ordered as, if an earlier fix already switched it).
    select count(*) into cnt from public.order_items x where x.order_id = o.id and upper(x.sku) = upper(f ->> 'sku');
    if cnt = 1 then
      select * into it from public.order_items x where x.order_id = o.id and upper(x.sku) = upper(f ->> 'sku');
    elsif cnt = 0 then
      select count(*) into cnt from public.order_items x where x.order_id = o.id and upper(x.ordered_sku) = upper(f ->> 'sku');
      if cnt = 1 then select * into it from public.order_items x where x.order_id = o.id and upper(x.ordered_sku) = upper(f ->> 'sku'); end if;
    end if;
    if cnt <> 1 then raise exception 'ORD-%: % items with SKU % (expected 1).', o.order_no, cnt, f ->> 'sku'; end if;
    select * into cur from public.products where id = it.product_id;
    why := coalesce(nullif(left(trim(coalesce(f ->> 'why', '')), 500), ''), nullif(left(trim(coalesce(p_reason, '')), 500), ''));
    if why is null then raise exception 'ORD-% %: say why it''s changing.', o.order_no, it.sku; end if;
    select coalesce(sum(x.qty), 0) into total from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done';
    if total = 0 then raise exception 'ORD-% %: nothing went out on this item in the app.', o.order_no, it.sku; end if;

    newt := 0; p := '[]'::jsonb;
    for s in select * from jsonb_array_elements(coalesce(f -> 'lots', '[]'::jsonb)) loop
      q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
      if q <= 0 then raise exception 'ORD-% %: quantities have to be above zero.', o.order_no, it.sku; end if;
      -- The lot row at this location: the item's own product (or its brand) first, then anything that can stand in for it.
      lid := null;
      select min(x.id), count(*) into lid, cnt
        from public.inventory_lots x join public.products lp on lp.id = x.product_id
       where x.branch_id = o.branch_id and upper(x.lot_no) = upper(trim(s ->> 'lot'))
         and (lp.id = cur.id or lp.stock_of = cur.id);
      if cnt <> 1 then
        select min(x.id), count(*) into lid, cnt
          from public.inventory_lots x join public.products lp on lp.id = x.product_id
         where x.branch_id = o.branch_id and upper(x.lot_no) = upper(trim(s ->> 'lot'))
           and lp.category_id is not distinct from cur.category_id and lower(lp.unit) = lower(it.unit)
           and public.product_is_a_side(lp) = public.product_is_a_side(cur);
      end if;
      if cnt = 0 then raise exception 'ORD-% %: there''s no lot % at % that can be %.', o.order_no, it.sku, s ->> 'lot', upper(o.branch_id), cur.name; end if;
      if cnt > 1 then raise exception 'ORD-% %: lot % matches % rows at %; say which product.', o.order_no, it.sku, s ->> 'lot', cnt, upper(o.branch_id); end if;
      select * into lot from public.inventory_lots where id = lid;
      select coalesce(sum(x.qty), 0) into mine from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' and x.lot_id = lot.id;
      if not lot.on_sheet and q > mine then
        raise exception 'ORD-% %: lot % isn''t on FOAM LOTS any more, so drums can''t be added to it.', o.order_no, it.sku, lot.lot_no;
      end if;
      newt := newt + q;
      p := p || jsonb_build_object('lot', lot.id, 'qty', q);
    end loop;
    if newt <> total then
      raise exception 'ORD-% %: the lots add up to %, but % went out. To change how many went out, use Edit order.',
        o.order_no, it.sku, trim_scale(newt), trim_scale(total);
    end if;
    if exists (select 1 from jsonb_array_elements(plan) x where (x ->> 'item')::bigint = it.id) then
      raise exception 'ORD-% %: listed twice.', o.order_no, it.sku;
    end if;

    -- Already right? Leave it alone.
    if not exists (
      (select coalesce(x.lot_id, 0), round(sum(x.qty), 2) from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1
       except
       select (x ->> 'lot')::bigint, round(sum((x ->> 'qty')::numeric), 2) from jsonb_array_elements(p) x group by 1)
      union all
      (select (x ->> 'lot')::bigint, round(sum((x ->> 'qty')::numeric), 2) from jsonb_array_elements(p) x group by 1
       except
       select coalesce(x.lot_id, 0), round(sum(x.qty), 2) from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1)) then
      result := 'already right'; order_no := o.order_no; item := it.sku; detail := null;
      return next;
      continue;
    end if;

    select string_agg(trim_scale(z.q) || ' × ' || z.label, ' + ' order by z.label) into from_t
      from (select x.sku || ' · ' || coalesce('Lot ' || x.lot_no, 'no lot') as label, sum(x.qty) as q
              from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1) z;
    plan := plan || jsonb_build_object('order', o.id, 'item', it.id, 'why', why, 'from', from_t, 'lots', p);
  end loop;

  if jsonb_array_length(plan) = 0 then return; end if;

  -- 2. Everything the app had recorded goes back on its lot…
  for p in select * from jsonb_array_elements(plan) loop
    select * into o from public.orders where id = (p ->> 'order')::uuid for update;
    perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));
    tag := 'ORD-' || o.order_no || ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end || ' (BOL check): ';
    for l in select * from public.inventory_lines where order_item_id = (p ->> 'item')::bigint and state = 'done' order by id loop
      if l.stock_taken then perform public.inventory_line_stock(l.id, 1, 'order', tag, who); end if;
      update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now() where id = l.id;
      if l.lot_id is not null then touched := array_append(touched, l.lot_id); end if;
    end loop;
  end loop;

  -- 3. …then every drum the packing slips show comes off its lot.
  for p in select * from jsonb_array_elements(plan) loop
    select * into o from public.orders where id = (p ->> 'order')::uuid;
    select * into it from public.order_items where id = (p ->> 'item')::bigint for update;
    select * into cur from public.products where id = it.product_id;
    tag := 'ORD-' || o.order_no || ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end || ' (BOL check): ';
    allsame := true; bases := '{}'; lots_n := 0; flag := null; to_t := null;
    for newl in select * from jsonb_array_elements(p -> 'lots') loop
      q := (newl ->> 'qty')::numeric;
      select * into lot from public.inventory_lots where id = (newl ->> 'lot')::bigint;
      select * into np from public.products where id = lot.product_id;
      lots_n := lots_n + 1;
      if not (np.id = cur.id or coalesce(np.stock_of = cur.id, false)) then
        allsame := false;
        bases := array_append(bases, coalesce(np.stock_of, np.id));
      end if;
      if public.inventory_lot_held(lot.id, o.company_id) > 0 then
        flag := concat_ws('; ', flag, 'used drums held for ' || public.inventory_lot_hold_text(lot.id, o.company_id));
      end if;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no, state, done_by, stock_taken, needs_write)
      values (it.id, o.id, o.branch_id, lot.product_id, lot.sku, q, lot.id, nullif(lot.lot_no, ''), 'done', 'app', true, true)
      returning id into nid;
      perform public.inventory_line_stock(nid, -1, 'order', tag, who);
      touched := array_append(touched, lot.id);
      to_t := concat_ws(' + ', to_t, trim_scale(q) || ' × ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)'));
    end loop;

    -- Every drum is another product (the other brand, Summer for Winter): the order item follows.
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
    values (o.id, it.id, case when allsame then 'lot' else 'type' end, p ->> 'from', to_t,
            concat_ws(' · ', p ->> 'why', case when flag is not null then initcap(left(flag, 1)) || substr(flag, 2) end), 'after_pickup', auth.uid(), who);
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (o.branch_id, 'order', it.sku, tag || it.name || ': ' || (p ->> 'from') || ' → ' || to_t || ' (' || (p ->> 'why') || ').'
            || coalesce(' Note: ' || flag || '.', ''), who);
    brs := array_append(brs, o.branch_id);
    result := 'fixed'; order_no := o.order_no; item := it.name; detail := (p ->> 'from') || '  →  ' || to_t;
    return next;
  end loop;

  update public.inventory_sheets set sync_wanted_at = now() where branch_id = any(brs);

  -- 4. Lots the packing slips took more from than FOAM LOTS had: count them.
  for lot in select * from public.inventory_lots where id = any(touched) and remaining < 0 order by branch_id, sku, lot_no loop
    result := 'count this lot'; order_no := null; item := upper(lot.branch_id) || ' ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)');
    detail := 'FOAM LOTS now shows ' || trim_scale(lot.remaining) || ' left: the packing slips say more drums came off it than the sheet had.';
    return next;
  end loop;
end $$;

-- ---------- Fix what went out (0073), one order: a Summer drum for a Winter item (a product with no brand above it)
-- now changes the order item too, the way it already did for the other brand. ----------
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
begin
  if not public.is_admin() then raise exception 'Only an admin can change what was loaded after pickup.'; end if;
  if why is null then raise exception 'Say why it''s changing, for example "Packing slip shows all 22 from lot LW7991".'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'completed' then
    raise exception 'This order hasn''t been picked up or shipped yet. Change its lots on the item variance table.';
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
    if newt <> total then
      raise exception '%: the lots add up to %, but % went out. To change how many went out, use Edit order.',
        it.name, trim_scale(newt), trim_scale(total);
    end if;

    -- The same as now? Then leave this item alone.
    if not exists (
      (select coalesce(x.lot_id, 0), round(sum(x.qty), 2) from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1
       except
       select coalesce(nullif(x ->> 'lot', '')::bigint, 0), round(sum((x ->> 'qty')::numeric), 2)
         from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) x where coalesce((x ->> 'qty')::numeric, 0) > 0 group by 1)
      union all
      (select coalesce(nullif(x ->> 'lot', '')::bigint, 0), round(sum((x ->> 'qty')::numeric), 2)
         from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) x where coalesce((x ->> 'qty')::numeric, 0) > 0 group by 1
       except
       select coalesce(x.lot_id, 0), round(sum(x.qty), 2) from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1)) then
      continue;
    end if;

    -- Every lot has to be at this location, the right kind of product, and have had that many on it.
    for s in select * from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) loop
      q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
      if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
      if q = 0 then continue; end if;
      select * into lot from public.inventory_lots where id = nullif(s ->> 'lot', '')::bigint;
      if lot.id is null or lot.branch_id <> o.branch_id then raise exception 'One of those lots isn''t at this location. Reload the page.'; end if;
      select coalesce(sum(x.qty), 0) into mine from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' and x.lot_id = lot.id;
      if not lot.on_sheet and q > mine then
        raise exception 'Lot % isn''t on FOAM LOTS any more, so drums can''t be added to it.', coalesce(nullif(lot.lot_no, ''), '(no lot #)');
      end if;
      select * into np from public.products where id = lot.product_id;
      if not (np.id = cur.id or coalesce(np.stock_of = cur.id, false)
              or (np.category_id is not distinct from cur.category_id and lower(np.unit) = lower(it.unit)
                  and public.product_is_a_side(np) = public.product_is_a_side(cur))) then
        raise exception 'Lot % is % (%), which can''t take the place of %.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), np.name, np.sku, cur.name;
      end if;
      if q > lot.remaining + mine then
        raise exception 'Lot % shows only % on FOAM LOTS, so % can''t have come from it. Check the lot number.',
          coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(lot.remaining + mine, 0)), trim_scale(q);
      end if;
    end loop;

    select string_agg(trim_scale(z.q) || ' × ' || z.label, ' + ' order by z.label) into from_t
      from (select x.sku || ' · ' || coalesce('Lot ' || x.lot_no, 'no lot') as label, sum(x.qty) as q
              from public.inventory_lines x where x.order_item_id = it.id and x.state = 'done' group by 1) z;

    -- The drums the app had recorded go back on their lots…
    for l in select * from public.inventory_lines where order_item_id = it.id and state = 'done' order by id loop
      if l.stock_taken then perform public.inventory_line_stock(l.id, 1, 'order', tag, who); end if;
      update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now() where id = l.id;
    end loop;

    -- …and the ones that really went out come off theirs.
    allsame := true; bases := '{}'; lots_n := 0; flag := null; to_t := null;
    for s in select * from jsonb_array_elements(coalesce(e -> 'lots', '[]'::jsonb)) loop
      q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
      if q <= 0 then continue; end if;
      select * into lot from public.inventory_lots where id = nullif(s ->> 'lot', '')::bigint;
      select * into np from public.products where id = lot.product_id;
      lots_n := lots_n + 1;
      if not (np.id = cur.id or coalesce(np.stock_of = cur.id, false)) then
        allsame := false;
        bases := array_append(bases, coalesce(np.stock_of, np.id));
      end if;
      if public.inventory_lot_held(lot.id, o.company_id) > 0 then
        flag := concat_ws('; ', flag, 'used drums held for ' || public.inventory_lot_hold_text(lot.id, o.company_id));
      end if;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no, state, done_by, stock_taken, needs_write)
      values (it.id, o.id, o.branch_id, lot.product_id, lot.sku, q, lot.id, nullif(lot.lot_no, ''), 'done', 'app', true, true)
      returning id into nid;
      perform public.inventory_line_stock(nid, -1, 'order', tag, who);
      to_t := concat_ws(' + ', to_t, trim_scale(q) || ' × ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)'));
    end loop;

    -- Every drum is another product (the other brand, Summer for Winter): the order item follows.
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

do $$
declare f text;
begin
  foreach f in array array['order_relot_bulk(jsonb, text, text)', 'order_relot_items(uuid, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('order_relot_bulk', 'order_relot_items');
