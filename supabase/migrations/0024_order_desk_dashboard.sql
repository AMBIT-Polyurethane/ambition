-- =====================================================================
-- AMBIT Intelligence update 0024 - Order desk dashboard
-- One call gives the Order Desk page its charts: open orders by status and
-- by location, orders placed per day (or week), how long each step takes,
-- and the orders waiting longest. For admins, the order desk (CRM) and
-- credit approvals (accounting). Run once in Supabase > SQL Editor.
-- Safe to run again.
-- =====================================================================

-- p_days: 7, 30 or 90 days back (today included), or 0 for this year. Days are Central time.
-- p_branch: null = every location, 'dropship' = drop-ship orders, else a branch id.
create or replace function public.order_desk_stats(p_days int default 30, p_branch text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz     text := 'America/Chicago';
  today  date := (now() at time zone 'America/Chicago')::date;
  d0     date;
  since  timestamptz;
  weekly boolean;
  res    jsonb;
begin
  if not (public.is_admin() or public.has_perm('order_desk') or public.has_perm('credit_check')) then
    raise exception 'You don''t have access to the order desk.';
  end if;
  d0 := case when coalesce(p_days, 30) <= 0 then date_trunc('year', today)::date else today - (least(p_days, 366) - 1) end;
  since := d0::timestamp at time zone tz;
  weekly := coalesce(p_days, 30) <= 0 or p_days > 45;

  with o as (
    select x.*,
           (x.created_at at time zone tz)::date as placed_day
      from public.orders x
     where p_branch is null
        or (p_branch = 'dropship' and x.branch_id is null)
        or x.branch_id = p_branch
  ),
  opn as (
    select o.*,
           case o.stage
             when 'customer'  then coalesce(o.approval_sent_at, o.created_at)
             when 'needs_po'  then coalesce(o.approved_at, o.created_at)
             when 'credit'    then coalesce(o.po_at, o.created_at)
             when 'hold'      then coalesce(o.credit_at, o.created_at)
             when 'schedule'  then coalesce(o.credit_at, o.created_at)
             when 'scheduled' then case when o.scheduled_for < today then (o.scheduled_for + 1)::timestamp at time zone tz end
           end as waiting_since
      from o
     where o.stage not in ('completed', 'cancelled')
  ),
  buckets as (
    select g::date as d
      from generate_series(
             case when weekly then date_trunc('week', d0)::date else d0 end,
             today,
             case when weekly then interval '1 week' else interval '1 day' end) g
  ),
  steps as (
    select 'customer' as k, extract(epoch from approved_at - approval_sent_at) / 3600.0 as h
      from o where approval_sent_at is not null and approved_at >= since
    union all
    select 'po', extract(epoch from po_at - coalesce(approved_at, created_at)) / 3600.0
      from o where po_at >= since
    union all
    select 'credit', extract(epoch from credit_at - po_at) / 3600.0
      from o where credit_at >= since and po_at is not null and credit_status in ('approved', 'hold')
    union all
    select 'schedule', extract(epoch from scheduled_at - credit_at) / 3600.0
      from o where scheduled_at >= since and credit_at is not null and credit_status = 'approved'
  )
  select jsonb_build_object(
    'first', d0,
    'since', since,
    'today', today,
    'bucket', case when weekly then 'week' else 'day' end,
    'open', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from opn group by stage) s), '{}'::jsonb),
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch', b, 'stage', stage, 'n', n))
                             from (select coalesce(branch_id, 'dropship') as b, stage, count(*) as n from opn group by 1, 2) s), '[]'::jsonb),
    'placed', (select count(*) from o where created_at >= since),
    'completed', (select count(*) from o where status = 'completed' and completed_at >= since),
    'cancelled', (select count(*) from o where status = 'cancelled' and coalesce(cancelled_at, created_at) >= since),
    'series', (select jsonb_agg(jsonb_build_object('d', b.d, 'n',
                 (select count(*) from o
                   where case when weekly then date_trunc('week', o.placed_day)::date else o.placed_day end = b.d
                     and o.placed_day >= d0))
                 order by b.d) from buckets b),
    'steps', coalesce((select jsonb_object_agg(k, jsonb_build_object('n', n, 'avg', round(avg_h::numeric, 2), 'median', round(med_h::numeric, 2)))
                         from (select k, count(*) as n, avg(h) as avg_h, percentile_cont(0.5) within group (order by h) as med_h
                                 from steps where h >= 0 group by k) s), '{}'::jsonb),
    'cycle', (select jsonb_build_object('n', count(*),
                       'avg', round((avg(extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2),
                       'median', round((percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) / 3600.0)::numeric, 2))
                from o where status = 'completed' and completed_at >= since and completed_at > created_at),
    'stuck', (select count(*) from opn where waiting_since is not null and (stage = 'scheduled' or waiting_since < now() - interval '24 hours')),
    'waiting', coalesce((select jsonb_agg(w) from (
                  select jsonb_build_object('id', id, 'order_no', order_no, 'company', company_name, 'stage', stage,
                                            'branch', branch_id, 'since', waiting_since,
                                            'hours', round((extract(epoch from now() - waiting_since) / 3600.0)::numeric, 1),
                                            'late', stage = 'scheduled', 'scheduled_for', scheduled_for) as w
                    from opn where waiting_since is not null
                   order by waiting_since
                   limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

revoke all on function public.order_desk_stats(int, text) from public, anon;
grant execute on function public.order_desk_stats(int, text) to authenticated;

select 'order desk dashboard ready' as status;
