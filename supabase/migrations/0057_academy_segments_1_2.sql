-- =====================================================================
-- AMBIT Intelligence update 0057 - Academy segments 1 and 2: ten new lessons
-- * Building science fundamentals, lessons 3 to 8: R-Value & ASTM C518, Weighted R-Value & Assembly
--   Design, Infiltration & Exfiltration, Stack Effect & Neutral Pressure Planes, Climate Zones,
--   Latent Load & Sensible Load.
-- * Moisture, dew point & substrate prep, lessons 2 to 5: Air vs. Moisture vs. Vapor Barriers,
--   Diffusion & ASTM E96, Vapor Drive & Condensation (Cold Climate), Vapor Drive & Condensation (Hot Climate).
-- * Each lesson gets a graded 5-question quiz, pass mark 80 percent (4 of 5). All ten are added as
--   drafts until the videos are uploaded in Admin > Academy and Jeremiah signs them off.
-- Needs updates 0054 and 0055 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
declare
  v_bs uuid;
  v_mo uuid;
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;

  select id into v_bs from public.courses where title = 'Building science fundamentals' order by sort limit 1;
  if v_bs is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Building science fundamentals', 'Heat, air and moisture movement', 8, 45, 1)
    returning id into v_bs;
  end if;
  select id into v_mo from public.courses where title = 'Moisture, dew point & substrate prep' order by sort limit 1;
  if v_mo is null then
    insert into public.courses (title, subtitle, lessons, minutes, sort)
    values ('Moisture, dew point & substrate prep', 'Reading conditions before you spray', 5, 30, 3)
    returning id into v_mo;
  end if;
  update public.courses set lessons = greatest(coalesce(lessons, 0), 8) where id = v_bs;
  update public.courses set lessons = greatest(coalesce(lessons, 0), 5) where id = v_mo;


  -- Building science lesson 3: R-Value & ASTM C518
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade103-0000-4000-8000-000000000103', v_bs, 3, 'R-Value & ASTM C518',
    'What an R-value measures, how the ASTM C518 test measures it, and why temperature, moisture and age change it.',
    4, 'Have you seen insulation that didn''t perform like its label? What do you think was going on?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade103-0000-4000-8000-000000000103') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade103-0000-4000-8000-000000000103', 1, 'R-value measures:',
      array['How airtight a material is', 'How much moisture a material blocks', 'Resistance to heat flow by conduction', 'How much heat a material stores'], 2,
      'R-value is resistance to heat flow by conduction. Air leakage and moisture are separate properties.'),
    ('acade103-0000-4000-8000-000000000103', 2, 'Two inches of a material rated R-3.5 per inch gives about:',
      array['R-3.5', 'R-7', 'R-12.25', 'R-1.75'], 1,
      'R-values add: 2 inches × R-3.5 per inch = R-7.'),
    ('acade103-0000-4000-8000-000000000103', 3, 'ASTM C518 measures R-value by:',
      array['Placing the sample between a hot plate and a cold plate and measuring the heat flow through it', 'Blowing air through the sample', 'Soaking the sample in water', 'Burning the sample'], 0,
      'C518 is the heat flow meter test: hot plate, cold plate, and sensors that measure heat passing through.'),
    ('acade103-0000-4000-8000-000000000103', 4, 'Closed cell foam is sold on an "aged" R-value because:',
      array['It gets thicker over time', 'It absorbs heat as it ages', 'The code requires all products to be tested after ten years', 'The blowing agent in its cells slowly trades places with air, so R-value drops a little and then levels off'], 3,
      'Blowing agent slowly diffuses out and air diffuses in, so R-value settles to a lower, stable aged value.'),
    ('acade103-0000-4000-8000-000000000103', 5, 'Which of these does an R-value NOT account for?',
      array['The material''s thickness', 'Air leaking through and around the insulation', 'Conduction through the material', 'The type of material'], 1,
      'R-value describes conduction only. Air leaks and framing are why real walls differ from the label.');
  end if;

  -- Building science lesson 4: Weighted R-Value & Assembly Design
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade104-0000-4000-8000-000000000104', v_bs, 4, 'Weighted R-Value & Assembly Design',
    'How layers add in series, how framing creates a parallel path, and how to work out the real R-value of a whole wall.',
    4, 'Think of a wall you insulated recently. What was bridging the insulation, and how could the assembly have been designed better?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade104-0000-4000-8000-000000000104') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade104-0000-4000-8000-000000000104', 1, 'Heat moving straight through the layers of a wall (drywall, insulation, sheathing) meets resistances that:',
      array['Add together', 'Multiply', 'Average out', 'Only the biggest one counts'], 0,
      'Layers in series add their R-values.'),
    ('acade104-0000-4000-8000-000000000104', 2, 'Why is a wall with R-13 batts less than R-13 overall?',
      array['The drywall cancels part of the batt', 'Batts lose half their R-value in a wall', 'Wood framing conducts heat more easily than the insulation, creating paths around it', 'Air films subtract R-value'], 2,
      'Studs, plates and headers are a thermal bridge: a shortcut for heat around the insulation.'),
    ('acade104-0000-4000-8000-000000000104', 3, 'To combine the cavity path and the stud path, you:',
      array['Average the R-values', 'Average the U-factors weighted by area, then take one over the result', 'Add the R-values', 'Use the higher R-value'], 1,
      'The paths are in parallel, so you area-weight the U-factors and flip back to R.'),
    ('acade104-0000-4000-8000-000000000104', 4, 'In a typical 2x4 wood-framed wall, framing covers about:',
      array['5% of the wall', '25% of the wall', '50% of the wall', '75% of the wall'], 1,
      'About a quarter of a typical wood-framed wall is framing.'),
    ('acade104-0000-4000-8000-000000000104', 5, 'One inch of R-5 continuous insulation over the outside of the studs:',
      array['Only helps the cavity path', 'Lowers the wall''s R-value', 'Does nothing for a framed wall', 'Adds its R-value to both the cavity path and the stud path'], 3,
      'Because it runs over the studs, it adds to both paths, so the whole wall gains nearly R-6.');
  end if;

  -- Building science lesson 5: Infiltration & Exfiltration
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade105-0000-4000-8000-000000000105', v_bs, 5, 'Infiltration & Exfiltration',
    'What infiltration and exfiltration are, what drives air through a building, what that air carries, and how a blower door measures it.',
    4, 'What''s the leakiest spot you''ve found in a house, and how did you seal it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade105-0000-4000-8000-000000000105') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade105-0000-4000-8000-000000000105', 1, 'Exfiltration is:',
      array['Outside air leaking in', 'Air moved by a ventilation fan', 'Inside air leaking out', 'Heat moving through a wall'], 2,
      'Exfiltration is inside air leaking out; infiltration is outside air leaking in.'),
    ('acade105-0000-4000-8000-000000000105', 2, 'Air leaks through a hole in the building only when:',
      array['There''s a pressure difference across the hole', 'The insulation is wet', 'It''s colder outside', 'The HVAC is off'], 0,
      'No pressure difference, no airflow. Wind, the stack effect and fans create it.'),
    ('acade105-0000-4000-8000-000000000105', 3, 'Which of these does NOT drive air leakage?',
      array['Wind', 'The stack effect', 'Exhaust fans and dryers', 'The R-value of the insulation'], 3,
      'R-value is about conduction. The drivers are wind, stack effect and mechanical systems.'),
    ('acade105-0000-4000-8000-000000000105', 4, 'Fiberglass batts in a wall cavity:',
      array['Stop all air leakage', 'Slow conduction, but air passes right through them', 'Are a Class I vapor retarder', 'Make the wall airtight if they''re compressed'], 1,
      'Fibrous insulation isn''t an air barrier. Air sealing takes a continuous air barrier.'),
    ('acade105-0000-4000-8000-000000000105', 5, 'Under the IRC, a new home in climate zone 3 must test at or below:',
      array['3 ACH50', '5 ACH50', '7 ACH50', '10 ACH50'], 0,
      'The IRC limit is 3 ACH50 in climate zones 3 through 8, and 5 ACH50 in the hottest zones.');
  end if;

  -- Building science lesson 6: Stack Effect & Neutral Pressure Planes
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade106-0000-4000-8000-000000000106', v_bs, 6, 'Stack Effect & Neutral Pressure Planes',
    'How warm air rising drives air leakage, where the neutral pressure plane sits and why it moves, and which leaks to seal first.',
    4, 'Where have you seen the stack effect on a job: frost in the attic, stains, or a hot upstairs?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade106-0000-4000-8000-000000000106') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade106-0000-4000-8000-000000000106', 1, 'In winter, the stack effect pushes air:',
      array['Out near the top of the house and in near the bottom', 'In near the top and out near the bottom', 'Only through windows', 'Only when the wind blows'], 0,
      'Warm air rises, pushes out up high, and pulls cold air in down low.'),
    ('acade106-0000-4000-8000-000000000106', 2, 'The neutral pressure plane is:',
      array['The attic floor', 'The ground level of the house', 'The height where inside and outside air pressures are equal', 'Where the thermostat is mounted'], 2,
      'Above it the house pushes out; below it the house pulls in.'),
    ('acade106-0000-4000-8000-000000000106', 3, 'The stack effect gets stronger when:',
      array['The insulation is thicker', 'The building is taller or the temperature difference is larger', 'The house is painted a darker color', 'It rains'], 1,
      'Stack pressure grows with height above or below the neutral plane and with the temperature difference.'),
    ('acade106-0000-4000-8000-000000000106', 4, 'If most of a home''s leaks are up high in the attic floor, the neutral pressure plane:',
      array['Moves down', 'Stays exactly halfway up', 'Disappears', 'Moves up toward the leaks'], 3,
      'The neutral plane moves toward the biggest leaks, so more of the house pulls in outside air.'),
    ('acade106-0000-4000-8000-000000000106', 5, 'In summer with the air conditioning running, the stack effect:',
      array['Gets much stronger than in winter', 'Stops completely', 'Reverses: cool air leaks out low and hot air is pulled in high', 'Only affects the basement'], 2,
      'It flips, and it''s weaker because the temperature difference is smaller.');
  end if;

  -- Building science lesson 7: Climate Zones (Thermal & Moisture)
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade107-0000-4000-8000-000000000107', v_bs, 7, 'Climate Zones (Thermal & Moisture)',
    'How climate zone numbers and letters work, what the zone controls in the code, and where to look yours up.',
    4, 'What climate zone do you work in most, and what changes in your recommendations when you cross into the next one?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade107-0000-4000-8000-000000000107') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade107-0000-4000-8000-000000000107', 1, 'A climate zone''s number mainly tells you:',
      array['How hot or cold the climate is', 'How much it rains', 'The local code edition', 'The soil type'], 0,
      'The numbers run from hot to cold, based on yearly heating and cooling needs.'),
    ('acade107-0000-4000-8000-000000000107', 2, 'The letter after the number (A, B or C) stands for:',
      array['Altitude, Building type, Coast', 'Attic, Basement, Crawlspace', 'Air, Barrier, Ceiling', 'Moist, Dry, Marine'], 3,
      'A is moist, B is dry, C is marine.'),
    ('acade107-0000-4000-8000-000000000107', 3, 'Oklahoma City is in climate zone:',
      array['1A', '3A', '5B', '7'], 1,
      'Oklahoma County is zone 3A.'),
    ('acade107-0000-4000-8000-000000000107', 4, 'Under the IRC, frame walls need a Class I or II vapor retarder on the interior side in:',
      array['Zones 1–3', 'Zones 5–8 and Marine 4', 'All zones', 'Only zone 8'], 1,
      'IRC R702.7: zones 5, 6, 7, 8 and Marine 4, unless the wall meets one of the code''s alternatives.'),
    ('acade107-0000-4000-8000-000000000107', 5, 'Where do you look up a county''s climate zone?',
      array['IRC Table N1101.7 (IECC Table R301.1)', 'The AC data plate', 'ASTM C518', 'The foam''s data sheet'], 0,
      'IRC Table N1101.7 and IECC Table R301.1 list every county''s zone.');
  end if;

  -- Building science lesson 8: Latent Load & Sensible Load
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade108-0000-4000-8000-000000000108', v_bs, 8, 'Latent Load & Sensible Load',
    'The difference between sensible and latent load, why foamed homes can get clammy, and how to match the HVAC system to the house.',
    4, 'Have you had a humidity call after a foam job? What size was the AC, and what fixed it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade108-0000-4000-8000-000000000108') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade108-0000-4000-8000-000000000108', 1, 'Sensible heat is heat that:',
      array['Is hidden in water vapor', 'Only comes from people', 'Changes the air''s temperature and shows on a thermometer', 'Can''t be removed by an AC'], 2,
      'Sensible heat changes temperature. Latent heat is the energy in water vapor.'),
    ('acade108-0000-4000-8000-000000000108', 2, 'Latent heat is:',
      array['Heat from the sun', 'The heat tied up in water vapor; removing it dries the air without changing its temperature', 'Heat that moves through walls', 'Heat from lights'], 1,
      'Removing latent heat means condensing water out of the air.'),
    ('acade108-0000-4000-8000-000000000108', 3, 'Condensing one pound of water out of the air removes about:',
      array['1 BTU', '100 BTU', '1,060 BTU', '10,000 BTU'], 2,
      'The latent heat of water is a little over 1,000 BTU per pound.'),
    ('acade108-0000-4000-8000-000000000108', 4, 'After a house is foamed, the AC short-cycles and humidity rises. The most likely reason is:',
      array['The foam is releasing moisture', 'The thermostat is broken', 'The latent load disappeared', 'The sensible load dropped, so the AC satisfies the thermostat before removing enough water'], 3,
      'Foam cuts the sensible load; the latent load stays, so an oversized AC runs too briefly to dehumidify.'),
    ('acade108-0000-4000-8000-000000000108', 5, 'Which is used to size cooling equipment to the house''s loads?',
      array['ASTM C518', 'IRC R806.5', 'ACCA Manual J and Manual S', 'ASTM E96'], 2,
      'Manual J calculates the loads; Manual S selects equipment to match them.');
  end if;

  -- Moisture lesson 2: Air vs. Moisture vs. Vapor Barriers
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade202-0000-4000-8000-000000000202', v_mo, 2, 'Air vs. Moisture vs. Vapor Barriers',
    'What water-resistive barriers, air barriers and vapor retarders each do, the three vapor retarder classes, and which jobs open and closed cell foam do.',
    4, 'Where have you seen a wall fail because the wrong barrier was used, or one was missing?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade202-0000-4000-8000-000000000202') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade202-0000-4000-8000-000000000202', 1, 'House wrap behind siding is mainly a:',
      array['Water-resistive barrier that sheds liquid water but lets vapor through', 'Class I vapor retarder', 'Thermal insulation', 'Radiant barrier'], 0,
      'A water-resistive barrier stops rain but is usually vapor-open so the wall can dry.'),
    ('acade202-0000-4000-8000-000000000202', 2, 'To work, an air barrier must be:',
      array['At least 6 mil thick', 'Painted', 'Installed only in the attic', 'Continuous around the whole building, sealed at every joint and hole'], 3,
      'One unsealed gap and the air finds it.'),
    ('acade202-0000-4000-8000-000000000202', 3, 'Under the IRC, a Class II vapor retarder is rated at:',
      array['0.1 perm or less', 'More than 0.1 up to 1.0 perm', 'More than 1 up to 10 perms', 'More than 10 perms'], 1,
      'Class I ≤ 0.1, Class II > 0.1 to 1.0, Class III > 1.0 to 10 perms.'),
    ('acade202-0000-4000-8000-000000000202', 4, 'Kraft-faced batts are an example of a:',
      array['Class I vapor retarder', 'Class II vapor retarder', 'Class III vapor retarder', 'Water-resistive barrier'], 1,
      'The IRC lists kraft-faced fiberglass batts as Class II.'),
    ('acade202-0000-4000-8000-000000000202', 5, 'Open cell foam at full thickness is:',
      array['An air barrier and a Class I vapor retarder', 'An air barrier, but vapor moves through it', 'Neither an air barrier nor a vapor retarder', 'A water-resistive barrier'], 1,
      'Open cell stops air but is vapor-open; closed cell at about 2 inches usually reaches Class II.');
  end if;

  -- Moisture lesson 3: Diffusion & ASTM E96
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade203-0000-4000-8000-000000000203', v_mo, 3, 'Diffusion & ASTM E96',
    'How vapor diffuses through materials, what a perm measures, how the ASTM E96 cup test works, and why thickness matters.',
    4, 'Pick a foam you spray: what are its perms at your usual thickness, and what vapor retarder class does that make it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade203-0000-4000-8000-000000000203') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade203-0000-4000-8000-000000000203', 1, 'Vapor diffusion moves water vapor:',
      array['Through solid materials, from higher vapor pressure to lower', 'Only through holes and cracks', 'Only upward', 'Only when it rains'], 0,
      'Diffusion goes straight through materials, from more vapor to less.'),
    ('acade203-0000-4000-8000-000000000203', 2, 'A lower perm rating means the material:',
      array['Lets more vapor through', 'Has a higher R-value', 'Blocks vapor better', 'Is a better air barrier'], 2,
      'Lower perms, tighter to vapor.'),
    ('acade203-0000-4000-8000-000000000203', 3, 'ASTM E96 measures perms by:',
      array['Heating one side of the sample', 'Sealing a sample over a cup and weighing how much vapor passes through over time', 'Pressurizing a house', 'Soaking the sample in water'], 1,
      'The cup holds a desiccant (dry cup) or water (wet cup); the weight change shows the vapor that moved.'),
    ('acade203-0000-4000-8000-000000000203', 4, 'If you double the thickness of a uniform material, its perm rating:',
      array['Doubles', 'Stays the same', 'Drops to zero', 'Roughly halves'], 3,
      'Permeance is inversely proportional to thickness.'),
    ('acade203-0000-4000-8000-000000000203', 5, 'The IRC''s vapor retarder classes are based on which ASTM E96 method?',
      array['Either one', 'The wet cup (water) method', 'The dry cup (desiccant) method', 'Neither; they use ASTM C518'], 2,
      'The classes are based on the dry cup method.');
  end if;

  -- Moisture lesson 4: Vapor Drive & Condensation (Cold Climate)
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade204-0000-4000-8000-000000000204', v_mo, 4, 'Vapor Drive & Condensation (Cold Climate)',
    'Why vapor drives outward in winter, where it condenses in walls and roofs, and the three ways to prevent it.',
    4, 'In your area, what''s the coldest surface in a typical wall in January, and what keeps moisture off it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade204-0000-4000-8000-000000000204') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade204-0000-4000-8000-000000000204', 1, 'In a cold-climate winter, vapor drives:',
      array['From inside to outside', 'From outside to inside', 'Only downward', 'Nowhere; cold air holds no vapor'], 0,
      'Warm indoor air holds more vapor, so vapor pressure is higher inside.'),
    ('acade204-0000-4000-8000-000000000204', 2, 'Indoor air at 70°F and 35% relative humidity has a dew point of about:',
      array['20°F', '41°F', '55°F', '70°F'], 1,
      '70°F at 35% RH has a dew point of about 41°F.'),
    ('acade204-0000-4000-8000-000000000204', 3, 'In a cold-climate wall, condensation usually forms first on:',
      array['The back of the drywall', 'The siding', 'The face of the insulation', 'The back of the exterior sheathing'], 3,
      'It''s the first surface the vapor reaches that''s below the indoor dew point.'),
    ('acade204-0000-4000-8000-000000000204', 4, 'Most of the moisture that reaches a cold wall cavity arrives by:',
      array['Diffusion through drywall', 'Air leakage', 'Rain', 'The air conditioner'], 1,
      'Air leaks carry far more moisture than diffusion, so air seal first.'),
    ('acade204-0000-4000-8000-000000000204', 5, 'Closed cell foam sprayed against the sheathing helps because it:',
      array['Keeps the sheathing warmer and slows the vapor', 'Makes the wall vapor-open', 'Adds moisture to the wall', 'Only works in summer'], 0,
      'It warms the condensing surface and acts as a vapor retarder.');
  end if;

  -- Moisture lesson 5: Vapor Drive & Condensation (Hot Climate)
  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion)
  values ('acade205-0000-4000-8000-000000000205', v_mo, 5, 'Vapor Drive & Condensation (Hot Climate)',
    'Why vapor drives inward in hot, humid weather, where summer condensation forms, and how foam and HVAC choices prevent it.',
    4, 'Have you seen sweating ducts, or mold behind vinyl wallpaper? What fixed it?')
  on conflict (id) do nothing;
  if not exists (select 1 from public.academy_questions where lesson_id = 'acade205-0000-4000-8000-000000000205') then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    ('acade205-0000-4000-8000-000000000205', 1, 'In a hot, humid summer with the AC running, vapor drives:',
      array['From inside to outside', 'Only upward', 'From outside to inside', 'Nowhere'], 2,
      'The hot, humid outdoor air holds more vapor than the cooled indoor air.'),
    ('acade205-0000-4000-8000-000000000205', 2, 'Outdoor air at 90°F and 60% relative humidity has a dew point of about:',
      array['55°F', '60°F', '74°F', '90°F'], 2,
      '90°F at 60% RH has a dew point of about 74°F.'),
    ('acade205-0000-4000-8000-000000000205', 3, 'Why is vinyl wallpaper on an air-conditioned exterior wall a problem in hot, humid climates?',
      array['It adds R-value', 'It traps inward-moving vapor against the cool wall, where it can condense and grow mold', 'It lets the wall dry too fast', 'It stops the AC from working'], 1,
      'A low-perm interior layer traps the vapor on the cold side.'),
    ('acade205-0000-4000-8000-000000000205', 4, 'A duct carrying 55°F air through a vented attic full of air with a 74°F dew point will:',
      array['Stay dry', 'Freeze', 'Heat up the attic', 'Sweat'], 3,
      'Any surface below the dew point collects condensation.'),
    ('acade205-0000-4000-8000-000000000205', 5, 'Under the IRC, interior vapor retarders on frame walls are required in:',
      array['All climate zones', 'Zones 1–3', 'Zones 5–8 and Marine 4 only', 'Only warm-humid areas'], 2,
      'They''re required only in the cold zones; in warm-humid areas they should be avoided.');
  end if;
end $$;

select 'Update 0057 done: ten Academy lessons (Building science 3 to 8, Moisture 2 to 5) added as drafts with their quizzes.' as status;
