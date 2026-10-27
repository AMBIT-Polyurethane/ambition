-- =====================================================================
-- AMBIT Intelligence update 0028 - Sales reps, invoice prices, sales goals by category
-- * Each customer can have a sales rep (Admin > Customers). Every order credits the customer's
--   rep (set when it's placed; orders placed before a rep was assigned get them when one is).
--   Sales reps see their customers' orders on the Order desk too.
-- * The order desk enters the invoice prices (required for spray foam, fiberglass and anything
--   else priced per customer) with the Sales Order # and Invoice #. Order totals use them.
-- * Monthly sales goals per person in 8 groups (Admin > Sales goals). Sales reps are measured
--   on their customers' orders, warehouse managers on everything from their location.
--   Each product category belongs to a group (Admin > Products > Categories).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Sales rep on customers and orders ---------------------------
-- No foreign keys to profiles here: a second companies<->profiles link would confuse the app's lookups.
alter table public.companies add column if not exists sales_rep_id uuid;
alter table public.orders    add column if not exists sales_rep_id uuid;
create index if not exists companies_sales_rep_idx on public.companies (sales_rep_id);
create index if not exists orders_sales_rep_idx on public.orders (sales_rep_id, created_at);

-- An order credits its customer's rep (and the new customer's rep if the order is moved to another customer).
create or replace function public.orders_set_rep()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.sales_rep_id is null and new.company_id is not null then
      select c.sales_rep_id into new.sales_rep_id from public.companies c where c.id = new.company_id;
    end if;
  elsif new.company_id is distinct from old.company_id then
    new.sales_rep_id := (select c.sales_rep_id from public.companies c where c.id = new.company_id);
  end if;
  return new;
end $$;
drop trigger if exists orders_set_rep on public.orders;
create trigger orders_set_rep before insert or update of company_id on public.orders
  for each row execute function public.orders_set_rep();

-- A customer gets a rep: their orders that had nobody get that rep too (orders already credited stay put).
create or replace function public.companies_rep_fill()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sales_rep_id is not null and new.sales_rep_id is distinct from old.sales_rep_id then
    update public.orders set sales_rep_id = new.sales_rep_id where company_id = new.id and sales_rep_id is null;
  end if;
  return new;
end $$;
drop trigger if exists companies_rep_fill on public.companies;
create trigger companies_rep_fill after update of sales_rep_id on public.companies
  for each row execute function public.companies_rep_fill();

-- Reps see their customers' orders on the Order desk dashboard as well as the ones they placed.
create or replace function public.order_desk_stats(p_days int default 30, p_branch text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz     text := 'America/Chicago';
  today  date := (now() at time zone 'America/Chicago')::date;
  d0     date;
  since  timestamptz;
  weekly boolean;
  res    jsonb;
  mine   boolean;
begin
  -- Everyone who works orders sees all of them; a sales rep sees the orders they placed and their customers' orders.
  if not public.is_employee() then raise exception 'You don''t have access to the order desk.'; end if;
  mine := not (public.is_admin() or public.has_perm('order_desk') or public.has_perm('credit_check') or public.has_perm('inventory'));
  if mine and not public.has_perm('ordering') then raise exception 'You don''t have access to the order desk.'; end if;
  d0 := case when coalesce(p_days, 30) <= 0 then date_trunc('year', today)::date else today - (least(p_days, 366) - 1) end;
  since := d0::timestamp at time zone tz;
  weekly := coalesce(p_days, 30) <= 0 or p_days > 45;

  with o as (
    select x.*,
           (x.created_at at time zone tz)::date as placed_day
      from public.orders x
     where (p_branch is null
            or (p_branch = 'dropship' and x.branch_id is null)
            or x.branch_id = p_branch)
       and (not mine or x.placed_by = auth.uid() or x.sales_rep_id = auth.uid())
  ),
  opn as (
    select o.*,
           case o.stage
             when 'customer'  then coalesce(o.approval_sent_at, o.created_at)
             when 'needs_po'  then coalesce(o.approved_at, o.created_at)
             when 'credit'    then coalesce(o.po_at, o.created_at)
             when 'hold'      then coalesce(o.credit_at, o.created_at)
             when 'schedule'  then coalesce(o.credit_at, o.created_at)
             when 'scheduled' then case when o.scheduled_for < today then (o.scheduled_for + 1)::timestamp at time zone tz end
           end as waiting_since
      from o
     where o.stage not in ('completed', 'cancelled')
  ),
  buckets as (
    select g::date as d
      from generate_series(
             case when weekly then date_trunc('week', d0)::date else d0 end,
             today,
             case when weekly then interval '1 week' else interval '1 day' end) g
  ),
  steps as (
    select 'customer' as k, extract(epoch from approved_at - approval_sent_at) / 3600.0 as h
      from o where approval_sent_at is not null and approved_at >= since
    union all
    select 'po', extract(epoch from po_at - coalesce(approved_at, created_at)) / 3600.0
      from o where po_at >= since
    union all
    select 'credit', extract(epoch from credit_at - po_at) / 3600.0
      from o where credit_at >= since and po_at is not null and credit_status in ('approved', 'hold')
    union all
    select 'schedule', extract(epoch from scheduled_at - credit_at) / 3600.0
      from o where scheduled_at >= since and credit_at is not null and credit_status = 'approved'
  )
  select jsonb_build_object(
    'first', d0,
    'since', since,
    'today', today,
    'bucket', case when weekly then 'week' else 'day' end,
    'open', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from opn group by stage) s), '{}'::jsonb),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch', b, 'stage', stage, 'n', n))
                             from (select coalesce(branch_id, 'dropship') as b, stage, count(*) as n from opn group by 1, 2) s), '[]'::jsonb),
    'placed', (select count(*) from o where created_at >= since),
    'completed', (select count(*) from o where status = 'completed' and completed_at >= since),
    'cancelled', (select count(*) from o where status = 'cancelled' and coalesce(cancelled_at, created_at) >= since),
    'series', (select jsonb_agg(jsonb_build_object('d', b.d, 'n',
                 (select count(*) from o
                   where case when weekly then date_trunc('week', o.placed_day)::date else o.placed_day end = b.d
                     and o.placed_day >= d0))
                 order by b.d) from buckets b),
    'steps', coalesce((select jsonb_object_agg(k, jsonb_build_object('n', n, 'avg', round(avg_h::numeric, 2), 'median', round(med_h::numeric, 2)))
                         from (select k, count(*) as n, avg(h) as avg_h, percentile_cont(0.5) within group (order by h) as med_h
                                 from steps where h >= 0 group by k) s), '{}'::jsonb),
    'cycle', (select jsonb_build_object('n', count(*),
                       'avg', round((avg(extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2),
                       'median', round((percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2))
                from o where status = 'completed' and completed_at >= since and completed_at > created_at),
    'stuck', (select count(*) from opn where waiting_since is not null and (stage = 'scheduled' or waiting_since < now() - interval '24 hours')),
    'waiting', coalesce((select jsonb_agg(w) from (
                  select jsonb_build_object('id', id, 'order_no', order_no, 'company', company_name, 'stage', stage,
                                            'branch', branch_id, 'since', waiting_since,
                                            'hours', round((extract(epoch from now() - waiting_since) / 3600.0)::numeric, 1),
                                            'late', stage = 'scheduled', 'scheduled_for', scheduled_for) as w
                    from opn where waiting_since is not null
                   order by waiting_since
                   limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ---------- Invoice prices with the Sales Order # -----------------------
alter table public.orders add column if not exists priced_at      timestamptz;
alter table public.orders add column if not exists priced_by_name text;

-- p_prices: [{"id": <order_items.id>, "price": <price each>}]. Every line needs a price once this is saved
-- (spray foam, fiberglass and other customer-priced lines have none until the order desk enters it).
drop function if exists public.order_set_numbers(uuid, text, text);
create or replace function public.order_set_numbers(p_order uuid, p_po text, p_invoice text, p_prices jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  e    jsonb;
  pr   numeric;
  miss text;
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
      if coalesce(e->>'price', '') = '' then continue; end if;
      begin
        pr := round((e->>'price')::numeric, 2);
      exception when others then
        raise exception 'A price isn''t a number: %', e->>'price';
      end;
      if pr < 0 then raise exception 'A price can''t be below zero.'; end if;
      update public.order_items
         set unit_price = pr, line_total = round(pr * qty, 2)
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

-- ---------- Sales goals by category ------------------------------------
-- The 8 groups: foam, fiberglass, ppe, roof, guns, intumescent, sealants, supplies (everything else).
alter table public.categories add column if not exists goal_group text;
do $$ begin
  alter table public.categories add constraint categories_goal_group_check
    check (goal_group is null or goal_group in ('foam', 'fiberglass', 'ppe', 'roof', 'guns', 'intumescent', 'sealants', 'supplies'));
exception when duplicate_object then null; end $$;
update public.categories set goal_group = case id
    when 'ambit-foam' then 'foam'
    when 'spray-foam' then 'foam'
    when 'guns-parts' then 'guns'
    when 'fiberglass' then 'fiberglass'
    when 'personal-protective-equipment' then 'ppe'
    when 'roof-coatings-and-sealants' then 'roof'
    when 'guns-and-parts' then 'guns'
    when 'intumescent-coatings' then 'intumescent'
    when 'sealants-adhesives' then 'sealants'
    else 'supplies' end
 where goal_group is null;

create table if not exists public.sales_goals (
  person_id       uuid not null references public.profiles(id) on delete cascade,
  goal_group      text not null check (goal_group in ('foam', 'fiberglass', 'ppe', 'roof', 'guns', 'intumescent', 'sealants', 'supplies')),
  amount          numeric(12,2) not null check (amount > 0),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  primary key (person_id, goal_group)
);
alter table public.sales_goals enable row level security;
drop policy if exists sales_goals_read on public.sales_goals;
create policy sales_goals_read on public.sales_goals for select to authenticated
  using (public.is_admin() or person_id = auth.uid());

-- Admins: one person's monthly goals, e.g. {"foam": 40000, "fiberglass": 8000}. Blank or 0 = no goal.
create or replace function public.admin_set_sales_goals(p_person uuid, p_goals jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  k   text;
  v   text;
  amt numeric;
  who text := coalesce(public.my_name(), 'AMBIT');
begin
  if not public.is_admin() then raise exception 'Only admins can set sales goals.'; end if;
  if not exists (select 1 from public.profiles where id = p_person and role in ('employee', 'admin')) then
    raise exception 'Goals are for AMBIT staff.';
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_goals, '{}'::jsonb)) loop
    if k not in ('foam', 'fiberglass', 'ppe', 'roof', 'guns', 'intumescent', 'sealants', 'supplies') then
      raise exception 'Unknown goal group: %', k;
    end if;
    amt := nullif(regexp_replace(coalesce(v, ''), '[^0-9.]', '', 'g'), '')::numeric;
    if amt is null or amt = 0 then
      delete from public.sales_goals where person_id = p_person and goal_group = k;
    else
      insert into public.sales_goals (person_id, goal_group, amount, updated_at, updated_by_name)
      values (p_person, k, round(amt, 2), now(), who)
      on conflict (person_id, goal_group) do update set amount = excluded.amount, updated_at = now(), updated_by_name = who;
    end if;
  end loop;
end $$;

-- Progress for one month: what each person sold in each group against their goal. Sales reps count their
-- customers' orders (orders.sales_rep_id); warehouse managers count every order from their location.
-- Orders count in the month they were placed; a line counts once it has a price. Admins see everyone
-- (sales reps, warehouse managers and anyone with goals); others see only themselves.
create or replace function public.sales_goal_board(p_month date default null, p_person uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz  text := 'America/Chicago';
  m0  date := date_trunc('month', coalesce(p_month, (now() at time zone 'America/Chicago')::date))::date;
  t0  timestamptz;
  t1  timestamptz;
  who uuid := p_person;
  res jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.is_admin() then who := auth.uid(); end if;
  t0 := m0::timestamp at time zone tz;
  t1 := (m0 + interval '1 month')::timestamp at time zone tz;
  with people as (
    select p.id, coalesce(nullif(trim(p.full_name), ''), p.email) as name, p.job_role, p.branch_id,
           case when p.job_role = 'warehouse' then 'branch' else 'rep' end as basis
      from public.profiles p
     where p.status = 'active' and p.role in ('employee', 'admin')
       and case when who is not null then p.id = who
                else p.job_role in ('sales_rep', 'warehouse') or exists (select 1 from public.sales_goals g where g.person_id = p.id) end
  ),
  lines as (
    select o.id as order_id, o.sales_rep_id, o.branch_id, coalesce(c.goal_group, 'supplies') as grp, i.line_total
      from public.orders o
      join public.order_items i on i.order_id = o.id
      left join public.products pr on pr.id = i.product_id
      left join public.categories c on c.id = pr.category_id
     where o.status <> 'cancelled' and o.created_at >= t0 and o.created_at < t1
  ),
  mine as (
    select pe.id as person_id, l.*
      from people pe
      join lines l on (pe.basis = 'rep' and l.sales_rep_id = pe.id) or (pe.basis = 'branch' and l.branch_id = pe.branch_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pe.id, 'name', pe.name, 'job_role', pe.job_role, 'branch_id', pe.branch_id, 'basis', pe.basis,
           'goals', coalesce((select jsonb_object_agg(g.goal_group, g.amount) from public.sales_goals g where g.person_id = pe.id), '{}'::jsonb),
           'sold', coalesce((select jsonb_object_agg(x.grp, x.total)
                               from (select m.grp, sum(coalesce(m.line_total, 0)) as total from mine m where m.person_id = pe.id group by m.grp) x), '{}'::jsonb),
           'orders', (select count(distinct m.order_id) from mine m where m.person_id = pe.id),
           'waiting', (select count(distinct m.order_id) from mine m where m.person_id = pe.id and m.line_total is null)
         ) order by pe.basis desc, pe.name), '[]'::jsonb)
    into res
    from people pe;
  return jsonb_build_object('month', m0, 'people', res);
end $$;

-- ---------- Who can call what ------------------------------------------
revoke all on function public.order_desk_stats(int, text) from public, anon;
grant execute on function public.order_desk_stats(int, text) to authenticated;
revoke all on function public.order_set_numbers(uuid, text, text, jsonb) from public, anon;
grant execute on function public.order_set_numbers(uuid, text, text, jsonb) to authenticated;
revoke all on function public.admin_set_sales_goals(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_sales_goals(uuid, jsonb) to authenticated;
revoke all on function public.sales_goal_board(date, uuid) from public, anon;
grant execute on function public.sales_goal_board(date, uuid) to authenticated;

select 'sales reps, invoice prices and sales goals ready' as status;
