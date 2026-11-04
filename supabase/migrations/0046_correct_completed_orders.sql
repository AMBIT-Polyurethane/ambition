-- =====================================================================
-- AMBIT Intelligence update 0046 - Admins correct completed orders
-- * Edit order on a completed order (picked up or delivered), admins only. For each changed line, what was taken
--   out of stock goes back in and the corrected amount is taken out (lots too: soonest-expiring first), so the
--   location's spreadsheet ends up right. Lines that didn't change aren't touched.
-- * The order then goes to the order desk's "Invoice update" step (it stays completed): the CRM updates the invoice
--   and enters the new Invoice # and prices. Credit isn't opened again (the goods are gone); if the total changed,
--   the credit team is emailed to collect or credit the difference, and the customer gets the updated order.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Holding stock for a line: also while an admin corrects a completed order ----------
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
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status = 'cancelled' then return; end if;
  -- A completed order only holds stock while an admin corrects it (order_edit turns it into stock taken).
  if o.status = 'completed' and coalesce(current_setting('ambit.pick_closed', true), '') <> 'on' then return; end if;
  if not exists (select 1 from public.inventory_sheets x where x.branch_id = o.branch_id and x.enabled) then return; end if;
  if exists (select 1 from public.inventory_lines
              where order_item_id = p_item and not (state = 'cancelled' and done_by in ('swap', 'edit'))) then return; end if;

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
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;

-- ---------- Editing an order: admins can correct a completed one ----------
create or replace function public.order_edit(p_order uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders;
  it       public.order_items;
  e        jsonb;
  q        numeric;
  pr       record;
  who      text := coalesce(public.my_name(), 'AMBIT');
  changes  jsonb := '[]'::jsonb;
  before   numeric;
  stage0   text;
  invoiced boolean;
  rev      int;
  closed   boolean;
  l        public.inventory_lines;
  tag      text;
begin
  if not public.is_employee() or not (public.is_admin() or public.has_perm('ordering') or public.has_perm('order_desk')) then
    raise exception 'You don''t have access to edit orders.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled. Place a new order instead.'; end if;
  -- A completed order (picked up or delivered): only an admin corrects it. What was taken out of stock for a
  -- changed line goes back in, and the corrected amount is taken out again.
  closed := o.status = 'completed';
  if closed and not public.is_admin() then raise exception 'This order is completed. Only an admin can correct a completed order.'; end if;
  tag := 'ORD-' || o.order_no || ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end || ': ';
  if closed then perform set_config('ambit.pick_closed', 'on', true); end if;
  before := o.est_subtotal;
  stage0 := o.stage;
  invoiced := o.ambit_po is not null;

  -- Lines already on the order
  for it in select * from public.order_items where order_id = p_order order by id loop
    select x into e from jsonb_array_elements(p_lines) x where nullif(x ->> 'id', '')::bigint = it.id limit 1;
    q := case when e is null then 0 else round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2) end;
    if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    if q = it.qty then continue; end if;
    if not closed and exists (select 1 from public.inventory_lines where order_item_id = it.id and state = 'done') then
      raise exception '% was already picked up on the spreadsheet, so it can''t be changed here.', it.sku;
    end if;
    if closed then
      for l in select * from public.inventory_lines where order_item_id = it.id and state = 'done' and stock_taken loop
        perform public.inventory_line_stock(l.id, 1, 'order', tag, who);
      end loop;
    end if;
    update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now()
     where order_item_id = it.id and state in ('reserved', 'done');
    changes := changes || jsonb_build_object('sku', it.sku, 'name', it.name, 'unit', it.unit, 'from', it.qty, 'to', q);
    if q = 0 then
      delete from public.order_items where id = it.id;
    else
      update public.order_items
         set qty = q,
             unit_price = case when price_parts is null then unit_price end,
             line_total = case when price_parts is null and unit_price is not null then round(unit_price * q, 2) end,
             price_parts = null
       where id = it.id;
      perform public.inventory_pick(it.id);
    end if;
  end loop;

  -- New lines (priced like a new order: the CRM puts the invoice price on them)
  for e in select * from jsonb_array_elements(p_lines) loop
    if nullif(e ->> 'id', '') is not null then continue; end if;
    q := round(coalesce(nullif(e ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false) and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p left join public.categories c on c.id = p.category_id
     where p.id = nullif(e ->> 'product_id', '')::uuid and p.active;
    if pr.id is null then raise exception 'One of the new items isn''t available any more. Reload and try again.'; end if;
    if exists (select 1 from public.order_items where order_id = p_order and product_id = pr.id) then
      raise exception '% is already on this order. Change its quantity instead.', pr.sku;
    end if;
    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (p_order, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end, pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end);
    changes := changes || jsonb_build_object('sku', pr.sku, 'name', pr.name, 'unit', pr.unit, 'from', 0, 'to', q);
  end loop;

  if jsonb_array_length(changes) = 0 then raise exception 'Nothing changed.'; end if;
  -- Completed: the corrected amounts were picked (soonest-expiring lot first) and leave stock now.
  if closed then
    for l in select * from public.inventory_lines where order_id = p_order and state = 'reserved' loop
      perform public.inventory_line_stock(l.id, -1, 'order', tag, who);
    end loop;
    update public.inventory_lines set state = 'done', done_by = 'app', stock_taken = true, needs_write = true, updated_at = now()
     where order_id = p_order and state = 'reserved';
    perform set_config('ambit.pick_closed', '', true);
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'An order needs at least one item. Cancel the order instead.';
  end if;
  -- ISO priced per foam set: the sets may have changed, so the CRM prices it again.
  update public.order_items set unit_price = null, line_total = null, price_parts = null
   where order_id = p_order and price_parts is not null;

  update public.orders
     set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
         has_customer_pricing = exists (select 1 from public.order_items i where i.order_id = p_order and i.customer_priced),
         revision = revision + 1,
         invoiced_total = case when invoiced then coalesce(invoiced_total, before) else invoiced_total end,
         invoice_update_at = case when invoiced then coalesce(invoice_update_at, now()) else invoice_update_at end,
         invoice_update_by_name = case when invoiced then who else invoice_update_by_name end
   where id = p_order
  returning revision into rev;

  insert into public.order_edits (order_id, revision, edited_by, edited_by_name, stage_before, changes, total_before, note)
  values (p_order, rev, auth.uid(), who, stage0, changes, before, nullif(left(trim(coalesce(p_note, '')), 500), ''));
  if o.branch_id is not null then
    update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
  end if;
  return jsonb_build_object('revision', rev, 'invoice_update', invoiced, 'closed', closed,
                            'customer', o.approval_status in ('pending', 'changes_requested'), 'changes', changes);
end $$;

-- ---------- The CRM's invoice update after an edit: no credit re-check on a completed order ----------
create or replace function public.order_invoice_update_done(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders;
  newt   numeric;
  oldt   numeric;
  reopen boolean;
  closed boolean;
  ch     jsonb;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.invoice_update_at is null then return jsonb_build_object('was', false); end if;
  if exists (select 1 from public.order_items i where i.order_id = p_order and i.unit_price is null and not i.customer_priced) then
    raise exception 'Enter the invoice price for every line first.';
  end if;
  newt := coalesce(o.est_subtotal, 0);
  oldt := coalesce(o.invoiced_total, newt);
  -- Corrected after pickup or delivery: the goods are gone, so credit isn't opened again; the credit team is told
  -- to collect (or credit) the difference instead.
  closed := o.status = 'completed';
  reopen := not closed and newt > oldt + 0.004 and o.credit_status = 'approved';
  update public.orders
     set invoice_update_at = null, invoice_update_by_name = null, invoiced_total = newt,
         credit_status = case when reopen then 'pending' else credit_status end,
         pay_prepaid = case when reopen then false else pay_prepaid end,
         credit_note = case when reopen then 'Check again: the order was edited and the total went from $' || to_char(oldt, 'FM999,999,990.00')
                                              || ' to $' || to_char(newt, 'FM999,999,990.00') || '.'
                                              || case when o.pay_prepaid then ' The customer had already paid the old total: tick Customer Has Already Paid again only once they''ve paid the difference.' else '' end
                            else credit_note end
   where id = p_order;
  select coalesce(jsonb_agg(c order by e.id), '[]'::jsonb) into ch
    from public.order_edits e, jsonb_array_elements(e.changes) c
   where e.order_id = p_order and e.invoice_updated_at is null;
  update public.order_edits
     set invoice_updated_at = now(), invoice_updated_by_name = public.my_name(), total_after = newt, credit_reopened = reopen
   where order_id = p_order and invoice_updated_at is null;
  return jsonb_build_object('was', true, 'reopened', reopen, 'closed', closed, 'before', oldt, 'after', newt, 'changes', ch);
end $$;

-- ---------- Sales Order # / Invoice # / prices: also on a completed order waiting for its invoice update ----------
create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text, p_prices jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  it    public.order_items;
  e     jsonb;
  pt    jsonb;
  pr    numeric;
  pq    numeric;
  tot   numeric;
  n     numeric;
  parts jsonb;
  miss  text;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' or (o.status = 'completed' and o.invoice_update_at is null) then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  if coalesce(trim(p_invoice), '') = '' then raise exception 'Enter the Invoice # too.'; end if;
  if p_prices is not null then
    if jsonb_typeof(p_prices) <> 'array' then raise exception 'Prices are missing.'; end if;
    for e in select * from jsonb_array_elements(p_prices) loop
      -- An ISO line priced per foam set: {"id": 12, "parts": [{"with": 34, "qty": 12, "price": 1085}, ...]}
      if jsonb_typeof(e->'parts') = 'array' and jsonb_array_length(e->'parts') > 0 then
        select * into it from public.order_items where id = (e->>'id')::bigint and order_id = p_order;
        if it.id is null then continue; end if;
        tot := 0; n := 0; parts := '[]'::jsonb;
        for pt in select * from jsonb_array_elements(e->'parts') loop
          if coalesce(pt->>'price', '') = '' then raise exception 'Enter every ISO price for %.', it.sku; end if;
          begin
            pr := round((pt->>'price')::numeric, 2);
            pq := (pt->>'qty')::numeric;
          exception when others then
            raise exception 'A price isn''t a number: %', pt->>'price';
          end;
          if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
          if pq is null or pq <= 0 then raise exception 'The % split isn''t right. Reload the page and try again.', it.sku; end if;
          tot := tot + round(pr * pq, 2);
          n := n + pq;
          parts := parts || jsonb_build_array(jsonb_build_object(
            'with', case when jsonb_typeof(pt->'with') = 'number' then (pt->>'with')::bigint end,
            'qty', pq,
            'price', pr));
        end loop;
        if n <> it.qty then
          raise exception 'The % prices cover % drums but the order has %. Reload the page and try again.', it.sku, trim_scale(n), trim_scale(it.qty);
        end if;
        update public.order_items
           set unit_price = round(tot / it.qty, 2), line_total = tot, price_parts = parts
         where id = it.id;
        continue;
      end if;
      if coalesce(e->>'price', '') = '' then continue; end if;
      begin
        pr := round((e->>'price')::numeric, 2);
      exception when others then
        raise exception 'A price isn''t a number: %', e->>'price';
      end;
      if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
      update public.order_items
         set unit_price = pr, line_total = round(pr * qty, 2), price_parts = null
       where id = (e->>'id')::bigint and order_id = p_order;
    end loop;
    select string_agg(i.sku, ', ' order by i.id) into miss
      from public.order_items i where i.order_id = p_order and i.unit_price is null;
    if miss is not null then raise exception 'Enter the price for %.', miss; end if;
    update public.orders
       set est_subtotal = coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0),
           priced_at = now(), priced_by_name = public.my_name()
     where id = p_order;
  end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), invoice_no = left(trim(p_invoice), 60),
         po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- ---------- Where each order sits: a corrected completed order waits for its invoice update ----------
do $$
declare expr text;
begin
  select pg_get_expr(a.adbin, a.adrelid) into expr
    from pg_attrdef a join pg_attribute t on t.attrelid = a.adrelid and t.attnum = a.adnum
   where a.adrelid = 'public.orders'::regclass and t.attname = 'stage';
  if expr is null or (length(expr) - length(replace(expr, 'invoice_update_at', ''))) / length('invoice_update_at') < 2 then
    alter table public.orders drop column if exists stage;
    alter table public.orders add column stage text generated always as (
      case
        when status = 'cancelled' then 'cancelled'
        when status = 'completed' and invoice_update_at is not null then 'invoice_update'
        when status = 'completed' then 'completed'
        when approval_status in ('pending', 'changes_requested') then 'customer'
        when ambit_po is null then 'needs_po'
        when invoice_update_at is not null then 'invoice_update'
        when credit_status = 'hold' then 'hold'
        when credit_status is distinct from 'approved' then 'credit'
        when scheduled_for is null then 'schedule'
        else 'scheduled'
      end) stored;
    create index if not exists orders_stage_idx on public.orders(stage);
  end if;
end $$;

select 'admins can correct completed orders' as status;
