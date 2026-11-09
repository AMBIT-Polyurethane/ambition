-- =====================================================================
-- AMBIT Intelligence update 0053 - Teachable takeoff AI
-- * The AI reads each plan sheet and draws the shapes itself (walls, ceilings, floors, slab...). Its
--   shapes are dashed until someone accepts or edits them; shapes on elevations are for reference only
--   and never counted. Windows and doors it finds are kept per sheet.
-- * Teaching: a correction typed on a sheet can be remembered as a rule for all plans or for one
--   builder. Rules go into every future reading. AMBIT's rules apply to every takeoff; a contractor's
--   own rules apply only to their takeoffs. Deleting a takeoff keeps the rules learned on it.
-- * Every AI call is logged (sheet, result, tokens) so bad reads can be reviewed.
-- * Templates: a finished takeoff saved as a template; a new takeoff can start from it (no AI needed).
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ---------- Takeoffs, sheets, items, shapes ---------------------------------------------------
alter table public.takeoffs add column if not exists builder       text;
alter table public.takeoffs add column if not exists ai_read       jsonb;    -- the latest cross-sheet check (facts, alerts, windows) and which alerts were checked
alter table public.takeoffs add column if not exists is_template   boolean not null default false;
alter table public.takeoffs add column if not exists template_name text;
alter table public.takeoffs add column if not exists from_template uuid;     -- the template it was started from (no link: templates can be deleted)
create index if not exists takeoffs_templates_idx on public.takeoffs(is_template) where is_template;

alter table public.takeoff_sheets add column if not exists ai    jsonb;        -- the AI's last reading of this sheet (shapes in pixels of the picture it saw)
alter table public.takeoff_sheets add column if not exists ai_at timestamptz;

alter table public.takeoff_items add column if not exists assembly text;      -- slab, exterior_walls, knee_walls ... (lib/takeoff/assemblies.ts)
alter table public.takeoff_items add column if not exists ai       boolean not null default false;  -- set up by the AI

alter table public.takeoff_marks add column if not exists ai   boolean not null default false;  -- drawn by the AI and not checked yet (dashed)
alter table public.takeoff_marks add column if not exists ref  boolean not null default false;  -- for reference only (elevations, sections): never counted
alter table public.takeoff_marks add column if not exists note text;                            -- "over garage", "master bedroom tray"

-- ---------- Windows and doors the AI found ------------------------------------------------------
create table if not exists public.takeoff_components (
  id          uuid primary key default gen_random_uuid(),
  takeoff_id  uuid not null references public.takeoffs(id) on delete cascade,
  sheet_id    uuid references public.takeoff_sheets(id) on delete cascade,
  kind        text not null default 'window',   -- window | door | garage_door | opening
  code        text,                              -- 3050, 2868, 16'-0" x 8'-0"
  width_ft    numeric,
  height_ft   numeric,
  qty         int not null default 1,
  side        text,                              -- front | rear | left | right | interior | unknown
  wall        text,                              -- the assembly it sits in (exterior_walls, garage_partition_walls ...)
  label       text,                              -- F1, R2 ...
  x           numeric,                           -- where on the sheet, PDF points
  y           numeric,
  ai          boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists takeoff_components_takeoff_idx on public.takeoff_components(takeoff_id);
alter table public.takeoff_components enable row level security;
drop policy if exists takeoff_components_team on public.takeoff_components;
create policy takeoff_components_team on public.takeoff_components for all to authenticated
  using (takeoff_id in (select t.id from public.takeoffs t)) with check (takeoff_id in (select t.id from public.takeoffs t));

-- Who works on AMBIT's own takeoffs (and its rules), or on one contractor's.
create or replace function public.takeoff_team(p_company uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_company is null then public.has_perm('takeoff')
              else p_company = public.ops_company() and public.ops_is('owner', 'office', 'dispatcher', 'sales') end
$$;

-- ---------- Rules taught to the AI ----------------------------------------------------------------
create table if not exists public.takeoff_ai_rules (
  id                uuid primary key default gen_random_uuid(),
  text              text not null,
  kind              text not null default 'plans',      -- plans | photos
  builder           text,                               -- blank = every builder
  ops_company_id    uuid references public.companies(id) on delete cascade,  -- blank = AMBIT's rules (every takeoff)
  active            boolean not null default true,
  source            text not null default 'correction', -- correction | manual | import
  source_takeoff_id uuid references public.takeoffs(id) on delete set null,
  source_sheet      text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
do $$ begin
  alter table public.takeoff_ai_rules add constraint takeoff_ai_rules_kind_check check (kind in ('plans', 'photos'));
exception when duplicate_object then null; end $$;
create index if not exists takeoff_ai_rules_scope_idx on public.takeoff_ai_rules(ops_company_id, active, created_at);
alter table public.takeoff_ai_rules enable row level security;
drop policy if exists takeoff_ai_rules_team on public.takeoff_ai_rules;
create policy takeoff_ai_rules_team on public.takeoff_ai_rules for all to authenticated
  using (public.takeoff_team(ops_company_id)) with check (public.takeoff_team(ops_company_id));

-- ---------- Every correction typed, remembered or not --------------------------------------------
create table if not exists public.takeoff_ai_corrections (
  id              uuid primary key default gen_random_uuid(),
  takeoff_id      uuid references public.takeoffs(id) on delete set null,
  sheet_id        uuid,
  sheet_name      text,
  builder         text,
  text            text not null,
  remember        text not null default 'once',   -- once | all | builder
  rule_id         uuid references public.takeoff_ai_rules(id) on delete set null,
  ops_company_id  uuid references public.companies(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists takeoff_ai_corrections_idx on public.takeoff_ai_corrections(ops_company_id, created_at desc);
alter table public.takeoff_ai_corrections enable row level security;
drop policy if exists takeoff_ai_corrections_team on public.takeoff_ai_corrections;
create policy takeoff_ai_corrections_team on public.takeoff_ai_corrections for all to authenticated
  using (public.takeoff_team(ops_company_id)) with check (public.takeoff_team(ops_company_id));

-- ---------- Every AI call (to review bad reads and turn them into better rules) ------------------
create table if not exists public.takeoff_ai_calls (
  id              uuid primary key default gen_random_uuid(),
  takeoff_id      uuid references public.takeoffs(id) on delete set null,
  sheet_id        uuid,
  sheet_name      text,
  kind            text not null,                -- read | correct | reconcile
  model           text,
  ok              boolean not null default true,
  error           text,
  input_tokens    int,
  output_tokens   int,
  cost_cents      numeric(10,3),
  ms              int,
  rules           int,                          -- how many rules were in the prompt
  result          jsonb,
  ops_company_id  uuid references public.companies(id) on delete cascade,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists takeoff_ai_calls_idx on public.takeoff_ai_calls(ops_company_id, created_at desc);
alter table public.takeoff_ai_calls enable row level security;
drop policy if exists takeoff_ai_calls_team on public.takeoff_ai_calls;
create policy takeoff_ai_calls_team on public.takeoff_ai_calls for all to authenticated
  using (public.takeoff_team(ops_company_id)) with check (public.takeoff_team(ops_company_id));

-- The rules for one takeoff's prompts: AMBIT's, plus the contractor's own on their takeoffs; every
-- builder's, plus the ones for this takeoff's builder. Oldest first.
create or replace function public.takeoff_rules_for(p_takeoff uuid, p_kind text default 'plans')
returns table (id uuid, text text, builder text, mine boolean)
language sql stable security definer set search_path = public as $$
  with t as (
    select x.ops_company_id, lower(trim(coalesce(x.builder, ''))) as b
      from public.takeoffs x
     where x.id = p_takeoff and public.takeoff_team(x.ops_company_id)
  )
  select r.id, r.text, r.builder, r.ops_company_id is not null
    from public.takeoff_ai_rules r, t
   where r.active and r.kind = coalesce(p_kind, 'plans')
     and (r.ops_company_id is null or r.ops_company_id = t.ops_company_id)
     and (r.builder is null or trim(r.builder) = '' or lower(trim(r.builder)) = t.b)
   order by r.ops_company_id nulls first, r.created_at, r.id
$$;

revoke all on function public.takeoff_team(uuid) from public, anon;
revoke all on function public.takeoff_rules_for(uuid, text) from public, anon;
grant execute on function public.takeoff_team(uuid) to authenticated;
grant execute on function public.takeoff_rules_for(uuid, text) to authenticated;
grant select, insert, update, delete on public.takeoff_components, public.takeoff_ai_rules, public.takeoff_ai_corrections to authenticated;
grant select, insert on public.takeoff_ai_calls to authenticated;

select 'Update 0053 done: takeoff AI rules, corrections, call log, windows and doors, templates.' as status;
