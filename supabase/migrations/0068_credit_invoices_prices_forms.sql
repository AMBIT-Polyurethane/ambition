-- 0068: Collections from QuickBooks open invoices, credit status, payments by every method, automatic credit release,
-- customer prices (one customer or in bulk), and native forms (Price Request upgrades, Credit Application, Customer
-- Account Setup, RMA, Travel, Time Off, Spray Data, Contact Info, Daily Pulse).
-- Safe to run more than once.

-- =====================================================================================================================
-- A. Customer credit
-- =====================================================================================================================

-- Credit status: Has Line Of Credit (line), Credit Line Revoked (revoked), Pays in advance (advance), Credit review (review).
alter table public.companies add column if not exists credit_status    text;
alter table public.companies drop constraint if exists companies_credit_status_check;
alter table public.companies add constraint companies_credit_status_check check (credit_status is null or credit_status in ('line', 'revoked', 'advance', 'review'));
alter table public.companies add column if not exists credit_parent_id uuid references public.companies(id) on delete set null;  -- shares the parent's line
alter table public.companies add column if not exists credit_limit_prior numeric(12,2);   -- the line before it was revoked
alter table public.companies add column if not exists credit_flags     text[] not null default '{}';  -- collections, payment_plan, high_risk, tax_issue
alter table public.companies add column if not exists credit_manual    boolean not null default false; -- every order is checked by hand
alter table public.companies add column if not exists credit_status_at timestamptz;
alter table public.companies add column if not exists credit_status_by text;
alter table public.companies add column if not exists qb_name          text;  -- QuickBooks "Customer full name" (Parent:Child)
create index if not exists companies_credit_parent on public.companies(credit_parent_id);
create index if not exists companies_qb_name on public.companies(lower(qb_name));

-- Open invoices (and open credits) from the QuickBooks A/R Aging Detail. A new import replaces the snapshot.
create table if not exists public.customer_invoices (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  kind          text not null default 'invoice' check (kind in ('invoice', 'credit_memo', 'payment', 'journal', 'other')),
  doc_no        text,
  txn_date      date not null,
  due_date      date,
  amount        numeric(12,2) not null,
  open_balance  numeric(12,2) not null,
  location      text,
  branch_id     text references public.branches(id) on update cascade on delete set null,
  qb_name       text,
  qb_key        text not null,
  as_of         date not null,
  status        text not null default 'open' check (status in ('open', 'closed')),
  closed_at     timestamptz,
  imported_at   timestamptz not null default now(),
  unique (company_id, qb_key)
);
create index if not exists customer_invoices_company on public.customer_invoices(company_id, status, due_date);
alter table public.customer_invoices enable row level security;
drop policy if exists customer_invoices_read on public.customer_invoices;
create policy customer_invoices_read on public.customer_invoices for select to authenticated using (public.can_credit());

-- Payments: every way a customer pays, account credits, refunds and write-offs; each can be applied to invoices.
alter table public.customer_payments drop constraint if exists customer_payments_method_check;
alter table public.customer_payments add constraint customer_payments_method_check check (method in
  ('check', 'ach', 'wire', 'card', 'debit', 'cash', 'zelle', 'money_order', 'cashiers_check', 'account_credit', 'discount', 'write_off', 'other'));
alter table public.customer_payments add column if not exists kind      text not null default 'payment';
alter table public.customer_payments drop constraint if exists customer_payments_kind_check;
alter table public.customer_payments add constraint customer_payments_kind_check check (kind in ('payment', 'credit', 'refund'));
alter table public.customer_payments add column if not exists check_no  text;
alter table public.customer_payments add column if not exists discount  numeric(12,2) not null default 0 check (discount >= 0);  -- early-pay discount taken (2% 10)
alter table public.customer_payments add column if not exists card_fee  numeric(12,2) check (card_fee is null or card_fee >= 0);
alter table public.customer_payments add column if not exists last4     text check (last4 is null or last4 ~ '^[0-9]{4}$');

create table if not exists public.payment_applications (
  payment_id  bigint not null references public.customer_payments(id) on delete cascade,
  invoice_id  bigint not null references public.customer_invoices(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  primary key (payment_id, invoice_id)
);
create index if not exists payment_applications_inv on public.payment_applications(invoice_id);
alter table public.payment_applications enable row level security;
drop policy if exists payment_applications_read on public.payment_applications;
create policy payment_applications_read on public.payment_applications for select to authenticated using (public.can_credit());

-- Why an order didn't release itself (shows Accounting at the credit check).
alter table public.orders add column if not exists credit_auto_note text;

insert into public.app_settings (key, value) values ('credit_auto', '{"enabled": false}') on conflict (key) do nothing;

-- Import open invoices (Credit > Import, or the QuickBooks A/R Aging Detail).
-- p_rows: [{"company_id", "kind", "doc_no", "txn_date", "due_date", "amount", "open", "location", "qb_name"}]
-- p_full: true when the file is every open invoice for every customer (anything not in it was paid in QuickBooks).
create or replace function public.credit_invoices_import(p_as_of date, p_rows jsonb, p_full boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ln jsonb; n int := 0; v_key text; v_kind text; v_co uuid; v_closed int := 0; cos uuid[] := '{}';
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and accounting import invoices.'; end if;
  if p_as_of is null then raise exception 'Pick the "as of" date of the QuickBooks report.'; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_co := nullif(ln ->> 'company_id', '')::uuid;
    if v_co is null or not exists (select 1 from public.companies where id = v_co) then continue; end if;
    v_kind := case lower(coalesce(ln ->> 'kind', 'invoice')) when 'invoice' then 'invoice' when 'credit memo' then 'credit_memo' when 'credit_memo' then 'credit_memo'
                   when 'payment' then 'payment' when 'journal entry' then 'journal' when 'journal' then 'journal' else 'other' end;
    -- the same line on every import: kind | number | date | amount to the cent
    v_key := v_kind || '|' || coalesce(ln ->> 'doc_no', '') || '|' || coalesce(ln ->> 'txn_date', '') || '|' || to_char(round(coalesce((ln ->> 'amount')::numeric, 0), 2), 'FM999999990.00');
    insert into public.customer_invoices (company_id, kind, doc_no, txn_date, due_date, amount, open_balance, location, branch_id, qb_name, qb_key, as_of, status, closed_at, imported_at)
    values (v_co, v_kind, nullif(ln ->> 'doc_no', ''), (ln ->> 'txn_date')::date, nullif(ln ->> 'due_date', '')::date, (ln ->> 'amount')::numeric,
            (ln ->> 'open')::numeric, nullif(ln ->> 'location', ''),
            (select b.id from public.branches b where nullif(ln ->> 'location', '') is not null and (lower(ln ->> 'location') like '%' || lower(b.name) || '%' or lower(b.name) like '%' || lower(split_part(ln ->> 'location', ' ', 2)) || '%') limit 1),
            nullif(ln ->> 'qb_name', ''), v_key, p_as_of, 'open', null, now())
    on conflict (company_id, qb_key) do update
      set open_balance = excluded.open_balance, due_date = excluded.due_date, location = excluded.location, branch_id = excluded.branch_id,
          qb_name = excluded.qb_name, as_of = excluded.as_of, status = 'open', closed_at = null, imported_at = now();
    cos := array_append(cos, v_co);
    n := n + 1;
  end loop;
  -- Paid off in QuickBooks: not in this report any more.
  update public.customer_invoices i set status = 'closed', closed_at = now()
   where i.status = 'open' and i.as_of < p_as_of and (p_full or i.company_id = any(cos));
  get diagnostics v_closed = row_count;
  update public.companies c set ar_as_of = p_as_of where c.id = any(cos) or (p_full and exists (select 1 from public.customer_invoices i where i.company_id = c.id));
  return jsonb_build_object('rows', n, 'customers', (select count(distinct x) from unnest(cos) x), 'closed', v_closed);
end $$;

-- Credit line, status and terms (Admin > Customers, the customer dashboard, Credit & collections).
create or replace function public.credit_profile_set(p_company uuid, p_status text, p_limit numeric, p_terms text, p_note text,
                                                     p_parent uuid default null, p_manual boolean default false, p_flags text[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare c public.companies;
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and accounting set credit lines.'; end if;
  select * into c from public.companies where id = p_company for update;
  if c.id is null then raise exception 'Customer not found.'; end if;
  if p_status is not null and p_status not in ('line', 'revoked', 'advance', 'review') then raise exception 'Unknown credit status.'; end if;
  if p_parent = p_company then raise exception 'A customer can''t share its own line.'; end if;
  if p_status = 'line' and p_parent is null and coalesce(p_limit, 0) <= 0 then raise exception 'Type the credit line (like 50000).'; end if;
  update public.companies
     set credit_limit_prior = case when p_status = 'revoked' and coalesce(c.credit_status, '') <> 'revoked' then coalesce(c.credit_limit, c.credit_limit_prior) else credit_limit_prior end,
         credit_limit = case when p_status in ('revoked', 'advance') then null else p_limit end,
         credit_status = p_status,
         terms = nullif(left(trim(coalesce(p_terms, '')), 40), ''),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         credit_parent_id = p_parent,
         credit_manual = coalesce(p_manual, false),
         credit_flags = coalesce(p_flags, '{}'),
         credit_status_at = case when coalesce(c.credit_status, '') <> coalesce(p_status, '') then now() else credit_status_at end,
         credit_status_by = case when coalesce(c.credit_status, '') <> coalesce(p_status, '') then public.my_name() else credit_status_by end
   where id = p_company;
end $$;

-- A payment, account credit, refund or write-off, applied to invoices (or oldest past due first when none are picked).
-- p_apply: [{"invoice_id": 12, "amount": 500.00}]
create or replace function public.payment_record(p_company uuid, p_kind text, p_method text, p_amount numeric, p_paid_on date, p_check_no text,
                                                 p_ref text, p_note text, p_discount numeric default 0, p_card_fee numeric default null,
                                                 p_last4 text default null, p_apply jsonb default '[]', p_order uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; ln jsonb; v_applied numeric := 0; v_inv public.customer_invoices; v_amt numeric; v_kind text; v_method text;
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and Accounting record payments.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Type the amount.'; end if;
  v_kind := case when p_kind in ('payment', 'credit', 'refund') then p_kind else 'payment' end;
  v_method := case when p_method in ('check', 'ach', 'wire', 'card', 'debit', 'cash', 'zelle', 'money_order', 'cashiers_check', 'account_credit', 'discount', 'write_off', 'other') then p_method else 'other' end;
  if v_method = 'write_off' and not public.is_admin() then raise exception 'Only admins write off a balance.'; end if;
  if v_kind = 'refund' and not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and accounting record refunds.'; end if;
  if v_method = 'check' and v_kind = 'payment' and coalesce(trim(p_check_no), '') = '' then raise exception 'Type the check number.'; end if;
  if v_method in ('card', 'debit') and p_last4 is not null and p_last4 !~ '^[0-9]{4}$' then raise exception 'Card: type only the last 4 digits.'; end if;
  insert into public.customer_payments (company_id, amount, paid_on, method, kind, check_no, ref, note, discount, card_fee, last4, order_id, entered_by, entered_by_name)
  values (p_company, round(p_amount, 2), coalesce(p_paid_on, (now() at time zone 'America/Chicago')::date), v_method, v_kind,
          nullif(left(trim(coalesce(p_check_no, '')), 30), ''), nullif(left(trim(coalesce(p_ref, '')), 60), ''), nullif(left(trim(coalesce(p_note, '')), 500), ''),
          round(coalesce(p_discount, 0), 2), p_card_fee, nullif(p_last4, ''), p_order, auth.uid(), public.my_name())
  returning id into v_id;
  if v_kind <> 'refund' then
    for ln in select * from jsonb_array_elements(coalesce(p_apply, '[]'::jsonb)) loop
      -- a corporate payment can pay its locations' invoices (a shared line, like MacArthur)
      select i.* into v_inv from public.customer_invoices i join public.companies ic on ic.id = i.company_id
       where i.id = (ln ->> 'invoice_id')::bigint and (i.company_id = p_company or ic.credit_parent_id = p_company);
      v_amt := round(coalesce((ln ->> 'amount')::numeric, 0), 2);
      if v_inv.id is null or v_amt <= 0 then continue; end if;
      insert into public.payment_applications (payment_id, invoice_id, amount) values (v_id, v_inv.id, v_amt)
      on conflict (payment_id, invoice_id) do update set amount = excluded.amount;
      v_applied := v_applied + v_amt;
    end loop;
    if v_applied > round(p_amount + coalesce(p_discount, 0), 2) + 0.004 then
      raise exception 'You applied % but the payment (with any discount) is only %.', to_char(v_applied, 'FM$999,999,990.00'), to_char(p_amount + coalesce(p_discount, 0), 'FM$999,999,990.00');
    end if;
  end if;
  return v_id;
end $$;

-- Every customer's credit right now. Open invoices age by their due date (so past due grows by itself), minus what was
-- applied to each since the import; unapplied payments come off the oldest past due first; orders shipped since the
-- import are added as current. Customers that share a parent's line (MacArthur) get the group's totals too.
drop function if exists public.credit_overview();
drop function if exists public.credit_rows();
create or replace function public.credit_rows()
returns table (company_id uuid, name text, account_no text, branch text, rep_id uuid, credit_limit numeric, terms text, as_of date,
               imported numeric, shipped_since numeric, paid_since numeric, balance numeric, past_due numeric, over_90 numeric, d61_90 numeric,
               d31_60 numeric, d1_30 numeric, current_due numeric, available numeric, last_paid date, last_paid_amount numeric,
               paid_90 numeric, orders_open numeric, holds int, pay_cod boolean, next_follow date,
               status text, parent_id uuid, flags text[], limit_prior numeric, manual boolean,
               group_limit numeric, group_balance numeric, group_open numeric, group_available numeric, group_past_due numeric,
               open_invoices int, oldest_due date, max_days_late int)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'America/Chicago')::date as d),
  split as (
    -- each payment counts for the customer whose invoices it paid (a corporate check can pay its locations);
    -- whatever wasn't applied to an invoice stays with the customer who paid
    select i.company_id, p.paid_on, p.kind, a.amount as amt
      from public.payment_applications a join public.customer_payments p on p.id = a.payment_id
      join public.customer_invoices i on i.id = a.invoice_id
     where p.voided_at is null and p.kind <> 'refund'
    union all
    select p.company_id, p.paid_on, p.kind,
           case when p.kind = 'refund' then p.amount
                else p.amount + p.discount - coalesce((select sum(a.amount) from public.payment_applications a where a.payment_id = p.id), 0) end
      from public.customer_payments p where p.voided_at is null
  ), pay0 as (
    select s.company_id,
           sum(case when s.kind = 'refund' then 0 else s.amt end) filter (where c.ar_as_of is null or s.paid_on > c.ar_as_of) as since,
           sum(s.amt) filter (where s.kind = 'refund' and (c.ar_as_of is null or s.paid_on > c.ar_as_of)) as refunds
      from split s join public.companies c on c.id = s.company_id group by s.company_id
  ), pay as (
    select coalesce(x.company_id, y.company_id) as company_id, x.since, x.refunds, y.last_on, y.d90
      from pay0 x full join (
        select p.company_id, max(p.paid_on) filter (where p.kind = 'payment') as last_on,
               sum(p.amount) filter (where p.kind = 'payment' and p.paid_on >= (select d from today) - 90) as d90
          from public.customer_payments p where p.voided_at is null group by p.company_id
      ) y on y.company_id = x.company_id
  ), lastp as (
    select distinct on (company_id) company_id, amount from public.customer_payments where voided_at is null and kind = 'payment' order by company_id, paid_on desc, id desc
  ), appl as (
    select a.invoice_id, sum(a.amount) as amt
      from public.payment_applications a join public.customer_payments p on p.id = a.payment_id
      join public.customer_invoices i on i.id = a.invoice_id
     where p.voided_at is null and p.paid_on > i.as_of
     group by a.invoice_id
  ), inv as (
    select i.company_id, i.open_balance, i.open_balance - coalesce(ap.amt, 0) as rem, coalesce(ap.amt, 0) as applied,
           (select d from today) - coalesce(i.due_date, i.txn_date) as late, coalesce(i.due_date, i.txn_date) as due
      from public.customer_invoices i left join appl ap on ap.invoice_id = i.id
     where i.status = 'open'
  ), items as (
    select company_id, open_balance as imported, rem, applied,
           case when late <= 0 then rem else 0 end as cur, case when late between 1 and 30 then rem else 0 end as b1,
           case when late between 31 and 60 then rem else 0 end as b2, case when late between 61 and 90 then rem else 0 end as b3,
           case when late > 90 then rem else 0 end as b4, case when rem > 0.004 then due end as due_open, case when rem > 0.004 and late > 0 then late end as late_open
      from inv
    union all
    -- Customers with only the older aging-summary import (no invoices yet).
    select c.id, coalesce(c.ar_balance, 0), coalesce(c.ar_balance, 0), 0, coalesce(c.ar_current, 0), coalesce(c.ar_1_30, 0), coalesce(c.ar_31_60, 0),
           coalesce(c.ar_61_90, 0), coalesce(c.ar_over_90, 0), null, null
      from public.companies c
     where c.ar_balance is not null and not exists (select 1 from public.customer_invoices i where i.company_id = c.id)
  ), agg as (
    select company_id, sum(imported) as imported, sum(rem) as rem, sum(applied) as applied, sum(cur) as cur, sum(b1) as b1, sum(b2) as b2, sum(b3) as b3, sum(b4) as b4,
           count(*) filter (where due_open is not null) as n_open, min(due_open) as oldest_due, max(late_open) as max_late
      from items group by company_id
  ), shipped as (
    select o.company_id,
           sum(coalesce(o.invoiced_total, o.est_subtotal)) filter (where o.status = 'completed' and (c.ar_as_of is null or o.completed_at::date > c.ar_as_of)) as since,
           sum(coalesce(o.invoiced_total, o.est_subtotal)) filter (where o.status not in ('completed', 'cancelled')) as open_amt,
           count(*) filter (where o.credit_status = 'hold' and o.status not in ('completed', 'cancelled')) as holds
      from public.orders o join public.companies c on c.id = o.company_id
     where o.company_id is not null and coalesce(o.kind, 'sale') <> 'return'
     group by o.company_id
  ), fol as (
    select company_id, min(follow_up_on) as next_follow from public.collection_notes where done_at is null and follow_up_on is not null group by company_id
  ), base as (
    select c.id, c.name, c.account_no, c.default_branch_id, c.sales_rep_id, c.credit_limit, c.terms, c.ar_as_of,
           coalesce(a.imported, 0) as imported, coalesce(s.since, 0) as shipped, coalesce(p.since, 0) as paid, coalesce(p.refunds, 0) as refunds,
           -- what was paid since but not applied to an invoice comes off the oldest first
           greatest(0, coalesce(p.since, 0) - coalesce(a.applied, 0)) as unapplied,
           coalesce(a.b4, 0) as b4, coalesce(a.b3, 0) as b3, coalesce(a.b2, 0) as b2, coalesce(a.b1, 0) as b1, coalesce(a.cur, 0) as cur, coalesce(a.rem, 0) as rem,
           p.last_on, lp.amount as last_amt, coalesce(p.d90, 0) as d90, coalesce(s.open_amt, 0) as open_amt, coalesce(s.holds, 0)::int as holds, c.pay_cod, f.next_follow,
           c.credit_status, c.credit_parent_id, c.credit_flags, c.credit_limit_prior, c.credit_manual,
           coalesce(a.n_open, 0)::int as n_open, a.oldest_due, a.max_late::int as max_late
      from public.companies c
      left join agg a on a.company_id = c.id
      left join pay p on p.company_id = c.id
      left join lastp lp on lp.company_id = c.id
      left join shipped s on s.company_id = c.id
      left join fol f on f.company_id = c.id
     where c.active
       and (c.credit_limit is not null or c.ar_balance is not null or c.credit_status is not null or c.credit_parent_id is not null or a.company_id is not null or p.company_id is not null)
  ), calc as (
    select b.*,
           greatest(0, b.b4 - b.unapplied) as o90,
           greatest(0, b.b3 - greatest(0, b.unapplied - b.b4)) as o61,
           greatest(0, b.b2 - greatest(0, b.unapplied - b.b4 - b.b3)) as o31,
           greatest(0, b.b1 - greatest(0, b.unapplied - b.b4 - b.b3 - b.b2)) as o1,
           b.cur + b.shipped + b.refunds - greatest(0, b.unapplied - greatest(0, b.b4) - greatest(0, b.b3) - greatest(0, b.b2) - greatest(0, b.b1)) as ocur,
           round(b.rem + b.shipped + b.refunds - b.unapplied, 2) as bal
      from base b
  ), grp as (
    select k.*, coalesce(k.credit_parent_id, k.id) as gid from calc k
  ), gsum as (
    select gid, sum(bal) as g_bal, sum(open_amt) as g_open, sum(o1 + o31 + o61 + o90) as g_pd from grp group by gid
  )
  select g.id, g.name, g.account_no, g.default_branch_id, g.sales_rep_id, g.credit_limit, g.terms, g.ar_as_of,
         g.imported, g.shipped, g.paid, g.bal, round(g.o1 + g.o31 + g.o61 + g.o90, 2), round(g.o90, 2), round(g.o61, 2), round(g.o31, 2), round(g.o1, 2), round(g.ocur, 2),
         case when coalesce(r.credit_limit, g.credit_limit) is null then null
              else round(coalesce(r.credit_limit, g.credit_limit) - gs.g_bal - gs.g_open, 2) end,
         g.last_on, g.last_amt, g.d90, g.open_amt, g.holds, g.pay_cod, g.next_follow,
         coalesce(g.credit_status, r.credit_status), g.credit_parent_id, g.credit_flags, g.credit_limit_prior, g.credit_manual or coalesce(r.credit_manual, false),
         coalesce(r.credit_limit, g.credit_limit), round(gs.g_bal, 2), round(gs.g_open, 2),
         case when coalesce(r.credit_limit, g.credit_limit) is null then null else round(coalesce(r.credit_limit, g.credit_limit) - gs.g_bal - gs.g_open, 2) end,
         round(gs.g_pd, 2), g.n_open, g.oldest_due, g.max_late
    from grp g
    join gsum gs on gs.gid = g.gid
    left join public.companies r on r.id = g.credit_parent_id
$$;
revoke all on function public.credit_rows() from public, anon, authenticated;

create or replace function public.credit_overview()
returns table (company_id uuid, name text, account_no text, branch text, rep_id uuid, credit_limit numeric, terms text, as_of date,
               imported numeric, shipped_since numeric, paid_since numeric, balance numeric, past_due numeric, over_90 numeric, d61_90 numeric,
               d31_60 numeric, d1_30 numeric, current_due numeric, available numeric, last_paid date, last_paid_amount numeric,
               paid_90 numeric, orders_open numeric, holds int, pay_cod boolean, next_follow date,
               status text, parent_id uuid, flags text[], limit_prior numeric, manual boolean,
               group_limit numeric, group_balance numeric, group_open numeric, group_available numeric, group_past_due numeric,
               open_invoices int, oldest_due date, max_days_late int)
language sql stable security definer set search_path = public as $$
  select * from public.credit_rows() where public.can_credit()
$$;

-- The credit step, done by the app: an order releases itself when the customer has a line of credit, nothing is past due
-- (the whole group, for shared lines), and the line still covers the balance plus every open order including this one.
-- Otherwise it waits for Accounting with the reason written on the order.
create or replace function public.credit_auto_release(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; c public.companies; r record; ts text; v_total numeric; why text; on_ boolean;
begin
  if not (public.is_admin() or public.has_perm('order_desk') or public.has_perm('credit_check')) then raise exception 'You don''t have access to the order desk.'; end if;
  on_ := coalesce((select (value ->> 'enabled')::boolean from public.app_settings where key = 'credit_auto'), false);
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not on_ then return jsonb_build_object('released', false, 'reason', 'off'); end if;
  if o.status in ('cancelled', 'completed') or o.ambit_po is null or (o.credit_status is not null and o.credit_status <> 'pending') then
    return jsonb_build_object('released', false, 'reason', 'not at the credit step');
  end if;
  select * into c from public.companies where id = o.company_id;
  select * into r from public.credit_rows() x where x.company_id = o.company_id;
  v_total := coalesce(o.invoiced_total, o.est_subtotal, 0);
  if c.id is null then why := 'No customer on the order.';
  elsif c.credit_manual or exists (select 1 from public.companies p where p.id = c.credit_parent_id and p.credit_manual) then why := 'This customer is set to "Check every order by hand".';
  elsif coalesce(r.status, '') <> 'line' then why := case r.status when 'revoked' then 'Credit line revoked.' when 'advance' then 'Pays in advance (no credit line).' when 'review' then 'Credit review in progress.' else 'No credit line on file.' end;
  elsif c.pay_cod then why := 'Marked COD only.';
  elsif exists (select 1 from public.order_items i where i.order_id = o.id and i.unit_price is null and not coalesce(i.customer_priced, false)) or v_total <= 0 then why := 'Some lines have no price yet.';
  elsif coalesce(r.group_past_due, 0) > 0 then why := 'Past due ' || to_char(r.group_past_due, 'FM$999,999,990.00') || case when r.parent_id is not null then ' (with the other locations on this line)' else '' end || '.';
  elsif r.group_available is null then why := 'No credit limit on file.';
  elsif r.group_available < 0 then why := 'Over the line by ' || to_char(-r.group_available, 'FM$999,999,990.00') || ' with this order (line ' || to_char(r.group_limit, 'FM$999,999,990') ||
                                          ', balance ' || to_char(r.group_balance, 'FM$999,999,990.00') || ', open orders ' || to_char(r.group_open, 'FM$999,999,990.00') || ').';
  else
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') then why := 'Tax-exempt certificate ' || case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'not verified yet' end || '.'; end if;
  end if;
  if why is not null then
    update public.orders set credit_auto_note = why where id = o.id;
    return jsonb_build_object('released', false, 'reason', why);
  end if;
  update public.orders
     set credit_status = 'approved', credit_by_name = 'Automatic (credit line)', credit_at = now(), credit_auto_note = null,
         credit_note = 'Released automatically: line ' || to_char(r.group_limit, 'FM$999,999,990') || ', balance ' || to_char(r.group_balance, 'FM$999,999,990.00') ||
                       ', open orders incl. this one ' || to_char(r.group_open, 'FM$999,999,990.00') || ', ' || to_char(r.group_available, 'FM$999,999,990.00') ||
                       ' still available, nothing past due.'
   where id = o.id;
  return jsonb_build_object('released', true, 'available', r.group_available);
end $$;

create or replace function public.credit_auto_set(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins turn automatic credit release on or off.'; end if;
  insert into public.app_settings (key, value) values ('credit_auto', jsonb_build_object('enabled', coalesce(p_on, false)))
  on conflict (key) do update set value = excluded.value;
end $$;

-- =====================================================================================================================
-- B. Customer prices
-- =====================================================================================================================
create table if not exists public.customer_prices (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  price           numeric(12,4) not null check (price >= 0),
  basis           text not null default 'unit' check (basis in ('unit', 'lb', 'sqft')),
  effective_on    date not null default ((now() at time zone 'America/Chicago')::date),
  expires_on      date,
  source          text not null default 'manual' check (source in ('manual', 'price_request', 'import', 'netsuite')),
  source_ref      text,
  note            text,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  unique (company_id, product_id)
);
create index if not exists customer_prices_product on public.customer_prices(product_id);
create table if not exists public.customer_price_history (
  id              bigint generated always as identity primary key,
  company_id      uuid not null,
  product_id      uuid not null,
  price           numeric(12,4),
  basis           text,
  source          text,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);
create index if not exists customer_price_history_cp on public.customer_price_history(company_id, product_id, changed_at desc);
alter table public.customer_prices enable row level security;
alter table public.customer_price_history enable row level security;
drop policy if exists customer_prices_read on public.customer_prices;
drop policy if exists customer_price_history_read on public.customer_price_history;
create policy customer_prices_read on public.customer_prices for select to authenticated using (public.is_employee());
create policy customer_price_history_read on public.customer_price_history for select to authenticated using (public.is_admin() or public.has_perm('prf_approve'));

create or replace function public.can_price() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_admin() or public.has_perm('prf_approve') $$;

-- Set (or clear) prices. p_items: [{"company_id", "product_id", "price" (null = remove), "basis", "effective_on", "expires_on", "note"}]
create or replace function public.customer_prices_save(p_items jsonb, p_source text default 'manual', p_ref text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare ln jsonb; n int := 0; v_name text := public.my_name(); v_price numeric; v_basis text;
begin
  if not public.can_price() then raise exception 'Only admins and price approvers change customer prices.'; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(ln ->> 'price', '') = '' then
      delete from public.customer_prices where company_id = (ln ->> 'company_id')::uuid and product_id = (ln ->> 'product_id')::uuid;
      if found then
        insert into public.customer_price_history (company_id, product_id, price, basis, source, changed_by_name) values ((ln ->> 'company_id')::uuid, (ln ->> 'product_id')::uuid, null, null, 'removed', v_name);
        n := n + 1;
      end if;
      continue;
    end if;
    v_price := round((ln ->> 'price')::numeric, 4);
    if v_price < 0 then raise exception 'Prices can''t be negative.'; end if;
    v_basis := case when ln ->> 'basis' in ('unit', 'lb', 'sqft') then ln ->> 'basis' else 'unit' end;
    insert into public.customer_prices (company_id, product_id, price, basis, effective_on, expires_on, source, source_ref, note, updated_by_name, updated_at)
    values ((ln ->> 'company_id')::uuid, (ln ->> 'product_id')::uuid, v_price, v_basis,
            coalesce(nullif(ln ->> 'effective_on', '')::date, (now() at time zone 'America/Chicago')::date), nullif(ln ->> 'expires_on', '')::date,
            case when p_source in ('manual', 'price_request', 'import', 'netsuite') then p_source else 'manual' end, p_ref, nullif(left(trim(coalesce(ln ->> 'note', '')), 300), ''), v_name, now())
    on conflict (company_id, product_id) do update
      set price = excluded.price, basis = excluded.basis, effective_on = excluded.effective_on, expires_on = excluded.expires_on, source = excluded.source,
          source_ref = excluded.source_ref, note = coalesce(excluded.note, customer_prices.note), updated_by_name = v_name, updated_at = now()
      where customer_prices.price is distinct from excluded.price or customer_prices.basis is distinct from excluded.basis
         or customer_prices.expires_on is distinct from excluded.expires_on or customer_prices.effective_on is distinct from excluded.effective_on;
    if found then
      insert into public.customer_price_history (company_id, product_id, price, basis, source, changed_by_name)
      values ((ln ->> 'company_id')::uuid, (ln ->> 'product_id')::uuid, v_price, v_basis, p_source, v_name);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Approved price requests become the customer's prices (the customer needs to be in the app).
create or replace function public.customer_prices_from_request(p_request bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r public.price_requests; n int := 0;
begin
  select * into r from public.price_requests where id = p_request;
  if r.id is null or r.company_id is null then return 0; end if;
  insert into public.customer_prices (company_id, product_id, price, basis, effective_on, expires_on, source, source_ref, updated_by_name, updated_at)
  select r.company_id, l.product_id, l.approved_price, coalesce(l.basis, 'unit'), (now() at time zone 'America/Chicago')::date, r.valid_until, 'price_request', 'PRF-' || r.id,
         coalesce(r.decided_by_name, 'Price request'), now()
    from public.price_request_lines l
   where l.request_id = r.id and l.status = 'approved' and l.approved_price is not null and l.product_id is not null
  on conflict (company_id, product_id) do update
    set price = excluded.price, basis = excluded.basis, effective_on = excluded.effective_on, expires_on = excluded.expires_on, source = excluded.source,
        source_ref = excluded.source_ref, updated_by_name = excluded.updated_by_name, updated_at = now();
  get diagnostics n = row_count;
  insert into public.customer_price_history (company_id, product_id, price, basis, source, changed_by_name)
  select r.company_id, l.product_id, l.approved_price, coalesce(l.basis, 'unit'), 'price_request', coalesce(r.decided_by_name, 'Price request')
    from public.price_request_lines l where l.request_id = r.id and l.status = 'approved' and l.approved_price is not null and l.product_id is not null;
  return n;
end $$;

-- =====================================================================================================================
-- C. Native forms
-- =====================================================================================================================

-- Price Request Form, the smart version: existing or new customer, every customer field, the product lines being
-- quoted, and the hand-off to the Credit Application and Customer Account Setup.
alter table public.price_requests add column if not exists customer_kind  text;
alter table public.price_requests drop constraint if exists price_requests_customer_kind_check;
alter table public.price_requests add constraint price_requests_customer_kind_check check (customer_kind is null or customer_kind in ('existing', 'new', 'previous'));
alter table public.price_requests add column if not exists customer       jsonb not null default '{}';
alter table public.price_requests add column if not exists product_lines  text[] not null default '{}';
alter table public.price_request_lines add column if not exists basis text not null default 'unit';

create table if not exists public.form_submissions (
  id               bigint generated always as identity primary key,
  form_key         text not null,
  ref_no           text unique,
  status           text not null default 'submitted' check (status in ('draft', 'sent', 'submitted', 'approved', 'denied', 'closed', 'withdrawn')),
  data             jsonb not null default '{}',
  secrets          text,            -- SSN / bank account, encrypted by the app (AES-256-GCM); never sent to the browser whole
  score            int,
  company_id       uuid references public.companies(id) on delete set null,
  price_request_id bigint references public.price_requests(id) on delete set null,
  parent_id        bigint references public.form_submissions(id) on delete set null,
  public_token     text unique,
  token_expires    timestamptz,
  submitted_by     uuid references public.profiles(id) on delete set null,
  submitted_name   text,
  submitted_at     timestamptz,
  for_day          date,            -- Daily Pulse: the day it covers
  decided_by_name  text,
  decided_at       timestamptz,
  decision_note    text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists form_submissions_key on public.form_submissions(form_key, created_at desc);
create index if not exists form_submissions_company on public.form_submissions(company_id);
create index if not exists form_submissions_prf on public.form_submissions(price_request_id);
create unique index if not exists form_submissions_pulse_day on public.form_submissions(form_key, submitted_by, for_day) where for_day is not null;
alter table public.form_submissions enable row level security;
drop policy if exists form_submissions_read on public.form_submissions;

-- Who reviews each form: credit forms go to Accounting and admins (and the rep whose price request started them),
-- RMAs to the order desk, complaints and admins, Travel / Time Off and Daily Pulse to admins, Spray Data to the
-- spray log team; everyone sees their own.
create or replace function public.form_reviewer(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or case
    when p_key in ('credit_app', 'account_setup') then public.has_perm('credit_check') or public.has_perm('add_customers')
    when p_key = 'rma' then public.has_perm('order_desk') or public.has_perm('complaints')
    when p_key = 'spray_data' then public.has_perm('spray_log')
    when p_key = 'contact_info' then public.is_employee()
    else false end
$$;
create policy form_submissions_read on public.form_submissions for select to authenticated
  using (submitted_by = auth.uid() or created_by = auth.uid() or public.form_reviewer(form_key)
         or (price_request_id is not null and exists (select 1 from public.price_requests r where r.id = price_request_id and r.created_by = auth.uid())));

-- Ref numbers: CA-2026-0001, AS-, RMA-, TR-, TO-, SD-, CI-, DP-
create or replace function public.form_ref(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare pre text; y text := to_char(now() at time zone 'America/Chicago', 'YYYY'); n int;
begin
  pre := case p_key when 'credit_app' then 'CA' when 'account_setup' then 'AS' when 'rma' then 'RMA' when 'travel' then 'TR' when 'time_off' then 'TO'
                    when 'spray_data' then 'SD' when 'contact_info' then 'CI' else 'DP' end;
  select count(*) + 1 into n from public.form_submissions where ref_no like pre || '-' || y || '-%';
  return pre || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

-- Pulse department for each person (Admin > Accounts); empty = they don't fill one in.
alter table public.profiles add column if not exists pulse_dept text;
alter table public.profiles drop constraint if exists profiles_pulse_dept_check;
alter table public.profiles add constraint profiles_pulse_dept_check check (pulse_dept is null or pulse_dept in ('mfg', 'lab', 'sales', 'tech', 'admin'));


-- The smart Price Request: p = {"customer_kind", "company_id", "customer": {...}, "product_lines": [...], "branch", "note", "valid_days",
--   "lines": [{"product_id", "price", "basis", "volume"}]}. Every customer field is required; lines that meet the rules approve themselves.
create or replace function public.price_request_submit2(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; co public.companies; v_id bigint; ln jsonb; pr public.products; v_price numeric; v_rule text; n int := 0; a int := 0; r jsonb;
        cu jsonb := coalesce(p -> 'customer', '{}'::jsonb); k text; v_kind text; v_name text; v_basis text; miss text[] := '{}';
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or not (me.role = 'admin' or public.has_perm('price_requests')) then raise exception 'You don''t have access to price requests.'; end if;
  v_kind := case when p ->> 'customer_kind' in ('existing', 'new', 'previous') then p ->> 'customer_kind' else null end;
  if v_kind is null then raise exception 'Pick whether this is an existing customer or a new one.'; end if;
  if v_kind = 'existing' then
    select * into co from public.companies where id = nullif(p ->> 'company_id', '')::uuid;
    if co.id is null then raise exception 'Pick the customer from the list.'; end if;
  end if;
  foreach k in array array['legal_name', 'contact_first', 'contact_last', 'email', 'phone', 'street', 'city', 'state', 'zip', 'customer_type',
                           'rigs', 'monthly_sets', 'billing_terms', 'credit_range', 'tax_ack', 'freight_included'] loop
    if coalesce(trim(cu ->> k), '') = '' then miss := array_append(miss, k); end if;
  end loop;
  if v_kind <> 'existing' and coalesce(trim(cu ->> 'wants_credit'), '') = '' then miss := array_append(miss, 'wants_credit'); end if;
  if array_length(miss, 1) > 0 then raise exception 'Fill in every customer field (missing: %).', array_to_string(miss, ', '); end if;
  if coalesce(trim(p ->> 'note'), '') = '' then raise exception 'Add a note (current vendor, complaints, prior AMBIT customer…).'; end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'Add at least one product and the price you need.'; end if;
  r := coalesce((select value from public.app_settings where key = 'price_rules'), '{}'::jsonb);
  v_name := coalesce(co.name, left(trim(cu ->> 'legal_name'), 160));
  insert into public.price_requests (created_by, rep_name, company_id, company_name, contact, branch_id, note, valid_until, customer_kind, customer, product_lines)
  values (me.id, coalesce(nullif(me.full_name, ''), me.email), co.id, v_name, left(trim(coalesce(cu ->> 'contact_first', '') || ' ' || coalesce(cu ->> 'contact_last', '')), 160),
          case when exists (select 1 from public.branches where id = p ->> 'branch') then p ->> 'branch' end,
          left(trim(p ->> 'note'), 2000), (now() at time zone 'America/Chicago')::date + greatest(7, least(coalesce((p ->> 'valid_days')::int, 90), 365)),
          v_kind, cu, coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'product_lines', '[]'::jsonb)) x), '{}'))
  returning id into v_id;
  for ln in select * from jsonb_array_elements(p -> 'lines') loop
    v_price := round(coalesce(nullif(ln ->> 'price', '')::numeric, 0), 4);
    if v_price <= 0 then continue; end if;
    select * into pr from public.products where id = nullif(ln ->> 'product_id', '')::uuid and not coalesce(admin_only, false);
    if pr.id is null then raise exception 'One of the products isn''t available.'; end if;
    v_basis := case when ln ->> 'basis' in ('unit', 'lb', 'sqft') then ln ->> 'basis' else 'unit' end;
    v_rule := case when v_basis = 'unit' and jsonb_array_length(p -> 'lines') <= coalesce((r ->> 'max_lines')::int, 15) then public.price_rule_check(pr.id, v_price) end;
    insert into public.price_request_lines (request_id, product_id, sku, name, unit, list_price, requested_price, volume, approved_price, status, auto, rule, basis)
    values (v_id, pr.id, pr.sku, pr.name, case v_basis when 'lb' then 'lb' when 'sqft' then 'sq ft' else pr.unit end,
            case when v_basis = 'unit' then (case when public.sale_on(pr.sale_price, pr.sale_ends) then pr.sale_price else pr.list_price end) end,
            v_price, nullif(left(trim(coalesce(ln ->> 'volume', '')), 80), ''),
            case when v_rule is not null then v_price end, case when v_rule is not null then 'approved' else 'pending' end, v_rule is not null, v_rule, v_basis);
    n := n + 1;
    if v_rule is not null then a := a + 1; end if;
  end loop;
  if n = 0 then raise exception 'Add at least one product and the price you need.'; end if;
  update public.price_requests
     set status = case when a = n then 'approved' else 'pending' end,
         decided_by_name = case when a = n then 'Auto-approved (rules)' end,
         decided_at = case when a = n then now() end
   where id = v_id;
  if a = n then perform public.customer_prices_from_request(v_id); end if;
  return jsonb_build_object('id', v_id, 'lines', n, 'auto', a);
end $$;

-- A manager decides (same as 0066), and approved prices become the customer's prices.
create or replace function public.price_request_decide(p_id bigint, p_lines jsonb, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_name text; v_p int; v_a int; v_d int; v_status text;
begin
  if not public.has_perm('prf_approve') then raise exception 'Only price approvers can do that.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.price_request_lines
       set status = case when ln ->> 'status' = 'denied' then 'denied' else 'approved' end,
           approved_price = case when ln ->> 'status' = 'denied' then null else round(coalesce(nullif(ln ->> 'price', '')::numeric, requested_price), 4) end,
           auto = false, rule = null
     where id = (ln ->> 'id')::bigint and request_id = p_id;
  end loop;
  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved'), count(*) filter (where status = 'denied')
    into v_p, v_a, v_d from public.price_request_lines where request_id = p_id;
  v_status := case when v_p > 0 then 'pending' when v_d = 0 then 'approved' when v_a = 0 then 'denied' else 'partly' end;
  update public.price_requests
     set status = v_status, decided_by_name = case when v_p = 0 then v_name end, decided_at = case when v_p = 0 then now() end,
         decision_note = nullif(left(trim(coalesce(p_note, '')), 2000), '')
   where id = p_id;
  if not found then raise exception 'Price request not found.'; end if;
  if v_status in ('approved', 'partly') then perform public.customer_prices_from_request(p_id); end if;
  return v_status;
end $$;

-- A new customer's price request, once the customer is in the app (after account setup): link it and carry the prices over.
create or replace function public.price_request_link(p_request bigint, p_company uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('credit_check') or public.has_perm('add_customers')) then raise exception 'Only admins and accounting link customers.'; end if;
  update public.price_requests set company_id = p_company where id = p_request;
  return public.customer_prices_from_request(p_request);
end $$;

-- Files on forms (photo ID, EIN letter, driver's license, RMA photos). Private: only the app's server reads and writes it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forms', 'forms', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Saving goes through the app's server (it checks who may do what, encrypts the private fields and emails people).
do $$
declare f text;
begin
  foreach f in array array['credit_invoices_import(date, jsonb, boolean)', 'credit_profile_set(uuid, text, numeric, text, text, uuid, boolean, text[])',
    'payment_record(uuid, text, text, numeric, date, text, text, text, numeric, numeric, text, jsonb, uuid)', 'credit_overview()', 'credit_auto_release(uuid)',
    'credit_auto_set(boolean)', 'can_price()', 'customer_prices_save(jsonb, text, text)', 'customer_prices_from_request(bigint)', 'form_reviewer(text)', 'form_ref(text)',
    'price_request_submit2(jsonb)', 'price_request_decide(bigint, jsonb, text)', 'price_request_link(bigint, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 5 (invoices, applications, customer prices, forms, credit status).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('customer_invoices', 'payment_applications', 'customer_prices', 'form_submissions'))
     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'credit_status')
       as "Ready (should be 5)";
