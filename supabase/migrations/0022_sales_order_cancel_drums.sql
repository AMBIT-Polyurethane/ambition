-- =====================================================================
-- AMBIT Intelligence update 0022
-- * "AMBIT PO #" is now "Sales Order #" (messages only; the column is still ambit_po).
-- * Spray foam resins (B side) are ordered by the drum, like ISO: unit "set" becomes "drum".
-- * Cancel an order (with a reason) and, for admins, delete a cancelled order for good.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Resins by the drum --------------------------------------------
update public.products
   set unit = 'drum'
 where category_id = 'ambit-foam' and lower(unit) in ('set', 'sets') and sku not ilike 'ISO%';
update public.order_items i
   set unit = 'drum'
  from public.products p
 where p.id = i.product_id and p.category_id = 'ambit-foam' and lower(i.unit) in ('set', 'sets');

-- ---------- Sales Order # wording -----------------------------------------
create or replace function public.order_set_po(p_order uuid, p_po text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the Sales Order #.'; end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  ts text;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'Enter the Sales Order # first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  if p_approve and o.company_id is not null then
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') and not coalesce(p_charge_tax, false) then
      raise exception 'This customer''s tax-exempt certificate is %. Verify a current certificate first, or choose "Charge sales tax on this order".',
        case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'waiting to be verified' end;
    end if;
  end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end
   where id = p_order;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean) to authenticated;

-- ---------- Cancel and delete ---------------------------------------------
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancelled_by_name text;
alter table public.orders add column if not exists cancelled_at timestamptz;

-- Admins and the order desk can cancel any open order; whoever placed it can cancel it until it has a
-- Sales Order #. Cancelling releases its stock (the inventory trigger marks the sheet lines Cancelled).
create or replace function public.order_cancel(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or public.has_perm('order_desk')
          or (o.placed_by = auth.uid() and o.ambit_po is null)) then
    raise exception 'Only an admin or the order desk can cancel this order now.';
  end if;
  if o.status = 'cancelled' then raise exception 'This order is already cancelled.'; end if;
  if o.status = 'completed' then raise exception 'This order is already picked up or delivered.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the order is cancelled.'; end if;
  update public.orders
     set status = 'cancelled', cancel_reason = left(trim(p_reason), 500),
         cancelled_by_name = public.my_name(), cancelled_at = now()
   where id = p_order;
end $$;

-- Admins only, and only a cancelled order (so its stock is released first). Waits until the inventory
-- sheet shows the lines as Cancelled, so the spreadsheet never keeps a reservation for a deleted order.
create or replace function public.order_delete(p_order uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.is_admin() then raise exception 'Only admins can delete orders.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'cancelled' then raise exception 'Cancel the order first, then delete it.'; end if;
  if exists (select 1 from public.inventory_lines l where l.order_id = p_order and l.sheet_row is not null and l.needs_write) then
    raise exception 'The inventory spreadsheet is still being updated for this order. Try again in a couple of minutes.';
  end if;
  delete from public.orders where id = p_order;
  return 'ORD-' || o.order_no;
end $$;

revoke execute on function public.order_cancel(uuid, text) from public, anon;
revoke execute on function public.order_delete(uuid) from public, anon;
grant execute on function public.order_cancel(uuid, text) to authenticated;
grant execute on function public.order_delete(uuid) to authenticated;

select (select count(*) from public.products where category_id = 'ambit-foam' and unit = 'drum') as foam_by_the_drum;
