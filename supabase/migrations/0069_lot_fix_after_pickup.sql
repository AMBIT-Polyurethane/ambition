-- =====================================================================
-- AMBIT Intelligence update 0069 - Fix what was loaded, at pickup and after
-- * At pickup: whoever marks a spray-foam order picked up (or shipped out) confirms the lot on every drum, and can
--   pick the lot that really went on the truck (another lot, or the other brand of ISO). It's saved on the item
--   variance table.
-- * After pickup: admins can change the lot or the product type on a completed order. The drums go back on the lot
--   the app took them from and come off the lot that really left (Shipped Out on FOAM LOTS, so the COUNT SHEET
--   totals follow), the order's lot record is corrected, and prices and the invoice aren't touched.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- The lots a line could be: its product's lots, plus the other products it can swap to ----------
-- (ISO from another brand, Summer / Winter resin): same category, sold the same way, same side (A or B).
create or replace function public.inventory_lot_choices_any(p_line bigint)
returns table (lot_id bigint, product_id uuid, sku text, name text, lot_no text, use_by date, exp date, mfg date,
               remaining numeric, available numeric, expired boolean, current boolean, same_type boolean)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.inventory_lines where id = p_line),
       it as (select i.* from public.order_items i join l on l.order_item_id = i.id),
       cur as (select p.* from public.products p join it on p.id = it.product_id),
       cand as (
         select p.id, coalesce(p.id = (select id from cur) or p.stock_of = (select id from cur), false) as same_type
           from public.products p
          where p.active and (
                p.id = (select id from cur) or p.stock_of = (select id from cur)
             or (p.category_id is not distinct from (select category_id from cur)
                 and lower(p.unit) = lower((select unit from it))
                 and public.product_is_a_side(p) = (select public.product_is_a_side(cp) from public.products cp where cp.id = (select product_id from it))))
       )
  select x.id, x.product_id, x.sku, p.name, x.lot_no, x.use_by, x.exp, x.mfg, x.remaining,
         -- what's left on the lot for this line: done lines already came off it, open ones are held
         case when (select state from l) = 'done'
              then x.remaining + case when x.id = (select lot_id from l) then (select qty from l) else 0 end
              else x.remaining - x.sheet_pending
                   - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved' and r.id <> p_line), 0) end,
         coalesce(x.use_by < (now() at time zone 'America/Chicago')::date, false),
         x.id = (select lot_id from l),
         c.same_type
    from public.inventory_lots x
    join cand c on c.id = x.product_id
    join public.products p on p.id = x.product_id
   where public.is_employee()
     and x.branch_id = (select branch_id from l) and x.on_sheet
   order by c.same_type desc, p.pick_rank, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
$$;

-- ---------- Change the lot (and, through it, the product) on one line of an order ----------
-- p_at_pickup: the person marking the order picked up / shipped out is saying what really went on the truck.
create or replace function public.order_line_relot(p_line bigint, p_lot bigint, p_reason text, p_at_pickup boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l     public.inventory_lines;
  o     public.orders;
  it    public.order_items;
  lot   public.inventory_lots;
  cur   public.products;
  np    public.products;
  base  uuid;
  avail numeric;
  who   text := coalesce(public.my_name(), 'AMBIT');
  tag   text;
  from_t text;
  to_t  text;
  kind  text;
  why   text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  select * into l from public.inventory_lines where id = p_line for update;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  select * into o from public.orders where id = l.order_id for update;
  select * into it from public.order_items where id = l.order_item_id for update;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if l.state = 'cancelled' then raise exception 'That line was released, so there''s nothing to change.'; end if;

  -- Who: after pickup, admins only. At pickup, whoever closes the order. Before that, the Item variance box.
  if l.state = 'done' then
    if not public.is_admin() then raise exception 'Only an admin can change what was loaded after pickup.'; end if;
    if why is null then raise exception 'Say why it''s changing, for example "Packing slip shows Wanhua lot 2604P0345".'; end if;
  elsif p_at_pickup then
    if not (public.has_perm('order_desk') or public.has_perm('inventory') or public.has_perm('item_variance')) then
      raise exception 'You don''t have access to close orders.';
    end if;
  elsif not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;

  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || l.branch_id));
  select * into lot from public.inventory_lots where id = p_lot;
  if lot.id is null or not lot.on_sheet or lot.branch_id <> l.branch_id then
    raise exception 'That lot isn''t on this location''s FOAM LOTS tab.';
  end if;

  -- The new lot's product: the same one, or one the item can swap to.
  select * into cur from public.products where id = it.product_id;
  select * into np from public.products where id = lot.product_id;
  if not (np.id = cur.id or np.stock_of = cur.id
          or (np.category_id is not distinct from cur.category_id and lower(np.unit) = lower(it.unit)
              and public.product_is_a_side(np) = public.product_is_a_side(cur))) then
    raise exception 'That lot is % (%), which can''t take the place of %.', np.name, np.sku, cur.name;
  end if;
  base := case when np.id = cur.id or np.stock_of = cur.id then cur.id else coalesce(np.stock_of, np.id) end;

  -- Enough on it?
  if l.state = 'done' then
    avail := lot.remaining;  -- already less what the app has taken off and not yet written to the sheet
  else
    avail := lot.remaining - lot.sheet_pending
             - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = lot.id and r.state = 'reserved' and r.id <> l.id), 0);
  end if;
  if avail < l.qty then
    raise exception 'Lot % shows only % on FOAM LOTS, so % can''t have come from it. Check the lot number.',
      coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(avail, 0)), trim_scale(l.qty);
  end if;

  from_t := trim_scale(l.qty) || ' × ' || l.sku || ' · ' || case when l.lot_id is null then 'no lot picked' else 'Lot ' || coalesce(l.lot_no, '(no lot #)') end;
  to_t := trim_scale(l.qty) || ' × ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)');
  tag := 'ORD-' || o.order_no || case when l.state = 'done' then ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end
                                     else ' at ' || case when o.delivery_method = 'pickup' then 'pickup' else 'loading' end end || ': ';

  -- Picked up already: put it back on the old lot, then take it off the right one (Shipped Out on FOAM LOTS).
  if l.state = 'done' and l.stock_taken then
    perform public.inventory_line_stock(l.id, 1, 'order', tag, who);
  end if;
  update public.inventory_lines
     set lot_id = lot.id, lot_no = nullif(lot.lot_no, ''), product_id = lot.product_id,
         prev_sku = case when upper(sku) <> upper(lot.sku) then coalesce(prev_sku, sku) else prev_sku end,
         sku = lot.sku, needs_write = true, updated_at = now()
   where id = l.id;
  if l.state = 'done' and l.stock_taken then
    perform public.inventory_line_stock(l.id, -1, 'order', tag, who);
  end if;

  -- A different product: the order item follows once every one of its lines is that product.
  kind := 'lot';
  if base <> cur.id then
    kind := 'type';
    if not exists (select 1 from public.inventory_lines r join public.products rp on rp.id = r.product_id
                    where r.order_item_id = it.id and r.state <> 'cancelled' and coalesce(rp.stock_of, rp.id) <> base and rp.id <> base) then
      select * into np from public.products where id = base;
      update public.order_items
         set ordered_product_id = case when it.ordered_sku is null then it.product_id else ordered_product_id end,
             ordered_sku  = coalesce(ordered_sku, it.sku),
             ordered_name = coalesce(ordered_name, it.name),
             product_id = np.id, sku = np.sku, name = np.name
       where id = it.id;
      update public.order_items set ordered_product_id = null, ordered_sku = null, ordered_name = null
       where id = it.id and upper(ordered_sku) = upper(sku);
    end if;
  end if;

  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, it.id, kind, from_t, to_t,
          coalesce(why, case when p_at_pickup then 'Loaded at ' || case when o.delivery_method = 'pickup' then 'pickup' else 'shipping' end end),
          case when l.state = 'done' then 'after_pickup' when p_at_pickup then 'at_pickup' else o.stage end, auth.uid(), who);
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (l.branch_id, 'order', lot.sku, tag || from_t || ' → ' || to_t || coalesce(' (' || why || ')', '') || '.', who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = l.branch_id;
  return coalesce(nullif(lot.lot_no, ''), '(no lot #)');
end $$;

do $$
declare f text;
begin
  foreach f in array array['inventory_lot_choices_any(bigint)', 'order_line_relot(bigint, bigint, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc where proname in ('inventory_lot_choices_any', 'order_line_relot');
