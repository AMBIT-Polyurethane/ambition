-- =====================================================================
-- AMBIT Intelligence update 0020 - Ask AMBIT (the AI assistant)
-- * Knowledge it may use: Jeremiah's TSBs and teaching, AMBIT product docs, and code / HVAC /
--   science references an admin adds. Each piece is a "source", split into searchable chunks.
--   The SPFA library is never added.
-- * Conversations, feedback, daily limits, cost tracking, and the "Send to AMBIT's expert" inbox.
-- * Staff only at first; Admin > Ask AMBIT opens it to contractors.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Settings (one row) ----------------------------------------
create table if not exists public.ai_settings (
  id                    boolean primary key default true check (id),
  model                 text not null default 'claude-sonnet-5-5',
  open_to_customers     boolean not null default false,
  web_lookups           boolean not null default true,
  allowed_sites         text[] not null default array[
                          'codes.iccsafe.org', 'energycodes.gov', 'acca.org', 'ashrae.org', 'energy.gov',
                          'ornl.gov', 'nrel.gov', 'pnnl.gov', 'nist.gov', 'lbl.gov', 'osti.gov'],
  daily_limit_staff     int not null default 150,
  daily_limit_customer  int not null default 40,
  teachers              uuid[] not null default '{}',   -- who may add building-science teaching (blank = any admin)
  extra_rules           text,                           -- extra instructions from the teacher, added to the rules
  updated_at            timestamptz not null default now(),
  updated_by_name       text
);
insert into public.ai_settings (id) values (true) on conflict (id) do nothing;
-- Jeremiah teaches building science.
update public.ai_settings
   set teachers = array(select id from public.profiles where lower(email) in ('jeremiah.bryant@ambitpu.com') and role = 'admin')
 where teachers = '{}';

-- ---------- Knowledge ---------------------------------------------------
-- kind:   teaching (Jeremiah's TSBs and teaching) | product (AMBIT TDS/SDS/ESR/guides) | code (IECC/IRC/IBC)
--         | hvac (ACCA/ASHRAE/neutral) | science (neutral research) | app (how to use the app)
-- origin: document (from the Docs library) | upload (a PDF added in Admin) | note (written in the app)
--         | answer (an expert answer to a user's question)
create table if not exists public.ai_sources (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  origin          text not null,
  title           text not null,
  document_id     uuid unique references public.documents(id) on delete cascade,
  storage_path    text,
  file_name       text,
  body            text,
  pages           int,
  chars           int not null default 0,
  staff_only      boolean not null default false,
  enabled         boolean not null default true,
  status          text not null default 'ready',
  error           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.ai_sources add constraint ai_sources_kind_check check (kind in ('teaching', 'product', 'code', 'hvac', 'science', 'app'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_sources add constraint ai_sources_origin_check check (origin in ('document', 'upload', 'note', 'answer'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_sources add constraint ai_sources_status_check check (status in ('ready', 'empty', 'error'));
exception when duplicate_object then null; end $$;

create table if not exists public.ai_chunks (
  id        bigint generated always as identity primary key,
  source_id uuid not null references public.ai_sources(id) on delete cascade,
  page      int,
  seq       int not null default 0,
  title     text,
  body      text not null,
  tsv       tsvector generated always as (
              setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', body), 'B')) stored
);
create index if not exists ai_chunks_tsv_idx on public.ai_chunks using gin (tsv);
create index if not exists ai_chunks_source_idx on public.ai_chunks (source_id, seq);

-- ---------- Conversations ----------------------------------------------
create table if not exists public.ai_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default 'New question',
  unread      boolean not null default false,       -- an expert answered and they haven't looked yet
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_threads_user_idx on public.ai_threads (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id            bigint generated always as identity primary key,
  thread_id     uuid not null references public.ai_threads(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null,                      -- user | assistant | expert
  body          text not null default '',
  parts         jsonb,                              -- answer split into pieces with their source numbers
  sources       jsonb,                              -- [{n, title, kind, href, page, site}]
  no_source     boolean not null default false,     -- it had no approved source for part of the question
  model         text,
  input_tokens  int,
  output_tokens int,
  searches      int,
  cost_cents    numeric(10, 3),
  rating        smallint,                           -- 1 helpful, -1 not helpful
  feedback      text,
  author_name   text,                               -- expert answers
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.ai_messages add constraint ai_messages_role_check check (role in ('user', 'assistant', 'expert'));
exception when duplicate_object then null; end $$;
create index if not exists ai_messages_thread_idx on public.ai_messages (thread_id, id);
create index if not exists ai_messages_rating_idx on public.ai_messages (rating) where rating is not null;

-- Questions sent to AMBIT's expert
create table if not exists public.ai_questions (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid references public.ai_threads(id) on delete set null,
  message_id      bigint references public.ai_messages(id) on delete set null,  -- the answer they sent on
  user_id         uuid references public.profiles(id) on delete set null,
  user_name       text,
  user_company    text,
  question        text not null,
  draft           text,                             -- what the assistant said
  status          text not null default 'open',
  answer          text,
  answered_by     uuid references public.profiles(id) on delete set null,
  answered_by_name text,
  answered_at     timestamptz,
  source_id       uuid references public.ai_sources(id) on delete set null,
  created_at      timestamptz not null default now()
);
do $$ begin
  alter table public.ai_questions add constraint ai_questions_status_check check (status in ('open', 'answered', 'dismissed'));
exception when duplicate_object then null; end $$;
create index if not exists ai_questions_status_idx on public.ai_questions (status, created_at desc);

-- Daily use per person (kept apart from conversations so deleting a chat doesn't reset it)
create table if not exists public.ai_usage (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null default current_date,
  questions  int not null default 0,
  cost_cents numeric(12, 3) not null default 0,
  primary key (user_id, day)
);

-- ---------- Helpers -----------------------------------------------------
create or replace function public.ai_can_teach() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and coalesce((select teachers = '{}' or auth.uid() = any(teachers) from public.ai_settings), true)
$$;

-- May this person use Ask AMBIT right now?
create or replace function public.ai_can_use() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.status = 'active' and (p.role in ('employee', 'admin') or (select open_to_customers from public.ai_settings))
      from public.profiles p where p.id = auth.uid()), false)
$$;

-- Counts one question against today's limit. Returns how many are left (negative = over the limit).
create or replace function public.ai_take_question() returns int
language plpgsql security definer set search_path = public as $$
declare
  lim int;
  used int;
begin
  if not public.ai_can_use() then
    return -1;
  end if;
  select case when public.my_role() in ('employee', 'admin') then daily_limit_staff else daily_limit_customer end
    into lim from public.ai_settings;
  insert into public.ai_usage (user_id, day, questions) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set questions = public.ai_usage.questions + 1
  returning questions into used;
  return coalesce(lim, 50) - used;
end $$;

create or replace function public.ai_add_cost(p_cents numeric) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage set cost_cents = cost_cents + greatest(coalesce(p_cents, 0), 0)
   where user_id = auth.uid() and day = current_date
$$;

-- Knowledge search: any of the words, best matches first. Contractors never get staff-only sources.
create or replace function public.ai_search(q text, kinds text[] default null, max_rows int default 8)
returns table (chunk_id bigint, source_id uuid, kind text, origin text, title text, page int, body text,
               document_id uuid, rank real)
language plpgsql stable security definer set search_path = public as $$
declare
  query tsquery;
  staff boolean := public.my_role() in ('employee', 'admin');
begin
  if not public.ai_can_use() then
    return;
  end if;
  query := nullif(replace(plainto_tsquery('english', coalesce(q, ''))::text, ' & ', ' | '), '')::tsquery;
  if query is null then
    return;
  end if;
  return query
    select c.id, s.id, s.kind, s.origin, s.title, c.page, c.body, s.document_id,
           (ts_rank_cd(c.tsv, query, 32) * case s.kind when 'teaching' then 1.35 when 'product' then 1.1 else 1 end)::real as rank
      from public.ai_chunks c
      join public.ai_sources s on s.id = c.source_id
     where c.tsv @@ query
       and s.enabled and s.status = 'ready'
       and (staff or not s.staff_only)
       and (kinds is null or s.kind = any(kinds))
     order by rank desc
     limit least(greatest(coalesce(max_rows, 8), 1), 20);
end $$;

-- Puts a source's chunks in (replacing the old ones unless p_append), in one step (admins).
drop function if exists public.ai_replace_chunks(uuid, jsonb);
create or replace function public.ai_replace_chunks(p_source uuid, p_chunks jsonb, p_append boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text;
  n int;
begin
  select kind into k from public.ai_sources where id = p_source;
  if k is null then raise exception 'Source not found'; end if;
  if not public.is_admin() or (k = 'teaching' and not public.ai_can_teach()) then
    raise exception 'Not allowed';
  end if;
  if not coalesce(p_append, false) then
    delete from public.ai_chunks where source_id = p_source;
  end if;
  insert into public.ai_chunks (source_id, page, seq, title, body)
  select p_source, nullif(x->>'page', '')::int, (x->>'seq')::int, x->>'title', x->>'body'
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) x
   where length(coalesce(x->>'body', '')) > 0;
  get diagnostics n = row_count;
  update public.ai_sources
     set chars = coalesce((select sum(length(body)) from public.ai_chunks where source_id = p_source), 0),
         status = case when exists (select 1 from public.ai_chunks where source_id = p_source) then 'ready' else 'empty' end,
         error = null, updated_at = now()
   where id = p_source;
  return n;
end $$;

revoke execute on function public.ai_can_teach() from public, anon;
revoke execute on function public.ai_can_use() from public, anon;
revoke execute on function public.ai_take_question() from public, anon;
revoke execute on function public.ai_add_cost(numeric) from public, anon;
revoke execute on function public.ai_search(text, text[], int) from public, anon;
revoke execute on function public.ai_replace_chunks(uuid, jsonb, boolean) from public, anon;
grant execute on function public.ai_can_teach() to authenticated;
grant execute on function public.ai_can_use() to authenticated;
grant execute on function public.ai_take_question() to authenticated;
grant execute on function public.ai_add_cost(numeric) to authenticated;
grant execute on function public.ai_search(text, text[], int) to authenticated;
grant execute on function public.ai_replace_chunks(uuid, jsonb, boolean) to authenticated;

-- ---------- Who sees what -----------------------------------------------
alter table public.ai_settings  enable row level security;
alter table public.ai_sources   enable row level security;
alter table public.ai_chunks    enable row level security;
alter table public.ai_threads   enable row level security;
alter table public.ai_messages  enable row level security;
alter table public.ai_questions enable row level security;
alter table public.ai_usage     enable row level security;

drop policy if exists ai_settings_read   on public.ai_settings;
drop policy if exists ai_settings_admin  on public.ai_settings;
create policy ai_settings_read  on public.ai_settings for select to authenticated using (public.is_active());
create policy ai_settings_admin on public.ai_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Everyone who can use the assistant can see source titles (they're shown as citations);
-- admins manage them; only the teacher adds or changes building-science teaching.
drop policy if exists ai_sources_read   on public.ai_sources;
drop policy if exists ai_sources_insert on public.ai_sources;
drop policy if exists ai_sources_update on public.ai_sources;
drop policy if exists ai_sources_delete on public.ai_sources;
create policy ai_sources_read on public.ai_sources for select to authenticated
  using (public.is_admin() or (public.ai_can_use() and enabled and (not staff_only or public.my_role() in ('employee', 'admin'))));
create policy ai_sources_insert on public.ai_sources for insert to authenticated
  with check (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()));
create policy ai_sources_update on public.ai_sources for update to authenticated
  using (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()))
  with check (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()));
create policy ai_sources_delete on public.ai_sources for delete to authenticated
  using (public.is_admin() and (kind <> 'teaching' or public.ai_can_teach()));

drop policy if exists ai_chunks_admin on public.ai_chunks;
create policy ai_chunks_admin on public.ai_chunks for select to authenticated using (public.is_admin());

drop policy if exists ai_threads_own   on public.ai_threads;
drop policy if exists ai_threads_admin on public.ai_threads;
create policy ai_threads_own on public.ai_threads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.ai_can_use());
create policy ai_threads_admin on public.ai_threads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_messages_own_read   on public.ai_messages;
drop policy if exists ai_messages_own_insert on public.ai_messages;
drop policy if exists ai_messages_own_rate   on public.ai_messages;
drop policy if exists ai_messages_admin      on public.ai_messages;
create policy ai_messages_own_read on public.ai_messages for select to authenticated using (user_id = auth.uid());
create policy ai_messages_own_insert on public.ai_messages for insert to authenticated
  with check (user_id = auth.uid() and role in ('user', 'assistant') and public.ai_can_use()
              and exists (select 1 from public.ai_threads t where t.id = thread_id and t.user_id = auth.uid()));
create policy ai_messages_own_rate on public.ai_messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_messages_admin on public.ai_messages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_questions_own   on public.ai_questions;
drop policy if exists ai_questions_ask   on public.ai_questions;
drop policy if exists ai_questions_admin on public.ai_questions;
create policy ai_questions_own on public.ai_questions for select to authenticated using (user_id = auth.uid());
create policy ai_questions_ask on public.ai_questions for insert to authenticated
  with check (user_id = auth.uid() and status = 'open' and answer is null and public.ai_can_use());
create policy ai_questions_admin on public.ai_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- A rating can be changed; nothing else about a message can.
create or replace function public.ai_messages_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.body is distinct from old.body or new.parts is distinct from old.parts or new.sources is distinct from old.sources
     or new.role is distinct from old.role or new.thread_id is distinct from old.thread_id
     or new.cost_cents is distinct from old.cost_cents or new.no_source is distinct from old.no_source then
    raise exception 'Only the rating can be changed';
  end if;
  return new;
end $$;
drop trigger if exists ai_messages_guard on public.ai_messages;
create trigger ai_messages_guard before update on public.ai_messages for each row execute function public.ai_messages_guard();

-- ---------- Files (PDFs added in Admin > Ask AMBIT) ----------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge', 'knowledge', false, 52428800, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists knowledge_read   on storage.objects;
drop policy if exists knowledge_insert on storage.objects;
drop policy if exists knowledge_delete on storage.objects;
create policy knowledge_read on storage.objects for select to authenticated using (
  bucket_id = 'knowledge' and (public.is_admin() or exists (
    select 1 from public.ai_sources s
     where s.storage_path = name and s.enabled
       and public.ai_can_use() and (not s.staff_only or public.my_role() in ('employee', 'admin')))));
create policy knowledge_insert on storage.objects for insert to authenticated with check (bucket_id = 'knowledge' and public.is_admin());
create policy knowledge_delete on storage.objects for delete to authenticated using (bucket_id = 'knowledge' and public.is_admin());

select (select count(*) from public.ai_sources) as sources,
       (select coalesce(array_length(teachers, 1), 0) from public.ai_settings) as teachers_set;
