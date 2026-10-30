-- =====================================================================
-- AMBIT Intelligence update 0034 - Deleted orders go to a log that can be undone
-- * Deleting an order no longer erases it. The whole order (its lines, the lots it was holding, its
--   files and item changes) is saved in the Deleted orders log first, then taken out of the app.
-- * Only the order keepers (Jeremiah) see that log and can put an order back: same order #, same
--   lines and lots, and (by default) open again with its stock reserved again.
-- * Cancelling remembers where the order was (New or Processing), so putting it back returns it there.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.orders add column if not exists status_before_cancel text;

-- ---------- Who can see the log and undo a delete -------------------------------------------------
-- No policies on purpose: nobody can read or change this list from the app; only the functions below use it.
create table if not exists public.order_keepers (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  added_at    timestamptz not null default now()
);
alter table public.order_keepers enable row level security;
insert into public.order_keepers (profile_id)
select id from public.profiles where lower(email) = 'jeremiah.bryant@ambitpu.com'
on conflict do nothing;

create or replace function public.is_order_keeper() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_keepers k join public.profiles p on p.id = k.profile_id
                  where k.profile_id = auth.uid() and p.status = 'active')
$$;

-- ---------- The log -----------------------------------------------------------------------------
create table if not exists public.orders_deleted (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null,
  order_no           bigint not null,
  company_name       text,
  placed_by_name     text,
  placed_at          timestamptz,
  status_before      text,             -- where it was before it was cancelled (new / processing)
  cancel_reason      text,
  cancelled_by_name  text,
  cancelled_at       timestamptz,
  est_subtotal       numeric(12,2),
  item_count         int,
  snapshot           jsonb not null,   -- order, items, lines, variances, files, drafts
  deleted_at         timestamptz not null default now(),
  deleted_by         uuid,
  deleted_by_name    text,
  restored_at        timestamptz,
  restored_by_name   text
);
create index if not exists orders_deleted_at_idx on public.orders_deleted (deleted_at desc);
alter table public.orders_deleted enable row level security;
drop policy if exists orders_deleted_keepers on public.orders_deleted;
create policy orders_deleted_keepers on public.orders_deleted for select to authenticated
  using (public.is_order_keeper());

-- ---------- Cancel: remember where the order was ----------------------------------------------------
-- Same as 0022, plus status_before_cancel.
create or replace function public.order_cancel(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not (public.is_admin() or public.has_perm('order_desk')
          or (o.placed_by = auth.uid() and o.ambit_po is null)) then
    raise exception 'Only an admin or the order desk can cancel this order now.';
  end if;
  if o.status = 'cancelled' then raise exception 'This order is already cancelled.'; end if;
  if o.status = 'completed' then raise exception 'This order is already picked up or delivered.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the order is cancelled.'; end if;
  update public.orders
     set status = 'cancelled', cancel_reason = left(trim(p_reason), 500),
         cancelled_by_name = public.my_name(), cancelled_at = now(),
         status_before_cancel = o.status::text
   where id = p_order;
end $$;

-- ---------- Delete: save everything to the log, then take it out of the app --------------------------
create or replace function public.order_delete(p_order uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if not public.is_admin() then raise exception 'Only admins can delete orders.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'cancelled' then raise exception 'Cancel the order first, then delete it.'; end if;
  if exists (select 1 from public.inventory_lines l where l.order_id = p_order and l.sheet_row is not null and l.needs_write) then
    raise exception 'The inventory spreadsheet is still being updated for this order. Try again in a couple of minutes.';
  end if;
  insert into public.orders_deleted (order_id, order_no, company_name, placed_by_name, placed_at, status_before, cancel_reason,
                                     cancelled_by_name, cancelled_at, est_subtotal, item_count, snapshot, deleted_by, deleted_by_name)
  values (o.id, o.order_no, o.company_name, o.placed_by_name, o.created_at, o.status_before_cancel, o.cancel_reason,
          o.cancelled_by_name, o.cancelled_at, o.est_subtotal,
          (select count(*) from public.order_items x where x.order_id = o.id),
          jsonb_build_object(
            'order',     to_jsonb(o),
            'items',     coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.order_items x where x.order_id = o.id), '[]'::jsonb),
            'lines',     coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.inventory_lines x where x.order_id = o.id), '[]'::jsonb),
            'variances', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.order_variances x where x.order_id = o.id), '[]'::jsonb),
            'files',     coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.order_files x where x.order_id = o.id), '[]'::jsonb),
            'drafts',    coalesce((select jsonb_agg(x.id) from public.order_drafts x where x.order_id = o.id), '[]'::jsonb)),
          auth.uid(), public.my_name());
  delete from public.orders where id = p_order;
  return 'ORD-' || o.order_no;
end $$;

-- ---------- Putting it back ------------------------------------------------------------------------
-- Inserts saved rows into a table exactly as they were (same ids). Columns added since the save are left
-- to their defaults; generated columns are worked out again.
create or replace function public.restore_rows(p_table regclass, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  cols text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return; end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and (p_rows->0) ? a.attname;
  if cols is null then return; end if;
  execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, $1)',
                 p_table, cols, cols, p_table)
    using p_rows;
end $$;

-- Back to New / Processing (where it was before it was cancelled); the inventory trigger holds its stock again.
create or replace function public.order_reopen_now(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders
     set status = case when status_before_cancel in ('new', 'processing') then status_before_cancel else 'new' end::public.order_status,
         cancel_reason = null, cancelled_by_name = null, cancelled_at = null, status_before_cancel = null
   where id = p_order and status = 'cancelled';
end $$;

create or replace function public.order_restore(p_log uuid, p_reopen boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare
  d public.orders_deleted;
  s jsonb;
begin
  if not public.is_order_keeper() then raise exception 'Only Jeremiah can put deleted orders back.'; end if;
  select * into d from public.orders_deleted where id = p_log for update;
  if d.id is null then raise exception 'That deleted order wasn''t found.'; end if;
  if d.restored_at is not null then raise exception 'ORD-% is already back in the app.', d.order_no; end if;
  if exists (select 1 from public.orders where id = d.order_id) then raise exception 'That order is already in the app.'; end if;
  if exists (select 1 from public.orders where order_no = d.order_no) then
    raise exception 'Another order is using ORD-% now, so this one can''t take it back.', d.order_no;
  end if;
  s := d.snapshot;
  perform public.restore_rows('public.orders', jsonb_build_array(s->'order'));
  perform public.restore_rows('public.order_items', s->'items');      -- a cancelled order doesn't pick stock here
  perform public.restore_rows('public.inventory_lines', s->'lines');   -- its own lines and lots come back instead
  perform public.restore_rows('public.order_variances', s->'variances');
  perform public.restore_rows('public.order_files', s->'files');
  update public.order_drafts set order_id = d.order_id
   where order_id is null and id in (select x::uuid from jsonb_array_elements_text(coalesce(s->'drafts', '[]'::jsonb)) x);
  update public.orders_deleted set restored_at = now(), restored_by_name = public.my_name() where id = d.id;
  if p_reopen then perform public.order_reopen_now(d.order_id); end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = s->'order'->>'branch_id';
  return 'ORD-' || d.order_no;
end $$;

-- ---------- Who can call what ------------------------------------------------------------------
revoke all on function public.restore_rows(regclass, jsonb) from public, anon, authenticated;
revoke all on function public.order_reopen_now(uuid) from public, anon, authenticated;
revoke all on function public.is_order_keeper() from public, anon;
grant execute on function public.is_order_keeper() to authenticated;
revoke all on function public.order_restore(uuid, boolean) from public, anon;
grant execute on function public.order_restore(uuid, boolean) to authenticated;
revoke execute on function public.order_cancel(uuid, text) from public, anon;
revoke execute on function public.order_delete(uuid) from public, anon;
grant execute on function public.order_cancel(uuid, text) to authenticated;
grant execute on function public.order_delete(uuid) to authenticated;

select 'Deleted orders log ready' as status,
       (select count(*) from public.order_keepers) as order_keepers;
