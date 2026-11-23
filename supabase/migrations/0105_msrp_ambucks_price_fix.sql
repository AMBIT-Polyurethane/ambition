-- 0105: gun parts show MSRP on ADC; AM-BUCKS on AMBIT Intelligence orders; admins fix prices on finished orders.
--  * Graco and Binks don't allow a price under MSRP to be shown. Every Guns & Parts item on ADC now shows its MSRP
--    (from Christian Fabrication's store, Nov 2026) with a small "MSRP" tag, never a sale price. An item with no
--    MSRP yet shows "Request a quote". The order desk applies the customer's real price when it confirms the order.
--    Inside AMBIT Intelligence nothing changes: orders still use our prices (list price, customer prices).
--  * AM-BUCKS: every customer account (never a distributor) earns 3 points per $100 of an AMBIT Intelligence order's
--    invoice prices when it's picked up or shipped out, from today on. A return takes its points back. The order desk
--    can put AM-BUCKS on an order (taken off the invoice), and the balance shows on the customer's page.
--  * An admin can change the prices on a finished order. It goes back to the order desk to update the QuickBooks
--    invoice, and the credit team is emailed to collect or credit the difference.
-- Safe to run again.

-- ---------------------------------------------------------------- MSRP
alter table public.products add column if not exists msrp numeric(12,2);
alter table public.products drop constraint if exists products_msrp_check;
alter table public.products add constraint products_msrp_check check (msrp is null or msrp >= 0);
alter table public.categories add column if not exists adc_msrp boolean not null default false;
update public.categories set adc_msrp = true where id = 'guns-and-parts' or name ilike 'guns%parts';

drop table if exists pg_temp.msrp_list;
create temp table msrp_list (sku text primary key, msrp numeric);
insert into msrp_list (sku, msrp) values
  ('100846', 7.80),
  ('114070', 20.60),
  ('116550', 11.10),
  ('117485', 7.00),
  ('117490', 4.30),
  ('117509', 16.80),
  ('117510', 54.00),
  ('117559', 5.65),
  ('117634', 16.80),
  ('117635', 16.80),
  ('118594', 8.20),
  ('119421', 5.05),
  ('119626', 20.70),
  ('127596', 7.45),
  ('127597', 7.45),
  ('131971PKG', 24.60),
  ('15B202', 30.70),
  ('15B203', 178.00),
  ('15B204', 155.50),
  ('15B205', 24.10),
  ('15B206', 53.50),
  ('15B208', 39.00),
  ('15B209', 63.25),
  ('15B210', 107.50),
  ('15B214', 19.70),
  ('15B223', 30.70),
  ('15B565', 20.80),
  ('15B689', 26.90),
  ('15B772', 41.30),
  ('15B993', 50.50),
  ('15C480', 22.30),
  ('15C852', 415.00),
  ('15D546', 155.00),
  ('15K365', 1195.00),
  ('172479', 0.00),
  ('17V093', 7.45),
  ('17X756', 511.00),
  ('17X757', 1355.00),
  ('18C115', 138.00),
  ('18C116', 2100.00),
  ('192272', 27.70),
  ('19Y300', 235.50),
  ('19Y301', 668.00),
  ('19Y302', 218.00),
  ('19Y303', 556.00),
  ('19Y308', 981.00),
  ('2000715', 29.28),
  ('2000716', 86.00),
  ('2000788', 35.00),
  ('2000810', 275.00),
  ('2000811', 750.00),
  ('2000812', 1125.00),
  ('2000971', 292.50),
  ('2000972', 125.00),
  ('2000973', 1150.00),
  ('2000974', 785.00),
  ('2000975', 165.00),
  ('2000976', 59.00),
  ('2000978', 375.00),
  ('2000979', 175.00),
  ('2000980', 28.75),
  ('2000981', 35.00),
  ('2001025', 95.00),
  ('2001026', 95.00),
  ('2001027', 78.50),
  ('2001028', 245.00),
  ('2001029', 12.50),
  ('2001031', 65.00),
  ('2001032', 65.00),
  ('2001033', 35.00),
  ('2001148', 36.00),
  ('2001150', 48.50),
  ('2001151', 12.50),
  ('2001152', 38.80),
  ('2001153', 32.00),
  ('2001166', 265.00),
  ('2001167', 23.50),
  ('2001168', 110.00),
  ('2001169', 8.50),
  ('2001170', 24.50),
  ('2001307', 132.00),
  ('2001433', 59.00),
  ('2001434', 59.00),
  ('2002324', 425.00),
  ('2002347', 550.00),
  ('2002360', 395.00),
  ('2005061', 7.50),
  ('2005266', 110.00),
  ('2005267', 110.00),
  ('2005268', 110.00),
  ('2005269', 124.00),
  ('2005366', 28.50),
  ('2005697', 24.00),
  ('2005698', 38.00),
  ('2005699', 63.20),
  ('2006158', 134.00),
  ('2006546', 49.50),
  ('2006548', 49.50),
  ('2006550', 49.50),
  ('2006552', 49.50),
  ('2006553', 49.50),
  ('2006560', 49.50),
  ('2006566', 995.00),
  ('2006911', 22.00),
  ('2006912', 24.00),
  ('2007204', 16.50),
  ('2007251', 10.50),
  ('2007352', 195.00),
  ('2007692', 110.00),
  ('2010991', 46.50),
  ('203953', 5.00),
  ('206996', 163.50),
  ('246012', 551.00),
  ('246352', 125.50),
  ('246354', 25.20),
  ('246355', 180.50),
  ('246356', 81.75),
  ('246357', 59.00),
  ('246358', 59.00),
  ('246359', 57.50),
  ('246362', 295.50),
  ('246626', 53.00),
  ('246627', 54.00),
  ('246628', 54.00),
  ('246629', 54.00),
  ('246731', 125.50),
  ('246814', 54.00),
  ('246962', 239.00),
  ('246964', 234.00),
  ('247824', 401.00),
  ('248013', 120.00),
  ('248019', 86.25),
  ('248064', 313.00),
  ('248129', 41.10),
  ('248130', 67.75),
  ('248131', 51.00),
  ('248132', 101.50),
  ('248133', 79.25),
  ('248134', 47.30),
  ('248135', 113.00),
  ('248136', 109.50),
  ('248137', 43.80),
  ('248528', 275.50),
  ('248893', 54.00),
  ('24R894', 59.00),
  ('256385', 294.00),
  ('256386', 500.00),
  ('256387', 785.00),
  ('256773', 79.75),
  ('257420', 42.00),
  ('25M239', 177.00),
  ('25M247', 147.50),
  ('25P587', 3870.00),
  ('25P588', 3870.00),
  ('25P589', 3870.00),
  ('25P590', 3870.00),
  ('25P591', 3540.00),
  ('25P660', 36.10),
  ('25P701', 1615.00),
  ('25P702', 1615.00),
  ('25P704', 1275.00),
  ('25P771', 1760.00),
  ('25P850', 41.70),
  ('25P851', 53.50),
  ('25R084', 3870.00),
  ('25R085', 3870.00),
  ('26C775', 142.00),
  ('26C937', 47.50),
  ('336335', 6.50),
  ('336336', 6.70),
  ('336352', 1115.00),
  ('336353', 351.00),
  ('336354', 482.00),
  ('336355', 191.00),
  ('336356', 27.50),
  ('336357', 15.50),
  ('336358', 15.50),
  ('336359', 48.00),
  ('336360', 104.00),
  ('336361', 104.00),
  ('336362', 6.50),
  ('336363', 27.00),
  ('336364', 31.00),
  ('336365', 50.50),
  ('336366', 36.00),
  ('336367', 5.05),
  ('336370', 149.00),
  ('336372', 94.00),
  ('336373', 140.00),
  ('336374', 17.50),
  ('336375', 140.00),
  ('336376', 140.00),
  ('336377', 132.00),
  ('336378', 6.50),
  ('336379', 47.00),
  ('336381', 62.00),
  ('336394', 115.00),
  ('336395', 60.00),
  ('336396', 18.50),
  ('336397', 50.50),
  ('336398', 35.00),
  ('336399', 37.50),
  ('336400', 25.00),
  ('336401', 37.50),
  ('336408', 27.50),
  ('336410', 1020.00),
  ('336411', 1515.00),
  ('336412', 58.50),
  ('336413', 30.50),
  ('336414', 59.00),
  ('336415', 67.50),
  ('336417', 37.00),
  ('336418', 134.00),
  ('336419', 28.00),
  ('336420', 27.50),
  ('336421', 166.00),
  ('336422', 63.00),
  ('336423', 63.00),
  ('336424', 1910.00),
  ('336426', 953.00),
  ('336427', 37.50),
  ('336428', 74.00),
  ('336429', 562.00),
  ('336430', 140.00),
  ('336431', 140.00),
  ('336433', 79.00),
  ('336436', 216.00),
  ('336437', 102.00),
  ('336440', 234.00),
  ('336441', 234.00),
  ('336442', 234.00),
  ('336443', 234.00),
  ('336444', 234.00),
  ('336445', 234.00),
  ('336446', 210.00),
  ('336447', 210.00),
  ('336448', 210.00),
  ('336449', 210.00),
  ('336450', 210.00),
  ('336451', 210.00),
  ('336453', 67.50),
  ('336454', 67.50),
  ('336455', 67.50),
  ('336456', 67.50),
  ('336457', 67.50),
  ('336458', 108.00),
  ('336459', 108.00),
  ('336460', 108.00),
  ('336461', 108.00),
  ('336462', 108.00),
  ('336463', 108.00),
  ('336507', 3800.00),
  ('336508', 3800.00),
  ('336509', 3800.00),
  ('336643', 45.00),
  ('336735', 6.50),
  ('336736', 75.00),
  ('336737', 63.00),
  ('336738', 16.50),
  ('336802', 175.00),
  ('336803', 175.00),
  ('336804', 175.00),
  ('336805', 175.00),
  ('336806', 175.00),
  ('340564', 132.00),
  ('347411', 48.95),
  ('FX20RD', 151.00),
  ('FX29RD', 151.00),
  ('FX34RD', 151.00),
  ('FX37RD', 145.00),
  ('FX42RD', 145.00),
  ('FX47RD', 145.00),
  ('FX52RD', 145.00),
  ('FX60RD', 145.00),
  ('FX70RD', 145.00),
  ('FX9001', 4150.00),
  ('PC20RD', 295.00),
  ('PC29RD', 295.00),
  ('PC37RD', 295.00),
  ('PC42RD', 295.00),
  ('PC47RD', 295.00),
  ('PC52RD', 295.00),
  ('PC60RD', 295.00),
  ('PC70RD', 295.00),
  ('117642', 35.80),
  ('117661', 60.00),
  ('118575', 8.85),
  ('248279', 173.50),
  ('248280', 102.00),
  ('24Z834', 1695.00);

update public.products p set msrp = m.msrp, updated_at = now()
  from msrp_list m
 where upper(p.sku) = upper(m.sku) and p.msrp is distinct from m.msrp;
drop table if exists pg_temp.msrp_list;

-- The store: an MSRP item (Guns & Parts) shows its MSRP and never a sale price; no MSRP yet = "Request a quote".
drop function if exists public.adc_catalog();
create function public.adc_catalog()
returns table (id uuid, sku text, name text, description text, unit text, category_id text, category text, cat_sort int,
               list_price numeric, quote boolean, sale_price numeric, image text, sort int, ship text, truck_qty numeric, is_set boolean,
               msrp boolean)
language sql stable security definer set search_path = public as $fn$
  with sale as (select s.id from public.web_sales s
                 where s.active and (now() at time zone 'America/Chicago')::date between s.starts_on and s.ends_on
                 order by s.ends_on limit 1)
  select pr.id, pr.sku, pr.name, pr.description, pr.unit, pr.category_id, c.name, coalesce(c.sort, 999),
         case when coalesce(c.adc_msrp, false) then pr.msrp
              when coalesce(pr.customer_priced, c.customer_priced, false) then null else pr.list_price end,
         case when coalesce(c.adc_msrp, false) then pr.msrp is null
              else (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null) and sp.price is null end,
         case when coalesce(c.adc_msrp, false) then null else sp.price end,
         pr.adc_image_url, coalesce(pr.sort, 0),
         coalesce(pr.adc_ship, c.adc_ship, 'parcel'), pr.truck_qty, pr.adc_set,
         coalesce(c.adc_msrp, false)
    from public.products pr
    left join public.categories c on c.id = pr.category_id
    left join lateral (
      select max(v.sell_price) as price from public.inventory v where v.product_id = pr.id and v.sell_price > 0
    ) sheet on true
    left join lateral (
      select greatest(i.price, round(coalesce(pr.list_price, sheet.price) * 0.95, 2)) as price
        from public.web_sale_items i join sale on sale.id = i.sale_id
       where i.product_id = pr.id and i.price is not null and pr.category_id is distinct from 'ambit-foam'
         and coalesce(pr.list_price, sheet.price) is not null
         and (coalesce(pr.customer_priced, c.customer_priced, false) or pr.list_price is null or i.price < pr.list_price)
       limit 1
    ) sp on true
   where pr.active and not coalesce(pr.admin_only, false) and not coalesce(c.admin_only, false) and not pr.adc_hide
$fn$;
revoke execute on function public.adc_catalog() from public;
grant execute on function public.adc_catalog() to anon, authenticated;

-- ---------------------------------------------------------------- AM-BUCKS on AMBIT Intelligence orders
alter table public.am_bucks_ledger alter column user_id drop not null;
alter table public.am_bucks_ledger add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.am_bucks_ledger add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.am_bucks_ledger drop constraint if exists am_bucks_ledger_who_check;
alter table public.am_bucks_ledger add constraint am_bucks_ledger_who_check check (user_id is not null or company_id is not null);
create index if not exists am_bucks_company on public.am_bucks_ledger(company_id, created_at desc) where company_id is not null;
create unique index if not exists am_bucks_order_earn on public.am_bucks_ledger(order_id) where order_id is not null and kind = 'earn';
create index if not exists am_bucks_order on public.am_bucks_ledger(order_id) where order_id is not null;

drop policy if exists am_bucks_read on public.am_bucks_ledger;
create policy am_bucks_read on public.am_bucks_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.has_perm('order_desk') or (company_id is not null and public.is_employee()));

-- Orders picked up or shipped out from today on earn (orders before the program started don't).
update public.app_settings
   set value = value || jsonb_build_object('orders_from', to_char((now() at time zone 'America/Chicago')::date, 'YYYY-MM-DD'))
 where key = 'am_bucks' and not (value ? 'orders_from');

create or replace function public.am_bucks_company_balance(p_company uuid) returns int
language sql stable security definer set search_path = public as $fn$
  select case when public.is_employee() then coalesce((select sum(points) from public.am_bucks_ledger where company_id = p_company), 0)::int end
$fn$;
revoke all on function public.am_bucks_company_balance(uuid) from public, anon;
grant execute on function public.am_bucks_company_balance(uuid) to authenticated;

-- What one order earns: 3 points per $100 of its invoice prices once it's picked up or shipped out. A return takes
-- its points back. Distributors never earn. A cancelled order gives back any AM-BUCKS used on it.
create or replace function public.am_bucks_order_sync(p_order uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  o     public.orders;
  dist  boolean;
  rate  numeric := coalesce((select (value->>'points_per_dollar')::numeric from public.app_settings where key = 'am_bucks'), 0.03);
  since date := coalesce((select (value->>'orders_from')::date from public.app_settings where key = 'am_bucks'), (now() at time zone 'America/Chicago')::date);
  pts   int := 0;
  label text;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then return; end if;
  if o.status = 'cancelled' then
    delete from public.am_bucks_ledger where order_id = o.id;
    return;
  end if;
  select coalesce(c.distributor, false) into dist from public.companies c where c.id = o.company_id;
  if o.status = 'completed' and o.company_id is not null and not coalesce(dist, true) and o.priced_at is not null
     and (coalesce(o.completed_at, now()) at time zone 'America/Chicago')::date >= since then
    if coalesce(o.kind, 'sale') = 'sale' then
      pts := floor(greatest(coalesce(o.est_subtotal, 0), 0) * rate)::int;
    elsif o.kind = 'return' then
      pts := -floor(abs(coalesce(o.est_subtotal, 0)) * rate)::int;
    end if;
  end if;
  label := case when o.kind = 'return' then 'Return ORD-' else 'Order ORD-' end || o.order_no;
  if pts = 0 then
    delete from public.am_bucks_ledger where order_id = o.id and kind = 'earn';
  else
    insert into public.am_bucks_ledger (company_id, order_id, points, kind, note, created_by_name)
    values (o.company_id, o.id, pts, 'earn', label, 'AMBIT Intelligence')
    on conflict (order_id) where order_id is not null and kind = 'earn'
    do update set points = excluded.points, company_id = excluded.company_id, note = excluded.note;
  end if;
end $fn$;
revoke all on function public.am_bucks_order_sync(uuid) from public, anon, authenticated;

create or replace function public.orders_am_bucks() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform public.am_bucks_order_sync(new.id);
  return null;
end $fn$;
revoke all on function public.orders_am_bucks() from public, anon, authenticated;
drop trigger if exists orders_am_bucks on public.orders;
create trigger orders_am_bucks after insert or update of status, est_subtotal, priced_at, company_id, kind, completed_at on public.orders
  for each row execute function public.orders_am_bucks();

-- A customer marked (or unmarked) as a distributor: their finished orders since the start are counted again.
create or replace function public.companies_am_bucks() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if new.distributor is distinct from old.distributor then
    for r in select id from public.orders where company_id = new.id and status = 'completed' loop
      perform public.am_bucks_order_sync(r.id);
    end loop;
  end if;
  return null;
end $fn$;
revoke all on function public.companies_am_bucks() from public, anon, authenticated;
drop trigger if exists companies_am_bucks on public.companies;
create trigger companies_am_bucks after update of distributor on public.companies
  for each row execute function public.companies_am_bucks();

-- The order desk puts the customer's AM-BUCKS on an order (they come off the invoice). Again replaces the amount.
create or replace function public.order_bucks_use(p_order uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  o    public.orders;
  dist boolean;
  pv   numeric := coalesce((select (value->>'point_value')::numeric from public.app_settings where key = 'am_bucks'), 0.01);
  pts  int;
  bal  int;
  who  text := coalesce(public.my_name(), 'AMBIT');
begin
  if not (public.is_admin() or public.has_perm('order_desk')) then raise exception 'Only the order desk can use AM-BUCKS on an order.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if o.company_id is null then raise exception 'This order has no customer account.'; end if;
  select coalesce(c.distributor, false) into dist from public.companies c where c.id = o.company_id;
  if dist then raise exception 'Distributors don''t earn or use AM-BUCKS.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Type the dollar amount to use, like 25.00.'; end if;
  pts := round(p_amount / pv)::int;
  delete from public.am_bucks_ledger where order_id = o.id and kind = 'redeem';
  select coalesce(sum(points), 0)::int into bal from public.am_bucks_ledger where company_id = o.company_id;
  if pts > bal then
    raise exception 'They only have $% in AM-BUCKS.', to_char(bal * pv, 'FM999999990.00');
  end if;
  insert into public.am_bucks_ledger (company_id, order_id, points, kind, note, created_by, created_by_name)
  values (o.company_id, o.id, -pts, 'redeem', 'Used on ORD-' || o.order_no, auth.uid(), who);
  return jsonb_build_object('points', pts, 'amount', round(pts * pv, 2), 'left', bal - pts, 'left_amount', round((bal - pts) * pv, 2));
end $fn$;
revoke all on function public.order_bucks_use(uuid, numeric) from public, anon;
grant execute on function public.order_bucks_use(uuid, numeric) to authenticated;

create or replace function public.order_bucks_undo(p_order uuid) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if not (public.is_admin() or public.has_perm('order_desk')) then raise exception 'Only the order desk can change AM-BUCKS on an order.'; end if;
  delete from public.am_bucks_ledger where order_id = p_order and kind = 'redeem';
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.order_bucks_undo(uuid) from public, anon;
grant execute on function public.order_bucks_undo(uuid) to authenticated;

-- ---------------------------------------------------------------- an admin fixes the prices on a finished order
-- Like correcting a finished order's items: it goes back to the order desk to update the QuickBooks invoice (then
-- the credit team is emailed to collect or credit the difference). p_prices is the same shape the order desk saves:
-- [{"id": 12, "price": 45.5}] or, for ISO split by foam set, [{"id": 12, "parts": [{"with": 34, "qty": 12, "price": 1085}]}].
create or replace function public.order_fix_prices(p_order uuid, p_prices jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  o       public.orders;
  it      public.order_items;
  e       jsonb;
  pt      jsonb;
  pr      numeric;
  pq      numeric;
  tot     numeric;
  n       numeric;
  parts   jsonb;
  oldp    numeric;
  newp    numeric;
  before  numeric;
  after   numeric;
  changes jsonb := '[]'::jsonb;
  rev     int;
  who     text := coalesce(public.my_name(), 'Admin');
begin
  if not public.is_admin() then raise exception 'Only an admin can change prices on a finished order.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'completed' then raise exception 'This order isn''t finished. Use Sales Order # & prices on the order instead.'; end if;
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) = 0 then raise exception 'Prices are missing.'; end if;
  before := coalesce(o.est_subtotal, 0);
  for e in select * from jsonb_array_elements(p_prices) loop
    select * into it from public.order_items where id = (e->>'id')::bigint and order_id = p_order;
    if it.id is null then continue; end if;
    oldp := it.unit_price;
    if jsonb_typeof(e->'parts') = 'array' and jsonb_array_length(e->'parts') > 0 then
      tot := 0; n := 0; parts := '[]'::jsonb;
      for pt in select * from jsonb_array_elements(e->'parts') loop
        begin
          pr := round((pt->>'price')::numeric, 2);
          pq := (pt->>'qty')::numeric;
        exception when others then
          raise exception 'A price isn''t a number: %', pt->>'price';
        end;
        if pr is null or pr < 0 then raise exception 'Enter every ISO price for % (zero or more).', it.sku; end if;
        if pq is null or pq <= 0 then raise exception 'The % split isn''t right. Reload the page and try again.', it.sku; end if;
        tot := tot + round(pr * pq, 2);
        n := n + pq;
        parts := parts || jsonb_build_array(jsonb_build_object('with', case when jsonb_typeof(pt->'with') = 'number' then (pt->>'with')::bigint end, 'qty', pq, 'price', pr));
      end loop;
      if n <> it.qty then raise exception 'The % prices cover % drums but the order has %. Reload the page and try again.', it.sku, trim_scale(n), trim_scale(it.qty); end if;
      newp := round(tot / it.qty, 2);
      if it.line_total is distinct from tot or it.price_parts is distinct from parts then
        update public.order_items set unit_price = newp, line_total = tot, price_parts = parts where id = it.id;
        changes := changes || jsonb_build_object('kind', 'price', 'sku', it.sku, 'name', it.name, 'unit', it.unit, 'from', oldp, 'to', newp);
      end if;
      continue;
    end if;
    if coalesce(e->>'price', '') = '' then raise exception 'Enter the price for %.', it.sku; end if;
    begin
      pr := round((e->>'price')::numeric, 2);
    exception when others then
      raise exception 'A price isn''t a number: %', e->>'price';
    end;
    if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
    if oldp is distinct from pr then
      update public.order_items set unit_price = pr, line_total = round(pr * qty, 2), price_parts = null where id = it.id;
      changes := changes || jsonb_build_object('kind', 'price', 'sku', it.sku, 'name', it.name, 'unit', it.unit, 'from', oldp, 'to', pr);
    end if;
  end loop;
  if jsonb_array_length(changes) = 0 then raise exception 'Nothing changed: every price is the same as before.'; end if;
  after := coalesce((select sum(coalesce(i.line_total, 0)) from public.order_items i where i.order_id = p_order), 0);
  update public.orders
     set est_subtotal = after, priced_at = now(), priced_by_name = who,
         revision = coalesce(revision, 1) + 1,
         invoiced_total = coalesce(invoiced_total, before),
         invoice_update_at = coalesce(invoice_update_at, now()),
         invoice_update_by_name = who
   where id = p_order
  returning revision into rev;
  insert into public.order_edits (order_id, revision, edited_by, edited_by_name, stage_before, changes, total_before, note, admin_needed)
  values (p_order, rev, auth.uid(), who, o.stage, changes, before, nullif(left(trim(coalesce(p_note, '')), 500), ''), false);
  return jsonb_build_object('revision', rev, 'before', before, 'after', after, 'changes', changes);
end $fn$;
revoke all on function public.order_fix_prices(uuid, jsonb, text) from public, anon;
grant execute on function public.order_fix_prices(uuid, jsonb, text) to authenticated;

-- Check: gun parts with an MSRP, and the AM-BUCKS start date.
select (select count(*) from public.products p join public.categories c on c.id = p.category_id
         where c.adc_msrp and p.active and not p.adc_hide and p.msrp is not null) as "Gun parts with MSRP",
       (select count(*) from public.products p join public.categories c on c.id = p.category_id
         where c.adc_msrp and p.active and not p.adc_hide and p.msrp is null) as "Gun parts to quote",
       (select value->>'orders_from' from public.app_settings where key = 'am_bucks') as "AM-BUCKS orders from";
