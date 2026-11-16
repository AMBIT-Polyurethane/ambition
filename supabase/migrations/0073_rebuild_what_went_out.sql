-- =====================================================================
-- AMBIT Intelligence update 0073 - Rebuild what went out on a shipped order
-- * On a picked-up or shipped order, admins can set how many drums of each item came off each lot in one go:
--   for example AMBI-SEAL 5.0 Winter, 6 from LW7911 + 16 from LW7991, becomes 22 from LW7991. The old drums go back
--   on their lots and the new ones come off (Shipped Out on FOAM LOTS, so the COUNT SHEET follows). PENDING ORDERS
--   gets the corrected lines, and the change is on the order's item variance table. Prices and the invoice don't
--   change; to change how many went out, use Edit order.
-- Run once in Supabase > SQL Editor, AFTER 0072. Safe to run again.
-- =====================================================================

-- ---------- The lots one item could have come from, and how many it has on each now ----------
create or replace function public.order_item_lot_options(p_item bigint)
returns table (lot_id bigint, product_id uuid, sku text, name text, lot_no text, exp date, use_by date, remaining numeric,
               mine numeric, on_sheet boolean, same_type boolean, expired boolean, held_for text)
language sql stable security definer set search_path = public as $$
  with it as (select i.*, o.branch_id, o.company_id from public.order_items i join public.orders o on o.id = i.order_id where i.id = p_item),
       cur as (select p.* from public.products p join it on p.id = it.product_id),
       used as (select l.lot_id, sum(l.qty) as q from public.inventory_lines l where l.order_item_id = p_item and l.state = 'done' and l.lot_id is not null group by l.lot_id)
  select x.id, x.product_id, x.sku, lp.name, nullif(x.lot_no, ''), x.exp, x.use_by, x.remaining,
         coalesce(u.q, 0), x.on_sheet,
         coalesce(lp.id = (select id from cur) or lp.stock_of = (select id from cur), false),
         coalesce(x.use_by < (now() at time zone 'America/Chicago')::date, false),
         public.inventory_lot_hold_text(x.id, (select company_id from it))
    from public.inventory_lots x
    join public.products lp on lp.id = x.product_id
    left join used u on u.lot_id = x.id
   where public.is_employee()
     and x.branch_id = (select branch_id from it)
     and (x.on_sheet or u.q is not null)
     and (lp.id = (select id from cur) or lp.stock_of = (select id from cur)
          or (lp.category_id is not distinct from (select category_id from cur)
              and lower(lp.unit) = lower((select unit from it))
              and public.product_is_a_side(lp) = (select public.product_is_a_side(c) from public.products c where c.id = (select product_id from it))))
   order by coalesce(lp.id = (select id from cur) or lp.stock_of = (select id from cur), false) desc, lp.pick_rank,
            x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
$$;

-- ---------- Rebuild what went out, item by item ----------
-- p_items: [{"item": 123, "lots": [{"lot": 45, "qty": 22}, …]}, …]. Each item's drums must add up to what went out.
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
      if not (np.id = cur.id or np.stock_of = cur.id
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
      if not (np.id = cur.id or np.stock_of = cur.id) then
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
  foreach f in array array['order_item_lot_options(bigint)', 'order_relot_items(uuid, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('order_item_lot_options', 'order_relot_items');
