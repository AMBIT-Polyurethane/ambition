-- =====================================================================
-- AMBIT Intelligence update 0044 - Custom foam orders
-- * "Make Custom Foam Order" on the order screen (AMBIT staff): order a specific ISO brand (Covestro, Dow,
--   Huntsman, Wanhua) and any resins straight from a location's inventory, instead of the store's one
--   "ISO A-Side" (where the app picks the brand). The warehouse holds that exact brand, soonest-expiring lot first.
-- * place_order: AMBIT staff may order an ISO brand by name (brands are stocked under ISO A-Side and aren't
--   sold by name in the store, so contractors still can't). Otherwise unchanged from 0015.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Placing an order: AMBIT staff can order an ISO brand by name ----------
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

select 'custom foam orders ready' as status;
