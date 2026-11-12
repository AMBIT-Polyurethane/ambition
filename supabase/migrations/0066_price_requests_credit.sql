-- 0066: Price Requests in the app (with rules for approving them automatically), and customer credit: each
-- customer's credit line, balance and past due (imported), payments the CRMs enter, and collections notes.
-- Safe to run more than once.

-- ---------- Price requests ----------------------------------------------------------
create table if not exists public.price_requests (
  id               bigint generated always as identity primary key,
  created_by       uuid references public.profiles(id) on delete set null,
  rep_name         text,
  company_id       uuid references public.companies(id) on delete set null,
  company_name     text not null,
  contact          text,
  branch_id        text references public.branches(id) on update cascade,
  note             text,
  valid_until      date,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'partly', 'denied', 'withdrawn')),
  decided_by_name  text,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now()
);
create index if not exists price_requests_status on public.price_requests(status, created_at desc);
create index if not exists price_requests_company on public.price_requests(company_id);
create table if not exists public.price_request_lines (
  id              bigint generated always as identity primary key,
  request_id      bigint not null references public.price_requests(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  sku             text not null,
  name            text not null,
  unit            text,
  list_price      numeric(12,2),
  requested_price numeric(12,2) not null check (requested_price > 0),
  volume          text,
  approved_price  numeric(12,2),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  auto            boolean not null default false,
  rule            text
);
create index if not exists price_request_lines_req on public.price_request_lines(request_id);
-- Lowest price each product can go to without a manager (admins only can see these).
create table if not exists public.price_floors (
  product_id      uuid primary key references public.products(id) on delete cascade,
  floor           numeric(12,2) not null check (floor >= 0),
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
alter table public.price_requests enable row level security;
alter table public.price_request_lines enable row level security;
alter table public.price_floors enable row level security;
drop policy if exists price_requests_read on public.price_requests;
drop policy if exists price_request_lines_read on public.price_request_lines;
drop policy if exists price_floors_read on public.price_floors;
-- Your own, plus approvers and the order desk (they price orders from them).
create policy price_requests_read on public.price_requests for select to authenticated
  using (created_by = auth.uid() or public.has_perm('prf_approve') or public.has_perm('order_desk') or public.has_perm('credit_check'));
create policy price_request_lines_read on public.price_request_lines for select to authenticated
  using (exists (select 1 from public.price_requests r where r.id = request_id));
create policy price_floors_read on public.price_floors for select to authenticated using (public.has_perm('prf_approve'));

-- The rules (Price requests > Rules): {"enabled": true, "max_pct": 5, "cat_pct": {"ppe": 10}, "never": ["ambit-foam"], "max_lines": 10}
insert into public.app_settings (key, value) values ('price_rules', '{"enabled": false, "max_pct": 5, "cat_pct": {}, "never": [], "max_lines": 15}')
on conflict (key) do nothing;

-- One line: does it meet the rules? Gives back the rule it met, or null (a manager decides).
create or replace function public.price_rule_check(p_product uuid, p_price numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; p public.products; v_list numeric; v_floor numeric; v_pct numeric;
begin
  r := coalesce((select value from public.app_settings where key = 'price_rules'), '{}'::jsonb);
  if not coalesce((r ->> 'enabled')::boolean, false) then return null; end if;
  select * into p from public.products where id = p_product;
  if p.id is null or coalesce(p.admin_only, false) then return null; end if;
  if coalesce(r -> 'never', '[]'::jsonb) ? coalesce(p.category_id, '') then return null; end if;
  v_list := case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end;
  select floor into v_floor from public.price_floors where product_id = p_product;
  if v_floor is not null and p_price < v_floor then return null; end if;
  if v_list is null or v_list <= 0 then
    return case when v_floor is not null then 'At or above the floor price' end;
  end if;
  v_pct := coalesce(nullif(r -> 'cat_pct' ->> coalesce(p.category_id, ''), '')::numeric, (r ->> 'max_pct')::numeric, 0);
  if p_price >= round(v_list * (1 - v_pct / 100), 2) then
    return case when p_price >= v_list then 'At or above list price' else 'Within ' || trim(to_char(v_pct, 'FM990.##')) || '% of list' end;
  end if;
  return null;
end $$;

-- A rep sends a request. p_lines: [{"product_id", "price", "volume"}]. Lines that meet the rules are approved
-- right away; the rest wait for a manager.
create or replace function public.price_request_submit(p_company uuid, p_company_name text, p_contact text, p_branch text, p_note text, p_valid_days int, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; co public.companies; v_id bigint; ln jsonb; p public.products; v_price numeric; v_rule text; n int := 0; a int := 0; r jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or not (me.role = 'admin' or public.has_perm('price_requests')) then raise exception 'You don''t have access to price requests.'; end if;
  if p_company is not null then select * into co from public.companies where id = p_company; end if;
  if co.id is null and coalesce(trim(p_company_name), '') = '' then raise exception 'Pick the customer (or type a new one).'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one product and the price you need.'; end if;
  r := coalesce((select value from public.app_settings where key = 'price_rules'), '{}'::jsonb);
  insert into public.price_requests (created_by, rep_name, company_id, company_name, contact, branch_id, note, valid_until)
  values (me.id, coalesce(nullif(me.full_name, ''), me.email), co.id, coalesce(co.name, left(trim(p_company_name), 160)),
          nullif(left(trim(coalesce(p_contact, '')), 160), ''),
          case when exists (select 1 from public.branches where id = p_branch) then p_branch end,
          nullif(left(trim(coalesce(p_note, '')), 2000), ''),
          (now() at time zone 'America/Chicago')::date + greatest(7, least(coalesce(p_valid_days, 90), 365)))
  returning id into v_id;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_price := round(coalesce(nullif(ln ->> 'price', '')::numeric, 0), 2);
    if v_price <= 0 then continue; end if;
    select * into p from public.products where id = nullif(ln ->> 'product_id', '')::uuid and not coalesce(admin_only, false);
    if p.id is null then raise exception 'One of the products isn''t available.'; end if;
    v_rule := case when jsonb_array_length(p_lines) <= coalesce((r ->> 'max_lines')::int, 15) then public.price_rule_check(p.id, v_price) end;
    insert into public.price_request_lines (request_id, product_id, sku, name, unit, list_price, requested_price, volume, approved_price, status, auto, rule)
    values (v_id, p.id, p.sku, p.name, p.unit, case when public.sale_on(p.sale_price, p.sale_ends) then p.sale_price else p.list_price end,
            v_price, nullif(left(trim(coalesce(ln ->> 'volume', '')), 80), ''),
            case when v_rule is not null then v_price end, case when v_rule is not null then 'approved' else 'pending' end, v_rule is not null, v_rule);
    n := n + 1;
    if v_rule is not null then a := a + 1; end if;
  end loop;
  if n = 0 then raise exception 'Add at least one product and the price you need.'; end if;
  update public.price_requests
     set status = case when a = n then 'approved' else 'pending' end,
         decided_by_name = case when a = n then 'Auto-approved (rules)' end,
         decided_at = case when a = n then now() end
   where id = v_id;
  return jsonb_build_object('id', v_id, 'lines', n, 'auto', a);
end $$;

-- A manager decides. p_lines: [{"id", "status": "approved"|"denied", "price"}]
create or replace function public.price_request_decide(p_id bigint, p_lines jsonb, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_name text; v_p int; v_a int; v_d int; v_status text;
begin
  if not public.has_perm('prf_approve') then raise exception 'Only price approvers can do that.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update public.price_request_lines
       set status = case when ln ->> 'status' = 'denied' then 'denied' else 'approved' end,
           approved_price = case when ln ->> 'status' = 'denied' then null else round(coalesce(nullif(ln ->> 'price', '')::numeric, requested_price), 2) end,
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
  return v_status;
end $$;

create or replace function public.price_request_withdraw(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.price_requests set status = 'withdrawn' where id = p_id and created_by = auth.uid() and status = 'pending'
$$;

-- Admins: floor prices. p_items: [{"product_id", "floor": 123.45 or null}]
create or replace function public.price_floor_set(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare ln jsonb; n int := 0; v_name text;
begin
  if not public.is_admin() then raise exception 'Only admins set floor prices.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  for ln in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(ln ->> 'floor', '') = '' then
      delete from public.price_floors where product_id = (ln ->> 'product_id')::uuid;
    else
      insert into public.price_floors (product_id, floor, updated_by_name, updated_at)
      values ((ln ->> 'product_id')::uuid, round((ln ->> 'floor')::numeric, 2), v_name, now())
      on conflict (product_id) do update set floor = excluded.floor, updated_by_name = excluded.updated_by_name, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Customer credit ------------------------------------------------------------
alter table public.companies add column if not exists credit_limit   numeric(12,2);
alter table public.companies add column if not exists ar_balance     numeric(12,2);
alter table public.companies add column if not exists ar_current     numeric(12,2);
alter table public.companies add column if not exists ar_1_30        numeric(12,2);
alter table public.companies add column if not exists ar_31_60       numeric(12,2);
alter table public.companies add column if not exists ar_61_90       numeric(12,2);
alter table public.companies add column if not exists ar_over_90     numeric(12,2);
alter table public.companies add column if not exists ar_as_of       date;
alter table public.companies add column if not exists terms          text;
alter table public.companies add column if not exists credit_note    text;

create table if not exists public.customer_payments (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  amount          numeric(12,2) not null check (amount > 0),
  paid_on         date not null,
  method          text not null default 'check' check (method in ('check', 'card', 'ach', 'wire', 'cash', 'other')),
  ref             text,
  invoice_no      text,
  order_id        uuid references public.orders(id) on delete set null,
  note            text,
  entered_by      uuid references public.profiles(id) on delete set null,
  entered_by_name text,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by_name  text
);
create index if not exists customer_payments_company on public.customer_payments(company_id, paid_on desc);
create table if not exists public.collection_notes (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            text not null default 'note' check (kind in ('call', 'email', 'promise', 'note', 'hold', 'release')),
  body            text not null,
  promise_amount  numeric(12,2),
  follow_up_on    date,
  done_at         timestamptz,
  by_name         text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists collection_notes_company on public.collection_notes(company_id, created_at desc);
alter table public.customer_payments enable row level security;
alter table public.collection_notes enable row level security;
drop policy if exists customer_payments_read on public.customer_payments;
drop policy if exists collection_notes_read on public.collection_notes;
create policy customer_payments_read on public.customer_payments for select to authenticated using (public.is_employee());
create policy collection_notes_read on public.collection_notes for select to authenticated
  using (public.has_perm('credit_check') or public.has_perm('order_desk'));

-- Who works customer credit: admins, accounting (credit check) and the order desk (CRMs enter payments).
create or replace function public.can_credit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('credit_check') or public.has_perm('order_desk')
$$;

-- Import (Credit > Import): p_rows: [{"company_id", "credit_limit", "balance", "current", "d1_30", "d31_60", "d61_90", "over_90", "terms"}]
create or replace function public.credit_import(p_as_of date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare ln jsonb; n int := 0;
  num text := '^-?[0-9]+(\.[0-9]+)?$';
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and accounting import credit.'; end if;
  for ln in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update public.companies
       set credit_limit = case when ln ? 'credit_limit' and coalesce(ln ->> 'credit_limit', '') ~ num then (ln ->> 'credit_limit')::numeric else credit_limit end,
           ar_balance   = case when ln ? 'balance' and coalesce(ln ->> 'balance', '') ~ num then (ln ->> 'balance')::numeric else ar_balance end,
           ar_current   = case when ln ? 'current' then nullif(ln ->> 'current', '')::numeric else ar_current end,
           ar_1_30      = case when ln ? 'd1_30' then nullif(ln ->> 'd1_30', '')::numeric else ar_1_30 end,
           ar_31_60     = case when ln ? 'd31_60' then nullif(ln ->> 'd31_60', '')::numeric else ar_31_60 end,
           ar_61_90     = case when ln ? 'd61_90' then nullif(ln ->> 'd61_90', '')::numeric else ar_61_90 end,
           ar_over_90   = case when ln ? 'over_90' then nullif(ln ->> 'over_90', '')::numeric else ar_over_90 end,
           terms        = case when coalesce(ln ->> 'terms', '') <> '' then left(ln ->> 'terms', 40) else terms end,
           ar_as_of     = case when ln ? 'balance' or ln ? 'current' then coalesce(p_as_of, ar_as_of) else ar_as_of end
     where id = (ln ->> 'company_id')::uuid;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- One customer's credit (Admin > Customers, the credit check): limit, terms, note.
create or replace function public.credit_set(p_company uuid, p_limit numeric, p_terms text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and accounting set credit lines.'; end if;
  update public.companies set credit_limit = p_limit, terms = nullif(left(trim(coalesce(p_terms, '')), 40), ''), credit_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
   where id = p_company;
end $$;

create or replace function public.payment_add(p_company uuid, p_amount numeric, p_paid_on date, p_method text, p_ref text, p_invoice text, p_order uuid, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_name text;
begin
  if not public.can_credit() then raise exception 'You can''t enter payments.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Type the amount paid.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.customer_payments (company_id, amount, paid_on, method, ref, invoice_no, order_id, note, entered_by, entered_by_name)
  values (p_company, round(p_amount, 2), coalesce(p_paid_on, (now() at time zone 'America/Chicago')::date),
          case when p_method in ('check', 'card', 'ach', 'wire', 'cash', 'other') then p_method else 'other' end,
          nullif(left(trim(coalesce(p_ref, '')), 60), ''), nullif(left(trim(coalesce(p_invoice, '')), 60), ''), p_order,
          nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid(), v_name)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.payment_void(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('credit_check')) then raise exception 'Only admins and accounting void payments.'; end if;
  update public.customer_payments set voided_at = now(), voided_by_name = public.my_name() where id = p_id and voided_at is null;
end $$;

create or replace function public.collection_note_add(p_company uuid, p_kind text, p_body text, p_promise numeric, p_follow date) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.can_credit() then raise exception 'You can''t add collection notes.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Type the note.'; end if;
  insert into public.collection_notes (company_id, kind, body, promise_amount, follow_up_on, by_name, created_by)
  values (p_company, case when p_kind in ('call', 'email', 'promise', 'note', 'hold', 'release') then p_kind else 'note' end,
          left(trim(p_body), 2000), p_promise, p_follow, public.my_name(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.collection_note_done(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.collection_notes set done_at = case when done_at is null then now() end where id = p_id and public.can_credit()
$$;

-- Each customer's credit right now: the imported balance, plus orders shipped since, minus payments since.
create or replace function public.credit_overview()
returns table (company_id uuid, name text, account_no text, branch text, rep_id uuid, credit_limit numeric, terms text, as_of date,
               imported numeric, shipped_since numeric, paid_since numeric, balance numeric, past_due numeric, over_90 numeric, d61_90 numeric,
               d31_60 numeric, d1_30 numeric, current_due numeric, available numeric, last_paid date, last_paid_amount numeric,
               paid_90 numeric, orders_open numeric, holds int, pay_cod boolean, next_follow date)
language sql stable security definer set search_path = public as $$
  with pay as (
    select p.company_id, sum(p.amount) filter (where c.ar_as_of is null or p.paid_on > c.ar_as_of) as since,
           max(p.paid_on) as last_on, sum(p.amount) filter (where p.paid_on >= current_date - 90) as d90
      from public.customer_payments p join public.companies c on c.id = p.company_id
     where p.voided_at is null group by p.company_id
  ), lastp as (
    select distinct on (company_id) company_id, amount from public.customer_payments where voided_at is null order by company_id, paid_on desc, id desc
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
  )
  select c.id, c.name, c.account_no, c.default_branch_id, c.sales_rep_id, c.credit_limit, c.terms, c.ar_as_of,
         coalesce(c.ar_balance, 0), coalesce(s.since, 0), coalesce(p.since, 0),
         round(coalesce(c.ar_balance, 0) + coalesce(s.since, 0) - coalesce(p.since, 0), 2),
         -- Payments since the import come off the oldest past due first.
         greatest(0, round(coalesce(c.ar_1_30, 0) + coalesce(c.ar_31_60, 0) + coalesce(c.ar_61_90, 0) + coalesce(c.ar_over_90, 0) - coalesce(p.since, 0), 2)),
         greatest(0, coalesce(c.ar_over_90, 0) - coalesce(p.since, 0)),
         greatest(0, coalesce(c.ar_61_90, 0) - greatest(0, coalesce(p.since, 0) - coalesce(c.ar_over_90, 0))),
         greatest(0, coalesce(c.ar_31_60, 0) - greatest(0, coalesce(p.since, 0) - coalesce(c.ar_over_90, 0) - coalesce(c.ar_61_90, 0))),
         greatest(0, coalesce(c.ar_1_30, 0) - greatest(0, coalesce(p.since, 0) - coalesce(c.ar_over_90, 0) - coalesce(c.ar_61_90, 0) - coalesce(c.ar_31_60, 0))),
         coalesce(c.ar_current, 0) + coalesce(s.since, 0),
         case when c.credit_limit is null then null
              else round(c.credit_limit - (coalesce(c.ar_balance, 0) + coalesce(s.since, 0) - coalesce(p.since, 0)) - coalesce(s.open_amt, 0), 2) end,
         p.last_on, lp.amount, coalesce(p.d90, 0), coalesce(s.open_amt, 0), coalesce(s.holds, 0)::int, c.pay_cod, f.next_follow
    from public.companies c
    left join pay p on p.company_id = c.id
    left join lastp lp on lp.company_id = c.id
    left join shipped s on s.company_id = c.id
    left join fol f on f.company_id = c.id
   where public.can_credit() and c.active
     and (c.credit_limit is not null or c.ar_balance is not null or p.company_id is not null)
$$;

do $$
declare f text;
begin
  foreach f in array array['price_rule_check(uuid, numeric)', 'price_request_submit(uuid, text, text, text, text, int, jsonb)',
    'price_request_decide(bigint, jsonb, text)', 'price_request_withdraw(bigint)', 'price_floor_set(jsonb)', 'can_credit()',
    'credit_import(date, jsonb)', 'credit_set(uuid, numeric, text, text)', 'payment_add(uuid, numeric, date, text, text, text, uuid, text)',
    'payment_void(bigint)', 'collection_note_add(uuid, text, text, numeric, date)', 'collection_note_done(bigint)', 'credit_overview()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 4 (price requests, floor prices, credit columns, payments).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('price_requests', 'price_floors', 'customer_payments'))
     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'credit_limit')
       as "Ready (should be 4)";
