-- =====================================================================
-- AMBITION - Customer approval for orders
-- * Orders AMBIT staff place for a customer are emailed to the customer
--   with a secure link. The order goes to orders@ambitpu.com only after
--   the customer approves (or asks for changes).
-- * Contractors ordering for themselves approve in the app ("Approve order").
-- * Job-site deliveries remember which branch they ship from.
-- * Branch street addresses for the printed order (blanks only).
-- Safe to run more than once.
-- =====================================================================

alter table public.orders add column if not exists approval_status       text not null default 'not_required';
alter table public.orders add column if not exists approval_method       text;         -- email_link | in_app | staff_recorded
alter table public.orders add column if not exists approval_email        text;         -- where the approval link was sent
alter table public.orders add column if not exists approval_token_hash   text;         -- sha256 of the link token (the token itself is never stored)
alter table public.orders add column if not exists approval_sent_at      timestamptz;
alter table public.orders add column if not exists approval_expires_at   timestamptz;
alter table public.orders add column if not exists approval_email_status text;         -- sent | failed | not_configured
alter table public.orders add column if not exists approval_email_error  text;
alter table public.orders add column if not exists approved_at           timestamptz;
alter table public.orders add column if not exists approved_by_name      text;
alter table public.orders add column if not exists approval_note         text;         -- the customer's change request, or how staff got the approval
alter table public.orders add column if not exists approval_ref          text;         -- APV-1048-7F3K, printed on the order

do $$ begin
  alter table public.orders add constraint orders_approval_status_check
    check (approval_status in ('not_required', 'pending', 'approved', 'changes_requested'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_approval_method_check
    check (approval_method is null or approval_method in ('email_link', 'in_app', 'staff_recorded'));
exception when duplicate_object then null; end $$;

create unique index if not exists orders_approval_token_key on public.orders(approval_token_hash) where approval_token_hash is not null;
create index if not exists orders_approval_status_idx on public.orders(approval_status);

-- Left over from the customer update (0009): harmless to repeat.
alter table public.companies drop constraint if exists companies_created_by_fkey;

-- Branch street addresses, shown on the printed order. Only fills blanks.
update public.branches set address = '4708 South Council Rd, Oklahoma City, OK 73179'    where id = 'okc' and coalesce(address, '') = '';
update public.branches set address = '3701 East Randol Mill Rd, Arlington, TX 76011'     where id = 'atx' and coalesce(address, '') = '';
update public.branches set address = '2101 Clovis R Barker Rd, San Marcos, TX 78666'     where id = 'smx' and coalesce(address, '') = '';
update public.branches set address = '4225 James E Casey Dr, Jacksonville, FL 32219'     where id = 'jax' and coalesce(address, '') = '';
update public.branches set address = '4600 Cypress Park Dr, Suite A, Mobile, AL 36619'   where id = 'mob' and coalesce(address, '') = '';

-- ---------- Placing an order (replaces the original) -----------------
-- Same inputs as before. Contractors' own orders are approved as they place them.
-- Job-site deliveries keep the branch they ship from.
create or replace function public.place_order(
  p_items           jsonb,
  p_delivery_method text,
  p_branch_id       text default null,
  p_ship_address    text default null,
  p_po_number       text default null,
  p_needed_by       date default null,
  p_notes           text default null,
  p_company_id      uuid default null,
  p_customer_name   text default null
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

    select p.id, p.sku, p.name, p.unit, p.list_price,
           coalesce(p.customer_priced, c.customer_priced, false) as cp
      into pr
      from public.products p
      left join public.categories c on c.id = p.category_id
     where p.id = (item->>'product_id')::uuid and p.active;
    if not found then
      raise exception 'An item in your order is no longer available. Please refresh and try again.';
    end if;

    insert into public.order_items (order_id, product_id, sku, name, unit, qty, unit_price, customer_priced, line_total)
    values (new_id, pr.id, pr.sku, pr.name, pr.unit, q,
            case when pr.cp then null else pr.list_price end,
            pr.cp,
            case when pr.cp or pr.list_price is null then null else round(pr.list_price * q, 2) end);

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

-- Whoever placed the order, AMBIT staff, or someone at the customer's company can record the orders@ email result.
create or replace function public.mark_order_email(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set email_status = p_status, email_error = left(p_error, 500)
   where id = p_order
     and (placed_by = auth.uid() or public.is_employee()
          or (company_id is not null and company_id = public.my_company_id()));
$$;

-- ---------- Staff: send (or resend) the approval email ----------------
-- The app makes a random token, emails the link, and stores only its sha256 here.
-- Resending makes a new link; the old one stops working.
create or replace function public.request_order_approval(p_order uuid, p_email text, p_token_hash text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.is_employee() then
    raise exception 'Only AMBIT staff can send orders for approval.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.placed_by_role = 'customer' then raise exception 'Contractors approve their own orders in the app.'; end if;
  if o.approval_status = 'approved' then raise exception 'This order is already approved.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status = 'not_required' and o.email_status = 'sent' then
    raise exception 'This order already went to AMBIT orders.';
  end if;
  if coalesce(trim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter the customer''s email address.';
  end if;
  if coalesce(length(p_token_hash), 0) <> 64 then raise exception 'Could not make an approval link.'; end if;

  update public.orders
     set approval_status       = 'pending',
         approval_email        = lower(trim(p_email)),
         approval_token_hash   = p_token_hash,
         approval_sent_at      = now(),
         approval_expires_at   = now() + interval '7 days',
         approval_note         = null,
         approval_email_status = null,
         approval_email_error  = null,
         approval_ref          = coalesce(approval_ref, 'APV-' || order_no || '-' || upper(substr(md5(id::text || clock_timestamp()::text), 1, 4)))
   where id = p_order;
end $$;

create or replace function public.mark_approval_email(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set approval_email_status = p_status, approval_email_error = left(p_error, 500)
   where id = p_order and public.is_employee();
$$;

-- Staff: the customer approved another way (phone, in person). Kept on the record and printed.
create or replace function public.record_order_approval(p_order uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me public.profiles;
begin
  if not public.is_employee() then raise exception 'Only AMBIT staff can record an approval.'; end if;
  select * into me from public.profiles where id = auth.uid();
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.approval_status not in ('pending', 'changes_requested') then raise exception 'This order is not waiting for approval.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if length(coalesce(trim(p_note), '')) < 5 then
    raise exception 'Say who approved it and how, for example "Travis Holt approved by phone, 10:15 AM".';
  end if;
  update public.orders
     set approval_status = 'approved', approval_method = 'staff_recorded',
         approved_at = now(), approved_by_name = coalesce(me.full_name, me.email),
         approval_note = left(trim(p_note), 500), email_status = 'pending', email_error = null
   where id = p_order;
end $$;

-- A signed-in contractor approving (or asking to change) an order AMBIT placed for their company.
create or replace function public.customer_order_decision(p_order uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or me.role <> 'customer' then
    raise exception 'Only the customer can approve this order.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.company_id is distinct from me.company_id then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'This order is not waiting for approval.'; end if;
  if p_approve then
    update public.orders
       set approval_status = 'approved', approval_method = 'in_app',
           approved_at = now(), approved_by_name = coalesce(me.full_name, me.email),
           email_status = 'pending', email_error = null
     where id = o.id;
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Tell us what needs to change.'; end if;
    update public.orders
       set approval_status = 'changes_requested', approval_note = left(trim(p_note), 2000)
     where id = o.id;
  end if;
end $$;

-- ---------- The customer's approval link (no sign-in needed) ----------
-- Everything the approval page and the printed order need. Internal only.
create or replace function public.order_doc_json(p_order uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'order', to_jsonb(o) - 'approval_token_hash' - 'email_error' - 'approval_email_error' - 'placed_by',
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'order_id' - 'product_id' order by i.id)
                         from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'branch', (select to_jsonb(b) from public.branches b where b.id = o.branch_id),
    'company', (select jsonb_build_object('contact_name', c.contact_name, 'phone', c.phone, 'email', c.email,
                                          'bill_address', c.bill_address)
                  from public.companies c where c.id = o.company_id),
    'state', case
      when o.status = 'cancelled' then 'cancelled'
      when o.approval_status = 'approved' then 'approved'
      when o.approval_status = 'changes_requested' then 'changes_requested'
      when o.approval_status = 'pending' and o.approval_expires_at < now() then 'expired'
      when o.approval_status = 'pending' then 'pending'
      else 'closed' end)
  from public.orders o
  where o.id = p_order;
$$;

create or replace function public.order_approval_view(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  oid uuid;
begin
  if coalesce(length(p_token), 0) < 20 then return null; end if;
  select id into oid from public.orders
   where approval_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if oid is null then return null; end if;
  return public.order_doc_json(oid);
end $$;

create or replace function public.approve_order_by_link(p_token text, p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders
   where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if o.id is null then raise exception 'This approval link is not valid. Ask your AMBIT rep to send a new one.'; end if;
  if o.approval_status = 'approved' then return public.order_doc_json(o.id) || '{"already": true}'::jsonb; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'Your AMBIT rep is updating this order. Watch for a new email.'; end if;
  if o.approval_expires_at < now() then raise exception 'This approval link has expired. Ask your AMBIT rep to send a new one.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your name to approve.'; end if;
  update public.orders
     set approval_status = 'approved', approval_method = 'email_link',
         approved_at = now(), approved_by_name = left(trim(p_name), 120),
         email_status = 'pending', email_error = null
   where id = o.id;
  return public.order_doc_json(o.id);
end $$;

create or replace function public.request_order_changes_by_link(p_token text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders
   where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if o.id is null then raise exception 'This approval link is not valid. Ask your AMBIT rep to send a new one.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.approval_status <> 'pending' then raise exception 'This order is not waiting for approval.'; end if;
  if o.approval_expires_at < now() then raise exception 'This approval link has expired. Ask your AMBIT rep to send a new one.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Tell us what needs to change.'; end if;
  update public.orders
     set approval_status = 'changes_requested', approval_note = left(trim(p_note), 2000)
   where id = o.id;
  return public.order_doc_json(o.id);
end $$;

create or replace function public.mark_order_email_by_link(p_token text, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders
     set email_status = p_status, email_error = left(p_error, 500)
   where approval_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and approval_status = 'approved';
$$;

-- ---------- Who may call what ----------------------------------------
revoke execute on function public.order_doc_json(uuid) from public, anon, authenticated;
revoke execute on function public.mark_order_email(uuid, text, text) from public, anon;
revoke execute on function public.request_order_approval(uuid, text, text) from public, anon;
revoke execute on function public.mark_approval_email(uuid, text, text) from public, anon;
revoke execute on function public.record_order_approval(uuid, text) from public, anon;
revoke execute on function public.customer_order_decision(uuid, boolean, text) from public, anon;
revoke execute on function public.order_approval_view(text) from public;
revoke execute on function public.approve_order_by_link(text, text) from public;
revoke execute on function public.request_order_changes_by_link(text, text) from public;
revoke execute on function public.mark_order_email_by_link(text, text, text) from public;

grant execute on function public.mark_order_email(uuid, text, text) to authenticated;
grant execute on function public.request_order_approval(uuid, text, text) to authenticated;
grant execute on function public.mark_approval_email(uuid, text, text) to authenticated;
grant execute on function public.record_order_approval(uuid, text) to authenticated;
grant execute on function public.customer_order_decision(uuid, boolean, text) to authenticated;
-- The approval link works without signing in: anyone holding the link (and only them) can view and approve.
grant execute on function public.order_approval_view(text) to anon, authenticated;
grant execute on function public.approve_order_by_link(text, text) to anon, authenticated;
grant execute on function public.request_order_changes_by_link(text, text) to anon, authenticated;
grant execute on function public.mark_order_email_by_link(text, text, text) to anon, authenticated;
