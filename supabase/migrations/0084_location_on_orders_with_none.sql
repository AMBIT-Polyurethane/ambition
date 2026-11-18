-- =====================================================================
-- 0084: an order that went out with NO location on it (older orders like ORD-1007) can be given one, so its lots
--   can be recorded. Nothing else about a shipped order's location changes. Also sets ORD-1007 to Oklahoma City.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create or replace function public.order_edit_details(p_order uuid, p_set jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        public.orders;
  n        public.orders;
  admin    boolean := public.is_admin();
  who      text := coalesce(public.my_name(), 'AMBIT');
  ch       jsonb := '[]'::jsonb;
  k        text;
  c        record;
  b_old    text;
  restock  boolean := false;
  it       record;
  dropship_before boolean;
  dropship_after  boolean;
  label    text;
  house    boolean;
begin
  if not public.is_employee() or not (admin or public.has_perm('ordering') or public.has_perm('order_desk')) then
    raise exception 'You don''t have access to edit orders.';
  end if;
  if jsonb_typeof(p_set) is distinct from 'object' then raise exception 'Nothing to save.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  for k in select jsonb_object_keys(p_set) loop
    if k not in ('ship_address', 'company_id', 'delivery_method', 'branch_id', 'po_number', 'needed_by', 'notes',
                 'ambit_po', 'invoice_no', 'pay_cod', 'pay_no_checks', 'pay_prepaid') then
      raise exception 'Unknown detail: %', k;
    end if;
    if k <> 'ship_address' and not admin then raise exception 'Only an admin can change that. Staff can change the ship-to address.'; end if;
  end loop;
  if not admin and o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;

  n := o;
  house := o.house_account;
  if p_set ? 'ship_address' then n.ship_address := nullif(left(trim(coalesce(p_set ->> 'ship_address', '')), 500), ''); end if;
  if p_set ? 'delivery_method' then n.delivery_method := p_set ->> 'delivery_method'; end if;
  if p_set ? 'branch_id' then n.branch_id := nullif(lower(trim(coalesce(p_set ->> 'branch_id', ''))), ''); end if;
  if p_set ? 'po_number' then n.po_number := nullif(left(trim(coalesce(p_set ->> 'po_number', '')), 80), ''); end if;
  if p_set ? 'needed_by' then n.needed_by := nullif(p_set ->> 'needed_by', '')::date; end if;
  if p_set ? 'notes' then n.notes := nullif(left(trim(coalesce(p_set ->> 'notes', '')), 2000), ''); end if;
  if p_set ? 'pay_cod' then n.pay_cod := coalesce((p_set ->> 'pay_cod')::boolean, false); end if;
  if p_set ? 'pay_no_checks' then n.pay_no_checks := coalesce((p_set ->> 'pay_no_checks')::boolean, false); end if;
  if p_set ? 'pay_prepaid' then n.pay_prepaid := coalesce((p_set ->> 'pay_prepaid')::boolean, false); end if;
  if p_set ? 'ambit_po' then
    n.ambit_po := nullif(left(trim(coalesce(p_set ->> 'ambit_po', '')), 40), '');
    if o.ambit_po is null and n.ambit_po is not null then raise exception 'Enter the Sales Order # with the order desk step on the order, not here.'; end if;
    if o.ambit_po is not null and n.ambit_po is null then raise exception 'The Sales Order # can be changed but not cleared.'; end if;
  end if;
  if p_set ? 'invoice_no' then
    n.invoice_no := nullif(left(trim(coalesce(p_set ->> 'invoice_no', '')), 40), '');
    if o.invoice_no is null and n.invoice_no is not null then raise exception 'Enter the Invoice # with the order desk step on the order, not here.'; end if;
    if o.invoice_no is not null and n.invoice_no is null then raise exception 'The Invoice # can be changed but not cleared.'; end if;
  end if;
  if p_set ? 'company_id' then
    select id, name, account_no, coalesce(house_account, false) as house_account into c
      from public.companies where id = nullif(p_set ->> 'company_id', '')::uuid;
    if c.id is null then raise exception 'Pick the customer.'; end if;
    n.company_id := c.id;
    n.company_name := c.name;
    n.account_no := c.account_no;
    if c.id is distinct from o.company_id then house := c.house_account; end if;
  end if;

  -- Where it ships from and to has to make sense.
  if n.delivery_method not in ('pickup', 'jobsite', 'dropship') then raise exception 'Pick pickup, delivery or ship from supplier.'; end if;
  if n.delivery_method = 'dropship' then n.branch_id := null;
  else
    if n.branch_id is null then raise exception 'Pick the AMBIT location it % from.', case when n.delivery_method = 'pickup' then 'is picked up' else 'ships' end; end if;
    if not exists (select 1 from public.branches where id = n.branch_id) then raise exception 'That location doesn''t exist.'; end if;
  end if;
  if n.delivery_method = 'pickup' then n.ship_address := null;
  elsif n.ship_address is null then raise exception 'Enter the ship-to address.';
  end if;

  -- What changed, in words.
  if n.company_id is distinct from o.company_id then
    ch := ch || jsonb_build_object('label', 'Customer', 'from', o.company_name || coalesce(' · ' || o.account_no, ''), 'to', n.company_name || coalesce(' · ' || n.account_no, ''));
  end if;
  if n.delivery_method is distinct from o.delivery_method then
    ch := ch || jsonb_build_object('label', 'Delivery',
      'from', case o.delivery_method when 'pickup' then 'Pickup' when 'jobsite' then 'Delivery' else 'Ship from supplier' end,
      'to',   case n.delivery_method when 'pickup' then 'Pickup' when 'jobsite' then 'Delivery' else 'Ship from supplier' end);
  end if;
  if n.branch_id is distinct from o.branch_id then
    ch := ch || jsonb_build_object('label', 'Location',
      'from', coalesce((select name from public.branches where id = o.branch_id), '(none)'),
      'to',   coalesce((select name from public.branches where id = n.branch_id), '(none)'));
  end if;
  if n.ship_address is distinct from o.ship_address then ch := ch || jsonb_build_object('label', 'Ship to', 'from', coalesce(o.ship_address, '(none)'), 'to', coalesce(n.ship_address, '(none)')); end if;
  if n.po_number is distinct from o.po_number then ch := ch || jsonb_build_object('label', 'Customer PO', 'from', coalesce(o.po_number, '(none)'), 'to', coalesce(n.po_number, '(none)')); end if;
  if n.needed_by is distinct from o.needed_by then ch := ch || jsonb_build_object('label', 'Needed by', 'from', coalesce(to_char(o.needed_by, 'Mon DD, YYYY'), '(none)'), 'to', coalesce(to_char(n.needed_by, 'Mon DD, YYYY'), '(none)')); end if;
  if n.notes is distinct from o.notes then ch := ch || jsonb_build_object('label', 'Notes', 'from', coalesce(o.notes, '(none)'), 'to', coalesce(n.notes, '(none)')); end if;
  if n.ambit_po is distinct from o.ambit_po then ch := ch || jsonb_build_object('label', 'Sales Order #', 'from', o.ambit_po, 'to', n.ambit_po); end if;
  if n.invoice_no is distinct from o.invoice_no then ch := ch || jsonb_build_object('label', 'Invoice #', 'from', o.invoice_no, 'to', n.invoice_no); end if;
  foreach k in array array['pay_cod', 'pay_no_checks', 'pay_prepaid'] loop
    label := case k when 'pay_cod' then 'COD' when 'pay_no_checks' then 'No checks' else 'Customer has already paid' end;
    if (case k when 'pay_cod' then n.pay_cod when 'pay_no_checks' then n.pay_no_checks else n.pay_prepaid end)
       is distinct from (case k when 'pay_cod' then o.pay_cod when 'pay_no_checks' then o.pay_no_checks else o.pay_prepaid end) then
      ch := ch || jsonb_build_object('label', label,
        'from', case when (case k when 'pay_cod' then o.pay_cod when 'pay_no_checks' then o.pay_no_checks else o.pay_prepaid end) then 'Yes' else 'No' end,
        'to',   case when (case k when 'pay_cod' then n.pay_cod when 'pay_no_checks' then n.pay_no_checks else n.pay_prepaid end) then 'Yes' else 'No' end);
    end if;
  end loop;
  if jsonb_array_length(ch) = 0 then raise exception 'Nothing changed.'; end if;

  -- Moving where it ships from (or to / from the supplier) moves the stock it holds.
  dropship_before := o.delivery_method = 'dropship';
  dropship_after := n.delivery_method = 'dropship';
  if n.branch_id is distinct from o.branch_id or dropship_before <> dropship_after then
    if o.status = 'completed' and o.branch_id is null and n.branch_id is not null and not dropship_after
       and not exists (select 1 from public.inventory_lines where order_id = p_order and state <> 'cancelled') then
      -- 0084: an order that went out with no location on it (an older order): say where it went out from.
      -- No stock moves; record its lots afterwards with "What went out, lot by lot".
      restock := false;
    else
      if o.status not in ('new', 'processing') then
        raise exception 'This order is %: the location and Ship from supplier can''t be changed now.', o.status;
      end if;
      if exists (select 1 from public.inventory_lines where order_id = p_order and state = 'done') then
        raise exception 'Some of this order was already picked up on the spreadsheet, so its location can''t be changed.';
      end if;
      restock := true;
    end if;
  end if;

  b_old := o.branch_id;
  update public.orders
     set ship_address = n.ship_address, delivery_method = n.delivery_method, branch_id = n.branch_id,
         po_number = n.po_number, needed_by = n.needed_by, notes = n.notes,
         ambit_po = n.ambit_po, invoice_no = n.invoice_no,
         pay_cod = n.pay_cod, pay_no_checks = n.pay_no_checks, pay_prepaid = n.pay_prepaid,
         company_id = n.company_id, company_name = n.company_name, account_no = n.account_no,
         house_account = house
   where id = p_order;

  if restock then
    update public.inventory_lines set state = 'cancelled', done_by = 'edit', needs_write = true, updated_at = now()
     where order_id = p_order and state = 'reserved';
    if b_old is not null then
      update public.inventory_sheets set sync_wanted_at = now() where branch_id = b_old;
      insert into public.inventory_log (branch_id, kind, message, by_name)
      values (b_old, 'order', 'ORD-' || o.order_no || ' moved ' || coalesce('to ' || upper(n.branch_id), 'to ship from the supplier') || ': its stock here is released.', who);
    end if;
    for it in select id from public.order_items where order_id = p_order order by id loop
      perform public.inventory_pick(it.id);
    end loop;
  end if;

  insert into public.order_detail_changes (order_id, changed_by, changed_by_name, changes, note, restocked)
  values (p_order, auth.uid(), who, ch, nullif(left(trim(coalesce(p_note, '')), 500), ''), restock);

  return jsonb_build_object('changes', ch, 'restocked', restock, 'stage', o.stage,
                            'customer', n.company_id is distinct from o.company_id,
                            'approval_pending', o.approval_status in ('pending', 'changes_requested'),
                            'scheduled', o.scheduled_for is not null and o.status in ('new', 'processing'));
end $$;

-- ORD-1007 (Got Foam) went out from Oklahoma City (its BOL is from OKC, with OKC lots). Saved as a detail change.
do $$
declare admin uuid; oid uuid;
begin
  select id into oid from public.orders where order_no = 1007 and branch_id is null and status = 'completed';
  if oid is null then raise notice 'ORD-1007 already has a location: skipped.'; return; end if;
  select id into admin from public.profiles where role = 'admin' and status = 'active' order by (full_name ilike 'jeremiah%') desc, created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform public.order_edit_details(oid, '{"branch_id": "okc"}'::jsonb, 'It went out from Oklahoma City (BOL)');
  raise notice 'ORD-1007 now shows Oklahoma City.';
end $$;

select 'Ready (should be 1)' as "Check", count(*) as "Count" from public.orders where order_no = 1007 and branch_id = 'okc';
