# Insulation Takeoff Measuring Guide

Teaching file for the AMBIT Intelligence AI assistant. It covers how to read a residential plan set and measure every surface that gets insulation. It comes from Home Energy Response Squad's PRO-Rate takeoff rules and the corrections the team has taught its AI. Energy modeling items (R-value targets, U-factors, orientation, shading) are left out on purpose.

Exported November 8, 2026. Session 1 of the takeoff training. The takeoff pre-scan follows it (lib/takeoff/guide.ts, prescan.ts, prescan-plan.ts) and Ask AMBIT has it as knowledge (supabase/knowledge/takeoff-guide-session-1.sql).

---

## 1. The one rule everything follows

**Only measure surfaces that separate conditioned (heated and cooled) space from something that isn't.** That "something" is outdoors, the ground, an attached garage, or an unconditioned attic.

- Ignore interior walls between two conditioned rooms.
- Ignore floors between two conditioned floors (the floor of a conditioned second story over a conditioned first story).
- Every surface you measure must be able to answer: *conditioned on this side, and what on the other?*

Before tracing anything, walk the outline of each floor corner by corner and name what is on the other side of each wall.

---

## 2. Reading the plan set

### Sheet types and what each one gives you

| Sheet | What to take from it |
|---|---|
| Floor plan (each level) | Wall runs, ceiling areas, floor areas, windows and doors with size codes, room ceiling heights |
| Foundation plan | Slab outline and perimeter, foundation or stem walls |
| Exterior elevations | Which side of the house each one shows, wall heights, gable shapes, roof pitch, window and door positions. **Use these to check, never as the source of counted quantities.** |
| Sections and details | Plate heights, ceiling heights, roof pitch, rim joist depth, foundation heights, attic type (vented or encapsulated), insulation notes |
| Roof plan | Roof planes, pitches, hips and valleys, overhang depth |
| Window schedule | Every window and door type with its size |

### Where quantities come from

- **Walls, ceilings and floors:** count them from the **floor plans**.
- **Slab and foundation walls:** count them from the **foundation plan**. If there is no foundation plan, use the first floor plan.
- **Elevations:** use them to confirm heights and shapes, never to count. If you count from elevations as well, you double count.

### Scale

1. Read the printed scale (for example 1/4" = 1'-0", which is 4 feet per inch).
2. **Always verify it** against a long printed dimension, such as an overall house width. Measure that dimension on the sheet and compare it to the written number. If they disagree, trust the written dimension and work out the scale from it.
3. Watch for sheets marked "NOT TO SCALE" and for details drawn at a different scale than the main plan.
4. Check the scale separately on every sheet. Sheets in one set are often drawn at different scales.

### Tracing

- Trace on the drawn wall lines. For exterior walls, trace the **outside face**.
- Put a corner at **every jog**. Missed bump-outs are the most common error.
- Don't trace dimension strings, notes, hatching or title blocks.
- If something isn't on the sheet, leave it out rather than guess, and say what's missing.

---

## 3. Surfaces to measure

### Walls (measured as length × height = square feet)

| Assembly | What it is |
|---|---|
| **Exterior walls** | Vertical walls between conditioned space and outdoors. Trace the outside face. |
| **Garage partition walls** | Walls between living space and an attached garage. |
| **Knee walls** | Vertical walls between conditioned space and a vented attic. This includes tray and coffered ceiling risers, dormer cheek walls, and bonus-room walls that face the attic over the garage. |
| **Attic demising walls** | Walls inside the attic that separate an encapsulated (spray-foamed) attic from vented attic space, such as the attic over a porch or an unconditioned garage. |
| **Foundation walls** | Basement walls (above or below grade), or stem walls of an encapsulated crawlspace. |
| **Rim joist to outdoors** | The band or rim joist between two conditioned floors, exposed to outdoors. |
| **Rim joist to attic** | Band or rim joist between conditioned space and an unconditioned attic. |

Typical starting heights when the plans don't say: 9 ft for exterior and garage walls, 4 ft for knee walls, 6 ft for attic demising walls, 8 ft for foundation walls, and 11.25 in (a 2x12) for rim joists. **Replace these with the plan's actual plate heights whenever they're shown.**

### Ceilings and roofs (measured as area)

| Assembly | What it is | How to measure |
|---|---|---|
| **Attic ceiling (flat)** | Horizontal ceiling with conditioned space below and a vented attic above. | Flat area |
| **Under decking** | Ceiling sections under an HVAC platform or attic decking. These can't be blown later, so they need batts before the decking goes down. | Flat area |
| **Vaulted ceiling** | One-sided diagonal ceiling that is open to the attic on its back side. | Plan area × pitch factor |
| **Cathedral ceiling** | Two-sided diagonal ceiling that is open to the attic on its back side. | Plan area × pitch factor |
| **Sloped ceiling** | One-sided diagonal ceiling where insulation fills the cavity from drywall to roof sheathing. There is no attic behind it. | Plan area × pitch factor |
| **Roof line** | The roof plane that gets spray foam when the attic is encapsulated. | Plan area × pitch factor |
| **Garage roof line** | The roof plane over the garage when the attic above the garage is also encapsulated. | Plan area × pitch factor |
| **Garage ceiling** | The garage ceiling under an encapsulated attic. Keep it as its own line, because the garage can't share air with the house even when insulated. | Flat area |

Draw ceiling areas on the floor plan over the rooms they cover. Use ceiling notes (VAULTED, TRAY, COFFERED, CATHEDRAL) and the ceiling heights in the room schedule.

### Floors (measured as area)

| Assembly | What it is |
|---|---|
| **Slab** | First floor slab under conditioned space. Record area **and** full perimeter, including the edge between the garage and living space. |
| **Floor over outdoors** | Living space above and outdoors below: a cantilevered second floor, or a room over an open or unconditioned porch. |
| **Floor over garage** | Living space above (for example a bonus room) with an unconditioned garage below. |

---

## 4. The math

**Wall area:** wall length (ft) × wall height (ft).

**Sloped area:** plan area × pitch factor, where pitch factor = √(1 + (rise ÷ run)²).

| Pitch (rise / run) | Same pitch per 12 | Factor |
|---|---|---|
| 4/12 | 4/12 | 1.054 |
| 6/12 | 6/12 | 1.118 |
| 8/12 | 8/12 | 1.202 |
| 10/12 | 10/12 | 1.302 |
| 12/12 | 12/12 | 1.414 |
| **10/10** | **12/12** | **1.414** |

> **Watch the 10/10 default.** The team's default for an unlisted pitch is written as "10/10" (10 inches rise over 10 inches run). That is the same steepness as 12/12 (45 degrees), with a factor of 1.414. It is **not** 10/12. Convert any rise/run to "per 12" before using a per-12 table.

**Hip roofs and valleys:** if every roof plane has the same pitch, the roof's plan area × one pitch factor gives the true total surface area. You don't have to measure each plane. Mixed pitches need each plane measured separately.

**Spray foam board feet:** square feet × thickness in inches.

**Window and door sizes:** a four-digit code is feet and inches of width, then feet and inches of height.
- 3060 is 3'0" × 6'0", which is 36 × 72 inches, or 18 sq ft.
- 2650 is 2'6" × 5'0", which is 12.5 sq ft.
- Doors: 3068 is 3'0" × 6'8", which is 20 sq ft.
- Forms like 30x60 and 3'0"x6'0" mean the same thing.

**Net wall area:** gross wall area minus window and door areas. Whether a job is priced on gross or net area is a company decision. State which one you used every time.

---

## 5. Team rules (taught by Home Energy Response Squad)

These came from corrections the team made on real plans. Always follow them.

1. **Slab = the first floor's conditioned footprint. Nothing more.** Only count slab that sits between conditioned space and the ground. A second floor is never slab; it's a wood-framed floor and isn't counted at all when conditioned space is below it. If the slab is coming out at about double the first floor area, the second floor has been added by mistake.
   - *Example (901 Peony Place): correct slab was 2,034 sq ft. The AI first entered 4,068 by adding the second floor.*
2. **Default pitch for slopes, vaults and cathedrals is 10/10** when the plans don't list one (see the warning in section 4).
3. **Finding knee walls from ceiling height changes.** Knee walls are often not drawn as such, but they're easy to find. Wherever an interior wall has a lower ceiling on one side and a higher ceiling on the other (for example 8 ft and 10 ft), draw a line along that wall between the two ceiling areas. Its height is the **difference** in ceiling heights (10 − 8 = 2 ft).
4. **Master bedroom style raised or tray ceilings** usually break into three parts:
   - **Flat ceiling** in the middle: the rectangle surrounded by the dotted line on the plan.
   - **Perimeter pieces next to exterior walls,** which follow the roofline (insulation fills the cavity to the roof deck).
   - **Perimeter pieces next to interior space,** which are open to the attic behind.
   - Measure each perimeter piece as its own area on the floor plan, then apply the pitch factor.
5. **Wall heights from window settings.** Even without exterior elevations, you can work out window positions in the wall from the window head or sill heights the plans show, together with the known exterior wall height.
6. **Builder pattern (Homes by Taber):** slopes and vaults run about 10/10 pitch. When a slope has no wall height noted on its low side, assume it starts at 8 ft and slopes up to 10 ft.

---

## 6. Step-by-step takeoff

1. **Sort the sheets** by type and level. Note the scale on each sheet and verify it against a long dimension.
2. **Find heights and pitches first** from sections, details, elevations and room notes: each level's plate height, ceiling heights by room, roof pitch, rim joist depth, and attic type (vented or encapsulated).
3. **First floor plan:**
   - Exterior walls, traced around the outside face with a corner at every jog.
   - Garage partition walls.
   - Slab area and perimeter (the conditioned footprint only, per rule 1).
   - Every window and door, with its code.
4. **Ceilings over the first floor:**
   - Flat attic ceiling wherever a vented attic is above.
   - Vaults, cathedrals, slopes and tray parts as separate areas.
   - Knee walls wherever ceiling heights change (rule 3).
   - Under-decking areas below HVAC platforms.
5. **Second floor and bonus rooms:**
   - Exterior walls.
   - Knee walls to the attic.
   - Floor over garage and floor over outdoors (cantilevers, rooms over porches).
   - Ceilings to the attic.
   - Rim joists between floors.
6. **Encapsulated attic:**
   - Roof line area (plan area × pitch factor).
   - Gable end walls in the sealed attic.
   - Attic demising walls where the sealed attic meets vented attic.
   - Garage roof line or garage ceiling as applicable.
7. **Cross-check:**
   - Slab area should equal the first floor conditioned area.
   - Every window on the floor plan should also appear on an elevation.
   - Wall heights should agree between elevations and sections.
8. **Report** every assembly with its quantity, the dimensions behind it (for example "212 ft × 9 ft"), the pitch used, the sheet it came from, and every assumption you made.

---

## 7. Common mistakes to catch

- Counting the second floor as slab (double slab).
- Counting quantities from elevations as well as floor plans (double walls).
- Missing knee walls at ceiling height changes and tray risers.
- Measuring interior walls between conditioned rooms.
- Using a 10/12 factor for a "10/10" pitch.
- Forgetting the garage-to-house edge in the slab perimeter.
- Treating a porch ceiling as insulated. It isn't, unless there's living space above, in which case it's a floor over outdoors.
- Measuring roof overhangs as roof line foam area. Foam stops at the exterior wall line.
- Trusting a printed scale without checking it against a written dimension.

---

## 8. How to report uncertainty

- When a value isn't on the plans, use the defaults above and **say it was assumed**.
- When two sheets disagree (a window size, a wall height, a window that appears on only one sheet), name both sheets and exactly what differs.
- Ask for a site photo or a field measurement whenever a missing or conflicting value would change the takeoff by a noticeable amount.
