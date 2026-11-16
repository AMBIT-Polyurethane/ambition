-- =====================================================================
-- AMBIT Intelligence update 0072 - Lot pickers: every ISO brand, even hidden from the catalog
-- * The ISO brands (Covestro, Wanhua) are hidden from the catalog, because customers order "ISO A-Side". The lot
--   pickers (Wrong lot or brand went out?, the pickup check, Correct order) skipped hidden products, so an ISO line
--   had nothing to pick. Now every lot on FOAM LOTS shows, hidden or not.
-- Run once in Supabase > SQL Editor, AFTER 0071. Safe to run again.
-- =====================================================================

create or replace function public.inventory_lot_choices_any(p_line bigint)
returns table (lot_id bigint, product_id uuid, sku text, name text, lot_no text, use_by date, exp date, mfg date,
               remaining numeric, available numeric, expired boolean, current boolean, same_type boolean, held_for text)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.inventory_lines where id = p_line),
       it as (select i.* from public.order_items i join l on l.order_item_id = i.id),
       co as (select o.company_id from public.orders o join l on l.order_id = o.id),
       cur as (select p.* from public.products p join it on p.id = it.product_id),
       cand as (
         select p.id, coalesce(p.id = (select id from cur) or p.stock_of = (select id from cur), false) as same_type
           from public.products p
          where (
                p.id = (select id from cur) or p.stock_of = (select id from cur)
             or (p.category_id is not distinct from (select category_id from cur)
                 and lower(p.unit) = lower((select unit from it))
                 and public.product_is_a_side(p) = (select public.product_is_a_side(cp) from public.products cp where cp.id = (select product_id from it))))
       )
  select x.id, x.product_id, x.sku, p.name, x.lot_no, x.use_by, x.exp, x.mfg, x.remaining,
         case when (select state from l) = 'done'
              then x.remaining + case when x.id = (select lot_id from l) then (select qty from l) else 0 end
              else x.remaining - x.sheet_pending
                   - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = x.id and r.state = 'reserved' and r.id <> p_line), 0) end,
         coalesce(x.use_by < (now() at time zone 'America/Chicago')::date, false),
         x.id = (select lot_id from l),
         c.same_type,
         public.inventory_lot_hold_text(x.id, (select company_id from co))
    from public.inventory_lots x
    join cand c on c.id = x.product_id
    join public.products p on p.id = x.product_id
   where public.is_employee()
     and x.branch_id = (select branch_id from l) and x.on_sheet
   order by c.same_type desc, p.pick_rank, x.use_by nulls last, x.mfg nulls last, upper(x.lot_no), x.id
$$;

create or replace function public.inventory_lot_choices_for(p_branch text, p_products uuid[], p_company uuid default null)
returns table (for_product uuid, lot_id bigint, product_id uuid, sku text, name text, lot_no text, exp date, use_by date,
               remaining numeric, available numeric, expired boolean, same_type boolean, held_for text)
language sql stable security definer set search_path = public as $$
  with lots as (
    select x.id, x.product_id, x.sku, x.lot_no, x.exp, x.use_by, x.mfg, x.remaining, x.sheet_pending,
           lp.name, lp.stock_of, lp.category_id, lower(lp.unit) as unit, public.product_is_a_side(lp) as a_side, lp.pick_rank
      from public.inventory_lots x
      join public.products lp on lp.id = x.product_id
     where x.branch_id = p_branch and x.on_sheet
  )
  select w.id, l.id, l.product_id, l.sku, l.name, nullif(l.lot_no, ''), l.exp, l.use_by, l.remaining,
         l.remaining - l.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = l.id and r.state = 'reserved'), 0),
         coalesce(l.use_by < (now() at time zone 'America/Chicago')::date, false),
         coalesce(l.product_id = w.id or l.stock_of = w.id, false),
         public.inventory_lot_hold_text(l.id, p_company)
    from public.products w
    join lots l
      on l.product_id = w.id or l.stock_of = w.id
      or (l.category_id is not distinct from w.category_id and l.unit = lower(w.unit) and l.a_side = public.product_is_a_side(w))
   where w.id = any(p_products) and public.is_employee()
   order by w.id, coalesce(l.product_id = w.id or l.stock_of = w.id, false) desc, l.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
$$;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('inventory_lot_choices_any', 'inventory_lot_choices_for')
   and pg_get_functiondef(oid) not ilike '%.active%' and pg_get_functiondef(oid) not ilike '%p.active and%';
