-- =====================================================================
-- AMBIT Intelligence update 0019 - Takeoff (measuring plans)
-- * Upload PDF plan sets, set each sheet's scale, and measure areas, walls (linear x height)
--   and counts against insulation items (material, thickness, R-value, pitch).
-- * Staff with the new "Takeoff" box (Admin > Accounts) use it. Admins always can;
--   CRM and Sales reps get the box now.
-- * Plan PDFs live in the private "plans" storage bucket.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- The new permission ---------------------------------------
create or replace function public.all_perms() returns text[]
language sql immutable as $$
  select array['ordering', 'price_requests', 'prf_approve', 'time_off', 'travel', 'spray_log', 'complaints',
               'inventory', 'order_desk', 'credit_check', 'takeoff']
$$;

update public.profiles
   set perms = array_append(perms, 'takeoff')
 where role = 'employee' and job_role in ('crm', 'sales_rep') and not ('takeoff' = any(perms));

-- ---------- Takeoffs --------------------------------------------------
create table if not exists public.takeoffs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  customer        text,
  company_id      uuid references public.companies(id) on delete set null,
  address         text,
  due_date        date,
  status          text not null default 'in_progress',
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  alter table public.takeoffs add constraint takeoffs_status_check check (status in ('in_progress', 'sent', 'won', 'lost'));
exception when duplicate_object then null; end $$;
create index if not exists takeoffs_updated_idx on public.takeoffs(updated_at desc);

-- One uploaded PDF (a plan set can be one file or several).
create table if not exists public.takeoff_files (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  path        text not null,           -- in the "plans" bucket
  file_name   text not null,
  size        bigint,
  pages       int,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_files_takeoff_idx on public.takeoff_files(takeoff_id);

-- One page of a plan PDF. Sizes are in PDF points (1/72 inch); ft_per_pt is the scale.
create table if not exists public.takeoff_sheets (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  file_id     uuid not null references public.takeoff_files(id) on delete cascade,
  page        int not null,
  name        text,
  width_pt    numeric,
  height_pt   numeric,
  ft_per_pt   numeric,                 -- real feet per PDF point (blank = scale not set)
  scale_label text,                    -- 1/4" = 1'-0"
  scale_source text,                   -- read | calibrated | picked
  sort        int not null default 0,
  unique (file_id, page)
);
create index if not exists takeoff_sheets_takeoff_idx on public.takeoff_sheets(takeoff_id);

-- What's being measured: exterior walls, attic floor, rim joist, can lights...
create table if not exists public.takeoff_items (
  id            uuid primary key default gen_random_uuid(),
  takeoff_id    uuid not null references public.takeoffs(id) on delete cascade,
  name          text not null,
  kind          text not null,         -- area | linear | count
  color         text not null default '#e33527',
  material      text,                  -- open_cell | closed_cell | blown_fiberglass | fiberglass_batts | ...
  thickness_in  numeric,
  r_value       text,
  height_ft     numeric,               -- linear: wall height, so walls give square feet
  pitch         numeric,               -- rise per 12 (6 = 6/12); sloped areas get the pitch factor
  deduct_sqft   numeric not null default 0,  -- openings (windows, doors) taken out
  hidden        boolean not null default false,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.takeoff_items add constraint takeoff_items_kind_check check (kind in ('area', 'linear', 'count'));
exception when duplicate_object then null; end $$;
create index if not exists takeoff_items_takeoff_idx on public.takeoff_items(takeoff_id);

-- Each shape drawn on a sheet: points in PDF points. Cutouts are taken out of an area.
create table if not exists public.takeoff_marks (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  item_id     uuid not null references public.takeoff_items(id) on delete cascade,
  sheet_id    uuid not null references public.takeoff_sheets(id) on delete cascade,
  points      jsonb not null,
  cutout      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_marks_takeoff_idx on public.takeoff_marks(takeoff_id);

-- Any change inside a takeoff moves it to the top of the list.
create or replace function public.touch_takeoff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.takeoffs set updated_at = now() where id = coalesce(new.takeoff_id, old.takeoff_id);
  return coalesce(new, old);
end $$;
drop trigger if exists takeoff_items_touch on public.takeoff_items;
create trigger takeoff_items_touch after insert or update or delete on public.takeoff_items for each row execute function public.touch_takeoff();
drop trigger if exists takeoff_marks_touch on public.takeoff_marks;
create trigger takeoff_marks_touch after insert or update or delete on public.takeoff_marks for each row execute function public.touch_takeoff();
drop trigger if exists takeoff_sheets_touch on public.takeoff_sheets;
create trigger takeoff_sheets_touch after insert or update on public.takeoff_sheets for each row execute function public.touch_takeoff();

-- ---------- Who sees what: staff with the Takeoff box ------------------
alter table public.takeoffs       enable row level security;
alter table public.takeoff_files  enable row level security;
alter table public.takeoff_sheets enable row level security;
alter table public.takeoff_items  enable row level security;
alter table public.takeoff_marks  enable row level security;

drop policy if exists takeoffs_team       on public.takeoffs;
drop policy if exists takeoff_files_team  on public.takeoff_files;
drop policy if exists takeoff_sheets_team on public.takeoff_sheets;
drop policy if exists takeoff_items_team  on public.takeoff_items;
drop policy if exists takeoff_marks_team  on public.takeoff_marks;
create policy takeoffs_team       on public.takeoffs       for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_files_team  on public.takeoff_files  for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_sheets_team on public.takeoff_sheets for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_items_team  on public.takeoff_items  for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));
create policy takeoff_marks_team  on public.takeoff_marks  for all to authenticated using (public.has_perm('takeoff')) with check (public.has_perm('takeoff'));

-- ---------- Plan files ------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plans', 'plans', false, 314572800, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists plans_read   on storage.objects;
drop policy if exists plans_insert on storage.objects;
drop policy if exists plans_delete on storage.objects;
create policy plans_read   on storage.objects for select to authenticated using (bucket_id = 'plans' and public.has_perm('takeoff'));
create policy plans_insert on storage.objects for insert to authenticated with check (bucket_id = 'plans' and public.has_perm('takeoff'));
create policy plans_delete on storage.objects for delete to authenticated using (bucket_id = 'plans' and public.has_perm('takeoff'));

select (select count(*) from public.takeoffs) as takeoffs,
       (select count(*) from public.profiles where 'takeoff' = any(perms)) as staff_with_takeoff;
