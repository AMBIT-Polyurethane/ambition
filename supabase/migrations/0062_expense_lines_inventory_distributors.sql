-- 0062: Expense receipts
--  * New categories: Training events and Tradeshows (Training & events is split: old receipts become Training events),
--    Lab expenses, R&D, and Inventory.
--  * One receipt, several lines: fuel and lunch at the same stop are two lines on one receipt (lines).
--  * Distributor partners: a customer can be marked as one (Admin > Customers). A receipt for a distributor lists the
--    distributor's own customers that were seen on the trip (end_customers: name, business, phone).
--  * Inventory bought with a receipt: it becomes a Receiving Report at that warehouse (picked up: waits for an admin
--    to approve it, like any receiving; an admin's own goes straight into stock) or an expected delivery (being shipped).
-- Safe to run more than once.

-- ---------- Columns ------------------------------------------------------
alter table public.expense_receipts add column if not exists lines         jsonb;    -- [{category, amount}] when split
alter table public.expense_receipts add column if not exists end_customers jsonb;    -- [{name, business, phone}]
alter table public.expense_receipts add column if not exists inbound_id    bigint;   -- the inventory it bought
do $$ begin
  alter table public.expense_receipts add constraint expense_receipts_inbound_fk foreign key (inbound_id) references public.inbound_deliveries(id) on delete set null;
exception when duplicate_object then null; end $$;
alter table public.inbound_deliveries add column if not exists expense_receipt_id uuid;
do $$ begin
  alter table public.inbound_deliveries add constraint inbound_expense_receipt_fk foreign key (expense_receipt_id) references public.expense_receipts(id) on delete set null;
exception when duplicate_object then null; end $$;
alter table public.companies add column if not exists distributor boolean not null default false;

-- ---------- Training & events -> Training events ---------------------------
update public.expense_receipts set category = 'Training events' where category = 'Training & events';
update public.expense_charges  set category = 'Training events' where category = 'Training & events';

-- ---------- Inventory bought on a receipt -----------------------------------
-- p_mode: 'picked_up' (they have it: a Receiving Report for an admin to approve), 'shipped' (an expected delivery on
-- p_expected), or 'none' (no inventory on the receipt any more: a pending one is cancelled).
-- p_lines: [{"product_id": "...", "qty": 4, "lot_no": "..."}]. Changing it again updates the same report while it's
-- still waiting; once it's in stock it can't be changed here.
create or replace function public.expense_inventory(p_receipt uuid, p_branch text, p_mode text, p_expected date, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      public.expense_receipts;
  d      public.inbound_deliveries;
  ln     jsonb;
  p      public.products;
  q      numeric;
  n      int := 0;
  v_id   bigint;
  v_st   text;
  who    text := coalesce(public.my_name(), 'AMBIT');
  buyer  text;
  v_note text;
  v_vendor text;
begin
  if not public.is_employee() then raise exception 'Only AMBIT employees can do this.'; end if;
  select * into r from public.expense_receipts where id = p_receipt and deleted_at is null;
  if r.id is null then raise exception 'That receipt wasn''t found.'; end if;
  if r.user_id is distinct from auth.uid() and not public.is_expense_approver() and not public.is_admin() then
    raise exception 'You can only add inventory to your own receipts.';
  end if;
  if r.inbound_id is not null then select * into d from public.inbound_deliveries where id = r.inbound_id for update; end if;

  if p_mode = 'none' then
    if d.id is not null and d.status in ('expected', 'submitted') then
      update public.inbound_deliveries set status = 'cancelled' where id = d.id;
      insert into public.inventory_log (branch_id, kind, message, by_name)
      values (d.branch_id, 'received', 'Card purchase from ' || d.vendor || ' cancelled (taken off the expense receipt).', who);
    end if;
    if r.inbound_id is not null then update public.expense_receipts set inbound_id = null where id = r.id; end if;
    return jsonb_build_object('id', null, 'status', null);
  end if;

  if p_mode not in ('picked_up', 'shipped') then raise exception 'Say whether you have it or it''s being shipped.'; end if;
  if d.id is not null and d.status not in ('expected', 'submitted') then
    raise exception 'The inventory on this receipt is already % (Receiving Report #%), so it can''t be changed here. Ask an admin.', d.status, d.id;
  end if;
  if not exists (select 1 from public.inventory_sheets s where s.branch_id = p_branch and s.enabled) then raise exception 'Pick the warehouse it''s for.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add the items you bought.'; end if;
  if p_mode = 'shipped' and p_expected is null then raise exception 'Pick the day it should get there.'; end if;

  select coalesce(nullif(trim(full_name), ''), email) into buyer from public.profiles where id = r.user_id;
  v_st := case when p_mode = 'shipped' then 'expected' else 'submitted' end;
  v_vendor := coalesce(nullif(left(trim(r.vendor), 120), ''), 'Card purchase');
  v_note := left('Bought by ' || coalesce(buyer, 'an AMBIT employee') || ' on ' || to_char(r.bought_on, 'Mon FMDD, YYYY')
    || case when r.paid_with = 'card' then ' with the AMBIT card' else ' (paid personally)' end
    || ' · expense receipt' || case when p_mode = 'shipped' then ' · being shipped' else ' · picked up' end, 500);

  if d.id is not null and d.branch_id = p_branch then
    v_id := d.id;
    update public.inbound_deliveries
       set vendor = v_vendor, expected_on = case when p_mode = 'shipped' then p_expected else r.bought_on end,
           note = v_note, status = v_st,
           submitted_at = case when v_st = 'submitted' then coalesce(submitted_at, now()) end,
           submitted_by_name = case when v_st = 'submitted' then coalesce(submitted_by_name, buyer, who) end,
           sent_back_at = null, sent_back_by_name = null, sent_back_note = null
     where id = v_id;
    delete from public.inbound_lines where delivery_id = v_id;
  else
    -- New, or moved to another warehouse (the old one is cancelled).
    if d.id is not null then update public.inbound_deliveries set status = 'cancelled' where id = d.id; end if;
    insert into public.inbound_deliveries (branch_id, vendor, expected_on, ref, note, status, created_by_name, submitted_at, submitted_by_name, expense_receipt_id)
    values (p_branch, v_vendor, case when p_mode = 'shipped' then p_expected else r.bought_on end, 'Expense receipt', v_note, v_st, who,
            case when v_st = 'submitted' then now() end, case when v_st = 'submitted' then coalesce(buyer, who) end, r.id)
    returning id into v_id;
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid;
    if p.id is null then raise exception 'One of the items isn''t a product any more.'; end if;
    if not exists (select 1 from public.inventory i where i.branch_id = p_branch and i.product_id = p.id and i.on_sheet) then
      raise exception '% isn''t on that warehouse''s inventory sheet.', p.sku;
    end if;
    q := round(coalesce(nullif(ln ->> 'qty', '')::numeric, 0), 2);
    if q < 0 then raise exception 'Quantities can''t be below zero.'; end if;
    if q = 0 then continue; end if;
    insert into public.inbound_lines (delivery_id, product_id, sku, name, unit, qty, received_qty, lot_no)
    values (v_id, p.id, p.sku, p.name, p.unit, q, case when v_st = 'submitted' then q end,
            nullif(upper(left(trim(coalesce(ln ->> 'lot_no', '')), 60)), ''));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Type how many of each item you bought.'; end if;

  update public.expense_receipts set inbound_id = v_id where id = r.id and inbound_id is distinct from v_id;
  insert into public.inventory_log (branch_id, kind, message, by_name)
  values (p_branch, 'received',
          case when v_st = 'expected' then 'Card purchase from ' || v_vendor || ' on the way (expected ' || to_char(p_expected, 'Mon FMDD') || ')'
               else 'Card purchase from ' || v_vendor || ' picked up, waiting for an admin to approve it' end, who);

  -- An admin's own purchase that's already in hand goes straight into stock (like an admin's Receiving Report).
  if v_st = 'submitted' and public.is_admin() then
    perform public.inbound_receive(v_id, '[]'::jsonb);
    v_st := 'received';
  end if;
  return jsonb_build_object('id', v_id, 'status', v_st);
end $$;
revoke all on function public.expense_inventory(uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.expense_inventory(uuid, text, text, date, jsonb) to authenticated;

-- ---------- The expense dashboard, by line ---------------------------------
create or replace function public.expense_kpis(p_from date, p_to date, p_branch text default null, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  span int := greatest(1, p_to - p_from + 1);
  pf date := p_from - (p_to - p_from + 1);
  pt date := p_from - 1;
  t0 date := (date_trunc('month', p_to) - interval '11 months')::date;
  today date := (now() at time zone 'America/Chicago')::date;
  res jsonb;
begin
  if not public.is_expense_approver() then raise exception 'Only expense approvers can see the expense dashboard.'; end if;

  with xl as (
    select l.*, coalesce(nullif(p.full_name, ''), p.email, case when l.card is not null then 'Card ••' || l.card || ' (not assigned)' else 'Not assigned' end) as emp_name,
           p.branch_id, b.name as branch, p.job_role
    from (
      select r.user_id, null::text as card, r.bought_on as day, round(coalesce(c.amount, r.amount) * coalesce((li.value ->> 'amount')::numeric / nullif(r.amount, 0), 1), 2) as amount,
             coalesce(nullif(li.value ->> 'category', ''), r.category) as category, r.company_id,
             case when r.company_id is not null then r.company_id::text
                  when nullif(trim(r.customer_name), '') is not null then 'n:' || lower(regexp_replace(trim(r.customer_name), '\s+', ' ', 'g')) end as cust_key,
             coalesce(co.name, nullif(trim(r.customer_name), '')) as customer, nullif(trim(r.vendor), '') as vendor, r.id as receipt_id,
             c.id as charge_id, c.id is not null as on_card, r.paid_with = 'personal' and c.id is null as personal, false as missing, false as overdue,
             nullif(trim(coalesce(r.attendees, '')), '') is not null as has_people
        from public.expense_receipts r
        left join public.expense_charges c on c.receipt_id = r.id and not c.removed
        left join public.companies co on co.id = r.company_id
        -- 0062: a split receipt counts once per line (fuel and lunch on one receipt), the bank's amount shared out by line
        left join lateral jsonb_array_elements(case when jsonb_typeof(r.lines) = 'array' and jsonb_array_length(r.lines) > 1 then r.lines end) li on true
       where r.deleted_at is null and r.bought_on between least(t0, pf) and p_to
      union all
      select c.user_id, c.card_last4, c.txn_date, c.amount,
             case when c.kind = 'return' then 'Returns & credits' when c.kind = 'fee' then 'Bank fees'
                  when c.excused_note is not null then coalesce(c.category, 'Other') else 'No receipt' end,
             null, null, null, coalesce(nullif(c.merchant, ''), c.description), null, c.id, true, false,
             c.kind = 'purchase' and c.excused_note is null, c.kind = 'purchase' and c.excused_note is null and c.txn_date < today - 30, false
        from public.expense_charges c
       where c.receipt_id is null and not c.removed and c.kind in ('purchase', 'fee', 'return') and c.txn_date between least(t0, pf) and p_to
    ) l
    left join public.profiles p on p.id = l.user_id
    left join public.branches b on b.id = p.branch_id
    where (p_branch is null or p.branch_id = p_branch) and (p_user is null or l.user_id = p_user)
  ),
  cur as (select * from xl where day between p_from and p_to),
  prev as (select * from xl where day between pf and pt),
  pkey as (select coalesce(user_id::text, 'card:' || coalesce(card, '?')) as k, * from cur),
  tot as (
    select coalesce(sum(amount), 0) as spend, count(distinct receipt_id) as receipts, count(*) filter (where missing) as missing_n,
           coalesce(sum(amount) filter (where missing), 0) as missing_amt, count(*) filter (where overdue) as overdue_n,
           coalesce(sum(amount) filter (where personal), 0) as personal, coalesce(sum(amount) filter (where on_card), 0) as card,
           coalesce(sum(amount) filter (where cust_key is not null), 0) as tied,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals,
           -- meals with guests, or customer entertainment, that no customer is named for
           coalesce(sum(amount) filter (where cust_key is null and (category = 'Customer entertainment' or (category = 'Meals' and has_people))), 0) as meals_untied,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           count(distinct user_id) as people, count(distinct cust_key) as customers
      from cur
  ),
  ptot as (
    select coalesce(sum(amount), 0) as spend,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           count(*) filter (where missing) as missing_n
      from prev
  ),
  cats as (
    select category, sum(amount) as amount, count(*) as n,
           coalesce((select sum(amount) from prev p where p.category = c.category), 0) as prev
      from cur c group by category order by sum(amount) desc
  ),
  emps as (
    select k, max(user_id::text) as user_id, max(emp_name) as name, max(branch) as branch, max(job_role) as job_role,
           sum(amount) as amount, count(*) as n, count(*) filter (where missing) as missing_n,
           coalesce(sum(amount) filter (where missing), 0) as missing_amt, count(*) filter (where overdue) as overdue_n,
           count(distinct cust_key) as customers, count(distinct day) filter (where cust_key is not null) as visit_days,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           coalesce(sum(amount) filter (where personal), 0) as personal
      from pkey group by k
  ),
  matrix as (select k, category, sum(amount) as amount, count(*) as n from pkey group by k, category),
  months as (
    select to_char(day, 'YYYY-MM') as m, category, sum(amount) as amount from xl
     where day between t0 and p_to group by 1, 2
  ),
  branches_ as (select coalesce(branch, 'No location') as branch, sum(amount) as amount, count(distinct user_id) as people from cur group by 1),
  cust as (
    select cust_key, max(customer) as customer, (array_agg(company_id) filter (where company_id is not null))[1] as company_id,
           sum(amount) as amount, count(*) as n, count(distinct day) as days, count(distinct user_id) as people, max(day) as last_day,
           coalesce(sum(amount) filter (where category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           coalesce(sum(amount) filter (where category in ('Meals', 'Customer entertainment')), 0) as meals
      from cur where cust_key is not null group by cust_key
  ),
  cust_emp as (
    select cust_key, user_id, max(emp_name) as name, sum(amount) as amount, count(distinct day) as days
      from cur where cust_key is not null group by cust_key, user_id
  ),
  sales as (
    select o.company_id, sum(coalesce(o.invoiced_total, o.est_subtotal)) as sales, count(*) as orders
      from public.orders o
     where o.status <> 'cancelled' and (o.created_at at time zone 'America/Chicago')::date between p_from and p_to
       and o.company_id in (select company_id from cust where company_id is not null)
     group by o.company_id
  ),
  d as (select distinct user_id, cust_key, day from cur where cust_key is not null and user_id is not null),
  w as (select a.user_id, a.cust_key, (select count(*) from d b where b.user_id = a.user_id and b.cust_key = a.cust_key and b.day >= a.day and b.day < a.day + 30) as n from d a),
  rep as (select user_id, cust_key, max(n) as max30 from w group by 1, 2 having max(n) >= 3),
  rep2 as (
    select r.user_id, r.cust_key, r.max30, max(c.emp_name) as name, max(c.customer) as customer, sum(c.amount) as amount,
           count(distinct c.day) as days, max(c.day) as last_day,
           coalesce(sum(c.amount) filter (where c.category in ('Fuel', 'Lodging', 'Airfare & travel')), 0) as travel,
           coalesce(sum(c.amount) filter (where c.category in ('Meals', 'Customer entertainment')), 0) as meals
      from rep r join cur c on c.user_id = r.user_id and c.cust_key = r.cust_key
     group by r.user_id, r.cust_key, r.max30
  ),
  big as (select * from cur where amount > 0 order by amount desc limit 12),
  vend as (select vendor, sum(amount) as amount, count(*) as n from cur where vendor is not null and amount > 0 group by vendor order by sum(amount) desc limit 10)
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', pf, 'prev_to', pt, 'days', span,
    'totals', (select to_jsonb(tot) from tot),
    'prev', (select to_jsonb(ptot) from ptot),
    'categories', coalesce((select jsonb_agg(to_jsonb(cats)) from cats), '[]'),
    'employees', coalesce((select jsonb_agg(to_jsonb(e) - 'k' || jsonb_build_object('key', e.k,
                      'top_category', (select m.category from matrix m where m.k = e.k and m.amount > 0 order by m.amount desc limit 1))
                      order by e.amount desc) from emps e), '[]'),
    'matrix', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'category', category, 'amount', amount, 'n', n)) from matrix), '[]'),
    'months', coalesce((select jsonb_agg(to_jsonb(months) order by m) from months), '[]'),
    'branches', coalesce((select jsonb_agg(to_jsonb(branches_) order by amount desc) from branches_), '[]'),
    'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'key', c.cust_key, 'customer', c.customer, 'company_id', c.company_id, 'amount', c.amount, 'n', c.n, 'days', c.days,
        'people', c.people, 'last_day', c.last_day, 'travel', c.travel, 'meals', c.meals,
        'sales', s.sales, 'orders', s.orders,
        'by', (select jsonb_agg(jsonb_build_object('user_id', ce.user_id, 'name', ce.name, 'amount', ce.amount, 'days', ce.days) order by ce.amount desc)
                 from cust_emp ce where ce.cust_key = c.cust_key))
      order by c.amount desc) from (select * from cust order by amount desc limit 40) c left join sales s on s.company_id = c.company_id), '[]'),
    'repeat', coalesce((select jsonb_agg(to_jsonb(rep2) order by rep2.max30 desc, rep2.amount desc) from (select * from rep2 order by max30 desc, amount desc limit 30) rep2), '[]'),
    'biggest', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'name', emp_name, 'vendor', vendor, 'category', category, 'customer', customer,
        'amount', amount, 'receipt_id', receipt_id, 'missing', missing) order by amount desc) from big), '[]'),
    'vendors', coalesce((select jsonb_agg(to_jsonb(vend) order by amount desc) from vend), '[]')
  ) into res;
  return res;
end $$;
revoke all on function public.expense_kpis(date, date, text, uuid) from public, anon;
grant execute on function public.expense_kpis(date, date, text, uuid) to authenticated;

-- Check: should say 3 (lines, end customers, distributor).
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'expense_receipts' and column_name in ('lines', 'end_customers'))
     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'distributor') as "New columns (should be 3)";
