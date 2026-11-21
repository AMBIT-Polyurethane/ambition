-- 0104: gun parts come from Contractors Foam Supply (CFS), drop shipped.
--  * Every gun part gets CFS's price to AMBIT (vendor_cost) and the ADC price = CFS price + 18%, rounded up to .99.
--    Parts on CFS's Fusion FX, Fusion PC and Carlisle ST1 price lists that weren't in the catalog are added
--    (the 20 CFS hasn't priced show "price to confirm").
--  * Gun parts (drop_ship_partner = 'cfs') never come out of AMBIT's stock. When an order with gun parts is released at
--    the credit check, those lines go to CFS as an order "from AMBIT" on CFS's order desk; CFS ships to the customer
--    and bills AMBIT for the parts and the shipping (the shipping they charge is saved on that order).
--  * CFS's store: the items taken off ADC are switched off there too, the new gun parts are added switched off (for
--    CFS to price), and the owner can set shipping on their desk (flat per order, free over an amount, ship-from ZIP).
-- Safe to run again.

-- ---------------------------------------------------------------- columns
alter table public.products add column if not exists vendor_cost numeric(12,2);
alter table public.products add column if not exists drop_ship_partner text references public.partners(id) on delete set null;

alter table public.partners add column if not exists ship_flat numeric(12,2);
alter table public.partners add column if not exists ship_free_over numeric(12,2);
alter table public.partners add column if not exists ship_zip text;
alter table public.partners add column if not exists ship_note text;
alter table public.partners drop constraint if exists partners_ship_check;
alter table public.partners add constraint partners_ship_check check ((ship_flat is null or ship_flat >= 0) and (ship_free_over is null or ship_free_over >= 0));
grant update (ship_flat, ship_free_over, ship_zip, ship_note) on public.partners to authenticated;

alter table public.partner_orders add column if not exists source text not null default 'store';
alter table public.partner_orders drop constraint if exists partner_orders_source_check;
alter table public.partner_orders add constraint partner_orders_source_check check (source in ('store', 'ambit'));
alter table public.partner_orders add column if not exists ambit_order_id uuid references public.orders(id) on delete set null;
alter table public.partner_orders add column if not exists ambit_ref text;
alter table public.partner_orders add column if not exists ship_to text;
alter table public.partner_orders add column if not exists ship_cost numeric(12,2);
create unique index if not exists partner_orders_ambit_once on public.partner_orders (partner_id, ambit_order_id) where ambit_order_id is not null;

-- ---------------------------------------------------------------- picking skips drop-ship parts
create or replace function public.inventory_pick(p_item bigint)
returns void
language plpgsql security definer set search_path = public as $fn$
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
  -- Gun parts are drop shipped by the vendor (0104): they never come out of AMBIT's stock.
  if exists (select 1 from public.products p where p.id = it.product_id and p.drop_ship_partner is not null) then return; end if;
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
end $fn$;

revoke all on function public.inventory_pick(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- partner store orders carry the owner's shipping
create or replace function public.partner_place_order(p_partner text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_quote boolean := false;
  v_id bigint;
  v_cust uuid := public.my_partner_customer();
  v_short text;
  r record;
  q numeric;
  em text := lower(trim(coalesce(p->>'email', '')));
  v_flat numeric;
  v_free numeric;
  v_ship numeric;
begin
  select short into v_short from public.partners where id = p_partner and active;
  if v_short is null then raise exception 'This store is not open.'; end if;
  if v_cust is not null and not exists (select 1 from public.partner_customers where id = v_cust and partner_id = p_partner) then v_cust := null; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please add your name.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please add a good email address.'; end if;
  if v_cust is null and length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) < 10 then raise exception 'Please add a phone number.'; end if;
  if coalesce(p->>'delivery', 'ship') = 'ship' and length(trim(coalesce(p#>>'{address,street}', ''))) < 3 then raise exception 'Please add the address to ship to.'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Your cart is empty.'; end if;
  if jsonb_array_length(p->'items') > 120 then raise exception 'That is a lot of lines. Please call us for an order this size.'; end if;
  if (select count(*) from public.partner_orders where lower(email) = em and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.partner_orders where partner_id = p_partner and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We got several orders from you just now. Please call us and we will help.';
  end if;

  for r in
    select x.item_id, x.sku as x_sku, x.name as x_name, x.qty, c.id, c.sku, c.name, c.unit, c.price, c.per_customer, c.basis, c.my_price
      from jsonb_to_recordset(p->'items') as x(item_id text, sku text, name text, qty numeric)
      left join public.partner_catalog(p_partner) c on c.id::text = x.item_id
  loop
    q := round(coalesce(r.qty, 0));
    if q < 1 or q > 9999 then continue; end if;
    if r.item_id is not null then
      if r.id is null then continue; end if;
      declare price numeric := case when r.basis = 'lb' then null else coalesce(r.my_price, r.price) end;
      begin
        if price is null then v_quote := true; else v_sub := v_sub + price * q; end if;
        v_items := v_items || jsonb_build_object('item_id', r.id, 'sku', r.sku, 'name', r.name, 'unit', r.unit, 'qty', q, 'price', price,
          'per_lb', case when r.basis = 'lb' then r.my_price end);
      end;
    else
      -- A part picked on a gun drawing that isn't on the store's list: priced before it ships.
      if length(trim(coalesce(r.x_sku, ''))) = 0 then continue; end if;
      v_quote := true;
      v_items := v_items || jsonb_build_object('item_id', null, 'sku', left(trim(r.x_sku), 40), 'name', left(trim(coalesce(r.x_name, 'Part')), 160),
        'unit', 'each', 'qty', q, 'price', null);
    end if;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Your cart is empty.'; end if;

  -- Shipping the owner set on their desk (0104): a flat amount per order, free over an amount. Pickup ships free.
  select ship_flat, ship_free_over into v_flat, v_free from public.partners where id = p_partner;
  if coalesce(p->>'delivery', 'ship') <> 'pickup' and v_flat is not null then
    v_ship := case when v_free is not null and v_sub >= v_free then 0 else v_flat end;
  elsif p->>'delivery' = 'pickup' then
    v_ship := 0;
  end if;

  insert into public.partner_orders (partner_id, customer_id, placed_by, name, company, email, phone, delivery, address, po, notes, items, subtotal, has_quote, lang, ship_cost)
  values (p_partner, v_cust, auth.uid(), left(trim(p->>'name'), 120), nullif(left(trim(coalesce(p->>'company', '')), 160), ''), left(em, 160),
          nullif(left(trim(coalesce(p->>'phone', '')), 40), ''),
          case when p->>'delivery' = 'pickup' then 'pickup' else 'ship' end,
          case when p->>'delivery' = 'pickup' then null else jsonb_build_object(
            'street', left(trim(coalesce(p#>>'{address,street}', '')), 160), 'city', left(trim(coalesce(p#>>'{address,city}', '')), 80),
            'state', upper(left(trim(coalesce(p#>>'{address,state}', '')), 2)), 'zip', left(trim(coalesce(p#>>'{address,zip}', '')), 10)) end,
          nullif(left(trim(coalesce(p->>'po', '')), 60), ''), nullif(left(trim(coalesce(p->>'notes', '')), 2000), ''),
          v_items, round(v_sub, 2), v_quote, case when p->>'lang' = 'es' then 'es' else 'en' end, v_ship)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'order_no', v_short || '-' || (1000 + v_id), 'subtotal', round(v_sub, 2), 'shipping', v_ship, 'has_quote', v_quote,
                            'items', v_items, 'customer_id', v_cust);
end $fn$;
revoke all on function public.partner_place_order(text, jsonb) from public;
grant execute on function public.partner_place_order(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- CFS's prices to AMBIT (Nov 2026 price lists)
drop table if exists pg_temp.cfs_prices;
create temp table cfs_prices (sku text primary key, name text, cost numeric, price numeric, img text, sort int);
insert into cfs_prices (sku, name, cost, price, img, sort) values
  ('FX9000', 'Graco Fusion FX gun without mix chamber', 2721.37, 3211.99, null, 1001),
  ('FX9001', 'Graco Fusion FX foam gun', 2933.43, 3461.99, null, 1002),
  ('FX9011', 'Graco Fusion FX polyurea gun', 2933.43, 3461.99, null, 1003),
  ('2000973', 'Graco Fusion FX gun body / air section', 812.88, 959.99, '/diagrams/thumbs/2000973.webp', 1004),
  ('2000974', 'Graco Fusion FX hose manifold assembly', 554.88, 654.99, '/diagrams/thumbs/2000974.webp', 1005),
  ('2000978', 'Graco Fusion FX ClearShot air piston assembly', 265.07, 312.99, '/diagrams/thumbs/2000978.webp', 1006),
  ('2001166', 'Graco Fusion FX ClearShot air piston kit', 187.32, 221.99, null, 1007),
  ('2000979', 'Graco Fusion FX air-purge piston assembly', 123.7, 145.99, '/diagrams/thumbs/2000979.webp', 1008),
  ('2000971', 'Graco Fusion FX rear safety cap assembly', 206.75, 243.99, '/diagrams/thumbs/2000971.webp', 1009),
  ('2000972', 'Graco Fusion FX overmolded polymer handle', 88.36, 104.99, '/diagrams/thumbs/2000972.webp', 1010),
  ('2001095', 'Graco Fusion FX aluminum handle', 176.71, 208.99, null, 1011),
  ('2000975', 'Graco Fusion FX fluid manifold valve kit', 116.63, 137.99, '/diagrams/thumbs/2000975.webp', 1012),
  ('2000976', 'Graco Fusion FX trigger kit', 41.7, 49.99, '/diagrams/thumbs/2000976.webp', 1013),
  ('2000980', 'Graco Fusion FX spool valve assembly', 20.36, 24.99, '/diagrams/thumbs/2000980.webp', 1014),
  ('2000981', 'Graco Fusion FX breather / muffler plug', 24.74, 29.99, '/diagrams/thumbs/2000981.webp', 1015),
  ('2001031', 'Graco Fusion FX dosing piston kit', 45.95, 54.99, '/diagrams/thumbs/2001031.webp', 1016),
  ('2001032', 'Graco Fusion FX safety stem kit', 45.95, 54.99, '/diagrams/thumbs/2001032.webp', 1017),
  ('2001025', 'Graco Fusion FX A-side filter housing', 67.15, 79.99, '/diagrams/thumbs/2001025.webp', 1018),
  ('2001026', 'Graco Fusion FX B-side filter housing', 67.15, 79.99, '/diagrams/thumbs/2001026.webp', 1019),
  ('2001027', 'Graco Fusion FX shuttle valve / yoke repair kit', 55.49, 65.99, '/diagrams/thumbs/2001027.webp', 1020),
  ('2001028', 'Graco Fusion FX shuttle valves, 10-pack', 173.18, 204.99, '/diagrams/thumbs/2001028.webp', 1021),
  ('2001148', 'Graco Fusion FX air valve fitting adapter', 25.45, 30.99, '/diagrams/thumbs/2001148.webp', 1022),
  ('2001167', 'Graco Fusion FX spiral retaining ring', 16.61, 19.99, '/diagrams/thumbs/2001167.webp', 1023),
  ('2001168', 'Graco Fusion FX check manifold housing kit, 2-pack', 77.75, 91.99, '/diagrams/thumbs/2001168.webp', 1024),
  ('2001151', 'Graco Fusion FX handle bolt kit', 8.84, 10.99, '/diagrams/thumbs/2001151.webp', 1025),
  ('2001153', 'Graco Fusion FX trigger bolt kit', 22.62, 26.99, '/diagrams/thumbs/2001153.webp', 1026),
  ('2001169', 'Graco Fusion FX flat-head screw kit', 6.01, 7.99, '/diagrams/thumbs/2001169.webp', 1027),
  ('2001170', 'Graco Fusion FX manifold bolt kit', 17.32, 20.99, '/diagrams/thumbs/2001170.webp', 1028),
  ('117559', 'Graco Fusion FX O-ring, single', 4.17, 4.99, '/diagrams/thumbs/117559.webp', 1029),
  ('118594', 'Graco Fusion FX O-ring, single', 5.8, 6.99, '/diagrams/thumbs/118594.webp', 1030),
  ('119421', 'Graco Fusion FX O-ring, single', 3.57, 4.99, '/diagrams/thumbs/119421.webp', 1031),
  ('17V093', 'Graco Fusion FX O-ring #024, single', 5.51, 6.99, '/diagrams/thumbs/17V093.webp', 1032),
  ('2001033', 'Graco Fusion FX air piston O-ring kit', 24.74, 29.99, null, 1033),
  ('2001029', 'Graco Fusion FX inlet check O-ring kit', 8.84, 10.99, '/diagrams/thumbs/2001029.webp', 1034),
  ('2001150', 'Graco Fusion FX O-ring #024, 5-pack', 34.28, 40.99, null, 1035),
  ('2001152', 'Graco Fusion FX O-ring #007, 10-pack', 27.43, 32.99, null, 1036),
  ('2001307', 'Graco Fusion FX complete O-ring repair kit', 93.3, 110.99, null, 1037),
  ('2005366', 'Graco Fusion FX mix chamber seals, 10-pack', 20.15, 23.99, '/diagrams/thumbs/2005366.webp', 1038),
  ('2005697', 'Graco Fusion FX O-ring kit, 5-pack', 16.96, 20.99, null, 1039),
  ('2005698', 'Graco Fusion FX O-ring #020, 5-pack', 26.86, 31.99, null, 1040),
  ('2005699', 'Graco Fusion FX O-ring #013, 10-pack', 44.71, 52.99, null, 1041),
  ('2006158', 'Graco Fusion FX O-ring #129, 5-pack', 94.72, 111.99, '/diagrams/thumbs/2006158.webp', 1042),
  ('2007251', 'Graco Fusion FX ClearShot check O-ring kit', 7.42, 8.99, '/diagrams/thumbs/2007251.webp', 1043),
  ('25M239', 'Graco Fusion FX O-ring #007, 50-pack', 125.11, 147.99, null, 1044),
  ('25M247', 'Graco Fusion FX O-ring #013, 25-pack', 104.26, 123.99, null, 1045),
  ('256773', 'Graco Fusion FX O-ring kit, 6-pack', 56.37, 66.99, null, 1046),
  ('2000810', 'Graco Fusion FX cartridge, single', 194.38, 229.99, '/diagrams/thumbs/2000810.webp', 1047),
  ('2000811', 'Graco Fusion FX cartridges, 3-pack', 530.14, 625.99, null, 1048),
  ('2000812', 'Graco Fusion FX cartridges, 5-pack', 795.21, 938.99, null, 1049),
  ('256385', 'Graco Fusion FX ClearShot liquid cartridges, 25-pack', 207.81, 245.99, '/diagrams/thumbs/256385.webp', 1050),
  ('256386', 'Graco Fusion FX ClearShot liquid cartridges, 50-pack', 353.43, 417.99, null, 1051),
  ('256387', 'Graco Fusion FX ClearShot liquid cartridges, 100-pack', 554.88, 654.99, null, 1052),
  ('17X756', 'Graco Fusion FX ClearShot fluid, 4 x 16 oz', 361.2, 426.99, null, 1053),
  ('17X757', 'Graco Fusion FX ClearShot fluid, 12 x 16 oz', 957.78, 1130.99, null, 1054),
  ('FX20RD', 'Graco Fusion FX 0.020-inch round mix chamber', 106.73, 125.99, '/diagrams/thumbs/FX20RD.webp', 1055),
  ('FX29RD', 'Graco Fusion FX 0.029-inch round mix chamber', 106.73, 125.99, null, 1056),
  ('FX34RD', 'Graco Fusion FX 0.034-inch round mix chamber', 106.73, 125.99, null, 1057),
  ('FX37RD', 'Graco Fusion FX 0.037-inch round mix chamber', 102.49, 120.99, null, 1058),
  ('FX42RD', 'Graco Fusion FX 0.042-inch round mix chamber', 102.49, 120.99, null, 1059),
  ('FX47RD', 'Graco Fusion FX 0.047-inch round mix chamber', 102.49, 120.99, null, 1060),
  ('FX52RD', 'Graco Fusion FX 0.052-inch round mix chamber', 102.49, 120.99, null, 1061),
  ('FX60RD', 'Graco Fusion FX 0.060-inch round mix chamber', 106.73, 125.99, null, 1062),
  ('FX70RD', 'Graco Fusion FX 0.070-inch round mix chamber', 102.49, 120.99, null, 1063),
  ('117485', 'Graco Fusion FX compression spring', 4.95, 5.99, '/diagrams/thumbs/117485.webp', 1064),
  ('117509', 'Air quick-disconnect fitting', 11.88, 14.99, '/diagrams/thumbs/117509.webp', 1065),
  ('117510', 'Air line coupler', 38.17, 45.99, '/diagrams/thumbs/117510.webp', 1066),
  ('127596', 'Graco Fusion FX B-side swivel fitting', 5.27, 6.99, '/diagrams/thumbs/127596.webp', 1067),
  ('127597', 'Graco Fusion FX A-side swivel fitting', 5.27, 6.99, '/diagrams/thumbs/127597.webp', 1068),
  ('15B565', 'Air ball valve', 14.7, 17.99, '/diagrams/thumbs/15B565.webp', 1069),
  ('15B772', '18-inch air hose', 29.19, 34.99, '/diagrams/thumbs/15B772.webp', 1070),
  ('2000715', 'Graco Fusion FX ClearShot tube plug kit', 20.71, 24.99, '/diagrams/thumbs/2000715.webp', 1071),
  ('2000716', 'Graco Fusion FX hand strap and bracket kit', 60.79, 71.99, '/diagrams/thumbs/2000716.webp', 1072),
  ('2000788', 'Graco Fusion FX front round air cap', 24.74, 29.99, '/diagrams/thumbs/2000788.webp', 1073),
  ('2005061', 'Graco Fusion FX clean-out tool', 5.3, 6.99, null, 1074),
  ('2005266', 'Graco Fusion FX extension air cap, FX34-FX42', 77.75, 91.99, null, 1075),
  ('2005267', 'Graco Fusion FX extension air cap, FX37-FX47', 77.75, 91.99, null, 1076),
  ('2005268', 'Graco Fusion FX extension air cap, FX52-FX70', 77.75, 91.99, null, 1077),
  ('2005269', 'Graco Fusion FX pour-foam air cap', 87.65, 103.99, null, 1078),
  ('2006911', 'Graco Fusion FX upper hand strap bracket', 15.55, 18.99, '/diagrams/thumbs/2006911.webp', 1079),
  ('2006912', 'Graco Fusion FX lower hand strap bracket', 16.96, 20.99, '/diagrams/thumbs/2006912.webp', 1080),
  ('2007204', 'Graco Fusion FX check ball and spring kit, 2-pack', 11.66, 13.99, '/diagrams/thumbs/2007204.webp', 1081),
  ('2007692', 'Graco Fusion FX hand straps, 3-pack', 77.75, 91.99, null, 1082),
  ('24R894', 'Graco Fusion FX 40-mesh filters, 10-pack', 41.7, 49.99, '/diagrams/thumbs/24R894.webp', 1083),
  ('2001433', 'Graco Fusion FX 60-mesh filters, 10-pack', 60.08, 70.99, null, 1084),
  ('2001434', 'Graco Fusion FX 80-mesh filters, 10-pack', 60.08, 70.99, null, 1085),
  ('2006566', 'Graco Fusion FX complete spare-parts case', 703.32, 829.99, null, 1086),
  ('131971PKG', 'Graco Fusion FX rear safety cap O-ring', 17.39, 20.99, '/diagrams/thumbs/131971PKG.webp', 1087),
  ('2002324', 'Graco Fusion FX recirculation block assembly', 300.41, 354.99, null, 1088),
  ('FX2937', 'Graco Fusion X repair kit, 2937', 102.49, 120.99, null, 1089),
  ('FX3729', 'Graco Fusion X repair kit, 3729', 102.49, 120.99, null, 1090),
  ('FX3342', 'Graco Fusion X repair kit, 3342', 102.49, 120.99, null, 1091),
  ('FX4252', 'Graco Fusion X repair kit, 4252', 102.49, 120.99, null, 1092),
  ('121370', 'Graco Fusion FX O-ring #022', null, null, '/diagrams/thumbs/121370.webp', 1093),
  ('2001346', 'Graco Fusion FX drill-bit cleaning assortment', null, null, null, 1094),
  ('25E647', 'Graco Fusion FX seal kit', null, null, null, 1095),
  ('2002347', 'Graco Fusion FX AP/PC adapter manifold and hose kit', null, null, null, 1096),
  ('172479', 'Graco Fusion FX replacement warning tag', null, null, null, 1097),
  ('25P587', 'Graco Fusion PC gun, round 00', 2735.51, 3227.99, null, 1098),
  ('25R084', 'Graco Fusion PC gun, round 00-01', 2735.51, 3227.99, null, 1099),
  ('25P588', 'Graco Fusion PC gun, round 01', 2735.51, 3227.99, null, 1100),
  ('25P590', 'Graco Fusion PC gun, round 01-02', 2735.51, 3227.99, null, 1101),
  ('25R085', 'Graco Fusion PC gun, round 03', 2735.51, 3227.99, null, 1102),
  ('25P591', 'Graco Fusion PC gun, no mix chamber', 2502.25, 2952.99, null, 1103),
  ('25T452', 'Graco Fusion PC gun, no mix chamber, flat air cap', 2502.25, 2952.99, null, 1104),
  ('25P589', 'Graco Fusion PC gun, round 02', 2551.73, 3011.99, null, 1105),
  ('25U291', 'Graco Fusion PC gun, without chamber or manifold', 1979.18, 2335.99, null, 1106),
  ('19Y300', 'Graco Fusion PC replacement cartridge, 1-pack', 166.46, 196.99, '/diagrams/thumbs/19Y300.webp', 1107),
  ('19Y301', 'Graco Fusion PC replacement cartridge, 3-pack', 472.18, 557.99, null, 1108),
  ('19Y308', 'Graco Fusion PC replacement cartridge, 5-pack', 693.42, 818.99, null, 1109),
  ('18C116', 'Graco Fusion PC complete parts kit with case', 1484.39, 1751.99, null, 1110),
  ('18C115', 'Graco Fusion PC complete gun O-ring kit', 97.55, 115.99, null, 1111),
  ('25P850', 'Graco Fusion PC cartridge air O-ring kit', 29.48, 34.99, null, 1112),
  ('25P851', 'Graco Fusion PC cartridge fluid O-ring kit', 37.82, 44.99, null, 1113),
  ('25P660', 'Graco Fusion PC cartridge troubleshooting tools kit', 25.52, 30.99, null, 1114),
  ('19Y302', 'Graco Fusion PC front retaining ring kit', 154.09, 181.99, '/diagrams/thumbs/19Y302.webp', 1115),
  ('26C775', 'Graco Fusion PC middle lock ring kit', 100.37, 118.99, '/diagrams/thumbs/26C775.webp', 1116),
  ('19Y303', 'Graco Fusion PC fluid housing kit', 393.01, 463.99, '/diagrams/thumbs/19Y303.webp', 1117),
  ('26C937', 'Graco Fusion PC jack screw holder kit', 33.58, 39.99, '/diagrams/thumbs/26C937.webp', 1118),
  ('246731', 'Graco Fusion PC A-side check valve assembly', 88.71, 104.99, '/diagrams/thumbs/246731.webp', 1119),
  ('246352', 'Graco Fusion PC B-side check valve assembly', 88.71, 104.99, '/diagrams/thumbs/246352.webp', 1120),
  ('246356', 'Graco Fusion PC fluid valve repair kit', 57.78, 68.99, '/diagrams/thumbs/246356.webp', 1121),
  ('248064', 'Graco Fusion PC complete safety stop assembly', 221.24, 261.99, null, 1122),
  ('PC20RD', 'Graco Fusion PC round chamber .020', 208.52, 246.99, '/diagrams/thumbs/PC20RD.webp', 1123),
  ('PC29RD', 'Graco Fusion PC round chamber .029', 208.52, 246.99, null, 1124),
  ('PC37RD', 'Graco Fusion PC round chamber .037', 208.52, 246.99, null, 1125),
  ('PC42RD', 'Graco Fusion PC round chamber .042', 208.52, 246.99, null, 1126),
  ('PC47RD', 'Graco Fusion PC round chamber .047', 208.52, 246.99, null, 1127),
  ('PC52RD', 'Graco Fusion PC round chamber .052', 208.52, 246.99, null, 1128),
  ('PC60RD', 'Graco Fusion PC round chamber .060', 208.52, 246.99, null, 1129),
  ('PC70RD', 'Graco Fusion PC round chamber .070', 208.52, 246.99, null, 1130),
  ('15K365', 'Graco Fusion PC gun handle', 844.69, 996.99, '/diagrams/thumbs/15K365.webp', 1131),
  ('15B203', 'Graco Fusion PC air piston', 125.82, 148.99, '/diagrams/thumbs/15B203.webp', 1132),
  ('15B204', 'Graco Fusion PC cylinder cap', 109.92, 129.99, '/diagrams/thumbs/15B204.webp', 1133),
  ('15B205', 'Graco Fusion PC piston stop', 17.04, 20.99, '/diagrams/thumbs/15B205.webp', 1134),
  ('15B206', 'Graco Fusion PC safety lock shaft', 37.82, 44.99, '/diagrams/thumbs/15B206.webp', 1135),
  ('15B223', 'Graco Fusion PC clean-off air valve', 21.7, 25.99, '/diagrams/thumbs/15B223.webp', 1136),
  ('15B208', 'Graco Fusion PC air valve plug', 27.57, 32.99, '/diagrams/thumbs/15B208.webp', 1137),
  ('15B689', 'Graco Fusion PC grease fitting cover', 19.01, 22.99, '/diagrams/thumbs/15B689.webp', 1138),
  ('100846', 'Graco Fusion PC grease fitting', 5.69, 6.99, '/diagrams/thumbs/100846.webp', 1139),
  ('116550', 'Graco Fusion PC retaining ring', 7.85, 9.99, '/diagrams/thumbs/116550.webp', 1140),
  ('192272', 'Graco Fusion PC trigger pivot pin', 18.8, 22.99, '/diagrams/thumbs/192272.webp', 1141),
  ('15C480', 'Graco Fusion PC curved washer', 15.13, 17.99, '/diagrams/thumbs/15C480.webp', 1142),
  ('203953', 'Graco Fusion PC lock screw', 3.71, 4.99, '/diagrams/thumbs/203953.webp', 1143),
  ('246012', 'Graco Fusion PC complete fluid manifold', 389.47, 459.99, '/diagrams/thumbs/246012.webp', 1144),
  ('117634', 'Graco Fusion PC B-side swivel', 11.88, 14.99, '/diagrams/thumbs/117634.webp', 1145),
  ('117635', 'Graco Fusion PC A-side swivel', 11.88, 14.99, '/diagrams/thumbs/117635.webp', 1146),
  ('119626', 'Graco Fusion PC muffler', 14.63, 17.99, '/diagrams/thumbs/119626.webp', 1147),
  ('114070', 'Graco Fusion PC compression spring', 14.56, 17.99, '/diagrams/thumbs/114070.webp', 1148),
  ('117490', 'Graco Fusion PC check valve spring', 3.04, 3.99, '/diagrams/thumbs/117490.webp', 1149),
  ('15B214', 'Graco Fusion PC check valve retaining screw', 13.92, 16.99, '/diagrams/thumbs/15B214.webp', 1150),
  ('257420', 'Graco Fusion PC carbide check balls, 10-pack', 29.69, 35.99, '/diagrams/thumbs/257420.webp', 1151),
  ('15B210', 'Graco Fusion PC round-pattern air cap', 71.04, 83.99, '/diagrams/thumbs/15B210.webp', 1152),
  ('246362', 'Graco Fusion PC recirculation manifold', 194.74, 229.99, null, 1153),
  ('2002360', 'Graco Fusion PC FX-to-AP/PC adapter manifold', 279.21, 329.99, null, 1154),
  ('246354', 'Graco Fusion PC #007 O-ring repair kit', 17.81, 21.99, '/diagrams/thumbs/246354.webp', 1155),
  ('248132', 'Graco Fusion PC fluid housing O-rings, 6-pack', 71.75, 84.99, '/diagrams/thumbs/248132.webp', 1156),
  ('248133', 'Graco Fusion PC check valve face O-rings', 56.02, 66.99, '/diagrams/thumbs/248133.webp', 1157),
  ('248129', 'Graco Fusion PC check valve housing O-rings', 29.05, 34.99, '/diagrams/thumbs/248129.webp', 1158),
  ('248134', 'Graco Fusion PC small piston O-rings, 6-pack', 33.43, 39.99, '/diagrams/thumbs/248134.webp', 1159),
  ('248135', 'Graco Fusion PC large piston O-rings, 6-pack', 79.87, 94.99, '/diagrams/thumbs/248135.webp', 1160),
  ('248136', 'Graco Fusion PC back cap O-rings', 77.4, 91.99, '/diagrams/thumbs/248136.webp', 1161),
  ('248137', 'Graco Fusion PC PTFE air cap O-rings', 30.96, 36.99, '/diagrams/thumbs/248137.webp', 1162),
  ('246357', 'Graco Fusion PC 40-mesh screens', 38.88, 45.99, null, 1163),
  ('246358', 'Graco Fusion PC 60-mesh screens', 38.88, 45.99, null, 1164),
  ('246359', 'Graco Fusion PC 80-mesh screens', 40.64, 47.99, '/diagrams/thumbs/246359.webp', 1165),
  ('25P701', 'Graco Fusion PC retrofit kit round 01', 1067.34, 1259.99, null, 1166),
  ('25P702', 'Graco Fusion PC retrofit kit round 02', 1067.34, 1259.99, null, 1167),
  ('25P704', 'Graco Fusion PC retrofit kit no chamber', 841.15, 992.99, null, 1168),
  ('15D546', 'Graco Fusion PC gun cleaning kit', 102.14, 120.99, null, 1169),
  ('248528', 'Graco Fusion PC pour nozzle tip', 182.01, 214.99, null, 1170),
  ('248019', 'Graco Fusion PC extension tip seals, 5-pack', 56.9, 67.99, null, 1171),
  ('248013', 'Graco Fusion PC extension tip 5252', 79.17, 93.99, null, 1172),
  ('248280', 'Graco Fusion PC grease cartridges, 10', 67.33, 79.99, null, 1173),
  ('248279', 'Graco Fusion PC lithium grease, 10', 114.51, 135.99, null, 1174),
  ('117661', 'Graco Fusion PC pin vise', 39.41, 46.99, null, 1175),
  ('117642', 'Graco Fusion PC hex nut driver', 23.61, 27.99, null, 1176),
  ('118575', 'Graco Fusion PC screwdriver', 5.83, 6.99, null, 1177),
  ('15B202', 'Graco Fusion PC spool valve', null, null, '/diagrams/thumbs/15B202.webp', 1178),
  ('15B209', 'Graco Fusion PC trigger', null, null, '/diagrams/thumbs/15B209.webp', 1179),
  ('15B993', 'Graco Fusion PC lock ring spring', null, null, '/diagrams/thumbs/15B993.webp', 1180),
  ('248131', 'Graco Fusion PC air cap O-ring kit', null, null, null, 1181),
  ('336507', 'Carlisle ST1 B/01 complete gun', 2014.52, 2377.99, null, 1182),
  ('336508', 'Carlisle ST1 C/15 complete gun', 2014.52, 2377.99, null, 1183),
  ('336509', 'Carlisle ST1 D/02 complete gun', 2014.52, 2377.99, null, 1184),
  ('336352', 'Carlisle ST1 gun handle', null, null, '/diagrams/thumbs/336352.webp', 1185),
  ('336426', 'Carlisle ST1 front end assembly', 694.13, 819.99, null, 1186),
  ('336354', 'Carlisle ST1 fluid manifold assembly', 351.3, 414.99, null, 1187),
  ('336429', 'Carlisle ST1 safety stop assembly', 409.27, 482.99, null, 1188),
  ('336370', 'Carlisle ST1 rod and piston assembly', 108.85, 128.99, '/diagrams/thumbs/336370.webp', 1189),
  ('336366', 'Carlisle ST1 valve stem assembly', 26.22, 30.99, '/diagrams/thumbs/336366.webp', 1190),
  ('336394', 'Carlisle ST1 air check valve assembly', 84.12, 99.99, '/diagrams/thumbs/336394.webp', 1191),
  ('336360', 'Carlisle ST1 A-side check valve assembly', 76.34, 90.99, '/diagrams/thumbs/336360.webp', 1192),
  ('336361', 'Carlisle ST1 B-side check valve assembly', 76.34, 90.99, '/diagrams/thumbs/336361.webp', 1193),
  ('336359', 'Carlisle ST1 Delrin shaft guide', 34.95, 41.99, '/diagrams/thumbs/336359.webp', 1194),
  ('336353', 'Carlisle ST1 gun head', 255.88, 301.99, '/diagrams/thumbs/336353.webp', 1195),
  ('336356', 'Carlisle ST1 manifold screws, 2-pack', 20.04, 23.99, '/diagrams/thumbs/336356.webp', 1196),
  ('336437', 'Carlisle ST1 guide assembly', 74.93, 88.99, '/diagrams/thumbs/336437.webp', 1197),
  ('336738', 'Carlisle ST1 grease fitting', 12.02, 14.99, '/diagrams/thumbs/336738.webp', 1198),
  ('336355', 'Carlisle ST1 fluid manifold', 139.25, 164.99, '/diagrams/thumbs/336355.webp', 1199),
  ('336372', 'Carlisle ST1 fluid manifold valve assembly', 68.56, 80.99, '/diagrams/thumbs/336372.webp', 1200),
  ('336335', 'Carlisle ST1 1/8-inch NPT stainless pipe plug', 4.74, 5.99, '/diagrams/thumbs/336335.webp', 1201),
  ('336357', 'Carlisle ST1 A-side swivel adapter', 11.31, 13.99, '/diagrams/thumbs/336357.webp', 1202),
  ('336358', 'Carlisle ST1 B-side swivel adapter', 11.31, 13.99, '/diagrams/thumbs/336358.webp', 1203),
  ('336364', 'Carlisle ST1 trigger stud', 22.58, 26.99, null, 1204),
  ('336365', 'Carlisle ST1 trigger screw', 37.11, 43.99, '/diagrams/thumbs/336365.webp', 1205),
  ('336363', 'Carlisle ST1 trigger', 19.69, 23.99, '/diagrams/thumbs/336363.webp', 1206),
  ('336736', 'Carlisle ST1 safety lock arm', 54.78, 64.99, '/diagrams/thumbs/336736.webp', 1207),
  ('336373', 'Carlisle ST1 end cap', null, null, '/diagrams/thumbs/336373.webp', 1208),
  ('336737', 'Carlisle ST1 safety stop knob', 45.95, 54.99, '/diagrams/thumbs/336737.webp', 1209),
  ('336367', 'Carlisle ST1 valve stem spring', 3.71, 4.99, '/diagrams/thumbs/336367.webp', 1210),
  ('336395', 'Carlisle ST1 quick disconnect base', 43.82, 51.99, '/diagrams/thumbs/336395.webp', 1211),
  ('336396', 'Carlisle ST1 quick disconnect stem', 13.5, 15.99, '/diagrams/thumbs/336396.webp', 1212),
  ('336374', 'Carlisle ST1 muffler', 12.76, 15.99, '/diagrams/thumbs/336374.webp', 1213),
  ('336400', 'Carlisle ST1 spacer', 18.2, 21.99, '/diagrams/thumbs/336400.webp', 1214),
  ('336399', 'Carlisle ST1 gun clip', 27.32, 32.99, '/diagrams/thumbs/336399.webp', 1215),
  ('336401', 'Carlisle ST1 strap stud', 27.32, 32.99, '/diagrams/thumbs/336401.webp', 1216),
  ('336398', 'Carlisle ST1 hand strap', 25.48, 30.99, '/diagrams/thumbs/336398.webp', 1217),
  ('336436', 'Carlisle ST1 flush manifold assembly', 157.63, 186.99, '/diagrams/thumbs/336436.webp', 1218),
  ('336433', 'Carlisle ST1 flush manifold', null, null, null, 1219),
  ('336336', 'Carlisle ST1 1/4-inch NPT stainless pipe plug', null, null, null, 1220),
  ('336397', 'Carlisle ST1 quick disconnect air coupler', 37.11, 43.99, '/diagrams/thumbs/336397.webp', 1221),
  ('336643', 'Carlisle ST1 air hose assembly', 32.76, 38.99, '/diagrams/thumbs/336643.webp', 1222),
  ('336408', 'Carlisle ST1 air ball valve', 20.04, 23.99, '/diagrams/thumbs/336408.webp', 1223),
  ('336735', 'Carlisle ST1 safety stop spring', 4.74, 5.99, '/diagrams/thumbs/336735.webp', 1224),
  ('336362', 'Carlisle ST1 check valve spring', 4.74, 5.99, '/diagrams/thumbs/336362.webp', 1225),
  ('336378', 'Carlisle ST1 side seal spring', 4.74, 5.99, '/diagrams/thumbs/336378.webp', 1226),
  ('336428', 'Carlisle ST1 air valve repair kit', null, null, null, 1227),
  ('336375', 'Carlisle ST1 A-side polymer side seal cartridge', 102.49, 120.99, '/diagrams/thumbs/336375.webp', 1228),
  ('336376', 'Carlisle ST1 B-side polymer side seal cartridge', 102.49, 120.99, '/diagrams/thumbs/336376.webp', 1229),
  ('336430', 'Carlisle ST1 A-side stainless side seal cartridge', null, null, null, 1230),
  ('336431', 'Carlisle ST1 B-side stainless side seal cartridge', 102.49, 120.99, null, 1231),
  ('336377', 'Carlisle ST1 A-side cartridge housing', 93.3, 110.99, null, 1232),
  ('340564', 'Carlisle ST1 B-side cartridge housing', null, null, null, 1233),
  ('336379', 'Carlisle ST1 polymer side seals, 2-pack', 34.25, 40.99, '/diagrams/thumbs/336379.webp', 1234),
  ('336410', 'Carlisle ST1 polymer side seals, 50-pack', 742.9, 876.99, null, 1235),
  ('336381', 'Carlisle ST1 stainless side seals, 2-pack', 45.24, 53.99, null, 1236),
  ('336411', 'Carlisle ST1 stainless side seals, 50-pack', null, null, null, 1237),
  ('336419', 'Carlisle ST1 air piston O-rings, 2-pack', 20.39, 24.99, '/diagrams/thumbs/336419.webp', 1238),
  ('336412', 'Carlisle ST1 air valve/piston rod O-rings, 10-pack', 41.35, 48.99, '/diagrams/thumbs/336412.webp', 1239),
  ('336417', 'Carlisle ST1 head/handle O-rings, 2-pack', 26.97, 31.99, '/diagrams/thumbs/336417.webp', 1240),
  ('336415', 'Carlisle ST1 guide/housing O-rings, 10-pack', 49.48, 58.99, '/diagrams/thumbs/336415.webp', 1241),
  ('336420', 'Carlisle ST1 end cap O-rings, 2-pack', 20.04, 23.99, '/diagrams/thumbs/336420.webp', 1242),
  ('336420E', 'Carlisle ST1 end cap O-ring, single', 9.19, 10.99, null, 1243),
  ('336413', 'Carlisle ST1 safety stop O-rings, 2-pack', 22.23, 26.99, '/diagrams/thumbs/336413.webp', 1244),
  ('336414', 'Carlisle ST1 side seal O-rings, 10-pack', 41.7, 49.99, '/diagrams/thumbs/336414.webp', 1245),
  ('336414E', 'Carlisle ST1 side seal O-rings, 2-pack', 7.92, 9.99, null, 1246),
  ('336418', 'Carlisle ST1 check valve face O-rings, 10-pack', 94.72, 111.99, '/diagrams/thumbs/336418.webp', 1247),
  ('336427', 'Carlisle ST1 check valve balls, 10-pack', 27.32, 32.99, '/diagrams/thumbs/336427.webp', 1248),
  ('336422', 'Carlisle ST1 40-mesh screens, 10-pack', 45.95, 54.99, '/diagrams/thumbs/336422.webp', 1249),
  ('336423', 'Carlisle ST1 60-mesh screens, 10-pack', 45.95, 54.99, null, 1250),
  ('336421', 'Carlisle ST1 complete O-ring kit', 117.34, 138.99, null, 1251),
  ('336424', 'Carlisle ST1 complete spare parts box', 1391.08, 1641.99, null, 1252),
  ('336440', 'Carlisle ST1 A/00 mix chamber and tip kit', 171.06, 201.99, null, 1253),
  ('336441', 'Carlisle ST1 B/01 mix chamber and tip kit', 171.06, 201.99, null, 1254),
  ('336442', 'Carlisle ST1 C/15 mix chamber and tip kit', 171.06, 201.99, null, 1255),
  ('336443', 'Carlisle ST1 D/02 mix chamber and tip kit', 171.06, 201.99, null, 1256),
  ('336444', 'Carlisle ST1 E/03 mix chamber and tip kit', 171.06, 201.99, null, 1257),
  ('336445', 'Carlisle ST1 F/04 mix chamber and tip kit', 171.06, 201.99, null, 1258),
  ('336446', 'Carlisle ST1 a mix chamber with drill bit', null, null, '/diagrams/thumbs/336446.webp', 1259),
  ('336447', 'Carlisle ST1 b mix chamber with drill bit', 153.39, 181.99, null, 1260),
  ('336448', 'Carlisle ST1 c mix chamber with drill bit', 153.39, 181.99, null, 1261),
  ('336449', 'Carlisle ST1 d mix chamber with drill bit', 153.39, 181.99, null, 1262),
  ('336450', 'Carlisle ST1 e mix chamber with drill bit', 153.39, 181.99, null, 1263),
  ('336451', 'Carlisle ST1 f mix chamber with drill bit', 153.39, 181.99, null, 1264),
  ('336383', 'Carlisle ST1 B/01 mix chamber only', 134.3, 158.99, null, 1265),
  ('336384', 'Carlisle ST1 C/15 mix chamber only', 134.3, 158.99, '/diagrams/thumbs/336384.webp', 1266),
  ('336385', 'Carlisle ST1 D/02 mix chamber only', 134.3, 158.99, null, 1267),
  ('336453', 'Carlisle ST1 01 mix tip with drill bit', 49.48, 58.99, null, 1268),
  ('336454', 'Carlisle ST1 15 mix tip with drill bit', 49.48, 58.99, null, 1269),
  ('336455', 'Carlisle ST1 02 mix tip with drill bit', 49.48, 58.99, null, 1270),
  ('336456', 'Carlisle ST1 03 mix tip with drill bit', 49.48, 58.99, null, 1271),
  ('336457', 'Carlisle ST1 04 mix tip with drill bit', 49.48, 58.99, null, 1272),
  ('336802', 'Carlisle ST1 hardened 01 mix tip', 127.94, 150.99, null, 1273),
  ('336803', 'Carlisle ST1 hardened 15 mix tip', 127.94, 150.99, null, 1274),
  ('336804', 'Carlisle ST1 hardened 02 mix tip', 127.94, 150.99, null, 1275),
  ('336805', 'Carlisle ST1 hardened 03 mix tip', 127.94, 150.99, null, 1276),
  ('336806', 'Carlisle ST1 hardened 04 mix tip', null, null, null, 1277),
  ('336458', 'Carlisle ST1 01 XS extension tip, 1/2 inch', 79.17, 93.99, null, 1278),
  ('336459', 'Carlisle ST1 01 XL extension tip, 1 inch', 79.17, 93.99, null, 1279),
  ('336460', 'Carlisle ST1 15 XS extension tip, 1/2 inch', 79.17, 93.99, null, 1280),
  ('336461', 'Carlisle ST1 15 XL extension tip, 1 inch', 79.17, 93.99, null, 1281),
  ('336462', 'Carlisle ST1 02 XS extension tip, 1/2 inch', 79.17, 93.99, null, 1282),
  ('336463', 'Carlisle ST1 02 XL extension tip, 1 inch', 79.17, 93.99, null, 1283),
  ('347411', 'Carlisle ST1 gun cover', 34.6, 40.99, null, 1284),
  ('336740', 'Carlisle ST1 O-ring installation tool', 18.94, 22.99, null, 1285),
  ('336406', 'Carlisle ST1 grease cartridge, 3 oz', null, null, null, 1286),
  ('ST1-SPB', 'Carlisle ST1 mini spare parts kit (configuration varies)', 523.07, 617.99, null, 1287);

-- Parts already in the catalog: new price (only where CFS gave one), CFS's price to AMBIT, drop shipped by CFS.
update public.products p
   set vendor_cost = c.cost,
       list_price = coalesce(c.price, p.list_price),
       vendor_name = 'Contractors Foam Supply',
       drop_ship_partner = 'cfs',
       adc_image_url = coalesce(p.adc_image_url, c.img),
       updated_at = now()
  from cfs_prices c
 where upper(p.sku) = upper(c.sku);

-- Parts that weren't in the catalog: added to Guns & Parts (a picture cut from the gun drawing when there is one).
insert into public.products (sku, name, category_id, unit, list_price, vendor_cost, vendor_name, drop_ship_partner, adc_image_url, sort)
select c.sku, c.name, (select id from public.categories where id = 'guns-and-parts' or name ilike 'guns%parts' order by (id = 'guns-and-parts') desc limit 1),
       'each', c.price, c.cost, 'Contractors Foam Supply', 'cfs', c.img, c.sort
  from cfs_prices c
 where not exists (select 1 from public.products p where upper(p.sku) = upper(c.sku));

-- The other gun parts CFS supplies (drill bits, pump kits, hoses: CFS is the Preferred Vendor on the spreadsheet) are
-- drop shipped too, at their current prices.
update public.products p
   set drop_ship_partner = 'cfs', vendor_name = 'Contractors Foam Supply', updated_at = now()
 where p.category_id in (select id from public.categories where id = 'guns-and-parts' or name ilike 'guns%parts')
   and p.drop_ship_partner is null and not p.adc_hide
   and exists (select 1 from public.inventory v where v.product_id = p.id and v.vendor ilike 'contractor%foam%');

-- Black Friday: a sale price at or over the new price, or under CFS's price, becomes CFS price + 10%.
update public.web_sale_items i
   set price = round(p.vendor_cost * 1.10, 2)
  from public.products p
 where p.id = i.product_id and p.drop_ship_partner = 'cfs' and p.vendor_cost is not null and i.price is not null
   and (i.price >= p.list_price or i.price < p.vendor_cost);

drop table if exists pg_temp.cfs_prices;

-- ---------------------------------------------------------------- CFS's store
-- Items taken off ADC are switched off on CFS's store too.
update public.partner_items i
   set active = false, updated_at = now()
  from public.products p
 where i.partner_id = 'cfs' and p.id = i.product_id and (p.adc_hide or not p.active) and i.active;

-- Every gun part CFS supplies is on their price sheet (new ones switched off, for CFS to price and turn on).
insert into public.partner_items (partner_id, product_id, sku, name, category, unit, image_url, active, sort)
select 'cfs', p.id, p.sku, p.name, 'Guns & Parts', p.unit, coalesce(p.adc_image_url, p.image_url), false, p.sort
  from public.products p
 where p.drop_ship_partner = 'cfs' and p.active and not p.adc_hide
   and exists (select 1 from public.partners x where x.id = 'cfs')
   and not exists (select 1 from public.partner_items i where i.partner_id = 'cfs' and upper(i.sku) = upper(p.sku));

-- Check: gun parts and their prices now.
select count(*) filter (where drop_ship_partner = 'cfs') as "Drop shipped by CFS",
       count(*) filter (where drop_ship_partner = 'cfs' and list_price is not null) as "With a price",
       count(*) filter (where drop_ship_partner = 'cfs' and vendor_cost is not null) as "With CFS cost"
  from public.products;
