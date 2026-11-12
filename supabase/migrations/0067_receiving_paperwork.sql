-- 0067: Receiving Reports need both the BOL and the packing list, and a truck is only counted once.
--
-- * Each file on a report says what it is: {"path", "name", "kind": "bol" | "packing" | "other"}. (Stored in the
--   files list that's already there, so nothing changes for older reports.) The app requires both on every report.
-- * Paperwork can be added to a report later (the packing list that came by email, a damage photo).
-- * A report an admin sent back that was then redone as a NEW report for the same truck is closed as "Redone on
--   report #N", so it stops showing as late / on the way. Sending the new report does this on its own from now on;
--   the cleanup at the bottom closes the ones already there (the Arlington Covestro report #11, redone on #13).

alter table public.inbound_deliveries add column if not exists replaced_by       bigint references public.inbound_deliveries(id) on delete set null;
alter table public.inbound_deliveries add column if not exists cancelled_at      timestamptz;
alter table public.inbound_deliveries add column if not exists cancelled_by_name text;
alter table public.inbound_deliveries add column if not exists cancel_note       text;

-- Cancelling now says who and when.
create or replace function public.inbound_cancel(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into d from public.inbound_deliveries where id = p_id;
  if d.transfer_id is not null then raise exception 'This is a transfer from another AMBIT location. The sending location cancels it (its stock goes back).'; end if;
  update public.inbound_deliveries
     set status = 'cancelled', cancelled_at = now(), cancelled_by_name = public.my_name()
   where id = p_id and (status = 'expected' or (status = 'submitted' and public.is_admin()));
end $$;

-- A sent-back report was redone as a new report for the same truck: close the old one (nothing from it is in stock).
create or replace function public.inbound_replace(p_old bigint, p_new bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare o public.inbound_deliveries; n public.inbound_deliveries;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  select * into o from public.inbound_deliveries where id = p_old for update;
  select * into n from public.inbound_deliveries where id = p_new;
  if o.id is null or n.id is null or o.id = n.id then raise exception 'Report not found.'; end if;
  if o.branch_id <> n.branch_id then raise exception 'Those reports are at different locations.'; end if;
  if o.transfer_id is not null then raise exception 'A transfer is cancelled by the location that sent it.'; end if;
  if o.status <> 'expected' then raise exception 'Report #% isn''t waiting to be fixed (it''s %).', o.id, o.status; end if;
  if n.status not in ('submitted', 'received') then raise exception 'Report #% hasn''t been sent yet.', n.id; end if;
  update public.inbound_deliveries
     set status = 'cancelled', replaced_by = n.id, cancelled_at = now(), cancelled_by_name = public.my_name(),
         cancel_note = 'Redone on Receiving Report #' || n.id || ' (same truck). Nothing from this one went into stock.'
   where id = o.id;
  insert into public.inventory_log (branch_id, kind, message, by_name)
  values (o.branch_id, 'received', 'Receiving Report #' || o.id || ' from ' || o.vendor || ' closed: redone on #' || n.id || '.', public.my_name());
end $$;

-- Add paperwork to a report already sent (the packing list, a photo of damage). p_files: [{"path", "name", "kind"}]
create or replace function public.inbound_add_files(p_id bigint, p_files jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare d public.inbound_deliveries; v jsonb := '[]'::jsonb; f jsonb;
begin
  if not public.can_receive() then raise exception 'You don''t have access to receiving.'; end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then raise exception 'Add a photo or PDF.'; end if;
  select * into d from public.inbound_deliveries where id = p_id for update;
  if d.id is null then raise exception 'Report not found.'; end if;
  if d.status = 'cancelled' then raise exception 'This report was cancelled.'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f ->> 'path', '') !~ '^[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$' or split_part(f ->> 'path', '/', 1) <> d.branch_id then
      raise exception 'One of the files isn''t from this app.';
    end if;
    v := v || jsonb_build_object(
      'path', f ->> 'path',
      'name', left(coalesce(nullif(trim(f ->> 'name'), ''), 'file'), 120),
      'kind', case when f ->> 'kind' in ('bol', 'packing', 'other') then f ->> 'kind' else 'other' end);
  end loop;
  update public.inbound_deliveries set files = coalesce(files, '[]'::jsonb) || v where id = d.id;
  insert into public.inventory_log (branch_id, kind, message, by_name)
  values (d.branch_id, 'received', 'Paperwork added to Receiving Report #' || d.id || ' (' || d.vendor || ').', public.my_name());
  return jsonb_array_length(coalesce(d.files, '[]'::jsonb)) + jsonb_array_length(v);
end $$;

revoke all on function public.inbound_replace(bigint, bigint) from public, anon;
revoke all on function public.inbound_add_files(bigint, jsonb) from public, anon;
grant execute on function public.inbound_replace(bigint, bigint) to authenticated;
grant execute on function public.inbound_add_files(bigint, jsonb) to authenticated;

-- One-time cleanup: sent-back reports that were redone as a new report for the same truck (same location, same
-- BOL #, the same items and quantities, within 3 days). Each is closed as redone on the new one. Nothing in stock
-- changes: a sent-back report never put anything into stock.
with sb as (
  select d.id, d.branch_id, d.vendor, d.created_at, upper(regexp_replace(coalesce(d.bol_no, ''), '[^A-Za-z0-9]', '', 'g')) as k,
         (select string_agg(l.sku || '=' || l.qty::numeric::text, ',' order by l.sku, l.qty) from public.inbound_lines l where l.delivery_id = d.id) as items
    from public.inbound_deliveries d
   where d.status = 'expected' and d.sent_back_note is not null and d.transfer_id is null and length(coalesce(d.bol_no, '')) >= 3
), redo as (
  select distinct on (sb.id) sb.id as old_id, n.id as new_id, sb.branch_id, sb.vendor
    from sb
    join public.inbound_deliveries n
      on n.branch_id = sb.branch_id and n.id <> sb.id and n.status in ('submitted', 'received') and n.transfer_id is null
     and n.created_at > sb.created_at and n.created_at < sb.created_at + interval '3 days'
     and upper(regexp_replace(coalesce(n.bol_no, ''), '[^A-Za-z0-9]', '', 'g')) = sb.k
     and (select string_agg(l.sku || '=' || l.qty::numeric::text, ',' order by l.sku, l.qty) from public.inbound_lines l where l.delivery_id = n.id) = sb.items
   order by sb.id, n.created_at
), closed as (
  update public.inbound_deliveries x
     set status = 'cancelled', replaced_by = redo.new_id, cancelled_at = now(), cancelled_by_name = 'AMBITION (cleanup)',
         cancel_note = 'Redone on Receiving Report #' || redo.new_id || ' (same truck, same BOL #). Nothing from this one went into stock.'
    from redo
   where x.id = redo.old_id
  returning x.id, x.branch_id, x.vendor, x.replaced_by
)
insert into public.inventory_log (branch_id, kind, message, by_name)
select c.branch_id, 'received', 'Receiving Report #' || c.id || ' from ' || c.vendor || ' closed: redone on #' || c.replaced_by || ' (cleanup).', 'AMBITION'
  from closed c;

-- Check: Ready should be 6. "Duplicates closed" lists what the cleanup closed (expect #11 → #13 at Arlington).
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'inbound_deliveries'
      and column_name in ('replaced_by', 'cancelled_at', 'cancelled_by_name', 'cancel_note'))
  + (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('inbound_replace', 'inbound_add_files')) as "Ready (should be 6)",
  (select string_agg('#' || id || ' → #' || replaced_by, ', ' order by id) from public.inbound_deliveries where replaced_by is not null) as "Duplicates closed";
