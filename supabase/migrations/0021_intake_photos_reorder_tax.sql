-- =====================================================================
-- AMBIT Intelligence update 0021
-- * AI order intake: texted / emailed / handwritten orders become draft orders for staff to check.
-- * Photos in Ask AMBIT, and AMBIT complaint reports (CCR-2026-###) started from them.
-- * Smart reorder: each customer's usual items and rhythm, and customers who are overdue to order.
-- * Sales-tax exemption certificates: expiry warnings, contractor renewals, and orders from customers
--   with an expired certificate held at the credit check.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Photos (Ask AMBIT, order intake, complaint reports) ----------
-- Everyone uploads into their own folder (photos/<their id>/...). AMBIT staff can see every photo;
-- contractors only their own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_delete on storage.objects;
create policy photos_read on storage.objects for select to authenticated using (
  bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_employee()));
create policy photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
create policy photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

alter table public.ai_messages add column if not exists images text[];

-- ---------- AI order intake ---------------------------------------------
create table if not exists public.order_drafts (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  source_text     text,
  images          text[] not null default '{}',
  customer_text   text,                       -- the customer as the order named them
  matches         jsonb not null default '[]', -- customers it could be [{id, name, account_no, score}]
  company_id      uuid references public.companies(id) on delete set null,
  branch_id       text references public.branches(id) on update cascade on delete set null,
  delivery_method text,                       -- pickup | jobsite | dropship (blank = not said)
  ship_address    text,
  po_number       text,
  needed_by       date,
  notes           text,
  items           jsonb not null default '[]', -- [{raw, product_id, qty, confidence, note}]
  questions       text,                       -- what the reader couldn't tell
  status          text not null default 'draft',
  order_id        uuid references public.orders(id) on delete set null,
  model           text,
  cost_cents      numeric(10, 3),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.order_drafts add constraint order_drafts_status_check check (status in ('draft', 'opened', 'sent', 'discarded'));
exception when duplicate_object then null; end $$;
alter table public.order_drafts add column if not exists matches jsonb not null default '[]';
create index if not exists order_drafts_created_idx on public.order_drafts (created_at desc);

alter table public.order_drafts enable row level security;
drop policy if exists order_drafts_team on public.order_drafts;
create policy order_drafts_team on public.order_drafts for all to authenticated
  using (public.has_perm('ordering')) with check (public.has_perm('ordering'));

-- ---------- Complaint reports -------------------------------------------
create table if not exists public.complaint_reports (
  id                 uuid primary key default gen_random_uuid(),
  report_no          text unique,               -- CCR-2026-005, given when it's submitted
  report_year        int,
  report_seq         int,
  status             text not null default 'draft',
  created_by         uuid references public.profiles(id) on delete set null,
  created_by_name    text,
  created_by_role    public.user_role,
  company_id         uuid references public.companies(id) on delete set null,
  company_name       text,
  contact_name       text,
  contact_phone      text,
  contact_email      text,
  job_name           text,
  job_address        text,
  product            text,
  lot_numbers        text,
  sets_used          text,
  date_sprayed       date,
  application        text,                      -- where it was sprayed: walls, roof deck, attic floor...
  thickness          text,
  substrate          text,
  substrate_temp     text,
  substrate_moisture text,
  ambient_temp       text,
  humidity           text,
  equipment          text,                      -- proportioner, A/B temps, pressure, hose heat
  symptoms           text[] not null default '{}',
  description        text,
  ai_notes           text,                      -- what Ask AMBIT saw, with the TSBs it pointed to
  photos             text[] not null default '{}',
  thread_id          uuid references public.ai_threads(id) on delete set null,
  resolution         text,
  closed_by_name     text,
  closed_at          timestamptz,
  submitted_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
do $$ begin
  alter table public.complaint_reports add constraint complaint_reports_status_check check (status in ('draft', 'submitted', 'reviewing', 'closed'));
exception when duplicate_object then null; end $$;
create index if not exists complaint_reports_created_idx on public.complaint_reports (created_at desc);

alter table public.complaint_reports enable row level security;
drop policy if exists complaints_read   on public.complaint_reports;
drop policy if exists complaints_insert on public.complaint_reports;
drop policy if exists complaints_update on public.complaint_reports;
drop policy if exists complaints_delete on public.complaint_reports;
create policy complaints_read on public.complaint_reports for select to authenticated
  using (created_by = auth.uid() or public.has_perm('complaints') or public.is_admin()
         or (company_id is not null and company_id = public.my_company_id()));
create policy complaints_insert on public.complaint_reports for insert to authenticated
  with check (created_by = auth.uid() and status = 'draft' and public.is_active());
create policy complaints_update on public.complaint_reports for update to authenticated
  using ((created_by = auth.uid() and status = 'draft') or public.has_perm('complaints') or public.is_admin())
  with check ((created_by = auth.uid() and status = 'draft') or public.has_perm('complaints') or public.is_admin());
create policy complaints_delete on public.complaint_reports for delete to authenticated
  using ((created_by = auth.uid() and status = 'draft') or public.is_admin());

-- Submitting gives the report its number. Jeremiah filed CCR-2026-001 to -004 before the app, so 2026 continues at 005.
create or replace function public.complaint_submit(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.complaint_reports;
  y int := extract(year from now() at time zone 'America/Chicago')::int;
  n int;
begin
  select * into r from public.complaint_reports where id = p_id for update;
  if r.id is null then raise exception 'Report not found.'; end if;
  if r.created_by is distinct from auth.uid() and not public.has_perm('complaints') and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  if r.report_no is not null then
    update public.complaint_reports set status = case when status = 'draft' then 'submitted' else status end,
           submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_id;
    return r.report_no;
  end if;
  perform pg_advisory_xact_lock(hashtext('complaint_no_' || y));
  select coalesce(max(report_seq), case when y = 2026 then 4 else 0 end) + 1 into n
    from public.complaint_reports where report_year = y;
  update public.complaint_reports
     set report_year = y, report_seq = n, report_no = 'CCR-' || y || '-' || lpad(n::text, 3, '0'),
         status = 'submitted', submitted_at = now(), updated_at = now()
   where id = p_id;
  return 'CCR-' || y || '-' || lpad(n::text, 3, '0');
end $$;
revoke execute on function public.complaint_submit(uuid) from public, anon;
grant execute on function public.complaint_submit(uuid) to authenticated;

-- ---------- Smart reorder -----------------------------------------------
-- A customer's usual items: bought at least twice, how often (median days between) and how many (median).
-- Runs with the caller's own rules: contractors only ever see their own company's orders.
create or replace function public.reorder_suggestions(p_company uuid default null)
returns table (product_id uuid, times int, usual_days numeric, usual_qty numeric, last_at timestamptz, next_due date)
language sql stable set search_path = public as $$
  with o as (
    select o.created_at, i.product_id, sum(i.qty) as qty
      from public.orders o join public.order_items i on i.order_id = o.id
     where o.company_id = coalesce(p_company, public.my_company_id())
       and o.status <> 'cancelled' and i.product_id is not null
     group by o.id, o.created_at, i.product_id
  ), g as (
    select product_id, created_at, qty,
           extract(epoch from created_at - lag(created_at) over (partition by product_id order by created_at)) / 86400.0 as gap
      from o
  ), s as (
    select product_id, count(*)::int as times,
           percentile_cont(0.5) within group (order by gap) filter (where gap >= 3) as usual_days,
           percentile_cont(0.5) within group (order by qty) as usual_qty,
           max(created_at) as last_at
      from g group by product_id having count(*) >= 2
  )
  select product_id, times, round(usual_days::numeric, 1), round(usual_qty::numeric, 2), last_at,
         (last_at at time zone 'America/Chicago')::date + round(usual_days)::int
    from s where usual_days is not null
$$;

-- Customers who usually order every so often and are now well past it (AMBIT staff).
create or replace function public.customers_due(p_limit int default 50)
returns table (company_id uuid, company_name text, orders int, usual_days numeric, last_at timestamptz,
               days_since int, days_over int, last_order_id uuid, phone text, contact_name text, account_no text)
language sql stable set search_path = public as $$
  with o as (
    select company_id, id, created_at from public.orders
     where company_id is not null and status <> 'cancelled' and public.is_employee()
  ), g as (
    select company_id, id, created_at,
           extract(epoch from created_at - lag(created_at) over (partition by company_id order by created_at)) / 86400.0 as gap
      from o
  ), s as (
    select company_id, count(*)::int as n,
           percentile_cont(0.5) within group (order by gap) filter (where gap >= 3) as usual,
           max(created_at) as last_at
      from g group by company_id having count(*) >= 3
  )
  select s.company_id, c.name, s.n, round(s.usual::numeric, 1), s.last_at,
         (current_date - (s.last_at at time zone 'America/Chicago')::date)::int,
         ((current_date - (s.last_at at time zone 'America/Chicago')::date) - round(s.usual))::int,
         (select o2.id from o o2 where o2.company_id = s.company_id order by o2.created_at desc limit 1),
         c.phone, c.contact_name, c.account_no
    from s join public.companies c on c.id = s.company_id
   where s.usual is not null and c.active
     and (current_date - (s.last_at at time zone 'America/Chicago')::date) > greatest(s.usual * 1.25, s.usual + 5)
   order by (current_date - (s.last_at at time zone 'America/Chicago')::date) / nullif(s.usual, 0) desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;
revoke execute on function public.reorder_suggestions(uuid) from public, anon;
revoke execute on function public.customers_due(int) from public, anon;
grant execute on function public.reorder_suggestions(uuid) to authenticated;
grant execute on function public.customers_due(int) to authenticated;

-- ---------- Sales-tax exemption certificates ------------------------------
alter table public.companies add column if not exists tax_exempt boolean not null default false;
alter table public.orders add column if not exists tax_note text;  -- e.g. "Charge sales tax: certificate expired"

create table if not exists public.tax_certificates (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  state            text,                    -- OK, TX, FL, AL...
  cert_number      text,
  kind             text,                    -- resale | exempt_org | agriculture | government | other
  issued_on        date,
  expires_on       date,
  no_expiration    boolean not null default false,
  file_path        text,                    -- in the tax-certs bucket: <company id>/<file>
  file_name        text,
  status           text not null default 'pending',
  note             text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  uploaded_by_role public.user_role,
  verified_by_name text,
  verified_at      timestamptz,
  remind_60_at     timestamptz,
  remind_30_at     timestamptz,
  remind_expired_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
do $$ begin
  alter table public.tax_certificates add constraint tax_certificates_status_check check (status in ('pending', 'verified', 'rejected', 'replaced'));
exception when duplicate_object then null; end $$;
create index if not exists tax_certificates_company_idx on public.tax_certificates (company_id, created_at desc);

-- Who manages certificates: Accounting (the credit check box) and admins.
create or replace function public.tax_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm('credit_check')
$$;

alter table public.tax_certificates enable row level security;
drop policy if exists tax_certs_read   on public.tax_certificates;
drop policy if exists tax_certs_insert on public.tax_certificates;
drop policy if exists tax_certs_manage on public.tax_certificates;
drop policy if exists tax_certs_delete on public.tax_certificates;
create policy tax_certs_read on public.tax_certificates for select to authenticated
  using (public.is_employee() or company_id = public.my_company_id());
create policy tax_certs_insert on public.tax_certificates for insert to authenticated
  with check (public.tax_manager() or (company_id = public.my_company_id() and status = 'pending' and public.is_active()));
create policy tax_certs_manage on public.tax_certificates for update to authenticated
  using (public.tax_manager()) with check (public.tax_manager());
create policy tax_certs_delete on public.tax_certificates for delete to authenticated
  using (public.tax_manager());

-- A customer's exemption right now: taxable | ok | expiring (60 days or less) | expired | pending | missing.
create or replace function public.company_tax_state(p_company uuid)
returns table (state text, expires_on date, days_left int, cert_id uuid, pending int)
language plpgsql stable security definer set search_path = public as $$
declare
  exempt boolean;
  v public.tax_certificates;
  today date := (now() at time zone 'America/Chicago')::date;
  pend int;
  anyv boolean;
begin
  if p_company is null or not (public.is_employee() or p_company = public.my_company_id()) then
    return;
  end if;
  select c.tax_exempt into exempt from public.companies c where c.id = p_company;
  select count(*) into pend from public.tax_certificates t where t.company_id = p_company and t.status = 'pending';
  select * into v from public.tax_certificates t
   where t.company_id = p_company and t.status = 'verified'
   order by t.no_expiration desc, t.expires_on desc nulls last limit 1;
  anyv := v.id is not null;
  -- Not marked tax-exempt: sales tax is charged as usual, so nothing is held (a certificate they sent
  -- still shows as waiting for Accounting through "pending"; verifying it marks them tax-exempt).
  if not coalesce(exempt, false) then
    return query select 'taxable'::text, null::date, null::int, null::uuid, pend;
  elsif anyv and (v.no_expiration or v.expires_on is null or v.expires_on >= today) then
    return query select case when not v.no_expiration and v.expires_on is not null and v.expires_on - today <= 60 then 'expiring' else 'ok' end,
                        v.expires_on, case when v.no_expiration or v.expires_on is null then null else (v.expires_on - today) end, v.id, pend;
  elsif anyv then
    return query select (case when pend > 0 then 'pending' else 'expired' end)::text, v.expires_on, (v.expires_on - today), v.id, pend;
  elsif pend > 0 then
    return query select 'pending'::text, null::date, null::int, null::uuid, pend;
  else
    return query select 'missing'::text, null::date, null::int, null::uuid, 0;
  end if;
end $$;

-- Every customer that's tax-exempt or has a certificate, with its state (Accounting's list).
create or replace function public.tax_overview()
returns table (company_id uuid, company_name text, account_no text, email text, state text, expires_on date,
               days_left int, pending int, cert_state text, cert_number text, last_order_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.account_no, c.email, s.state, s.expires_on, s.days_left, s.pending,
         t.state, t.cert_number,
         (select max(o.created_at) from public.orders o where o.company_id = c.id and o.status <> 'cancelled')
    from public.companies c
    cross join lateral public.company_tax_state(c.id) s
    left join public.tax_certificates t on t.id = s.cert_id
   where public.is_employee()
     and (c.tax_exempt or exists (select 1 from public.tax_certificates x where x.company_id = c.id))
$$;

-- Accounting verifies (or turns down) a certificate. Verifying marks the customer tax-exempt and
-- retires their older certificates for the same state.
create or replace function public.tax_cert_decide(p_cert uuid, p_verify boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tax_certificates;
begin
  if not public.tax_manager() then raise exception 'Only Accounting and admins can verify certificates.'; end if;
  select * into t from public.tax_certificates where id = p_cert for update;
  if t.id is null then raise exception 'Certificate not found.'; end if;
  if p_verify then
    if not t.no_expiration and t.expires_on is null then raise exception 'Add the expiration date (or tick "No expiration") first.'; end if;
    update public.tax_certificates set status = 'verified', verified_by_name = public.my_name(), verified_at = now(),
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note), updated_at = now()
     where id = p_cert;
    update public.tax_certificates set status = 'replaced', updated_at = now()
     where company_id = t.company_id and id <> p_cert and status = 'verified'
       and coalesce(state, '') = coalesce(t.state, '');
    update public.companies set tax_exempt = true where id = t.company_id;
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why it was turned down.'; end if;
    update public.tax_certificates set status = 'rejected', note = left(trim(p_note), 1000),
           verified_by_name = public.my_name(), verified_at = now(), updated_at = now()
     where id = p_cert;
  end if;
end $$;

-- Accounting marks a customer tax-exempt (or not).
create or replace function public.company_set_tax_exempt(p_company uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tax_manager() then raise exception 'Only Accounting and admins can change this.'; end if;
  update public.companies set tax_exempt = coalesce(p_on, false) where id = p_company;
end $$;
revoke execute on function public.company_set_tax_exempt(uuid, boolean) from public, anon;
grant execute on function public.company_set_tax_exempt(uuid, boolean) to authenticated;

revoke execute on function public.tax_manager() from public, anon;
revoke execute on function public.company_tax_state(uuid) from public, anon;
revoke execute on function public.tax_overview() from public, anon;
revoke execute on function public.tax_cert_decide(uuid, boolean, text) from public, anon;
grant execute on function public.tax_manager() to authenticated;
grant execute on function public.company_tax_state(uuid) to authenticated;
grant execute on function public.tax_overview() to authenticated;
grant execute on function public.tax_cert_decide(uuid, boolean, text) to authenticated;

-- The credit check now stops at an expired (or missing, or unverified) certificate, unless Accounting
-- chooses to charge sales tax on this order.
drop function if exists public.order_credit_decision(uuid, boolean, text);
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null, p_charge_tax boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  ts text;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'The PO number has to be entered first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  if p_approve and o.company_id is not null then
    select s.state into ts from public.company_tax_state(o.company_id) s;
    if ts in ('expired', 'missing', 'pending') and not coalesce(p_charge_tax, false) then
      raise exception 'This customer''s tax-exempt certificate is %. Verify a current certificate first, or choose "Charge sales tax on this order".',
        case ts when 'expired' then 'expired' when 'missing' then 'not on file' else 'waiting to be verified' end;
    end if;
  end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         tax_note = case when p_approve and coalesce(p_charge_tax, false) then 'Charge sales tax on this order (tax-exempt certificate ' ||
                      case ts when 'expired' then 'expired' when 'missing' then 'not on file' when 'pending' then 'not verified yet' else 'issue' end || ')'
                    else tax_note end
   where id = p_order;
end $$;
revoke execute on function public.order_credit_decision(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.order_credit_decision(uuid, boolean, text, boolean) to authenticated;

-- Certificate files: Accounting and admins see all; a contractor only their company's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tax-certs', 'tax-certs', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tax_certs_files_read   on storage.objects;
drop policy if exists tax_certs_files_insert on storage.objects;
drop policy if exists tax_certs_files_delete on storage.objects;
create policy tax_certs_files_read on storage.objects for select to authenticated using (
  bucket_id = 'tax-certs' and (public.is_employee() or (storage.foldername(name))[1] = public.my_company_id()::text));
create policy tax_certs_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'tax-certs' and (public.tax_manager() or (storage.foldername(name))[1] = public.my_company_id()::text));
create policy tax_certs_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'tax-certs' and public.tax_manager());

select (select count(*) from public.order_drafts) as drafts,
       (select count(*) from public.tax_certificates) as tax_certificates,
       (select count(*) from public.complaint_reports) as complaint_reports;
