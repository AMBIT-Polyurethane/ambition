-- 0063: Team Chat, phone notifications, personal card purchases, holiday settings.
--
--  * Chat (AMBIT employees only): channels admins make for a job or a team, direct messages (one person or a few),
--    and one conversation board per order. Threads, @mentions, reactions, pins, photos and files, unread counts,
--    search, and a to-do list: when someone is @mentioned, a to-do is made for them (Home > My to-dos).
--  * Phone notifications (web push): each phone or computer that turns them on is saved here. The server makes and
--    keeps its own keys (app_secrets, which only the server can read).
--  * A card charge that was a personal purchase: the employee marks it, payroll (Al Rearick) is told to take it out of
--    their next paycheck, and marks it withheld.
--  * Settings (app_settings): payroll contact, holiday touches and the days AMBIT is closed.
-- Safe to run more than once.

-- ---------- Settings ---------------------------------------------------------
create table if not exists public.app_settings (
  key             text primary key,
  value           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read  on public.app_settings;
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_read  on public.app_settings for select to authenticated using (public.is_active());
create policy app_settings_admin on public.app_settings for all    to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.app_settings (key, value) values
  ('payroll',  '{"name": "Al Rearick", "email": "al.rearick@ambitpu.com"}'),
  ('holidays', '{"touches": true, "closed": ["new-years-day", "memorial-day", "july-4", "labor-day", "thanksgiving", "black-friday", "christmas-eve", "christmas"], "extra": []}')
on conflict (key) do nothing;

-- Only the server (its secret key) can read these. Nobody signed in can.
create table if not exists public.app_secrets (
  key        text primary key,
  value      jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- ---------- Phone notifications ---------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  device      text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fails       int not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active());

-- ---------- Chat ---------------------------------------------------------------
create table if not exists public.chat_channels (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'channel' check (kind in ('channel', 'dm', 'order')),
  name            text not null default '',
  about           text,
  private         boolean not null default false,
  order_id        uuid unique references public.orders(id) on delete cascade,
  dm_key          text unique,                      -- a direct message: its people's ids, sorted
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  archived_at     timestamptz
);
create table if not exists public.chat_members (
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  notify       text not null default 'all' check (notify in ('all', 'mentions', 'none')),
  last_read_id bigint not null default 0,
  joined_at    timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists chat_members_user on public.chat_members(user_id);
create table if not exists public.chat_messages (
  id             bigint generated always as identity primary key,
  channel_id     uuid not null references public.chat_channels(id) on delete cascade,
  user_id        uuid references public.profiles(id) on delete set null,
  parent_id      bigint references public.chat_messages(id) on delete cascade,
  body           text not null default '',
  mentions       uuid[] not null default '{}',
  files          jsonb not null default '[]'::jsonb,       -- [{path, name, type, size}] in chat-files
  kind           text not null default 'text' check (kind in ('text', 'system', 'ai')),
  reply_count    int not null default 0,
  last_reply_at  timestamptz,
  pinned_at      timestamptz,
  pinned_by_name text,
  edited_at      timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  search         tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored
);
create index if not exists chat_messages_channel on public.chat_messages(channel_id, id desc);
create index if not exists chat_messages_parent  on public.chat_messages(parent_id) where parent_id is not null;
create index if not exists chat_messages_search  on public.chat_messages using gin(search);
create index if not exists chat_messages_mentions on public.chat_messages using gin(mentions);
create table if not exists public.chat_reactions (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create table if not exists public.chat_todos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  text        text not null,
  due_on      date,
  channel_id  uuid references public.chat_channels(id) on delete set null,
  message_id  bigint references public.chat_messages(id) on delete set null,
  from_name   text,
  created_by  uuid references public.profiles(id) on delete set null,
  source      text not null default 'mention' check (source in ('mention', 'manual', 'ai')),
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists chat_todos_user on public.chat_todos(user_id) where done_at is null;

-- Who can see a conversation: open channels and order boards, every employee; private channels, their members and
-- admins; direct messages, only the people in them.
create or replace function public.chat_can_see(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_employee() and exists (
    select 1 from public.chat_channels c
     where c.id = p_channel
       and ((c.kind = 'channel' and (not c.private or public.is_admin()))
            or c.kind = 'order'
            or exists (select 1 from public.chat_members m where m.channel_id = c.id and m.user_id = auth.uid())))
$$;
revoke all on function public.chat_can_see(uuid) from public, anon;
grant execute on function public.chat_can_see(uuid) to authenticated;

alter table public.chat_channels  enable row level security;
alter table public.chat_members   enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_todos     enable row level security;
drop policy if exists chat_channels_read  on public.chat_channels;
drop policy if exists chat_members_read   on public.chat_members;
drop policy if exists chat_messages_read  on public.chat_messages;
drop policy if exists chat_reactions_read on public.chat_reactions;
drop policy if exists chat_todos_read     on public.chat_todos;
drop policy if exists chat_todos_own      on public.chat_todos;
create policy chat_channels_read  on public.chat_channels  for select to authenticated using (public.chat_can_see(id));
create policy chat_members_read   on public.chat_members   for select to authenticated using (public.chat_can_see(channel_id));
create policy chat_messages_read  on public.chat_messages  for select to authenticated using (public.chat_can_see(channel_id));
create policy chat_reactions_read on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_can_see(m.channel_id)));
create policy chat_todos_read on public.chat_todos for select to authenticated using (user_id = auth.uid() or created_by = auth.uid());
create policy chat_todos_own  on public.chat_todos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.chat_channels, public.chat_members, public.chat_messages, public.chat_reactions from anon, authenticated;
revoke insert, delete on public.chat_todos from anon, authenticated;
grant select on public.chat_channels, public.chat_members, public.chat_messages, public.chat_reactions, public.chat_todos to authenticated;
grant update (done_at, text, due_on) on public.chat_todos to authenticated;

-- Live updates (Supabase Realtime) for new messages and reactions.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.chat_reactions; exception when duplicate_object then null; end;
  end if;
end $$;

-- Photos and files in chat: private, under the conversation's id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
drop policy if exists chat_files_read   on storage.objects;
drop policy if exists chat_files_insert on storage.objects;
-- The first folder is the conversation's id (checked before it's read as one, so other buckets are never affected).
create or replace function public.chat_file_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.chat_can_see(f::uuid);
end $$;
revoke all on function public.chat_file_ok(text) from public, anon;
grant execute on function public.chat_file_ok(text) to authenticated;
create policy chat_files_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and public.chat_file_ok(name));
create policy chat_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and public.chat_file_ok(name));

-- ----- Making conversations -----
create or replace function public.chat_add_members(p_channel uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- Channels: hear about @mentions (and see unread counts); direct messages and order boards: everything.
  insert into public.chat_members (channel_id, user_id, notify)
  select p_channel, p.id, case when (select kind from public.chat_channels where id = p_channel) = 'channel' then 'mentions' else 'all' end
    from public.profiles p
   where p.id = any(coalesce(p_users, '{}')) and p.role in ('employee', 'admin') and p.status = 'active'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.chat_add_members(uuid, uuid[]) from public, anon, authenticated;

-- Admins: a channel (a group) for a job or a team.
create or replace function public.chat_create_channel(p_name text, p_about text, p_private boolean, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := left(trim(coalesce(p_name, '')), 60);
begin
  if not public.is_admin() then raise exception 'Only admins can make channels.'; end if;
  if v_name = '' then raise exception 'Give the channel a name.'; end if;
  if exists (select 1 from public.chat_channels where kind = 'channel' and lower(name) = lower(v_name) and archived_at is null) then
    raise exception 'There''s already a channel called %.', v_name;
  end if;
  insert into public.chat_channels (kind, name, about, private, created_by)
  values ('channel', v_name, nullif(left(trim(coalesce(p_about, '')), 300), ''), coalesce(p_private, false), auth.uid())
  returning id into v_id;
  perform public.chat_add_members(v_id, array_append(coalesce(p_members, '{}'), auth.uid()));
  insert into public.chat_messages (channel_id, user_id, kind, body) values (v_id, auth.uid(), 'system', public.my_name() || ' made this channel.');
  update public.chat_channels set last_message_at = now() where id = v_id;
  return v_id;
end $$;

create or replace function public.chat_update_channel(p_id uuid, p_name text, p_about text, p_private boolean, p_archive boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change channels.'; end if;
  update public.chat_channels
     set name = coalesce(nullif(left(trim(coalesce(p_name, '')), 60), ''), name),
         about = case when p_about is null then about else nullif(left(trim(p_about), 300), '') end,
         private = coalesce(p_private, private),
         archived_at = case when p_archive is null then archived_at when p_archive then coalesce(archived_at, now()) else null end
   where id = p_id and kind = 'channel';
end $$;

-- Admins add or take people off a channel; anyone in a direct message can add people to it.
create or replace function public.chat_set_members(p_id uuid, p_add uuid[], p_remove uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare c public.chat_channels; v_names text;
begin
  select * into c from public.chat_channels where id = p_id;
  if c.id is null then raise exception 'Conversation not found.'; end if;
  if not (public.is_admin() or (c.kind = 'dm' and exists (select 1 from public.chat_members where channel_id = p_id and user_id = auth.uid()))) then
    raise exception 'Only admins can change who''s in a channel.';
  end if;
  if c.kind = 'dm' and coalesce(cardinality(p_remove), 0) > 0 and not public.is_admin() then raise exception 'People leave a direct message themselves.'; end if;
  perform public.chat_add_members(p_id, p_add);
  delete from public.chat_members where channel_id = p_id and user_id = any(coalesce(p_remove, '{}'));
  select string_agg(coalesce(nullif(full_name, ''), email), ', ') into v_names from public.profiles where id = any(coalesce(p_add, '{}'));
  if v_names is not null then
    insert into public.chat_messages (channel_id, user_id, kind, body) values (p_id, auth.uid(), 'system', public.my_name() || ' added ' || v_names || '.');
  end if;
  if c.kind = 'dm' then update public.chat_channels set dm_key = null where id = p_id; end if;  -- a group now, not the 1:1
end $$;

-- A direct message with one person or a few (the same people always get the same conversation).
create or replace function public.chat_dm(p_users uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_key text; v_id uuid;
begin
  if not public.is_employee() then raise exception 'Chat is for AMBIT employees.'; end if;
  select array_agg(distinct x order by x) into v_ids
    from unnest(array_append(coalesce(p_users, '{}'), auth.uid())) x
   where exists (select 1 from public.profiles p where p.id = x and p.role in ('employee', 'admin') and p.status = 'active');
  if coalesce(cardinality(v_ids), 0) < 2 then raise exception 'Pick who to message.'; end if;
  v_key := array_to_string(v_ids, ',');
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, dm_key, created_by) values ('dm', v_key, auth.uid()) returning id into v_id;
    perform public.chat_add_members(v_id, v_ids);
  end if;
  return v_id;
end $$;

-- The team's conversation board for one order (made the first time someone opens it).
create or replace function public.chat_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; o public.orders;
begin
  if not public.is_employee() then raise exception 'Order boards are for AMBIT employees.'; end if;
  select id into v_id from public.chat_channels where order_id = p_order;
  if v_id is not null then return v_id; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  insert into public.chat_channels (kind, name, order_id, created_by)
  values ('order', 'ORD-' || o.order_no || ' · ' || o.company_name, p_order, auth.uid())
  on conflict (order_id) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.chat_channels where order_id = p_order; end if;
  return v_id;
end $$;

create or replace function public.chat_join(p_channel uuid, p_join boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare c public.chat_channels;
begin
  select * into c from public.chat_channels where id = p_channel;
  if c.id is null or not public.chat_can_see(p_channel) then raise exception 'Conversation not found.'; end if;
  if p_join then
    if c.kind = 'channel' and c.private and not public.is_admin() then raise exception 'Ask an admin to add you to this channel.'; end if;
    insert into public.chat_members (channel_id, user_id, last_read_id, notify)
    values (p_channel, auth.uid(), coalesce((select max(id) from public.chat_messages where channel_id = p_channel), 0),
            case when c.kind = 'channel' then 'mentions' else 'all' end)
    on conflict do nothing;
  else
    delete from public.chat_members where channel_id = p_channel and user_id = auth.uid();
  end if;
end $$;

-- ----- Messages -----
-- Post a message (or a reply in a thread). p_mentions: the people @mentioned (who get a to-do and a notification).
create or replace function public.chat_post(p_channel uuid, p_body text, p_parent bigint default null, p_files jsonb default '[]'::jsonb, p_mentions uuid[] default '{}', p_kind text default 'text')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c public.chat_channels;
  v_id bigint;
  v_body text := left(coalesce(p_body, ''), 8000);
  v_files jsonb := case when jsonb_typeof(p_files) = 'array' then p_files else '[]'::jsonb end;
  v_m uuid[];
begin
  select * into c from public.chat_channels where id = p_channel;
  if c.id is null or not public.chat_can_see(p_channel) then raise exception 'Conversation not found.'; end if;
  if c.archived_at is not null then raise exception 'This channel is archived.'; end if;
  if trim(v_body) = '' and jsonb_array_length(v_files) = 0 then raise exception 'Type a message.'; end if;
  if exists (select 1 from jsonb_array_elements(v_files) f where coalesce(f ->> 'path', '') not like p_channel::text || '/%') then
    raise exception 'One of the files isn''t from this conversation.';
  end if;
  if p_parent is not null and not exists (select 1 from public.chat_messages where id = p_parent and channel_id = p_channel and parent_id is null) then
    raise exception 'That thread isn''t in this conversation.';
  end if;
  -- Mentions: employees who can be in this conversation (private ones: only its people).
  select coalesce(array_agg(distinct p.id), '{}') into v_m from public.profiles p
   where p.id = any(coalesce(p_mentions, '{}')) and p.role in ('employee', 'admin') and p.status = 'active'
     and (c.kind in ('channel', 'order') and not c.private
          or exists (select 1 from public.chat_members m where m.channel_id = p_channel and m.user_id = p.id));
  insert into public.chat_messages (channel_id, user_id, parent_id, body, files, mentions, kind)
  values (p_channel, auth.uid(), p_parent, v_body, v_files, v_m, case when p_kind = 'ai' then 'ai' else 'text' end)
  returning id into v_id;
  update public.chat_channels set last_message_at = now() where id = p_channel;
  if p_parent is not null then
    update public.chat_messages set reply_count = reply_count + 1, last_reply_at = now() where id = p_parent;
  end if;
  -- Whoever posts (or is mentioned) on an open channel or an order board is in it from now on.
  if c.kind in ('channel', 'order') and not c.private then
    insert into public.chat_members (channel_id, user_id, last_read_id, notify)
    values (p_channel, auth.uid(), v_id, case when c.kind = 'channel' then 'mentions' else 'all' end) on conflict do nothing;
    insert into public.chat_members (channel_id, user_id, notify)
    select p_channel, x, case when c.kind = 'channel' then 'mentions' else 'all' end from unnest(v_m) x on conflict do nothing;
  end if;
  update public.chat_members set last_read_id = greatest(last_read_id, v_id) where channel_id = p_channel and user_id = auth.uid();
  return v_id;
end $$;

create or replace function public.chat_edit(p_id bigint, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if trim(coalesce(p_body, '')) = '' then raise exception 'Type a message (or delete it).'; end if;
  update public.chat_messages set body = left(p_body, 8000), edited_at = now()
   where id = p_id and user_id = auth.uid() and deleted_at is null and kind <> 'system';
  if not found then raise exception 'You can only change your own messages.'; end if;
end $$;

create or replace function public.chat_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.chat_messages set deleted_at = now(), body = '', files = '[]'::jsonb, pinned_at = null
   where id = p_id and deleted_at is null and (user_id = auth.uid() or (public.is_admin() and public.chat_can_see(channel_id)));
  if not found then raise exception 'You can only delete your own messages.'; end if;
end $$;

create or replace function public.chat_pin(p_id bigint, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id;
  if m.id is null or not public.chat_can_see(m.channel_id) then raise exception 'Message not found.'; end if;
  update public.chat_messages set pinned_at = case when p_on then now() end, pinned_by_name = case when p_on then public.my_name() end where id = p_id;
end $$;

create or replace function public.chat_react(p_id bigint, p_emoji text) returns boolean
language plpgsql security definer set search_path = public as $$
declare m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id;
  if m.id is null or not public.chat_can_see(m.channel_id) then raise exception 'Message not found.'; end if;
  delete from public.chat_reactions where message_id = p_id and user_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into public.chat_reactions (message_id, user_id, emoji) values (p_id, auth.uid(), left(p_emoji, 16));
  return true;
end $$;

create or replace function public.chat_read(p_channel uuid, p_upto bigint) returns void
language sql security definer set search_path = public as $$
  update public.chat_members set last_read_id = greatest(last_read_id, coalesce(p_upto, 0))
   where channel_id = p_channel and user_id = auth.uid()
$$;

create or replace function public.chat_set_notify(p_channel uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('all', 'mentions', 'none') then raise exception 'Pick all, mentions or none.'; end if;
  update public.chat_members set notify = p_mode where channel_id = p_channel and user_id = auth.uid();
  if not found then raise exception 'Join the conversation first.'; end if;
end $$;

-- To-dos for the people @mentioned in a message (only the message's author makes them).
create or replace function public.chat_add_todos(p_message bigint, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare m public.chat_messages; it jsonb; n int := 0;
begin
  select * into m from public.chat_messages where id = p_message;
  if m.id is null or m.user_id is distinct from auth.uid() then raise exception 'Only the message''s author can make its to-dos.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(it ->> 'user_id', '') is null or not ((it ->> 'user_id')::uuid = any(m.mentions) or (it ->> 'user_id')::uuid = auth.uid()) then continue; end if;
    if trim(coalesce(it ->> 'text', '')) = '' then continue; end if;
    insert into public.chat_todos (user_id, text, due_on, channel_id, message_id, from_name, created_by, source)
    values ((it ->> 'user_id')::uuid, left(trim(it ->> 'text'), 300), nullif(it ->> 'due_on', '')::date, m.channel_id, m.id, public.my_name(), auth.uid(),
            case when (it ->> 'user_id')::uuid = auth.uid() and not ((it ->> 'user_id')::uuid = any(m.mentions)) then 'manual' else 'mention' end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A to-do of your own (from any message you can see, or none).
create or replace function public.chat_todo_add(p_text text, p_due date default null, p_message bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare m public.chat_messages; v_id bigint;
begin
  if not public.is_employee() then raise exception 'To-dos are for AMBIT employees.'; end if;
  if trim(coalesce(p_text, '')) = '' then raise exception 'Type the to-do.'; end if;
  if p_message is not null then
    select * into m from public.chat_messages where id = p_message;
    if m.id is null or not public.chat_can_see(m.channel_id) then raise exception 'Message not found.'; end if;
  end if;
  insert into public.chat_todos (user_id, text, due_on, channel_id, message_id, from_name, created_by, source)
  values (auth.uid(), left(trim(p_text), 300), p_due, m.channel_id, m.id,
          (select coalesce(nullif(full_name, ''), email) from public.profiles where id = m.user_id), auth.uid(), 'manual')
  returning id into v_id;
  return v_id;
end $$;

-- ----- Lists -----
-- Every conversation this person is in (plus open channels they can join), newest first, with unread counts.
create or replace function public.chat_overview()
returns table (id uuid, kind text, name text, about text, private boolean, order_id uuid, last_message_at timestamptz, archived boolean,
               member boolean, notify text, unread int, mentions int, people text, preview text, preview_by text)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid),
  mine as (select m.* from public.chat_members m, me where m.user_id = me.uid)
  select c.id, c.kind, c.name, c.about, c.private, c.order_id, c.last_message_at, c.archived_at is not null,
         mi.channel_id is not null, coalesce(mi.notify, 'all'),
         coalesce((select count(*) from public.chat_messages x
                    where mi.channel_id is not null and x.channel_id = c.id and x.id > mi.last_read_id and x.parent_id is null
                      and x.deleted_at is null and x.user_id is distinct from (select uid from me) and x.kind <> 'system'), 0)::int,
         coalesce((select count(*) from public.chat_messages x
                    where mi.channel_id is not null and x.channel_id = c.id and x.id > mi.last_read_id and x.deleted_at is null
                      and (select uid from me) = any(x.mentions)), 0)::int,
         case when c.kind = 'dm' then (select string_agg(coalesce(nullif(p.full_name, ''), p.email), ', ' order by p.full_name)
                                         from public.chat_members cm join public.profiles p on p.id = cm.user_id
                                        where cm.channel_id = c.id and cm.user_id <> (select uid from me)) end,
         (select left(case when x.deleted_at is not null then '(deleted)' when x.body = '' and jsonb_array_length(x.files) > 0 then '(photo or file)' else x.body end, 140)
            from public.chat_messages x where x.channel_id = c.id and x.parent_id is null order by (x.kind <> 'system') desc, x.id desc limit 1),
         (select case when x.kind = 'text' then coalesce(nullif(p.full_name, ''), p.email) when x.kind = 'ai' then 'AMBIT Intelligence' end
            from public.chat_messages x left join public.profiles p on p.id = x.user_id
           where x.channel_id = c.id and x.parent_id is null order by (x.kind <> 'system') desc, x.id desc limit 1)
    from public.chat_channels c
    left join mine mi on mi.channel_id = c.id
   where public.is_employee()
     and ((c.kind = 'channel' and ((not c.private and c.archived_at is null) or mi.channel_id is not null or public.is_admin()))
          or (c.kind in ('dm', 'order') and mi.channel_id is not null))
   order by c.last_message_at desc nulls last
$$;
revoke all on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated;

-- The badge: unread messages in conversations you hear from, plus anything you're @mentioned in.
create or replace function public.chat_unread_total() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(
           (select count(*) from public.chat_messages x
             where x.channel_id = m.channel_id and x.id > m.last_read_id and x.deleted_at is null and x.parent_id is null and x.kind <> 'system'
               and x.user_id is distinct from auth.uid()
               and (m.notify = 'all' or c.kind = 'dm' or auth.uid() = any(x.mentions)))), 0)::int
    from public.chat_members m join public.chat_channels c on c.id = m.channel_id
   where m.user_id = auth.uid() and m.notify <> 'none' and c.archived_at is null
$$;
revoke all on function public.chat_unread_total() from public, anon;
grant execute on function public.chat_unread_total() to authenticated;

-- Search everything this person can see in chat.
create or replace function public.chat_search(p_q text, p_limit int default 40)
returns table (id bigint, channel_id uuid, channel text, kind text, parent_id bigint, body text, created_at timestamptz, by_name text, rank real)
language sql stable security definer set search_path = public as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_q, '')) as t,
                    '%' || replace(replace(left(trim(coalesce(p_q, '')), 60), '%', ''), '_', '') || '%' as l)
  select x.id, x.channel_id,
         case when c.kind = 'dm' then 'Direct message' else c.name end, c.kind, x.parent_id, left(x.body, 600), x.created_at,
         coalesce(nullif(p.full_name, ''), p.email), ts_rank(x.search, q.t)
    from public.chat_messages x
    join public.chat_channels c on c.id = x.channel_id
    left join public.profiles p on p.id = x.user_id
    cross join q
   where x.deleted_at is null and x.kind <> 'system' and public.chat_can_see(x.channel_id)
     and (x.search @@ q.t or x.body ilike q.l)
   order by ts_rank(x.search, q.t) desc, x.id desc
   limit least(greatest(coalesce(p_limit, 40), 1), 100)
$$;
revoke all on function public.chat_search(text, int) from public, anon;
grant execute on function public.chat_search(text, int) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['chat_create_channel(text, text, boolean, uuid[])', 'chat_update_channel(uuid, text, text, boolean, boolean)',
    'chat_set_members(uuid, uuid[], uuid[])', 'chat_dm(uuid[])', 'chat_order(uuid)', 'chat_join(uuid, boolean)',
    'chat_post(uuid, text, bigint, jsonb, uuid[], text)', 'chat_edit(bigint, text)', 'chat_delete(bigint)', 'chat_pin(bigint, boolean)',
    'chat_react(bigint, text)', 'chat_read(uuid, bigint)', 'chat_set_notify(uuid, text)', 'chat_add_todos(bigint, jsonb)',
    'chat_todo_add(text, date, bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- A first channel everyone's in.
insert into public.chat_channels (kind, name, about)
select 'channel', 'AMBIT Team', 'Company-wide news and quick questions. Everyone at AMBIT is here.'
 where not exists (select 1 from public.chat_channels where kind = 'channel' and name = 'AMBIT Team');
insert into public.chat_members (channel_id, user_id, notify)
select c.id, p.id, 'mentions' from public.chat_channels c, public.profiles p
 where c.kind = 'channel' and c.name = 'AMBIT Team' and p.role in ('employee', 'admin') and p.status = 'active'
on conflict do nothing;

-- ---------- Personal purchases on an AMBIT card ------------------------------
alter table public.expense_charges add column if not exists personal_repay         boolean not null default false;
alter table public.expense_charges add column if not exists repay_status           text;
alter table public.expense_charges add column if not exists repay_note             text;
alter table public.expense_charges add column if not exists repay_marked_at        timestamptz;
alter table public.expense_charges add column if not exists repay_withheld_at      timestamptz;
alter table public.expense_charges add column if not exists repay_withheld_by_name text;
do $$ begin
  alter table public.expense_charges add constraint expense_charges_repay_status check (repay_status is null or repay_status in ('waiting', 'withheld'));
exception when duplicate_object then null; end $$;

-- The employee whose card it is (or an approver): "this was mine, take it out of my paycheck". p_on false = undo.
create or replace function public.expense_mark_personal(p_charge uuid, p_note text, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare c public.expense_charges;
begin
  select * into c from public.expense_charges where id = p_charge and not removed;
  if c.id is null then raise exception 'That card charge wasn''t found.'; end if;
  if c.user_id is distinct from auth.uid() and not public.is_expense_approver() then raise exception 'You can only mark your own card charges.'; end if;
  if c.kind <> 'purchase' then raise exception 'Only purchases can be marked personal.'; end if;
  perform public.expense_check_month(c.user_id, c.txn_date);
  if p_on then
    if c.receipt_id is not null then raise exception 'This charge has a receipt on it. Take the receipt off first.'; end if;
    update public.expense_charges
       set personal_repay = true, repay_status = 'waiting', repay_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
           repay_marked_at = now(), excused_note = 'Personal purchase: paid back to AMBIT from payroll',
           category = 'Personal (paid back)', updated_at = now()
     where id = p_charge;
  else
    if c.repay_status = 'withheld' then raise exception 'Payroll already took this out of a paycheck. Ask Accounting.'; end if;
    update public.expense_charges
       set personal_repay = false, repay_status = null, repay_note = null, repay_marked_at = null,
           excused_note = null, category = null, updated_at = now()
     where id = p_charge and personal_repay;
  end if;
end $$;
revoke all on function public.expense_mark_personal(uuid, text, boolean) from public, anon;
grant execute on function public.expense_mark_personal(uuid, text, boolean) to authenticated;

-- Payroll (the payroll contact in settings), expense approvers or admins: it came out of their paycheck.
create or replace function public.expense_repay_withheld(p_charge uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare pay text := lower((select value ->> 'email' from public.app_settings where key = 'payroll'));
begin
  if not (public.is_admin() or public.is_expense_approver() or lower((select email from public.profiles where id = auth.uid())) = pay) then
    raise exception 'Only payroll, expense approvers or admins can mark this.';
  end if;
  update public.expense_charges
     set repay_status = case when p_on then 'withheld' else 'waiting' end,
         repay_withheld_at = case when p_on then now() end, repay_withheld_by_name = case when p_on then public.my_name() end, updated_at = now()
   where id = p_charge and personal_repay;
end $$;
revoke all on function public.expense_repay_withheld(uuid, boolean) from public, anon;
grant execute on function public.expense_repay_withheld(uuid, boolean) to authenticated;

-- Check: should say 3 (chat, settings, personal purchases).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('chat_messages', 'app_settings'))
     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'expense_charges' and column_name = 'personal_repay')
       as "Ready (should be 3)";
