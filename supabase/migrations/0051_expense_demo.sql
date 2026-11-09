-- =====================================================================
-- AMBIT Intelligence update 0051 - Expense reports: demo data
-- * Five made-up employees (marked as demo; they can't sign in and get no email) with about five months of
--   receipts, Chase card charges and monthly reports, tied to AMBIT customers, so the approval screens and the
--   expense dashboard can be shown before real employees start.
-- * Admin > Expense reports > Setup: "Delete demo data" takes all of it away (and "Load demo data" puts it back).
-- Run once in Supabase > SQL Editor. Safe to run again (it never loads the demo twice).
-- =====================================================================

alter table public.profiles        add column if not exists demo boolean not null default false;
alter table public.expense_charges add column if not exists demo boolean not null default false;
alter table public.expense_cards   add column if not exists demo boolean not null default false;
alter table public.expense_imports add column if not exists demo boolean not null default false;

-- Staff logins must be @ambitpu.com; the made-up demo employees are the one exception (they can't sign in).
alter table public.profiles drop constraint if exists staff_must_be_ambit;
alter table public.profiles add constraint staff_must_be_ambit check (role = 'customer' or email like '%@ambitpu.com' or demo) not valid;

-- Small helpers (not callable from the app).
create or replace function public.xd_pick(p text[]) returns text
language sql volatile as $$ select p[1 + floor(random() * array_length(p, 1))::int] $$;
create or replace function public.xd_rnd(a numeric, b numeric) returns numeric
language sql volatile as $$ select round(a + (b - a) * random()::numeric, 2) $$;
revoke all on function public.xd_pick(text[]) from public, anon, authenticated;
revoke all on function public.xd_rnd(numeric, numeric) from public, anon, authenticated;

-- One demo purchase: the receipt (with a made-up photo, or a lost-receipt reason) and its card charge.
-- p_tip_after: a tip added after the receipt was printed (the card is charged more). p_no_receipt: only the charge.
create or replace function public.xd_buy(
  p_user uuid, p_card text, p_day date, p_vendor text, p_amount numeric, p_cat text,
  p_company uuid default null, p_customer text default null, p_purpose text default null, p_people text default null,
  p_personal boolean default false, p_tip_after numeric default 0, p_lost text default null, p_no_receipt boolean default false,
  p_import uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := gen_random_uuid();
  at timestamptz := (p_day + time '17:30' + (floor(random() * 240) || ' minutes')::interval) at time zone 'America/Chicago';
  ch_day date := p_day + case when random() < 0.25 then 1 else 0 end;
begin
  if not p_no_receipt then
    insert into public.expense_receipts (id, user_id, bought_on, vendor, amount, category, paid_with, card_last4, company_id, customer_name,
                                         purpose, attendees, photos, no_photo_reason, created_at)
    values (rid, p_user, p_day, p_vendor, p_amount, p_cat, case when p_personal then 'personal' else 'card' end,
            case when p_personal then null else p_card end, p_company,
            coalesce((select name from public.companies where id = p_company), p_customer), p_purpose, p_people,
            case when p_lost is null then array['demo:' || rid::text] else '{}' end, p_lost, at);
  end if;
  if not p_personal then
    insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, bank_category, kind,
                                        amount, receipt_id, match_how, demo, import_id, imported_at)
    values ('upload', 'demo:' || gen_random_uuid()::text, p_card, p_user, ch_day, ch_day + 1,
            upper(p_vendor) || ' #' || (100 + floor(random() * 899))::text, p_vendor,
            case p_cat when 'Fuel' then 'Gas' when 'Meals' then 'Food & Drink' when 'Customer entertainment' then 'Entertainment'
                       when 'Lodging' then 'Travel' when 'Airfare & travel' then 'Travel' when 'Shipping' then 'Shipping' else 'Shopping' end,
            'purchase', p_amount + coalesce(p_tip_after, 0), case when p_no_receipt then null else rid end,
            case when p_no_receipt then null else 'auto' end, true, p_import, at);
  end if;
  return case when p_no_receipt then null else rid end;
end $$;
revoke all on function public.xd_buy(uuid, text, date, text, numeric, text, uuid, text, text, text, boolean, numeric, text, boolean, uuid) from public, anon, authenticated;

-- ---------- Load the demo ------------------------------------------------
create or replace function public.expense_demo_fill() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  first_m date := (date_trunc('month', (now() at time zone 'America/Chicago')::date) - interval '5 months')::date;
  d date;
  dow int;
  mo int;
  m date;
  r numeric;
  i int;
  c int;
  cust uuid[];
  br text[];
  appr uuid[];
  appr_name text[];
  ty uuid; mr uuid; dw uuid; lo uuid; bc uuid;
  imp uuid;
  people jsonb;
  p jsonb;
  uid uuid;
  ids uuid[] := '{}';
  cards text[] := '{}';
  l4 text;
  pick uuid;
  fav uuid;
  amt numeric;
  tip numeric;
  n_rec int;
  n_chg int;
  st jsonb;
  has_aud boolean;
  col text;
begin
  if auth.uid() is not null and not public.is_expense_approver() then raise exception 'Only an expense approver can load the demo.'; end if;
  if exists (select 1 from public.profiles where demo) then raise exception 'The demo is already loaded. Delete it first (Admin > Expense reports > Setup).'; end if;
  perform setseed(0.4242);

  -- AMBIT customers with the most orders lately (so the dashboard's "cost of sales" has real sales next to it).
  select array_agg(id) into cust from (
    select c.id
      from public.companies c
      left join public.orders o on o.company_id = c.id and o.status <> 'cancelled' and o.created_at > now() - interval '240 days'
     where c.active
     group by c.id
     order by coalesce(sum(coalesce(o.invoiced_total, o.est_subtotal)), 0) desc, c.name
     limit 14) x;
  if coalesce(array_length(cust, 1), 0) < 14 then raise exception 'The demo needs at least 14 customers in the customer list.'; end if;
  select array_agg(id order by sort) into br from public.branches where active;
  br := br || array[br[1], br[1], br[1], br[1], br[1]];
  select array_agg(id order by (lower(email) in ('kevin.lall@ambitpu.com', 'kim.hight@ambitpu.com')) desc, full_name),
         array_agg(coalesce(full_name, email) order by (lower(email) in ('kevin.lall@ambitpu.com', 'kim.hight@ambitpu.com')) desc, full_name)
    into appr, appr_name
    from public.profiles where expense_approver and status = 'active';

  -- ---- five made-up employees (no password, blocked from signing in, an address that can't get email)
  has_aud := exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud');
  people := '[{"k":"ty","name":"Tyler Brooks","job":"tech","br":1},{"k":"mr","name":"Marcus Reed","job":"sales_rep","br":2},
              {"k":"dw","name":"Dana Whitfield","job":"sales_rep","br":5},{"k":"lo","name":"Luis Ortega","job":"tech","br":3},
              {"k":"bc","name":"Brandon Cole","job":"warehouse","br":1}]'::jsonb;
  c := 0;
  for p in select * from jsonb_array_elements(people) loop
    c := c + 1;
    uid := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, banned_until)
    values (uid, 'demo.' || replace(lower(p->>'name'), ' ', '.') || '@expense-demo.invalid',
            jsonb_build_object('full_name', p->>'name', 'demo', true), '{"provider":"demo"}'::jsonb, now() - interval '200 days', now(), '2999-12-31');
    if has_aud then
      execute 'update auth.users set aud = ''authenticated'', role = ''authenticated'', instance_id = ''00000000-0000-0000-0000-000000000000'' where id = $1' using uid;
    end if;
    -- Supabase's sign-in service expects these as empty text, not missing.
    for col in select column_name from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
                  and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'email_change',
                                      'phone_change', 'phone_change_token', 'reauthentication_token') loop
      execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', col, col) using uid;
    end loop;
    update public.profiles
       set full_name = p->>'name', role = 'employee', status = 'disabled', job_role = p->>'job', branch_id = br[(p->>'br')::int], demo = true
     where id = uid;
    -- A card number nobody real has.
    l4 := null;
    for i in 0..40 loop
      if not exists (select 1 from public.expense_cards where last4 = (9101 + c + i * 7)::text) then l4 := (9101 + c + i * 7)::text; exit; end if;
    end loop;
    insert into public.expense_cards (last4, user_id, label, demo) values (l4, uid, split_part(p->>'name', ' ', 1) || '''s card (demo)', true);
    ids := ids || uid;
    cards := cards || l4;
  end loop;
  ty := ids[1]; mr := ids[2]; dw := ids[3]; lo := ids[4]; bc := ids[5];

  insert into public.expense_imports (source, file_name, rows, added, skipped, date_from, date_to, by_name, at, demo)
  values ('upload', 'Chase activity (demo).CSV', 0, 0, 0, first_m, today - 1, 'Demo', now() - interval '1 day', true)
  returning id into imp;

  -- ---- day by day
  d := first_m;
  while d < today loop
    dow := extract(isodow from d)::int;
    mo := (extract(year from d) * 12 + extract(month from d))::int - (extract(year from first_m) * 12 + extract(month from first_m))::int; -- 0..5

    if dow <= 5 then
      -- Tyler (tech, OKC): rig service calls, more and more at one customer.
      if random() < 0.24 + mo * 0.04 then
        r := random();
        pick := case when r < 0.45 + mo * 0.06 then cust[3] when r < 0.85 then cust[6] else cust[9] end;
        perform public.xd_buy(ty, cards[1], d, public.xd_pick(array['OnCue', 'Love''s', 'QuikTrip', 'OnCue']), public.xd_rnd(52, 96), 'Fuel', pick, null,
                              public.xd_pick(array['Rig service call', 'Gun rebuild on site', 'Proportioner troubleshooting', 'Hose heat problem']), null, false, 0, null, false, imp);
        if pick = cust[9] then
          perform public.xd_buy(ty, cards[1], d, 'Hampton Inn Amarillo', public.xd_rnd(124, 169), 'Lodging', pick, null, 'Overnight: proportioner rebuild', null, false, 0, null, false, imp);
          perform public.xd_buy(ty, cards[1], d, public.xd_pick(array['Whataburger', 'Chili''s', 'Braum''s']), public.xd_rnd(13, 31), 'Meals', null, null, 'Dinner on the road', null, false, 0, null, false, imp);
        end if;
        if random() < 0.16 then
          perform public.xd_buy(ty, cards[1], d, public.xd_pick(array['Northern Tool', 'Graco parts counter', 'Fastenal']), public.xd_rnd(78, 285), 'Tools & supplies', pick, null,
                                public.xd_pick(array['Proportioner seals', 'Gun mix chamber', 'Heated hose repair kit']), null, false, 0, null, false, imp);
        end if;
      end if;

      -- Marcus (sales, Arlington): lunches and outings, more and more with one customer that doesn't buy much.
      if random() < 0.30 + mo * 0.03 then
        r := random();
        fav := cust[13];
        pick := case when r < 0.40 + mo * 0.07 then fav when r < 0.75 then cust[2] else cust[5] end;
        amt := public.xd_rnd(68, 245);
        tip := case when random() < 0.35 then round((amt * (0.17 + random() * 0.05))::numeric, 2) else 0 end;
        perform public.xd_buy(mr, cards[2], d, public.xd_pick(array['Texas Land & Cattle', 'Pappadeaux', 'Saltgrass Steak House', 'Chuy''s', 'Joe T. Garcia''s']), amt, 'Meals', pick, null,
                              public.xd_pick(array['Lunch: fall orders', 'Lunch: closed-cell pricing', 'Lunch with the owner', 'Lunch: new crew lead']),
                              public.xd_pick(array['Owner and office manager', 'Owner', 'Owner and crew lead', 'Estimator']), false, tip, null, false, imp);
        if random() < 0.45 then
          perform public.xd_buy(mr, cards[2], d, public.xd_pick(array['QuikTrip', 'RaceTrac', 'Buc-ee''s']), public.xd_rnd(44, 76), 'Fuel', pick, null, 'Customer visit', null, false, 0, null, false, imp);
        end if;
        if random() < 0.11 + mo * 0.02 then
          perform public.xd_buy(mr, cards[2], d + 1, public.xd_pick(array['Topgolf', 'Texas Rangers tickets', 'Main Event']), public.xd_rnd(185, 540), 'Customer entertainment', pick, null,
                                'Customer appreciation', public.xd_pick(array['Owner and 2 crew', 'Owner and wife', 'Crew of 4']), false, 0, null, false, imp);
        end if;
      end if;

      -- Luis (tech, San Marcos): startups and training, supplies, now and then paid personally or a lost receipt.
      if random() < 0.27 then
        r := random();
        pick := case when r < 0.45 then cust[7] when r < 0.85 then cust[10] else null end;
        perform public.xd_buy(lo, cards[4], d, public.xd_pick(array['Buc-ee''s', 'Valero', 'H-E-B Fuel']), public.xd_rnd(48, 88), 'Fuel', pick,
                              case when pick is null then 'Hill Country Insulation (prospect)' end,
                              public.xd_pick(array['Rig startup and training', 'Startup: new rig', 'Spray training']), null, false, 0,
                              case when random() < 0.06 then 'The pump didn''t print a receipt' end, false, imp);
        if random() < 0.38 then
          perform public.xd_buy(lo, cards[4], d, public.xd_pick(array['Home Depot', 'Lowe''s', 'Ace Hardware']), public.xd_rnd(19, 182), 'Tools & supplies', pick,
                                case when pick is null then 'Hill Country Insulation (prospect)' end,
                                public.xd_pick(array['Poly, tape and masking', 'Generator fuel cans', 'Shop supplies']), null, random() < 0.12, 0, null, false, imp);
        end if;
      end if;

      -- Brandon (warehouse / delivery driver, OKC): diesel for deliveries.
      if random() < 0.36 then
        r := random();
        perform public.xd_buy(bc, cards[5], d, public.xd_pick(array['Love''s Travel Stop', 'Pilot', 'OnCue']), public.xd_rnd(118, 286), 'Fuel',
                              case when r < 0.35 then cust[1 + floor(random() * 14)::int] end, null, 'Box truck: deliveries', null, false, 0, null, false, imp);
      end if;
    end if;

    -- Dana (sales, Mobile): a trip to a big customer each month, local lunches every week.
    if extract(day from d) = 11 + (mo % 3) and d + 2 < today then
      pick := case when mo % 2 = 0 then cust[1] else cust[4] end;
      perform public.xd_buy(dw, cards[3], d, 'Southwest Airlines', public.xd_rnd(286, 468), 'Airfare & travel', pick, null, 'Site visit and crew training', null, false, 0, null, false, imp);
      perform public.xd_buy(dw, cards[3], d + 1, 'Hertz', public.xd_rnd(142, 228), 'Airfare & travel', pick, null, 'Rental car', null, false, 0, null, false, imp);
      perform public.xd_buy(dw, cards[3], d + 2, public.xd_pick(array['Courtyard by Marriott', 'Hilton Garden Inn', 'Hampton Inn & Suites']), public.xd_rnd(318, 512), 'Lodging', pick, null, '2 nights', null, false, 0, null, false, imp);
      amt := public.xd_rnd(162, 318);
      perform public.xd_buy(dw, cards[3], d + 1, public.xd_pick(array['Ruth''s Chris', 'Fleming''s', 'Wintzell''s Oyster House']), amt, 'Customer entertainment', pick, null, 'Dinner with the crew leads',
                            'Owner and 3 crew leads', false, round(amt * 0.2, 2), null, false, imp);
    elsif dow between 2 and 4 and random() < 0.32 then
      pick := case when random() < 0.5 then cust[8] else cust[11] end;
      perform public.xd_buy(dw, cards[3], d, public.xd_pick(array['Felix''s Fish Camp', 'Saucy Q', 'Panera Bread', 'Chick-fil-A']), public.xd_rnd(24, 118), 'Meals', pick, null, 'Lunch meeting',
                            public.xd_pick(array['Owner', 'Owner and estimator', 'Office manager']), false, 0, null, false, imp);
      if random() < 0.5 then
        perform public.xd_buy(dw, cards[3], d, public.xd_pick(array['Shell', 'Circle K', 'Chevron']), public.xd_rnd(38, 66), 'Fuel', pick, null, 'Customer visit', null, false, 0, null, false, imp);
      end if;
    end if;

    -- Once a month: shipping, Brandon's fleet GPS (an approver marks it "no receipt needed"), truck work.
    if extract(day from d) = 6 then
      perform public.xd_buy(bc, cards[5], d, 'The UPS Store', public.xd_rnd(34, 138), 'Shipping', cust[1 + floor(random() * 14)::int], null, 'Shipped gun parts to a customer', null, false, 0, null, false, imp);
      insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, demo, import_id,
                                          excused_note, excused_by, category)
      values ('upload', 'demo:' || gen_random_uuid()::text, cards[5], bc, d, d + 1, 'FLEETTRACK *GPS SUBSCRIPTION', 'Fleettrack GPS', 'purchase', 39.00, true, imp,
              'Monthly truck GPS subscription (autopay)', appr[1], 'Other');
    end if;
    if d = first_m + 34 then
      perform public.xd_buy(bc, cards[5], d, 'Discount Tire', 768.40, 'Vehicle & equipment repair', null, null, 'Box truck: 4 tires', null, false, 0, null, false, imp);
    end if;
    if d = first_m + 101 then
      perform public.xd_buy(bc, cards[5], d, 'Jiffy Lube', 342.19, 'Vehicle & equipment repair', null, null, 'Box truck: oil change and brakes', null, false, 0, null, false, imp);
      perform public.xd_buy(dw, cards[3], d, 'ICC code seminar', 395.00, 'Training & events', null, null, 'Energy code update class', null, false, 0, null, false, imp);
    end if;
    d := d + 1;
  end loop;

  -- ---- a few things worth showing
  m := (date_trunc('month', today) - interval '1 month')::date;  -- last month
  -- Marcus: a big dinner with no customer on it (the approver sends the month back for it).
  perform public.xd_buy(mr, cards[2], m + 20, 'Eddie V''s Prime Seafood', 412.88, 'Customer entertainment', null, null, 'Dinner', null, false, 70, null, false, imp);
  -- Luis: a charge last month with no receipt yet (his month can't go for approval), and a return.
  perform public.xd_buy(lo, cards[4], m + 26, 'QuikTrip', 64.12, 'Fuel', null, null, null, null, false, 0, null, true, imp);
  insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, demo, import_id)
  values ('upload', 'demo:' || gen_random_uuid()::text, cards[4], lo, m + 9, m + 10, 'HOME DEPOT RETURN', 'Home Depot', 'return', -45.18, true, imp);
  -- Lost receipts (explained, no photo) and things paid with their own money (paid back to them).
  perform public.xd_buy(lo, cards[4], first_m + 72, 'Valero', 61.20, 'Fuel', cust[7], null, 'Rig startup and training', null, false, 0, 'The pump didn''t print a receipt', false, imp);
  perform public.xd_buy(ty, cards[1], first_m + 110, 'Casey''s', 58.44, 'Fuel', cust[3], null, 'Rig service call', null, false, 0, 'Receipt blew out of the truck window', false, imp);
  perform public.xd_buy(dw, cards[3], first_m + 43, 'Uber', 38.75, 'Airfare & travel', cust[4], null, 'Airport to the hotel', null, true, 0, null, false, imp);
  perform public.xd_buy(mr, cards[2], first_m + 128, 'DFW Airport Parking', 24.00, 'Airfare & travel', null, null, 'Parking for the regional meeting', null, true, 0, null, false, imp);
  -- This month: charges still waiting for receipts.
  perform public.xd_buy(ty, cards[1], least(today - 1, date_trunc('month', today)::date + 1), 'Amazon', 86.40, 'Tools & supplies', null, null, null, null, false, 0, null, true, imp);
  perform public.xd_buy(mr, cards[2], least(today - 1, date_trunc('month', today)::date + 2), 'Pappadeaux', 238.55, 'Meals', null, null, null, null, false, 0, null, true, imp);
  -- A charge on a card nobody is assigned to.
  insert into public.expense_charges (source, external_id, card_last4, user_id, txn_date, post_date, description, merchant, kind, amount, demo, import_id)
  values ('upload', 'demo:' || gen_random_uuid()::text, '9199', null, m + 27, m + 28, 'SHERWIN-WILLIAMS #7741', 'Sherwin-Williams', 'purchase', 57.36, true, imp);

  -- ---- monthly reports: older months approved; last month a mix (approved, waiting, sent back, not sent)
  for c in 1..5 loop
    uid := ids[c];
    m := first_m;
    while m < date_trunc('month', today)::date loop
      begin
        st := public.expense_submit_for(uid, m, c = 5);
        if m < (date_trunc('month', today) - interval '1 month')::date or c in (1, 3) then
          update public.expense_reports
             set status = 'approved', submitted_at = (m + interval '1 month' + interval '2 days' + interval '15 hours'), sent_at = (m + interval '1 month' + interval '2 days' + interval '15 hours'),
                 approved_by = appr[1 + (extract(month from m)::int % greatest(1, coalesce(array_length(appr, 1), 1)))],
                 approved_by_name = coalesce(appr_name[1 + (extract(month from m)::int % greatest(1, coalesce(array_length(appr_name, 1), 1)))], 'Kevin Lall'),
                 approved_at = (m + interval '1 month' + interval '4 days' + interval '10 hours'), email_status = 'demo'
           where user_id = uid and month = m;
        elsif c = 2 then
          update public.expense_reports
             set status = 'returned', submitted_at = (m + interval '1 month' + interval '2 days' + interval '9 hours'), returned_at = (m + interval '1 month' + interval '4 days' + interval '11 hours'),
                 review_note = 'Which customer was the Eddie V''s dinner on the 21st for? Add the customer and who was there, then send it again.', email_status = 'demo'
           where user_id = uid and month = m;
        else
          update public.expense_reports set submitted_at = (m + interval '1 month' + interval '3 days' + interval '6 hours'), email_status = 'demo' where user_id = uid and month = m;
        end if;
      exception when others then
        null;  -- a month with a charge still missing its receipt stays unsent (Luis, last month)
      end;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  select count(*) into n_rec from public.expense_receipts where user_id = any(ids);
  select count(*) into n_chg from public.expense_charges where demo;
  update public.expense_imports set rows = n_chg, added = n_chg where id = imp;
  return jsonb_build_object('people', 5, 'receipts', n_rec, 'charges', n_chg, 'from', first_m, 'to', today - 1);
end $$;
revoke all on function public.expense_demo_fill() from public, anon;
grant execute on function public.expense_demo_fill() to authenticated;

-- ---------- Delete the demo ----------------------------------------------
create or replace function public.expense_demo_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
  n_rec int;
  n_chg int;
begin
  if auth.uid() is not null and not public.is_expense_approver() then raise exception 'Only an expense approver can delete the demo.'; end if;
  select coalesce(array_agg(id), '{}') into ids from public.profiles where demo;
  select count(*) into n_rec from public.expense_receipts where user_id = any(ids);
  delete from public.expense_charges where demo or user_id = any(ids);
  get diagnostics n_chg = row_count;
  delete from public.expense_cards where demo or user_id = any(ids);
  delete from public.expense_imports where demo;
  delete from public.expense_reports where user_id = any(ids);
  delete from public.expense_receipts where user_id = any(ids);
  delete from auth.users where id = any(ids);   -- their profiles go with them
  return jsonb_build_object('people', coalesce(array_length(ids, 1), 0), 'receipts', n_rec, 'charges', n_chg);
end $$;
revoke all on function public.expense_demo_clear() from public, anon;
grant execute on function public.expense_demo_clear() to authenticated;

-- Load it now (only if it isn't there yet).
select case when exists (select 1 from public.profiles where demo) then 'Expense demo: already loaded'
            else 'Expense demo loaded: ' || public.expense_demo_fill()::text end as status;
