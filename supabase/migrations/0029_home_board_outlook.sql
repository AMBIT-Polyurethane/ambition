-- =====================================================================
-- AMBIT Intelligence update 0029 - Customizable Home, Outlook cards
-- * Each person can move and hide the cards on their Home screen (Customize). The layout is
--   saved with their profile, so it follows them to every phone and computer.
-- * AMBIT staff can connect their own Outlook (Microsoft 365) to see their inbox and calendar
--   on Home. Each person's Microsoft sign-in is kept where only the app's server can read it.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- {"order": ["spot", "outlook-cal", ...], "hidden": ["tsb", ...]}
alter table public.profiles add column if not exists home_layout jsonb;
grant update (home_layout) on public.profiles to authenticated;

-- One Microsoft (Outlook) connection per person. Row-level security with no policies:
-- only the app's server key can read or write it (never the browser).
create table if not exists public.user_ms_tokens (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  account_email text,
  account_name  text,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  scopes        text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.user_ms_tokens enable row level security;
revoke all on public.user_ms_tokens from anon, authenticated;
grant select, insert, update, delete on public.user_ms_tokens to service_role;

select 'customizable home and outlook cards ready' as status;
