-- 0089: automatic hand-offs in the order chat. When an order moves to another department's step, the order chat gets a
-- note that tags the people who do the next step ("Credit released → @Kim Hight ready to schedule"). Each person tagged
-- gets it on their to-do list, and their earlier hand-off to-dos on that order tick themselves off when the order moves on.
-- Never blocks an order: if anything here fails, the order change still goes through.

alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'system', 'ai', 'handoff'));
alter table public.chat_messages add column if not exists pushed_at timestamptz;
alter table public.chat_todos drop constraint if exists chat_todos_source_check;
alter table public.chat_todos add constraint chat_todos_source_check check (source in ('mention', 'manual', 'ai', 'handoff'));

-- Active staff with a permission, the ones with the usual job for it first (warehouse for loading, accounting for credit),
-- and the ones at the order's location first (none there: everyone with it).
drop function if exists public.handoff_people(text, text, int);
create or replace function public.handoff_people(p_perm text, p_branch text, p_max int default 4, p_role text default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  with c as (
    select id, branch_id, job_role from public.profiles
     where status = 'active' and coalesce(demo, false) = false and role in ('employee', 'admin') and p_perm = any(coalesce(perms, '{}'))
  ), r as (
    select * from c where p_role is not null and job_role = p_role
  ), pool as (
    select id, branch_id from r
    union all
    select id, branch_id from c where not exists (select 1 from r)
  )
  select coalesce(array_agg(id), '{}') from (
    select id from pool where p_branch is not null and branch_id = p_branch
    union all
    select id from pool where not exists (select 1 from pool where p_branch is not null and branch_id = p_branch)
    limit p_max
  ) x
$$;

-- The order desk person working on this order: whoever entered its Sales Order #, else whoever placed it (if they're on
-- the desk), else the desk at its location.
create or replace function public.handoff_desk(o public.orders) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if o.po_by_name is not null then
    select id into v from public.profiles where status = 'active' and coalesce(full_name, email) = o.po_by_name limit 1;
    if v is not null then return array[v]; end if;
  end if;
  select id into v from public.profiles where id = o.placed_by and status = 'active' and 'order_desk' = any(coalesce(perms, '{}'));
  if v is not null then return array[v]; end if;
  return public.handoff_people('order_desk', o.branch_id, 2, 'crm');
end $$;

create or replace function public.order_handoff_note(o public.orders, p_old text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_chan uuid;
  v_msg bigint;
  v_people uuid[] := '{}';
  v_text text;
  v_todo text;
  v_tags text;
  v_when text := case when o.scheduled_for is null then '' when o.scheduled_for = (now() at time zone 'America/Chicago')::date then 'today' else to_char(o.scheduled_for, 'Mon FMDD') end;
  v_ref text := 'ORD-' || o.order_no || ' · ' || coalesce(o.company_name, '');
begin
  if o.stage = 'needs_po' and p_old is distinct from 'invoice_update' then
    v_people := public.handoff_desk(o);
    v_text := case when p_old = 'customer' then 'Customer approved' else 'New order' end;
    v_todo := 'enter the Sales Order #, Invoice # and prices';
  elsif o.stage = 'credit' then
    v_people := public.handoff_people('credit_check', null, 3, 'accounting');
    v_text := case when p_old = 'invoice_update' then 'Invoice updated' else 'Sales Order # ' || coalesce(o.ambit_po, '') || ' in' end;
    v_todo := 'check credit and release';
  elsif o.stage = 'schedule' then
    v_people := public.handoff_desk(o);
    v_text := case when p_old in ('credit', 'hold') then 'Credit released' else 'Needs a new date' end;
    v_todo := 'ready to schedule';
  elsif o.stage = 'hold' then
    v_people := public.handoff_desk(o) || coalesce(array[o.sales_rep_id], '{}');
    v_text := 'On credit hold' || coalesce(': ' || nullif(trim(o.credit_note), ''), '');
    v_todo := 'talk to the customer';
  elsif o.stage = 'scheduled' and p_old is distinct from 'scheduled' then
    if o.delivery_method = 'dropship' then
      v_people := public.handoff_desk(o);
      v_text := 'Ships from the supplier ' || v_when;
      v_todo := 'make sure it ships';
    else
      v_people := public.handoff_people('inventory', o.branch_id, 4, 'warehouse');
      v_text := case when o.delivery_method = 'pickup' then 'Pickup ' || v_when else 'Scheduled for ' || v_when end;
      v_todo := case when o.delivery_method = 'pickup' then 'have it ready and get it signed' else 'load it and get it signed' end;
    end if;
  elsif o.stage = 'invoice_update' then
    v_people := public.handoff_desk(o);
    v_text := 'Order edited';
    v_todo := 'update the invoice';
  elsif o.stage = 'completed' and p_old is distinct from 'invoice_update' then
    v_text := case o.delivery_method when 'pickup' then 'Picked up' when 'dropship' then 'Shipped' else 'Delivered' end || ' ✓';
  elsif o.stage = 'cancelled' then
    v_text := 'Cancelled' || coalesce(': ' || nullif(trim(o.cancel_reason), ''), '');
  else
    return;
  end if;

  -- Not the person who just did it, and only real, active staff.
  select coalesce(array_agg(distinct p.id), '{}') into v_people from public.profiles p
   where p.id = any(coalesce(v_people, '{}')) and p.id is distinct from auth.uid() and p.status = 'active' and p.role in ('employee', 'admin');
  select string_agg('@' || coalesce(p.full_name, p.email), ' ' order by p.full_name) into v_tags from public.profiles p where p.id = any(v_people);

  -- The order's chat (made now if nobody has opened it yet).
  select id into v_chan from public.chat_channels where order_id = o.id;
  if v_chan is null then
    insert into public.chat_channels (kind, name, order_id, created_by)
    values ('order', v_ref, o.id, auth.uid()) on conflict (order_id) do nothing returning id into v_chan;
    if v_chan is null then select id into v_chan from public.chat_channels where order_id = o.id; end if;
  end if;
  if v_chan is null then return; end if;

  -- Whatever the last hand-off asked for on this order is done now.
  update public.chat_todos t set done_at = now()
   where t.done_at is null and t.source = 'handoff' and t.channel_id = v_chan;

  insert into public.chat_messages (channel_id, user_id, body, mentions, kind)
  values (v_chan, auth.uid(), v_text || case when v_tags is not null then ' → ' || v_tags || ' ' || v_todo else '' end, v_people, 'handoff')
  returning id into v_msg;
  update public.chat_channels set last_message_at = now() where id = v_chan;

  if array_length(v_people, 1) > 0 then
    insert into public.chat_members (channel_id, user_id, notify)
    select v_chan, x, 'all' from unnest(v_people) x on conflict do nothing;
    insert into public.chat_todos (user_id, text, channel_id, message_id, from_name, created_by, source)
    select x, left('ORD-' || o.order_no || ' ' || coalesce(o.company_name, '') || ': ' || v_todo, 200), v_chan, v_msg, 'AMBIT', auth.uid(), 'handoff'
      from unnest(v_people) x;
  end if;
end $$;
revoke all on function public.order_handoff_note(public.orders, text) from public, anon, authenticated;
revoke all on function public.handoff_people(text, text, int, text) from public, anon, authenticated;
revoke all on function public.handoff_desk(public.orders) from public, anon, authenticated;

create or replace function public.orders_handoff_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.order_handoff_note(new, case when tg_op = 'UPDATE' then old.stage else null end);
  exception when others then
    null; -- a hand-off note must never stop an order from moving
  end;
  return null;
end $$;

drop trigger if exists orders_handoff on public.orders;
create trigger orders_handoff after update on public.orders
  for each row when (old.stage is distinct from new.stage) execute function public.orders_handoff_trigger();
drop trigger if exists orders_handoff_new on public.orders;
create trigger orders_handoff_new after insert on public.orders
  for each row when (new.stage = 'needs_po') execute function public.orders_handoff_trigger();

-- The app sends the phone notification for each hand-off once (pushed_at), right after the step that caused it.
create or replace function public.chat_handoffs_to_push(p_order uuid) returns table (id bigint, channel_id uuid, body text, mentions uuid[])
language sql security definer set search_path = public as $$
  update public.chat_messages m set pushed_at = now()
    from public.chat_channels c
   where c.id = m.channel_id and c.order_id = p_order and m.kind = 'handoff' and m.pushed_at is null
     and m.created_at > now() - interval '10 minutes' and public.is_employee()
  returning m.id, m.channel_id, m.body, m.mentions
$$;
revoke all on function public.chat_handoffs_to_push(uuid) from public, anon;
grant execute on function public.chat_handoffs_to_push(uuid) to authenticated;

select 'Ready (should be 6)' as "Check",
  (select count(*) from pg_proc where proname in ('handoff_people', 'handoff_desk', 'order_handoff_note', 'orders_handoff_trigger', 'chat_handoffs_to_push') and pronamespace = 'public'::regnamespace)
  + (select count(*) from pg_trigger where tgname = 'orders_handoff') as "Count";
