-- =====================================================================
-- AMBIT Intelligence update 0056 - Academy lessons in Spanish
-- * A lesson can have a Spanish version: its own title, video, summary and graded quiz, linked to the
--   English lesson (translation_of). Students see an English / Español switch on the lesson, and the app
--   remembers the language each person picks (profiles.academy_lang).
-- * A lesson counts as passed in either language.
-- * Adds the Spanish version of lesson 1, "¿Qué es el calor?", with its 5-question quiz, as a draft until
--   its video is uploaded and the Spanish is approved.
-- Needs update 0054 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;
end $$;

alter table public.academy_lessons add column if not exists lang text not null default 'en';
alter table public.academy_lessons add column if not exists translation_of uuid references public.academy_lessons(id) on delete cascade;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'academy_lessons_lang') then
    alter table public.academy_lessons add constraint academy_lessons_lang check (lang in ('en', 'es'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'academy_lessons_translation') then
    alter table public.academy_lessons add constraint academy_lessons_translation
      check (translation_of is null or (translation_of <> id and lang <> 'en'));
  end if;
end $$;
create unique index if not exists academy_lessons_one_per_lang on public.academy_lessons (translation_of, lang) where translation_of is not null;

-- The language each person wants their lessons in (null = English).
alter table public.profiles add column if not exists academy_lang text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_academy_lang') then
    alter table public.profiles add constraint profiles_academy_lang check (academy_lang is null or academy_lang in ('en', 'es'));
  end if;
end $$;

create or replace function public.academy_set_lang(p_lang text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_lang not in ('en', 'es') then raise exception 'Pick English or Spanish.'; end if;
  update public.profiles set academy_lang = p_lang where id = auth.uid();
end $$;
revoke all on function public.academy_set_lang(text) from public, anon;
grant execute on function public.academy_set_lang(text) to authenticated;

-- ---------- Lesson 1 in Spanish (draft) ----------------------------
do $$
declare
  l1 uuid := 'acade001-0000-4000-8000-000000000001';
  es uuid := 'acade001-e500-4000-8000-000000000001';
begin
  if not exists (select 1 from public.academy_lessons where id = l1) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, '¿Qué es el calor?',
    'Las moléculas siempre se están moviendo, la temperatura te dice qué tan rápido, y el calor es energía que va de lo más caliente a lo más frío. Además, qué es un BTU.',
    4, '¿Dónde has visto algo dilatarse o moverse en una obra porque se calentó?', 'es', l1, l.pass_pct
  from public.academy_lessons l where l.id = l1
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'La temperatura mide:',
      array['Cuánto pesa un material', 'Cuánta humedad contiene', 'Qué tan rápido se mueven sus moléculas, en promedio', 'Cuánto aire tiene atrapado'], 2,
      'La temperatura es la velocidad promedio de las moléculas: más rápido significa más caliente.'),
    (es, 2, 'Las moléculas de un cubo de hielo:',
      array['Vibran en su lugar', 'Están completamente quietas', 'Vuelan libremente como un gas', 'Solo se mueven cuando el hielo empieza a derretirse'], 0,
      'Las moléculas siempre se mueven. En un sólido están muy juntas y vibran en su lugar.'),
    (es, 3, 'Se calienta un extremo de una barra de acero. ¿Qué pasa?',
      array['Las moléculas se frenan y la barra se encoge', 'Las moléculas se aceleran, se separan un poco y la barra se alarga un poquito', 'Nada cambia hasta que el acero se derrite', 'Solo cambia el extremo caliente; el resto queda igual'], 1,
      'Las moléculas más rápidas ocupan un poco más de espacio, por eso los materiales se dilatan al calentarse.'),
    (es, 4, 'Por sí solo, el calor fluye:',
      array['De lo más frío a lo más caliente', 'De lo más caliente a lo más frío', 'Solo hacia arriba', 'Solo a través del metal'], 1,
      'El calor es energía en movimiento y, por sí solo, siempre fluye de lo más caliente a lo más frío.'),
    (es, 5, 'Un BTU es el calor que se necesita para:',
      array['Hervir un galón de agua', 'Calentar un cuarto un grado', 'Derretir una libra de hielo', 'Calentar una libra de agua un grado Fahrenheit'], 3,
      'Esa es la definición de la unidad térmica británica, más o menos el calor de un cerillo de cocina.');
  end if;
end $$;

select 'Update 0056 done: Academy lessons can have a Spanish version; lesson 1 "¿Qué es el calor?" added as a draft.' as status;
