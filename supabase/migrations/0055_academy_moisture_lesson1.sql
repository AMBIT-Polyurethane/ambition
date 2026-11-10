-- =====================================================================
-- AMBIT Intelligence update 0055 - Moisture lesson 1 "The Dew Point"
-- * Adds lesson 1 of the "Moisture, dew point & substrate prep" course: relative humidity, reading a
--   dew point off the psychrometric chart in three moves, and why vapor has to be stopped before it
--   reaches a cold metal roof (IRC R806.5 item 4 in climate zones 5 to 8).
-- * Graded 5-question quiz, pass mark 80 percent (4 of 5). Added as a draft until the video is uploaded
--   in Admin > Academy and Jeremiah signs it off.
-- Needs update 0054 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
declare
  v_course uuid;
  m1 uuid := 'acade003-0000-4000-8000-000000000003';
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;

  select id into v_course from public.courses where title = 'Moisture, dew point & substrate prep' order by sort limit 1;
  if v_course is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Moisture, dew point & substrate prep', 'Reading conditions before you spray', 4, 30, 3)
    returning id into v_course;
  end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values (m1, v_course, 1, 'The Dew Point',
    'Relative humidity is how full the air is with water vapor, and the dew point is where it''s completely full. Read a dew point off the psychrometric chart in three moves, and see why vapor has to be stopped before it reaches a cold roof.',
    5, 'When was the last time a customer blamed spray foam for high humidity, and what was the dew point that day?')
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = m1) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (m1, 1, 'The dew point is:',
      array['The outdoor temperature at night', 'The temperature at which the air is 100% full of water vapor, so any colder and water condenses', 'The relative humidity at noon', 'The temperature of the ground'], 1,
      'Relative humidity is how full the air is with water vapor. At the dew point it''s completely full.'),
    (m1, 2, 'On a psychrometric chart you''ve found the dry bulb temperature and the relative humidity curve. To read the dew point, you move:',
      array['Straight up', 'Straight right', 'Straight left to the 100% curve', 'Straight down to the bottom'], 2,
      'The 100% curve is the dew point scale, so straight left from your point gives the dew point.'),
    (m1, 3, 'It''s 85°F at 65% relative humidity, and the dew point is about 72°F. Which surface will get wet?',
      array['A wall at 80°F', 'An AC line at 60°F', 'A roof deck at 140°F', 'A window at 75°F'], 1,
      'Only a surface colder than the dew point collects condensation, and 60°F is below 72°F.'),
    (m1, 4, 'Inside it''s 70°F at 40% relative humidity (dew point about 45°F). The metal roof is at 10°F with open cell foam under it and no vapor retarder. What happens?',
      array['Vapor passes through the foam and condenses on the cold metal', 'Nothing, because the foam stops the vapor', 'The metal warms above 45°F', 'It only happens in summer'], 0,
      'Open cell isn''t a vapor retarder, so the vapor reaches the metal, which is far below the dew point.'),
    (m1, 5, 'In climate zones 5 to 8, the IRC says air-impermeable insulation in an unvented attic must:',
      array['Be at least 6 inches thick', 'Be covered with drywall', 'Be a Class II vapor retarder, or have a Class II vapor retarder coating on it', 'Be closed cell only'], 2,
      'IRC R806.5. Open cell meets it with a Class II vapor retarder coating.');
  end if;
end $$;

select 'Update 0055 done: Moisture lesson 1 "The Dew Point" added as a draft with its 5-question quiz.' as status;
