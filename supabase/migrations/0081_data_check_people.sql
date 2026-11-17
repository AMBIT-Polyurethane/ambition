-- =====================================================================
-- AMBIT Intelligence update 0081 - Data check: the right people
-- * A location with no warehouse manager set (Arlington) puts its items on the staff there who work inventory.
-- * Orders that shipped before an item was counted by lot (AMBI-JACK, Alpha … before 11/17) aren't flagged: their
--   stock came off the total, so there's nothing to fix.
-- Run once in Supabase > SQL Editor, AFTER 0080. Safe to run again.
-- =====================================================================

-- Who runs a location: its warehouse manager(s); if it has none set, staff at that location who work inventory.
create or replace function public.branch_people(p_branch text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p
      where p.status = 'active' and not coalesce(p.demo, false) and p.role = 'employee' and p.job_role = 'warehouse' and p.branch_id = p_branch),
    (select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p
      where p.status = 'active' and not coalesce(p.demo, false) and p.branch_id = p_branch
        and (p.role = 'admin' or 'inventory' = any(coalesce(p.perms, '{}')))))
$$;
revoke all on function public.branch_people(text) from public, anon, authenticated;

-- ---------- Data check ----------
-- One row per thing to fix. who = the person it's on (when the app knows), else the team.
create or replace function public.data_check()
returns table (kind text, branch text, order_id uuid, order_no bigint, lot_id bigint, other_lot bigint, title text, detail text, who text)
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Chicago')::date;
begin
  if not public.is_admin() then raise exception 'Only an admin can run the data check.'; end if;

  -- Lots below zero.
  return query
  select 'lot_negative', l.branch_id, null::uuid, null::bigint, l.id, null::bigint,
         l.sku || ' lot ' || coalesce(nullif(l.lot_no, ''), '(no lot #)') || ' is at ' || trim_scale(l.remaining + l.in_unsynced + l.adj_unsynced),
         'More went out of this lot than it had. Count it, then fix the lot (Adj on FOAM LOTS) or the order that took the wrong lot.',
         public.branch_people(l.branch_id)
    from public.inventory_lots l
   where l.on_sheet and l.remaining + l.in_unsynced + l.adj_unsynced < 0;

  -- Lots promised to more than they have.
  return query
  with r as (select il.lot_id, sum(il.qty) as q, string_agg(distinct 'ORD-' || o.order_no, ', ') as ords
               from public.inventory_lines il join public.orders o on o.id = il.order_id
              where il.state = 'reserved' and il.lot_id is not null and o.status in ('new', 'processing') group by il.lot_id)
  select 'lot_overpromised', l.branch_id, null::uuid, null::bigint, l.id, null::bigint,
         l.sku || ' lot ' || coalesce(nullif(l.lot_no, ''), '(no lot #)') || ': ' || trim_scale(r.q) || ' promised, ' || trim_scale(greatest(l.remaining + l.in_unsynced + l.adj_unsynced, 0)) || ' there',
         'Open orders holding it: ' || r.ords || '. Change the lot on the order(s) that aren''t really getting these drums.',
         public.branch_people(l.branch_id)
    from public.inventory_lots l join r on r.lot_id = l.id
   where r.q + l.sheet_pending > greatest(l.remaining + l.in_unsynced + l.adj_unsynced, 0);

  -- The same lot typed two ways.
  return query
  with g as (select l.branch_id, l.product_id, public.lot_key(l.lot_no) as k, array_agg(l.id order by l.id) as ids,
                    string_agg(coalesce(nullif(l.lot_no, ''), '(blank)') || ' (' || trim_scale(l.remaining + l.in_unsynced + l.adj_unsynced) || ')', ' and ' order by l.id) as what
               from public.inventory_lots l
              where l.on_sheet and public.lot_key(l.lot_no) <> ''
                and (l.remaining + l.in_unsynced + l.adj_unsynced <> 0
                     or exists (select 1 from public.inventory_lines r where r.lot_id = l.id and r.state = 'reserved'))   -- a merged-away row (0) drops off
              group by 1, 2, 3 having count(*) > 1)
  select 'lot_duplicate', g.branch_id, null::uuid, null::bigint, g.ids[1], g.ids[2],
         (select sku from public.inventory_lots where id = g.ids[1]) || ': the same lot on two rows',
         g.what || '. Merge them so orders and counts use one row.',
         (select string_agg(distinct d.submitted_by_name, ', ') from public.inbound_lines il join public.inbound_deliveries d on d.id = il.delivery_id
           where d.branch_id = g.branch_id and il.product_id = g.product_id and public.lot_key(il.lot_no) = g.k and d.submitted_by_name is not null)
    from g;

  -- Open orders past their pickup / delivery date (did they go out?).
  return query
  select 'open_past_date', o.branch_id, o.id, o.order_no, null::bigint, null::bigint,
         'ORD-' || o.order_no || ' · ' || o.company_name || ' was due ' || to_char(o.scheduled_for, 'Mon DD') || ' and is still open',
         'If it went out, mark it ' || case when o.delivery_method = 'pickup' then 'picked up' else 'shipped out' end || ' with the signed BOL. If not, change the date.',
         public.branch_people(o.branch_id)
    from public.orders o
   where o.status in ('new', 'processing') and o.scheduled_for < today and o.delivery_method <> 'dropship';

  -- Shipped orders: no signed BOL, or drums with no lot recorded (last 90 days).
  return query
  with c as (select o.*, (select lg.by_name from public.inventory_log lg where lg.branch_id = o.branch_id and lg.message like 'ORD-' || o.order_no || ' picked up / delivered%' order by lg.id desc limit 1) as closer
               from public.orders o where o.status = 'completed' and o.completed_at > now() - interval '90 days' and o.delivery_method <> 'dropship')
  select 'shipped_no_bol', c.branch_id, c.id, c.order_no, null::bigint, null::bigint,
         'ORD-' || c.order_no || ' · ' || c.company_name || ' went out ' || to_char(c.completed_at at time zone 'America/Chicago', 'Mon DD') || ' with no signed BOL',
         'Add a photo or scan of the signed BOL (or the signed packing slip) to the order.', coalesce(c.closer, public.branch_people(c.branch_id))
    from c where not exists (select 1 from public.order_files f where f.order_id = c.id and f.kind = 'bol')
  union all
  select 'shipped_no_lot', c.branch_id, c.id, c.order_no, null::bigint, null::bigint,
         'ORD-' || c.order_no || ' · ' || c.company_name || ': ' || trim_scale(sum(il.qty)) || ' ' || string_agg(distinct il.sku, ', ') || ' went out with no lot recorded',
         'Use Fix what went out on the order to put each drum on the lot the packing slip shows.', coalesce(c.closer, public.branch_people(c.branch_id))
    from c join public.inventory_lines il on il.order_id = c.id and il.state = 'done' and il.lot_id is null
   where exists (select 1 from public.inventory_lots x where x.branch_id = c.branch_id and x.product_id = il.product_id and x.on_sheet)
     -- Counted by lot only since after it shipped (0077: AMBI-JACK, Alpha …): nothing to fix, its stock came off the total.
     and not exists (select 1 from public.inventory_log lg where lg.branch_id = c.branch_id and upper(lg.sku) = upper(il.sku)
                       and lg.message like 'Now counted by lot%' and lg.at > c.completed_at)
   group by c.branch_id, c.id, c.order_no, c.company_name, c.closer;

  -- Open orders holding lot-counted stock with no lot picked.
  return query
  select 'open_no_lot', o.branch_id, o.id, o.order_no, null::bigint, null::bigint,
         'ORD-' || o.order_no || ' · ' || o.company_name || ': ' || trim_scale(sum(il.qty)) || ' ' || string_agg(distinct il.sku, ', ') || ' with no lot picked',
         'There wasn''t enough on any lot when it was ordered. Pick the lot with Change lot (Item variance) before it''s loaded.', public.branch_people(o.branch_id)
    from public.orders o join public.inventory_lines il on il.order_id = o.id and il.state = 'reserved' and il.lot_id is null
   where o.status in ('new', 'processing')
     and exists (select 1 from public.inventory_lots x where x.branch_id = o.branch_id and x.product_id = il.product_id and x.on_sheet)
   group by o.branch_id, o.id, o.order_no, o.company_name;

  -- Orders stuck at a step.
  return query
  select 'stuck', o.branch_id, o.id, o.order_no, null::bigint, null::bigint,
         'ORD-' || o.order_no || ' · ' || o.company_name || ': ' ||
           case o.stage when 'needs_po' then 'no Sales Order # yet' when 'invoice_update' then 'edited, invoice not updated'
                        when 'credit' then 'waiting on the credit check' when 'schedule' then 'released, no date set'
                        when 'customer' then 'customer hasn''t approved' else o.stage end
           || ' (' || (today - (o.created_at at time zone 'America/Chicago')::date) || ' days old)',
         case o.stage when 'needs_po' then 'Order desk: enter the Sales Order # and Invoice #.' when 'invoice_update' then 'Order desk: update the invoice in QuickBooks and enter it.'
                      when 'credit' then 'Accounting: release it or put it on hold.' when 'schedule' then 'Order desk: set the pickup / delivery date.'
                      when 'customer' then 'Follow up with the customer, or record their approval.' else '' end,
         case when o.stage = 'customer' and o.placed_by_role <> 'customer' then o.placed_by_name end
    from public.orders o
   where o.status in ('new', 'processing')
     and ((o.stage in ('needs_po', 'invoice_update', 'schedule') and o.created_at < now() - interval '2 days')
       or (o.stage = 'credit' and o.created_at < now() - interval '3 days')
       or (o.stage = 'customer' and o.created_at < now() - interval '5 days'));

  -- Item changes waiting for an admin.
  return query
  select 'change_waiting', o.branch_id, o.id, o.order_no, null::bigint, null::bigint,
         'ORD-' || o.order_no || ' · ' || o.company_name || ': a change is waiting for an admin',
         'Approve it on the order once the QuickBooks invoice has it.', null::text
    from public.orders o
   where exists (select 1 from public.order_edits e where e.order_id = o.id and e.admin_needed and e.admin_approved_at is null);

  -- Receiving reports waiting for approval.
  return query
  select 'receiving_waiting', d.branch_id, null::uuid, null::bigint, null::bigint, null::bigint,
         'Receiving report from ' || coalesce(d.vendor, 'a vendor') || ' (BOL ' || coalesce(d.bol_no, '-') || ') waiting for approval',
         'An admin approves it on Receiving so the stock goes in' || coalesce(' (received by ' || d.submitted_by_name || ')', '') || '.', null::text
    from public.inbound_deliveries d
   where d.status = 'submitted';
end $$;
revoke all on function public.data_check() from public, anon;
grant execute on function public.data_check() to authenticated;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('branch_people', 'data_check');
