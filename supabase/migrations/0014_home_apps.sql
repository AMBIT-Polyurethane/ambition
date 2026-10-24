-- =====================================================================
-- AMBITION - Home screen app layout
-- Each person can reorder and hide the apps on their home screen
-- (Home → Your apps → Edit). Saved with their profile so it follows
-- them to every phone and computer.
-- Safe to run more than once.
-- =====================================================================
alter table public.profiles add column if not exists home_apps jsonb;  -- {"order": [...], "hidden": [...]}
grant update (home_apps) on public.profiles to authenticated;

select count(*) filter (where home_apps is not null) as custom_layouts from public.profiles;
