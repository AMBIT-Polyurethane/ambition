import "server-only";
import { ASSEMBLY_GUIDE, ASSEMBLY_KEYS, assemblyCatalogText } from "@/lib/takeoff/assemblies";
import { COMPONENT_KINDS, FACT_TOPICS, SHEET_KINDS, SIDES, WALL_KEYS, type RuleUsed } from "@/lib/takeoff/ai-read";

// The takeoff AI's instructions and answer forms. These are the "base instructions" in the teaching export.

export const PROMPT_VERSION = "2026-11-09";

/** AMBIT's measuring guide, condensed for reading one sheet (full guide: supabase/knowledge/takeoff-measuring-guide.md). */
const MEASURING = `Reading the plan set:
- Floor plan (each level): wall runs, ceiling areas, floor areas, windows and doors with size codes, room ceiling heights.
- Foundation plan: slab outline and perimeter, foundation or stem walls.
- Elevations: which side of the house, wall heights, gable shapes, roof pitch, window and door positions. Use them to check, never as the source of counted quantities.
- Sections and details: plate heights, ceiling heights, roof pitch, rim joist depth, foundation heights, attic type (vented or encapsulated), insulation notes.
- Roof plan: roof planes, pitches, hips and valleys, overhang depth.
- Window schedule: every window and door type with its size.

What to trace on each kind of sheet:
- Floor plan: exterior walls (outside face, a corner at every jog), garage partition walls, knee walls (tray and coffered risers, walls between a lower and a higher ceiling, bonus-room walls facing the attic), every ceiling area over the rooms it covers (attic ceilings under a vented attic; vaulted, cathedral, sloped and tray parts as separate areas; under decking below an HVAC platform; garage ceiling only under a sealed attic), floor over garage and floor over ambient on upper floors, rim joists between floors. On the lowest conditioned floor, also trace the slab: the conditioned footprint only (garage, porches and patios left out), its outline is its perimeter.
- Foundation plan: the slab outline (conditioned footprint only) and foundation or stem walls.
- Roof plan: roof line and garage roof line planes only when the attic (or the attic over the garage) is sealed / encapsulated; stop at the exterior wall line, no overhangs.
- Elevations and sections: trace only what helps check a height or shape (they're kept for reference and never counted). Read plate heights, ceiling heights and pitches into facts.
- Schedules, notes, site plans: no shapes. Read windows and doors (with sizes) and facts.

Team rules (from corrections the team made on real plans; always follow them):
1. Slab = the first floor's conditioned footprint. Nothing more. A second floor is never slab. If the slab comes out at about double the first floor area, the second floor was added by mistake.
2. Default pitch for slopes, vaults and cathedrals is 10/10 when the plans don't list one: that is 12 rise per 12 (45°, factor 1.414), NOT 10/12. Give pitch as rise per 12.
3. Knee walls from ceiling height changes: wherever an interior wall has a lower ceiling on one side and a higher one on the other (for example 8 ft and 10 ft), draw a line along that wall between the two ceiling areas. Its height is the difference (10 − 8 = 2 ft).
4. Master bedroom style raised or tray ceilings usually break into three parts: the flat ceiling in the middle (the rectangle inside the dotted line), perimeter pieces next to exterior walls that follow the roofline (sloped ceiling, insulation fills the cavity to the roof deck), and perimeter pieces next to interior space that are open to the attic behind (vaulted ceiling). Trace each as its own area.
5. Wall heights from window settings: window head or sill heights together with the exterior wall height locate windows in the wall.
6. Builder pattern (Homes by Taber): slopes and vaults run about 10/10. When a slope has no wall height on its low side, assume it starts at 8 ft and slopes up to 10 ft.

Common mistakes to avoid: counting the second floor as slab; tracing interior walls between conditioned rooms; missing knee walls at ceiling height changes and tray risers; leaving the garage-to-house edge out of the slab outline; treating a porch ceiling as insulated (it isn't, unless there's living space above, which makes it a floor over ambient); tracing roof overhangs as roof line; trusting a printed scale without checking it against a written dimension.

Window and door codes: a four-digit code is feet and inches of width, then of height: 3060 = 3'0" × 6'0"; 2650 = 2'6" × 5'0"; 3068 = 3'0" × 6'8". 30x60 and 3'0"x6'0" mean the same.`;

const GEOMETRY = `How to give shapes:
- Coordinates are pixels of THIS picture: x to the right, y down, origin at the top-left corner. Whole numbers.
- Polygons: list the corners in order around the outline, without repeating the first corner at the end. Put a corner at every jog.
- Lines: the points along the wall in order (a polyline). One line can turn corners; start a new line where a run stops.
- Exterior walls on the outside face of the wall. Other walls along the drawn wall. Ceiling and floor areas over the rooms they cover.
- One shape per separate area or run. Use "instance" to name it in a few words ("over garage", "master bedroom tray center", "north wall").
- Height (feet) on lines: the wall's height for walls, the joist depth for rim joists (11.25 in = 0.9375 ft), the difference in ceiling heights for knee walls at a ceiling change. Pitch (rise per 12) on sloped areas. Say whether each came from the plan or is a default.
- If something isn't on this sheet, leave it out rather than guess, and say what's missing in notes.
- Don't trace dimension strings, notes, hatching or the title block.
- Scale: report the printed scale and, in dimension_check, the two ends of one long written dimension (an overall width or depth) in pixels with the feet written between them, so the scale can be checked.
- Windows and doors: one entry per opening drawn on this sheet (or per schedule row), with its code, size in feet when known, the side of the house, and its pixel position (0, 0 if it isn't drawn, as on a schedule).`;

/** The base instructions for reading one sheet (rules are added after). */
export const SHEET_SYSTEM = `You are AMBIT Intelligence's takeoff AI. You read ONE sheet of a residential construction plan set for an insulation contractor (spray foam, blown fiberglass, batts) and return exact geometry for every insulated surface on it.

Think first: in "analysis", before any coordinates, say what kind of sheet this is and which level; walk the outline of the conditioned space corner by corner and say what is on the other side of each wall (outdoors, garage, attic, porch, another conditioned room); find ceilings that change height, vaults, trays, platforms and rooms over the garage or porches; and check the scale against a long written dimension. Then give the shapes.

THE ASSEMBLIES (every traced shape is exactly one of these):
${assemblyCatalogText()}

${ASSEMBLY_GUIDE}

${MEASURING}

${GEOMETRY}`;

export const CORRECTION_TEMPLATE = `You already read this sheet. Your previous result: {previous JSON without the analysis}. The modeler says: "{correction}". Fix exactly that and return the complete corrected result.`;

export const RECONCILE_SYSTEM = `You are AMBIT Intelligence's takeoff AI. Each sheet of a plan set was read on its own. Below is a short summary of every sheet's reading (no geometry). Put them together:
- Merge the same window or door seen on several sheets (a floor plan and an elevation, or a schedule) into one entry with its quantity; don't double count.
- Settle the heights (plate heights per level, ceiling heights, knee wall heights) and the roof and ceiling pitches, naming the sheets they came from.
- List every discrepancy: things that disagree between sheets (a window on one sheet and not another, a wall height that differs, a scale that doesn't check out, a slab that's about double the first floor, a ceiling type that conflicts), and anything important that's missing (no pitch given, attic type unknown, a level with no ceiling plan). Give each a severity (high = changes the takeoff noticeably, medium = should be checked, low = minor) and the sheets involved.
- The builder's name if any sheet shows it.
- A two or three sentence summary of the plan set for the estimator.

${ASSEMBLY_GUIDE}`;

/** The team's rules, added to every prompt. */
export function rulesBlock(rules: RuleUsed[] | { text: string | null; builder: string | null }[]): string {
  const list = rules.filter((r) => r.text?.trim());
  if (!list.length) return "";
  return `Rules from the team (from past corrections). Always follow them:\n${list.map((r) => `- ${r.builder ? `(Builder: ${r.builder}) ` : ""}${r.text!.trim()}`).join("\n")}`;
}

const pts = { type: "array", items: { type: "array", items: { type: "number" } }, description: "[[x, y], ...] in pixels of the picture" };

/** The answer form for one sheet. "analysis" comes first so the AI thinks before giving coordinates. */
export const SHEET_SCHEMA = {
  type: "object",
  properties: {
    analysis: { type: "string", description: "Think first (see the instructions), before any coordinates." },
    sheet_kind: { type: "string", enum: [...SHEET_KINDS] },
    sheet_number: { type: "string", description: "From the title block, e.g. A1.0; empty if none" },
    level: { type: "string", description: "first floor, second floor, third floor, basement, attic, roof; empty if not a plan of one level" },
    elevation_side: { type: "string", enum: ["front", "rear", "left", "right", "none"] },
    scale: {
      type: "object",
      properties: { text: { type: "string", description: "The main drawing's printed scale exactly as written; empty if none" }, feet_per_inch: { type: "number", description: "4 for 1/4\" = 1'-0\"; 0 if unknown or NOT TO SCALE" } },
      required: ["text", "feet_per_inch"],
    },
    dimension_check: {
      type: "object",
      description: "Two ends of one long written dimension, to check the scale",
      properties: {
        found: { type: "boolean" },
        x1: { type: "number" },
        y1: { type: "number" },
        x2: { type: "number" },
        y2: { type: "number" },
        feet: { type: "number", description: "The written length in feet (55'-0\" = 55)" },
        quote: { type: "string" },
      },
      required: ["found", "x1", "y1", "x2", "y2", "feet", "quote"],
    },
    assemblies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          assembly: { type: "string", enum: [...ASSEMBLY_KEYS] },
          instance: { type: "string", description: "A few words naming this one: over garage, north wall, master tray center" },
          points: pts,
          height_ft: { type: "number", description: "Lines: wall height (or joist depth) in feet; 0 for areas" },
          pitch: { type: "number", description: "Sloped areas: rise per 12; 0 for flat areas and walls" },
          height_source: { type: "string", enum: ["plan", "default", "none"], description: "Where the height or pitch came from" },
          note: { type: "string" },
        },
        required: ["assembly", "instance", "points", "height_ft", "pitch", "height_source", "note"],
      },
    },
    components: {
      type: "array",
      description: "Windows and doors",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...COMPONENT_KINDS] },
          code: { type: "string", description: "The size code as written: 3050, 2868, 16'-0\" x 8'-0\"" },
          width_ft: { type: "number", description: "0 if unknown" },
          height_ft: { type: "number", description: "0 if unknown" },
          side: { type: "string", enum: [...SIDES] },
          x: { type: "number" },
          y: { type: "number" },
          wall: { type: "string", enum: [...WALL_KEYS], description: "The wall it sits in" },
          note: { type: "string" },
        },
        required: ["kind", "code", "width_ft", "height_ft", "side", "x", "y", "wall", "note"],
      },
    },
    facts: {
      type: "array",
      description: "Plate heights, ceiling heights, pitches, attic type, foundation, framing, rim joist depth, insulation callouts, builder",
      items: {
        type: "object",
        properties: { topic: { type: "string", enum: [...FACT_TOPICS] }, value: { type: "string" }, where: { type: "string" }, quote: { type: "string", description: "The exact words on the sheet" } },
        required: ["topic", "value", "where", "quote"],
      },
    },
    notes: { type: "array", items: { type: "string" }, description: "Assumptions (defaults used), what's missing, what to check. Short." },
  },
  required: ["analysis", "sheet_kind", "sheet_number", "level", "elevation_side", "scale", "dimension_check", "assemblies", "components", "facts", "notes"],
} as const;

const sheets = { type: "array", items: { type: "string" }, description: "Sheet names" };
export const RECONCILE_SCHEMA = {
  type: "object",
  properties: {
    analysis: { type: "string", description: "Think it through first" },
    facts: {
      type: "array",
      items: { type: "object", properties: { topic: { type: "string", enum: [...FACT_TOPICS] }, value: { type: "string" }, sheets }, required: ["topic", "value", "sheets"] },
    },
    heights: {
      type: "array",
      description: "Settled heights: first floor plate, second floor plate, great room ceiling, knee walls...",
      items: { type: "object", properties: { what: { type: "string" }, height_ft: { type: "number" }, sheets }, required: ["what", "height_ft", "sheets"] },
    },
    pitches: {
      type: "array",
      items: { type: "object", properties: { where: { type: "string" }, rise: { type: "number", description: "Rise per 12" }, sheets }, required: ["where", "rise", "sheets"] },
    },
    components: {
      type: "array",
      description: "Every window and door once, with how many",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...COMPONENT_KINDS] },
          code: { type: "string" },
          width_ft: { type: "number" },
          height_ft: { type: "number" },
          qty: { type: "integer" },
          side: { type: "string", enum: [...SIDES] },
          sheets,
        },
        required: ["kind", "code", "width_ft", "height_ft", "qty", "side", "sheets"],
      },
    },
    discrepancies: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, detail: { type: "string" }, severity: { type: "string", enum: ["high", "medium", "low"] }, sheets },
        required: ["title", "detail", "severity", "sheets"],
      },
    },
    builder: { type: "string", description: "Empty if not shown" },
    summary: { type: "string" },
  },
  required: ["analysis", "facts", "heights", "pitches", "components", "discrepancies", "builder", "summary"],
} as const;
