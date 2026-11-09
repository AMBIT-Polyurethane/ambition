-- =====================================================================
-- Ask AMBIT / AMBIT Intelligence: Jeremiah's building-science teaching, Session 1 (Nov 8, 2026)
-- From "AMBIT Intelligence Building Science Knowledge Base — Session 1". Safe to run again: Session 1 is replaced.
-- =====================================================================
delete from public.ai_sources where file_name = 'kb-session-1';

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Climate zone governs every assembly: delta T, building use, and how to reason$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

How to reason (Jeremiah's rules):

1. Before answering any assembly, vapor retarder, R-value or humidity question, establish the climate zone (from ZIP code or county) and the building's use. An answer that is right in one climate zone can be exactly backward in another.

2. Reason from delta T, dew point and the direction of vapor drive, not from rules of thumb or anything "everyone does" in one region.

3. Codes come only from the IECC, IRC or IBC. HVAC guidance comes only from ACCA, ASHRAE or neutral parties. Spray foam and HVAC industry marketing (including SPFA material) is never a source.

4. In mixed climates (CZ 3–4) where the seasonal split is close to even, say so plainly, give the "good enough" answer, and name the risk it carries.

Teaching. There are no hard-and-fast rules for designing the perfect building assembly. Almost every specification depends on climate zone.

Climate zones are the tool for understanding delta T (ΔT), the temperature difference between two places:

- one side of a wall to the other

- one end of a supply duct to the other

- one zone of a building to another, such as an encapsulated attic versus the conditioned interior

The common failure. HVAC contractors, spray foam contractors and home builders repeat advice that was correct where they first saw it, without understanding why it worked there. Moving from one climate zone to another can turn the right answer completely opposite. Nowhere is this more true than the question of when and where a vapor retarder or vapor barrier is required (next section).

Two inputs the AI must establish before specifying any assembly:

1. The climate zone, from the project's ZIP code or county.

2. The building's use: occupancy, process loads and indoor humidity sources (see the coral farm case below).$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Climate zone governs every assembly: delta T, building use, and how to reason$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

How to reason (Jeremiah's rules):

1. Before answering any assembly, vapor retarder, R-value or humidity question, establish the climate zone (from ZIP code or county) and the building's use. An answer that is right in one climate zone can be exactly backward in another.

2. Reason from delta T, dew point and the direction of vapor drive, not from rules of thumb or anything "everyone does" in one region.

3. Codes come only from the IECC, IRC or IBC. HVAC guidance comes only from ACCA, ASHRAE or neutral parties. Spray foam and HVAC industry marketing (including SPFA material) is never a source.

4. In mixed climates (CZ 3–4) where the seasonal split is close to even, say so plainly, give the "good enough" answer, and name the risk it carries.

Teaching. There are no hard-and-fast rules for designing the perfect building assembly. Almost every specification depends on climate zone.$kb$),
  (1, $kb$Building science, Session 1: Climate zone governs every assembly: delta T, building use, and how to reason$kb$, $kb$Almost every specification depends on climate zone.

Climate zones are the tool for understanding delta T (ΔT), the temperature difference between two places:

- one side of a wall to the other

- one end of a supply duct to the other

- one zone of a building to another, such as an encapsulated attic versus the conditioned interior

The common failure. HVAC contractors, spray foam contractors and home builders repeat advice that was correct where they first saw it, without understanding why it worked there. Moving from one climate zone to another can turn the right answer completely opposite. Nowhere is this more true than the question of when and where a vapor retarder or vapor barrier is required (next section).

Two inputs the AI must establish before specifying any assembly:

1. The climate zone, from the project's ZIP code or county.

2. The building's use: occupancy, process loads and indoor humidity sources (see the coral farm case below).$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Vapor drive and vapor retarders by climate zone (housewrap is not a vapor barrier; the humid Oklahoma year; open-cell in the coral farmer's metal building)$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. Water vapor diffuses from the warm, wet side of an assembly toward the cool, dry side. A vapor retarder belongs on the warm, wet side, and which side that is depends on the climate.

| Climate | Usually warmer and wetter side | Direction of vapor drive | Vapor retarder location |
|---|---|---|---|
| Warm, humid (Gulf Coast type) | Outside | Outside to inside | Exterior face of the assembly |
| Cold (North Dakota type) | Inside | Inside to outside | Interior face of the assembly |
| Mixed (CZ 3–4, including Oklahoma) | Close to an even split across the year | Reverses with the seasons | No clean answer; see below |

Mixed climates: the "good enough" answer. In CZ 3–4 the number of days when the outside is warmer runs close to even with the days when the inside is warmer. In Oklahoma it is not common to see a vapor retarder on either side of a wall. That is technically unsound from a building-science perspective, but because the split is nearly even, builders and architects have gotten away with it. Even with full training, Jeremiah sometimes has to give a "good enough" answer here.

Moisture barrier is not vapor barrier. Most builders still believe Tyvek (housewrap) is a vapor barrier because it is labeled a moisture barrier. It is not.

- A moisture barrier stops bulk (liquid) water.

- Water vapor is a very small grouping of molecules that passes through many seemingly solid materials by diffusion. Housewrap lets it through.

- A vapor retarder slows diffusion; a vapor barrier essentially stops it.

Case: the humid Oklahoma year (about 2024). One of the most humid years on record, with dew points sitting around 70–75°F. With no exterior vapor retarder, vapor diffused inward through walls and condensed on the cool back side of the drywall inside the wall cavity, leading to mold. "Getting away with it" lasts only until Mother Nature changes the variables and shines a light on a less-than-ideal practice.

Case: the coral farmer's metal building. As a young insulation contractor, Jeremiah insulated an Oklahoma metal building with open-cell foam, something he had done many times without complaint. Even then he was riding the line: had the building become a barndominium with ordinary occupant humidity, vapor could diffuse through the open-cell foam, meet the cold metal and condense in winter. The owner turned out to be a coral farmer who installed saltwater tanks holding thousands of gallons. The first winter, the indoor dew point was reached almost constantly and the building turned into a rainforest.

Lessons the AI applies from these cases:

1. Open-cell foam is vapor-permeable. Against a cold surface (metal, sheathing) it depends on low indoor humidity or a separate vapor retarder.

2. Always ask what the building will be used for. Process humidity (tanks, pools, livestock, kitchens, laundries) changes the right assembly.

3. Every building designer, HVAC contractor and spray foam contractor must be able to read a psychrometric chart. Jeremiah's recorded lesson on it (Ep. 1) is being transcribed into this knowledge base.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Vapor drive and vapor retarders by climate zone (housewrap is not a vapor barrier; the humid Oklahoma year; open-cell in the coral farmer's metal building)$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. Water vapor diffuses from the warm, wet side of an assembly toward the cool, dry side. A vapor retarder belongs on the warm, wet side, and which side that is depends on the climate.

| Climate | Usually warmer and wetter side | Direction of vapor drive | Vapor retarder location |
|---|---|---|---|
| Warm, humid (Gulf Coast type) | Outside | Outside to inside | Exterior face of the assembly |
| Cold (North Dakota type) | Inside | Inside to outside | Interior face of the assembly |
| Mixed (CZ 3–4, including Oklahoma) | Close to an even split across the year | Reverses with the seasons | No clean answer; see below |$kb$),
  (1, $kb$Building science, Session 1: Vapor drive and vapor retarders by climate zone (housewrap is not a vapor barrier; the humid Oklahoma year; open-cell in the coral farmer's metal building)$kb$, $kb$Mixed climates: the "good enough" answer. In CZ 3–4 the number of days when the outside is warmer runs close to even with the days when the inside is warmer. In Oklahoma it is not common to see a vapor retarder on either side of a wall. That is technically unsound from a building-science perspective, but because the split is nearly even, builders and architects have gotten away with it. Even with full training, Jeremiah sometimes has to give a "good enough" answer here.

Moisture barrier is not vapor barrier. Most builders still believe Tyvek (housewrap) is a vapor barrier because it is labeled a moisture barrier. It is not.

- A moisture barrier stops bulk (liquid) water.

- Water vapor is a very small grouping of molecules that passes through many seemingly solid materials by diffusion. Housewrap lets it through.

- A vapor retarder slows diffusion; a vapor barrier essentially stops it.$kb$),
  (2, $kb$Building science, Session 1: Vapor drive and vapor retarders by climate zone (housewrap is not a vapor barrier; the humid Oklahoma year; open-cell in the coral farmer's metal building)$kb$, $kb$Housewrap lets it through.

- A vapor retarder slows diffusion; a vapor barrier essentially stops it.

Case: the humid Oklahoma year (about 2024). One of the most humid years on record, with dew points sitting around 70–75°F. With no exterior vapor retarder, vapor diffused inward through walls and condensed on the cool back side of the drywall inside the wall cavity, leading to mold. "Getting away with it" lasts only until Mother Nature changes the variables and shines a light on a less-than-ideal practice.

Case: the coral farmer's metal building. As a young insulation contractor, Jeremiah insulated an Oklahoma metal building with open-cell foam, something he had done many times without complaint. Even then he was riding the line: had the building become a barndominium with ordinary occupant humidity, vapor could diffuse through the open-cell foam, meet the cold metal and condense in winter. The owner turned out to be a coral farmer who installed saltwater tanks holding thousands of gallons.$kb$),
  (3, $kb$Building science, Session 1: Vapor drive and vapor retarders by climate zone (housewrap is not a vapor barrier; the humid Oklahoma year; open-cell in the coral farmer's metal building)$kb$, $kb$The owner turned out to be a coral farmer who installed saltwater tanks holding thousands of gallons. The first winter, the indoor dew point was reached almost constantly and the building turned into a rainforest.

Lessons the AI applies from these cases:

1. Open-cell foam is vapor-permeable. Against a cold surface (metal, sheathing) it depends on low indoor humidity or a separate vapor retarder.

2. Always ask what the building will be used for. Process humidity (tanks, pools, livestock, kitchens, laundries) changes the right assembly.

3. Every building designer, HVAC contractor and spray foam contractor must be able to read a psychrometric chart. Jeremiah's recorded lesson on it (Ep. 1) is being transcribed into this knowledge base.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: R-value requirements by climate zone (Hawaii, North Dakota, Oklahoma attics and ductwork)$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. The R-value a building needs rises with the ΔT it faces and how many hours a year it faces it.

- Hawaii: a mild climate; little R-value is needed to heat and cool a dwelling affordably.

- North Dakota: the ΔT from inside the house to outside can run upwards of 80°F.

- Oklahoma: attics can reach 165°F or more. Above a 75°F interior that is a 90°F ΔT across the ceiling, and across any ductwork in that attic, all summer.

In the North Dakota and Oklahoma cases a much larger amount of insulation is needed to keep comfort affordable. Quoting a Hawaii or Gulf Coast R-value in either place is the climate-zone misquote described above.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: R-value requirements by climate zone (Hawaii, North Dakota, Oklahoma attics and ductwork)$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. The R-value a building needs rises with the ΔT it faces and how many hours a year it faces it.

- Hawaii: a mild climate; little R-value is needed to heat and cool a dwelling affordably.

- North Dakota: the ΔT from inside the house to outside can run upwards of 80°F.

- Oklahoma: attics can reach 165°F or more. Above a 75°F interior that is a 90°F ΔT across the ceiling, and across any ductwork in that attic, all summer.

In the North Dakota and Oklahoma cases a much larger amount of insulation is needed to keep comfort affordable. Quoting a Hawaii or Gulf Coast R-value in either place is the climate-zone misquote described above.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Spray foam R-value myths: the 1990s savings, the diminishing-returns chart, ASTM C518, foam depths vs 2026 code, ROI and energy prices$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. The industry's belief that spray foam "performs like double its R-value" grew out of real results from the 1990s. Those results came from everything foam fixed besides R-value. The claim is not true today, and the depths the industry installs have not kept up with code.

The 1995 code home in Oklahoma

- Walls: you were lucky to get an R-13 fiberglass batt.

- Attic: about 6 inches of blown fiberglass.

- Ducts: no duct-sealing standard. Flex duct was joined with a zip tie, no mastic, no seals, so duct leakage was everywhere.

- Attics were severely under-vented and reached about 185°F.

- No air-sealing standard of any kind on the envelope.

- Windows were far leakier (looser manufacturing tolerances).

- No LED lighting, and the list goes on.

What 1990s spray foam did. A contractor sprayed 3½ inches of open-cell in the walls (R-13) and 6 inches on the roof deck (about R-23). Nominally the same R-value as the code home, yet it covered a multitude of sins:

- the house was far better air-sealed;

- all of that leaky ductwork was now inside conditioned space;

- the 185°F attic became conditioned space, removing thousands to tens of thousands of BTUs of heat load from the ductwork while the air conditioner ran.

A 50% or greater energy reduction was entirely plausible, because of air sealing and duct location, not because foam carried more R-value.

The myth that was born: the "diminishing returns R-value chart." Spray foam contractors credited the savings to the foam itself and propagated the claim industry-wide; it persists in 2026. Some spray foam manufacturers still publish these charts on their websites, and at least one energy modeling agency still models foam at roughly double its actual performance. This is not true.

The test is the same. ASTM C518 is the exact test used to establish R-value for both fiberglass and spray foam. At equal R-value they perform the same. One real limitation of C518: it measures heat flow only after the material reaches steady state. A material that takes much longer to heat up may carry a real-world benefit, but there is not much data today to show how significant that property is. Never quote a number for it.

2026: code has fixed the sins foam used to cover.

- Air sealing is required.

- Fiber insulation must have a physical air barrier on all six sides.

- Duct sealing is standard, and duct insulation has gone from R-6 to R-8.

- Attics are better vented; windows have better tolerances; and the list goes on.

Yet across much of the country the spray foam industry has not increased the R-value it installs. When Jeremiah energy-models an Oklahoma home built to the 2015 or 2018 energy code against the same home built with standard foam depths, the performance is similar.

Position. Spray foam R-values must move forward to keep up with the times. Contractors are glad that fiberglass and cellulose requirements rose and closed the cost gap, but foam has to keep its energy-efficiency edge ahead of the curve, and that requires more R-value. Foam's other properties still make it the more valuable product; they do not substitute for depth.

ROI and the price of energy. The diminishing-returns chart does not account for the cost of energy at all. This flaw runs through most of the building industry's understanding of ROI on efficiency features: the math is done at today's energy price, or at best assumes a 2–3% annual increase. Much data points to rapidly rising demand from AI and data centers, so energy costs may skyrocket for building and home owners in the near future. That completely changes the ROI of energy-efficient features bought today. (Position.)$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Spray foam R-value myths: the 1990s savings, the diminishing-returns chart, ASTM C518, foam depths vs 2026 code, ROI and energy prices$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. The industry's belief that spray foam "performs like double its R-value" grew out of real results from the 1990s. Those results came from everything foam fixed besides R-value. The claim is not true today, and the depths the industry installs have not kept up with code.

The 1995 code home in Oklahoma

- Walls: you were lucky to get an R-13 fiberglass batt.

- Attic: about 6 inches of blown fiberglass.

- Ducts: no duct-sealing standard. Flex duct was joined with a zip tie, no mastic, no seals, so duct leakage was everywhere.

- Attics were severely under-vented and reached about 185°F.

- No air-sealing standard of any kind on the envelope.

- Windows were far leakier (looser manufacturing tolerances).

- No LED lighting, and the list goes on.$kb$),
  (1, $kb$Building science, Session 1: Spray foam R-value myths: the 1990s savings, the diminishing-returns chart, ASTM C518, foam depths vs 2026 code, ROI and energy prices$kb$, $kb$What 1990s spray foam did. A contractor sprayed 3½ inches of open-cell in the walls (R-13) and 6 inches on the roof deck (about R-23). Nominally the same R-value as the code home, yet it covered a multitude of sins:

- the house was far better air-sealed;

- all of that leaky ductwork was now inside conditioned space;

- the 185°F attic became conditioned space, removing thousands to tens of thousands of BTUs of heat load from the ductwork while the air conditioner ran.

A 50% or greater energy reduction was entirely plausible, because of air sealing and duct location, not because foam carried more R-value.

The myth that was born: the "diminishing returns R-value chart." Spray foam contractors credited the savings to the foam itself and propagated the claim industry-wide; it persists in 2026. Some spray foam manufacturers still publish these charts on their websites, and at least one energy modeling agency still models foam at roughly double its actual performance. This is not true.$kb$),
  (2, $kb$Building science, Session 1: Spray foam R-value myths: the 1990s savings, the diminishing-returns chart, ASTM C518, foam depths vs 2026 code, ROI and energy prices$kb$, $kb$This is not true.

The test is the same. ASTM C518 is the exact test used to establish R-value for both fiberglass and spray foam. At equal R-value they perform the same. One real limitation of C518: it measures heat flow only after the material reaches steady state. A material that takes much longer to heat up may carry a real-world benefit, but there is not much data today to show how significant that property is. Never quote a number for it.

2026: code has fixed the sins foam used to cover.

- Air sealing is required.

- Fiber insulation must have a physical air barrier on all six sides.

- Duct sealing is standard, and duct insulation has gone from R-6 to R-8.

- Attics are better vented; windows have better tolerances; and the list goes on.

Yet across much of the country the spray foam industry has not increased the R-value it installs. When Jeremiah energy-models an Oklahoma home built to the 2015 or 2018 energy code against the same home built with standard foam depths, the performance is similar.$kb$),
  (3, $kb$Building science, Session 1: Spray foam R-value myths: the 1990s savings, the diminishing-returns chart, ASTM C518, foam depths vs 2026 code, ROI and energy prices$kb$, $kb$Position. Spray foam R-values must move forward to keep up with the times. Contractors are glad that fiberglass and cellulose requirements rose and closed the cost gap, but foam has to keep its energy-efficiency edge ahead of the curve, and that requires more R-value. Foam's other properties still make it the more valuable product; they do not substitute for depth.

ROI and the price of energy. The diminishing-returns chart does not account for the cost of energy at all. This flaw runs through most of the building industry's understanding of ROI on efficiency features: the math is done at today's energy price, or at best assumes a 2–3% annual increase. Much data points to rapidly rising demand from AI and data centers, so energy costs may skyrocket for building and home owners in the near future. That completely changes the ROI of energy-efficient features bought today. (Position.)$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Homes too tight? Indoor humidity is the HVAC contractor's job (dehumidifiers, bath fans, the ERV and fresh-air myth)$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. The fear that spray foam makes a home too tight is misplaced. Homes have already gotten tighter whether foam is used or not. Handling both temperature and humidity inside the home is solely the HVAC contractor's job, and that is where very little progress has been made.

Position: what the IRC should codify, at least in southern climates

1. Whole-home dehumidifiers.

2. Larger bathroom exhaust fans. Today's 50 CFM-rated units typically move only about 18 CFM once installed. With whole-home on-demand (tankless) water heaters now common, a minimum of 110 CFM per bathroom.

3. Bathroom exhaust fans controlled by humidistats.

4. An exhaust fan in every laundry room, given today's larger-capacity washers and dryers.

5. No single-stage HVAC systems. Require 3-, 4- or 5-stage compressors or variable-speed systems.

The ERV / fresh-air myth. HVAC contractors and insulators routinely claim an ERV or fresh-air system will take care of indoor humidity. That is true only when outdoor humidity is considerably lower than indoor humidity, which is rarely true in much of the country and never true all the time in most of it. Even then, the fresh-air volumes ASHRAE 62.2 calls for are too small to matter when indoor moisture generation is considerable.

- Fresh-air systems exist to meet ASHRAE 62.2, the residential ventilation standard for clean, breathable air. They have nothing to do with humidity control.

- The misinformation comes from very dry climates, where fresh air does happen to lower indoor humidity. The system is not designed to do that.

- Because fresh air cannot be relied on for moisture, better exhaust and dehumidification standards have to be adopted.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Homes too tight? Indoor humidity is the HVAC contractor's job (dehumidifiers, bath fans, the ERV and fresh-air myth)$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Teaching. The fear that spray foam makes a home too tight is misplaced. Homes have already gotten tighter whether foam is used or not. Handling both temperature and humidity inside the home is solely the HVAC contractor's job, and that is where very little progress has been made.

Position: what the IRC should codify, at least in southern climates

1. Whole-home dehumidifiers.

2. Larger bathroom exhaust fans. Today's 50 CFM-rated units typically move only about 18 CFM once installed. With whole-home on-demand (tankless) water heaters now common, a minimum of 110 CFM per bathroom.

3. Bathroom exhaust fans controlled by humidistats.

4. An exhaust fan in every laundry room, given today's larger-capacity washers and dryers.

5. No single-stage HVAC systems. Require 3-, 4- or 5-stage compressors or variable-speed systems.$kb$),
  (1, $kb$Building science, Session 1: Homes too tight? Indoor humidity is the HVAC contractor's job (dehumidifiers, bath fans, the ERV and fresh-air myth)$kb$, $kb$Require 3-, 4- or 5-stage compressors or variable-speed systems.

The ERV / fresh-air myth. HVAC contractors and insulators routinely claim an ERV or fresh-air system will take care of indoor humidity. That is true only when outdoor humidity is considerably lower than indoor humidity, which is rarely true in much of the country and never true all the time in most of it. Even then, the fresh-air volumes ASHRAE 62.2 calls for are too small to matter when indoor moisture generation is considerable.

- Fresh-air systems exist to meet ASHRAE 62.2, the residential ventilation standard for clean, breathable air. They have nothing to do with humidity control.

- The misinformation comes from very dry climates, where fresh air does happen to lower indoor humidity. The system is not designed to do that.

- Because fresh air cannot be relied on for moisture, better exhaust and dehumidification standards have to be adopted.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: AMBIT Academy lesson: What is heat (conduction, convection, insulation as a dam, thermal breaks)$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

From Jeremiah's recorded AMBIT Academy lessons, transcribed Nov 8, 2026 (Teaching).

Ep. 3, What Is Heat (8 min): the foundation

- Jeremiah learned building science from the wrong end, memorizing codes and rules of thumb, and had to work backward to physics. Understanding what heat is lets you reason through a long list of building-performance issues without a third-party resource.

- Heat, in essence, is movement. Conductive and convective heat are the kinetic energy of molecules, which is why they belong to things with mass.

- Pool-table picture: the cue ball strikes the rack and energy passes ball to ball until it is spread out evenly. Heat does the same, molecule to molecule.

- Cold-climate walk-through (North Dakota, −10°F outside, 70°F inside): outdoor molecules move slower and shorter distances; indoor ones move faster. Heat moves from high concentration to low. The warm face of the drywall energizes its cold back face, then the fasteners, the studs, the sheathing or OSB, and finally the siding or brick. That path is conduction.

- Convection is the same energy flow through fluids, and air counts as a fluid (it always carries some water vapor). Air leaks and steam are convection; a warm pocket of air spreads its heat into cooler air around it.

- In a closed system everything would eventually come to rest at one temperature. Buildings never get there, because we mechanically hold the inside at a different temperature than the outside.

- Insulation is a dam against a rushing river of energetic molecules trying to move through the wall, floor and roof assemblies. Its job is to slow that flow as much as possible.

- Thermal breaks work because they interrupt molecular contact. Across an air gap, the interior surface cannot touch the exterior surface, so heat must rely on convection, radiation or some other path.

- Radiant heat is different: it is not kinetic energy. Jeremiah covers it in a separate video (not yet uploaded); the radiation summary in I1 below stands as confirmed Teaching meanwhile.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: AMBIT Academy lesson: What is heat (conduction, convection, insulation as a dam, thermal breaks)$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

From Jeremiah's recorded AMBIT Academy lessons, transcribed Nov 8, 2026 (Teaching).

Ep. 3, What Is Heat (8 min): the foundation

- Jeremiah learned building science from the wrong end, memorizing codes and rules of thumb, and had to work backward to physics. Understanding what heat is lets you reason through a long list of building-performance issues without a third-party resource.

- Heat, in essence, is movement. Conductive and convective heat are the kinetic energy of molecules, which is why they belong to things with mass.

- Pool-table picture: the cue ball strikes the rack and energy passes ball to ball until it is spread out evenly. Heat does the same, molecule to molecule.$kb$),
  (1, $kb$Building science, Session 1: AMBIT Academy lesson: What is heat (conduction, convection, insulation as a dam, thermal breaks)$kb$, $kb$Heat does the same, molecule to molecule.

- Cold-climate walk-through (North Dakota, −10°F outside, 70°F inside): outdoor molecules move slower and shorter distances; indoor ones move faster. Heat moves from high concentration to low. The warm face of the drywall energizes its cold back face, then the fasteners, the studs, the sheathing or OSB, and finally the siding or brick. That path is conduction.

- Convection is the same energy flow through fluids, and air counts as a fluid (it always carries some water vapor). Air leaks and steam are convection; a warm pocket of air spreads its heat into cooler air around it.

- In a closed system everything would eventually come to rest at one temperature. Buildings never get there, because we mechanically hold the inside at a different temperature than the outside.

- Insulation is a dam against a rushing river of energetic molecules trying to move through the wall, floor and roof assemblies. Its job is to slow that flow as much as possible.$kb$),
  (2, $kb$Building science, Session 1: AMBIT Academy lesson: What is heat (conduction, convection, insulation as a dam, thermal breaks)$kb$, $kb$Its job is to slow that flow as much as possible.

- Thermal breaks work because they interrupt molecular contact. Across an air gap, the interior surface cannot touch the exterior surface, so heat must rely on convection, radiation or some other path.

- Radiant heat is different: it is not kinetic energy. Jeremiah covers it in a separate video (not yet uploaded); the radiation summary in I1 below stands as confirmed Teaching meanwhile.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: AMBIT Academy lesson: Psychrometric charts, dew point, and open-cell foam on metal$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

From Jeremiah's recorded AMBIT Academy lessons, transcribed Nov 8, 2026 (Teaching).

Ep. 1, Psychrometric Charts (13 min): dew point and the open-cell-on-metal question

- Context (recorded 2025): a La Niña shift has brought Oklahoma its highest precipitation in decades and much higher outdoor humidity. Spray foam contractors across the US are fielding "my humidity is higher than normal" calls, and spray foam gets blamed unfairly. Contractors need the science to have that conversation.

- Jeremiah's figures: in Climate Zones 1–3 the cooling-season average relative humidity ran about 54% over 1993–2023; in 2024–2025 it rose to almost 68%.

- Open-cell on metal keeps coming up because contractors are using open-cell further north than historically. The attitude "nothing bad has happened yet, so I must not be doing anything wrong" may be true for a while, but it is only a matter of time until Mother Nature shifts the climate a city lives in.

- Dew point is the temperature at which the water vapor in the air is squeezed back together into liquid droplets. Liquid water is many water molecules merged; boiling adds enough energy that they break into clusters light enough to float as vapor. Cooling air packs the molecules closer and squeezes vapor back into droplets. Fog is condensation in open air; a glass of ice water sweating outdoors is condensation on a cold surface.

- Two things set the risk: how much vapor is in the air and how cold the surface is. At 20% RH the surface must be very cold before condensation starts; at high RH a barely cool surface will do. The psychrometric chart tells you the temperature and humidity at which dew point is reached.

- Reading the chart: the vertical lines are dry-bulb temperature (the number on your thermostat); the curved lines are relative humidity (80, 60, 40, 20%); the horizontal scale on the left is dew point (shared with wet bulb). Find the dry-bulb line, go up to the RH curve, then straight left to read dew point.

- Worked example 1, Oklahoma summer: 85°F and 65% RH gives a dew point of about 72–73°F. Any surface cooler than 72°F will condense. A glass of 50°F refrigerator water sweats immediately.

- Worked example 2, North Dakota winter: 10°F outside; 70°F and 40% RH inside (a well-managed home) gives a dew point of about 45°F. A metal roof deck at 10°F is far below it. Vapor moves wet to dry and hot to cold, so interior vapor drives toward that metal. Closed-cell foam stops it (it is dense enough to act as a vapor retarder); open-cell is not a vapor retarder, so vapor passes through and condenses on the metal.

- The yes/no on open-cell: it starts very safe at the southern tip of Florida. In a hot-humid climate open-cell is relatively safe in nearly any application provided there is an exterior vapor retarder, because the reverse drive (outside to inside) is happening now and condensing on the back of the sheetrock where builders omit it. Moving north, run your own scenarios on the chart: how many winter months, what temperatures. If a good part of the year creates condensation risk, change the foam you recommend.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: AMBIT Academy lesson: Psychrometric charts, dew point, and open-cell foam on metal$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

From Jeremiah's recorded AMBIT Academy lessons, transcribed Nov 8, 2026 (Teaching).

Ep. 1, Psychrometric Charts (13 min): dew point and the open-cell-on-metal question

- Context (recorded 2025): a La Niña shift has brought Oklahoma its highest precipitation in decades and much higher outdoor humidity. Spray foam contractors across the US are fielding "my humidity is higher than normal" calls, and spray foam gets blamed unfairly. Contractors need the science to have that conversation.

- Jeremiah's figures: in Climate Zones 1–3 the cooling-season average relative humidity ran about 54% over 1993–2023; in 2024–2025 it rose to almost 68%.$kb$),
  (1, $kb$Building science, Session 1: AMBIT Academy lesson: Psychrometric charts, dew point, and open-cell foam on metal$kb$, $kb$- Open-cell on metal keeps coming up because contractors are using open-cell further north than historically. The attitude "nothing bad has happened yet, so I must not be doing anything wrong" may be true for a while, but it is only a matter of time until Mother Nature shifts the climate a city lives in.

- Dew point is the temperature at which the water vapor in the air is squeezed back together into liquid droplets. Liquid water is many water molecules merged; boiling adds enough energy that they break into clusters light enough to float as vapor. Cooling air packs the molecules closer and squeezes vapor back into droplets. Fog is condensation in open air; a glass of ice water sweating outdoors is condensation on a cold surface.

- Two things set the risk: how much vapor is in the air and how cold the surface is. At 20% RH the surface must be very cold before condensation starts; at high RH a barely cool surface will do. The psychrometric chart tells you the temperature and humidity at which dew point is reached.$kb$),
  (2, $kb$Building science, Session 1: AMBIT Academy lesson: Psychrometric charts, dew point, and open-cell foam on metal$kb$, $kb$The psychrometric chart tells you the temperature and humidity at which dew point is reached.

- Reading the chart: the vertical lines are dry-bulb temperature (the number on your thermostat); the curved lines are relative humidity (80, 60, 40, 20%); the horizontal scale on the left is dew point (shared with wet bulb). Find the dry-bulb line, go up to the RH curve, then straight left to read dew point.

- Worked example 1, Oklahoma summer: 85°F and 65% RH gives a dew point of about 72–73°F. Any surface cooler than 72°F will condense. A glass of 50°F refrigerator water sweats immediately.

- Worked example 2, North Dakota winter: 10°F outside; 70°F and 40% RH inside (a well-managed home) gives a dew point of about 45°F. A metal roof deck at 10°F is far below it. Vapor moves wet to dry and hot to cold, so interior vapor drives toward that metal. Closed-cell foam stops it (it is dense enough to act as a vapor retarder); open-cell is not a vapor retarder, so vapor passes through and condenses on the metal.$kb$),
  (3, $kb$Building science, Session 1: AMBIT Academy lesson: Psychrometric charts, dew point, and open-cell foam on metal$kb$, $kb$- The yes/no on open-cell: it starts very safe at the southern tip of Florida. In a hot-humid climate open-cell is relatively safe in nearly any application provided there is an exterior vapor retarder, because the reverse drive (outside to inside) is happening now and condensing on the back of the sheetrock where builders omit it. Moving north, run your own scenarios on the chart: how many winter months, what temperatures. If a good part of the year creates condensation risk, change the foam you recommend.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: AMBIT Academy lesson: Do homes need to breathe? (oversized AC, exhaust fans, fresh air vs humidity)$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

From Jeremiah's recorded AMBIT Academy lessons, transcribed Nov 8, 2026 (Teaching).

Ep. 2, Do Homes Need to Breathe (15 min): the "too tight" myth and the HVAC gap

- "Houses need to breathe" is a punitive hammer reserved for spray foam. Nobody raises it about mineral wool, ZIP sheathing or ENERGY STAR windows. Spray foam does exacerbate the underlying problem, because it does its job better: a monolithic envelope with no gaps or seams, an air barrier by virtue of low permeability, a Class II vapor retarder with closed-cell, and strong thermal performance.

- The HVAC industry is woefully unprepared for modern construction; most contractors still use rules of thumb passed down for decades.

- The air conditioner has two jobs. The first is cooling. The second, equally important, is drying the air: air pulled across the cold coil condenses, and the water leaves through the condensate drain under the coil.

- An undersized system never reaches set point. An oversized system short-cycles: it satisfies the thermostat quickly before enough house air has crossed the coil to remove the vapor. Everything occupants do keeps adding moisture, humidity climbs, and the results are discomfort in both seasons, mold and wood rot.

- On-demand (tankless) water heaters are now common in production building. Shower temperatures and shower lengths have risen drastically, and bathroom exhaust fans are misused: most people think they are for odor, when they should run before the shower and for up to 30 minutes after, to remove the pounds of water that steam releases. Kitchen hoods should run whenever water is boiling or food is cooking, not only when something burns.

- About 90% of homes get exhaust fans that are badly undersized for the job. Having tested thousands in building-performance work, Jeremiah finds most 50 CFM-rated fans move about 16–18 CFM as installed.

- Jeremiah has repeatedly proposed to the IECC code committees that whole-home dehumidifiers be codified in the South.

- Federal efficiency standards and the switch to new refrigerants have further reduced new air conditioners' ability to remove moisture. Homes, foamed or not, are far tighter and better insulated than in the 1980s and 1990s, yet the system responsible for drying them has less capacity to do it. That mismatch is what creates today's indoor humidity problems.

- Codes require every new home to be airtight, foam or not (fiberglass just needs extra products to get there). Builders ask why not simply build leaky like before. Leaky homes had their own failures: random leakage paths put warm, humid indoor air against cold sheathing, or warm, humid outdoor air against cold interior surfaces, with condensation, mold and rot around doors, windows, receptacles and switches on exterior walls, light fixtures and ceiling HVAC grilles.

- Builders resist spending $800–1,200 on proper ventilation and fresh-air systems and meet air-sealing requirements only because code forces them. When codes do not also enforce fresh air, whole-home dehumidification and properly sized exhaust, only the "seal tight" half gets done.

- A house does not need to breathe, but people do. A fresh-air system replaces indoor air that accumulates respiratory irritants from cleaning products, bleach, candles, open-flame cooking and breathing itself. It is not there for humidity, even though many HVAC contractors believe it is.

- Spray foam gets blamed because it does its job so well that it becomes a flashlight shining on HVAC contractors and builders.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: AMBIT Academy lesson: Do homes need to breathe? (oversized AC, exhaust fans, fresh air vs humidity)$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

From Jeremiah's recorded AMBIT Academy lessons, transcribed Nov 8, 2026 (Teaching).

Ep. 2, Do Homes Need to Breathe (15 min): the "too tight" myth and the HVAC gap

- "Houses need to breathe" is a punitive hammer reserved for spray foam. Nobody raises it about mineral wool, ZIP sheathing or ENERGY STAR windows. Spray foam does exacerbate the underlying problem, because it does its job better: a monolithic envelope with no gaps or seams, an air barrier by virtue of low permeability, a Class II vapor retarder with closed-cell, and strong thermal performance.

- The HVAC industry is woefully unprepared for modern construction; most contractors still use rules of thumb passed down for decades.

- The air conditioner has two jobs. The first is cooling. The second, equally important, is drying the air: air pulled across the cold coil condenses, and the water leaves through the condensate drain under the coil.$kb$),
  (1, $kb$Building science, Session 1: AMBIT Academy lesson: Do homes need to breathe? (oversized AC, exhaust fans, fresh air vs humidity)$kb$, $kb$- An undersized system never reaches set point. An oversized system short-cycles: it satisfies the thermostat quickly before enough house air has crossed the coil to remove the vapor. Everything occupants do keeps adding moisture, humidity climbs, and the results are discomfort in both seasons, mold and wood rot.

- On-demand (tankless) water heaters are now common in production building. Shower temperatures and shower lengths have risen drastically, and bathroom exhaust fans are misused: most people think they are for odor, when they should run before the shower and for up to 30 minutes after, to remove the pounds of water that steam releases. Kitchen hoods should run whenever water is boiling or food is cooking, not only when something burns.

- About 90% of homes get exhaust fans that are badly undersized for the job. Having tested thousands in building-performance work, Jeremiah finds most 50 CFM-rated fans move about 16–18 CFM as installed.

- Jeremiah has repeatedly proposed to the IECC code committees that whole-home dehumidifiers be codified in the South.$kb$),
  (2, $kb$Building science, Session 1: AMBIT Academy lesson: Do homes need to breathe? (oversized AC, exhaust fans, fresh air vs humidity)$kb$, $kb$- Federal efficiency standards and the switch to new refrigerants have further reduced new air conditioners' ability to remove moisture. Homes, foamed or not, are far tighter and better insulated than in the 1980s and 1990s, yet the system responsible for drying them has less capacity to do it. That mismatch is what creates today's indoor humidity problems.

- Codes require every new home to be airtight, foam or not (fiberglass just needs extra products to get there). Builders ask why not simply build leaky like before. Leaky homes had their own failures: random leakage paths put warm, humid indoor air against cold sheathing, or warm, humid outdoor air against cold interior surfaces, with condensation, mold and rot around doors, windows, receptacles and switches on exterior walls, light fixtures and ceiling HVAC grilles.$kb$),
  (3, $kb$Building science, Session 1: AMBIT Academy lesson: Do homes need to breathe? (oversized AC, exhaust fans, fresh air vs humidity)$kb$, $kb$- Builders resist spending $800–1,200 on proper ventilation and fresh-air systems and meet air-sealing requirements only because code forces them. When codes do not also enforce fresh air, whole-home dehumidification and properly sized exhaust, only the "seal tight" half gets done.

- A house does not need to breathe, but people do. A fresh-air system replaces indoor air that accumulates respiratory irritants from cleaning products, bleach, candles, open-flame cooking and breathing itself. It is not there for humidity, even though many HVAC contractors believe it is.

- Spray foam gets blamed because it does its job so well that it becomes a flashlight shining on HVAC contractors and builders.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Fundamentals: heat flow, where spray foam's real edge comes from, thermal lag, open-cell vs closed-cell, foam depth for R-38 and R-49$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I1. Three ways heat moves.

- Conduction: heat moving through solid material by direct contact (studs, sheathing, drywall, metal). R-value measures resistance to conductive heat flow at steady state. Every insulation, fiberglass, cellulose, open-cell or closed-cell, slows conduction by trapping still air or gas in small pockets.

- Convection: heat carried by moving air. Air leakage through the envelope is convective loss, and so is air moving through or around fiber insulation (wind-washing, convective loops in loose fill). Air sealing addresses convection; that is why code now demands a six-sided air barrier on fiber insulation.

- Radiation: heat crossing a gap as infrared without contact. The sun heats the roof deck; the deck radiates to the attic floor and ductwork. This is the main reason an Oklahoma attic reaches 165°F+. Low-e glass and radiant barriers address radiation.

I2. Where spray foam's real edge comes from. At equal R-value, foam's real-world advantage over fiber is convective and locational: it is air barrier and insulation in one, and encapsulating the roof deck moves the ducts and the attic inside the thermal envelope. Open-cell carries no more R-value per inch than ASTM C518 shows. Jeremiah's exception: closed-cell foam does achieve R-values of 6.8 or more per inch, so it reaches a given R-value in far less depth than fiber or open-cell. Total installed R-value still governs; a higher per-inch rating is not a reason to install less of it.

I3. Thermal lag. The steady-state limitation of C518 is a question of how long an assembly takes to heat through. Lag matters most where temperatures swing daily (hot days, cool nights) and least under sustained cold. Treat it as "possible benefit, little data."

I8. Open-cell versus closed-cell quick reference (approx., product-dependent).

| Property | Open-cell SPF | Closed-cell SPF |
|---|---|---|
| R-value per inch | approx. 3.6–3.8 | 6.8 or more (Jeremiah) |
| Vapor permeance | Vapor-permeable; not a vapor retarder | Class II at approx. 1.5–2 in. |
| Air barrier | Yes at typical depths | Yes at approx. 1 in. or more |
| Bulk water | Absorbs water | Resists water |
| Density | approx. 0.5 lb/ft³ | approx. 2 lb/ft³ |
| Adds racking strength | No | Yes |

I9. Foam depth needed to match current attic R-values. At approx. R-3.7 per inch, open-cell needs about 10.5 in. for R-38 and 13 in. for R-49; 6 in. (about R-22) is less than half of R-49. At R-6.8 per inch, closed-cell needs about 5.6 in. for R-38 and 7.2 in. for R-49. IECC prescriptive ceiling values for reference: 2015/2018, R-38 in Zones 2–3 and R-49 in Zones 4–8; 2021, R-49 in Zones 2–3 and R-60 in Zones 4–8 (to confirm against the tables).$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Fundamentals: heat flow, where spray foam's real edge comes from, thermal lag, open-cell vs closed-cell, foam depth for R-38 and R-49$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I1. Three ways heat moves.

- Conduction: heat moving through solid material by direct contact (studs, sheathing, drywall, metal). R-value measures resistance to conductive heat flow at steady state. Every insulation, fiberglass, cellulose, open-cell or closed-cell, slows conduction by trapping still air or gas in small pockets.

- Convection: heat carried by moving air. Air leakage through the envelope is convective loss, and so is air moving through or around fiber insulation (wind-washing, convective loops in loose fill). Air sealing addresses convection; that is why code now demands a six-sided air barrier on fiber insulation.$kb$),
  (1, $kb$Building science, Session 1: Fundamentals: heat flow, where spray foam's real edge comes from, thermal lag, open-cell vs closed-cell, foam depth for R-38 and R-49$kb$, $kb$Air sealing addresses convection; that is why code now demands a six-sided air barrier on fiber insulation.

- Radiation: heat crossing a gap as infrared without contact. The sun heats the roof deck; the deck radiates to the attic floor and ductwork. This is the main reason an Oklahoma attic reaches 165°F+. Low-e glass and radiant barriers address radiation.

I2. Where spray foam's real edge comes from. At equal R-value, foam's real-world advantage over fiber is convective and locational: it is air barrier and insulation in one, and encapsulating the roof deck moves the ducts and the attic inside the thermal envelope. Open-cell carries no more R-value per inch than ASTM C518 shows. Jeremiah's exception: closed-cell foam does achieve R-values of 6.8 or more per inch, so it reaches a given R-value in far less depth than fiber or open-cell. Total installed R-value still governs; a higher per-inch rating is not a reason to install less of it.$kb$),
  (2, $kb$Building science, Session 1: Fundamentals: heat flow, where spray foam's real edge comes from, thermal lag, open-cell vs closed-cell, foam depth for R-38 and R-49$kb$, $kb$Total installed R-value still governs; a higher per-inch rating is not a reason to install less of it.

I3. Thermal lag. The steady-state limitation of C518 is a question of how long an assembly takes to heat through. Lag matters most where temperatures swing daily (hot days, cool nights) and least under sustained cold. Treat it as "possible benefit, little data."

I8. Open-cell versus closed-cell quick reference (approx., product-dependent).

| Property | Open-cell SPF | Closed-cell SPF |
|---|---|---|
| R-value per inch | approx. 3.6–3.8 | 6.8 or more (Jeremiah) |
| Vapor permeance | Vapor-permeable; not a vapor retarder | Class II at approx. 1.5–2 in. |
| Air barrier | Yes at typical depths | Yes at approx. 1 in. or more |
| Bulk water | Absorbs water | Resists water |
| Density | approx. 0.5 lb/ft³ | approx. 2 lb/ft³ |
| Adds racking strength | No | Yes |$kb$),
  (3, $kb$Building science, Session 1: Fundamentals: heat flow, where spray foam's real edge comes from, thermal lag, open-cell vs closed-cell, foam depth for R-38 and R-49$kb$, $kb$2 lb/ft³ |
| Adds racking strength | No | Yes |

I9. Foam depth needed to match current attic R-values. At approx. R-3.7 per inch, open-cell needs about 10.5 in. for R-38 and 13 in. for R-49; 6 in. (about R-22) is less than half of R-49. At R-6.8 per inch, closed-cell needs about 5.6 in. for R-38 and 7.2 in. for R-49. IECC prescriptive ceiling values for reference: 2015/2018, R-38 in Zones 2–3 and R-49 in Zones 4–8; 2021, R-49 in Zones 2–3 and R-60 in Zones 4–8 (to confirm against the tables).$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Fundamentals: vapor retarder classes, IRC R702.7, dew point and condensation, reading a psychrometric chart$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I4. Vapor retarder classes (IRC definitions) and typical materials.

| Class | Permeance (perms) | Typical materials | Role |
|---|---|---|---|
| I | 0.1 or less | Polyethylene sheet, foil facings | Vapor barrier |
| II | More than 0.1, up to 1.0 | Kraft-faced batts; closed-cell SPF at approx. 1.5–2 in. (product-dependent) | Vapor retarder |
| III | More than 1.0, up to 10 | Latex paint on drywall | Light vapor retarder |
| Vapor-open | Well above 10 | Housewrap such as Tyvek (approx. 50+ perms); open-cell SPF (approx. 10–20 perms at 3.5 in.) | Not a vapor retarder |

I5. Code vapor-retarder rules track the teaching. IRC R702.7 requires a Class I or II vapor retarder on the interior side of frame walls in Climate Zones 5, 6, 7, 8 and Marine 4; Class III is permitted under listed conditions; no interior vapor retarder is required in Zones 1–4 (non-marine). The 2021 IRC adds that Class I vapor retarders shall not be installed on the interior side of frame walls in Zones 1 and 2, because that puts the barrier on the cold, dry side and traps inward-driven moisture. Oklahoma is mostly Zone 3A, with some northern and panhandle counties in Zone 4 (to confirm by county).

I6. Dew point and condensation.

- Warmer air can hold more water vapor. Dew point is the temperature at which air becomes saturated; it tracks the actual amount of moisture in the air, not relative humidity alone.

- Condensation forms on any surface colder than the dew point of the air touching it. In an assembly, the first cold surface vapor reaches is the condensing plane: the back of the drywall in the humid-year case, the metal skin in the coral farm case.

- Jeremiah's clarification on fresh air: outdoor humidity must be significantly lower than indoor relative humidity before bringing in outside air has any meaningful effect on indoor humidity. Even then, ASHRAE 62.2 does not call for enough fresh air, even in very tight homes, for dry outdoor air to matter when indoor moisture generation is considerable. Fresh air is for breathable air; exhaust and dehumidification handle moisture.

- The chart way to check a specific case: read the outdoor and indoor dew points on the psychrometric chart (Ep. 1 method). A 75°F house at 50% RH sits at about a 55°F dew point, 60°F at 60% RH. When the outdoor dew point is 70–75°F, every CFM of ventilation air adds moisture.

I7. Reading a psychrometric chart. Dry-bulb temperature runs along the bottom, moisture content (humidity ratio) up the right side, and the curved left boundary is saturation (100% RH). Relative-humidity curves fan out below it. Move horizontally left from any air condition to the saturation curve to read its dew point. Use the chart to find dew point, compare indoor and outdoor moisture, and size dehumidification. Jeremiah's Ep. 1 lesson governs the details.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Fundamentals: vapor retarder classes, IRC R702.7, dew point and condensation, reading a psychrometric chart$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I4. Vapor retarder classes (IRC definitions) and typical materials.

| Class | Permeance (perms) | Typical materials | Role |
|---|---|---|---|
| I | 0.1 or less | Polyethylene sheet, foil facings | Vapor barrier |
| II | More than 0.1, up to 1.0 | Kraft-faced batts; closed-cell SPF at approx. 1.5–2 in. (product-dependent) | Vapor retarder |
| III | More than 1.0, up to 10 | Latex paint on drywall | Light vapor retarder |
| Vapor-open | Well above 10 | Housewrap such as Tyvek (approx. 50+ perms); open-cell SPF (approx. 10–20 perms at 3.5 in.) | Not a vapor retarder |$kb$),
  (1, $kb$Building science, Session 1: Fundamentals: vapor retarder classes, IRC R702.7, dew point and condensation, reading a psychrometric chart$kb$, $kb$10–20 perms at 3.5 in.) | Not a vapor retarder |

I5. Code vapor-retarder rules track the teaching. IRC R702.7 requires a Class I or II vapor retarder on the interior side of frame walls in Climate Zones 5, 6, 7, 8 and Marine 4; Class III is permitted under listed conditions; no interior vapor retarder is required in Zones 1–4 (non-marine). The 2021 IRC adds that Class I vapor retarders shall not be installed on the interior side of frame walls in Zones 1 and 2, because that puts the barrier on the cold, dry side and traps inward-driven moisture. Oklahoma is mostly Zone 3A, with some northern and panhandle counties in Zone 4 (to confirm by county).

I6. Dew point and condensation.

- Warmer air can hold more water vapor. Dew point is the temperature at which air becomes saturated; it tracks the actual amount of moisture in the air, not relative humidity alone.$kb$),
  (2, $kb$Building science, Session 1: Fundamentals: vapor retarder classes, IRC R702.7, dew point and condensation, reading a psychrometric chart$kb$, $kb$- Condensation forms on any surface colder than the dew point of the air touching it. In an assembly, the first cold surface vapor reaches is the condensing plane: the back of the drywall in the humid-year case, the metal skin in the coral farm case.

- Jeremiah's clarification on fresh air: outdoor humidity must be significantly lower than indoor relative humidity before bringing in outside air has any meaningful effect on indoor humidity. Even then, ASHRAE 62.2 does not call for enough fresh air, even in very tight homes, for dry outdoor air to matter when indoor moisture generation is considerable. Fresh air is for breathable air; exhaust and dehumidification handle moisture.

- The chart way to check a specific case: read the outdoor and indoor dew points on the psychrometric chart (Ep. 1 method). A 75°F house at 50% RH sits at about a 55°F dew point, 60°F at 60% RH. When the outdoor dew point is 70–75°F, every CFM of ventilation air adds moisture.$kb$),
  (3, $kb$Building science, Session 1: Fundamentals: vapor retarder classes, IRC R702.7, dew point and condensation, reading a psychrometric chart$kb$, $kb$When the outdoor dew point is 70–75°F, every CFM of ventilation air adds moisture.

I7. Reading a psychrometric chart. Dry-bulb temperature runs along the bottom, moisture content (humidity ratio) up the right side, and the curved left boundary is saturation (100% RH). Relative-humidity curves fan out below it. Move horizontally left from any air condition to the saturation curve to read its dew point. Use the chart to find dew point, compare indoor and outdoor moisture, and size dehumidification. Jeremiah's Ep. 1 lesson governs the details.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Fundamentals: duct losses, why a 50 CFM fan moves 18 CFM, single-stage AC and humidity, indoor moisture sources, tankless water heaters$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I10. Duct losses as a ΔT problem. A duct in a 165°F attic carrying 55°F supply air faces a 110°F ΔT across R-6 or R-8 insulation, plus leakage straight to the outdoors. Inside an encapsulated attic a few degrees above the house, the ΔT collapses to roughly 10–15°F and every leak lands inside the envelope. This is the mechanism behind the 1990s savings.

I11. Why a 50 CFM fan moves 18 CFM. Fans are rated at 0.1 in. w.c. static pressure. Installed with long flex duct, kinks, undersized duct, tight elbows and a backdraft damper or roof cap, static pressure rises and flow collapses. Fixes: smooth rigid duct, short straight runs, correct diameter, and a flow test after installation. ASHRAE 62.2 minimum local exhaust: bathroom 50 CFM intermittent or 20 CFM continuous; kitchen 100 CFM intermittent.

I12. Why single-stage systems hurt humidity. Moisture (latent) removal needs long compressor run time with air moving across a cold coil. A single-stage system sized for the hottest hour satisfies the thermostat quickly for most of the year and shuts off before removing much moisture; oversizing makes it worse. Multi-stage and variable-speed systems run longer at lower capacity and remove more moisture. Even they cannot dehumidify when there is no cooling call (mild, humid spring and fall), which is the case for a whole-home dehumidifier.

I13. Where indoor moisture comes from. Occupants (breathing, bathing, cooking, laundry), unvented combustion, plants and aquariums, slab and crawlspace moisture, construction moisture in a new home for its first year or two, and in humid climates the ventilation air itself. A tight envelope does not create moisture. In cold, dry weather, infiltration used to dry leaky houses by accident; in humid weather it adds moisture. Tight homes need deliberate exhaust and dehumidification either way.

I14. Tankless water heaters and bath exhaust. Unlimited hot water lengthens showers and raises the steam produced per use, so the moisture load per bathroom use is higher than when a tank ran out. This is the physical basis for the 110 CFM position.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Fundamentals: duct losses, why a 50 CFM fan moves 18 CFM, single-stage AC and humidity, indoor moisture sources, tankless water heaters$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I10. Duct losses as a ΔT problem. A duct in a 165°F attic carrying 55°F supply air faces a 110°F ΔT across R-6 or R-8 insulation, plus leakage straight to the outdoors. Inside an encapsulated attic a few degrees above the house, the ΔT collapses to roughly 10–15°F and every leak lands inside the envelope. This is the mechanism behind the 1990s savings.$kb$),
  (1, $kb$Building science, Session 1: Fundamentals: duct losses, why a 50 CFM fan moves 18 CFM, single-stage AC and humidity, indoor moisture sources, tankless water heaters$kb$, $kb$This is the mechanism behind the 1990s savings.

I11. Why a 50 CFM fan moves 18 CFM. Fans are rated at 0.1 in. w.c. static pressure. Installed with long flex duct, kinks, undersized duct, tight elbows and a backdraft damper or roof cap, static pressure rises and flow collapses. Fixes: smooth rigid duct, short straight runs, correct diameter, and a flow test after installation. ASHRAE 62.2 minimum local exhaust: bathroom 50 CFM intermittent or 20 CFM continuous; kitchen 100 CFM intermittent.

I12. Why single-stage systems hurt humidity. Moisture (latent) removal needs long compressor run time with air moving across a cold coil. A single-stage system sized for the hottest hour satisfies the thermostat quickly for most of the year and shuts off before removing much moisture; oversizing makes it worse. Multi-stage and variable-speed systems run longer at lower capacity and remove more moisture. Even they cannot dehumidify when there is no cooling call (mild, humid spring and fall), which is the case for a whole-home dehumidifier.$kb$),
  (2, $kb$Building science, Session 1: Fundamentals: duct losses, why a 50 CFM fan moves 18 CFM, single-stage AC and humidity, indoor moisture sources, tankless water heaters$kb$, $kb$I13. Where indoor moisture comes from. Occupants (breathing, bathing, cooking, laundry), unvented combustion, plants and aquariums, slab and crawlspace moisture, construction moisture in a new home for its first year or two, and in humid climates the ventilation air itself. A tight envelope does not create moisture. In cold, dry weather, infiltration used to dry leaky houses by accident; in humid weather it adds moisture. Tight homes need deliberate exhaust and dehumidification either way.

I14. Tankless water heaters and bath exhaust. Unlimited hot water lengthens showers and raises the steam produced per use, so the moisture load per bathroom use is higher than when a tank ran out. This is the physical basis for the 110 CFM position.$kb$)
) as x(seq, title, body);

with s as (
  insert into public.ai_sources (kind, origin, title, file_name, body, staff_only, enabled, status, created_by, created_by_name)
  values ('teaching', 'note', $kb$Building science, Session 1: Fundamentals: four control layers, metal buildings, energy-price escalation in ROI, climate-zone reversals, design temperatures, vocabulary$kb$, 'kb-session-1', $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I15. Four control layers, in order of importance. Every enclosure needs a bulk-water layer (roofing, flashing, housewrap), an air barrier, a vapor retarder placed per climate, and a thermal layer (insulation). Bulk-water failures are the fastest and most damaging; air leakage carries far more moisture into assemblies than diffusion; diffusion is the slowest. Know which layer each product is: housewrap = water (and air, when taped), not vapor; spray foam = air + thermal, plus vapor when closed-cell at Class II thickness.

I16. Metal buildings. Steel conducts heat readily and stores no moisture, so its interior surface tracks the outdoor temperature and condenses easily. Safer options: closed-cell foam at Class II thickness directly on the metal, or open-cell only when indoor humidity will be controlled and the building's use is known. Any use with process humidity (aquaculture, pools, livestock, car washes, kitchens, laundries) needs dehumidification designed for that load.

I17. Energy-price escalation in ROI. A payback figured at today's price understates the value of efficiency. Rather than a single number, the AI should show ROI at three escalation rates (for example 2%, 5% and 8% per year) and state the assumption.

I18. Canonical climate-zone reversals. Interior polyethylene: right in Zone 7, harmful in Zone 2. Radiant barriers: useful over hot, vented attics, little value in cold climates. Vented crawlspaces: a moisture source in humid climates. "No vapor retarder needed": defensible in Zone 3, not in Zone 6.

I19. Design temperatures. Climate zone sets the code R-value tables; ACCA Manual J sizing uses the local 1% / 99% design temperatures (ASHRAE data) to set the ΔT for heat loss and gain. The two are related but not the same number.

I20. Vocabulary the AI should use consistently. Encapsulated (unvented) attic; conditioned space; perm; dew point; humidity ratio (grains of moisture per pound of dry air); sensible versus latent load; ACH50 (blower-door airtightness); CFM25 (duct leakage); barndominium.$kb$, false, true, 'ready', '92f501aa-4088-4e87-a5a5-704f1445f888', 'Jeremiah Bryant')
  returning id)
insert into public.ai_chunks (source_id, page, seq, title, body)
select s.id, null, x.seq, x.title, x.body from s, (values
  (0, $kb$Building science, Session 1: Fundamentals: four control layers, metal buildings, energy-price escalation in ROI, climate-zone reversals, design temperatures, vocabulary$kb$, $kb$Jeremiah Bryant's building-science teaching (AMBIT), Session 1, Nov 8, 2026. "Teaching" is authoritative; "Position" is his opinion or advocacy, not current code.

Supporting fundamentals (Teaching, confirmed by Jeremiah Nov 8, 2026). Numbers marked approx. are typical product-literature values; AMBIT's own TDS values govern for AMBIT products.

I15. Four control layers, in order of importance. Every enclosure needs a bulk-water layer (roofing, flashing, housewrap), an air barrier, a vapor retarder placed per climate, and a thermal layer (insulation). Bulk-water failures are the fastest and most damaging; air leakage carries far more moisture into assemblies than diffusion; diffusion is the slowest. Know which layer each product is: housewrap = water (and air, when taped), not vapor; spray foam = air + thermal, plus vapor when closed-cell at Class II thickness.$kb$),
  (1, $kb$Building science, Session 1: Fundamentals: four control layers, metal buildings, energy-price escalation in ROI, climate-zone reversals, design temperatures, vocabulary$kb$, $kb$I16. Metal buildings. Steel conducts heat readily and stores no moisture, so its interior surface tracks the outdoor temperature and condenses easily. Safer options: closed-cell foam at Class II thickness directly on the metal, or open-cell only when indoor humidity will be controlled and the building's use is known. Any use with process humidity (aquaculture, pools, livestock, car washes, kitchens, laundries) needs dehumidification designed for that load.

I17. Energy-price escalation in ROI. A payback figured at today's price understates the value of efficiency. Rather than a single number, the AI should show ROI at three escalation rates (for example 2%, 5% and 8% per year) and state the assumption.

I18. Canonical climate-zone reversals. Interior polyethylene: right in Zone 7, harmful in Zone 2. Radiant barriers: useful over hot, vented attics, little value in cold climates. Vented crawlspaces: a moisture source in humid climates. "No vapor retarder needed": defensible in Zone 3, not in Zone 6.$kb$),
  (2, $kb$Building science, Session 1: Fundamentals: four control layers, metal buildings, energy-price escalation in ROI, climate-zone reversals, design temperatures, vocabulary$kb$, $kb$"No vapor retarder needed": defensible in Zone 3, not in Zone 6.

I19. Design temperatures. Climate zone sets the code R-value tables; ACCA Manual J sizing uses the local 1% / 99% design temperatures (ASHRAE data) to set the ΔT for heat loss and gain. The two are related but not the same number.

I20. Vocabulary the AI should use consistently. Encapsulated (unvented) attic; conditioned space; perm; dew point; humidity ratio (grains of moisture per pound of dry air); sensible versus latent load; ACH50 (blower-door airtightness); CFM25 (duct leakage); barndominium.$kb$)
) as x(seq, title, body);

update public.ai_sources a set chars = coalesce((select sum(length(c.body)) from public.ai_chunks c where c.source_id = a.id), 0) where a.file_name = 'kb-session-1';

-- Always-on reasoning rules from the teacher (Admin > Ask AMBIT shows and edits them).
update public.ai_settings set extra_rules = $kb$[Session 1 rules] Jeremiah's reasoning rules (building science, Nov 8, 2026):
- Before answering any assembly, vapor retarder, R-value or humidity question, establish the climate zone (from the ZIP code or county) and what the building is used for (occupancy and process humidity such as tanks, pools, livestock, kitchens, laundries). If you don't know them, ask, or answer for the likely case and say how the answer changes. An answer that's right in one climate zone can be exactly backward in another.
- Reason from delta T, dew point and the direction of vapor drive, not from rules of thumb or what "everyone does" in one region.
- In mixed climates (CZ 3–4), where the seasonal split is close to even, say so plainly, give the "good enough" answer, and name the risk it carries.
- Teaching marked "Position" is Jeremiah's professional opinion or advocacy (for example what the IRC should require). Present it as his (AMBIT's) position, never as current code.
- Never say spray foam "performs like double its R-value." At equal R-value (ASTM C518) foam and fiber perform the same; foam's real edge is air sealing and bringing the attic and ducts inside conditioned space. Closed-cell reaches a given R-value in less depth (R-6.8 or more per inch), but total installed R-value governs.
- Housewrap (Tyvek) is a moisture barrier, not a vapor barrier. Open-cell foam is not a vapor retarder.
- Fresh-air and ERV systems exist for breathable air (ASHRAE 62.2), not humidity control. Indoor humidity is the HVAC system's job: right-sized, multi-stage or variable-speed equipment, adequate exhaust and dehumidification.$kb$ where coalesce(extra_rules, '') = '' or extra_rules like '%[Session 1 rules]%';
