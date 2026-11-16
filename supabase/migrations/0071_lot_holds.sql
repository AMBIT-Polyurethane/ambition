-- =====================================================================
-- AMBIT Intelligence update 0071 - Hold a lot for a customer
-- * Admins and the order desk (CRMs) can set drums of a lot aside for one customer, for example lot LW7911 at
--   Jacksonville for ProSeal: how many (all that's left unless you say), until when (30 days unless you say), and a note.
-- * While it's held, the app doesn't give those drums to anyone else, and other customers see less available.
--   The customer's own orders (and their locations') take the held drums first, on their own.
-- * It ends when the customer's orders have used it, when someone releases it, or on its date. Whoever placed it is
--   emailed 3 days before it runs out. The FOAM LOTS Notes cell shows it ("[HELD: ProSeal 6 until 12/16]").
-- * Picking a held lot for someone else by hand: an admin can (it's logged); others are told it's held.
--   At pickup, whoever closes the order can still record what really went on the truck (it's logged and flagged).
-- Run once in Supabase > SQL Editor, AFTER 0070. Safe to run again.
-- =====================================================================

create table if not exists public.inventory_holds (
  id               bigint generated always as identity primary key,
  lot_id           bigint not null references public.inventory_lots(id) on delete cascade,
  branch_id        text not null,
  company_id       uuid not null references public.companies(id) on delete cascade,
  company_name     text not null,
  qty              numeric(12,2) not null check (qty > 0),
  until            date not null,
  note             text,
  by_id            uuid,
  by_name          text,
  created_at       timestamptz not null default now(),
  released_at      timestamptz,
  released_by_name text,
  release_note     text,
  reminded_at      timestamptz
);
create index if not exists inventory_holds_lot_idx on public.inventory_holds(lot_id) where released_at is null;
create index if not exists inventory_holds_company_idx on public.inventory_holds(company_id);
create index if not exists inventory_holds_branch_idx on public.inventory_holds(branch_id, until);
alter table public.inventory_holds enable row level security;
drop policy if exists inventory_holds_read on public.inventory_holds;
create policy inventory_holds_read on public.inventory_holds for select to authenticated using (public.is_employee());
grant select on public.inventory_holds to authenticated;
grant all on public.inventory_holds to service_role;

-- When each order line was made: a hold only counts the customer's lines made after it was placed.
alter table public.inventory_lines add column if not exists created_at timestamptz not null default now();

-- ---------- How much of a hold is still set aside ----------
-- What was held, less what the customer's orders (or their locations' orders) have taken from that lot since.
-- A cancelled or edited-away line gives its drums back to the hold on its own.
create or replace function public.inventory_hold_left(h public.inventory_holds)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when h.released_at is not null or h.until < (now() at time zone 'America/Chicago')::date then 0
    else greatest(0, h.qty - coalesce((
      select sum(l.qty)
        from public.inventory_lines l
        join public.orders o on o.id = l.order_id
        left join public.companies c on c.id = o.company_id
       where l.lot_id = h.lot_id and l.state in ('reserved', 'done') and l.created_at >= h.created_at
         and (o.company_id = h.company_id or c.credit_parent_id = h.company_id)), 0))
  end
$$;

-- Is this hold for this customer (or the customer's main account)?
create or replace function public.inventory_hold_mine(h public.inventory_holds, p_company uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_company is not null and (h.company_id = p_company
         or h.company_id = (select c.credit_parent_id from public.companies c where c.id = p_company)), false)
$$;

-- Drums of a lot held for other customers (p_company null: held for anyone).
create or replace function public.inventory_lot_held(p_lot bigint, p_company uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.inventory_hold_left(h)), 0)
    from public.inventory_holds h
   where h.lot_id = p_lot and h.released_at is null and h.until >= (now() at time zone 'America/Chicago')::date
     and not public.inventory_hold_mine(h, p_company)
$$;

-- Drums of a lot still held for this customer.
create or replace function public.inventory_lot_mine(p_lot bigint, p_company uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.inventory_hold_left(h)), 0)
    from public.inventory_holds h
   where h.lot_id = p_lot and h.released_at is null and h.until >= (now() at time zone 'America/Chicago')::date
     and public.inventory_hold_mine(h, p_company)
$$;

-- "ProSeal 6 until 12/16; …" for a lot (other customers' holds only when p_company is given).
create or replace function public.inventory_lot_hold_text(p_lot bigint, p_company uuid default null)
returns text
language sql stable security definer set search_path = public as $$
  select string_agg(h.company_name || ' ' || trim_scale(public.inventory_hold_left(h)) || ' until '
                    || to_char(h.until, 'FMMM/FMDD'), '; ' order by h.until, h.id)
    from public.inventory_holds h
   where h.lot_id = p_lot and h.released_at is null and h.until >= (now() at time zone 'America/Chicago')::date
     and public.inventory_hold_left(h) > 0
     and (p_company is null or not public.inventory_hold_mine(h, p_company))
$$;

-- ---------- The active holds at a location (staff screens, and the spreadsheet sync) ----------
drop function if exists public.inventory_holds_at(text);
create function public.inventory_holds_at(p_branch text)
returns table (id bigint, lot_id bigint, branch_id text, sku text, lot_no text, company_id uuid, company_name text, qty numeric, held_left numeric,
               until date, note text, by_name text, by_id uuid, created_at timestamptz, lot_remaining numeric)
language sql stable security definer set search_path = public as $$
  select h.id, h.lot_id, h.branch_id, x.sku, nullif(x.lot_no, ''), h.company_id, h.company_name, h.qty, public.inventory_hold_left(h),
         h.until, h.note, h.by_name, h.by_id, h.created_at, x.remaining
    from public.inventory_holds h
    join public.inventory_lots x on x.id = h.lot_id
   where (p_branch is null or h.branch_id = p_branch)
     and h.released_at is null and h.until >= (now() at time zone 'America/Chicago')::date
     and (public.is_employee() or coalesce(auth.role(), '') = 'service_role')
   order by h.until, h.id
$$;

-- ---------- Place a hold ----------
create or replace function public.inventory_hold_place(p_lot bigint, p_company uuid, p_qty numeric, p_until date, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  lot   public.inventory_lots;
  co    public.companies;
  free  numeric;
  today date := (now() at time zone 'America/Chicago')::date;
  who   text := coalesce(public.my_name(), 'AMBIT');
  hid   bigint;
  q     numeric := round(coalesce(p_qty, 0), 2);
begin
  if not (public.is_admin() or (public.is_employee() and public.has_perm('order_desk'))) then
    raise exception 'Only admins and the order desk can hold material for a customer.';
  end if;
  select * into lot from public.inventory_lots where id = p_lot;
  if lot.id is null or not lot.on_sheet then raise exception 'That lot isn''t on the location''s FOAM LOTS tab.'; end if;
  select * into co from public.companies where id = p_company;
  if co.id is null then raise exception 'Pick the customer.'; end if;
  if q <= 0 then raise exception 'Say how many to hold.'; end if;
  if p_until is null or p_until < today then raise exception 'Pick a date from today on.'; end if;
  if p_until > today + 180 then raise exception 'A hold can last up to 6 months.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || lot.branch_id));
  -- What isn't on an order or already held for someone else.
  free := lot.remaining - lot.sheet_pending
          - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = lot.id and r.state = 'reserved'), 0)
          - public.inventory_lot_held(lot.id, null);
  if q > free then
    raise exception 'Lot % only has % not on an order or held%.', coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(free, 0)),
      coalesce(' (' || public.inventory_lot_hold_text(lot.id) || ')', '');
  end if;
  insert into public.inventory_holds (lot_id, branch_id, company_id, company_name, qty, until, note, by_id, by_name)
  values (lot.id, lot.branch_id, co.id, co.name, q, p_until, nullif(left(trim(coalesce(p_note, '')), 300), ''), auth.uid(), who)
  returning id into hid;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (lot.branch_id, 'hold', lot.sku,
          'Held ' || trim_scale(q) || ' of lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' for ' || co.name || ' until '
            || to_char(p_until, 'FMMM/FMDD/YYYY') || coalesce(' (' || nullif(trim(coalesce(p_note, '')), '') || ')', '') || '.', who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = lot.branch_id;
  return hid;
end $$;

-- ---------- Release a hold (or change its date) ----------
create or replace function public.inventory_hold_release(p_hold bigint, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  h   public.inventory_holds;
  lot public.inventory_lots;
  who text := coalesce(public.my_name(), 'AMBIT');
begin
  if not (public.is_admin() or (public.is_employee() and public.has_perm('order_desk'))) then
    raise exception 'Only admins and the order desk can release a hold.';
  end if;
  select * into h from public.inventory_holds where id = p_hold for update;
  if h.id is null or h.released_at is not null then raise exception 'That hold was already released.'; end if;
  update public.inventory_holds set released_at = now(), released_by_name = who, release_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = h.id;
  select * into lot from public.inventory_lots where id = h.lot_id;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (h.branch_id, 'hold', lot.sku,
          'Released the hold on lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' for ' || h.company_name
            || coalesce(' (' || nullif(trim(coalesce(p_note, '')), '') || ')', '') || '.', who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = h.branch_id;
end $$;

create or replace function public.inventory_hold_extend(p_hold bigint, p_until date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  h     public.inventory_holds;
  lot   public.inventory_lots;
  today date := (now() at time zone 'America/Chicago')::date;
  who   text := coalesce(public.my_name(), 'AMBIT');
begin
  if not (public.is_admin() or (public.is_employee() and public.has_perm('order_desk'))) then
    raise exception 'Only admins and the order desk can change a hold.';
  end if;
  select * into h from public.inventory_holds where id = p_hold for update;
  if h.id is null or h.released_at is not null then raise exception 'That hold was already released.'; end if;
  if p_until is null or p_until < today then raise exception 'Pick a date from today on.'; end if;
  if p_until > today + 180 then raise exception 'A hold can last up to 6 months.'; end if;
  update public.inventory_holds set until = p_until, reminded_at = null where id = h.id;
  select * into lot from public.inventory_lots where id = h.lot_id;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (h.branch_id, 'hold', lot.sku,
          'Hold on lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)') || ' for ' || h.company_name || ' now runs until '
            || to_char(p_until, 'FMMM/FMDD/YYYY') || ' (was ' || to_char(h.until, 'FMMM/FMDD') || ').', who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = h.branch_id;
end $$;

-- ---------- Picking: held drums are skipped for everyone else, and go first for the customer ----------
create or replace function public.inventory_pick(p_item bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  it    public.order_items;
  o     record;
  cand  uuid[];
  need  numeric;
  take  numeric;
  lot   record;
  first record;
  today date := (now() at time zone 'America/Chicago')::date;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null or it.product_id is null then return; end if;
  select id, branch_id, delivery_method, status, company_id into o from public.orders where id = it.order_id;
  if o.branch_id is null or o.delivery_method = 'dropship' or o.status = 'cancelled' then return; end if;
  -- A completed order only holds stock while an admin corrects it (order_edit turns it into stock taken).
  if o.status = 'completed' and coalesce(current_setting('ambit.pick_closed', true), '') <> 'on' then return; end if;
  if not exists (select 1 from public.inventory_sheets x where x.branch_id = o.branch_id and x.enabled) then return; end if;
  if exists (select 1 from public.inventory_lines
              where order_item_id = p_item and not (state = 'cancelled' and done_by in ('swap', 'edit'))) then return; end if;

  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || o.branch_id));

  select array_agg(p.id) into cand from public.products p where p.stock_of = it.product_id;
  if cand is null then cand := array[it.product_id]; end if;

  if exists (select 1 from public.inventory_lots l where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet) then
    need := it.qty;
    for lot in
      select l.id, l.product_id, l.sku, l.lot_no,
             l.remaining - l.sheet_pending
               - coalesce((select sum(x.qty) from public.inventory_lines x where x.lot_id = l.id and x.state = 'reserved'), 0)
               - public.inventory_lot_held(l.id, o.company_id) as avail
        from public.inventory_lots l
        join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
         and (l.use_by is null or l.use_by >= today)
       order by (public.inventory_lot_mine(l.id, o.company_id) > 0) desc,
                p.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
    loop
      exit when need <= 0;
      continue when lot.avail <= 0;
      take := least(need, lot.avail);
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty, lot_id, lot_no)
      values (it.id, it.order_id, o.branch_id, lot.product_id, lot.sku, take, lot.id, nullif(lot.lot_no, ''));
      need := need - take;
    end loop;
    if need > 0 then
      select l.product_id, l.sku into first
        from public.inventory_lots l join public.products p on p.id = l.product_id
       where l.branch_id = o.branch_id and l.product_id = any(cand) and l.on_sheet
       order by p.pick_rank, l.use_by nulls last, l.id
       limit 1;
      insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
      values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, need);
    end if;
  else
    select i.product_id, i.sku into first
      from public.inventory i join public.products p on p.id = i.product_id
     where i.branch_id = o.branch_id and i.product_id = any(cand) and i.on_sheet
     order by p.pick_rank, i.on_hand desc nulls last
     limit 1;
    if first.product_id is null then return; end if;
    insert into public.inventory_lines (order_item_id, order_id, branch_id, product_id, sku, qty)
    values (it.id, it.order_id, o.branch_id, first.product_id, first.sku, it.qty);
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = o.branch_id;
end $$;
revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;

-- ---------- Changing a line's lot by hand (item variance) onto drums held for someone else ----------
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
  if avail < l.qty then
    raise exception 'Lot % only has % available. Pick a lot with at least %.',
      coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(avail, 0)), trim_scale(l.qty);
  end if;
  -- Held for another customer (0071): admins can use it anyway; it's logged.
  select company_id into co from public.orders where id = l.order_id;
  held := public.inventory_lot_held(lot.id, co);
  if held > 0 and avail - held < l.qty then
    if not public.is_admin() then
      raise exception 'Lot % is held for %. Pick another lot, or ask an admin.',
        coalesce(nullif(lot.lot_no, ''), '(no lot #)'), public.inventory_lot_hold_text(lot.id, co);
    end if;
    note := ' Used drums held for ' || public.inventory_lot_hold_text(lot.id, co) || '.';
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
  return coalesce(nullif(lot.lot_no, ''), '(no lot #)');
end $$;

-- ---------- 0069's lot change (at pickup, after pickup, item variance): same rule ----------
-- Before pickup, only an admin can put a line on drums held for someone else. At pickup, whoever closes the order
-- records what really went on the truck (it's flagged on the item variance table). After pickup, admins only.
create or replace function public.order_line_relot(p_line bigint, p_lot bigint, p_reason text, p_at_pickup boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare
  l     public.inventory_lines;
  o     public.orders;
  it    public.order_items;
  lot   public.inventory_lots;
  cur   public.products;
  np    public.products;
  base  uuid;
  avail numeric;
  held  numeric;
  flag  text;
  who   text := coalesce(public.my_name(), 'AMBIT');
  tag   text;
  from_t text;
  to_t  text;
  kind  text;
  why   text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  select * into l from public.inventory_lines where id = p_line for update;
  if l.id is null then raise exception 'That line isn''t on the order any more.'; end if;
  select * into o from public.orders where id = l.order_id for update;
  select * into it from public.order_items where id = l.order_item_id for update;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if l.state = 'cancelled' then raise exception 'That line was released, so there''s nothing to change.'; end if;

  if l.state = 'done' then
    if not public.is_admin() then raise exception 'Only an admin can change what was loaded after pickup.'; end if;
    if why is null then raise exception 'Say why it''s changing, for example "Packing slip shows Wanhua lot 2604P0345".'; end if;
  elsif p_at_pickup then
    if not (public.has_perm('order_desk') or public.has_perm('inventory') or public.has_perm('item_variance')) then
      raise exception 'You don''t have access to close orders.';
    end if;
  elsif not public.has_perm('item_variance') then
    raise exception 'Only admins (or people with the Item variance box) can change lots.';
  end if;

  if l.lot_id is not distinct from p_lot then return coalesce(l.lot_no, ''); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_pick:' || l.branch_id));
  select * into lot from public.inventory_lots where id = p_lot;
  if lot.id is null or not lot.on_sheet or lot.branch_id <> l.branch_id then
    raise exception 'That lot isn''t on this location''s FOAM LOTS tab.';
  end if;

  select * into cur from public.products where id = it.product_id;
  select * into np from public.products where id = lot.product_id;
  if not (np.id = cur.id or np.stock_of = cur.id
          or (np.category_id is not distinct from cur.category_id and lower(np.unit) = lower(it.unit)
              and public.product_is_a_side(np) = public.product_is_a_side(cur))) then
    raise exception 'That lot is % (%), which can''t take the place of %.', np.name, np.sku, cur.name;
  end if;
  base := case when np.id = cur.id or np.stock_of = cur.id then cur.id else coalesce(np.stock_of, np.id) end;

  if l.state = 'done' then
    avail := lot.remaining;
  else
    avail := lot.remaining - lot.sheet_pending
             - coalesce((select sum(r.qty) from public.inventory_lines r where r.lot_id = lot.id and r.state = 'reserved' and r.id <> l.id), 0);
  end if;
  if avail < l.qty then
    raise exception 'Lot % shows only % on FOAM LOTS, so % can''t have come from it. Check the lot number.',
      coalesce(nullif(lot.lot_no, ''), '(no lot #)'), trim_scale(greatest(avail, 0)), trim_scale(l.qty);
  end if;

  -- Held for another customer (0071)
  held := public.inventory_lot_held(lot.id, o.company_id);
  if held > 0 and avail - held < l.qty then
    if l.state <> 'done' and not p_at_pickup and not public.is_admin() then
      raise exception 'Lot % is held for %. Pick another lot, or ask an admin.',
        coalesce(nullif(lot.lot_no, ''), '(no lot #)'), public.inventory_lot_hold_text(lot.id, o.company_id);
    end if;
    flag := 'used drums held for ' || public.inventory_lot_hold_text(lot.id, o.company_id);
  end if;

  from_t := trim_scale(l.qty) || ' × ' || l.sku || ' · ' || case when l.lot_id is null then 'no lot picked' else 'Lot ' || coalesce(l.lot_no, '(no lot #)') end;
  to_t := trim_scale(l.qty) || ' × ' || lot.sku || ' · Lot ' || coalesce(nullif(lot.lot_no, ''), '(no lot #)');
  tag := 'ORD-' || o.order_no || case when l.state = 'done' then ' corrected after ' || case when o.delivery_method = 'pickup' then 'pickup' else 'delivery' end
                                     else ' at ' || case when o.delivery_method = 'pickup' then 'pickup' else 'loading' end end || ': ';

  if l.state = 'done' and l.stock_taken then
    perform public.inventory_line_stock(l.id, 1, 'order', tag, who);
  end if;
  update public.inventory_lines
     set lot_id = lot.id, lot_no = nullif(lot.lot_no, ''), product_id = lot.product_id,
         prev_sku = case when upper(sku) <> upper(lot.sku) then coalesce(prev_sku, sku) else prev_sku end,
         sku = lot.sku, needs_write = true, updated_at = now()
   where id = l.id;
  if l.state = 'done' and l.stock_taken then
    perform public.inventory_line_stock(l.id, -1, 'order', tag, who);
  end if;

  kind := 'lot';
  if base <> cur.id then
    kind := 'type';
    if not exists (select 1 from public.inventory_lines r join public.products rp on rp.id = r.product_id
                    where r.order_item_id = it.id and r.state <> 'cancelled' and coalesce(rp.stock_of, rp.id) <> base and rp.id <> base) then
      select * into np from public.products where id = base;
      update public.order_items
         set ordered_product_id = case when it.ordered_sku is null then it.product_id else ordered_product_id end,
             ordered_sku  = coalesce(ordered_sku, it.sku),
             ordered_name = coalesce(ordered_name, it.name),
             product_id = np.id, sku = np.sku, name = np.name
       where id = it.id;
      update public.order_items set ordered_product_id = null, ordered_sku = null, ordered_name = null
       where id = it.id and upper(ordered_sku) = upper(sku);
    end if;
  end if;

  insert into public.order_variances (order_id, order_item_id, kind, from_text, to_text, reason, stage, by_id, by_name)
  values (o.id, it.id, kind, from_t, to_t,
          concat_ws(' · ', coalesce(why, case when p_at_pickup then 'Loaded at ' || case when o.delivery_method = 'pickup' then 'pickup' else 'shipping' end end),
                    case when flag is not null then initcap(left(flag, 1)) || substr(flag, 2) end),
          case when l.state = 'done' then 'after_pickup' when p_at_pickup then 'at_pickup' else o.stage end, auth.uid(), who);
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (l.branch_id, 'order', lot.sku, tag || from_t || ' → ' || to_t || coalesce(' (' || why || ')', '') || '.'
                                         || coalesce(' Note: ' || flag || '.', ''), who);
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = l.branch_id;
  return coalesce(nullif(lot.lot_no, ''), '(no lot #)');
end $$;

-- ---------- Lot pickers show what's held for someone else ----------
drop function if exists public.inventory_lot_choices_any(bigint);
create function public.inventory_lot_choices_any(p_line bigint)
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
          where p.active and (
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

drop function if exists public.inventory_lot_choices_for(text, uuid[]);
drop function if exists public.inventory_lot_choices_for(text, uuid[], uuid);
create function public.inventory_lot_choices_for(p_branch text, p_products uuid[], p_company uuid default null)
returns table (for_product uuid, lot_id bigint, product_id uuid, sku text, name text, lot_no text, exp date, use_by date,
               remaining numeric, available numeric, expired boolean, same_type boolean, held_for text)
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
         coalesce(l.product_id = w.id or l.stock_of = w.id, false),
         public.inventory_lot_hold_text(l.id, p_company)
    from public.products w
    join lots l
      on l.product_id = w.id or l.stock_of = w.id
      or (l.category_id is not distinct from w.category_id and l.unit = lower(w.unit) and l.a_side = public.product_is_a_side(w))
   where w.id = any(p_products) and public.is_employee()
   order by w.id, coalesce(l.product_id = w.id or l.stock_of = w.id, false) desc, l.pick_rank, l.use_by nulls last, l.mfg nulls last, upper(l.lot_no), l.id
$$;

-- ---------- What customers and staff see as available: less what's held for other customers ----------
create or replace function public.stock_for(p_branch text)
returns table (product_id uuid, on_hand numeric, pending numeric, net numeric, reorder_point numeric, label text)
language sql stable security definer set search_path = public as $$
  with r as (
    select l.product_id, sum(l.qty) as q
      from public.inventory_lines l
     where l.branch_id = p_branch and l.state = 'reserved'
     group by l.product_id
  ), hd as (
    select x.product_id, sum(public.inventory_hold_left(h)) as q
      from public.inventory_holds h
      join public.inventory_lots x on x.id = h.lot_id
     where h.branch_id = p_branch and h.released_at is null and h.until >= (now() at time zone 'America/Chicago')::date
       and not public.inventory_hold_mine(h, public.my_company_id())
     group by x.product_id
  ), v0 as (
    select i.product_id, i.on_hand, i.reorder_point,
           i.sheet_pending + coalesce(r.q, 0) as pending,
           i.on_hand - i.sheet_pending - coalesce(r.q, 0) - coalesce(hd.q, 0) as net
      from public.inventory i
      left join r on r.product_id = i.product_id
      left join hd on hd.product_id = i.product_id
     where i.branch_id = p_branch and i.on_sheet
       and exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled)
  ), g as (
    select p.stock_of as product_id, sum(v0.on_hand) as on_hand, sum(v0.reorder_point) as reorder_point,
           sum(v0.pending) as pending, sum(v0.net) as net
      from v0 join public.products p on p.id = v0.product_id
     where p.stock_of is not null
     group by p.stock_of
  ), v as (
    select v0.product_id, v0.on_hand, v0.reorder_point, v0.pending, v0.net from v0
    union all
    select g.product_id, g.on_hand, g.reorder_point, g.pending, g.net from g
     where not exists (select 1 from v0 where v0.product_id = g.product_id)
  )
  select v.product_id,
         case when public.is_employee() then v.on_hand end,
         case when public.is_employee() then v.pending end,
         case when public.is_employee() then v.net end,
         case when public.is_employee() then v.reorder_point end,
         case when v.on_hand is null then null
              when v.net <= 0 then 'out'
              when v.net <= coalesce(v.reorder_point, 0) then 'low'
              else 'in' end
    from v
   where public.is_active()
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'inventory_hold_left(public.inventory_holds)', 'inventory_hold_mine(public.inventory_holds, uuid)',
    'inventory_lot_held(bigint, uuid)', 'inventory_lot_mine(bigint, uuid)', 'inventory_lot_hold_text(bigint, uuid)',
    'inventory_holds_at(text)', 'inventory_hold_place(bigint, uuid, numeric, date, text)', 'inventory_hold_release(bigint, text)',
    'inventory_hold_extend(bigint, date)', 'inventory_lot_choices_any(bigint)', 'inventory_lot_choices_for(text, uuid[], uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  grant execute on function public.inventory_holds_at(text) to service_role;
end $$;

-- Check: should say 9
select count(*) as "Ready (should be 9)" from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('inventory_hold_left', 'inventory_hold_mine', 'inventory_lot_held', 'inventory_lot_mine', 'inventory_lot_hold_text',
                   'inventory_holds_at', 'inventory_hold_place', 'inventory_hold_release', 'inventory_hold_extend');
