// What the takeoff assistant was taught: AMBIT's insulation takeoff measuring guide (Session 1, Nov 8, 2026,
// from Home Energy Response Squad's takeoff rules and the corrections the team has taught its AI). The full
// guide is also in Ask AMBIT's knowledge (Admin > Ask AMBIT), so people can ask how to measure something.

/** Pitch to use when the plans don't list one: the team writes it "10/10", which is the same as 12/12 (45°). */
export const TEAM_PITCH = 12;
export const TEAM_PITCH_LABEL = '10/10 (same as 12/12, 45°): the team default when the plans don\'t list a pitch';

/** Starting heights when the plans don't say (feet). Replace with the plan's plate heights whenever they're shown. */
export const DEFAULT_HEIGHT = { wall: 9, knee: 4, demising: 6, foundation: 8, rim: 11.25 / 12 };

/** For the AI reading each sheet. */
export const SCAN_RULES = `How AMBIT measures (follow these):
- Only surfaces between conditioned (heated and cooled) space and something that isn't matter: outdoors, the ground, an attached garage, or an unconditioned attic. Interior walls between conditioned rooms and floors between two conditioned floors are never insulated surfaces.
- Exterior elevations are for checking heights, gable shapes, roof pitch and window positions, never for counting quantities. Walls, ceilings and floors are counted from floor plans; slab and foundation walls from the foundation plan.
- Scale: report the printed scale text exactly, and whether the sheet (or a detail on it) says NOT TO SCALE. If a long written overall dimension is shown (an overall house width or depth), report it so the scale can be checked against it.
- Ceilings: report every ceiling note (VAULTED, TRAY, COFFERED, CATHEDRAL, sloped, raised) and every room ceiling height (room tags, a ceiling-height schedule, "CLG HT"). A wall with a lower ceiling on one side and a higher one on the other is a knee wall whose height is the difference. Report HVAC platforms or attic decking (the ceiling under them must be insulated before the decking goes down).
- Floors: a slab is only the first floor's conditioned footprint (a second floor is never slab). Report cantilevered floors and rooms over open or unconditioned porches (floor over outdoors), and living space over the garage.
- Foundation: slab on grade, vented crawlspace, encapsulated crawlspace or basement; the rim or band joist depth if shown (2x10, 2x12, 11 7/8" TJI).
- Roof pitch is rise per 12 of run: convert any other form (10/10 is 12 per 12).
- The builder's name from the title block, if shown.`;

/** Shown before tracing. */
export const TRACE_TIPS = [
  "Measure only surfaces between conditioned space and outdoors, the ground, an attached garage or an unconditioned attic.",
  "Trace exterior walls on their outside face, with a corner at every jog. Missed bump-outs are the most common error.",
  "Count from the floor plans; use elevations only to check heights and shapes (counting both doubles the walls).",
  "Check each sheet's scale against a long written dimension. If they disagree, trust the written dimension.",
  "Slab is the first floor's conditioned footprint only. About double the first floor means the second floor got added.",
  "Foam on the roof line stops at the exterior wall line: don't include overhangs. A porch ceiling isn't insulated unless there's living space above it.",
  "Where a ceiling changes height (8' on one side, 10' on the other), there's a knee wall: its height is the difference.",
];
