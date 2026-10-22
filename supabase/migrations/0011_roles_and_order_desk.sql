-- =====================================================================
-- AMBITION - Staff roles, the order desk, and price request approvals
-- * Each AMBIT staff account gets a job role (Admin, CRM, Sales rep, Tech,
--   Warehouse manager, Accounting) and checkboxes for what it can see and do.
--   Staff who were already active keep everything until an admin sets a role.
-- * Orders move through: customer approval -> AMBIT PO # (CRM) -> credit check
--   (Accounting) -> scheduled for delivery/pickup (CRM, customer is emailed)
--   -> completed.
-- * Price request approvals made in the app are recorded here (the prices
--   themselves are saved into the Jotform submission).
-- Safe to run more than once.
-- =====================================================================

-- ---------- Roles and permissions ------------------------------------
alter table public.profiles add column if not exists job_role text;
alter table public.profiles add column if not exists perms    text[] not null default '{}';

do $$ begin
  alter table public.profiles add constraint profiles_job_role_check
    check (job_role is null or job_role in ('admin', 'crm', 'sales_rep', 'tech', 'warehouse', 'accounting'));
exception when duplicate_object then null; end $$;

-- Everything a checkbox can turn on. Keep in step with lib/access.ts.
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check']
$$;

-- Staff who were active before roles existed keep seeing everything (except admin-only price approvals)
-- until an admin picks their role.
update public.profiles
   set perms = array['ordering', 'price_requests', 'time_off', 'travel', 'spray_log', 'complaints',
                     'inventory', 'order_desk', 'credit_check']
 where role = 'employee' and job_role is null and perms = '{}' and status = 'active';
update public.profiles set job_role = 'admin' where role = 'admin' and job_role is null;

-- Admins can do everything. Employees can do what their boxes allow. Contractors: nothing here.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select status = 'active' and (role = 'admin' or (role = 'employee' and p = any(perms)))
      from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.admin_set_access(p_user uuid, p_job_role text, p_perms text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  bad text[];
begin
  if not public.is_admin() then raise exception 'Only admins can change what people see.'; end if;
  if p_job_role is not null and p_job_role not in ('admin', 'crm', 'sales_rep', 'tech', 'warehouse', 'accounting') then
    raise exception 'Unknown role %.', p_job_role;
  end if;
  select array_agg(x) into bad from unnest(coalesce(p_perms, '{}')) x where not x = any(public.all_perms());
  if bad is not null then raise exception 'Unknown permission %.', array_to_string(bad, ', '); end if;
  update public.profiles
     set job_role = p_job_role,
         perms    = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(coalesce(p_perms, '{}')) x)
   where id = p_user;
end $$;

-- Home-screen form links can be limited to a permission (Time off request -> time_off, ...).
alter table public.links add column if not exists perm text;
update public.links set perm = 'price_requests' where perm is null and lower(title) like 'price request%';
update public.links set perm = 'travel'         where perm is null and lower(title) like 'travel%';
update public.links set perm = 'time_off'       where perm is null and lower(title) like 'time off%';
update public.links set perm = 'complaints'     where perm is null and lower(title) like '%complaint%';
update public.links set perm = 'spray_log'      where perm is null and lower(title) like 'spray job%';

-- ---------- Order desk ------------------------------------------------
alter table public.orders add column if not exists ambit_po          text;
alter table public.orders add column if not exists po_by_name        text;
alter table public.orders add column if not exists po_at             timestamptz;
alter table public.orders add column if not exists credit_status     text;          -- pending | approved | hold
alter table public.orders add column if not exists credit_by_name    text;
alter table public.orders add column if not exists credit_at         timestamptz;
alter table public.orders add column if not exists credit_note       text;
alter table public.orders add column if not exists scheduled_for     date;
alter table public.orders add column if not exists schedule_note     text;
alter table public.orders add column if not exists scheduled_by_name text;
alter table public.orders add column if not exists scheduled_at      timestamptz;
alter table public.orders add column if not exists notify_status     text;          -- the customer's "scheduled" email
alter table public.orders add column if not exists notify_error      text;
alter table public.orders add column if not exists completed_at      timestamptz;

do $$ begin
  alter table public.orders add constraint orders_credit_status_check
    check (credit_status is null or credit_status in ('pending', 'approved', 'hold'));
exception when duplicate_object then null; end $$;

-- Where each order sits right now. Worked out by the database, never typed.
do $$ begin
  alter table public.orders add column stage text generated always as (
    case
      when status = 'cancelled' then 'cancelled'
      when status = 'completed' then 'completed'
      when approval_status in ('pending', 'changes_requested') then 'customer'
      when ambit_po is null then 'needs_po'
      when credit_status = 'hold' then 'hold'
      when credit_status is distinct from 'approved' then 'credit'
      when scheduled_for is null then 'schedule'
      else 'scheduled'
    end) stored;
exception when duplicate_column then null; end $$;
create index if not exists orders_stage_idx on public.orders(stage);

create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(full_name, email) from public.profiles where id = auth.uid()
$$;

-- CRM: enter (or correct) AMBIT's PO number. Sends the order to the credit check.
create or replace function public.order_set_po(p_order uuid, p_po text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.approval_status in ('pending', 'changes_requested') then raise exception 'The customer hasn''t approved this order yet.'; end if;
  if coalesce(trim(p_po), '') = '' then raise exception 'Enter the PO number.'; end if;
  update public.orders
     set ambit_po = left(trim(p_po), 60), po_by_name = public.my_name(), po_at = now(),
         credit_status = coalesce(credit_status, 'pending'),
         status = case when status = 'new' then 'processing'::public.order_status else status end
   where id = p_order;
end $$;

-- Accounting: release (no credit hold) or put on hold.
create or replace function public.order_credit_decision(p_order uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('credit_check') then raise exception 'You don''t have access to credit checks.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.ambit_po is null then raise exception 'The PO number has to be entered first.'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is on hold.'; end if;
  update public.orders
     set credit_status = case when p_approve then 'approved' else 'hold' end,
         credit_by_name = public.my_name(), credit_at = now(),
         credit_note = nullif(left(trim(coalesce(p_note, '')), 1000), '')
   where id = p_order;
end $$;

-- CRM: set (or change) the delivery or pickup date. The app then emails the customer.
create or replace function public.order_schedule(p_order uuid, p_date date, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.has_perm('order_desk') then raise exception 'You don''t have access to the order desk.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is %.', o.status; end if;
  if o.credit_status is distinct from 'approved' then raise exception 'Accounting has to release the order first.'; end if;
  if p_date is null then raise exception 'Pick the delivery or pickup date.'; end if;
  update public.orders
     set scheduled_for = p_date, schedule_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         scheduled_by_name = public.my_name(), scheduled_at = now(),
         notify_status = null, notify_error = null
   where id = p_order;
end $$;

create or replace function public.order_mark_notified(p_order uuid, p_status text, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.orders set notify_status = p_status, notify_error = left(p_error, 500)
   where id = p_order and public.has_perm('order_desk');
$$;

-- CRM or warehouse: delivered / picked up.
create or replace function public.order_complete(p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not (public.has_perm('order_desk') or public.has_perm('inventory')) then
    raise exception 'You don''t have access to close orders.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.scheduled_for is null then raise exception 'Schedule the order first.'; end if;
  if o.status in ('cancelled', 'completed') then raise exception 'This order is already %.', o.status; end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order;
end $$;

-- Staff without ordering access can't place orders (contractors always can, for their own company).
create or replace function public.can_order() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' and (role = 'customer' or role = 'admin' or 'ordering' = any(perms))
                     from public.profiles where id = auth.uid()), false)
$$;

-- Belt and braces: the database itself refuses orders from staff without ordering access.
-- (SQL Editor and other server-side inserts, with no signed-in user, are not affected.)
create or replace function public.check_can_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_order() then
    raise exception 'Your account can''t place orders. Ask an admin to turn on Ordering for you.';
  end if;
  return new;
end $$;
drop trigger if exists orders_can_order on public.orders;
create trigger orders_can_order before insert on public.orders
  for each row execute function public.check_can_order();

-- ---------- Price request approvals -----------------------------------
create table if not exists public.prf_reviews (
  submission_id    text primary key,           -- Jotform submission id
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  approved_at      timestamptz not null default now(),
  prices           jsonb not null default '{}'::jsonb,   -- { "AMBI-SEAL 5.0": "2.35", ... }
  note             text,
  email_status     text,
  email_error      text
);
alter table public.prf_reviews enable row level security;
drop policy if exists prf_reviews_read on public.prf_reviews;
drop policy if exists prf_reviews_write on public.prf_reviews;
create policy prf_reviews_read on public.prf_reviews for select to authenticated using (public.is_employee());
create policy prf_reviews_write on public.prf_reviews for all to authenticated
  using (public.has_perm('prf_approve')) with check (public.has_perm('prf_approve'));
revoke all on public.prf_reviews from anon;

-- ---------- Who may call what ----------------------------------------
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.admin_set_access(uuid, text, text[]) from public, anon;
revoke execute on function public.order_set_po(uuid, text) from public, anon;
revoke execute on function public.order_credit_decision(uuid, boolean, text) from public, anon;
revoke execute on function public.order_schedule(uuid, date, text) from public, anon;
revoke execute on function public.order_mark_notified(uuid, text, text) from public, anon;
revoke execute on function public.order_complete(uuid) from public, anon;
revoke execute on function public.can_order() from public, anon;
revoke execute on function public.my_name() from public, anon;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.admin_set_access(uuid, text, text[]) to authenticated;
grant execute on function public.order_set_po(uuid, text) to authenticated;
grant execute on function public.order_credit_decision(uuid, boolean, text) to authenticated;
grant execute on function public.order_schedule(uuid, date, text) to authenticated;
grant execute on function public.order_mark_notified(uuid, text, text) to authenticated;
grant execute on function public.order_complete(uuid) to authenticated;
grant execute on function public.can_order() to authenticated;
grant execute on function public.my_name() to authenticated;
