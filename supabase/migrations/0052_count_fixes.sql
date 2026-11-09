-- =====================================================================
-- AMBIT Intelligence update 0052 - Fixing counts, automatic approval, variance report
-- * Admins can fix a counted number on a spot check or reconciliation that's waiting for approval
--   ("Edit count"). The number first counted is kept and shown ("was 786").
-- * A count that matches what the app has is approved automatically (by AMBIT A.I.), and its
--   LAST COUNTED / COUNTED BY go onto the COUNT SHEET like an approved count. Spot checks already
--   marked "Matched" become "Approved".
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.inventory_count_lines add column if not exists first_qty     numeric(12,2);  -- what was counted before an admin fixed it
alter table public.inventory_count_lines add column if not exists fixed_by_name text;
alter table public.inventory_count_lines add column if not exists fixed_at      timestamptz;

-- Puts a count's numbers into stock and marks it approved: an admin's Approve, or automatically when it
-- matched the app. Called only from the functions below (not by the app directly).
create or replace function public.count_apply(p_count bigint, p_who text, p_note text default null, p_auto boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k     public.inventory_counts;
  l     record;
  diff  numeric;
  n     int := 0;
  m     int := 0;
  what  text;
  dt    date;
  fl    record;
begin
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status not in ('submitted', 'matched') then raise exception 'This count isn''t waiting for approval.'; end if;
  what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
  for l in select * from public.inventory_count_lines where count_id = p_count and counted_qty is not null and not applied order by id loop
    m := m + 1;
    diff := l.counted_qty - coalesce(l.system_qty, 0);
    dt := coalesce((l.counted_at at time zone 'America/Chicago')::date, (now() at time zone 'America/Chicago')::date);
    if l.lot_id is not null then
      if diff <> 0 then
        update public.inventory_lots set adj_unsynced = adj_unsynced + diff, updated_at = now() where id = l.lot_id;
        insert into public.inventory_log (branch_id, kind, sku, message, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': lot ' || coalesce(l.lot_no, '(no lot #)') || ' counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0))
                  || '). Adj on FOAM LOTS ' || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || p_who || '.',
                coalesce(l.counted_by_name, p_who));
        n := n + 1;
      end if;
    else
      -- A later count already on the row (typed on the sheet, or approved first) keeps its date and name.
      update public.inventory
         set on_hand = coalesce(on_hand, 0) + diff,
             counted_by = case when last_counted is null or last_counted <= dt then left(coalesce(l.counted_by_name, p_who), 80) else counted_by end,
             last_counted = case when last_counted is null or last_counted <= dt then dt else last_counted end,
             count_dirty = true, updated_at = now(), updated_by_name = p_who
       where branch_id = k.branch_id and product_id = l.product_id;
      if diff <> 0 then
        insert into public.inventory_log (branch_id, kind, sku, message, qty_before, qty_after, by_name)
        values (k.branch_id, 'count', l.sku,
                what || ': counted ' || trim_scale(l.counted_qty) || ' (app had ' || trim_scale(coalesce(l.system_qty, 0)) || '), '
                  || case when diff > 0 then '+' else '' end || trim_scale(diff) || ', approved by ' || p_who || '.',
                l.system_qty, l.counted_qty, coalesce(l.counted_by_name, p_who));
        n := n + 1;
      end if;
    end if;
    update public.inventory_count_lines set applied = true where id = l.id;
  end loop;
  update public.inventory_counts
     set status = 'approved', reviewed_at = now(), reviewed_by_name = p_who,
         review_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
   where id = p_count;
  if p_auto and n = 0 then
    select sku, counted_qty into fl from public.inventory_count_lines where count_id = p_count and counted_qty is not null order by id limit 1;
    insert into public.inventory_log (branch_id, kind, sku, message, by_name)
    values (k.branch_id, 'count', case when k.kind = 'spot' then fl.sku end,
            case when k.kind = 'spot'
                 then 'Spot check: ' || coalesce(fl.sku, '') || ' counted '
                      || case when m > 1 then 'lot by lot (' || m || ' lots)' else trim_scale(fl.counted_qty)::text end
                      || ', matched the app. Approved automatically.'
                 else 'Inventory reconciliation: all ' || m || ' counted ' || case when m = 1 then 'item' else 'items' end
                      || ' matched the app. Approved automatically.' end,
            coalesce(k.submitted_by_name, p_who));
  end if;
  update public.inventory_sheets set sync_wanted_at = now() where branch_id = k.branch_id;
  return n;
end $$;

-- A count is sent in. If everything matched it's approved automatically; otherwise it waits for an admin.
create or replace function public.count_finish(p_count bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  off int;
  st  text;
begin
  select count(*) into off from public.inventory_count_lines
   where count_id = p_count and counted_qty is not null and counted_qty is distinct from coalesce(system_qty, 0);
  st := case when off = 0 then 'matched' else 'submitted' end;
  update public.inventory_counts
     set status = st, submitted_at = now(), submitted_by_name = public.my_name()
   where id = p_count and status = 'open';
  if st = 'matched' then
    perform public.count_apply(p_count, 'AMBIT A.I.', 'Matched what the app had, so it was approved automatically.', true);
    st := 'approved';
  end if;
  return st;
end $$;

-- Warehouse: one counted number. A spot check is sent in as soon as every line has its count.
create or replace function public.count_line_save(p_line bigint, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l   public.inventory_count_lines;
  k   public.inventory_counts;
  sys numeric;
  st  text;
begin
  if not (public.is_admin() or public.has_perm('inventory')) then raise exception 'You don''t have access to inventory.'; end if;
  select * into l from public.inventory_count_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the count any more.'; end if;
  select * into k from public.inventory_counts where id = l.count_id for update;
  if k.status <> 'open' then raise exception 'This count was already sent in.'; end if;
  if p_qty is null then
    -- Cleared: not counted after all.
    update public.inventory_count_lines set counted_qty = null, system_qty = null, counted_at = null, counted_by_name = null where id = p_line;
    return jsonb_build_object('status', k.status, 'branch', k.branch_id);
  end if;
  if p_qty < 0 then raise exception 'A count can''t be below zero.'; end if;
  sys := public.count_system_qty(k.branch_id, l.product_id, l.lot_id);
  update public.inventory_count_lines
     set counted_qty = round(p_qty, 2), system_qty = sys, counted_at = now(), counted_by_name = public.my_name(),
         note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_line;
  st := k.status;
  if k.kind = 'spot' and not exists (select 1 from public.inventory_count_lines where count_id = k.id and counted_qty is null) then
    st := public.count_finish(k.id);
  end if;
  return jsonb_build_object('status', st, 'branch', k.branch_id);
end $$;

-- Admin: approve (the differences go into stock and onto the spreadsheet) or don't approve a count.
create or replace function public.count_review(p_count bigint, p_approve boolean, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  k    public.inventory_counts;
  who  text := coalesce(public.my_name(), 'AMBITION');
  what text;
begin
  if not public.is_admin() then raise exception 'Only admins can approve counts.'; end if;
  select * into k from public.inventory_counts where id = p_count for update;
  if k.id is null then raise exception 'Count not found.'; end if;
  if k.status <> 'submitted' then raise exception 'This count isn''t waiting for approval.'; end if;
  if not p_approve then
    what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
    update public.inventory_counts set status = 'rejected', reviewed_at = now(), reviewed_by_name = who,
           review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_count;
    insert into public.inventory_log (branch_id, kind, message, by_name)
    values (k.branch_id, 'count', what || ' not approved' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '') || '. Stock wasn''t changed.', who);
    return 0;
  end if;
  return public.count_apply(p_count, who, p_note, false);
end $$;

-- Admin: fix one counted number on a count that's waiting for approval (someone missed a display
-- item, typed 68 for 86...). The first number counted is kept. If everything now matches the app,
-- it's approved automatically.
create or replace function public.count_line_fix(p_line bigint, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l    public.inventory_count_lines;
  k    public.inventory_counts;
  who  text := coalesce(public.my_name(), 'Admin');
  what text;
  q    numeric;
  off  int;
begin
  if not public.is_admin() then raise exception 'Only admins can fix a count.'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'Type the right count (0 or more).'; end if;
  q := round(p_qty, 2);
  select * into l from public.inventory_count_lines where id = p_line;
  if l.id is null then raise exception 'That line isn''t on the count any more.'; end if;
  select * into k from public.inventory_counts where id = l.count_id for update;
  if k.status <> 'submitted' then raise exception 'Only a count that''s waiting for approval can be fixed.'; end if;
  if l.counted_qty is null then raise exception 'That item wasn''t counted, so it isn''t part of this count.'; end if;
  if l.counted_qty = q then
    return jsonb_build_object('status', k.status, 'branch', k.branch_id, 'changed', false);
  end if;
  what := case when k.kind = 'spot' then 'Spot check' else 'Inventory reconciliation' end;
  update public.inventory_count_lines
     set first_qty = coalesce(first_qty, counted_qty), counted_qty = q, fixed_by_name = who, fixed_at = now(),
         note = coalesce(nullif(left(trim(coalesce(p_note, '')), 300), ''), note)
   where id = p_line;
  insert into public.inventory_log (branch_id, kind, sku, message, by_name)
  values (k.branch_id, 'count', l.sku,
          what || ' (' || to_char(coalesce(k.day, (k.submitted_at at time zone 'America/Chicago')::date), 'Mon FMDD') || '): '
            || case when l.lot_no is not null then 'lot ' || l.lot_no || ' ' else '' end
            || 'count fixed from ' || trim_scale(l.counted_qty) || ' to ' || trim_scale(q)
            || coalesce(' (counted by ' || l.counted_by_name || ')', '')
            || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '') || '.',
          who);
  select count(*) into off from public.inventory_count_lines
   where count_id = k.id and counted_qty is not null and counted_qty is distinct from coalesce(system_qty, 0);
  if off = 0 then
    perform public.count_apply(k.id, who, 'Count fixed by ' || who || '. It then matched what the app had, so it was approved automatically.', true);
    return jsonb_build_object('status', 'approved', 'branch', k.branch_id, 'changed', true);
  end if;
  return jsonb_build_object('status', 'submitted', 'branch', k.branch_id, 'changed', true);
end $$;

-- Spot checks already marked "Matched" become "Approved" (their stock was already right).
update public.inventory_count_lines set applied = true
 where count_id in (select id from public.inventory_counts where status = 'matched') and counted_qty is not null;
update public.inventory_counts
   set status = 'approved', reviewed_at = coalesce(submitted_at, now()), reviewed_by_name = 'AMBIT A.I.',
       review_note = coalesce(review_note, 'Matched what the app had, so it was approved automatically.')
 where status = 'matched';

revoke all on function public.count_apply(bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.count_line_fix(bigint, numeric, text) from public, anon;
grant execute on function public.count_line_fix(bigint, numeric, text) to authenticated;

select 'Update 0052 done: ' || (select count(*) from public.inventory_counts where status = 'approved' and reviewed_by_name = 'AMBIT A.I.')
       || ' matched counts approved automatically.' as status;
