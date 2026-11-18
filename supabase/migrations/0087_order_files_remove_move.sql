-- 0087: take a wrong file off an order, or move it to the order it belongs to.
-- (A photo of one order's signed packing slip attached to another order: Kim, Nov 18.)
-- Nothing is lost: the file stays in storage and every removal or move is kept in order_files_removed.
-- The AI check of the signed BOL (0082) is cleared for both orders, so it reads them again.

create table if not exists public.order_files_removed (
  id               bigint generated always as identity primary key,
  file_id          bigint not null,
  order_id         uuid not null,
  kind             text not null,
  path             text not null,
  name             text,
  uploaded_by_name text,
  uploaded_at      timestamptz,
  moved_to         uuid,
  reason           text,
  removed_by       uuid references public.profiles(id) on delete set null,
  removed_by_name  text,
  removed_at       timestamptz not null default now()
);
create index if not exists order_files_removed_order_idx on public.order_files_removed(order_id);
alter table public.order_files_removed enable row level security;
drop policy if exists order_files_removed_read on public.order_files_removed;
create policy order_files_removed_read on public.order_files_removed for select to authenticated using (public.is_employee());
revoke insert, update, delete on public.order_files_removed from anon, authenticated;
grant select on public.order_files_removed to authenticated;

-- Who can take a file off: admins, the order desk, and (signed BOLs) the warehouse. Same people who can add one.
create or replace function public.order_file_can(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('order_desk') or (p_kind = 'bol' and public.has_perm('inventory'))
$$;

create or replace function public.order_file_remove(p_file bigint, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  f public.order_files;
begin
  select * into f from public.order_files where id = p_file for update;
  if f.id is null then raise exception 'That file is already gone.'; end if;
  if not public.order_file_can(f.kind) then raise exception 'Only the order desk, the warehouse or an admin can remove it.'; end if;
  insert into public.order_files_removed (file_id, order_id, kind, path, name, uploaded_by_name, uploaded_at, reason, removed_by, removed_by_name)
  values (f.id, f.order_id, f.kind, f.path, f.name, f.uploaded_by_name, f.created_at, nullif(trim(coalesce(p_reason, '')), ''), auth.uid(), public.my_name());
  delete from public.order_files where id = f.id;
  delete from public.order_bol_checks where order_id = f.order_id;
  return f.order_id;
end $$;
revoke all on function public.order_file_remove(bigint, text) from public, anon;
grant execute on function public.order_file_remove(bigint, text) to authenticated;

create or replace function public.order_file_move(p_file bigint, p_to uuid, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  f public.order_files;
begin
  select * into f from public.order_files where id = p_file for update;
  if f.id is null then raise exception 'That file is already gone.'; end if;
  if not public.order_file_can(f.kind) then raise exception 'Only the order desk, the warehouse or an admin can move it.'; end if;
  if p_to is null or not exists (select 1 from public.orders where id = p_to) then raise exception 'That order wasn''t found.'; end if;
  if p_to = f.order_id then raise exception 'It''s already on that order.'; end if;
  insert into public.order_files_removed (file_id, order_id, kind, path, name, uploaded_by_name, uploaded_at, moved_to, reason, removed_by, removed_by_name)
  values (f.id, f.order_id, f.kind, f.path, f.name, f.uploaded_by_name, f.created_at, p_to, nullif(trim(coalesce(p_reason, '')), ''), auth.uid(), public.my_name());
  update public.order_files set order_id = p_to where id = f.id;
  delete from public.order_bol_checks where order_id in (f.order_id, p_to);
  return f.order_id;
end $$;
revoke all on function public.order_file_move(bigint, uuid, text) from public, anon;
grant execute on function public.order_file_move(bigint, uuid, text) to authenticated;

select 'Ready (should be 4)' as "Check",
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'order_files_removed')
  + (select count(*) from pg_proc where proname in ('order_file_can', 'order_file_remove', 'order_file_move') and pronamespace = 'public'::regnamespace) as "Count";
