-- 0093: friendlier automatic notes in the order chat, written as full sentences, and the chat list shows they're
-- automated ("Automated: Delivery is scheduled for today. @Kim Hight, could you please load it ...").
-- Same steps and same people as 0089; only the wording changes. Safe to run again.

create or replace function public.order_handoff_note(o public.orders, p_old text) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_chan uuid;
  v_msg bigint;
  v_people uuid[] := '{}';
  v_text text;
  v_ask text;
  v_todo text;
  v_tags text;
  v_when text := case when o.scheduled_for is null then null
                      when o.scheduled_for = (now() at time zone 'America/Chicago')::date then 'today'
                      when o.scheduled_for = (now() at time zone 'America/Chicago')::date + 1 then 'tomorrow'
                      else to_char(o.scheduled_for, 'FMDay, Mon FMDD') end;
  v_ref text := 'ORD-' || o.order_no || ' ' || chr(183) || ' ' || coalesce(o.company_name, '');
  v_note text;
begin
  if o.stage = 'needs_po' and p_old is distinct from 'invoice_update' then
    v_people := public.handoff_desk(o);
    v_text := case when p_old = 'customer' then 'The customer approved this order.' else 'A new order just came in.' end;
    v_ask := 'when you get a chance, please enter the Sales Order #, Invoice # and prices.';
    v_todo := 'Enter the Sales Order #, Invoice # and prices';
  elsif o.stage = 'credit' then
    v_people := public.handoff_people('credit_check', null, 3, 'accounting');
    v_text := case when p_old = 'invoice_update' then 'The invoice has been updated.'
                   when nullif(trim(o.ambit_po), '') is not null then 'Sales Order # ' || trim(o.ambit_po) || ' has been entered.'
                   else 'The Sales Order # has been entered.' end;
    v_ask := 'could you please check credit and release it when you have a moment?';
    v_todo := 'Check credit and release';
  elsif o.stage = 'schedule' then
    v_people := public.handoff_desk(o);
    if p_old in ('credit', 'hold') then
      v_text := 'Credit has been released.';
      v_ask := 'it''s ready to be scheduled whenever you are.';
      v_todo := 'Schedule it';
    else
      v_text := 'This order needs a new date.';
      v_ask := 'could you please pick a new one when you get a chance?';
      v_todo := 'Pick a new date';
    end if;
  elsif o.stage = 'hold' then
    v_people := public.handoff_desk(o) || coalesce(array[o.sales_rep_id], '{}');
    v_note := rtrim(nullif(trim(o.credit_note), ''), '.!? ');
    v_text := 'This order is on credit hold' || coalesce(': ' || v_note, '') || '.';
    v_ask := 'could you please reach out to the customer?';
    v_todo := 'Talk to the customer';
  elsif o.stage = 'scheduled' and p_old is distinct from 'scheduled' then
    if o.delivery_method = 'dropship' then
      v_people := public.handoff_desk(o);
      v_text := 'This order ships from the supplier' || coalesce(case when v_when in ('today', 'tomorrow') then ' ' else ' on ' end || v_when, '') || '.';
      v_ask := 'could you please keep an eye on it and make sure it ships?';
      v_todo := 'Make sure it ships';
    else
      v_people := public.handoff_people('inventory', o.branch_id, 4, 'warehouse');
      if o.delivery_method = 'pickup' then
        v_text := 'Pickup is set' || coalesce(' for ' || v_when, '') || '.';
        v_ask := 'could you please have it ready and get the pickup slip signed?';
        v_todo := 'Have it ready and get the pickup slip signed';
      else
        v_text := 'Delivery is scheduled' || coalesce(' for ' || v_when, '') || '.';
        v_ask := 'could you please load it and get the delivery slip signed?';
        v_todo := 'Load it and get the delivery slip signed';
      end if;
    end if;
  elsif o.stage = 'invoice_update' then
    v_people := public.handoff_desk(o);
    v_text := 'This order was edited.';
    v_ask := 'could you please update the invoice when you get a chance?';
    v_todo := 'Update the invoice';
  elsif o.stage = 'completed' and p_old is distinct from 'invoice_update' then
    v_text := chr(10003) || ' ' || case o.delivery_method when 'pickup' then 'Picked up.' when 'dropship' then 'Shipped.' else 'Delivered.' end || ' Thanks for the teamwork, everyone!';
  elsif o.stage = 'cancelled' then
    v_note := rtrim(nullif(trim(o.cancel_reason), ''), '.!? ');
    v_text := 'This order was cancelled' || coalesce(': ' || v_note, '') || '.';
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
  values (v_chan, auth.uid(), v_text || case when v_tags is not null and v_ask is not null then ' ' || v_tags || ', ' || v_ask || ' Thank you!' else '' end, v_people, 'handoff')
  returning id into v_msg;
  update public.chat_channels set last_message_at = now() where id = v_chan;

  if array_length(v_people, 1) > 0 and v_todo is not null then
    insert into public.chat_members (channel_id, user_id, notify)
    select v_chan, x, 'all' from unnest(v_people) x on conflict do nothing;
    insert into public.chat_todos (user_id, text, channel_id, message_id, from_name, created_by, source)
    select x, left('ORD-' || o.order_no || ' ' || coalesce(o.company_name, '') || ': ' || v_todo, 200), v_chan, v_msg, 'AMBIT', auth.uid(), 'handoff'
      from unnest(v_people) x;
  end if;
end $fn$;
revoke all on function public.order_handoff_note(public.orders, text) from public, anon, authenticated;

-- The conversation list: automatic notes show as "Automated: ..." instead of looking like a person wrote them.
create or replace function public.chat_overview()
returns table (id uuid, kind text, name text, about text, private boolean, order_id uuid, last_message_at timestamptz, archived boolean,
               member boolean, notify text, unread int, mentions int, people text, preview text, preview_by text)
language sql stable security definer set search_path = public as $fn$
  with me as (select auth.uid() as uid),
  mine as (select m.* from public.chat_members m, me where m.user_id = me.uid)
  select c.id, c.kind, c.name, c.about, c.private, c.order_id, c.last_message_at, c.archived_at is not null,
         mi.channel_id is not null, coalesce(mi.notify, 'all'),
         coalesce((select count(*) from public.chat_messages x
                    where mi.channel_id is not null and x.channel_id = c.id and x.id > greatest(mi.last_read_id, mi.cleared_before) and x.parent_id is null
                      and x.deleted_at is null and x.user_id is distinct from (select uid from me) and x.kind <> 'system'), 0)::int,
         coalesce((select count(*) from public.chat_messages x
                    where mi.channel_id is not null and x.channel_id = c.id and x.id > greatest(mi.last_read_id, mi.cleared_before) and x.deleted_at is null
                      and (select uid from me) = any(x.mentions)), 0)::int,
         case when c.kind = 'dm' then (select string_agg(coalesce(nullif(p.full_name, ''), p.email), ', ' order by p.full_name)
                                         from public.chat_members cm join public.profiles p on p.id = cm.user_id
                                        where cm.channel_id = c.id and cm.user_id <> (select uid from me)) end,
         (select left(case when x.deleted_at is not null then '(deleted)' when x.body = '' and jsonb_array_length(x.files) > 0 then '(photo or file)' else x.body end, 140)
            from public.chat_messages x where x.channel_id = c.id and x.parent_id is null and x.id > coalesce(mi.cleared_before, 0)
           order by (x.kind <> 'system') desc, x.id desc limit 1),
         (select case when x.kind = 'text' then coalesce(nullif(p.full_name, ''), p.email) when x.kind = 'ai' then 'AMBIT Intelligence'
                      when x.kind in ('handoff', 'system') then 'Automated' end
            from public.chat_messages x left join public.profiles p on p.id = x.user_id
           where x.channel_id = c.id and x.parent_id is null and x.id > coalesce(mi.cleared_before, 0)
           order by (x.kind <> 'system') desc, x.id desc limit 1)
    from public.chat_channels c
    left join mine mi on mi.channel_id = c.id
   where public.is_employee()
     and ((c.kind = 'channel' and ((not c.private and c.archived_at is null) or mi.channel_id is not null or public.is_admin()))
          or (c.kind = 'dm' and mi.channel_id is not null and mi.hidden_at is null)
          or (c.kind = 'order' and mi.channel_id is not null))
   order by c.last_message_at desc nulls last
$fn$;

-- Check: should say 2
select count(*) as "Ready (should be 2)" from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('order_handoff_note', 'chat_overview')
   and (pg_get_functiondef(oid) like '%Thank you!%' or pg_get_functiondef(oid) like '%''Automated''%');
