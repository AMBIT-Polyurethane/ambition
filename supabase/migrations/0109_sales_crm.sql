-- 0109: The Sales CRM.
--  * Each sales rep gets a hub: their customers with how healthy each one is (how long since they ordered, against
--    how often they usually order), alerts, follow-ups, a new-customer pipeline and calls / visits / notes.
--  * Admins (and anyone with "Sales dashboard") see every rep.
--  * Sales history: A.I. orders, plus QuickBooks history imported from "Sales by Customer Detail" (Sales > Import).
--  * New permissions: Sales hub (sales reps) and Sales dashboard (admins).
--  * Estimates: switching a delivery estimate to pickup clears the freight to $0; changing the address clears it for a
--    CRM to quote again.
-- Run AFTER 0108. Safe to run again.

-- ---------------------------------------------------------------- permissions
create or replace function public.all_perms() returns text[]
language sql immutable as $fn$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff', 'item_variance',
               'receiving', 'transfers', 'inv_reports', 'add_customers', 'prices', 'estimates', 'estimate_freight',
               'sales_hub', 'sales_dashboard']
$fn$;
update public.profiles set perms = array_append(perms, 'sales_hub')
 where role = 'employee' and job_role = 'sales_rep' and perms is not null and not ('sales_hub' = any(perms));

create or replace function public.can_sales_all() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.has_perm('sales_dashboard')
$fn$;
create or replace function public.can_sales_hub() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or public.has_perm('sales_hub') or public.has_perm('sales_dashboard')
$fn$;
-- Is this customer one of mine (or can I see everyone's)?
create or replace function public.crm_mine(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.can_sales_all() or (public.can_sales_hub() and exists (select 1 from public.companies c where c.id = p_company and c.sales_rep_id = auth.uid()))
$fn$;

-- ---------------------------------------------------------------- sales history from QuickBooks
create table if not exists public.sales_lines (
  id          bigint generated always as identity primary key,
  company_id  uuid references public.companies(id) on delete cascade,
  qb_name     text,
  txn_date    date not null,
  txn_type    text,
  doc_no      text,
  item        text,
  product_id  uuid references public.products(id) on delete set null,
  qty         numeric(14,3),
  amount      numeric(14,2) not null,
  imported_at timestamptz not null default now()
);
create index if not exists sales_lines_company on public.sales_lines(company_id, txn_date);
create index if not exists sales_lines_date on public.sales_lines(txn_date);
alter table public.sales_lines enable row level security;
drop policy if exists sales_lines_read on public.sales_lines;
create policy sales_lines_read on public.sales_lines for select to authenticated using (public.crm_mine(company_id));

create table if not exists public.sales_history_meta (
  id               int primary key default 1 check (id = 1),
  from_date        date,
  through_date     date,
  rows             int,
  imported_at      timestamptz,
  imported_by_name text
);
alter table public.sales_history_meta enable row level security;
drop policy if exists sales_history_meta_read on public.sales_history_meta;
create policy sales_history_meta_read on public.sales_history_meta for select to authenticated using (public.is_employee());

-- Admins: load one chunk of the QuickBooks report. The first chunk clears that date range (a re-import replaces it).
-- p_rows: [{"company_id","qb_name","txn_date","txn_type","doc_no","item","qty","amount"}]
create or replace function public.sales_history_import(p_rows jsonb, p_first boolean, p_from date, p_through date) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only admins import sales history.'; end if;
  if p_from is null or p_through is null or p_from > p_through then raise exception 'Pick the report''s date range.'; end if;
  if p_first then
    delete from public.sales_lines where txn_date between p_from and p_through;
  end if;
  insert into public.sales_lines (company_id, qb_name, txn_date, txn_type, doc_no, item, product_id, qty, amount)
  select nullif(r->>'company_id', '')::uuid, left(r->>'qb_name', 200), (r->>'txn_date')::date, left(r->>'txn_type', 40), left(r->>'doc_no', 40),
         left(r->>'item', 200),
         (select p.id from public.products p where upper(p.sku) = upper(split_part(trim(coalesce(r->>'item', '')), ' ', 1)) or upper(p.name) = upper(trim(coalesce(r->>'item', ''))) limit 1),
         nullif(r->>'qty', '')::numeric, (r->>'amount')::numeric
    from jsonb_array_elements(p_rows) r
   where (r->>'txn_date') is not null and (r->>'amount') is not null;
  get diagnostics n = row_count;
  insert into public.sales_history_meta (id, from_date, through_date, rows, imported_at, imported_by_name)
  values (1, p_from, p_through, (select count(*) from public.sales_lines), now(), public.my_name())
  on conflict (id) do update set from_date = least(coalesce(sales_history_meta.from_date, excluded.from_date), excluded.from_date),
    through_date = greatest(coalesce(sales_history_meta.through_date, excluded.through_date), excluded.through_date),
    rows = excluded.rows, imported_at = now(), imported_by_name = excluded.imported_by_name;
  return n;
end $fn$;
revoke all on function public.sales_history_import(jsonb, boolean, date, date) from public, anon;
grant execute on function public.sales_history_import(jsonb, boolean, date, date) to authenticated;

-- Every sale, one row per line: QuickBooks history up to its last date, A.I. orders after it (so nothing counts twice).
-- Read only inside the functions below (they check who may see what).
create or replace view public.crm_sales as
  select l.company_id, l.txn_date as day, coalesce(nullif(l.doc_no, ''), 'QB-' || l.txn_date::text) as doc, l.amount, l.product_id
    from public.sales_lines l
   where l.company_id is not null and coalesce(l.txn_type, 'Invoice') !~* 'estimate|order'
  union all
  select o.company_id, (o.created_at at time zone 'America/Chicago')::date, 'A' || o.order_no::text,
         coalesce(i.line_total, 0), i.product_id
    from public.orders o
    join public.order_items i on i.order_id = o.id
   where o.status <> 'cancelled' and coalesce(o.kind, 'sale') = 'sale' and o.company_id is not null
     and (o.created_at at time zone 'America/Chicago')::date > coalesce((select m.through_date from public.sales_history_meta m where m.id = 1), date '1900-01-01');
revoke all on public.crm_sales from public, anon, authenticated;

-- ---------------------------------------------------------------- customer health
-- One row per customer: sales in the last 12 months / 90 days / this month, orders, how often they usually order
-- (the middle gap between order days, last 12 months), days since the last, a 12-month trend and a health status:
-- new (first order in 60 days) · healthy · watch (past their usual time, or spending down) · at_risk (well past it)
-- · inactive (nothing in 6 months) · no_history.
create or replace function public.crm_customers(p_rep uuid default null, p_company uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  m0 date := date_trunc('month', (now() at time zone 'America/Chicago')::date)::date;
  rep uuid := p_rep;
  res jsonb;
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if not public.can_sales_all() then rep := auth.uid(); end if;
  with base as (
    select c.id, c.name, c.city, c.state, c.sales_rep_id, coalesce(c.house_account, false) as house, c.phone, c.email, c.contact_name
      from public.companies c
     where c.active
       and (p_company is null or c.id = p_company)
       and (rep is null or c.sales_rep_id = rep)
       and (p_company is not null or rep is not null or c.sales_rep_id is not null or coalesce(c.house_account, false) or true)
  ),
  days as (
    select s.company_id, s.day, sum(s.amount) as amt
      from public.crm_sales s join base b on b.id = s.company_id
     group by s.company_id, s.day
  ),
  gaps as (
    select company_id, percentile_cont(0.5) within group (order by gap) as usual, count(*) as n
      from (select company_id, day - lag(day) over (partition by company_id order by day) as gap from days where day > today - 365) x
     where gap is not null and gap > 0
     group by company_id
  ),
  agg as (
    select b.id,
           min(d.day) as first_day, max(d.day) as last_day,
           count(d.day) filter (where d.day > today - 365) as orders_12m,
           coalesce(sum(d.amt) filter (where d.day > today - 365), 0) as sales_12m,
           coalesce(sum(d.amt) filter (where d.day > today - 90), 0) as sales_90d,
           coalesce(sum(d.amt) filter (where d.day > today - 180 and d.day <= today - 90), 0) as sales_prev_90d,
           coalesce(sum(d.amt) filter (where d.day >= m0), 0) as sales_mtd,
           (select jsonb_agg(coalesce((select sum(d2.amt) from days d2 where d2.company_id = b.id
                                         and d2.day >= (m0 - make_interval(months => 11 - k))::date
                                         and d2.day < (m0 - make_interval(months => 10 - k))::date), 0) order by k)
              from generate_series(0, 11) k) as monthly
      from base b left join days d on d.company_id = b.id
     group by b.id
  ),
  rows as (
    select b.*, a.first_day, a.last_day, a.orders_12m, a.sales_12m, a.sales_90d, a.sales_prev_90d, a.sales_mtd, a.monthly,
           round(g.usual)::int as usual_gap,
           case when a.last_day is null then null else today - a.last_day end as days_since,
           p.full_name as rep_name
      from base b join agg a on a.id = b.id
      left join gaps g on g.company_id = b.id and g.n >= 2
      left join public.profiles p on p.id = b.sales_rep_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'city', r.city, 'state', r.state, 'rep_id', r.sales_rep_id, 'rep_name', r.rep_name, 'house', r.house,
           'phone', r.phone, 'email', r.email, 'contact', r.contact_name,
           'first_day', r.first_day, 'last_day', r.last_day, 'days_since', r.days_since, 'usual_gap', r.usual_gap,
           'orders_12m', r.orders_12m, 'sales_12m', r.sales_12m, 'sales_90d', r.sales_90d, 'sales_prev_90d', r.sales_prev_90d,
           'sales_mtd', r.sales_mtd, 'monthly', r.monthly,
           'status', case
              when r.last_day is null then 'no_history'
              when r.first_day > today - 60 then 'new'
              when r.days_since > 180 then 'inactive'
              when r.usual_gap is not null and r.days_since > greatest(r.usual_gap * 2, r.usual_gap + 21) then 'at_risk'
              when r.usual_gap is not null and r.days_since > greatest(round(r.usual_gap * 1.4), r.usual_gap + 7) then 'watch'
              when r.usual_gap is null and r.days_since > 75 then 'watch'
              when r.sales_prev_90d > 0 and r.sales_90d < r.sales_prev_90d * 0.6 then 'watch'
              else 'healthy' end
         ) order by r.sales_12m desc, r.name), '[]'::jsonb)
    into res
    from rows r;
  return res;
end $fn$;
revoke all on function public.crm_customers(uuid, uuid) from public, anon;
grant execute on function public.crm_customers(uuid, uuid) to authenticated;

-- What one customer buys (last 12 months), by item.
create or replace function public.crm_customer_products(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare today date := (now() at time zone 'America/Chicago')::date; res jsonb;
begin
  if not public.crm_mine(p_company) then raise exception 'That isn''t one of your customers.'; end if;
  select coalesce(jsonb_agg(x order by (x->>'total')::numeric desc), '[]'::jsonb) into res from (
    select jsonb_build_object('product_id', s.product_id, 'sku', p.sku, 'name', coalesce(p.name, 'Other items'), 'category', c.name,
                              'total', round(sum(s.amount), 2), 'orders', count(distinct s.doc), 'last', max(s.day)) as x
      from public.crm_sales s
      left join public.products p on p.id = s.product_id
      left join public.categories c on c.id = p.category_id
     where s.company_id = p_company and s.day > today - 365
     group by s.product_id, p.sku, p.name, c.name
     limit 40
  ) t;
  return res;
end $fn$;
revoke all on function public.crm_customer_products(uuid) from public, anon;
grant execute on function public.crm_customer_products(uuid) to authenticated;

-- ---------------------------------------------------------------- activities, follow-ups, leads, AI notes
create table if not exists public.crm_leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_name    text,
  phone           text,
  email           text,
  city            text,
  state           text,
  size_note       text,
  source          text,
  stage           text not null default 'lead' check (stage in ('lead', 'app_sent', 'credit_review', 'approved', 'first_order', 'repeat', 'lost')),
  rep_id          uuid,
  rep_name        text,
  company_id      uuid references public.companies(id) on delete set null,
  notes           text,
  lost_reason     text,
  stage_at        timestamptz not null default now(),
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists crm_leads_rep on public.crm_leads(rep_id, stage);

create table if not exists public.crm_activities (
  id              bigint generated always as identity primary key,
  company_id      uuid references public.companies(id) on delete cascade,
  lead_id         uuid references public.crm_leads(id) on delete cascade,
  kind            text not null check (kind in ('call', 'visit', 'email', 'text', 'meeting', 'note')),
  body            text not null,
  created_by      uuid,
  created_by_name text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists crm_activities_company on public.crm_activities(company_id, occurred_at desc);
create index if not exists crm_activities_lead on public.crm_activities(lead_id, occurred_at desc);
create index if not exists crm_activities_who on public.crm_activities(created_by, occurred_at desc);

create table if not exists public.crm_tasks (
  id              bigint generated always as identity primary key,
  company_id      uuid references public.companies(id) on delete cascade,
  lead_id         uuid references public.crm_leads(id) on delete cascade,
  title           text not null,
  due_on          date,
  assigned_to     uuid,
  assigned_name   text,
  source          text not null default 'manual',
  created_by      uuid,
  created_by_name text,
  done_at         timestamptz,
  done_by_name    text,
  created_at      timestamptz not null default now()
);
create index if not exists crm_tasks_who on public.crm_tasks(assigned_to, done_at, due_on);

create table if not exists public.crm_ai_notes (
  kind       text not null,
  key        text not null,
  body       jsonb not null,
  model      text,
  cost_cents numeric(10,3),
  created_by_name text,
  created_at timestamptz not null default now(),
  primary key (kind, key)
);

alter table public.crm_leads enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_ai_notes enable row level security;
drop policy if exists crm_leads_read on public.crm_leads;
drop policy if exists crm_activities_read on public.crm_activities;
drop policy if exists crm_tasks_read on public.crm_tasks;
drop policy if exists crm_ai_notes_read on public.crm_ai_notes;
create policy crm_leads_read on public.crm_leads for select to authenticated
  using (public.can_sales_all() or (public.can_sales_hub() and rep_id = auth.uid()));
create policy crm_activities_read on public.crm_activities for select to authenticated
  using (public.can_sales_all() or created_by = auth.uid() or (company_id is not null and public.crm_mine(company_id))
         or (lead_id is not null and exists (select 1 from public.crm_leads l where l.id = lead_id and l.rep_id = auth.uid())));
create policy crm_tasks_read on public.crm_tasks for select to authenticated
  using (public.can_sales_all() or assigned_to = auth.uid() or created_by = auth.uid() or (company_id is not null and public.crm_mine(company_id)));
create policy crm_ai_notes_read on public.crm_ai_notes for select to authenticated using (public.can_sales_hub());

-- Log a call / visit / email / text / note (and, optionally, a follow-up).
-- p: {"company_id" | "lead_id", "kind", "body", "occurred_at", "follow_up": {"title", "due_on"}}
create or replace function public.crm_log(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare co uuid := nullif(p->>'company_id', '')::uuid; ld uuid := nullif(p->>'lead_id', '')::uuid; id bigint; k text := coalesce(p->>'kind', 'note');
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if co is null and ld is null then raise exception 'Pick the customer or lead.'; end if;
  if co is not null and not public.crm_mine(co) then raise exception 'That isn''t one of your customers.'; end if;
  if ld is not null and not (public.can_sales_all() or exists (select 1 from public.crm_leads l where l.id = ld and l.rep_id = auth.uid())) then
    raise exception 'That isn''t one of your leads.';
  end if;
  if k not in ('call', 'visit', 'email', 'text', 'meeting', 'note') then k := 'note'; end if;
  if length(trim(coalesce(p->>'body', ''))) < 2 then raise exception 'Write what happened.'; end if;
  insert into public.crm_activities (company_id, lead_id, kind, body, created_by, created_by_name, occurred_at)
  values (co, ld, k, left(trim(p->>'body'), 4000), auth.uid(), public.my_name(), coalesce(nullif(p->>'occurred_at', '')::timestamptz, now()))
  returning crm_activities.id into id;
  if jsonb_typeof(p->'follow_up') = 'object' and length(trim(coalesce(p->'follow_up'->>'title', ''))) > 1 then
    insert into public.crm_tasks (company_id, lead_id, title, due_on, assigned_to, assigned_name, created_by, created_by_name)
    values (co, ld, left(trim(p->'follow_up'->>'title'), 300), nullif(p->'follow_up'->>'due_on', '')::date, auth.uid(), public.my_name(), auth.uid(), public.my_name());
  end if;
  return id;
end $fn$;
revoke all on function public.crm_log(jsonb) from public, anon;
grant execute on function public.crm_log(jsonb) to authenticated;

-- Add or change a follow-up. p: {"id"?, "company_id"?, "lead_id"?, "title", "due_on", "assigned_to"?, "source"?}
create or replace function public.crm_task_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare v bigint := nullif(p->>'id', '')::bigint; co uuid := nullif(p->>'company_id', '')::uuid; who uuid := coalesce(nullif(p->>'assigned_to', '')::uuid, auth.uid());
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if co is not null and not public.crm_mine(co) then raise exception 'That isn''t one of your customers.'; end if;
  if who <> auth.uid() and not public.can_sales_all() then who := auth.uid(); end if;
  if length(trim(coalesce(p->>'title', ''))) < 2 then raise exception 'Write the follow-up.'; end if;
  if v is null then
    insert into public.crm_tasks (company_id, lead_id, title, due_on, assigned_to, assigned_name, source, created_by, created_by_name)
    values (co, nullif(p->>'lead_id', '')::uuid, left(trim(p->>'title'), 300), nullif(p->>'due_on', '')::date, who,
            (select full_name from public.profiles where id = who), coalesce(nullif(p->>'source', ''), 'manual'), auth.uid(), public.my_name())
    returning id into v;
  else
    update public.crm_tasks set title = left(trim(p->>'title'), 300), due_on = nullif(p->>'due_on', '')::date
     where id = v and (assigned_to = auth.uid() or created_by = auth.uid() or public.can_sales_all());
  end if;
  return v;
end $fn$;
revoke all on function public.crm_task_save(jsonb) from public, anon;
grant execute on function public.crm_task_save(jsonb) to authenticated;

create or replace function public.crm_task_done(p_id bigint, p_done boolean) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  update public.crm_tasks set done_at = case when p_done then now() end, done_by_name = case when p_done then public.my_name() end
   where id = p_id and (assigned_to = auth.uid() or created_by = auth.uid() or public.can_sales_all() or (company_id is not null and public.crm_mine(company_id)));
end $fn$;
revoke all on function public.crm_task_done(bigint, boolean) from public, anon;
grant execute on function public.crm_task_done(bigint, boolean) to authenticated;

-- Add or change a lead. p: {"id"?, "name", "contact_name", "phone", "email", "city", "state", "size_note", "source", "notes", "rep_id"?, "company_id"?}
create or replace function public.crm_lead_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v uuid := nullif(p->>'id', '')::uuid; rep uuid := coalesce(nullif(p->>'rep_id', '')::uuid, auth.uid());
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if rep <> auth.uid() and not public.can_sales_all() then rep := auth.uid(); end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Type the company name.'; end if;
  if v is null then
    insert into public.crm_leads (name, contact_name, phone, email, city, state, size_note, source, notes, rep_id, rep_name, company_id, created_by_name)
    values (left(trim(p->>'name'), 200), nullif(trim(coalesce(p->>'contact_name', '')), ''), nullif(trim(coalesce(p->>'phone', '')), ''),
            nullif(trim(coalesce(p->>'email', '')), ''), nullif(trim(coalesce(p->>'city', '')), ''), upper(nullif(left(trim(coalesce(p->>'state', '')), 2), '')),
            nullif(trim(coalesce(p->>'size_note', '')), ''), nullif(trim(coalesce(p->>'source', '')), ''), nullif(trim(coalesce(p->>'notes', '')), ''),
            rep, (select full_name from public.profiles where id = rep), nullif(p->>'company_id', '')::uuid, public.my_name())
    returning id into v;
  else
    update public.crm_leads
       set name = left(trim(p->>'name'), 200), contact_name = nullif(trim(coalesce(p->>'contact_name', '')), ''),
           phone = nullif(trim(coalesce(p->>'phone', '')), ''), email = nullif(trim(coalesce(p->>'email', '')), ''),
           city = nullif(trim(coalesce(p->>'city', '')), ''), state = upper(nullif(left(trim(coalesce(p->>'state', '')), 2), '')),
           size_note = nullif(trim(coalesce(p->>'size_note', '')), ''), source = nullif(trim(coalesce(p->>'source', '')), ''),
           notes = nullif(trim(coalesce(p->>'notes', '')), ''),
           rep_id = rep, rep_name = (select full_name from public.profiles where id = rep),
           company_id = coalesce(nullif(p->>'company_id', '')::uuid, company_id)
     where id = v and (rep_id = auth.uid() or public.can_sales_all());
  end if;
  return v;
end $fn$;
revoke all on function public.crm_lead_save(jsonb) from public, anon;
grant execute on function public.crm_lead_save(jsonb) to authenticated;

create or replace function public.crm_lead_move(p_id uuid, p_stage text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if p_stage not in ('lead', 'app_sent', 'credit_review', 'approved', 'first_order', 'repeat', 'lost') then raise exception 'Unknown stage.'; end if;
  update public.crm_leads set stage = p_stage, stage_at = now(), lost_reason = case when p_stage = 'lost' then nullif(trim(coalesce(p_reason, '')), '') end
   where id = p_id and (rep_id = auth.uid() or public.can_sales_all());
end $fn$;
revoke all on function public.crm_lead_move(uuid, text, text) from public, anon;
grant execute on function public.crm_lead_move(uuid, text, text) to authenticated;

-- Leads with what their customer account has done (so a lead with orders shows it).
create or replace function public.crm_leads_list(p_rep uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare rep uuid := p_rep; res jsonb;
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if not public.can_sales_all() then rep := auth.uid(); end if;
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
           'orders', (select count(distinct s.doc) from public.crm_sales s where s.company_id = l.company_id),
           'company_name', (select c.name from public.companies c where c.id = l.company_id),
           'days_in_stage', ((now() at time zone 'America/Chicago')::date - (l.stage_at at time zone 'America/Chicago')::date)
         ) order by l.stage_at desc), '[]'::jsonb)
    into res
    from public.crm_leads l
   where (rep is null or l.rep_id = rep) and (l.stage <> 'lost' or l.stage_at > now() - interval '60 days');
  return res;
end $fn$;
revoke all on function public.crm_leads_list(uuid) from public, anon;
grant execute on function public.crm_leads_list(uuid) to authenticated;

-- AI notes (briefings, customer summaries, insights) are written by the app's server with the person's own session.
create or replace function public.crm_ai_save(p_kind text, p_key text, p_body jsonb, p_model text, p_cost numeric) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_sales_hub() then raise exception 'You don''t have access to the sales hub.'; end if;
  if p_kind not in ('brief', 'customer', 'insights') then raise exception 'Unknown note.'; end if;
  insert into public.crm_ai_notes (kind, key, body, model, cost_cents, created_by_name, created_at)
  values (p_kind, left(p_key, 120), p_body, p_model, p_cost, public.my_name(), now())
  on conflict (kind, key) do update set body = excluded.body, model = excluded.model, cost_cents = excluded.cost_cents,
    created_by_name = excluded.created_by_name, created_at = now();
end $fn$;
revoke all on function public.crm_ai_save(text, text, jsonb, text, numeric) from public, anon;
grant execute on function public.crm_ai_save(text, text, jsonb, text, numeric) to authenticated;

-- Admins: give customers to a rep (or the house).
create or replace function public.crm_assign(p_companies uuid[], p_rep uuid, p_house boolean default false) returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if not public.can_sales_all() then raise exception 'Only admins assign customers to reps.'; end if;
  update public.companies set sales_rep_id = case when p_house then null else p_rep end, house_account = coalesce(p_house, false)
   where id = any(p_companies);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.crm_assign(uuid[], uuid, boolean) from public, anon;
grant execute on function public.crm_assign(uuid[], uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- the sales dashboard
-- Per rep this month: sales, goal, active customers (ordered in 90 days), new (first order this month), going quiet,
-- calls / visits logged, estimates sent and won. Plus the company's 12 months and this month by product group.
create or replace function public.crm_board() returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  m0 date := date_trunc('month', (now() at time zone 'America/Chicago')::date)::date;
  t0 timestamptz := date_trunc('month', (now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago';
  cust jsonb;
  reps jsonb;
  months jsonb;
  groups jsonb;
begin
  if not public.can_sales_all() then raise exception 'Only admins see every rep.'; end if;
  cust := public.crm_customers(null, null);
  select coalesce(jsonb_agg(x order by (x->>'sales_mtd')::numeric desc), '[]'::jsonb) into reps from (
    select jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'job_role', p.job_role,
      'goal', (select sum(g.amount) from public.sales_goals g where g.person_id = p.id),
      'customers', (select count(*) from jsonb_array_elements(cust) c where (c->>'rep_id')::uuid = p.id),
      'sales_mtd', coalesce((select sum((c->>'sales_mtd')::numeric) from jsonb_array_elements(cust) c where (c->>'rep_id')::uuid = p.id), 0),
      'sales_12m', coalesce((select sum((c->>'sales_12m')::numeric) from jsonb_array_elements(cust) c where (c->>'rep_id')::uuid = p.id), 0),
      'active', (select count(*) from jsonb_array_elements(cust) c where (c->>'rep_id')::uuid = p.id and (c->>'days_since')::int <= 90),
      'new', (select count(*) from jsonb_array_elements(cust) c where (c->>'rep_id')::uuid = p.id and (c->>'first_day')::date >= m0),
      'quiet', (select count(*) from jsonb_array_elements(cust) c where (c->>'rep_id')::uuid = p.id and c->>'status' in ('watch', 'at_risk')),
      'touches', (select count(*) from public.crm_activities a where a.created_by = p.id and a.occurred_at >= t0 and a.kind in ('call', 'visit', 'meeting')),
      'est_sent', (select count(*) from public.estimates e where e.created_by = p.id and e.sent_at >= t0),
      'est_won', (select count(*) from public.estimates e where e.created_by = p.id and e.converted_at >= t0)
    ) as x
      from public.profiles p
     where p.status = 'active' and p.role in ('employee', 'admin')
       and (p.job_role = 'sales_rep' or exists (select 1 from public.companies c where c.sales_rep_id = p.id and c.active))
  ) t;
  select jsonb_agg(jsonb_build_object('month', to_char(mm, 'Mon'), 'start', mm,
           'sales', coalesce((select sum(s.amount) from public.crm_sales s where s.day >= mm and s.day < (mm + interval '1 month')::date), 0),
           'goal', (select sum(g.amount) from public.sales_goals g)) order by mm)
    into months
    from (select (m0 - make_interval(months => k))::date as mm from generate_series(0, 11) k) z;
  select coalesce(jsonb_agg(jsonb_build_object('group', grp, 'sales', total) order by total desc), '[]'::jsonb) into groups from (
    select coalesce(c.goal_group, case when p.category_id = 'ambit-foam' then 'foam' else 'other' end, 'other') as grp, sum(s.amount) as total
      from public.crm_sales s left join public.products p on p.id = s.product_id left join public.categories c on c.id = p.category_id
     where s.day >= m0
     group by 1
  ) g;
  return jsonb_build_object('reps', reps, 'customers', cust, 'months', months, 'groups', groups,
    'open_estimates', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(total), 0)) from public.estimates where status in ('needs_freight', 'ready', 'sent')),
    'history', (select to_jsonb(m) from public.sales_history_meta m where m.id = 1));
end $fn$;
revoke all on function public.crm_board() from public, anon;
grant execute on function public.crm_board() to authenticated;

-- ---------------------------------------------------------------- estimates: freight follows pickup / delivery
create or replace function public.estimates_freight_reset() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.delivery_method = 'pickup' then
    new.freight := 0;
  elsif old.delivery_method = 'pickup'
     or coalesce(new.ship_zip, '') is distinct from coalesce(old.ship_zip, '')
     or coalesce(new.ship_address, '') is distinct from coalesce(old.ship_address, '') then
    new.freight := null;
    new.freight_note := null;
    if new.status in ('ready', 'sent') then new.status := 'needs_freight'; end if;
  end if;
  return new;
end $fn$;
revoke all on function public.estimates_freight_reset() from public, anon, authenticated;
drop trigger if exists estimates_freight_reset on public.estimates;
create trigger estimates_freight_reset before update of delivery_method, ship_zip, ship_address on public.estimates
  for each row when (old.delivery_method is distinct from new.delivery_method or old.ship_zip is distinct from new.ship_zip
                     or old.ship_address is distinct from new.ship_address)
  execute function public.estimates_freight_reset();

notify pgrst, 'reload schema';

-- Check
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('sales_lines', 'crm_leads', 'crm_activities', 'crm_tasks', 'crm_ai_notes')) as "New tables (5)",
       (select count(*) from public.profiles where 'sales_hub' = any(perms)) as "Reps with the sales hub";
