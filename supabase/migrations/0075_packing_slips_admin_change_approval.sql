-- =====================================================================
-- AMBIT Intelligence update 0075 - Admins approve every change to an order; packing slips
-- * Whenever someone adds, removes or changes an item on an order (Edit order, or Correct this order after pickup),
--   every admin is emailed. An admin has to approve the change, ticking that the QuickBooks invoice has it. Until
--   then the packing slip can't be printed and the order can't be marked picked up or shipped out (in the app or
--   from PENDING ORDERS).
-- * Changes made before this update count as approved.
-- Run once in Supabase > SQL Editor, AFTER 0074. Safe to run again.
-- =====================================================================

-- ---------- Each order change waits for an admin ----------
-- Rows already there get false (nothing to approve); every change from now on gets true.
alter table public.order_edits add column if not exists admin_needed boolean not null default false;
alter table public.order_edits alter column admin_needed set default true;
alter table public.order_edits add column if not exists admin_approved_at      timestamptz;
alter table public.order_edits add column if not exists admin_approved_by      uuid;
alter table public.order_edits add column if not exists admin_approved_by_name text;
alter table public.order_edits add column if not exists admin_note             text;
alter table public.order_edits add column if not exists admin_emailed_at       timestamptz;
alter table public.order_edits add column if not exists admin_email_status     text;
create index if not exists order_edits_admin_pending on public.order_edits(order_id) where admin_needed and admin_approved_at is null;

-- Is any change to this order still waiting for an admin?
create or replace function public.order_change_pending(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_edits e where e.order_id = p_order and e.admin_needed and e.admin_approved_at is null)
$$;

-- An admin approves every change still waiting on an order, confirming the QuickBooks invoice has them.
create or replace function public.order_change_approve(p_order uuid, p_invoice_ok boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can approve changes to an order.'; end if;
  if not coalesce(p_invoice_ok, false) then
    raise exception 'Tick the box to confirm the QuickBooks invoice has every change, then approve.';
  end if;
  update public.order_edits
     set admin_approved_at = now(), admin_approved_by = auth.uid(), admin_approved_by_name = coalesce(public.my_name(), 'Admin'),
         admin_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
   where order_id = p_order and admin_needed and admin_approved_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There''s nothing waiting for approval on this order.'; end if;
  return n;
end $$;

-- The app records whether the admin email went out (shown on the order).
create or replace function public.order_change_emailed(p_order uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_employee() then raise exception 'AMBIT staff only.'; end if;
  update public.order_edits set admin_emailed_at = now(), admin_email_status = left(coalesce(p_status, ''), 40)
   where order_id = p_order and admin_needed and admin_approved_at is null;
end $$;

-- ---------- No pickup or shipment while a change waits for an admin ----------
create or replace function public.orders_change_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and public.order_change_pending(new.id) then
    raise exception 'ORD-% was changed and an admin hasn''t approved the change yet. Don''t load it: ask an admin to approve the change on the order first.', new.order_no;
  end if;
  return new;
end $$;
drop trigger if exists orders_change_gate on public.orders;
create trigger orders_change_gate before update of status on public.orders
  for each row execute function public.orders_change_gate();

do $$
declare f text;
begin
  foreach f in array array['order_change_approve(uuid, boolean, text)', 'order_change_emailed(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.orders_change_gate() from public, anon, authenticated;
revoke all on function public.order_change_pending(uuid) from public, anon, authenticated;

-- Check: should say 4
select count(*) as "Ready (should be 4)" from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('order_change_pending', 'order_change_approve', 'order_change_emailed', 'orders_change_gate');
