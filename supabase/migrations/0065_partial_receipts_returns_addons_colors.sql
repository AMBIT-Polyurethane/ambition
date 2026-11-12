-- 0065: Partial receipts (the rest of a PO still coming), Returns and exchanges (with the lot / exp of what comes
-- back), customers adding popular items to an order from the approval email, and each person's dashboard colors.
-- Safe to run more than once.

-- ---------- Partial receipts --------------------------------------------------------
-- A Receiving Report marked partial gets a follow-up expected delivery with what's still coming on that PO.
alter table public.inbound_deliveries add column if not exists partial         boolean not null default false;
alter table public.inbound_deliveries add column if not exists partial_note    text;
alter table public.inbound_deliveries add column if not exists partial_by_name text;
alter table public.inbound_deliveries add column if not exists partial_at      timestamptz;
alter table public.inbound_deliveries add column if not exists rest_of         bigint references public.inbound_deliveries(id) on delete set null;
alter table public.inbound_deliveries add column if not exists rest_id         bigint references public.inbound_deliveries(id) on delete set null;
create index if not exists inbound_deliveries_rest_of on public.inbound_deliveries(rest_of) where rest_of is not null;

-- p_lines: [{"product_id": "<uuid>", "qty": 4}, ...] = still coming. Again on the same report replaces the list.
create or replace function public.inbound_mark_partial(p_id bigint, p_expected date, p_note text, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries; r public.inbound_deliveries; v_rest bigint; ln jsonb; p public.products; q numeric; n int := 0;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Receiving Report not found.'; end if;
  if d.transfer_id is not null then raise exception 'Transfers can''t be marked partial. Anything missing stays on the transfer.'; end if;
  if d.status not in ('submitted', 'received') then raise exception 'Send the Receiving Report first, then mark it partial.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add what''s still coming.'; end if;
  if d.rest_id is not null then
    select * into r from public.inbound_deliveries where id = d.rest_id;
    if r.id is not null and r.status <> 'expected' then raise exception 'The rest of this PO was already %.', r.status; end if;
  end if;
  if r.id is not null then
    v_rest := r.id;
    update public.inbound_deliveries
       set expected_on = coalesce(p_expected, r.expected_on), note = coalesce(nullif(left(trim(coalesce(p_note, '')), 500), ''), r.note)
     where id = v_rest;
    delete from public.inbound_lines where delivery_id = v_rest;
  else
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, po_no, note, created_by_name, rest_of)
    values (d.branch_id, d.vendor, coalesce(p_expected, (now() at time zone 'America/Chicago')::date + 7),
            coalesce(d.po_no, d.ref), d.po_no,
            coalesce(nullif(left(trim(coalesce(p_note, '')), 500), ''), 'Rest of ' || coalesce('PO ' || d.po_no, 'Receiving Report #' || d.id)),
            public.my_name(), d.id)
    returning id into v_rest;
  end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    q := round(coalesce(nullif(ln ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
    if p.id is null then continue; end if;
    insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty) values (v_rest, p.id, p.sku, p.name, p.unit, q);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Add what''s still coming (and how many).'; end if;
  update public.inbound_deliveries
     set partial = true, partial_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), partial_by_name = public.my_name(), partial_at = now(), rest_id = v_rest
   where id = d.id;
  return v_rest;
end $$;

-- Not partial after all: the follow-up delivery is cancelled (if it hasn't come).
create or replace function public.inbound_unmark_partial(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Receiving Report not found.'; end if;
  update public.inbound_deliveries set status = 'cancelled' where id = d.rest_id and status = 'expected';
  update public.inbound_deliveries set partial = false, rest_id = null where id = d.id;
end $$;

-- ---------- Returns and exchanges ----------------------------------------------------
alter table public.orders add column if not exists kind          text not null default 'sale';
alter table public.orders add column if not exists return_reason text;
alter table public.orders add column if not exists return_of     uuid references public.orders(id) on delete set null;
do $$ begin
  alter table public.orders add constraint orders_kind_check check (kind in ('sale', 'return', 'exchange'));
exception when duplicate_object then null; end $$;

create table if not exists public.order_returns (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  sku              text not null,
  name             text not null,
  unit             text,
  qty              numeric(12,2) not null check (qty > 0),
  lot_no           text,
  mfg              date,
  exp              date,
  condition        text not null default 'stock' check (condition in ('stock', 'damaged')),
  unit_credit      numeric(12,2),
  line_credit      numeric(12,2),
  note             text,
  inbound_id       bigint references public.inbound_deliveries(id) on delete set null,
  received_at      timestamptz,
  received_by_name text
);
create index if not exists order_returns_order on public.order_returns(order_id);
alter table public.order_returns enable row level security;
drop policy if exists order_returns_read on public.order_returns;
create policy order_returns_read on public.order_returns for select to authenticated using (public.is_employee());

-- A return with nothing going out (the customer brings items back for credit). Staff only. No customer approval
-- and no credit check: the order desk adds the credit memo # and the date it comes back.
create or replace function public.place_return_order(p_branch text, p_company uuid, p_customer_name text, p_delivery text, p_ship_address text, p_notes text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; co public.companies; v_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or me.role not in ('admin', 'employee') then raise exception 'Only AMBIT staff enter returns.'; end if;
  if not (me.role = 'admin' or public.has_perm('ordering') or public.has_perm('order_desk')) then raise exception 'You don''t have access to ordering.'; end if;
  if not exists (select 1 from public.branches where id = p_branch) then raise exception 'Pick the location it comes back to.'; end if;
  if p_company is not null then select * into co from public.companies where id = p_company; end if;
  if co.id is null and coalesce(trim(p_customer_name), '') = '' then raise exception 'Pick the customer.'; end if;
  insert into public.orders (placed_by, company_id, company_name, account_no, placed_by_name, placed_by_email, placed_by_phone, placed_by_role,
                             delivery_method, branch_id, ship_address, notes, kind, credit_status, credit_by_name, credit_at, credit_note)
  values (me.id, co.id, coalesce(co.name, left(trim(p_customer_name), 160)), co.account_no, me.full_name, me.email, me.phone, me.role,
          case when p_delivery in ('pickup', 'jobsite') then p_delivery else 'pickup' end, p_branch,
          case when p_delivery = 'jobsite' then nullif(trim(coalesce(p_ship_address, '')), '') end,
          nullif(left(trim(coalesce(p_notes, '')), 2000), ''), 'return', 'approved', 'Return (no credit check)', now(), 'Return: nothing to collect')
  returning id into v_id;
  update public.orders set approval_ref = 'RET-' || order_no where id = v_id;
  return v_id;
end $$;

-- What's coming back on a return or exchange. p_lines: [{"product_id", "qty", "lot_no", "mfg", "exp", "condition", "unit_credit", "note"}]
create or replace function public.order_set_returns(p_order uuid, p_kind text, p_reason text, p_return_of uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare o public.orders; ln jsonb; p public.products; q numeric; c numeric; n int := 0;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or o.placed_by = auth.uid() or public.has_perm('order_desk')) then raise exception 'You can''t change this order.'; end if;
  if p_kind not in ('return', 'exchange') then raise exception 'Pick Return or Exchange.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add what''s coming back.'; end if;
  update public.orders
     set kind = p_kind, return_reason = nullif(left(trim(coalesce(p_reason, '')), 500), ''),
         return_of = case when p_return_of is not null and exists (select 1 from public.orders x where x.id = p_return_of) then p_return_of end
   where id = p_order;
  delete from public.order_returns where order_id = p_order and inbound_id is null;
  for ln in select * from jsonb_array_elements(p_lines) loop
    q := round(coalesce(nullif(ln ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
    if p.id is null then raise exception 'Pick the item for every line coming back.'; end if;
    c := round(nullif(ln ->> 'unit_credit', '')::numeric, 2);
    insert into public.order_returns (order_id, product_id, sku, name, unit, qty, lot_no, mfg, exp, condition, unit_credit, line_credit, note)
    values (p_order, p.id, p.sku, p.name, p.unit, q,
            nullif(left(trim(coalesce(ln ->> 'lot_no', '')), 60), ''), nullif(ln ->> 'mfg', '')::date, nullif(ln ->> 'exp', '')::date,
            case when ln ->> 'condition' = 'damaged' then 'damaged' else 'stock' end,
            c, case when c is null then null else round(c * q, 2) end, nullif(left(trim(coalesce(ln ->> 'note', '')), 300), ''));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Add what''s coming back (and how many).'; end if;
  return n;
end $$;

-- The returned items were received (on Receiving Report p_inbound).
create or replace function public.order_returns_received(p_order uuid, p_inbound bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  update public.order_returns set inbound_id = p_inbound, received_at = now(), received_by_name = public.my_name()
   where order_id = p_order and inbound_id is null;
  insert into public.chat_messages (channel_id, kind, body)
  select c.id, 'system', public.my_name() || ' received the returned items (Receiving Report #' || p_inbound || ').'
    from public.chat_channels c where c.order_id = p_order;
end $$;

-- ---------- Customers add items from the approval email ------------------------------
alter table public.order_items add column if not exists added_by_customer boolean not null default false;

-- What the customer can add: spray foam (account pricing), and everything else that has a list price, carried at the
-- order's location (Alpha / admin-only products never). Most ordered at that location in 90 days first.
create or replace function public.order_addon_options(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; v jsonb;
begin
  if coalesce(length(p_token), 0) < 20 then return null; end if;
  select * into o from public.orders where approval_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if o.id is null then return null; end if;
  with pop as (
    select i.product_id, count(distinct x.id) as n
      from public.order_items i join public.orders x on x.id = i.order_id
     where x.branch_id is not distinct from o.branch_id and x.status <> 'cancelled' and x.created_at >= now() - interval '90 days'
     group by i.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit,
           'price', case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end,
           'account', coalesce(p.customer_priced, c.customer_priced, false) and not public.sale_on(p.sale_price, p.sale_ends),
           'foam', p.category_id = 'ambit-foam', 'n', coalesce(pop.n, 0), 'cat', c.name)
         order by coalesce(pop.n, 0) desc, c.sort, p.name), '[]'::jsonb)
    into v
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join pop on pop.product_id = p.id
   where p.active and not coalesce(p.admin_only, false) and p.stock_of is null
     and (p.category_id = 'ambit-foam' or coalesce(case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end, 0) > 0)
     and (o.branch_id is null
          or not exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled)
          or exists (select 1 from public.inventory iv where iv.branch_id = o.branch_id and iv.product_id = p.id and iv.on_sheet));
  return jsonb_build_object('state', case when o.status = 'cancelled' then 'cancelled' when o.approval_status <> 'pending' then o.approval_status
                                          when o.approval_expires_at < now() then 'expired' else 'pending' end,
                            'order_no', o.order_no, 'company', o.company_name, 'branch', o.branch_id, 'items', v);
end $$;

-- p_items: [{"product_id": "<uuid>", "qty": 2}]. Only while the order is waiting for the customer's approval.
create or replace function public.order_add_items_by_link(p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; item jsonb; pr record; q numeric; n int := 0; v_names text := '';
begin
  select * into o from public.orders where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') for update;
  if o.id is null then raise exception 'This link is not valid. Ask your AMBIT rep to send a new one.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'This order isn''t waiting for your approval any more, so items can''t be added here. Contact your AMBIT rep.'; end if;
  if o.approval_expires_at < now() then raise exception 'This link has expired. Ask your AMBIT rep to send a new one.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Pick at least one item.'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    q := round(coalesce(nullif(item ->> 'qty', '')::numeric, 0), 2);
    if q <= 0 then continue; end if;
    if q > 1000 then raise exception 'That''s more than this page can add. Contact your AMBIT rep.'; end if;
    select p.id, p.sku, p.name, p.unit,
           case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end as list_price,
           coalesce(p.customer_priced, c.customer_priced, false) and not public.sale_on(p.sale_price, p.sale_ends) as cp
      into pr
      from public.products p left join public.categories c on c.id = p.category_id
     where p.id = nullif(item ->> 'product_id', '')::uuid
       and p.active and not coalesce(p.admin_only, false) and p.stock_of is null
       and (p.category_id = 'ambit-foam' or coalesce(case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end, 0) > 0)
       and (o.branch_id is null
            or not exists (select 1 from public.inventory_sheets s where s.branch_id = o.branch_id and s.enabled)
            or exists (select 1 from public.inventory iv where iv.branch_id = o.branch_id and iv.product_id = p.id and iv.on_sheet));
    if not found then raise exception 'One of those items can''t be added here. Contact your AMBIT rep.'; end if;
    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total, added_by_customer)
    values (o.id, pr.id, pr.sku, pr.name, pr.unit, q, case when pr.cp then null else pr.list_price end, pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end, true);
    n := n + 1;
    v_names := v_names || case when n > 1 then ', ' else '' end || q::text || ' ' || pr.name;
  end loop;
  if n = 0 then raise exception 'Pick at least one item.'; end if;
  update public.orders
     set est_subtotal = coalesce((select sum(line_total) from public.order_items where order_id = o.id and not customer_priced), 0),
         has_customer_pricing = exists (select 1 from public.order_items where order_id = o.id and customer_priced)
   where id = o.id;
  insert into public.chat_messages (channel_id, kind, body)
  select c.id, 'system', 'The customer added ' || left(v_names, 400) || ' from the approval email.'
    from public.chat_channels c where c.order_id = o.id;
  return public.order_doc_json(o.id);
end $$;

-- ---------- Dashboard colors (each person) ---------------------------------------------
alter table public.profiles add column if not exists theme jsonb;
create or replace function public.set_my_theme(p_theme jsonb) returns void
language sql security definer set search_path = public as $$
  update public.profiles set theme = case when p_theme is null or p_theme = '{}'::jsonb then null else p_theme end where id = auth.uid()
$$;

do $$
declare f text;
begin
  foreach f in array array['inbound_mark_partial(bigint, date, text, jsonb)', 'inbound_unmark_partial(bigint)',
    'place_return_order(text, uuid, text, text, text, text)', 'order_set_returns(uuid, text, text, uuid, jsonb)', 'order_returns_received(uuid, bigint)',
    'set_my_theme(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- The approval link works without signing in.
  foreach f in array array['order_addon_options(text)', 'order_add_items_by_link(text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Check: should say 5 (partial receipts, returns, return lines, customer add-ons, colors).
select (select count(*) from information_schema.columns where table_schema = 'public'
         and ((table_name = 'inbound_deliveries' and column_name = 'partial') or (table_name = 'orders' and column_name = 'kind')
              or (table_name = 'order_items' and column_name = 'added_by_customer') or (table_name = 'profiles' and column_name = 'theme')))
     + (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'order_returns')
       as "Ready (should be 5)";
