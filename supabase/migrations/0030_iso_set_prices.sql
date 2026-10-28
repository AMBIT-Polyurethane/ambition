-- =====================================================================
-- AMBIT Intelligence update 0030 - ISO priced per foam set
-- AMBIT prices spray foam by the set, so the ISO (A side) going with a closed-cell resin can have a
-- different price from the ISO going with an open-cell resin on the same order. When the order desk
-- enters invoice prices, an ISO line that goes with more than one resin now gets a price for each set:
--   price_parts = [{"with": <resin order item id, or null for extra ISO>, "qty": 12, "price": 1085.00}, ...]
-- The line's line_total is the sum of the sets and unit_price is the average per drum, so totals,
-- sales goals and reports keep working unchanged.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.order_items add column if not exists price_parts jsonb;

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
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
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

revoke all on function public.order_set_numbers(uuid, text, text, jsonb) from public, anon;
grant execute on function public.order_set_numbers(uuid, text, text, jsonb) to authenticated;

select 'ISO priced per foam set ready' as status;
