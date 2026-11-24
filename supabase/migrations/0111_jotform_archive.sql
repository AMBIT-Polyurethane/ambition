-- 0111: A.I.'s own copy of everything in Jotform, so Jotform can be cancelled.
--  * Every form, every submission (all answers, exactly as Jotform had them) and every uploaded file and signature
--    (W-9s, tax certificates, licenses, receipt photos) is saved here and in the private "jotform-archive" files.
--  * The app reads this copy whenever Jotform can't answer (or once JOTFORM_ARCHIVE_ONLY=1 is set in Vercel), so the
--    Forms hub, credit applications, account setups, older price requests and receipt photos keep working.
--  * Only the app's server reads or writes it (credit applications can hold private details).
-- Run once in Supabase > SQL Editor. Safe to run again.

create table if not exists public.jotform_archive_forms (
  form_id       text primary key,
  title         text,
  kind          text,
  raw           jsonb not null,                 -- the form, as Jotform describes it
  questions     jsonb,                          -- the form's questions (price requests read their layout)
  live_count    int,                            -- how many submissions Jotform had when it was last copied
  archived_at   timestamptz not null default now(),
  archived_by   text
);

create table if not exists public.jotform_archive_subs (
  id             text primary key,              -- the Jotform submission id (decisions in form_reviews use it too)
  form_id        text not null,
  created_at     timestamptz,
  raw            jsonb not null,                -- the whole submission, every answer
  file_urls      text[] not null default '{}',  -- every Jotform file on it (uploads and signatures)
  archived_at    timestamptz not null default now()
);
create index if not exists jotform_archive_subs_form on public.jotform_archive_subs(form_id, created_at desc);

create table if not exists public.jotform_archive_files (
  url            text primary key,              -- the file's Jotform address (how the app asks for it)
  submission_id  text,
  form_id        text,
  path           text not null,                 -- where it is in the "jotform-archive" files
  type           text,
  size           bigint,
  saved_at       timestamptz not null default now()
);
create index if not exists jotform_archive_files_sub on public.jotform_archive_files(submission_id);

-- No policies: nobody reads these directly; the app's server does, after checking who's asking.
alter table public.jotform_archive_forms enable row level security;
alter table public.jotform_archive_subs enable row level security;
alter table public.jotform_archive_files enable row level security;
revoke all on public.jotform_archive_forms, public.jotform_archive_subs, public.jotform_archive_files from anon, authenticated;

-- The files themselves. Private; any type (Jotform took anything); up to 50 MB each.
insert into storage.buckets (id, name, public, file_size_limit)
values ('jotform-archive', 'jotform-archive', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';

-- Check: should say 3 and 1.
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'jotform_archive_%') as "Tables (3)",
       (select count(*) from storage.buckets where id = 'jotform-archive') as "File storage (1)";
