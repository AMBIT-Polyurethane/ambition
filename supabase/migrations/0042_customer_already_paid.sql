-- =====================================================================
-- AMBIT Intelligence update 0042 - "Customer Has Already Paid"
-- * Accounting can tick "Customer Has Already Paid" when they release an order (next to COD Only and No Checks
--   Allowed). The warehouse sees PAID: nothing to collect at pickup / delivery. Ticking it clears COD Only and
--   No Checks Allowed on that order (nothing to collect), but the customer's usual COD / No Checks setting is kept
--   for their next order. It isn't remembered for the next order: every payment is its own.
-- * If the order is edited later and the total goes up, credit is checked again and "already paid" comes off
--   (they paid the old total, not the difference).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.orders add column if not exists pay_prepaid boolean not null default false;

-- Same as 0035, plus p_prepaid (left out = unchanged, so older screens keep working).
drop function if exists public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean);
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false,
                                                        p_cod boolean default null, p_no_checks boolean default null,
                                                        p_prepaid boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  ts   text;
  paid boolean;
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
  paid := p_approve and coalesce(p_prepaid, o.pay_prepaid, false);
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end,
         pay_prepaid   = case when p_approve then paid else pay_prepaid end,
         pay_cod       = case when paid then false when p_approve then coalesce(p_cod, pay_cod) else pay_cod end,
         pay_no_checks = case when paid then false when p_approve then coalesce(p_no_checks, pay_no_checks) else pay_no_checks end
   where id = p_order;
  -- The customer's next order starts the same way (not when they paid this one up front).
  if p_approve and not paid and o.company_id is not null and (p_cod is not null or p_no_checks is not null) then
    update public.companies
       set pay_cod = coalesce(p_cod, pay_cod), pay_no_checks = coalesce(p_no_checks, pay_no_checks)
     where id = o.company_id;
  end if;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean, boolean) to authenticated;

-- Same as 0041: the CRM's invoice update after an edit. When the total went up and credit opens again, an order
-- that was already paid isn't any more (only the old total was).
create or replace function public.order_invoice_update_done(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders;
  newt   numeric;
  oldt   numeric;
  reopen boolean;
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
  reopen := newt > oldt + 0.004 and o.credit_status = 'approved';
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
  return jsonb_build_object('was', true, 'reopened', reopen, 'before', oldt, 'after', newt, 'changes', ch);
end $$;
revoke all on function public.order_invoice_update_done(uuid) from public, anon;
grant execute on function public.order_invoice_update_done(uuid) to authenticated;

select 'Customer Has Already Paid ready' as status;
