-- =====================================================================
-- 0082: the app reads every signed BOL photo with AI and checks it against the order.
--   Right order? (the ORD number / customer on the paper), is it paperwork at all, is it signed, and do the lot
--   numbers on it match the lots the app recorded. The same photo attached to two orders is caught too.
-- What the AI read is saved here; the problems are worked out when a page loads, so a lot fixed with
-- "Fix what went out" drops off right away. Admins can mark one "Looks right" when the AI got it wrong.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.order_bol_checks (
  order_id     uuid primary key references public.orders(id) on delete cascade,
  file_ids     bigint[] not null default '{}',   -- the order's BOL files that were read
  file_hashes  text[]   not null default '{}',   -- sha256 of each file (the same photo on two orders)
  seen         jsonb,                            -- what the AI read off them
  status       text not null default 'read',     -- read | app_signed | error
  error        text,
  model        text,
  cost_cents   numeric(10,3) not null default 0,
  checked_at   timestamptz not null default now(),
  ok_by        uuid references public.profiles(id) on delete set null,
  ok_by_name   text,
  ok_at        timestamptz,
  ok_note      text
);
alter table public.order_bol_checks enable row level security;
drop policy if exists order_bol_checks_read on public.order_bol_checks;
create policy order_bol_checks_read on public.order_bol_checks for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.order_bol_checks from anon, authenticated;
grant select on public.order_bol_checks to authenticated;

-- Save what the AI read (AMBIT staff: it runs when the warehouse attaches the BOL, and from BOL review).
-- A new set of files clears an earlier "Looks right".
create or replace function public.order_bol_check_save(p_order uuid, p_file_ids bigint[], p_hashes text[], p_seen jsonb,
  p_status text, p_error text, p_model text, p_cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_employee() then raise exception 'Only AMBIT staff can do that.'; end if;
  if exists (select 1 from unnest(coalesce(p_file_ids, '{}')) f(id)
              where not exists (select 1 from public.order_files x where x.id = f.id and x.order_id = p_order and x.kind = 'bol')) then
    raise exception 'Those files aren''t this order''s BOL.';
  end if;
  insert into public.order_bol_checks as c (order_id, file_ids, file_hashes, seen, status, error, model, cost_cents, checked_at)
  values (p_order, coalesce(p_file_ids, '{}'), coalesce(p_hashes, '{}'), p_seen, coalesce(p_status, 'read'), p_error, p_model, coalesce(p_cost, 0), now())
  on conflict (order_id) do update set
    file_ids = excluded.file_ids, file_hashes = excluded.file_hashes, seen = excluded.seen, status = excluded.status,
    error = excluded.error, model = excluded.model, cost_cents = c.cost_cents + excluded.cost_cents, checked_at = now(),
    ok_by      = case when c.file_ids = excluded.file_ids then c.ok_by end,
    ok_by_name = case when c.file_ids = excluded.file_ids then c.ok_by_name end,
    ok_at      = case when c.file_ids = excluded.file_ids then c.ok_at end,
    ok_note    = case when c.file_ids = excluded.file_ids then c.ok_note end;
end $$;
revoke all on function public.order_bol_check_save(uuid, bigint[], text[], jsonb, text, text, text, numeric) from public, anon;
grant execute on function public.order_bol_check_save(uuid, bigint[], text[], jsonb, text, text, text, numeric) to authenticated;

-- Admins: "Looks right" (the AI misread it) or undo that.
create or replace function public.order_bol_check_ok(p_order uuid, p_ok boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if not public.is_admin() then raise exception 'Only admins can do that.'; end if;
  select coalesce(full_name, email) into me from public.profiles where id = auth.uid();
  update public.order_bol_checks
     set ok_by = case when p_ok then auth.uid() end, ok_by_name = case when p_ok then me end,
         ok_at = case when p_ok then now() end, ok_note = case when p_ok then nullif(trim(coalesce(p_note, '')), '') end
   where order_id = p_order;
end $$;
revoke all on function public.order_bol_check_ok(uuid, boolean, text) from public, anon;
grant execute on function public.order_bol_check_ok(uuid, boolean, text) to authenticated;

select 'Ready (should be 3)' as "Check",
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'order_bol_checks')
  + (select count(*) from pg_proc where proname in ('order_bol_check_save', 'order_bol_check_ok') and pronamespace = 'public'::regnamespace) as "Count";
