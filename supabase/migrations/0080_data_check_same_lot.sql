-- =====================================================================
-- AMBIT Intelligence update 0080 - Data check; same lot typed two ways; Change lot can take promised drums
-- * Admin > Data check: everything that needs fixing across every location (lots below zero or promised to more
--   than they have, the same lot typed two ways, open orders past their date, shipped orders with no signed BOL or no
--   lot recorded, orders stuck at a step, receiving waiting), with who it's on and where to fix it.
-- * Receiving: a lot typed with spaces or dashes ("LW 8044", "AP9168-AB") goes onto the lot that's already there.
-- * Merge two rows of the same lot (Data check): the extra row's drums move onto the right one.
-- * Change lot: if the drums are on the lot but promised to another open order, this order takes them and the other
--   order is flagged to pick another lot (no more two orders blocking each other).
-- Run once in Supabase > SQL Editor, AFTER 0078. Safe to run again.
-- =====================================================================

-- A lot number without spaces, dashes or case: "LW 8044" = "LW8044", "AP9168-AB" = "AP9168AB".
create or replace function public.lot_key(p text) returns text
language sql immutable as $$ select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g') $$;

-- ---------- Change lot ----------
create or replace function public.inventory_repick(p_line bigint, p_lot bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l     public.inventory_lines;
  lot   public.inventory_lots;
  ok    boolean;
  avail numeric;
  held  numeric;
  co    uuid;
  n     bigint;
  note  text := '';
  who   text := coalesce(public.my_name(), 'AMBITION');
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  select * into l from public.inventory_lines where id = p_line for update;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  if l.state <> 'reserved' then
    raise exception 'This line is already %.', case l.state when 'done' then 'picked up' else 'cancelled' end;
  end if;
  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || l.branch_id));
  select * into lot from public.inventory_lots where id = p_lot;
  if lot.id is null or not lot.on_sheet or lot.branch_id <> l.branch_id then
    raise exception 'That lot isn''t on this location''s FOAM LOTS tab.';
  end if;
  select (lot.product_id = i.product_id or exists (select 1 from public.products p where p.id = lot.product_id and p.stock_of = i.product_id))
    into ok from public.order_items i where i.id = l.order_item_id;
  if not coalesce(ok, false) then raise exception 'That lot is a different product.'; end if;
  avail := lot.remaining - lot.sheet_pending
           - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = lot.id and r.state = 'reserved' and r.id <> l.id), 0);
  -- 0080: the drums have to be on the lot; if other open orders were promised them, this order takes them and those
  -- orders are told to pick another lot (they show on Admin > Data check).
  if lot.remaining - lot.sheet_pending < l.qty then
    raise exception 'Lot % only has % on FOAM LOTS. Pick a lot with at least %.',
      coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(lot.remaining - lot.sheet_pending, 0)), trim_scale(l.qty);
  end if;
  if avail < l.qty then
    note := note || ' Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' is now promised to more than it has: '
         || coalesce((select string_agg(distinct 'ORD-' || o2.order_no, ', ') from public.inventory_lines r join public.orders o2 on o2.id = r.order_id
                       where r.lot_id = lot.id and r.state = 'reserved' and r.id <> l.id), 'another order')
         || ' needs another lot.';
  end if;
  -- Held for another customer (0071): admins can use it anyway; it's logged.
  select company_id into co from public.orders where id = l.order_id;
  held := public.inventory_lot_held(lot.id, co);
  if held > 0 and avail - held < l.qty then
    if not public.is_admin() then
      raise exception 'Lot % is held for %. Pick another lot, or ask an admin.',
        coalesce(nullif(lot.lot_no, ''), '(no lot #)'), public.inventory_lot_hold_text(lot.id, co);
    end if;
    note := note || ' Used drums held for ' || public.inventory_lot_hold_text(lot.id, co) || '.';
  end if;
  update public.inventory_lines
     set lot_id = lot.id, lot_no = nullif(lot.lot_no, ''), product_id = lot.product_id,
         prev_sku = case when upper(sku) <> upper(lot.sku) then coalesce(prev_sku, sku) else prev_sku end,
         sku = lot.sku, needs_write = true, updated_at = now()
   where id = l.id;
  select order_no into n from public.orders where id = l.order_id;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (l.branch_id, 'order', lot.sku,
          'ORD-' || n || ': ' || trim_scale(l.qty) || ' moved to lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)')
            || coalesce(' (was ' || coalesce(l.lot_no, 'no lot') || case when upper(l.sku) <> upper(lot.sku) then ', ' || l.sku else '' end || ')', '') || '.' || note,
          who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = l.branch_id;
  return coalesce(nullif(lot.lot_no, ''), '(no lot #)') || note;
end $$;

create or replace function public.order_variance_lot(p_line bigint, p_lot bigint, p_reason text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_lines;
  lot public.inventory_lots;
  o   public.orders;
  res text;
begin
  if not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;
  select * into l from public.inventory_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  res := public.inventory_repick(p_line, p_lot);
  select * into lot from public.inventory_lots where id = p_lot;
  select * into o from public.orders where id = l.order_id;
  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, l.order_item_id, 'lot',
          trim_scale(l.qty) || ' × ' || l.sku || ' · ' || case when l.lot_id is null then 'no lot picked' else 'Lot ' || coalesce(l.lot_no, '(no lot #)') end,
          trim_scale(l.qty) || ' × ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)'),
          nullif(left(trim(coalesce(p_reason, '')), 500), ''), o.stage, auth.uid(), coalesce(public.my_name(), 'AMBITION'));
  return res;
end $$;

-- ---------- Receiving: the same lot typed another way goes onto the lot that's there ----------
create or replace function public.inventory_lots_same_lot() returns trigger
language plpgsql security definer set search_path = public as $$
declare ex public.inventory_lots;
begin
  if not coalesce(new.add_to_sheet, false) then return new; end if;   -- rows typed on FOAM LOTS stay as they are
  new.lot_no := upper(regexp_replace(trim(coalesce(new.lot_no, '')), '\s+', '', 'g'));
  if new.lot_no = '' then return new; end if;
  select * into ex from public.inventory_lots x
   where x.branch_id = new.branch_id and x.product_id = new.product_id and x.on_sheet and public.lot_key(x.lot_no) = public.lot_key(new.lot_no)
   order by x.id limit 1;
  if ex.id is null then return new; end if;
  update public.inventory_lots set in_unsynced = in_unsynced + new.starting, updated_at = now() where id = ex.id;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (new.branch_id, 'received', new.sku, 'Lot ' || new.lot_no || ' is lot ' || ex.lot_no || ' (typed another way): ' || trim_scale(new.starting)
          || ' added to it (Shipped In on FOAM LOTS).', coalesce(public.my_name(), 'AMBIT A.I.'));
  return null;
end $$;
drop trigger if exists inventory_lots_same_lot on public.inventory_lots;
create trigger inventory_lots_same_lot before insert on public.inventory_lots for each row execute function public.inventory_lots_same_lot();

-- ---------- Merge two rows of the same lot ----------
-- The extra row's drums go onto the kept row (Shipped In there, Adj off the extra), and open orders and holds on the
-- extra row move too. What already shipped stays on the extra row's history. Delete the extra row from FOAM LOTS after.
create or replace function public.inventory_lot_merge(p_keep bigint, p_extra bigint) returns text
language plpgsql security definer set search_path = public as $$
declare k public.inventory_lots; x public.inventory_lots; q numeric; who text := coalesce(public.my_name(), 'Admin');
begin
  if not public.is_admin() then raise exception 'Only an admin can merge lots.'; end if;
  select * into k from public.inventory_lots where id = p_keep for update;
  select * into x from public.inventory_lots where id = p_extra for update;
  if k.id is null or x.id is null or k.id = x.id then raise exception 'Pick two different lots.'; end if;
  if k.branch_id <> x.branch_id or k.product_id <> x.product_id then raise exception 'Those lots are different products or locations.'; end if;
  q := x.remaining + x.in_unsynced + x.adj_unsynced;
  if q > 0 then update public.inventory_lots set in_unsynced = in_unsynced + q, updated_at = now() where id = k.id;
  elsif q < 0 then update public.inventory_lots set adj_unsynced = adj_unsynced + q, updated_at = now() where id = k.id;
  end if;
  if q <> 0 then update public.inventory_lots set adj_unsynced = adj_unsynced - q, updated_at = now() where id = x.id; end if;
  update public.inventory_lines set lot_id = k.id, lot_no = nullif(k.lot_no, ''), needs_write = true, updated_at = now()
   where lot_id = x.id and state = 'reserved';
  update public.inventory_holds set lot_id = k.id where lot_id = x.id and released_at is null;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (k.branch_id, 'adjust', k.sku, 'Lot ' || x.lot_no || ' merged into lot ' || k.lot_no || ' (the same lot typed two ways): ' || trim_scale(q)
          || ' moved. Delete the ' || x.lot_no || ' row from FOAM LOTS.', who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = k.branch_id;
  return k.lot_no;
end $$;
revoke all on function public.inventory_lot_merge(bigint, bigint) from public, anon;
grant execute on function public.inventory_lot_merge(bigint, bigint) to authenticated;

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
         null::text
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
         null::text
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
         (select string_agg(p.full_name, ', ') from public.profiles p where p.role = 'employee' and p.job_role = 'warehouse' and p.status = 'active' and not coalesce(p.demo, false) and p.branch_id = o.branch_id)
    from public.orders o
   where o.status in ('new', 'processing') and o.scheduled_for < today and o.delivery_method <> 'dropship';

  -- Shipped orders: no signed BOL, or drums with no lot recorded (last 90 days).
  return query
  with c as (select o.*, (select lg.by_name from public.inventory_log lg where lg.branch_id = o.branch_id and lg.message like 'ORD-' || o.order_no || ' picked up / delivered%' order by lg.id desc limit 1) as closer
               from public.orders o where o.status = 'completed' and o.completed_at > now() - interval '90 days' and o.delivery_method <> 'dropship')
  select 'shipped_no_bol', c.branch_id, c.id, c.order_no, null::bigint, null::bigint,
         'ORD-' || c.order_no || ' · ' || c.company_name || ' went out ' || to_char(c.completed_at at time zone 'America/Chicago', 'Mon DD') || ' with no signed BOL',
         'Add a photo or scan of the signed BOL (or the signed packing slip) to the order.', c.closer
    from c where not exists (select 1 from public.order_files f where f.order_id = c.id and f.kind = 'bol')
  union all
  select 'shipped_no_lot', c.branch_id, c.id, c.order_no, null::bigint, null::bigint,
         'ORD-' || c.order_no || ' · ' || c.company_name || ': ' || trim_scale(sum(il.qty)) || ' ' || string_agg(distinct il.sku, ', ') || ' went out with no lot recorded',
         'Use Fix what went out on the order to put each drum on the lot the packing slip shows.', c.closer
    from c join public.inventory_lines il on il.order_id = c.id and il.state = 'done' and il.lot_id is null
   where exists (select 1 from public.inventory_lots x where x.branch_id = c.branch_id and x.product_id = il.product_id and x.on_sheet)
   group by c.branch_id, c.id, c.order_no, c.company_name, c.closer;

  -- Open orders holding lot-counted stock with no lot picked.
  return query
  select 'open_no_lot', o.branch_id, o.id, o.order_no, null::bigint, null::bigint,
         'ORD-' || o.order_no || ' · ' || o.company_name || ': ' || trim_scale(sum(il.qty)) || ' ' || string_agg(distinct il.sku, ', ') || ' with no lot picked',
         'There wasn''t enough on any lot when it was ordered. Pick the lot with Change lot (Item variance) before it''s loaded.', null::text
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
revoke all on function public.inventory_lots_same_lot() from public, anon, authenticated;

-- Check: should say 4
select count(*) as "Ready (should be 4)" from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('lot_key', 'inventory_lots_same_lot', 'inventory_lot_merge', 'data_check');
