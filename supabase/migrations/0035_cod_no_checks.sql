-- =====================================================================
-- AMBIT Intelligence update 0035 - COD Only / No Checks Allowed
-- * Accounting ticks "COD Only" and/or "No Checks Allowed" when they release an order. The warehouse sees it on
--   the pickup / delivery step, the order desk list and the warehouse PDF (never on the customer's copy).
-- * The customer remembers it: the next order's boxes start the way they were last time.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.orders    add column if not exists pay_cod       boolean not null default false;
alter table public.orders    add column if not exists pay_no_checks boolean not null default false;
alter table public.companies add column if not exists pay_cod       boolean not null default false;
alter table public.companies add column if not exists pay_no_checks boolean not null default false;

-- Same as 0022, plus the two payment boxes (left out = unchanged, so older screens keep working).
drop function if exists public.order_credit_decision(uuid, boolean, text, boolean);
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false,
                                                        p_cod boolean default null, p_no_checks boolean default null)
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
                    else tax_note end,
         pay_cod       = case when p_approve then coalesce(p_cod, pay_cod) else pay_cod end,
         pay_no_checks = case when p_approve then coalesce(p_no_checks, pay_no_checks) else pay_no_checks end
   where id = p_order;
  -- The customer's next order starts the same way.
  if p_approve and o.company_id is not null and (p_cod is not null or p_no_checks is not null) then
    update public.companies
       set pay_cod = coalesce(p_cod, pay_cod), pay_no_checks = coalesce(p_no_checks, pay_no_checks)
     where id = o.company_id;
  end if;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean, boolean, boolean) to authenticated;

select 'COD Only / No Checks Allowed ready' as status;
