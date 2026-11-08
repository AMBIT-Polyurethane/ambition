-- =====================================================================
-- AMBIT Intelligence update 0050 - Expense reports, version 2
-- * Receipts live in the app (photo + AI read), each one can be tied to a customer.
-- * Chase card charges come in (statement upload now, "Connect Chase" automatically later) and every
--   charge is checked against the receipts. Each month goes to the expense approvers once every charge
--   has a receipt (or a reason), and an approver approves it or sends it back.
-- * An approvers-only expense dashboard.
-- * Admin > Expense reports picks the approvers. The first time: Jeremiah Bryant, Kim Hight, Kevin Lall.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Who approves expense reports ------------------------------
alter table public.profiles add column if not exists expense_approver boolean not null default false;

do $$ begin
  if not exists (select 1 from public.profiles where expense_approver) then
    update public.profiles set expense_approver = true
     where status = 'active' and role in ('admin', 'employee')
       and lower(email) in ('jeremiah.bryant@ambitpu.com', 'kim.hight@ambitpu.com', 'kevin.lall@ambitpu.com');
  end if;
end $$;

create or replace function public.is_expense_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and expense_approver and role in ('admin', 'employee'))
$$;
revoke all on function public.is_expense_approver() from public, anon;
grant execute on function public.is_expense_approver() to authenticated;

-- Admins: the whole list at once (everyone else comes off it).
create or replace function public.set_expense_approvers(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can change who approves expense reports.'; end if;
  update public.profiles set expense_approver = (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'))
   where expense_approver is distinct from (id = any(coalesce(p_ids, '{}')) and role in ('admin', 'employee'));
  select count(*) into n from public.profiles where expense_approver and status = 'active';
  if n = 0 then raise exception 'Pick at least one approver, or nobody can approve expense reports.'; end if;
  return n;
end $$;
revoke all on function public.set_expense_approvers(uuid[]) from public, anon;
grant execute on function public.set_expense_approvers(uuid[]) to authenticated;

-- ---------- Receipts ---------------------------------------------------
create table if not exists public.expense_receipts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  bought_on        date not null,
  vendor           text not null default '',
  amount           numeric(12,2) not null check (amount >= 0),     -- what was paid, tip included
  tip              numeric(12,2) check (tip is null or tip >= 0),
  category         text not null default 'Other',
  paid_with        text not null default 'card' check (paid_with in ('card', 'personal')),
  card_last4       text check (card_last4 is null or card_last4 ~ '^\d{4}$'),
  company_id       uuid references public.companies(id) on delete set null,   -- the customer it was for
  customer_name    text,                                                      -- typed, or that customer's name
  purpose          text,
  attendees        text,                                                      -- meals and entertainment
  notes            text,
  photos           text[] not null default '{}',   -- paths in the "receipts" bucket, or Jotform photo links
  no_photo_reason  text,                           -- lost receipt: why there's no photo
  ai               jsonb,                          -- what the AI read off the photo
  source           text not null default 'app' check (source in ('app', 'jotform')),
  jotform_id       text unique,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists expense_receipts_user_day on public.expense_receipts(user_id, bought_on);
create index if not exists expense_receipts_company on public.expense_receipts(company_id) where company_id is not null;

-- ---------- Company cards (last 4 -> employee) -------------------------
create table if not exists public.expense_cards (
  last4            text primary key check (last4 ~ '^\d{4}$'),
  user_id          uuid references public.profiles(id) on delete set null,
  label            text,
  plaid_account_id text unique,
  updated_at       timestamptz not null default now()
);

-- ---------- Statement uploads and syncs (the history list) ------------
create table if not exists public.expense_imports (
  id         uuid primary key default gen_random_uuid(),
  source     text not null check (source in ('upload', 'plaid')),
  file_name  text,
  rows       int not null default 0,
  added      int not null default 0,
  skipped    int not null default 0,
  date_from  date,
  date_to    date,
  by_id      uuid references public.profiles(id) on delete set null,
  by_name    text,
  at         timestamptz not null default now()
);

-- ---------- Card charges (from the Chase statement or the bank link) ---
create table if not exists public.expense_charges (
  id             uuid primary key default gen_random_uuid(),
  source         text not null check (source in ('upload', 'plaid')),
  external_id    text not null unique,      -- upload: a fingerprint of the line; plaid: 'plaid:<id>'
  plaid_id       text unique,               -- also set when an uploaded line is later seen through the bank link
  card_last4     text,
  user_id        uuid references public.profiles(id) on delete set null,
  txn_date       date not null,
  post_date      date,
  description    text not null default '',
  merchant       text,
  bank_category  text,
  kind           text not null default 'purchase' check (kind in ('purchase', 'return', 'fee', 'payment', 'other')),
  amount         numeric(12,2) not null,    -- positive = money spent, negative = a return or credit
  receipt_id     uuid unique references public.expense_receipts(id) on delete set null,
  match_how      text check (match_how in ('auto', 'manual')),
  excused_note   text,                      -- an approver said no receipt is needed
  excused_by     uuid references public.profiles(id) on delete set null,
  category       text,                      -- for excused charges (no receipt to say)
  removed        boolean not null default false,
  import_id      uuid references public.expense_imports(id) on delete set null,   -- which upload it came in
  imported_by    uuid references public.profiles(id) on delete set null,
  imported_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists expense_charges_user_day on public.expense_charges(user_id, txn_date);
create index if not exists expense_charges_open on public.expense_charges(txn_date) where receipt_id is null and not removed;
alter table public.expense_charges add column if not exists import_id uuid references public.expense_imports(id) on delete set null;

-- ---------- The bank link (server only: no one can read the tokens) --
create table if not exists public.expense_bank_links (
  id            uuid primary key default gen_random_uuid(),
  item_id       text not null unique,
  access_token  text not null,
  institution   text,
  cursor        text,
  status        text not null default 'ok',     -- ok | error | needs_login
  error         text,
  last_sync_at  timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------- Monthly reports: approval -----------------------------------
alter table public.expense_reports add column if not exists status           text not null default 'sent';
alter table public.expense_reports add column if not exists submitted_at     timestamptz;
alter table public.expense_reports add column if not exists auto_submitted   boolean not null default false;
alter table public.expense_reports add column if not exists charge_count     int not null default 0;
alter table public.expense_reports add column if not exists approved_by      uuid references public.profiles(id) on delete set null;
alter table public.expense_reports add column if not exists approved_by_name text;
alter table public.expense_reports add column if not exists approved_at      timestamptz;
alter table public.expense_reports add column if not exists returned_at      timestamptz;
alter table public.expense_reports add column if not exists review_note      text;
do $$ begin
  alter table public.expense_reports add constraint expense_reports_status_check check (status in ('sent', 'submitted', 'approved', 'returned'));
exception when duplicate_object then null; end $$;

-- ---------- Security rules ---------------------------------------------
alter table public.expense_receipts   enable row level security;
alter table public.expense_cards      enable row level security;
alter table public.expense_charges    enable row level security;
alter table public.expense_imports    enable row level security;
alter table public.expense_bank_links enable row level security;   -- no rules: only the server's own key

drop policy if exists expense_receipts_read   on public.expense_receipts;
drop policy if exists expense_receipts_insert on public.expense_receipts;
drop policy if exists expense_receipts_update on public.expense_receipts;
create policy expense_receipts_read on public.expense_receipts for select to authenticated
  using (user_id = auth.uid() or public.is_expense_approver());
create policy expense_receipts_insert on public.expense_receipts for insert to authenticated
  with check ((user_id = auth.uid() and public.is_employee()) or public.is_expense_approver());
create policy expense_receipts_update on public.expense_receipts for update to authenticated
  using ((user_id = auth.uid() and public.is_employee()) or public.is_expense_approver())
  with check ((user_id = auth.uid() and public.is_employee()) or public.is_expense_approver());

drop policy if exists expense_cards_read  on public.expense_cards;
drop policy if exists expense_cards_write on public.expense_cards;
create policy expense_cards_read on public.expense_cards for select to authenticated
  using (user_id = auth.uid() or public.is_expense_approver());
create policy expense_cards_write on public.expense_cards for all to authenticated
  using (public.is_expense_approver()) with check (public.is_expense_approver());

drop policy if exists expense_charges_read  on public.expense_charges;
drop policy if exists expense_charges_write on public.expense_charges;
create policy expense_charges_read on public.expense_charges for select to authenticated
  using (user_id = auth.uid() or public.is_expense_approver());
create policy expense_charges_write on public.expense_charges for all to authenticated
  using (public.is_expense_approver()) with check (public.is_expense_approver());

drop policy if exists expense_imports_read  on public.expense_imports;
drop policy if exists expense_imports_write on public.expense_imports;
create policy expense_imports_read on public.expense_imports for select to authenticated using (public.is_expense_approver());
create policy expense_imports_write on public.expense_imports for all to authenticated using (public.is_expense_approver()) with check (public.is_expense_approver());

-- Reports: the employee reads their own; approvers (and admins) read all. Only approvers write directly;
-- employees send theirs with expense_submit().
drop policy if exists expense_reports_read   on public.expense_reports;
drop policy if exists expense_reports_write  on public.expense_reports;
drop policy if exists expense_reports_update on public.expense_reports;
create policy expense_reports_read on public.expense_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_expense_approver());
create policy expense_reports_write on public.expense_reports for insert to authenticated
  with check (public.is_expense_approver());
create policy expense_reports_update on public.expense_reports for update to authenticated
  using (public.is_expense_approver()) with check (public.is_expense_approver());

-- ---------- Receipt photos (private) -----------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_read   on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_delete on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_expense_approver()));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text and public.is_employee());
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Locked months ------------------------------------------------
-- Once a month is sent for approval (or approved), the employee can't change its receipts or matches
-- until an approver sends it back. Approvers can still fix things (a customer, a category).
create or replace function public.expense_month_status(p_user uuid, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select status from public.expense_reports where user_id = p_user and month = date_trunc('month', p_day)::date
$$;
revoke all on function public.expense_month_status(uuid, date) from public, anon;

create or replace function public.expense_check_month(p_user uuid, p_day date) returns void
language plpgsql stable security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null or public.is_expense_approver() then return; end if;
  st := public.expense_month_status(p_user, p_day);
  if st = 'approved' then
    raise exception '% is already approved, so it can''t be changed.', to_char(p_day, 'FMMonth YYYY');
  elsif st = 'submitted' then
    raise exception '% was already sent for approval, so it''s locked. Ask an approver to send it back if something needs fixing.', to_char(p_day, 'FMMonth YYYY');
  end if;
end $$;
revoke all on function public.expense_check_month(uuid, date) from public, anon;

create or replace function public.expense_receipts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_expense_approver() and new.user_id <> old.user_id then
      raise exception 'A receipt can''t be moved to someone else.';
    end if;
    perform public.expense_check_month(old.user_id, old.bought_on);
  end if;
  perform public.expense_check_month(new.user_id, new.bought_on);
  if cardinality(new.photos) = 0 and nullif(trim(coalesce(new.no_photo_reason, '')), '') is null and new.deleted_at is null then
    raise exception 'Add a photo of the receipt, or say why there isn''t one.';
  end if;
  -- A deleted receipt lets go of its card charge (which then needs a receipt again).
  if tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
    update public.expense_charges set receipt_id = null, match_how = null, updated_at = now() where receipt_id = new.id;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists expense_receipts_guard on public.expense_receipts;
create trigger expense_receipts_guard before insert or update on public.expense_receipts
  for each row execute function public.expense_receipts_guard();

-- ---------- Matching card charges to receipts --------------------------
-- 1. Same person, same amount, bought within 4 days of the charge.
-- 2. Same person, meals and entertainment: the charge can be up to 35% more than the receipt (the tip).
-- 3. A charge on a card nobody is assigned to: one receipt from anyone with the exact amount within 3 days
--    (and only when exactly one receipt fits); the charge then belongs to that person.
-- p_user null = everyone. Returns how many charges were matched.
create or replace function public.expense_auto_match(p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  rid uuid;
  n int := 0;
  pass int;
begin
  if auth.uid() is not null and not public.is_expense_approver() and p_user is distinct from auth.uid() then
    raise exception 'You can only match your own receipts.';
  end if;
  for pass in 1..2 loop
    for c in
      select ch.* from public.expense_charges ch
       where ch.receipt_id is null and not ch.removed and ch.kind = 'purchase' and ch.excused_note is null
         and ch.user_id is not null and (p_user is null or ch.user_id = p_user)
         and public.expense_month_status(ch.user_id, ch.txn_date) is distinct from 'approved'
       order by ch.txn_date, ch.amount desc
    loop
      select r.id into rid from public.expense_receipts r
       where r.user_id = c.user_id and r.deleted_at is null and r.paid_with = 'card'
         and (r.card_last4 is null or c.card_last4 is null or r.card_last4 = c.card_last4)
         and abs(r.bought_on - c.txn_date) <= 4
         and not exists (select 1 from public.expense_charges x where x.receipt_id = r.id)
         and case when pass = 1 then abs(r.amount - c.amount) < 0.005
                  else r.category in ('Meals', 'Customer entertainment') and c.amount > r.amount and c.amount <= round(r.amount * 1.35, 2) end
       order by abs(r.bought_on - c.txn_date), abs(r.amount - c.amount), r.created_at
       limit 1;
      if rid is not null then
        update public.expense_charges set receipt_id = rid, match_how = 'auto', updated_at = now() where id = c.id;
        n := n + 1;
      end if;
    end loop;
  end loop;

  if p_user is null then
    for c in
      select ch.* from public.expense_charges ch
       where ch.receipt_id is null and not ch.removed and ch.kind = 'purchase' and ch.excused_note is null and ch.user_id is null
       order by ch.txn_date
    loop
      if (select count(*) from public.expense_receipts r
           where r.deleted_at is null and r.paid_with = 'card' and abs(r.amount - c.amount) < 0.005 and abs(r.bought_on - c.txn_date) <= 3
             and (r.card_last4 is null or c.card_last4 is null or r.card_last4 = c.card_last4)
             and not exists (select 1 from public.expense_charges x where x.receipt_id = r.id)) = 1 then
        select r.id into rid from public.expense_receipts r
         where r.deleted_at is null and r.paid_with = 'card' and abs(r.amount - c.amount) < 0.005 and abs(r.bought_on - c.txn_date) <= 3
           and (r.card_last4 is null or c.card_last4 is null or r.card_last4 = c.card_last4)
           and not exists (select 1 from public.expense_charges x where x.receipt_id = r.id);
        update public.expense_charges ch set receipt_id = rid, match_how = 'auto', updated_at = now(),
               user_id = (select user_id from public.expense_receipts where id = rid)
         where ch.id = c.id;
        n := n + 1;
      end if;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.expense_auto_match(uuid) from public, anon;
grant execute on function public.expense_auto_match(uuid) to authenticated, service_role;

-- Link a charge to a receipt by hand (p_receipt null = unlink). The receipt becomes "paid with the card".
create or replace function public.expense_link(p_charge uuid, p_receipt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.expense_charges;
  r public.expense_receipts;
  appr boolean := public.is_expense_approver();
begin
  select * into c from public.expense_charges where id = p_charge;
  if c.id is null or (not appr and c.user_id is distinct from auth.uid()) then raise exception 'That card charge wasn''t found.'; end if;
  if c.user_id is not null then perform public.expense_check_month(c.user_id, c.txn_date); end if;
  if p_receipt is null then
    update public.expense_charges set receipt_id = null, match_how = null, updated_at = now() where id = p_charge;
    return;
  end if;
  select * into r from public.expense_receipts where id = p_receipt and deleted_at is null;
  if r.id is null or (not appr and r.user_id <> auth.uid()) then raise exception 'That receipt wasn''t found.'; end if;
  if c.user_id is not null and c.user_id <> r.user_id then raise exception 'That receipt belongs to someone else.'; end if;
  perform public.expense_check_month(r.user_id, r.bought_on);
  update public.expense_charges set receipt_id = null, match_how = null, updated_at = now() where receipt_id = p_receipt and id <> p_charge;
  update public.expense_charges set receipt_id = p_receipt, match_how = 'manual', user_id = r.user_id, updated_at = now() where id = p_charge;
  if r.paid_with <> 'card' then update public.expense_receipts set paid_with = 'card' where id = p_receipt; end if;
end $$;
revoke all on function public.expense_link(uuid, uuid) from public, anon;
grant execute on function public.expense_link(uuid, uuid) to authenticated;

-- Approvers: "no receipt needed" for a charge (a subscription, a bank fee), with a category. p_note null = undo.
create or replace function public.expense_excuse(p_charge uuid, p_note text, p_category text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can do that.'; end if;
  update public.expense_charges
     set excused_note = nullif(trim(coalesce(p_note, '')), ''),
         excused_by = case when nullif(trim(coalesce(p_note, '')), '') is null then null else auth.uid() end,
         category = case when nullif(trim(coalesce(p_note, '')), '') is null then null else coalesce(nullif(p_category, ''), 'Other') end,
         updated_at = now()
   where id = p_charge and receipt_id is null;
  if not found then raise exception 'That charge wasn''t found, or it already has a receipt.'; end if;
end $$;
revoke all on function public.expense_excuse(uuid, text, text) from public, anon;
grant execute on function public.expense_excuse(uuid, text, text) to authenticated;

-- Approvers: whose card is which. Charges on that card that aren't matched yet move to that person.
create or replace function public.expense_set_card(p_last4 text, p_user uuid, p_label text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can do that.'; end if;
  if p_last4 !~ '^\d{4}$' then raise exception 'A card is the last 4 digits, like 1234.'; end if;
  insert into public.expense_cards (last4, user_id, label, updated_at) values (p_last4, p_user, nullif(trim(coalesce(p_label, '')), ''), now())
  on conflict (last4) do update set user_id = excluded.user_id, label = coalesce(excluded.label, public.expense_cards.label), updated_at = now();
  update public.expense_charges set user_id = p_user, updated_at = now()
   where card_last4 = p_last4 and receipt_id is null and user_id is distinct from p_user
     and (user_id is null or public.expense_month_status(user_id, txn_date) is distinct from 'approved');
  get diagnostics n = row_count;
  perform public.expense_auto_match(p_user);
  return n;
end $$;
revoke all on function public.expense_set_card(text, uuid, text) from public, anon;
grant execute on function public.expense_set_card(text, uuid, text) to authenticated;

-- Approvers: give one charge to a person (a card shared by two people, or a card nobody has yet).
create or replace function public.expense_assign_charge(p_charge uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can do that.'; end if;
  update public.expense_charges set user_id = p_user, updated_at = now() where id = p_charge and receipt_id is null;
  if not found then raise exception 'That charge wasn''t found, or it already has a receipt.'; end if;
  if p_user is not null then perform public.expense_auto_match(p_user); end if;
end $$;
revoke all on function public.expense_assign_charge(uuid, uuid) from public, anon;
grant execute on function public.expense_assign_charge(uuid, uuid) to authenticated;

-- ---------- Sending a month for approval -------------------------------
-- What's still missing for one person's month: card purchases with no receipt and no "no receipt needed".
create or replace function public.expense_missing(p_user uuid, p_month date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.expense_charges
   where user_id = p_user and txn_date >= date_trunc('month', p_month)::date
     and txn_date < (date_trunc('month', p_month) + interval '1 month')::date
     and kind = 'purchase' and not removed and receipt_id is null and excused_note is null
$$;
revoke all on function public.expense_missing(uuid, date) from public, anon;

-- The work itself (the employee's button and the daily job both use it). Returns the totals and who to tell.
create or replace function public.expense_submit_for(p_user uuid, p_month date, p_auto boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
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
   where c.user_id = p_user and not c.removed and c.kind in ('purchase', 'return', 'fee') and c.txn_date >= m and c.txn_date < e;
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
end $$;
revoke all on function public.expense_submit_for(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.expense_submit_for(uuid, date, boolean) to service_role;

-- The employee's "Send for approval" button.
create or replace function public.expense_submit(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_employee() and public.is_active()) then raise exception 'Sign in with your AMBIT login first.'; end if;
  return public.expense_submit_for(auth.uid(), p_month, false);
end $$;
revoke all on function public.expense_submit(date) from public, anon;
grant execute on function public.expense_submit(date) to authenticated;

-- Approvers: approve a month, or send it back with a note. Nobody approves their own report.
create or replace function public.expense_review(p_user uuid, p_month date, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  rep public.expense_reports;
  me public.profiles;
  who public.profiles;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_expense_approver() then raise exception 'Only an expense approver can approve reports.'; end if;
  if p_user = auth.uid() then raise exception 'Another approver has to approve your own report.'; end if;
  select * into rep from public.expense_reports where user_id = p_user and month = m;
  if rep.id is null then raise exception 'That report hasn''t been sent yet.'; end if;
  if p_approve and rep.status = 'approved' then raise exception 'It''s already approved.'; end if;
  if not p_approve and note is null then raise exception 'Say what needs fixing, so they know what to change.'; end if;
  if p_approve and public.expense_missing(p_user, m) > 0 then
    raise exception 'Some card charges in that month still have no receipt. Send it back, or mark them "No receipt needed".';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select * into who from public.profiles where id = p_user;
  if p_approve then
    update public.expense_reports
       set status = 'approved', approved_by = me.id, approved_by_name = coalesce(nullif(me.full_name, ''), me.email), approved_at = now(),
           review_note = note, returned_at = null
     where id = rep.id;
  else
    update public.expense_reports
       set status = 'returned', returned_at = now(), review_note = note, approved_by = null, approved_by_name = null, approved_at = null
     where id = rep.id;
  end if;
  return jsonb_build_object('id', rep.id, 'month', to_char(m, 'YYYY-MM'), 'status', case when p_approve then 'approved' else 'returned' end,
    'name', coalesce(nullif(who.full_name, ''), who.email), 'email', who.email,
    'by', coalesce(nullif(me.full_name, ''), me.email), 'total', rep.total, 'personal', rep.personal_total);
end $$;
revoke all on function public.expense_review(uuid, date, boolean, text) from public, anon;
grant execute on function public.expense_review(uuid, date, boolean, text) to authenticated;

-- What the bank link looks like (no tokens).
create or replace function public.expense_bank_status()
returns table (id uuid, institution text, status text, error text, last_sync_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.institution, l.status, l.error, l.last_sync_at, l.created_at
    from public.expense_bank_links l where public.is_expense_approver() order by l.created_at
$$;
revoke all on function public.expense_bank_status() from public, anon;
grant execute on function public.expense_bank_status() to authenticated;

-- ---------- The expense dashboard (approvers only) ---------------------
-- Every dollar counts once: a receipt matched to a card charge counts at what the bank charged; a receipt
-- the bank hasn't shown counts at the receipt's amount; a card charge with no receipt counts as "No receipt".
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
      select r.user_id, null::text as card, r.bought_on as day, coalesce(c.amount, r.amount) as amount, r.category, r.company_id,
             case when r.company_id is not null then r.company_id::text
                  when nullif(trim(r.customer_name), '') is not null then 'n:' || lower(regexp_replace(trim(r.customer_name), '\s+', ' ', 'g')) end as cust_key,
             coalesce(co.name, nullif(trim(r.customer_name), '')) as customer, nullif(trim(r.vendor), '') as vendor, r.id as receipt_id,
             c.id as charge_id, c.id is not null as on_card, r.paid_with = 'personal' and c.id is null as personal, false as missing, false as overdue,
             nullif(trim(coalesce(r.attendees, '')), '') is not null as has_people
        from public.expense_receipts r
        left join public.expense_charges c on c.receipt_id = r.id and not c.removed
        left join public.companies co on co.id = r.company_id
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
    select coalesce(sum(amount), 0) as spend, count(receipt_id) as receipts, count(*) filter (where missing) as missing_n,
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

select 'expense approvers: ' || coalesce(string_agg(full_name, ', ' order by full_name), 'nobody yet') as status
  from public.profiles where expense_approver and status = 'active';
