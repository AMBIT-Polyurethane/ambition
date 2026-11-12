-- 0064: Reorder points the app owns (with "Sold in last 60 days"), Reorder requests to purchasing (Al Rearick),
-- "Waiting on customer payment" at the credit check, and deleting a direct message (gone for the person who
-- deletes it, back when someone sends a new one, admins can restore it). Safe to run more than once.

-- ---------- Reorder points ------------------------------------------------------
-- Once a reorder point is set in the app, the app is in charge of it: the sync writes it to the sheet's
-- Reorder Point column instead of reading it from there.
alter table public.inventory add column if not exists rop_app         boolean not null default false;
alter table public.inventory add column if not exists rop_set_by_name text;
alter table public.inventory add column if not exists rop_set_at      timestamptz;

-- Admins and CRMs anywhere; a warehouse manager at their own location.
create or replace function public.can_set_rop(p_branch text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.status = 'active' and (p.role = 'admin' or (p.role = 'employee' and (p.job_role = 'crm' or (p.job_role = 'warehouse' and p.branch_id = p_branch))))
      from public.profiles p where p.id = auth.uid()), false)
$$;

-- p_items: [{"product": "<uuid>", "rop": 4}, ...] ("rop": null clears it).
create or replace function public.inventory_set_rop(p_branch text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_name text; v_n int := 0; r jsonb; v_rop numeric;
begin
  if not public.can_set_rop(p_branch) then raise exception 'Admins, CRMs and this location''s warehouse manager set reorder points.'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing to save.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  for r in select * from jsonb_array_elements(p_items) loop
    v_rop := case when coalesce(r ->> 'rop', '') = '' then null else greatest(0, round((r ->> 'rop')::numeric, 2)) end;
    update public.inventory
       set reorder_point = v_rop, rop_app = true, rop_set_by_name = v_name, rop_set_at = now(), updated_at = now()
     where branch_id = p_branch and product_id = (r ->> 'product')::uuid
       and (reorder_point is distinct from v_rop or not rop_app);
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- What each item sold at a location (orders placed in the last p_days days that weren't cancelled).
create or replace function public.sold_by_product(p_branch text, p_days int default 60)
returns table (product_id uuid, qty numeric, orders int)
language sql stable security definer set search_path = public as $$
  select i.product_id, sum(i.qty), count(distinct o.id)::int
    from public.order_items i
    join public.orders o on o.id = i.order_id
   where public.is_employee() and o.branch_id = p_branch and o.status <> 'cancelled' and i.product_id is not null
     and o.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 730)))
   group by i.product_id
$$;

-- ---------- Reorder requests (to purchasing) ------------------------------------------
create table if not exists public.reorder_requests (
  id                bigint generated always as identity primary key,
  branch_id         text not null references public.branches(id) on update cascade,
  requested_by      uuid references public.profiles(id) on delete set null,
  requested_by_name text,
  note              text,
  status            text not null default 'open' check (status in ('open', 'ordered', 'cancelled')),
  handled_by_name   text,
  handled_at        timestamptz,
  handled_note      text,
  email_status      text,
  email_error       text,
  created_at        timestamptz not null default now()
);
create index if not exists reorder_requests_open on public.reorder_requests(status, created_at desc);
create table if not exists public.reorder_request_lines (
  id            bigint generated always as identity primary key,
  request_id    bigint not null references public.reorder_requests(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  sku           text not null,
  name          text not null,
  unit          text,
  qty           numeric(12,2) not null check (qty > 0),
  on_hand       numeric(12,2),
  available     numeric(12,2),
  reorder_point numeric(12,2),
  sold_60       numeric(12,2)
);
create index if not exists reorder_request_lines_req on public.reorder_request_lines(request_id);
alter table public.reorder_requests enable row level security;
alter table public.reorder_request_lines enable row level security;
drop policy if exists reorder_requests_read on public.reorder_requests;
drop policy if exists reorder_request_lines_read on public.reorder_request_lines;
create policy reorder_requests_read on public.reorder_requests for select to authenticated using (public.is_employee());
create policy reorder_request_lines_read on public.reorder_request_lines for select to authenticated using (public.is_employee());

-- Admins and CRMs. p_lines: [{"product": "<uuid>", "qty": 4}, ...]
create or replace function public.reorder_request(p_branch text, p_note text, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id bigint; r jsonb; v_q numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or not (me.role = 'admin' or (me.role = 'employee' and me.job_role = 'crm')) then
    raise exception 'Admins and CRMs send reorder requests.';
  end if;
  if not exists (select 1 from public.branches where id = p_branch) then raise exception 'Pick a location.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Check at least one item.'; end if;
  insert into public.reorder_requests (branch_id, requested_by, requested_by_name, note)
  values (p_branch, me.id, coalesce(nullif(me.full_name, ''), me.email), nullif(left(trim(coalesce(p_note, '')), 1000), ''))
  returning id into v_id;
  for r in select * from jsonb_array_elements(p_lines) loop
    v_q := round(coalesce(nullif(r ->> 'qty', '')::numeric, 0), 2);
    if v_q <= 0 then continue; end if;
    insert into public.reorder_request_lines (request_id, product_id, sku, name, unit, qty, on_hand, available, reorder_point, sold_60)
    select v_id, p.id, coalesce(i.sku, p.sku), p.name, p.unit, v_q, i.on_hand, s.net, i.reorder_point,
           (select sb.qty from public.sold_by_product(p_branch, 60) sb where sb.product_id = p.id)
      from public.products p
      left join public.inventory i on i.product_id = p.id and i.branch_id = p_branch
      left join public.stock_for(p_branch) s on s.product_id = p.id
     where p.id = (r ->> 'product')::uuid;
  end loop;
  if not exists (select 1 from public.reorder_request_lines where request_id = v_id) then raise exception 'Enter how many to order.'; end if;
  return v_id;
end $$;

-- Admins or purchasing (the person reorder requests go to): ordered / cancelled / open again.
create or replace function public.reorder_request_set(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_buyer text;
begin
  select * into me from public.profiles where id = auth.uid();
  select coalesce(nullif((select value ->> 'email' from public.app_settings where key = 'purchasing'), ''),
                  nullif((select value ->> 'email' from public.app_settings where key = 'payroll'), ''), 'al.rearick@ambitpu.com') into v_buyer;
  if me.id is null or me.status <> 'active' or not (me.role = 'admin' or lower(me.email) = lower(v_buyer)
       or exists (select 1 from public.reorder_requests q where q.id = p_id and q.requested_by = me.id and p_status = 'cancelled')) then
    raise exception 'Only purchasing or an admin can do that.';
  end if;
  if p_status not in ('open', 'ordered', 'cancelled') then raise exception 'Unknown status.'; end if;
  update public.reorder_requests
     set status = p_status,
         handled_by_name = case when p_status = 'open' then null else coalesce(nullif(me.full_name, ''), me.email) end,
         handled_at = case when p_status = 'open' then null else now() end,
         handled_note = case when p_status = 'open' then null else nullif(left(trim(coalesce(p_note, '')), 500), '') end
   where id = p_id;
  if not found then raise exception 'Request not found.'; end if;
end $$;

create or replace function public.reorder_request_email(p_id bigint, p_status text, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.reorder_requests set email_status = left(p_status, 30), email_error = left(p_error, 500)
   where id = p_id and requested_by = auth.uid()
$$;

-- ---------- Waiting on customer payment (credit check) ------------------------------
alter table public.orders add column if not exists pay_waiting_at      timestamptz;
alter table public.orders add column if not exists pay_waiting_by_name text;

create or replace function public.order_pay_waiting(p_order uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_name text;
begin
  if not public.has_perm('credit_check') then raise exception 'Only accounting marks an order waiting on payment.'; end if;
  select * into o from public.orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  if p_on and o.stage not in ('credit', 'hold') then raise exception 'This order isn''t at the credit check.'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  update public.orders
     set pay_waiting_at = case when p_on then now() end, pay_waiting_by_name = case when p_on then v_name end
   where id = p_order;
  -- A line on the order's team chat, if it has one.
  insert into public.chat_messages (channel_id, kind, body)
  select c.id, 'system', v_name || case when p_on then ' marked this order Waiting on customer payment.' else ' took off Waiting on customer payment.' end
    from public.chat_channels c where c.order_id = p_order;
end $$;

-- Released: it's not waiting any more.
create or replace function public.orders_pay_waiting_clear() returns trigger
language plpgsql as $$
begin
  if new.credit_status = 'approved' and old.credit_status is distinct from 'approved' then
    new.pay_waiting_at := null;
    new.pay_waiting_by_name := null;
  end if;
  return new;
end $$;
drop trigger if exists orders_pay_waiting_clear on public.orders;
create trigger orders_pay_waiting_clear before update of credit_status on public.orders
  for each row execute function public.orders_pay_waiting_clear();

-- ---------- Deleting a direct message ------------------------------------------------
-- Gone for the person who deletes it (with everything in it so far). A new message brings the conversation
-- back, with only the new messages. Admins can restore it, history included.
alter table public.chat_members add column if not exists hidden_at      timestamptz;
alter table public.chat_members add column if not exists cleared_before bigint not null default 0;

create or replace function public.chat_hide(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_max bigint;
begin
  select kind into v_kind from public.chat_channels where id = p_channel;
  if v_kind is distinct from 'dm' then raise exception 'Only direct messages can be deleted.'; end if;
  select coalesce(max(id), 0) into v_max from public.chat_messages where channel_id = p_channel;
  update public.chat_members
     set hidden_at = now(), cleared_before = v_max, last_read_id = greatest(last_read_id, v_max)
   where channel_id = p_channel and user_id = auth.uid();
  if not found then raise exception 'Conversation not found.'; end if;
end $$;

-- A new message brings a deleted direct message back for everyone in it.
create or replace function public.chat_unhide_on_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.chat_members set hidden_at = null where channel_id = new.channel_id and hidden_at is not null;
  return new;
end $$;
drop trigger if exists chat_unhide_on_post on public.chat_messages;
create trigger chat_unhide_on_post after insert on public.chat_messages
  for each row when (new.kind <> 'system') execute function public.chat_unhide_on_post();

-- Admins: deleted direct messages, and restoring one.
create or replace function public.chat_hidden_list()
returns table (channel_id uuid, user_id uuid, user_name text, with_names text, hidden_at timestamptz, back boolean, hidden_count int, last_message_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.channel_id, m.user_id, coalesce(nullif(p.full_name, ''), p.email),
         (select string_agg(coalesce(nullif(q.full_name, ''), q.email), ', ' order by q.full_name)
            from public.chat_members o join public.profiles q on q.id = o.user_id
           where o.channel_id = m.channel_id and o.user_id <> m.user_id),
         m.hidden_at, m.hidden_at is null,
         (select count(*) from public.chat_messages x where x.channel_id = m.channel_id and x.id <= m.cleared_before and x.deleted_at is null and x.kind <> 'system')::int,
         c.last_message_at
    from public.chat_members m
    join public.chat_channels c on c.id = m.channel_id and c.kind = 'dm'
    join public.profiles p on p.id = m.user_id
   where public.is_admin() and m.cleared_before > 0
   order by coalesce(m.hidden_at, c.last_message_at) desc nulls last
$$;

create or replace function public.chat_restore(p_channel uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins restore deleted conversations.'; end if;
  update public.chat_members set hidden_at = null, cleared_before = 0 where channel_id = p_channel and user_id = p_user;
  if not found then raise exception 'Not found.'; end if;
end $$;

-- The conversation list: deleted direct messages stay out until someone sends a new message.
create or replace function public.chat_overview()
returns table (id uuid, kind text, name text, about text, private boolean, order_id uuid, last_message_at timestamptz, archived boolean,
               member boolean, notify text, unread int, mentions int, people text, preview text, preview_by text)
language sql stable security definer set search_path = public as $$
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
         (select case when x.kind = 'text' then coalesce(nullif(p.full_name, ''), p.email) when x.kind = 'ai' then 'AMBIT Intelligence' end
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
$$;

-- Search leaves out what you deleted.
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
     and not exists (select 1 from public.chat_members m where m.channel_id = x.channel_id and m.user_id = auth.uid() and x.id <= m.cleared_before)
     and (x.search @@ q.t or x.body ilike q.l)
   order by ts_rank(x.search, q.t) desc, x.id desc
   limit least(greatest(coalesce(p_limit, 40), 1), 100)
$$;

do $$
declare f text;
begin
  foreach f in array array['can_set_rop(text)', 'inventory_set_rop(text, jsonb)', 'sold_by_product(text, int)', 'reorder_request(text, text, jsonb)',
    'reorder_request_set(bigint, text, text)', 'reorder_request_email(bigint, text, text)', 'order_pay_waiting(uuid, boolean)', 'chat_hide(uuid)',
    'chat_hidden_list()', 'chat_restore(uuid, uuid)', 'chat_overview()', 'chat_search(text, int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Check: should say 4 (reorder points, reorder requests, waiting on payment, deleting messages).
select (select count(*) from information_schema.columns where table_schema = 'public'
         and ((table_name = 'inventory' and column_name = 'rop_app') or (table_name = 'orders' and column_name = 'pay_waiting_at')
              or (table_name = 'chat_members' and column_name = 'cleared_before')))
     + (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'reorder_requests')
       as "Ready (should be 4)";
