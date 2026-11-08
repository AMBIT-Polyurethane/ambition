-- =====================================================================
-- AMBIT Intelligence update 0048 - AMBIT-OPS demo data and logo colors
-- * Admin > AMBIT-OPS: "Fill with sample jobs" loads a year of realistic work into an AMBIT demo workspace
--   (never a real contractor's): about 300 jobs from new leads to fully costed work orders, repeat builder
--   customers, rigs, crews, chemical on the shelf, sets, lot numbers, time and yield. Sample customers use
--   example.com emails and 555-01xx phone numbers, logs are never shared with AMBIT, and nothing is emailed.
--   "Delete demo" removes a demo workspace and everything in it.
-- * ops_set_theme: the colors picked from a contractor's logo, used for their buttons, widgets and charts.
-- * ops_kpis: the numbers on the AMBIT-OPS Home screen in one call.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Logo colors (owner or office) ----------
create or replace function public.ops_set_theme(p_theme jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t jsonb := '{}'::jsonb;
  k text;
begin
  if not public.ops_is('owner', 'office') then raise exception 'Only the owner or the office can change the colors.'; end if;
  if p_theme is not null and jsonb_typeof(p_theme) = 'object' then
    foreach k in array array['primary', 'secondary'] loop
      if coalesce(p_theme ->> k, '') ~* '^#[0-9a-f]{6}$' then t := t || jsonb_build_object(k, lower(p_theme ->> k)); end if;
    end loop;
    if jsonb_typeof(p_theme -> 'palette') = 'array' then
      t := t || jsonb_build_object('palette', (select coalesce(jsonb_agg(lower(x)), '[]'::jsonb) from (
        select x from jsonb_array_elements_text(p_theme -> 'palette') x where x ~* '^#[0-9a-f]{6}$' limit 8) s));
    end if;
    t := t || jsonb_build_object('from', coalesce(nullif(p_theme ->> 'from', ''), 'logo'), 'at', now());
  end if;
  update public.companies
     set ops_settings = case when t ? 'primary'
                             then coalesce(ops_settings, '{}'::jsonb) || jsonb_build_object('theme', t, 'color', t ->> 'primary')
                             else coalesce(ops_settings, '{}'::jsonb) - 'theme' - 'color' end
   where id = public.ops_company();
end $$;
revoke all on function public.ops_set_theme(jsonb) from public, anon;
grant execute on function public.ops_set_theme(jsonb) to authenticated;

-- ---------- Small helpers for the sample data (not callable from the app) ----------
create or replace function public.ops_demo_pick(p text[]) returns text
language sql volatile as $$ select p[1 + floor(random() * array_length(p, 1))::int] $$;
create or replace function public.ops_demo_rnd(a numeric, b numeric) returns numeric
language sql volatile as $$ select a + (b - a) * random()::numeric $$;
revoke all on function public.ops_demo_pick(text[]) from public, anon, authenticated;
revoke all on function public.ops_demo_rnd(numeric, numeric) from public, anon, authenticated;

-- ---------- Fill an AMBIT demo workspace with a year of sample work ----------
create or replace function public.admin_ops_demo_fill(p_company uuid, p_me uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        public.companies;
  co       uuid := p_company;
  me       uuid := coalesce(p_me, auth.uid());
  today    date := (now() at time zone 'America/Chicago')::date;
  tz       text := 'America/Chicago';
  sig      text := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABaCAYAAAACcWsdAAAEIUlEQVR42u3dW26jQBBAUWxlC/7O/peVby+C+YrEWA7m0Y+q5lwp0ijJBNrQl6rqB7d5nicAyMDdRwCAsACAsAAQFgAQFgAQFgDCAgDCAgDCAkBYAEBYAEBYAAgLAAgLAAgLAGEBAGEBAGEBICwAICwAICwAhAUAhAUAr3z5CMbl8fj+76WTz+fPzacCERbCy+qv7wGEhXCyIi0QFgAQFkrxfP7c1K4wCrd5nqVOAxWml216bcvazwARVuBO/VctR40HIKwUBens0voUQS2/R8wgrKSykh4Bk4mjU4KC9PLfS6E9Ht9zVpGNLuARa48QYe2e9b1WpB4h1R0hLVR7JCyywmXqkyCsYdNE56+tIKzw0VW2tGnvOWZNC9+NgpIWYUkFdYRUkZXpGoQFtZFU18ADhrDUOwaYLDra57HlvD1gCOsyHfmKqUb0tvU+v9+lXGtLukBYXWWFfNFVjQeMjRAJK9XTOLLwriDmnnKwESJh6TzqehbJSz8Jy4z28WR8JIKsVXesuRHimqCIaxpz8XNNWS0XRkdZFK1OF2ORfKsHxe/vlbjWmaeI3EUHMIWl/b5iRyOnM/f61mOWiOpq9cm7G/babS2dQi0j0QgR5JnzWDtujXP6TTuXXyWE0lKOy2PVkNY9e8TTqm4VaU5W1HrT642asf5Su2Pv3UTyk7jOnFtpObaYAnKvdcFb3KiK7Dk6eQ9pnX3A7F0kf2bjwTPHOlKs/+uYR+X46VhT1KJ7z8iqVSeIFF2VuhlatGvPYEWvAYWz9aG953r0949GMntGWs9GS7Wu2z1j7SjCFrmjFvr3tutdlBvlXYgllmRFOEaJ/3tEjj3a1jwlrF3rufJ+3tGmMnxKyc9uOV2yjS3S1pYPsT2pZCs5tnhQfWVJnaK88abXnKysEd3el3v0bufR6KVXutTi/lsLQlr3v3uGjnbF13O9dvIRitQ9/t6WdrWYCDpKCWHLyGJKYZVqTERZ1Tz26/SAqCnwnvR0a2rYY2S5VJpt19OBZrqfmQ3cI0/ukaptne9Ss+01i7mfpNWjPldTLK0jZMLqnGZEL663LAhHG+IvvddU7Q79TpatojmyKsttnudwkzuzjASWiAqitfVTm862uWcU+WnWt73npYRFhpejXuSSi2yjtHUtKi4RLeytd7W4Xq1G7cgqQYS1tWNmHQk8GnFEFvO7qLj0+Y4+n86yscTCWrtBW4Tp0aQVvbP2Lv6j7pIgwqowKpPpImx9mmaKIkd4kFxlnzbC8kJMKe/gaRuZENalO0KE2eEiE58/YSH1fCoyAWEhZMpLJiAskAkwec0XmQAYS1hkAiBVhEUmAKZJDQvAZPEzABAWAMICAMICAMICQFgAQFgAQFgACAsACAsACAsAYQEAYQEAYQEgLAAgLAAgLABD8Q/Io9Li4uc1wQAAAABJRU5ErkJggg==';
  -- places, products, rigs, crew
  loc1 uuid; loc2 uuid;
  p_oc uuid; p_cc uuid; p_blown uuid; p_r13 uuid; p_r19 uuid; p_r30 uuid; p_air uuid; p_rem uuid;
  rig_oc1 uuid; rig_cc uuid; rig_oc2 uuid; rig_blow uuid;
  crew uuid[] := '{}'; crew_names text[] := array['Marcus Reed','Tyler Hughes','Jose Alvarez','Cody Watkins','Brandon Pierce','Luis Ortega','Dalton Price','Kyle Simmons','Eli Navarro','Trent Baxter','Austin Cole'];
  cid uuid;
  -- customers
  builders uuid[] := '{}'; builder_names text[] := array['Redbud Custom Homes','Prairie Oak Builders','Canyon Creek Homes','Hearthstone Construction','Ironwood Builders','Cimarron Homes','Bluestem Development','Tall Grass Homes','Red Earth Builders','Arbuckle Custom Homes','Keystone Residential','Summit Ridge Homes','Twin Lakes Construction','Pioneer Homes','Frontier Barns & Shops','Oak Hollow Builders','Legacy Post Frame','Heritage Custom Homes','Stillwater Homes','Sooner Steel Buildings','Chisholm Trail Builders','River Bend Homes','Black Mesa Construction','Turner Falls Homes','Wildflower Homes'];
  subdivisions text[] := array['Prairie Oak Estates','Cedar Ridge','Hidden Creek','Stone Mill','Fox Run','Windsong','Bison Meadows','Copper Creek','Saddle Club','Quail Hollow','Lakeview Pointe','Silver Leaf'];
  homeowners uuid[] := '{}'; home_props uuid[] := '{}';
  firsts text[] := array['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Chris','Karen','Daniel','Lisa','Matthew','Nancy','Anthony','Betty','Mark','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Josh','Michelle','Kevin','Carol','Brian','Amanda','Jason','Melissa','Ryan','Stephanie','Jacob','Rebecca','Gary','Laura','Nick','Heather'];
  lasts text[] := array['Smith','Johnson','Williams','Brown','Jones','Miller','Davis','Garcia','Wilson','Anderson','Taylor','Thomas','Moore','Jackson','Martin','Lee','Thompson','White','Harris','Clark','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Hill','Green','Adams','Baker','Nelson','Carter','Mitchell','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins','Stewart','Morris','Rogers','Cook','Morgan','Bell','Murphy','Bailey','Cooper','Howard','Ward','Cox','Brooks','Gray','James','Bennett','Wood'];
  streets text[] := array['Oak','Cedar','Pecan','Redbud','Meadow','Prairie View','Lakeshore','Willow','Hickory','Sycamore','Elm','Bluff','Timber','Ridge','Briarwood','Cottonwood','Post Oak','Mesquite','Sandstone','Wheatfield','Harvest','Indian Hills','Coffee Creek','Covell','Waterloo','Memorial','Britton','Hefner','Sooner','Douglas'];
  sfx text[] := array['Dr','Ln','Rd','Ct','Ave','St','Way','Cir','Trl','Pl'];
  cities text[] := array['Oklahoma City|73120','Edmond|73013','Edmond|73034','Norman|73072','Moore|73160','Yukon|73099','Mustang|73064','Piedmont|73078','Midwest City|73130','Choctaw|73020','Guthrie|73044','Shawnee|74804','Tulsa|74137','Broken Arrow|74012','Owasso|74055','Bixby|74008','Jenks|74037','Sand Springs|74063','Stillwater|74074','Chickasha|73018'];
  sources text[] := array['Website form','Phone call','Referral','Google','Facebook','Angi / HomeAdvisor','AMBIT referral','Referral','Google'];
  lost_reasons text[] := array['Price','Timing','Went with a competitor','No response','Price','Went with a competitor'];
  shops text[] := array['30x40','40x60','40x60','50x80','30x50','60x100','40x80','24x36'];
  -- per job
  phases text[] := '{}';
  ph text; i int; k int; n int;
  is_builder boolean; cust uuid; prop uuid; cname text;
  mix text; title text; lvl text;
  l_kind text[]; l_prod uuid[]; l_area text[]; l_name text[]; l_detail text[]; l_sqft numeric[]; l_depth numeric[]; l_r numeric[];
  l_units numeric[]; l_unit text[]; l_bf numeric[]; l_cm numeric[]; l_cl numeric[]; l_price numeric[];
  sq numeric; dp numeric; rv numeric; u numeric; pp numeric; w int; h int; perim numeric;
  price numeric; cost numeric; margin numeric;
  d_lead date; d_sent date; d_sign date; d_start date; d_done date; v_days int; sets_oc numeric; sets_cc numeric; sqft_fg numeric;
  v_lead uuid; v_quote uuid; v_opt uuid; v_job uuid; v_trip uuid; v_wo uuid; rig uuid;
  stage text; qstatus text; rep uuid;
  yf numeric; os numeric; sets numeric; dd date; t0 timestamptz; cm uuid; lead_crew uuid; lead_name text;
  shop_idx int;
  counts jsonb;
  hp int := 0;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can load sample data.'; end if;
  select * into c from public.companies where id = co;
  if c.id is null then raise exception 'Workspace not found.'; end if;
  if not c.ops_demo then raise exception 'Sample data only goes into AMBIT demo workspaces, never a real contractor''s.'; end if;
  perform setseed(0.4242);

  -- Start clean (this workspace only).
  delete from public.ops_notes where company_id = co;
  delete from public.ops_work_orders where company_id = co;
  delete from public.ops_jobs where company_id = co;
  delete from public.ops_quotes where company_id = co;
  delete from public.ops_leads where company_id = co;
  delete from public.ops_customers where company_id = co;
  delete from public.ops_stock_moves where company_id = co;
  delete from public.ops_stock where company_id = co;
  delete from public.ops_stock_min where company_id = co;
  delete from public.ops_rig_crew where company_id = co;
  delete from public.ops_crew where company_id = co;
  delete from public.ops_rigs where company_id = co;
  delete from public.ops_packages where company_id = co;
  delete from public.ops_products where company_id = co;
  delete from public.ops_locations where company_id = co;
  delete from public.ops_counters where company_id = co;

  execute 'alter table public.ops_leads disable trigger ops_leads_stamp_ins';
  execute 'alter table public.ops_leads disable trigger ops_leads_stamp_upd';
  execute 'alter table public.ops_quotes disable trigger ops_quotes_stamp';
  execute 'alter table public.ops_jobs disable trigger ops_jobs_stamp';

  -- Company settings (keeps any logo colors already picked).
  update public.companies
     set ops_enabled = true, ops_enabled_at = coalesce(ops_enabled_at, now()),
         ops_form_token = coalesce(ops_form_token, replace(gen_random_uuid()::text, '-', '')),
         ops_settings = coalesce(ops_settings, '{}'::jsonb) || jsonb_build_object(
           'display_name', coalesce(nullif(ops_settings ->> 'display_name', ''), name),
           'phone', '(405) 555-0142', 'email', 'office@example.com', 'website', 'example.com',
           'address', '4100 N Portland Ave, Oklahoma City, OK 73112', 'license_no', 'OK-INS-55821',
           'target_margin', 45, 'builder_margin', 32, 'floor_margin', 25, 'burden_pct', 18, 'deposit_pct', 30,
           'min_job', 1200, 'quote_days', 30, 'share_logs', false,
           'reviewed', jsonb_build_object('products', true, 'labor', true, 'form', true))
   where id = co;

  insert into public.ops_locations (company_id, name, address, phone, sort) values (co, 'Oklahoma City (HQ)', '4100 N Portland Ave, Oklahoma City, OK 73112', '(405) 555-0142', 0) returning id into loc1;
  insert into public.ops_locations (company_id, name, address, phone, sort) values (co, 'Tulsa', '6110 S 129th E Ave, Tulsa, OK 74134', '(918) 555-0177', 1) returning id into loc2;

  insert into public.ops_products (company_id, ambit_skus, kind, name, sku, unit, cost, cost_source, yield_bf, lb_per_set, waste_pct, price, price_unit, labor_key, description, sort)
  values (co, '{ISO,AMB-SEAL-50}', 'foam_oc', 'Open cell foam (AMBI-SEAL 5.0)', 'AMB-SEAL-50', 'set', 2050, 'ambit', 16500, 950, 10, 0.48, 'bf', 'foam_oc', 'Half-pound open cell spray foam. Seals and insulates in one step.', 1) returning id into p_oc;
  insert into public.ops_products (company_id, ambit_skus, kind, name, sku, unit, cost, cost_source, yield_bf, lb_per_set, waste_pct, price, price_unit, labor_key, description, sort)
  values (co, '{ISO,AMB-TITE-20}', 'foam_cc', 'Closed cell foam (AMBI-TITE 204 HFO)', 'AMB-TITE-20', 'set', 2780, 'ambit', 3700, 975, 10, 1.25, 'bf', 'foam_cc', 'Two-pound closed cell spray foam. Air, vapor and water barrier.', 2) returning id into p_cc;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, waste_pct, price, price_unit, labor_key, coverage_key, description, sort)
  values (co, 'blown', 'Blown fiberglass (Jet Stream Ultra)', 'JSU', 'bag', 31, 'ambit', 38, 5, 1.2, 'sqft', 'blown_attic', 'jetstream', 'Loose-fill fiberglass blown to the R-value on the proposal.', 3) returning id into p_blown;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, sqft_per_unit, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'batt', 'R-13 batts, 2x4 walls', 'R13-15', 'bag', 44, 'ambit', 13, 88, 5, 0.85, 'sqft', 'batt_r11_13', 4) returning id into p_r13;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, sqft_per_unit, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'batt', 'R-19 batts, 2x6 walls', 'R19-15', 'bag', 43, 'ambit', 19, 49, 5, 1.25, 'sqft', 'batt_r19', 5) returning id into p_r19;
  insert into public.ops_products (company_id, kind, name, sku, unit, cost, cost_source, r_value, sqft_per_unit, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'batt', 'R-30 batts, ceilings', 'R30-24', 'bag', 56, 'ambit', 30, 40, 5, 1.65, 'sqft', 'batt_r30_38', 6) returning id into p_r30;
  insert into public.ops_products (company_id, kind, name, unit, cost, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'air_seal', 'Air sealing (top plates and penetrations)', 'each', 0, 0, 85, 'each', 'air_seal', 7) returning id into p_air;
  insert into public.ops_products (company_id, kind, name, unit, cost, waste_pct, price, price_unit, labor_key, sort)
  values (co, 'removal', 'Old insulation removal', 'each', 0, 0, 1.1, 'sqft', 'removal', 8) returning id into p_rem;

  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Rig 1 · Graco E-30', loc1, '{foam_oc,foam_cc}', '#14b8a6', 2, 2.5, 4000, 1) returning id into rig_oc1;
  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Rig 2 · Reactor H-XP3', loc1, '{foam_cc,foam_oc,foam_roof}', '#f5b53f', 1.5, 3, 4000, 2) returning id into rig_cc;
  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Rig 3 · Tulsa', loc2, '{foam_oc,foam_cc}', '#38bdf8', 2, 2.5, 4000, 3) returning id into rig_oc2;
  insert into public.ops_rigs (company_id, name, location_id, does, color, oc_sets_day, cc_sets_day, sqft_day, sort)
  values (co, 'Blow Truck · Krendl', loc1, '{blown,batt,other}', '#a78bfa', 0, 0, 3500, 4) returning id into rig_blow;

  foreach cname in array crew_names loop
    insert into public.ops_crew (company_id, name, phone) values (co, cname, '(405) 555-01' || lpad((10 + coalesce(array_length(crew, 1), 0))::text, 2, '0'))
    returning id into cid;
    crew := crew || cid;
  end loop;
  insert into public.ops_rig_crew (rig_id, crew_id, company_id, lead) values
    (rig_oc1, crew[1], co, true), (rig_oc1, crew[2], co, false), (rig_oc1, crew[3], co, false),
    (rig_cc, crew[4], co, true), (rig_cc, crew[5], co, false),
    (rig_oc2, crew[6], co, true), (rig_oc2, crew[7], co, false), (rig_oc2, crew[8], co, false),
    (rig_blow, crew[9], co, true), (rig_blow, crew[10], co, false);

  -- Builders (repeat customers) and homeowners.
  foreach cname in array builder_names loop
    insert into public.ops_customers (company_id, kind, name, company_name, first_name, last_name, email, phone, source, price_level, created_at, updated_at)
    values (co, 'company', cname, cname, public.ops_demo_pick(firsts), public.ops_demo_pick(lasts),
            'office@' || regexp_replace(lower(cname), '[^a-z]+', '', 'g') || '.example.com',
            '(405) 555-01' || lpad((floor(random() * 90) + 10)::text, 2, '0'), 'Builder', 'builder',
            now() - (400 + floor(random() * 300)) * interval '1 day', now())
    returning id into cid;
    builders := builders || cid;
  end loop;
  for i in 1..200 loop
    declare fn text := public.ops_demo_pick(firsts); ln text := public.ops_demo_pick(lasts); city text := public.ops_demo_pick(cities); pid uuid;
    begin
      insert into public.ops_customers (company_id, kind, name, first_name, last_name, email, phone, source, price_level, created_at, updated_at)
      values (co, 'person', fn || ' ' || ln, fn, ln, lower(fn || '.' || ln || i) || '@example.com',
              '(' || public.ops_demo_pick(array['405','405','918','580']) || ') 555-01' || lpad((floor(random() * 90) + 10)::text, 2, '0'),
              public.ops_demo_pick(sources), 'retail', now() - (floor(random() * 420)) * interval '1 day', now())
      returning id into cid;
      insert into public.ops_properties (company_id, customer_id, label, street, city, state, zip, gate_code)
      values (co, cid, 'Home', (floor(random() * 18000) + 100)::text || ' ' || public.ops_demo_pick(streets) || ' ' || public.ops_demo_pick(sfx),
              split_part(city, '|', 1), 'OK', split_part(city, '|', 2), case when random() < 0.08 then lpad((floor(random() * 9000) + 1000)::text, 4, '0') end)
      returning id into pid;
      homeowners := homeowners || cid;
      home_props := home_props || pid;
    end;
  end loop;

  -- Which step each sample job is at: 150 fully job-costed, 150 spread across the rest of the workflow.
  phases := array_fill('costed'::text, array[150])
         || array_fill('lead_new'::text, array[14]) || array_fill('lead_contacted'::text, array[10]) || array_fill('lead_appt'::text, array[12])
         || array_fill('quote_draft'::text, array[8]) || array_fill('quote_sent'::text, array[18]) || array_fill('quote_followup'::text, array[10])
         || array_fill('lost'::text, array[14]) || array_fill('won'::text, array[14]) || array_fill('scheduled'::text, array[26])
         || array_fill('in_progress'::text, array[6]) || array_fill('done_review'::text, array[18]);

  for i in 1..array_length(phases, 1) loop
    ph := phases[i];
    -- Customer: builders come back again and again; homeowners mostly once (a few twice).
    is_builder := random() < case when ph = 'costed' then 0.45 else 0.35 end;
    if is_builder then
      cust := builders[1 + floor(power(random(), 1.7) * array_length(builders, 1))::int];
      insert into public.ops_properties (company_id, customer_id, label, street, city, state, zip, notes)
      values (co, cust, 'Lot ' || (floor(random() * 60) + 1), (floor(random() * 9000) + 1000)::text || ' ' || public.ops_demo_pick(streets) || ' ' || public.ops_demo_pick(sfx),
              split_part(public.ops_demo_pick(cities), '|', 1), 'OK', null, public.ops_demo_pick(subdivisions))
      returning id into prop;
      lvl := 'builder';
    else
      if hp > 10 and random() < 0.12 then
        k := 1 + floor(random() * hp)::int;
      else
        hp := least(hp + 1, array_length(homeowners, 1));
        k := hp;
      end if;
      cust := homeowners[k];
      prop := home_props[k];
      lvl := 'retail';
    end if;
    select name into cname from public.ops_customers where id = cust;

    -- What the job is.
    mix := case when is_builder then public.ops_demo_pick(array['oc_house','oc_house','oc_house','oc_house','batt_new','batt_new','batt_new','oc_blown','oc_blown','cc_shop'])
                else public.ops_demo_pick(array['oc_attic','oc_attic','oc_attic','oc_attic','oc_attic','blown_attic','blown_attic','blown_attic','blown_attic','blown_attic','cc_crawl','cc_crawl','cc_crawl','cc_shop','cc_shop','cc_shop','cc_shop','oc_house','oc_house','oc_house']) end;
    l_kind := '{}'; l_prod := '{}'; l_area := '{}'; l_name := '{}'; l_detail := '{}'; l_sqft := '{}'; l_depth := '{}'; l_r := '{}';
    l_units := '{}'; l_unit := '{}'; l_bf := '{}'; l_cm := '{}'; l_cl := '{}'; l_price := '{}';

    -- foam line helper (inline): sqft sq, depth dp, product p_oc/p_cc
    if mix in ('oc_house', 'oc_blown') then
      title := case when is_builder then 'New build: ' else 'Whole house: ' end || case when mix = 'oc_house' then 'walls + roofline, open cell' else 'open cell walls + blown attic' end;
      sq := round(public.ops_demo_rnd(1400, 3400)); dp := 3.5;
      l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'EW'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 13.0;
      if mix = 'oc_house' then
        sq := round(public.ops_demo_rnd(1200, 2800)); dp := public.ops_demo_pick(array['5.5','5.5','6'])::numeric;
        l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'RL'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || round(dp * 3.7, 1);
      else
        sq := round(public.ops_demo_rnd(1300, 2600)); rv := 38;
        l_kind := l_kind || 'blown'::text; l_prod := l_prod || p_blown; l_area := l_area || 'CL'::text; l_name := l_name || 'Blown fiberglass'::text; l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
      end if;
    elsif mix = 'oc_attic' then
      title := public.ops_demo_pick(array['Attic encapsulation, open cell','Roofline + gables, open cell','Bonus room and attic, open cell','Attic conversion, open cell']);
      sq := round(public.ops_demo_rnd(900, 2100)); dp := public.ops_demo_pick(array['5.5','6','6.5'])::numeric;
      l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'RL'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || round(dp * 3.7, 1);
      if random() < 0.45 then
        sq := round(public.ops_demo_rnd(180, 520)); dp := 3.5;
        l_kind := l_kind || 'foam_oc'::text; l_prod := l_prod || p_oc; l_area := l_area || 'KW'::text; l_name := l_name || 'Open cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 13.0;
      end if;
    elsif mix = 'cc_shop' then
      shop_idx := 1 + floor(random() * array_length(shops, 1))::int;
      w := split_part(shops[shop_idx], 'x', 1)::int; h := split_part(shops[shop_idx], 'x', 2)::int;
      title := 'Metal shop ' || shops[shop_idx] || ', closed cell';
      perim := 2 * (w + h) * public.ops_demo_pick(array['12','14','14','16'])::numeric;
      dp := public.ops_demo_pick(array['1.5','2','2'])::numeric;
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'EW'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || round(perim * 0.92); l_depth := l_depth || dp; l_r := l_r || round(dp * 7, 1);
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'RL'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || round(w * h * 1.06); l_depth := l_depth || dp; l_r := l_r || round(dp * 7, 1);
    elsif mix = 'cc_crawl' then
      title := public.ops_demo_pick(array['Crawlspace walls + rim joist, closed cell','Crawlspace encapsulation, closed cell','Rim joist + band, closed cell']);
      sq := round(public.ops_demo_rnd(520, 1300)); dp := 2;
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'EW'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 14.0;
      sq := round(public.ops_demo_rnd(160, 340)); dp := 3;
      l_kind := l_kind || 'foam_cc'::text; l_prod := l_prod || p_cc; l_area := l_area || 'RJ'::text; l_name := l_name || 'Closed cell foam'::text; l_sqft := l_sqft || sq; l_depth := l_depth || dp; l_r := l_r || 21.0;
    elsif mix = 'blown_attic' then
      rv := public.ops_demo_pick(array['38','49','49','60'])::numeric;
      title := 'Attic top-off to R-' || rv || ', blown';
      sq := round(public.ops_demo_rnd(1200, 3000));
      l_kind := l_kind || 'blown'::text; l_prod := l_prod || p_blown; l_area := l_area || 'CL'::text; l_name := l_name || 'Blown fiberglass'::text; l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
      if random() < 0.35 then
        l_kind := l_kind || 'air_seal'::text; l_prod := l_prod || p_air; l_area := l_area || 'CL'::text; l_name := l_name || 'Air sealing'::text; l_sqft := l_sqft || null::numeric; l_depth := l_depth || null::numeric; l_r := l_r || null::numeric;
      end if;
    else -- batt_new
      title := 'New build: batts + blown attic';
      sq := round(public.ops_demo_rnd(1800, 3800)); rv := public.ops_demo_pick(array['13','13','19'])::numeric;
      l_kind := l_kind || 'batt'::text; l_prod := l_prod || case when rv = 13 then p_r13 else p_r19 end; l_area := l_area || 'EW'::text; l_name := l_name || ('R-' || rv || ' batts'); l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
      sq := round(public.ops_demo_rnd(1300, 2700)); rv := 38;
      l_kind := l_kind || 'blown'::text; l_prod := l_prod || p_blown; l_area := l_area || 'CL'::text; l_name := l_name || 'Blown fiberglass'::text; l_sqft := l_sqft || sq; l_depth := l_depth || null::numeric; l_r := l_r || rv;
    end if;

    -- Size, cost and price each line.
    price := 0; cost := 0; sets_oc := 0; sets_cc := 0; sqft_fg := 0;
    for k in 1..array_length(l_kind, 1) loop
      if l_kind[k] = 'foam_oc' then
        l_bf[k] := round(l_sqft[k] * l_depth[k], 1); l_units[k] := round(l_bf[k] / 16500 * 1.1, 3); l_unit[k] := 'set';
        l_cm[k] := round(l_units[k] * 2050, 2); l_cl[k] := round(l_units[k] * 500, 2);
        pp := case when lvl = 'builder' then public.ops_demo_rnd(0.36, 0.44) else public.ops_demo_rnd(0.42, 0.56) end;
        l_price[k] := round(l_bf[k] * pp); sets_oc := sets_oc + l_units[k];
        l_detail[k] := l_depth[k] || '" · ' || to_char(l_bf[k], 'FM999,999') || ' bd ft';
      elsif l_kind[k] = 'foam_cc' then
        l_bf[k] := round(l_sqft[k] * l_depth[k], 1); l_units[k] := round(l_bf[k] / 3700 * 1.1, 3); l_unit[k] := 'set';
        l_cm[k] := round(l_units[k] * 2780, 2); l_cl[k] := round(l_units[k] * 450, 2);
        pp := case when lvl = 'builder' then public.ops_demo_rnd(1.02, 1.18) else public.ops_demo_rnd(1.15, 1.45) end;
        l_price[k] := round(l_bf[k] * pp); sets_cc := sets_cc + l_units[k];
        l_detail[k] := l_depth[k] || '" · ' || to_char(l_bf[k], 'FM999,999') || ' bd ft';
      elsif l_kind[k] = 'blown' then
        l_bf[k] := null; u := ceil(l_sqft[k] / case l_r[k] when 38 then 54 when 49 then 41 when 60 then 33 else 70 end * 1.05); l_units[k] := u; l_unit[k] := 'bag';
        l_cm[k] := round(u * 31, 2); l_cl[k] := round(l_sqft[k] * 0.05, 2);
        pp := case l_r[k] when 38 then public.ops_demo_rnd(1.05, 1.3) when 49 then public.ops_demo_rnd(1.3, 1.55) else public.ops_demo_rnd(1.55, 1.85) end;
        if lvl = 'builder' then pp := pp * 0.88; end if;
        l_price[k] := round(l_sqft[k] * pp); sqft_fg := sqft_fg + l_sqft[k];
        l_detail[k] := 'R-' || l_r[k] || ' · ' || u || ' bags';
      elsif l_kind[k] = 'batt' then
        l_bf[k] := null; u := ceil(l_sqft[k] / case l_r[k] when 13 then 88 when 19 then 49 else 40 end * 1.05); l_units[k] := u; l_unit[k] := 'bag';
        l_cm[k] := round(u * case l_r[k] when 13 then 44 when 19 then 43 else 56 end, 2); l_cl[k] := round(l_sqft[k] * case l_r[k] when 13 then 0.04 else 0.05 end, 2);
        pp := case l_r[k] when 13 then public.ops_demo_rnd(0.78, 0.92) else public.ops_demo_rnd(1.15, 1.32) end;
        l_price[k] := round(l_sqft[k] * pp); sqft_fg := sqft_fg + l_sqft[k];
        l_detail[k] := 'R-' || l_r[k] || ' · ' || u || ' bags';
      else -- air sealing
        l_bf[k] := null; l_units[k] := round(public.ops_demo_rnd(4, 8)); l_unit[k] := 'hr';
        l_cm[k] := round(public.ops_demo_rnd(60, 140), 2); l_cl[k] := round(l_units[k] * 28, 2);
        l_price[k] := round(l_units[k] * 85 + l_cm[k] * 1.5); l_detail[k] := l_units[k] || ' hours';
      end if;
      price := price + l_price[k]; cost := cost + l_cm[k] + l_cl[k];
    end loop;
    if price < 1200 then l_price[1] := l_price[1] + (1200 - price); price := 1200; end if;
    margin := case when price > 0 then round((price - cost) / price * 100, 2) end;

    -- When it happened.
    v_days := greatest(1, ceil(greatest(sets_oc / 2.0, sets_cc / 2.6, sqft_fg / 3500.0))::int);
    rig := case when sets_cc > sets_oc then rig_cc when sets_oc > 0 then case when random() < 0.35 then rig_oc2 else rig_oc1 end else rig_blow end;
    d_done := null; d_start := null; d_sign := null; d_sent := null;
    if ph = 'costed' then
      d_start := today - (5 + floor(power(random(), 0.9) * 360))::int;
      if extract(isodow from d_start) > 5 then d_start := d_start - (extract(isodow from d_start)::int - 5); end if;
      d_done := d_start + (v_days - 1);
      d_sign := d_start - (4 + floor(random() * 26))::int;
      d_sent := d_sign - (1 + floor(random() * 12))::int;
      d_lead := d_sent - (2 + floor(random() * 12))::int;
    elsif ph = 'done_review' then
      d_start := today - (v_days + floor(random() * 9))::int;
      if extract(isodow from d_start) > 5 then d_start := d_start - (extract(isodow from d_start)::int - 5); end if;
      d_done := d_start + (v_days - 1);
      d_sign := d_start - (5 + floor(random() * 20))::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'in_progress' then
      v_days := greatest(v_days, 2); d_start := today - floor(random() * 2)::int;
      d_sign := d_start - (6 + floor(random() * 20))::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'scheduled' then
      d_start := today + case when i % 7 = 0 then 0 else (1 + floor(power(random(), 1.3) * 21))::int end;
      if d_start > today and extract(isodow from d_start) > 5 then d_start := d_start + (8 - extract(isodow from d_start)::int); end if;
      d_sign := today - (2 + floor(random() * 20))::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'won' then
      d_sign := today - floor(random() * 10)::int; d_sent := d_sign - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'quote_followup' then
      d_sent := today - (10 + floor(random() * 16))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'quote_sent' then
      d_sent := today - (1 + floor(random() * 8))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'lost' then
      d_sent := today - (12 + floor(random() * 80))::int; d_lead := d_sent - (2 + floor(random() * 10))::int;
    elsif ph = 'quote_draft' then
      d_lead := today - (2 + floor(random() * 9))::int;
    else
      d_lead := today - floor(random() * case ph when 'lead_new' then 4 else 14 end)::int;
    end if;

    stage := case ph when 'lead_new' then 'new' when 'lead_contacted' then 'contacted' when 'lead_appt' then 'appointment' when 'quote_draft' then 'appointment'
                     when 'quote_sent' then 'quoted' when 'quote_followup' then 'follow_up' when 'lost' then 'lost' else 'won' end;
    rep := case when me is not null and random() < 0.6 then me end;
    insert into public.ops_leads (company_id, customer_id, property_id, location_id, title, stage, source, services, rep_id, value_est, next_at,
                                  lost_reason, stage_changed_at, won_at, lost_at, created_by, created_at, updated_at)
    values (co, cust, prop, case when rig = rig_oc2 then loc2 else loc1 end, title, stage,
            case when is_builder then 'Builder' else public.ops_demo_pick(sources) end,
            case when mix like 'oc%' or mix like 'cc%' then '{Spray foam insulation}'::text[] when mix = 'blown_attic' then '{Blown-in insulation}'::text[] else '{Batt insulation,Blown-in insulation}'::text[] end,
            rep, round(price, -2),
            case ph when 'lead_new' then case when random() < 0.5 then today end
                    when 'lead_contacted' then today + (floor(random() * 5) - 2)::int
                    when 'lead_appt' then today + floor(random() * 7)::int
                    when 'quote_draft' then today + floor(random() * 3)::int
                    when 'quote_sent' then today + (floor(random() * 7) - 2)::int
                    when 'quote_followup' then today + (floor(random() * 6) - 3)::int end,
            case when ph = 'lost' then public.ops_demo_pick(lost_reasons) end,
            ((coalesce(d_sign, d_sent, d_lead) + time '10:00') at time zone tz),
            case when stage = 'won' then ((d_sign + time '14:00') at time zone tz) end,
            case when ph = 'lost' then ((d_sent + (5 + floor(random() * 20))::int + time '11:00') at time zone tz) end,
            me, ((d_lead + time '09:00' + floor(random() * 480) * interval '1 minute') at time zone tz), now())
    returning id into v_lead;
    if ph <> 'lead_new' then
      insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, created_by, created_by_name, created_at)
      values (co, v_lead, cust, 'call', public.ops_demo_pick(array[
                'Called and set a time to look at it.', 'Talked through options. Wants pricing on foam vs blown.', 'Left a voicemail, texted pictures of a similar job.',
                'Walked the job with the super. Plans in hand.', 'Customer asked about the energy savings. Sent the AMBIT TSB on attic encapsulation.']),
              me, 'Office', ((d_lead + 1 + time '15:00') at time zone tz));
    end if;
    if ph in ('lead_new', 'lead_contacted', 'lead_appt') then continue; end if;

    -- The quote.
    qstatus := case ph when 'quote_draft' then 'draft' when 'quote_sent' then case when random() < 0.5 then 'viewed' else 'sent' end
                       when 'quote_followup' then 'viewed' when 'lost' then case when random() < 0.5 then 'declined' else 'viewed' end else 'signed' end;
    v_quote := gen_random_uuid(); v_opt := gen_random_uuid();
    insert into public.ops_quotes (id, company_id, lead_id, customer_id, property_id, title, status, price_level, target_margin, floor_margin, deposit_pct,
                                   valid_until, public_token, rep_id, created_by, sent_at, viewed_at, view_count, signed_at, signed_name, signed_email,
                                   signed_option_id, signed_total, signed_method, declined_at, decline_reason, totals, created_at, updated_at)
    values (v_quote, co, v_lead, cust, prop, title, qstatus, lvl, case when lvl = 'builder' then 32 else 45 end, 25, 30,
            coalesce(d_sent, today) + 30, replace(gen_random_uuid()::text, '-', ''), rep, me,
            case when qstatus <> 'draft' then ((d_sent + time '16:00') at time zone tz) end,
            case when qstatus in ('viewed', 'signed', 'declined') then ((d_sent + 1 + time '19:30') at time zone tz) end,
            case when qstatus in ('viewed', 'signed', 'declined') then 1 + floor(random() * 5)::int else 0 end,
            case when qstatus = 'signed' then ((d_sign + time '14:00') at time zone tz) end,
            case when qstatus = 'signed' then cname end, null,
            case when qstatus = 'signed' then v_opt end, case when qstatus = 'signed' then price end,
            case when qstatus = 'signed' then case when random() < 0.7 then 'online' else 'office' end end,
            case when qstatus = 'declined' then ((d_sent + 6 + time '12:00') at time zone tz) end,
            case when qstatus = 'declined' then public.ops_demo_pick(array['Price','Going with a cheaper bid','Putting it off until spring']) end,
            jsonb_build_object('options', jsonb_build_object(v_opt::text, jsonb_build_object('price', price, 'cost', round(cost, 2), 'margin', margin, 'min_adj', 0, 'tax', 0, 'total', price, 'deposit', round(price * 0.3, 2))),
                               'addons', '{}'::jsonb, 'below_floor', '[]'::jsonb),
            ((coalesce(d_sent, today) - 1 + time '13:00') at time zone tz),
            ((coalesce(d_sign, d_sent, today) + time '16:00') at time zone tz));
    insert into public.ops_quote_options (id, company_id, quote_id, name, sort) values (v_opt, co, v_quote, 'Recommended', 0);
    for k in 1..array_length(l_kind, 1) loop
      insert into public.ops_quote_lines (company_id, quote_id, option_id, sort, area_code, product_id, kind, name, detail, measure, sqft, depth_in, r_value,
                                          waste_pct, units, unit, bf, cost_material, cost_labor, price, hours)
      values (co, v_quote, v_opt, k, l_area[k], l_prod[k], l_kind[k], l_name[k], l_detail[k], case when l_kind[k] = 'air_seal' then 'hours' else 'sqft' end,
              l_sqft[k], l_depth[k], l_r[k], case when l_kind[k] like 'foam%' then 10 else 5 end, l_units[k], l_unit[k], l_bf[k], l_cm[k], l_cl[k], l_price[k],
              case when l_kind[k] = 'air_seal' then l_units[k] end);
    end loop;
    if qstatus <> 'signed' then continue; end if;

    -- The job, its trip and (once it's out there) the work order.
    perform public.ops_make_job(v_quote);
    select id into v_job from public.ops_jobs where quote_id = v_quote;
    update public.ops_jobs set created_at = ((d_sign + time '14:05') at time zone tz), rep_id = rep,
                              status = case when ph in ('costed', 'done_review') then 'done' else 'open' end,
                              crew_notes = case when random() < 0.3 then public.ops_demo_pick(array['Dogs in the backyard, use the side gate.','Park on the street, new driveway.','Super is Mike, call 30 min out.','Power at the panel in the garage.','Mask off the HVAC before spraying.']) end
     where id = v_job;
    select id into v_trip from public.ops_trips where job_id = v_job;
    if ph = 'won' then continue; end if;
    update public.ops_trips
       set status = case ph when 'scheduled' then 'scheduled' when 'in_progress' then 'in_progress' else 'done' end,
           rig_id = rig, start_date = d_start, days = v_days, start_time = time '07:30',
           scheduled_by_name = 'Office', scheduled_at = ((d_sign + 1 + time '09:00') at time zone tz)
     where id = v_trip;
    insert into public.ops_trip_crew (trip_id, crew_id, company_id, lead)
    select v_trip, rc.crew_id, co, rc.lead from public.ops_rig_crew rc where rc.rig_id = rig;
    if ph = 'scheduled' then continue; end if;

    select rc.crew_id, cr.name into lead_crew, lead_name from public.ops_rig_crew rc join public.ops_crew cr on cr.id = rc.crew_id where rc.rig_id = rig and rc.lead;
    -- How the job really went: yield (how far each set went) and overspray (thicker than sold).
    yf := case when random() < 0.12 then public.ops_demo_rnd(0.76, 0.88) when random() < 0.08 then public.ops_demo_rnd(1.06, 1.12) else public.ops_demo_rnd(0.93, 1.05) end;
    os := case when random() < 0.15 then public.ops_demo_rnd(1.08, 1.18) else public.ops_demo_rnd(1.0, 1.06) end;
    v_wo := gen_random_uuid();
    insert into public.ops_work_orders (id, company_id, trip_id, job_id, status, started_at, finished_at, finished_by_name, sprayer_crew_id, sprayer_name, sprayer_cert,
                                        sprayer_signed_at, customer_name, customer_sig, customer_signed_at, customer_absent, customer_absent_note, share_ambit,
                                        reviewed_by_name, reviewed_at, review_note, created_at, updated_at)
    values (v_wo, co, v_trip, v_job, case ph when 'costed' then 'reviewed' when 'done_review' then 'done' else 'open' end,
            ((d_start + time '07:42') at time zone tz),
            case when ph <> 'in_progress' then ((d_start + v_days - 1 + time '16:10' + floor(random() * 90) * interval '1 minute') at time zone tz) end,
            case when ph <> 'in_progress' then lead_name end, lead_crew, lead_name, 'SPFA PCP ' || (10000 + floor(random() * 89999))::int,
            case when ph <> 'in_progress' then ((d_start + v_days - 1 + time '16:00') at time zone tz) end,
            case when ph <> 'in_progress' and not is_builder then cname end,
            case when ph <> 'in_progress' and not is_builder then sig end,
            case when ph <> 'in_progress' and not is_builder then ((d_start + v_days - 1 + time '16:20') at time zone tz) end,
            ph <> 'in_progress' and is_builder, case when ph <> 'in_progress' and is_builder then 'Builder job: super walked it with the crew lead.' end,
            false,
            case when ph = 'costed' then 'Office' end,
            case when ph = 'costed' then ((d_start + v_days + 1 + time '10:00') at time zone tz) end,
            case when ph = 'costed' and yf < 0.9 then 'Low yield. Check the A/B temps and pressure on this rig.' end,
            ((d_start + time '07:40') at time zone tz), now());
    for k in 0..(case when ph = 'in_progress' then today - d_start else v_days - 1 end) loop
      dd := d_start + k;
      insert into public.ops_wo_days (company_id, wo_id, work_date, conditions, equipment, material, quality, safety, updated_by_name)
      values (co, v_wo, dd,
              jsonb_build_object('sky', public.ops_demo_pick(array['Clear','Clear','Partly cloudy','Overcast','Indoors']), 'wind', public.ops_demo_pick(array['Calm','Light','Light','Moderate']),
                'meter', 'Fluke 62 + Delmhorst J-2000',
                'readings', jsonb_build_object(
                  'start', jsonb_build_object('time', '7:45 AM', 'ambient', round(public.ops_demo_rnd(48, 78)), 'rh', round(public.ops_demo_rnd(35, 70)), 'substrate', round(public.ops_demo_rnd(50, 76)), 'wood_mc', round(public.ops_demo_rnd(9, 15))),
                  'mid', jsonb_build_object('time', '12:15 PM', 'ambient', round(public.ops_demo_rnd(62, 92)), 'rh', round(public.ops_demo_rnd(28, 60)), 'substrate', round(public.ops_demo_rnd(60, 90)), 'wood_mc', round(public.ops_demo_rnd(9, 14))),
                  'end', jsonb_build_object('time', '3:45 PM', 'ambient', round(public.ops_demo_rnd(58, 88)), 'rh', round(public.ops_demo_rnd(30, 62)), 'substrate', round(public.ops_demo_rnd(58, 86)), 'wood_mc', round(public.ops_demo_rnd(9, 14))))),
              jsonb_build_object('proportioner', case when rig = rig_cc then 'Graco Reactor H-XP3' else 'Graco Reactor E-30' end, 'gun', 'Graco Fusion AP'),
              '{}'::jsonb,
              case when sets_oc + sets_cc > 0 then jsonb_build_object('cup_mass_g', round(public.ops_demo_rnd(case when sets_cc > sets_oc then 15 else 4 end, case when sets_cc > sets_oc then 17 else 5 end), 1), 'cup_ml', 500) else '{}'::jsonb end,
              '{}'::jsonb, lead_name);
      foreach cid in array (select array_agg(tc.crew_id) from public.ops_trip_crew tc where tc.trip_id = v_trip) loop
        t0 := ((dd + time '06:50' + floor(random() * 25) * interval '1 minute') at time zone tz);
        insert into public.ops_wo_time (id, company_id, wo_id, crew_id, kind, started_at, ended_at, by_name)
        values (gen_random_uuid(), co, v_wo, cid, 'drive', t0, t0 + (30 + floor(random() * 40)) * interval '1 minute', lead_name);
        t0 := ((dd + time '07:45' + floor(random() * 10) * interval '1 minute') at time zone tz);
        insert into public.ops_wo_time (id, company_id, wo_id, crew_id, kind, started_at, ended_at, by_name)
        values (gen_random_uuid(), co, v_wo, cid, 'site', t0,
                case when ph = 'in_progress' and dd = today then null else t0 + (390 + floor(random() * 180)) * interval '1 minute' end, lead_name);
      end loop;
    end loop;
    -- Material used and what was sprayed or blown, line by line.
    for k in 1..array_length(l_kind, 1) loop
      if ph = 'in_progress' and k > 1 then exit; end if;
      if l_kind[k] like 'foam%' then
        sq := round(l_sqft[k] * public.ops_demo_rnd(0.98, 1.03), 1);
        dp := round(l_depth[k] * os * case when ph = 'in_progress' then 0.5 else 1 end, 2);
        sets := round(sq * dp / (case when l_kind[k] = 'foam_oc' then 16500 else 3700 end * yf), 2);
        insert into public.ops_wo_materials (id, company_id, wo_id, work_date, ops_product_id, kind, name, unit, qty, a_maker, a_lot, b_key, b_lot, by_name)
        values (gen_random_uuid(), co, v_wo, d_start, l_prod[k], l_kind[k], l_name[k], 'set', sets,
                public.ops_demo_pick(array['Covestro','Covestro','Wanhua','Huntsman']),
                public.ops_demo_pick(array['PA86002836','PA86002841','PA86002845','PA86009001','2605P0437','2605P0499','GEO17020']),
                case when l_kind[k] = 'foam_oc' then 'AMB-SEAL-50' else 'AMB-TITE-20' end,
                case when l_kind[k] = 'foam_oc' then public.ops_demo_pick(array['L7989','L8000','L8007','WS2610A']) else public.ops_demo_pick(array['LW8017','LW8019','LW8020','L7976']) end,
                lead_name);
        insert into public.ops_wo_areas (id, company_id, wo_id, work_date, job_line_id, area_code, name, substrate, ops_product_id, kind, sqft, thick_in, passes, sort)
        select gen_random_uuid(), co, v_wo, d_start, jl.id, l_area[k], l_name[k], public.ops_demo_pick(array['Wood framing','OSB roof deck','Metal panel','Concrete block']),
               l_prod[k], l_kind[k], sq, dp, case when l_kind[k] = 'foam_cc' then ceil(dp / 1.5)::int else 1 end, k
          from public.ops_job_lines jl where jl.job_id = v_job and jl.sort = k limit 1;
      elsif l_kind[k] in ('blown', 'batt') then
        u := ceil(l_units[k] * public.ops_demo_rnd(0.96, 1.09) * case when ph = 'in_progress' then 0.5 else 1 end);
        insert into public.ops_wo_materials (id, company_id, wo_id, work_date, ops_product_id, kind, name, unit, qty, lot, by_name)
        values (gen_random_uuid(), co, v_wo, d_start, l_prod[k], l_kind[k], l_name[k], 'bag', u, 'FG' || (240000 + floor(random() * 9999))::int, lead_name);
        insert into public.ops_wo_areas (id, company_id, wo_id, work_date, job_line_id, area_code, name, substrate, ops_product_id, kind, sqft, thick_in, sort)
        select gen_random_uuid(), co, v_wo, d_start, jl.id, l_area[k], l_name[k], 'Attic floor', l_prod[k], l_kind[k], round(l_sqft[k] * public.ops_demo_rnd(0.98, 1.02), 1), null, k
          from public.ops_job_lines jl where jl.job_id = v_job and jl.sort = k limit 1;
      end if;
    end loop;
  end loop;

  -- Leads that didn't buy over the year (so the win rate looks like real life).
  for i in 1..160 loop
    k := 1 + floor(random() * array_length(homeowners, 1))::int;
    d_lead := today - (14 + floor(random() * 350))::int;
    insert into public.ops_leads (company_id, customer_id, property_id, location_id, title, stage, source, services, value_est, lost_reason,
                                  stage_changed_at, lost_at, created_by, created_at, updated_at)
    values (co, homeowners[k], home_props[k], loc1,
            public.ops_demo_pick(array['Attic encapsulation, open cell','Attic top-off to R-49, blown','Metal shop 40x60, closed cell','Crawlspace encapsulation, closed cell','Whole house: walls + roofline, open cell']),
            'lost', public.ops_demo_pick(sources), '{Spray foam insulation}'::text[], round(public.ops_demo_rnd(2500, 16000), -2), public.ops_demo_pick(lost_reasons),
            ((d_lead + 9 + time '11:00') at time zone tz), ((d_lead + 9 + time '11:00') at time zone tz), me, ((d_lead + time '10:00') at time zone tz), now());
  end loop;

  -- Tasks for whoever loaded the demo (the follow-ups on their Home screen).
  if me is not null then
    insert into public.ops_notes (company_id, lead_id, customer_id, kind, body, due_on, assigned_to, created_by, created_by_name, created_at)
    select co, l.id, l.customer_id, 'task',
           public.ops_demo_pick(array['Call back about the quote','Send the foam vs blown comparison','Confirm the walk-through time','Follow up: proposal viewed twice, not signed','Get the plans from the builder','Text photos of a similar job']),
           today + (floor(random() * 8) - 3)::int, me, me, 'Office', now() - interval '2 days'
      from (select x.id, x.customer_id from public.ops_leads x
             where x.company_id = co and x.stage in ('contacted', 'appointment', 'quoted', 'follow_up')
             order by x.number nulls last, x.id limit 40) l
     where random() < 0.32;
  end if;

  -- Chemical and fiberglass on the shelf and on the rigs.
  insert into public.ops_stock (company_id, place_kind, place_id, item_key, name, unit, maker, lot_no, qty) values
    (co, 'location', loc1, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86009001', 6),
    (co, 'location', loc1, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Wanhua', '2605P0499', 2),
    (co, 'location', loc1, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'L8007', 5),
    (co, 'location', loc1, 'AMB-TITE-20', 'AMBI-TITE 204 HFO Resin (B-Side), 475 lb drum', 'drum', '', 'LW8020', 2),
    (co, 'location', loc1, 'JSU', 'Jet Stream Ultra blowing wool', 'bag', '', 'FG244118', 140),
    (co, 'location', loc2, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86009002', 2),
    (co, 'location', loc2, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'WS2610A', 1),
    (co, 'rig', rig_oc1, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86002845', 1.5),
    (co, 'rig', rig_oc1, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'L8000', 1.5),
    (co, 'rig', rig_cc, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Wanhua', '2605P0437', 1),
    (co, 'rig', rig_cc, 'AMB-TITE-20', 'AMBI-TITE 204 HFO Resin (B-Side), 475 lb drum', 'drum', '', 'LW8019', 0.5),
    (co, 'rig', rig_oc2, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 'Covestro', 'PA86009002', 1),
    (co, 'rig', rig_oc2, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', '', 'WS2610A', 1),
    (co, 'rig', rig_blow, 'JSU', 'Jet Stream Ultra blowing wool', 'bag', '', 'FG244118', 60);
  insert into public.ops_stock_min (company_id, item_key, name, unit, min_qty) values
    (co, 'ISO', 'ISO A-Side (pMDI), 500 lb drum', 'drum', 8),
    (co, 'AMB-SEAL-50', 'AMBI-SEAL 5.0 Resin (B-Side), 450 lb drum', 'drum', 4),
    (co, 'AMB-TITE-20', 'AMBI-TITE 204 HFO Resin (B-Side), 475 lb drum', 'drum', 4),
    (co, 'JSU', 'Jet Stream Ultra blowing wool', 'bag', 120);

  -- Numbers in the order things happened.
  update public.ops_leads l set number = 1000 + r.n from (select id, row_number() over (order by created_at, id) n from public.ops_leads where company_id = co) r where l.id = r.id;
  update public.ops_quotes q set number = 1000 + r.n from (select id, row_number() over (order by created_at, id) n from public.ops_quotes where company_id = co) r where q.id = r.id;
  update public.ops_jobs j set number = 1000 + r.n from (select id, row_number() over (order by created_at, id) n from public.ops_jobs where company_id = co) r where j.id = r.id;
  insert into public.ops_counters (company_id, kind, n)
  select co, v.kk, coalesce(v.mm, 1000) from (values
    ('lead', (select max(number) from public.ops_leads where company_id = co)),
    ('quote', (select max(number) from public.ops_quotes where company_id = co)),
    ('job', (select max(number) from public.ops_jobs where company_id = co))) v(kk, mm)
  on conflict (company_id, kind) do update set n = excluded.n;

  execute 'alter table public.ops_leads enable trigger ops_leads_stamp_ins';
  execute 'alter table public.ops_leads enable trigger ops_leads_stamp_upd';
  execute 'alter table public.ops_quotes enable trigger ops_quotes_stamp';
  execute 'alter table public.ops_jobs enable trigger ops_jobs_stamp';

  select jsonb_build_object(
    'customers', (select count(*) from public.ops_customers where company_id = co),
    'leads', (select count(*) from public.ops_leads where company_id = co),
    'quotes', (select count(*) from public.ops_quotes where company_id = co),
    'jobs', (select count(*) from public.ops_jobs where company_id = co),
    'costed', (select count(*) from public.ops_work_orders where company_id = co and status = 'reviewed'),
    'to_review', (select count(*) from public.ops_work_orders where company_id = co and status = 'done'),
    'scheduled', (select count(*) from public.ops_trips where company_id = co and status = 'scheduled')) into counts;
  return counts;
end $$;
revoke all on function public.admin_ops_demo_fill(uuid, uuid) from public, anon;
grant execute on function public.admin_ops_demo_fill(uuid, uuid) to authenticated;

-- ---------- Delete an AMBIT demo workspace (and everything in it) ----------
create or replace function public.admin_ops_demo_delete(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  if not public.is_admin() then raise exception 'Only AMBIT admins can delete a demo.'; end if;
  select * into c from public.companies where id = p_company;
  if c.id is null then return; end if;
  if not c.ops_demo then raise exception 'Only AMBIT demo workspaces can be deleted here.'; end if;
  if exists (select 1 from public.orders where company_id = c.id) or exists (select 1 from public.profiles where company_id = c.id) then
    raise exception 'This company has real orders or logins, so it can''t be deleted as a demo.';
  end if;
  update public.profiles set ops_workspace = null where ops_workspace = c.id;
  delete from public.companies where id = c.id;
end $$;
revoke all on function public.admin_ops_demo_delete(uuid) from public, anon;
grant execute on function public.admin_ops_demo_delete(uuid) to authenticated;

-- ---------- Home screen numbers (one trip to the database) ----------
-- Everything the Home widgets show for the workspace: sales, profit on finished jobs, backlog, pipeline,
-- yield against target, today's crews, chemical on hand against the schedule, and what needs a look.
create or replace function public.ops_kpis() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  co      uuid := public.ops_company();
  today   date := (now() at time zone 'America/Chicago')::date;
  m0      date := date_trunc('month', today)::date;
  st      jsonb;
  lab_oc  numeric;
  lab_cc  numeric;
  out     jsonb;
begin
  if co is null or not public.ops_is('owner', 'office', 'dispatcher', 'accounting', 'sales') then return null; end if;
  select ops_settings into st from public.companies where id = co;
  select coalesce(max((x ->> 'rate')::numeric) filter (where x ->> 'key' = 'foam_oc'), 500),
         coalesce(max((x ->> 'rate')::numeric) filter (where x ->> 'key' = 'foam_cc'), 450)
    into lab_oc, lab_cc
    from jsonb_array_elements(case when jsonb_typeof(st -> 'labor') = 'array' then st -> 'labor' else '[]'::jsonb end) x;

  with
  wo as (  -- finished work orders: when, what it sold for, what it really cost
    select w.id, w.job_id, w.trip_id, w.status, t.rig_id,
           coalesce((w.finished_at at time zone 'America/Chicago')::date, t.end_date) as done_on,
           j.sold_total, j.customer_id
      from public.ops_work_orders w
      join public.ops_trips t on t.id = w.trip_id
      join public.ops_jobs j on j.id = w.job_id
     where w.company_id = co and w.status in ('done', 'reviewed')
  ),
  mat as (
    select m.wo_id, m.kind, sum(m.qty) qty, sum(m.qty * coalesce(p.cost, 0)) cost
      from public.ops_wo_materials m left join public.ops_products p on p.id = m.ops_product_id
     where m.company_id = co and not m.deleted group by 1, 2
  ),
  area as (
    select a.wo_id, a.kind, sum(a.bf) bf from public.ops_wo_areas a where a.company_id = co and not a.deleted group by 1, 2
  ),
  sold as (  -- what each job sold, by line kind (board feet and quoted labor)
    select jl.job_id, jl.kind, sum(coalesce(jl.bf, 0)) bf, sum(coalesce(ql.cost_labor, 0)) labor
      from public.ops_job_lines jl left join public.ops_quote_lines ql on ql.id = jl.quote_line_id
     where jl.company_id = co group by 1, 2
  ),
  jobcost as (
    select wo.id, wo.job_id, wo.done_on, wo.rig_id, wo.customer_id, coalesce(wo.sold_total, 0) revenue,
           coalesce((select sum(cost) from mat where mat.wo_id = wo.id), 0)
           + coalesce((select sum(case mat.kind when 'foam_oc' then mat.qty * lab_oc when 'foam_cc' then mat.qty * lab_cc else 0 end) from mat where mat.wo_id = wo.id), 0)
           + coalesce((select sum(labor) from sold where sold.job_id = wo.job_id and sold.kind not like 'foam%'), 0) as cost
      from wo
  ),
  months as (
    select generate_series(m0 - interval '11 months', m0, interval '1 month')::date as m
  ),
  yield as (
    select mat.kind, wo.rig_id, sum(area.bf) bf, sum(mat.qty) sets, sum(mat.cost) cost
      from mat join wo on wo.id = mat.wo_id
      join area on area.wo_id = mat.wo_id and area.kind = mat.kind
     where mat.kind like 'foam%' and wo.done_on >= today - 90
     group by grouping sets ((mat.kind), (mat.kind, wo.rig_id))
  ),
  target as (
    select kind, max(yield_bf) y, max(cost) c from public.ops_products where company_id = co and kind like 'foam%' and active group by 1
  ),
  waste as (  -- sets used beyond what the sold board feet needed at the target yield (last 90 days)
    select coalesce(sum(greatest(mat.qty - s.bf / nullif(tg.y, 0), 0) * tg.c), 0) dollars,
           coalesce(sum(greatest(mat.qty - s.bf / nullif(tg.y, 0), 0)), 0) sets
      from mat join wo on wo.id = mat.wo_id
      join sold s on s.job_id = wo.job_id and s.kind = mat.kind
      join target tg on tg.kind = mat.kind
     where mat.kind like 'foam%' and wo.done_on >= today - 90
  ),
  leads as (
    select l.* from public.ops_leads l where l.company_id = co
  ),
  trips as (
    select t.*, j.number job_no, j.title, j.sold_total, c.name customer, pr.city, r.name rig, r.color rig_color,
           exists (select 1 from public.ops_work_orders w where w.trip_id = t.id and w.status = 'open') wo_open
      from public.ops_trips t
      join public.ops_jobs j on j.id = t.job_id
      join public.ops_customers c on c.id = j.customer_id
      left join public.ops_properties pr on pr.id = j.property_id
      left join public.ops_rigs r on r.id = t.rig_id
     where t.company_id = co and t.status in ('scheduled', 'in_progress') and t.start_date is not null
  ),
  need as (  -- sets the next 14 days of trips will use
    select jl.kind, sum(coalesce(jl.units, 0)) sets
      from public.ops_job_lines jl join trips t on t.id = jl.trip_id
     where t.start_date <= today + 14 and jl.kind like 'foam%' group by 1
  ),
  onhand as (
    select item_key, sum(qty) qty from public.ops_stock where company_id = co group by 1
  )
  select jsonb_build_object(
    'today', today,
    'sold', jsonb_build_object(
      'month', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed' and (q.signed_at at time zone 'America/Chicago')::date >= m0), 0),
      'prev', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed'
                         and (q.signed_at at time zone 'America/Chicago')::date >= (m0 - interval '1 month')::date
                         and (q.signed_at at time zone 'America/Chicago')::date < (m0 - interval '1 month')::date + (today - m0) + 1), 0),
      'prev_full', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed'
                         and (q.signed_at at time zone 'America/Chicago')::date >= (m0 - interval '1 month')::date and (q.signed_at at time zone 'America/Chicago')::date < m0), 0),
      'jobs', (select count(*) from public.ops_quotes q where q.company_id = co and q.status = 'signed' and (q.signed_at at time zone 'America/Chicago')::date >= m0)),
    'months', (select jsonb_agg(jsonb_build_object(
                 'm', to_char(months.m, 'YYYY-MM'),
                 'revenue', coalesce((select sum(revenue) from jobcost where date_trunc('month', done_on) = months.m), 0),
                 'cost', coalesce((select sum(cost) from jobcost where date_trunc('month', done_on) = months.m), 0),
                 'jobs', (select count(*) from jobcost where date_trunc('month', done_on) = months.m),
                 'sold', coalesce((select sum(q.signed_total) from public.ops_quotes q where q.company_id = co and q.status = 'signed'
                                    and date_trunc('month', q.signed_at at time zone 'America/Chicago') = months.m), 0)) order by months.m) from months),
    'backlog', jsonb_build_object(
      'value', coalesce((select sum(j.sold_total) from public.ops_jobs j where j.company_id = co and j.status = 'open'), 0),
      'jobs', (select count(*) from public.ops_jobs j where j.company_id = co and j.status = 'open'),
      'unscheduled', (select count(*) from public.ops_trips t join public.ops_jobs j on j.id = t.job_id where t.company_id = co and t.status = 'unscheduled' and j.status = 'open'),
      'weekly', coalesce((select sum(revenue) from jobcost where done_on > today - 84), 0) / 12.0),
    'pipeline', jsonb_build_object(
      'stages', (select coalesce(jsonb_agg(jsonb_build_object('key', stage, 'count', n, 'value', v)), '[]'::jsonb) from (
                   select stage, count(*) n, coalesce(sum(value_est), 0) v from leads where stage not in ('won', 'lost') group by stage) s),
      'won90', (select count(*) from leads where stage = 'won' and stage_changed_at > now() - interval '90 days'),
      'lost90', (select count(*) from leads where stage = 'lost' and stage_changed_at > now() - interval '90 days'),
      'quotes_out', coalesce((select sum((select max((o.value ->> 'total')::numeric) from jsonb_each(q.totals -> 'options') o)) from public.ops_quotes q where q.company_id = co and q.status in ('sent', 'viewed')), 0),
      'quotes_out_n', (select count(*) from public.ops_quotes q where q.company_id = co and q.status in ('sent', 'viewed')),
      'due', (select count(*) from leads where stage not in ('won', 'lost') and next_at <= today),
      'new7', (select count(*) from leads where created_at > now() - interval '7 days')),
    'yield', jsonb_build_object(
      'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', y.kind, 'bf', y.bf, 'sets', y.sets, 'actual', round(y.bf / nullif(y.sets, 0)), 'target', tg.y) order by y.kind), '[]'::jsonb)
                  from yield y left join target tg on tg.kind = y.kind where y.rig_id is null),
      'rigs', (select coalesce(jsonb_agg(jsonb_build_object('rig', r.name, 'color', r.color, 'kind', y.kind, 'actual', round(y.bf / nullif(y.sets, 0)), 'target', tg.y, 'sets', y.sets) order by r.sort, y.kind), '[]'::jsonb)
                 from yield y join public.ops_rigs r on r.id = y.rig_id left join target tg on tg.kind = y.kind),
      'waste_dollars', (select round(dollars) from waste), 'waste_sets', (select round(sets, 1) from waste)),
    'today_trips', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'job_id', job_id, 'job_no', job_no, 'title', title, 'customer', customer, 'city', city, 'rig', rig, 'color', rig_color,
                                                          'status', status, 'start', start_date, 'end', end_date, 'day', today - start_date + 1, 'days', days, 'wo_open', wo_open) order by rig, start_date), '[]'::jsonb)
                      from trips where today between start_date and end_date),
    'week', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', (select count(*) from trips where d between start_date and end_date))
                                         order by d), '[]'::jsonb) from generate_series(today, today + 13, interval '1 day') g(d)),
    'rigs', (select count(*) from public.ops_rigs where company_id = co and active),
    'work_orders', jsonb_build_object(
      'review', (select count(*) from public.ops_work_orders where company_id = co and status = 'done'),
      'open', (select count(*) from public.ops_work_orders where company_id = co and status = 'open')),
    'chem', jsonb_build_object(
      'oc_need', coalesce((select sets from need where kind = 'foam_oc'), 0),
      'cc_need', coalesce((select sets from need where kind = 'foam_cc'), 0),
      'iso', coalesce((select qty from onhand where item_key = 'ISO'), 0),
      'oc', coalesce((select sum(qty) from onhand where item_key like 'AMB-SEAL%'), 0),
      'cc', coalesce((select sum(qty) from onhand where item_key like 'AMB-TITE%'), 0)),
    'attention', jsonb_build_object(
      'low_yield', (select coalesce(jsonb_agg(x order by x ->> 'pct'), '[]'::jsonb) from (
                     select jsonb_build_object('job_id', wo.job_id, 'job_no', j.number, 'customer', c.name, 'kind', mat.kind,
                                               'pct', round(area.bf / nullif(mat.qty, 0) / nullif(tg.y, 0) * 100), 'done_on', wo.done_on) x
                       from wo join mat on mat.wo_id = wo.id and mat.kind like 'foam%'
                       join area on area.wo_id = wo.id and area.kind = mat.kind
                       join target tg on tg.kind = mat.kind
                       join public.ops_jobs j on j.id = wo.job_id join public.ops_customers c on c.id = j.customer_id
                      where wo.done_on >= today - 45 and area.bf / nullif(mat.qty, 0) < tg.y * 0.9
                      order by area.bf / nullif(mat.qty, 0) / nullif(tg.y, 0) limit 5) s),
      'hot_quotes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                     select jsonb_build_object('id', q.id, 'number', q.number, 'customer', c.name, 'views', q.view_count,
                                               'total', (select max((o.value ->> 'total')::numeric) from jsonb_each(q.totals -> 'options') o)) x
                       from public.ops_quotes q join public.ops_customers c on c.id = q.customer_id
                      where q.company_id = co and q.status = 'viewed' order by q.view_count desc, q.viewed_at desc limit 5) s)),
    'customers', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                   select jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'jobs', count(*), 'revenue', sum(j.sold_total)) x
                     from public.ops_jobs j join public.ops_customers c on c.id = j.customer_id
                    where j.company_id = co and j.created_at > now() - interval '12 months' and j.status <> 'cancelled'
                    group by c.id, c.name, c.kind order by sum(j.sold_total) desc limit 6) s)
  ) into out;
  return out;
end $$;
revoke all on function public.ops_kpis() from public, anon;
grant execute on function public.ops_kpis() to authenticated;

select 'demo data and logo colors ready' as status;
