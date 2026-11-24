-- 0110: Chat groups and order notes that tag the right people.
--  * Groups you can @tag as one: @Orders Group (Javier, Kim, Lynn, Aalyah and everyone set up as a CRM), @Admins (every
--    admin) and @Credit Team. A group shows as one tag; everyone in it gets the notification and the to-do.
--    Admins change who is in a group on Chat > Groups.
--  * The automatic order notes use them: new order, scheduling and invoice updates -> @Orders Group; credit check ->
--    @Credit Team; ready to load -> only the warehouse manager for that order's location (no manager set there:
--    @Orders Group).
-- Safe to run again.

create table if not exists public.chat_groups (
  key             text primary key,
  name            text not null unique,
  rule            text not null default 'list' check (rule in ('list', 'orders', 'admins')),
  members         uuid[] not null default '{}',
  sort            int not null default 0,
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
alter table public.chat_groups enable row level security;
drop policy if exists chat_groups_read on public.chat_groups;
create policy chat_groups_read on public.chat_groups for select to authenticated using (public.is_employee());

insert into public.chat_groups (key, name, rule, members, sort) values
  ('orders', 'Orders Group', 'orders',
   array(select id from public.profiles where status = 'active' and full_name in ('Javier Rico', 'Kim Hight', 'Lynn Akid', 'Aalyah Padilla')), 1),
  ('admins', 'Admins', 'admins', '{}', 2),
  -- Credit Team starts as the three people the credit notes tag today; change it on Chat > Groups.
  ('credit', 'Credit Team', 'list',
   array(select id from public.profiles where status = 'active' and full_name in ('Javier Rico', 'Jeremiah Bryant', 'Lynn Akid')), 3)
on conflict (key) do nothing;

-- Who is in a group right now: its list, plus every CRM (Orders Group) or every admin (Admins).
create or replace function public.chat_group_members(p_key text) returns uuid[]
language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg(distinct p.id), '{}')
    from public.chat_groups g
    join public.profiles p on p.status = 'active' and p.role in ('employee', 'admin') and coalesce(p.demo, false) = false
     and (p.id = any(g.members) or (g.rule = 'orders' and p.job_role = 'crm') or (g.rule = 'admins' and p.role = 'admin'))
   where g.key = p_key
$fn$;
revoke all on function public.chat_group_members(text) from public, anon;
grant execute on function public.chat_group_members(text) to authenticated;

create or replace function public.chat_groups_list() returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'rule', g.rule, 'listed', g.members,
                                               'members', public.chat_group_members(g.key)) order by g.sort, g.name), '[]'::jsonb)
    from public.chat_groups g
   where public.is_employee()
$fn$;
revoke all on function public.chat_groups_list() from public, anon;
grant execute on function public.chat_groups_list() to authenticated;

-- Admins: who is listed in a group (CRMs / admins join their groups on their own).
create or replace function public.chat_group_set(p_key text, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then raise exception 'Only admins change chat groups.'; end if;
  update public.chat_groups set members = coalesce(p_members, '{}'), updated_by_name = public.my_name(), updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown group.'; end if;
end $fn$;
revoke all on function public.chat_group_set(text, uuid[]) from public, anon;
grant execute on function public.chat_group_set(text, uuid[]) to authenticated;

-- The automatic notes in each order's chat (0093's wording), now tagging groups and the location's warehouse manager.
create or replace function public.order_handoff_note(o public.orders, p_old text) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_chan uuid;
  v_msg bigint;
  v_people uuid[] := '{}';
  v_groups text[] := '{}';
  v_all uuid[] := '{}';
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
    v_groups := array['orders'];
    v_text := case when p_old = 'customer' then 'The customer approved this order.' else 'A new order just came in.' end;
    v_ask := 'when you get a chance, please enter the Sales Order #, Invoice # and prices.';
    v_todo := 'Enter the Sales Order #, Invoice # and prices';
  elsif o.stage = 'credit' then
    v_groups := array['credit'];
    v_text := case when p_old = 'invoice_update' then 'The invoice has been updated.'
                   when nullif(trim(o.ambit_po), '') is not null then 'Sales Order # ' || trim(o.ambit_po) || ' has been entered.'
                   else 'The Sales Order # has been entered.' end;
    v_ask := 'could you please check credit and release it when you have a moment?';
    v_todo := 'Check credit and release';
  elsif o.stage = 'schedule' then
    v_groups := array['orders'];
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
    v_groups := array['orders'];
    v_people := coalesce(array[o.sales_rep_id], '{}');
    v_note := rtrim(nullif(trim(o.credit_note), ''), '.!? ');
    v_text := 'This order is on credit hold' || coalesce(': ' || v_note, '') || '.';
    v_ask := 'could you please reach out to the customer?';
    v_todo := 'Talk to the customer';
  elsif o.stage = 'scheduled' and p_old is distinct from 'scheduled' then
    if o.delivery_method = 'dropship' then
      v_groups := array['orders'];
      v_text := 'This order ships from the supplier' || coalesce(case when v_when in ('today', 'tomorrow') then ' ' else ' on ' end || v_when, '') || '.';
      v_ask := 'could you please keep an eye on it and make sure it ships?';
      v_todo := 'Make sure it ships';
    else
      -- Only the warehouse manager at this order's location.
      v_people := array(select p.id from public.profiles p
                         where p.status = 'active' and p.role in ('employee', 'admin') and coalesce(p.demo, false) = false
                           and p.job_role = 'warehouse' and o.branch_id is not null and p.branch_id = o.branch_id);
      if coalesce(cardinality(v_people), 0) = 0 then v_groups := array['orders']; end if;
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
    v_groups := array['orders'];
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

  -- A group nobody is in yet: tag @Admins instead, so the note never goes to no one.
  if cardinality(v_groups) > 0 and not exists (select 1 from unnest(v_groups) k where cardinality(public.chat_group_members(k)) > 0) then
    v_groups := array['admins'];
  end if;
  -- People tagged by name: real, active staff.
  select coalesce(array_agg(distinct p.id), '{}') into v_people from public.profiles p
   where p.id = any(coalesce(v_people, '{}')) and p.status = 'active' and p.role in ('employee', 'admin');
  -- The tags: each group once ("@Orders Group"), then each person.
  select string_agg(t, ' ') into v_tags from (
    select '@' || g.name as t from public.chat_groups g where g.key = any(v_groups)
    union all
    select '@' || coalesce(p.full_name, p.email) from public.profiles p where p.id = any(v_people) and p.id is distinct from auth.uid()
  ) x;
  -- Everyone notified: the people, and everyone in the groups, but not the person who just did it.
  select coalesce(array_agg(distinct u), '{}') into v_all from (
    select unnest(v_people) as u
    union all
    select unnest(public.chat_group_members(k)) from unnest(v_groups) k
  ) z where u is distinct from auth.uid();

  select id into v_chan from public.chat_channels where order_id = o.id;
  if v_chan is null then
    insert into public.chat_channels (kind, name, order_id, created_by)
    values ('order', v_ref, o.id, auth.uid()) on conflict (order_id) do nothing returning id into v_chan;
    if v_chan is null then select id into v_chan from public.chat_channels where order_id = o.id; end if;
  end if;
  if v_chan is null then return; end if;

  update public.chat_todos t set done_at = now()
   where t.done_at is null and t.source = 'handoff' and t.channel_id = v_chan;

  insert into public.chat_messages (channel_id, user_id, body, mentions, kind)
  values (v_chan, auth.uid(), v_text || case when v_tags is not null and v_ask is not null then ' ' || v_tags || ', ' || v_ask || ' Thank you!' else '' end, v_all, 'handoff')
  returning id into v_msg;
  update public.chat_channels set last_message_at = now() where id = v_chan;

  if coalesce(array_length(v_all, 1), 0) > 0 and v_todo is not null then
    insert into public.chat_members (channel_id, user_id, notify)
    select v_chan, x, 'all' from unnest(v_all) x on conflict do nothing;
    insert into public.chat_todos (user_id, text, channel_id, message_id, from_name, created_by, source)
    select x, left('ORD-' || o.order_no || ' ' || coalesce(o.company_name, '') || ': ' || v_todo, 200), v_chan, v_msg, 'AMBIT', auth.uid(), 'handoff'
      from unnest(v_all) x;
  end if;
end $fn$;
revoke all on function public.order_handoff_note(public.orders, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Check: who is in each group.
select g.name as "Group", (select string_agg(coalesce(p.full_name, p.email), ', ' order by p.full_name) from public.profiles p where p.id = any(public.chat_group_members(g.key))) as "Members"
  from public.chat_groups g order by g.sort;
