-- =====================================================================
-- AMBIT Intelligence update 0070 - Correct order: say exactly which lot went out
-- * Correcting a completed order (admins): every ISO brand and Summer / Winter resin on the location's FOAM LOTS
--   tab can be added, and for each spray foam item you add or change you pick the exact lot that went out.
--   The drums come off that lot (Shipped Out on FOAM LOTS, so the COUNT SHEET follows) and it's on the
--   order's item variance table.
-- Run once in Supabase > SQL Editor, AFTER 0069. Safe to run again.
-- =====================================================================

-- ---------- The lots each item could have come from, at one location ----------
-- Its own lots, its brands' lots (ISO-WANHUA for "ISO A-Side"), and the products it can swap to
-- (same category, sold the same way, same side A or B), like the pickup check (0069).
create or replace function public.inventory_lot_choices_for(p_branch text, p_products uuid[])
returns table (for_product uuid, lot_id bigint, product_id uuid, sku text, name text, lot_no text, exp date, use_by date,
               remaining numeric, available numeric, expired boolean, same_type boolean)
language sql stable security definer set search_path = public as $$
  with lots as (
    select x.id, x.product_id, x.sku, x.lot_no, x.exp, x.use_by, x.mfg, x.remaining, x.sheet_pending,
           lp.name, lp.stock_of, lp.category_id, lower(lp.unit) as unit, public.product_is_a_side(lp) as a_side, lp.pick_rank
      from public.inventory_lots x
      join public.products lp on lp.id = x.product_id
     where x.branch_id = p_branch and x.on_sheet and lp.active
  )
  select w.id, l.id, l.product_id, l.sku, l.name, nullif(l.lot_no, ''), l.exp, l.use_by, l.remaining,
         l.remaining - l.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = l.id and r.state = 'reserved'), 0),
         coalesce(l.use_by < (now() at time zone 'America/Chicago')::date, false),
         coalesce(l.product_id = w.id or l.stock_of = w.id, false)
    from public.products w
    join lots l
      on l.product_id = w.id or l.stock_of = w.id
      or (l.category_id is not distinct from w.category_id and l.unit = lower(w.unit) and l.a_side = public.product_is_a_side(w))
   where w.id = any(p_products) and public.is_employee()
   order by w.id, coalesce(l.product_id = w.id or l.stock_of = w.id, false) desc, l.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
$$;

-- ---------- Edit an order, then put each spray foam line on the lot picked for it ----------
-- p_lines is what order_edit takes, plus an optional "lot_id" on a line. Only for a completed order (the drums
-- already left): the app picks the soonest-expiring lot first, then each picked line moves to the lot that
-- really went out (order_line_relot, so FOAM LOTS and the item variance table follow). All or nothing.
create or replace function public.order_edit_lots(p_order uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r     jsonb;
  e     jsonb;
  itid  bigint;
  ln    record;
  lot   bigint;
  why   text;
  n     int := 0;
begin
  r := public.order_edit(p_order, p_lines, p_note);
  if not coalesce((r ->> 'closed')::boolean, false) then return r; end if;
  why := 'Corrected order: the lot that really went out'
         || coalesce(' (' || nullif(left(trim(coalesce(p_note, '')), 200), '') || ')', '');
  for e in select * from jsonb_array_elements(p_lines) loop
    lot := nullif(e ->> 'lot_id', '')::bigint;
    if lot is null then continue; end if;
    itid := null;
    if nullif(e ->> 'id', '') is not null then
      itid := (e ->> 'id')::bigint;
    else
      select i.id into itid from public.order_items i
       where i.order_id = p_order and i.product_id = nullif(e ->> 'product_id', '')::uuid
       order by i.id desc limit 1;
    end if;
    if itid is null then continue; end if;
    for ln in select id from public.inventory_lines where order_item_id = itid and state = 'done' order by id loop
      perform public.order_line_relot(ln.id, lot, why, false);
      n := n + 1;
    end loop;
  end loop;
  return r || jsonb_build_object('lots', n);
end $$;

do $$
declare f text;
begin
  foreach f in array array['inventory_lot_choices_for(text, uuid[])', 'order_edit_lots(uuid, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc where proname in ('inventory_lot_choices_for', 'order_edit_lots');
