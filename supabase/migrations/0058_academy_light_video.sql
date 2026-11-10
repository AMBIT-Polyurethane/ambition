-- =====================================================================
-- AMBIT Intelligence update 0058 - Academy: a light version of each lesson video
-- * A lesson can have a second video made for Light mode (white background). People who use the app
--   in Light mode (Profile > Appearance > Light, or Auto when their phone or computer is set to light)
--   see the light video; everyone else sees the main (dark) one. A lesson with no light video shows
--   its main video to everyone, as before.
-- * Admins upload it on the lesson's page, under "Light-mode video". Spanish versions can have one too.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

alter table public.academy_lessons add column if not exists video_path_light text;

comment on column public.academy_lessons.video_path_light is
  'Optional light-mode copy of the lesson video (path in the private "academy" bucket). Shown to people using the app in Light mode.';

select 'Update 0058 done: Academy lessons can have a light-mode video.' as status;
