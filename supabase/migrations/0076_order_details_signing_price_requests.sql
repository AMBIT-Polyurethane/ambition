-- =====================================================================
-- AMBIT Intelligence update 0076 - Edit an order's details; sign the packing slip in the app; simpler price requests
-- * Ship-to can be changed on any order by staff who edit orders. Admins can change every detail: the customer,
--   pickup / delivery, the location, ship-to, customer PO, needed by, notes, Sales Order #, Invoice # and payment.
--   Changing the location (or to / from Ship from Supplier) moves the held stock. Detail changes don't need an admin
--   to approve them; the order desk is emailed.
-- * Packing slips are signed on a phone or iPad: the AMBIT employee and the customer or truck driver sign with a
--   finger, the signed slip is saved on the order as the signed BOL, and the order is marked picked up / shipped out.
-- * Price requests: one AMBIT Foam Products tab, fiberglass, intumescents and coatings; a new customer's credit line.
-- Run once in Supabase > SQL Editor, AFTER 0075. Safe to run again.
-- =====================================================================

-- ---------- What was changed on an order's details (history on the order) ----------
create table if not exists public.order_detail_changes (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.orders(id) on delete cascade,
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now(),
  changes         jsonb not null,            -- [{ "label": "Ship to", "from": "...", "to": "..." }]
  note            text,
  restocked       boolean not null default false
);
create index if not exists order_detail_changes_order on public.order_detail_changes(order_id, changed_at);
alter table public.order_detail_changes enable row level security;
drop policy if exists order_detail_changes_read on public.order_detail_changes;
create policy order_detail_changes_read on public.order_detail_changes for select to authenticated using (public.is_employee());

-- Change an order's details. p_set holds only what's being changed:
--   ship_address (staff who edit orders), and for admins also company_id, delivery_method, branch_id, po_number,
--   needed_by, notes, ambit_po, invoice_no, pay_cod, pay_no_checks, pay_prepaid.
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
    if o.status not in ('new', 'processing') then
      raise exception 'This order is %: the location and Ship from supplier can''t be changed now.', o.status;
    end if;
    if exists (select 1 from public.inventory_lines where order_id = p_order and state = 'done') then
      raise exception 'Some of this order was already picked up on the spreadsheet, so its location can''t be changed.';
    end if;
    restock := true;
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

revoke all on function public.order_edit_details(uuid, jsonb, text) from public, anon;
grant execute on function public.order_edit_details(uuid, jsonb, text) to authenticated;

-- ---------- Packing slips signed in the app ----------
-- Both signatures (PNG pictures), who signed and what they confirmed. The signed slip itself is saved on the order as
-- its signed BOL (order_files).
create table if not exists public.packing_slip_signatures (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders(id) on delete cascade,
  revision         int not null,
  signed_at        timestamptz not null default now(),
  signed_by        uuid,
  signed_by_name   text,
  ambit_name       text not null,
  ambit_sig        text not null,
  customer_name    text not null,
  customer_company text,
  truck            text,
  customer_sig     text not null,
  lots_checked     int not null default 0,
  file_path        text
);
create index if not exists packing_slip_signatures_order on public.packing_slip_signatures(order_id, signed_at);
alter table public.packing_slip_signatures enable row level security;
drop policy if exists packing_slip_signatures_read on public.packing_slip_signatures;
create policy packing_slip_signatures_read on public.packing_slip_signatures for select to authenticated using (public.is_employee());

-- What the packing slip shows right now. Signing checks it hasn't changed since the signing page was opened.
create or replace function public.order_slip_version(p_order uuid) returns text
language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select concat_ws(':', revision, company_id, branch_id, delivery_method, ship_address, ambit_po, invoice_no, scheduled_for, status)
       from public.orders where id = p_order),
    (select string_agg(id::text || ':' || coalesce(sku, '') || ':' || qty::text, ',' order by id) from public.order_items where order_id = p_order),
    (select string_agg(id::text || ':' || coalesce(lot_id::text, '-') || ':' || qty::text || ':' || state, ',' order by id)
       from public.inventory_lines where order_id = p_order and state <> 'cancelled')))
$$;

-- Sign the packing slip and finish the order: both signatures, every lot checked, saved as the signed BOL, and the
-- order is marked picked up / shipped out (the same checks as Mark picked up).
-- p: { ambit_name, ambit_sig, customer_name, customer_company, truck, customer_sig, lots: [inventory line ids checked] }
create or replace function public.order_sign_slip(p_order uuid, p_version text, p jsonb, p_path text, p_file_name text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  me   record;
  sid  bigint;
  need int;
  got  int;
  png  text := 'data:image/png;base64,';
begin
  if not (public.is_employee() and (public.has_perm('order_desk') or public.has_perm('inventory'))) then
    raise exception 'Only the order desk or the warehouse can sign out an order.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  select role, job_role, branch_id into me from public.profiles where id = auth.uid();
  if me.role = 'employee' and me.job_role = 'warehouse' and o.branch_id is distinct from me.branch_id then
    raise exception 'Warehouse managers sign out orders at their own location only.';
  end if;
  if public.order_change_pending(p_order) then
    raise exception 'Don''t load this order: it was changed and an admin hasn''t approved the change yet.';
  end if;
  if p_version is distinct from public.order_slip_version(p_order) then
    raise exception 'This order changed while it was being signed. Reload the page, check the packing slip again, and sign again.';
  end if;
  if length(trim(coalesce(p ->> 'ambit_name', ''))) < 2 then raise exception 'Enter the AMBIT employee''s name.'; end if;
  if length(trim(coalesce(p ->> 'customer_name', ''))) < 2 then raise exception 'Enter the name of the customer or driver.'; end if;
  if left(coalesce(p ->> 'ambit_sig', ''), length(png)) <> png or length(p ->> 'ambit_sig') < 200 then raise exception 'The AMBIT employee has to sign.'; end if;
  if left(coalesce(p ->> 'customer_sig', ''), length(png)) <> png or length(p ->> 'customer_sig') < 200 then raise exception 'The customer or driver has to sign.'; end if;
  if length(p ->> 'ambit_sig') > 400000 or length(p ->> 'customer_sig') > 400000 then raise exception 'A signature is too big. Clear it and sign again.'; end if;
  -- Every drum line with a lot has to be checked against the drums.
  select count(*) into need from public.inventory_lines where order_id = p_order and state = 'reserved' and lot_id is not null;
  select count(*) into got from public.inventory_lines l
   where l.order_id = p_order and l.state = 'reserved' and l.lot_id is not null
     and l.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p -> 'lots', '[]'::jsonb)) x);
  if got < need then raise exception 'Check the lot # on every drum and tick each lot first.'; end if;

  insert into public.packing_slip_signatures (order_id, revision, signed_by, signed_by_name, ambit_name, ambit_sig, customer_name, customer_company,
                                              truck, customer_sig, lots_checked, file_path)
  values (p_order, o.revision, auth.uid(), public.my_name(), left(trim(p ->> 'ambit_name'), 120), p ->> 'ambit_sig', left(trim(p ->> 'customer_name'), 120),
          nullif(left(trim(coalesce(p ->> 'customer_company', '')), 120), ''), nullif(left(trim(coalesce(p ->> 'truck', '')), 60), ''),
          p ->> 'customer_sig', need, p_path)
  returning id into sid;
  perform public.order_add_file(p_order, 'bol', p_path, coalesce(p_file_name, 'Signed packing slip.pdf'));
  perform public.order_complete(p_order);
  return sid;
end $$;

revoke all on function public.order_slip_version(uuid) from public, anon;
grant execute on function public.order_slip_version(uuid) to authenticated;
revoke all on function public.order_sign_slip(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.order_sign_slip(uuid, text, jsonb, text, text) to authenticated;

-- ---------- Price requests: AMBIT Foam Products and fiberglass by type; a new customer's credit line ----------
-- Foam and fiberglass are quoted by type ("AMBI-SEAL 5.0 Open Cell" per lb, "R-13 KFT" per sq ft, "Blow In" per bag):
-- one line per type, and once approved the price goes on every product of that type for the customer.
alter table public.price_request_lines add column if not exists quote_type text;
alter table public.price_request_lines add column if not exists applies_to uuid[];
-- Per sq ft prices need more than 2 decimals ($0.385).
alter table public.price_request_lines alter column requested_price type numeric(12,4);
alter table public.price_request_lines alter column approved_price  type numeric(12,4);
alter table public.price_request_lines alter column list_price      type numeric(12,4);

create or replace function public.price_request_submit2(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; co public.companies; v_id bigint; ln jsonb; pr public.products; v_price numeric; v_rule text; n int := 0; a int := 0; r jsonb;
        cu jsonb := coalesce(p -> 'customer', '{}'::jsonb); k text; v_kind text; v_name text; v_basis text; miss text[] := '{}'; v_prods uuid[]; v_label text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or not (me.role = 'admin' or public.has_perm('price_requests')) then raise exception 'You don''t have access to price requests.'; end if;
  v_kind := case when p ->> 'customer_kind' in ('existing', 'new', 'previous') then p ->> 'customer_kind' else null end;
  if v_kind is null then raise exception 'Pick whether this is an existing customer or a new one.'; end if;
  if v_kind = 'existing' then
    select * into co from public.companies where id = nullif(p ->> 'company_id', '')::uuid;
    if co.id is null then raise exception 'Pick the customer from the list.'; end if;
  end if;
  foreach k in array array['legal_name', 'contact_first', 'contact_last', 'email', 'phone', 'street', 'city', 'state', 'zip', 'customer_type',
                           'rigs', 'monthly_sets', 'tax_ack'] loop
    if coalesce(trim(cu ->> k), '') = '' then miss := array_append(miss, k); end if;
  end loop;
  if v_kind <> 'existing' then
    if coalesce(trim(cu ->> 'wants_credit'), '') = '' then miss := array_append(miss, 'wants_credit');
    elsif cu ->> 'wants_credit' like 'Yes%' and coalesce(nullif(regexp_replace(coalesce(cu ->> 'credit_requested', ''), '[^0-9.]', '', 'g'), ''), '0')::numeric <= 0 then
      miss := array_append(miss, 'credit_requested');
    end if;
  end if;
  if array_length(miss, 1) > 0 then raise exception 'Fill in every customer field (missing: %).', array_to_string(miss, ', '); end if;
  if coalesce(trim(p ->> 'note'), '') = '' then raise exception 'Add a note (current vendor, complaints, prior AMBIT customer…).'; end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'Add at least one product and the price you need.'; end if;
  r := coalesce((select value from public.app_settings where key = 'price_rules'), '{}'::jsonb);
  v_name := coalesce(co.name, left(trim(cu ->> 'legal_name'), 160));
  insert into public.price_requests (created_by, rep_name, company_id, company_name, contact, branch_id, note, valid_until, customer_kind, customer, product_lines)
  values (me.id, coalesce(nullif(me.full_name, ''), me.email), co.id, v_name, left(trim(coalesce(cu ->> 'contact_first', '') || ' ' || coalesce(cu ->> 'contact_last', '')), 160),
          case when exists (select 1 from public.branches where id = p ->> 'branch') then p ->> 'branch' end,
          left(trim(p ->> 'note'), 2000), (now() at time zone 'America/Chicago')::date + greatest(7, least(coalesce((p ->> 'valid_days')::int, 90), 365)),
          v_kind, cu, coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'product_lines', '[]'::jsonb)) x), '{}'))
  returning id into v_id;
  for ln in select * from jsonb_array_elements(p -> 'lines') loop
    v_price := round(coalesce(nullif(ln ->> 'price', '')::numeric, 0), 4);
    if v_price <= 0 then continue; end if;
    v_basis := case when ln ->> 'basis' in ('unit', 'lb', 'sqft') then ln ->> 'basis' else 'unit' end;
    if coalesce(ln ->> 'type', '') <> '' then
      -- A type (foam per lb, fiberglass per sq ft, blow-in per bag): its price goes on each of its products once approved.
      v_label := left(trim(coalesce(ln ->> 'label', ln ->> 'type')), 120);
      select coalesce(array_agg(x.id), '{}') into v_prods
        from public.products x
       where x.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(ln -> 'products', '[]'::jsonb)) e
                       where (e #>> '{}') ~* '^[0-9a-f-]{36}$');
      insert into public.price_request_lines (request_id, product_id, sku, name, unit, list_price, requested_price, volume, approved_price, status, auto, rule, basis, quote_type, applies_to)
      values (v_id, v_prods[1], left(upper(ln ->> 'type'), 40), v_label,
              coalesce(nullif(left(trim(coalesce(ln ->> 'unit', '')), 20), ''), case v_basis when 'lb' then 'lb' when 'sqft' then 'sq ft' else 'each' end),
              null, v_price, nullif(left(trim(coalesce(ln ->> 'volume', '')), 80), ''), null, 'pending', false, null, v_basis, ln ->> 'type', v_prods);
      n := n + 1;
      continue;
    end if;
    select * into pr from public.products where id = nullif(ln ->> 'product_id', '')::uuid and not coalesce(admin_only, false);
    if pr.id is null then raise exception 'One of the products isn''t available.'; end if;
    v_rule := case when v_basis = 'unit' and jsonb_array_length(p -> 'lines') <= coalesce((r ->> 'max_lines')::int, 15) then public.price_rule_check(pr.id, v_price) end;
    insert into public.price_request_lines (request_id, product_id, sku, name, unit, list_price, requested_price, volume, approved_price, status, auto, rule, basis)
    values (v_id, pr.id, pr.sku, pr.name, case v_basis when 'lb' then 'lb' when 'sqft' then 'sq ft' else pr.unit end,
            case when v_basis = 'unit' then (case when public.sale_on(pr.sale_price, pr.sale_ends) then pr.sale_price else pr.list_price end) end,
            v_price, nullif(left(trim(coalesce(ln ->> 'volume', '')), 80), ''),
            case when v_rule is not null then v_price end, case when v_rule is not null then 'approved' else 'pending' end, v_rule is not null, v_rule, v_basis);
    n := n + 1;
    if v_rule is not null then a := a + 1; end if;
  end loop;
  if n = 0 then raise exception 'Add at least one product and the price you need.'; end if;
  update public.price_requests
     set status = case when a = n then 'approved' else 'pending' end,
         decided_by_name = case when a = n then 'Auto-approved (rules)' end,
         decided_at = case when a = n then now() end
   where id = v_id;
  if a = n then perform public.customer_prices_from_request(v_id); end if;
  return jsonb_build_object('id', v_id, 'lines', n, 'auto', a);
end $$;

-- Approved prices onto the customer: a type's price goes on every product of that type.
create or replace function public.customer_prices_from_request(p_request bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r public.price_requests; n int := 0;
begin
  select * into r from public.price_requests where id = p_request;
  if r.id is null or r.company_id is null then return 0; end if;
  with src as (
    select coalesce(t.pid, l.product_id) as product_id, l.approved_price, coalesce(l.basis, 'unit') as basis
      from public.price_request_lines l
      left join lateral unnest(case when coalesce(cardinality(l.applies_to), 0) > 0 then l.applies_to end) as t(pid) on true
     where l.request_id = r.id and l.status = 'approved' and l.approved_price is not null
  ), ok as (
    select distinct on (product_id) * from src where product_id is not null order by product_id
  ), up as (
    insert into public.customer_prices (company_id, product_id, price, basis, effective_on, expires_on, source, source_ref, updated_by_name, updated_at)
    select r.company_id, ok.product_id, ok.approved_price, ok.basis, (now() at time zone 'America/Chicago')::date, r.valid_until, 'price_request', 'PRF-' || r.id,
           coalesce(r.decided_by_name, 'Price request'), now()
      from ok
    on conflict (company_id, product_id) do update
      set price = excluded.price, basis = excluded.basis, effective_on = excluded.effective_on, expires_on = excluded.expires_on, source = excluded.source,
          source_ref = excluded.source_ref, updated_by_name = excluded.updated_by_name, updated_at = now()
    returning 1
  )
  select count(*) into n from up;
  insert into public.customer_price_history (company_id, product_id, price, basis, source, changed_by_name)
  select r.company_id, coalesce(t.pid, l.product_id), l.approved_price, coalesce(l.basis, 'unit'), 'price_request', coalesce(r.decided_by_name, 'Price request')
    from public.price_request_lines l
    left join lateral unnest(case when coalesce(cardinality(l.applies_to), 0) > 0 then l.applies_to end) as t(pid) on true
   where l.request_id = r.id and l.status = 'approved' and l.approved_price is not null and coalesce(t.pid, l.product_id) is not null;
  return n;
end $$;

-- Check: should say 4
select count(*) as "Ready (should be 4)" from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('order_edit_details', 'order_sign_slip', 'order_slip_version', 'price_request_submit2');
