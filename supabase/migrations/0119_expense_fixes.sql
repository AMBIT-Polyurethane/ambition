-- 0119: Expense report fixes from the end-to-end test.
--  * A personal purchase on the AMBIT card (the employee taps "Personal purchase") is no longer counted in the
--    expense report's total or on the expense dashboard. Payroll takes it out of their pay instead, and the
--    report lists it on its own, below the total.
-- Run once in Supabase > SQL Editor. Safe to run again.

create or replace function public.expense_submit_for(p_user uuid, p_month date, p_auto boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  m date := date_trunc('month', p_month)::date;
  e date := (date_trunc('month', p_month) + interval '1 month')::date;
  today date := (now() at time zone 'America/Chicago')::date;
  st text;
  miss int;
  n_rec int; n_chg int;
  ids text[];
  card numeric(12,2); pers numeric(12,2);
  rid uuid;
  who public.profiles;
begin
  select * into who from public.profiles where id = p_user;
  if who.id is null then raise exception 'That person wasn''t found.'; end if;
  if e > today then raise exception 'You can send % for approval once the month is over (on %).', to_char(m, 'FMMonth'), to_char(e, 'FMMonth FMDD'); end if;
  st := public.expense_month_status(p_user, m);
  if st = 'submitted' then raise exception '% was already sent for approval.', to_char(m, 'FMMonth YYYY'); end if;
  if st = 'approved' then raise exception '% is already approved.', to_char(m, 'FMMonth YYYY'); end if;
  perform public.expense_auto_match(p_user);
  miss := public.expense_missing(p_user, m);
  if miss > 0 then
    raise exception '% still % a receipt. Add the receipt, or tap "Lost receipt" and say what it was for.',
      case when miss = 1 then '1 card charge' else miss || ' card charges' end, case when miss = 1 then 'needs' else 'need' end;
  end if;

  select count(*), coalesce(array_agg(r.id::text order by r.bought_on), '{}'),
         coalesce(sum(r.amount) filter (where r.paid_with = 'personal'), 0)
    into n_rec, ids, pers
    from public.expense_receipts r
   where r.user_id = p_user and r.deleted_at is null and r.bought_on >= m and r.bought_on < e;
  -- The card total: what the bank charged (matched or not), plus card receipts the bank hasn't shown yet.
  select count(*), coalesce(sum(c.amount), 0) into n_chg, card
    from public.expense_charges c
   where c.user_id = p_user and not c.removed and not (c.personal_repay and c.receipt_id is null)
     and c.kind in ('purchase', 'return', 'fee') and c.txn_date >= m and c.txn_date < e;
  card := card + coalesce((select sum(r.amount) from public.expense_receipts r
                            where r.user_id = p_user and r.deleted_at is null and r.paid_with = 'card' and r.bought_on >= m and r.bought_on < e
                              and not exists (select 1 from public.expense_charges c where c.receipt_id = r.id and not c.removed)), 0);
  if n_rec = 0 and n_chg = 0 then raise exception 'There''s nothing for % yet.', to_char(m, 'FMMonth YYYY'); end if;

  insert into public.expense_reports (user_id, month, receipt_ids, receipt_count, charge_count, total, card_total, personal_total,
                                      sent_at, sent_to, email_status, status, submitted_at, auto_submitted, review_note, returned_at,
                                      approved_by, approved_by_name, approved_at)
  values (p_user, m, ids, n_rec, n_chg, card + pers, card, pers, now(), '{}', null, 'submitted', now(), p_auto, null, null, null, null, null)
  on conflict (user_id, month) do update
     set receipt_ids = excluded.receipt_ids, receipt_count = excluded.receipt_count, charge_count = excluded.charge_count,
         total = excluded.total, card_total = excluded.card_total, personal_total = excluded.personal_total,
         sent_at = now(), email_status = null, status = 'submitted', submitted_at = now(), auto_submitted = p_auto,
         approved_by = null, approved_by_name = null, approved_at = null
  returning id into rid;

  return jsonb_build_object(
    'id', rid, 'month', to_char(m, 'YYYY-MM'), 'receipts', n_rec, 'charges', n_chg,
    'total', card + pers, 'card', card, 'personal', pers,
    'name', coalesce(nullif(who.full_name, ''), who.email), 'email', who.email,
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('email', p.email, 'name', p.full_name))
                             from public.profiles p where p.expense_approver and p.status = 'active' and p.id <> p_user), '[]'::jsonb));
end $fn$;
revoke all on function public.expense_submit_for(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.expense_submit_for(uuid, date, boolean) to service_role;

-- The expense dashboard: personal purchases aren't company spend.
create or replace function public.expense_kpis(p_from date, p_to date, p_branch text default null, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
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
    select l.*, coalesce(nullif(p.full_name, ''), p.email, case when l.card is not null then 'Card ' || chr(8226) || chr(8226) || l.card || ' (not assigned)' else 'Not assigned' end) as emp_name,
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
       where c.receipt_id is null and not c.removed and not c.personal_repay and c.kind in ('purchase', 'fee', 'return') and c.txn_date between least(t0, pf) and p_to
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
end $fn$;
revoke all on function public.expense_kpis(date, date, text, uuid) from public, anon;
grant execute on function public.expense_kpis(date, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Check: should say 1.
select count(*) as "Expense fixes (1)" from pg_proc where proname = 'expense_submit_for' and prosrc like '%personal_repay%';
