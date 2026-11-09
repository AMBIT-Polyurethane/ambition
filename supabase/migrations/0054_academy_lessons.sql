-- =====================================================================
-- AMBIT Intelligence update 0054 - Academy lessons with graded quizzes
-- * A course holds numbered lessons. A lesson has a video (private "academy" bucket), a short summary,
--   a graded multiple-choice quiz and a pass mark (80 percent unless changed).
-- * Students never see the right answers before they answer: the answer and explanation columns can't
--   be read; academy_submit() grades on the server, saves the attempt and only then sends the answers back.
-- * Admins build lessons in Admin > Academy and see everyone's results there.
-- * Seeds lesson 1 "What Is Heat?" and lesson 2 "Heat Flow 101" in Building science fundamentals,
--   both as drafts until their videos are uploaded and Jeremiah signs them off.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.academy_lessons (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  number      int not null default 1,
  title       text not null,
  summary     text,
  minutes     int,
  video_path  text,
  status      text not null default 'draft' check (status in ('draft', 'live')),
  pass_pct    int not null default 80 check (pass_pct between 1 and 100),
  discussion  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists academy_lessons_course on public.academy_lessons (course_id, number);

create table if not exists public.academy_questions (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.academy_lessons(id) on delete cascade,
  sort       int not null default 0,
  prompt     text not null,
  choices    text[] not null check (cardinality(choices) between 2 and 6),
  answer     int not null,          -- which choice is right, counted from 0
  explain    text,
  constraint academy_questions_answer check (answer >= 0 and answer < cardinality(choices))
);
create index if not exists academy_questions_lesson on public.academy_questions (lesson_id, sort);

create table if not exists public.academy_attempts (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.academy_lessons(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  answers     jsonb not null default '{}'::jsonb,   -- {question id: choice picked}
  score       int not null,
  total       int not null,
  passed      boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists academy_attempts_user on public.academy_attempts (user_id, lesson_id, created_at desc);
create index if not exists academy_attempts_lesson on public.academy_attempts (lesson_id, created_at desc);

alter table public.academy_lessons   enable row level security;
alter table public.academy_questions enable row level security;
alter table public.academy_attempts  enable row level security;

-- Lessons: live lessons of a course the person may see; admins see drafts too.
drop policy if exists academy_lessons_read  on public.academy_lessons;
drop policy if exists academy_lessons_admin on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to authenticated
  using (public.is_admin() or (status = 'live' and exists (
    select 1 from public.courses c where c.id = course_id and public.can_see(c.audience))));
create policy academy_lessons_admin on public.academy_lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Questions: readable with their lesson, but never the answer or the explanation.
drop policy if exists academy_questions_read  on public.academy_questions;
drop policy if exists academy_questions_admin on public.academy_questions;
create policy academy_questions_read on public.academy_questions for select to authenticated
  using (exists (select 1 from public.academy_lessons l where l.id = lesson_id));
create policy academy_questions_admin on public.academy_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke select on public.academy_questions from anon, authenticated;
grant select (id, lesson_id, sort, prompt, choices) on public.academy_questions to authenticated;

-- Attempts: your own, or everyone's for admins. Saved only by academy_submit().
drop policy if exists academy_attempts_read   on public.academy_attempts;
drop policy if exists academy_attempts_delete on public.academy_attempts;
create policy academy_attempts_read on public.academy_attempts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy academy_attempts_delete on public.academy_attempts for delete to authenticated
  using (public.is_admin());
revoke insert, update on public.academy_attempts from anon, authenticated;

-- The answer key, for the admin lesson editor only.
create or replace function public.academy_answer_key(p_lesson uuid)
returns table (id uuid, answer int, explain text)
language sql stable security definer set search_path = public as $$
  select q.id, q.answer, q.explain from public.academy_questions q
  where q.lesson_id = p_lesson and public.is_admin()
$$;
revoke all on function public.academy_answer_key(uuid) from public, anon;
grant execute on function public.academy_answer_key(uuid) to authenticated;

-- Grade a quiz: p_answers = {"<question id>": <choice picked, from 0>, ...}.
create or replace function public.academy_submit(p_lesson uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lesson  public.academy_lessons;
  v_total   int := 0;
  v_score   int := 0;
  v_results jsonb := '[]'::jsonb;
  v_pick    int;
  v_right   boolean;
  v_passed  boolean;
  q         record;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Sign in first.';
  end if;
  select * into v_lesson from public.academy_lessons l where l.id = p_lesson;
  if not found then raise exception 'That lesson isn''t there any more.'; end if;
  if not public.is_admin() and (v_lesson.status <> 'live' or not exists (
      select 1 from public.courses c where c.id = v_lesson.course_id and public.can_see(c.audience))) then
    raise exception 'That lesson isn''t open yet.';
  end if;
  for q in select * from public.academy_questions where lesson_id = p_lesson order by sort, id loop
    v_total := v_total + 1;
    v_pick := case when jsonb_typeof(p_answers -> q.id::text) = 'number' then (p_answers ->> q.id::text)::int end;
    v_right := coalesce(v_pick = q.answer, false);
    if v_right then v_score := v_score + 1; end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', q.id, 'picked', v_pick, 'answer', q.answer, 'correct', v_right, 'explain', q.explain));
  end loop;
  if v_total = 0 then raise exception 'This lesson has no quiz yet.'; end if;
  v_passed := v_score * 100 >= v_lesson.pass_pct * v_total;
  insert into public.academy_attempts (lesson_id, user_id, answers, score, total, passed)
  values (p_lesson, auth.uid(), coalesce(p_answers, '{}'::jsonb), v_score, v_total, v_passed);
  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_passed,
    'pass_pct', v_lesson.pass_pct, 'results', v_results);
end $$;
revoke all on function public.academy_submit(uuid, jsonb) from public, anon;
grant execute on function public.academy_submit(uuid, jsonb) to authenticated;

-- Lesson videos: private bucket; anyone signed in and active can watch, only admins upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('academy', 'academy', false, 524288000, array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists academy_files_read   on storage.objects;
drop policy if exists academy_files_insert on storage.objects;
drop policy if exists academy_files_update on storage.objects;
drop policy if exists academy_files_delete on storage.objects;
create policy academy_files_read   on storage.objects for select to authenticated using (bucket_id = 'academy' and public.is_active());
create policy academy_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'academy' and public.is_admin());
create policy academy_files_update on storage.objects for update to authenticated using (bucket_id = 'academy' and public.is_admin());
create policy academy_files_delete on storage.objects for delete to authenticated using (bucket_id = 'academy' and public.is_admin());

-- ---------- The first two lessons (drafts) ----------------------------
do $$
declare
  v_course uuid;
  l1 uuid := 'acade001-0000-4000-8000-000000000001';
  l2 uuid := 'acade002-0000-4000-8000-000000000002';
begin
  select id into v_course from public.courses where title = 'Building science fundamentals' order by sort limit 1;
  if v_course is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Building science fundamentals', 'Heat, air and moisture movement', 6, 45, 1)
    returning id into v_course;
  end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values (l1, v_course, 1, 'What Is Heat?',
    'Molecules are always moving, temperature tells you how fast, and heat is energy moving from hotter to colder. Plus what a BTU is.',
    5, 'Where have you seen something expand or move on a job because it got hot?')
  on conflict (id) do nothing;
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values (l2, v_course, 2, 'Heat Flow 101',
    'The three ways heat moves (conduction, convection and radiation), what R-value measures, and the one equation for heat loss through a wall.',
    8, 'Describe the coldest room you''ve been called about. Which of the three modes was the main culprit, and what told you so?')
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = l1) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (l1, 1, 'Temperature measures:',
      array['How much a material weighs', 'How much moisture it holds', 'How fast its molecules are moving, on average', 'How much air is trapped in it'], 2,
      'Temperature is the average speed of the molecules: faster means hotter.'),
    (l1, 2, 'The molecules in an ice cube are:',
      array['Vibrating in place', 'Completely still', 'Flying around freely like a gas', 'Only moving once it starts to melt'], 0,
      'Molecules are always moving. In a solid they''re packed tight and jiggle in place.'),
    (l1, 3, 'One end of a steel bar is heated. What happens?',
      array['The molecules slow down and the bar shrinks', 'The molecules speed up, push slightly farther apart, and the bar gets a little longer', 'Nothing changes until the steel melts', 'Only the heated end changes; the rest stays the same'], 1,
      'Faster molecules take up a little more room, so materials expand when they heat up.'),
    (l1, 4, 'On its own, heat flows:',
      array['From colder to hotter', 'From hotter to colder', 'Only upward', 'Only through metal'], 1,
      'Heat is energy on the move, and on its own it always flows from hotter to colder.'),
    (l1, 5, 'One BTU is the heat it takes to:',
      array['Boil a gallon of water', 'Heat a room by one degree', 'Melt a pound of ice', 'Warm one pound of water by one degree Fahrenheit'], 3,
      'That''s the definition of a British thermal unit, roughly the heat of one kitchen match.');
  end if;

  if not exists (select 1 from public.academy_questions where lesson_id = l2) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (l2, 1, 'On its own, heat always flows:',
      array['From cold to warm', 'From warm to cold', 'Upward', 'Toward the outside of a building'], 1,
      'Heat moves from warm to cold, always, and never the other way on its own.'),
    (l2, 2, 'You double the temperature difference across a wall and change nothing else. The heat flow through the wall:',
      array['Doubles', 'Halves', 'Stays the same', 'Quadruples'], 0,
      'Heat flow = area x delta T / R, so twice the delta T means twice the heat flow.'),
    (l2, 3, 'A 500-square-foot wall, 40 degrees of temperature difference, R-10. About how many BTUs per hour are leaving?',
      array['200', '2,000', '20,000', '125'], 1,
      '500 x 40 = 20,000, divided by R-10 = 2,000 BTU per hour.'),
    (l2, 4, 'A batt installed with an air gap behind it loses most of its performance to:',
      array['Conduction', 'Convection', 'Radiation', 'Compression'], 1,
      'Air loops through the gap and carries heat around the insulation. R-value only measures conduction.');
  end if;
end $$;

select 'Update 0054 done: Academy lessons with videos and graded quizzes; lessons 1 and 2 added as drafts.' as status;
