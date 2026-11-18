-- =====================================================================
-- 0086: Edit order works like a sheet. On an open order, an item's drums are held on exactly the lots you put
--   in its rows (15 from AP9166AB + 1 from AP9168AB), any number of lots, brands of the same item included.
--   Whatever has no lot picked is held the usual way. "Let a lot go below zero" holds them even when the lot
--   shows fewer (Admin > Data check lists every lot below zero).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.order_item_set_lots(p_item bigint, p_lots jsonb, p_below_zero boolean default false, p_reason text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  it      public.order_items;
  o       public.orders;
  s       jsonb;
  lot     public.inventory_lots;
  lp      public.products;
  q       numeric;
  total   numeric := 0;
  need    numeric;
  take    numeric;
  avail   numeric;
  r       record;
  cand    uuid[];
  first   record;
  from_t  text;
  to_t    text;
  who     text := coalesce(public.my_name(), 'AMBIT');
  today   date := (now() at time zone 'America/Chicago')::date;
begin
  if not public.is_employee() or not (public.is_admin() or public.has_perm('ordering') or public.has_perm('order_desk') or public.has_perm('item_variance')) then
    raise exception 'You don''t have access to change the lots on orders.';
  end if;
  select * into it from public.order_items where id = p_item;
  if it.id is null then raise exception 'That item isn''t on the order any more. Reload the page.'; end if;
  select * into o from public.orders where id = it.order_id for update;
  if o.status not in ('new', 'processing') then raise exception 'ORD-% has already gone out: its lots are saved with the rest of the order.', o.order_no; end if;
  if o.branch_id is null or o.delivery_method = 'dropship' then raise exception 'ORD-% has no location to hold drums at.', o.order_no; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  -- Every lot is at this location and is this item (or one of its brands).
  for s in select * from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) loop
    q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select * into lot from public.inventory_lots where id = nullif(s ->> 'lot', '')::bigint;
    if lot.id is null or lot.branch_id <> o.branch_id then raise exception 'One of those lots isn''t at %. Reload the page.', upper(o.branch_id); end if;
    select * into lp from public.products where id = lot.product_id;
    if not (lp.id = it.product_id or coalesce(lp.stock_of = it.product_id, false)) then
      raise exception 'Lot % is %, not %.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lp.name, it.name;
    end if;
    total := total + q;
  end loop;
  if total > it.qty then
    raise exception '%: the lots add up to %, but the order has %.', it.name, trim_scale(total), trim_scale(it.qty);
  end if;

  select string_agg(trim_scale(x.qty) || ' × ' || coalesce('Lot ' || x.lot_no, 'no lot'), ' + ' order by x.id) into from_t
    from public.inventory_lines x where x.order_item_id = it.id and x.state = 'reserved';

  -- Let go of what it holds now…
  update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now()
   where order_item_id = it.id and state = 'reserved';

  -- …hold the lots asked for…
  for s in select * from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) loop
    q := round(coalesce((s ->> 'qty')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select * into lot from public.inventory_lots where id = nullif(s ->> 'lot', '')::bigint;
    avail := lot.remaining - lot.sheet_pending
             - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = lot.id and x.state = 'reserved'), 0)
             - public.inventory_lot_held(lot.id, o.company_id);
    if not coalesce(p_below_zero, false) and q > avail then
      raise exception 'Lot % has only % free at %, so % can''t be held on it. Tick "Let a lot go below zero" to hold them anyway.',
        coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(avail, 0)), upper(o.branch_id), trim_scale(q);
    end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
    values (it.id, o.id, o.branch_id, lot.product_id, lot.sku, q, lot.id, nullif(lot.lot_no, ''));
  end loop;

  -- …and the rest the usual way (soonest to expire first).
  need := it.qty - total;
  if need > 0 then
    select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
    cand := coalesce(cand, '{}') || it.product_id;
    for r in
      select l.id, l.product_id, l.sku, l.lot_no,
             l.remaining - l.sheet_pending
               - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = l.id and x.state = 'reserved'), 0)
               - public.inventory_lot_held(l.id, o.company_id) as avail
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet and (l.use_by is null or l.use_by >= today)
       order by (public.inventory_lot_mine(l.id, o.company_id) > 0) desc, p.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
    loop
      exit when need <= 0;
      continue when r.avail <= 0;
      take := least(need, r.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, o.id, o.branch_id, r.product_id, r.sku, take, r.id, nullif(r.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      select l.product_id, l.sku into first
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
       order by p.pick_rank, l.use_by nulls last, l.id limit 1;
      if first.product_id is null then
        select it.product_id as product_id, it.sku as sku into first;
      end if;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, o.id, o.branch_id, first.product_id, first.sku, need);
    end if;
  end if;

  select string_agg(trim_scale(x.qty) || ' × ' || coalesce('Lot ' || x.lot_no, 'no lot'), ' + ' order by x.id) into to_t
    from public.inventory_lines x where x.order_item_id = it.id and x.state = 'reserved';
  if to_t is distinct from from_t then
    insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
    values (o.id, it.id, 'lot', from_t, to_t, coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Edit order'), o.stage, auth.uid(), who);
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (o.branch_id, 'order', it.sku, 'ORD-' || o.order_no || ' ' || it.name || ': ' || coalesce(from_t, 'nothing held') || ' → ' || coalesce(to_t, 'nothing held') || ' (Edit order).', who);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  return coalesce(to_t, '');
end $$;
revoke all on function public.order_item_set_lots(bigint, jsonb, boolean, text) from public, anon;
grant execute on function public.order_item_set_lots(bigint, jsonb, boolean, text) to authenticated;

-- ORD-1109 (Alpha, Arlington): the AP210 resin is 15 drums from AP9166AB and 1 from AP9168AB (Javier, 11/18).
do $$
declare admin uuid; it record; a bigint; b bigint; res text;
begin
  select i.id, i.qty into it
    from public.order_items i join public.orders o on o.id = i.order_id
   where o.order_no = 1109 and o.status in ('new', 'processing') and upper(i.sku) = 'ALPHA-AP210-AB'
   order by i.id limit 1;
  if it.id is null then raise notice 'ORD-1109: no open AP210 line found, skipped (change it on Edit order).'; return; end if;
  if it.qty <> 16 then raise notice 'ORD-1109: the AP210 line has % drums, not 16, skipped (change it on Edit order).', trim_scale(it.qty); return; end if;
  select id into a from public.inventory_lots where branch_id = 'atx' and upper(sku) = 'ALPHA-AP210-AB' and public.lot_key(lot_no) = 'AP9166AB' order by on_sheet desc, id limit 1;
  select id into b from public.inventory_lots where branch_id = 'atx' and upper(sku) = 'ALPHA-AP210-AB' and public.lot_key(lot_no) = 'AP9168AB' order by on_sheet desc, id limit 1;
  if a is null or b is null then raise notice 'ORD-1109: lot AP9166AB or AP9168AB isn''t on Arlington''s FOAM LOTS, skipped.'; return; end if;
  select id into admin from public.profiles where role = 'admin' and status = 'active' order by (full_name ilike 'jeremiah%') desc, created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  begin
    res := public.order_item_set_lots(it.id, jsonb_build_array(jsonb_build_object('lot', a, 'qty', 15), jsonb_build_object('lot', b, 'qty', 1)), true, 'Javier: 15 from AP9166AB, 1 from AP9168AB');
    raise notice 'ORD-1109 AP210 now: %', res;
  exception when others then
    raise notice 'ORD-1109 wasn''t changed: %', sqlerrm;
  end;
end $$;

select 'Ready (should be 1)' as "Check", count(*) as "Count" from pg_proc
 where proname = 'order_item_set_lots' and pronamespace = 'public'::regnamespace
union all
select 'ORD-1109 AP210 lots', null from (select 1) x
union all
select '  ' || coalesce(l.lot_no, '(no lot)') || ': ' || trim_scale(sum(l.qty)) || ' drums', null
  from public.inventory_lines l join public.orders o on o.id = l.order_id
 where o.order_no = 1109 and upper(l.sku) = 'ALPHA-AP210-AB' and l.state = 'reserved'
 group by l.lot_no;
