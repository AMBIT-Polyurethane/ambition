-- 0117: Feedback to Jeremiah. Admins send an idea, a question, a concern or a problem from Team > Feedback.
-- It goes to one inbox (Jeremiah's). He marks where it stands and answers it; the sender sees the answer in the app
-- and gets an email. Senders see only their own; nobody else reads the inbox.
-- Run once in Supabase > SQL Editor, after the update with the Feedback screen is live. Safe to run again.

create table if not exists public.feedback_settings (
  id        int primary key default 1 check (id = 1),
  owner_id  uuid references public.profiles(id) on delete set null
);
insert into public.feedback_settings (id, owner_id)
select 1, (select u.id from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = 'jeremiah.bryant@ambitpu.com' limit 1)
on conflict (id) do nothing;
alter table public.feedback_settings enable row level security;
drop policy if exists feedback_settings_read on public.feedback_settings;
create policy feedback_settings_read on public.feedback_settings for select to authenticated using (true);

create table if not exists public.feedback (
  id             bigint generated always as identity primary key,
  kind           text not null check (kind in ('idea', 'question', 'concern', 'problem')),
  area           text,
  subject        text not null,
  body           text not null,
  by_id          uuid references public.profiles(id) on delete set null,
  by_name        text,
  status         text not null default 'new' check (status in ('new', 'reading', 'planned', 'done', 'not_now')),
  reply          text,
  reply_by_name  text,
  replied_at     timestamptz,
  seen_reply_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists feedback_by on public.feedback (by_id, created_at desc);
create index if not exists feedback_status on public.feedback (status, created_at desc);

-- The inbox owner (Jeremiah). Before an owner is set, every admin is one.
create or replace function public.feedback_owner() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() and coalesce((select owner_id = auth.uid() from public.feedback_settings where id = 1 and owner_id is not null), true)
$fn$;
revoke all on function public.feedback_owner() from public, anon;
grant execute on function public.feedback_owner() to authenticated;

alter table public.feedback enable row level security;
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated using (by_id = auth.uid() or public.feedback_owner());

-- Send one. Admins only for now.
create or replace function public.feedback_send(p_kind text, p_area text, p_subject text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare fid bigint;
begin
  if not public.is_admin() then raise exception 'Feedback is open to admins for now.'; end if;
  if p_kind is null or p_kind not in ('idea', 'question', 'concern', 'problem') then raise exception 'Pick what it is.'; end if;
  if length(trim(coalesce(p_subject, ''))) < 3 then raise exception 'Give it a short title.'; end if;
  if length(trim(coalesce(p_body, ''))) < 10 then raise exception 'Tell me a little more (what happened, where, and what you''d change).'; end if;
  insert into public.feedback (kind, area, subject, body, by_id, by_name)
  values (p_kind, nullif(left(trim(coalesce(p_area, '')), 40), ''), left(trim(p_subject), 120), left(trim(p_body), 4000), auth.uid(), coalesce(public.my_name(), 'An admin'))
  returning id into fid;
  return fid;
end $fn$;
revoke all on function public.feedback_send(text, text, text, text) from public, anon;
grant execute on function public.feedback_send(text, text, text, text) to authenticated;

-- The owner sets where it stands and (optionally) answers. An answer the sender hasn't read shows as new to them.
create or replace function public.feedback_answer(p_id bigint, p_status text, p_reply text) returns text
language plpgsql security definer set search_path = public as $fn$
declare f public.feedback; r text := nullif(left(trim(coalesce(p_reply, '')), 4000), '');
begin
  if not public.feedback_owner() then raise exception 'Only Jeremiah answers feedback.'; end if;
  if p_status is null or p_status not in ('new', 'reading', 'planned', 'done', 'not_now') then raise exception 'Pick where it stands.'; end if;
  select * into f from public.feedback where id = p_id for update;
  if f.id is null then raise exception 'That feedback is gone.'; end if;
  update public.feedback
     set status = p_status,
         reply = coalesce(r, reply),
         reply_by_name = case when r is not null then coalesce(public.my_name(), 'Jeremiah') else reply_by_name end,
         replied_at = case when r is not null and r is distinct from f.reply then now() else replied_at end,
         seen_reply_at = case when r is not null and r is distinct from f.reply then null else seen_reply_at end,
         updated_at = now()
   where id = p_id;
  return case when r is not null and r is distinct from f.reply then 'answered' else 'saved' end;
end $fn$;
revoke all on function public.feedback_answer(bigint, text, text) from public, anon;
grant execute on function public.feedback_answer(bigint, text, text) to authenticated;

-- The sender has read the answers.
create or replace function public.feedback_seen() returns void
language sql security definer set search_path = public as $fn$
  update public.feedback set seen_reply_at = now() where by_id = auth.uid() and replied_at is not null and seen_reply_at is null
$fn$;
revoke all on function public.feedback_seen() from public, anon;
grant execute on function public.feedback_seen() to authenticated;

notify pgrst, 'reload schema';

-- Check: should say 1, and the inbox owner's name.
select count(*) as "Feedback table (1)", (select p.full_name from public.feedback_settings s join public.profiles p on p.id = s.owner_id) as "Inbox owner"
from information_schema.tables where table_schema = 'public' and table_name = 'feedback';
