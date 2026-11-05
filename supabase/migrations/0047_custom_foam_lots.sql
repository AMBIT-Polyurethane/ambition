-- =====================================================================
-- AMBIT Intelligence update 0047 - Custom foam order: pick the exact lot / batch
-- * "Make Custom Foam Order" (AMBIT staff) lists every lot of each ISO brand and resin at the location (lot #,
--   made and expiry dates, drums available), so staff can order exact drums: 4 from lot PA86002836, 2 from lot
--   PA86002841. Anything not given a lot is still picked by the app (soonest-expiring first).
-- * place_order takes the lots picked (p_lots). The database checks each one: right location, right product,
--   not expired, and enough drums still available, so two people can't hold the same drums.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Lots for the order screen (staff) ----------
-- Every lot with drums left on a location's FOAM LOTS tab, with what's still free to order.
create or replace function public.order_lot_choices(p_branch text default null)
returns table (lot_id bigint, branch_id text, product_id uuid, sku text, lot_no text, mfg date, exp date, use_by date,
               remaining numeric, available numeric, expired boolean)
language sql stable set search_path = public as $$
  select x.id, x.branch_id, x.product_id, x.sku, x.lot_no, x.mfg, x.exp, x.use_by, x.remaining,
         x.remaining - x.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved'), 0),
         coalesce(x.use_by < (now() at time zone 'America/Chicago')::date, false)
    from public.inventory_lots x
   where public.is_employee() and public.is_active()
     and (p_branch is null or x.branch_id = p_branch)
     and x.on_sheet and x.remaining > 0
     and exists (select 1 from public.inventory_sheets s where s.branch_id = x.branch_id and s.enabled)
   order by x.branch_id, x.product_id, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
$$;

-- ---------- Holding the lots picked for one order line ----------
-- Runs inside place_order, right after the line is added (the app has already held drums soonest-expiring first;
-- those are swapped for the lots picked). Not callable on its own.
create or replace function public.order_item_pick_lots(p_item bigint, p_lots jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it     public.order_items;
  o      record;
  e      jsonb;
  lot    record;
  first  record;
  q      numeric;
  picked numeric := 0;
  need   numeric;
  take   numeric;
  cand   uuid[];
  seen   bigint[] := '{}';
  today  date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  if p_lots is null or jsonb_typeof(p_lots) <> 'array' or jsonb_array_length(p_lots) = 0 then return; end if;
  select id, branch_id, delivery_method into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' then
    raise exception 'Lots can only be picked when the order comes from an AMBIT location (not drop ship).';
  end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled) then
    raise exception 'This location''s inventory spreadsheet isn''t connected, so lots can''t be picked here.';
  end if;

  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  cand := coalesce(cand, '{}') || it.product_id;

  -- What the app held on its own for this line is replaced by the lots picked.
  delete from public.inventory_lines where order_item_id = it.id and state = 'reserved' and sheet_row is null;

  for e in select * from jsonb_array_elements(p_lots) loop
    q := round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select x.id, x.branch_id, x.product_id, x.sku, x.lot_no, x.on_sheet, x.use_by,
           x.remaining - x.sheet_pending
             - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved'), 0) as avail
      into lot
      from public.inventory_lots x
     where x.id = nullif(e ->> 'lot_id', '')::bigint;
    if lot.id is null or lot.branch_id <> o.branch_id or not lot.on_sheet then
      raise exception 'A lot picked for % isn''t on this location''s FOAM LOTS tab any more. Reload the page and pick again.', it.sku;
    end if;
    if not (lot.product_id = any(cand)) then
      raise exception 'Lot % is %, not %. Reload the page and pick again.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lot.sku, it.sku;
    end if;
    if lot.id = any(seen) then
      raise exception 'Lot % is on the order twice for %. Reload the page and pick again.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), it.sku;
    end if;
    seen := seen || lot.id;
    if lot.use_by is not null and lot.use_by < today then
      raise exception 'Lot % of % expired on %. Pick another lot.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lot.sku, to_char(lot.use_by, 'FMMM/FMDD/YYYY');
    end if;
    if q > lot.avail then
      raise exception 'Lot % of % only has % available now. Reload the page and pick again.',
        coalesce(nullif(lot.lot_no, ''), '(no lot #)'), lot.sku, trim_scale(greatest(lot.avail, 0));
    end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
    values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, q, lot.id, nullif(lot.lot_no, ''));
    picked := picked + q;
  end loop;

  if picked > it.qty then
    raise exception 'The lots picked for % add up to % but the order has %. Reload the page and pick again.', it.sku, trim_scale(picked), trim_scale(it.qty);
  end if;

  -- The rest of the line (no lot picked): soonest-expiring lot first, like any order.
  need := it.qty - picked;
  if need > 0 then
    for lot in
      select x.id, x.product_id, x.sku, x.lot_no,
             x.remaining - x.sheet_pending
               - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved'), 0) as avail
        from public.inventory_lots x
        join public.products p on p.id = x.product_id
       where x.branch_id = o.branch_id and x.product_id = any(cand) and x.on_sheet
         and (x.use_by is null or x.use_by >= today)
       order by p.pick_rank, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      -- Short on stock: the rest waits with no lot yet (pick it on the order page later).
      select x.product_id, x.sku into first
        from public.inventory_lots x join public.products p on p.id = x.product_id
       where x.branch_id = o.branch_id and x.product_id = any(cand) and x.on_sheet
       order by p.pick_rank, x.use_by nulls last, x.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, coalesce(first.product_id, it.product_id), coalesce(first.sku, it.sku), need);
    end if;
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.order_item_pick_lots(bigint, jsonb) from public, anon, authenticated;

-- ---------- Placing an order: AMBIT staff can pick the lots ----------
-- Same as 0044, plus p_lots: [{"product_id": "...", "lot_id": 12, "qty": 4}, ...] (staff only).
drop function if exists public.place_order(jsonb, text, text, text, text, date, text, uuid, text);
create or replace function public.place_order(
  p_items           jsonb,
  p_delivery_method text,
  p_branch_id       text default null,
  p_ship_address    text default null,
  p_po_number       text default null,
  p_needed_by       date default null,
  p_notes           text default null,
  p_company_id      uuid default null,
  p_customer_name   text default null,
  p_lots            jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me       public.profiles;
  co       public.companies;
  new_id   uuid;
  item     jsonb;
  pr       record;
  q        numeric;
  subtotal numeric := 0;
  any_cp   boolean := false;
  n        int := 0;
  v_branch text;
  v_item   bigint;
  v_lots   jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then
    raise exception 'Your account is not active yet.';
  end if;

  if me.role = 'customer' then
    if me.company_id is null then
      raise exception 'Your account is not linked to a company yet. Please contact AMBIT.';
    end if;
    select * into co from public.companies where id = me.company_id;
  elsif p_company_id is not null then
    select * into co from public.companies where id = p_company_id;
  end if;

  if p_delivery_method is null or p_delivery_method not in ('pickup', 'jobsite', 'dropship') then
    raise exception 'Choose how you want the order delivered.';
  end if;
  if p_delivery_method = 'pickup' and not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Choose a pickup branch.';
  end if;
  if p_delivery_method <> 'pickup' and coalesce(trim(p_ship_address), '') = '' then
    raise exception 'Enter the delivery address.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your order is empty.';
  end if;
  if p_lots is not null and jsonb_typeof(p_lots) = 'array' and jsonb_array_length(p_lots) > 0
     and me.role not in ('admin', 'employee') then
    raise exception 'Only AMBIT staff can pick lots.';
  end if;

  v_branch := case
    when p_delivery_method in ('pickup', 'jobsite') and exists (select 1 from public.branches where id = p_branch_id) then p_branch_id
  end;

  insert into public.orders (
    placed_by, company_id, company_name, account_no,
    placed_by_name, placed_by_email, placed_by_phone, placed_by_role,
    delivery_method, branch_id, ship_address, po_number, needed_by, notes)
  values (
    me.id, co.id,
    coalesce(co.name, nullif(trim(p_customer_name), ''), 'AMBIT (internal)'),
    co.account_no,
    me.full_name, me.email, me.phone, me.role,
    p_delivery_method,
    v_branch,
    case when p_delivery_method <> 'pickup' then trim(p_ship_address) end,
    nullif(trim(p_po_number), ''),
    p_needed_by,
    nullif(trim(p_notes), ''))
  returning id into new_id;

  for item in select * from jsonb_array_elements(p_items) loop
    q := nullif(item->>'qty', '')::numeric;
    if q is null or q <= 0 then continue; end if;

    -- A product on sale is charged its sale price, and the sale price shows even on
    -- products that are normally priced to the customer's account.
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false)
             and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p
      left join public.categories c on c.id = p.category_id
     where p.id = (item->>'product_id')::uuid
       and (p.active or (p.stock_of is not null and me.role in ('admin', 'employee')));
    if not found then
      raise exception 'An item in your order is no longer available. Please refresh and try again.';
    end if;

    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (new_id, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end,
            pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end)
    returning id into v_item;

    -- Staff picked the exact lots (custom foam order): hold those drums.
    if p_lots is not null and jsonb_typeof(p_lots) = 'array' and me.role in ('admin', 'employee') then
      select jsonb_agg(x) into v_lots from jsonb_array_elements(p_lots) x where x ->> 'product_id' = pr.id::text;
      if v_lots is not null then perform public.order_item_pick_lots(v_item, v_lots); end if;
    end if;

    if pr.cp then
      any_cp := true;
    elsif pr.list_price is not null then
      subtotal := subtotal + round(pr.list_price * q, 2);
    end if;
    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'Your order is empty.';
  end if;

  update public.orders
     set est_subtotal = subtotal,
         has_customer_pricing = any_cp,
         approval_ref = 'APV-' || order_no || '-' || upper(substr(md5(id::text || clock_timestamp()::text), 1, 4))
   where id = new_id;

  -- A contractor ordering for their own company approves it by placing it.
  if me.role = 'customer' then
    update public.orders
       set approval_status = 'approved', approval_method = 'in_app',
           approved_at = now(), approved_by_name = coalesce(me.full_name, me.email)
     where id = new_id;
  end if;
  return new_id;
end $$;
revoke all on function public.place_order(jsonb, text, text, text, text, date, text, uuid, text, jsonb) from public, anon;
grant execute on function public.place_order(jsonb, text, text, text, text, date, text, uuid, text, jsonb) to authenticated;
revoke all on function public.order_lot_choices(text) from public, anon;
grant execute on function public.order_lot_choices(text) to authenticated;

select 'custom foam lots ready' as status,
       (select count(*) from public.inventory_lots where on_sheet and remaining > 0) as lots_with_drums;
