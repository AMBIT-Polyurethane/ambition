-- =====================================================================
-- AMBITION - Monthly expense reports
-- Receipts themselves live in Jotform (the "AMBIT Expense Receipt" form).
-- This remembers when each employee sent a month's report to Corporate,
-- and what was on it, so the app can show "Sent" and admins can see who
-- has and hasn't sent theirs.
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.expense_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  month          date not null,                       -- the 1st of the month
  receipt_ids    text[] not null default '{}',        -- Jotform submission ids on the report
  receipt_count  int not null default 0,
  total          numeric(12,2) not null default 0,
  card_total     numeric(12,2) not null default 0,
  personal_total numeric(12,2) not null default 0,   -- paid personally: owed back to the employee
  sent_at        timestamptz not null default now(),
  sent_to        text[] not null default '{}',
  email_status   text,                                -- sent | failed | not_configured
  unique (user_id, month)
);

alter table public.expense_reports enable row level security;
drop policy if exists expense_reports_read on public.expense_reports;
create policy expense_reports_read on public.expense_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists expense_reports_write on public.expense_reports;
create policy expense_reports_write on public.expense_reports for insert to authenticated
  with check (user_id = auth.uid() and public.is_employee() and public.is_active());
drop policy if exists expense_reports_update on public.expense_reports;
create policy expense_reports_update on public.expense_reports for update to authenticated
  using (user_id = auth.uid() and public.is_employee()) with check (user_id = auth.uid());

select count(*) as expense_reports from public.expense_reports;
