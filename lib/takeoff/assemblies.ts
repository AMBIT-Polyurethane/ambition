// The assemblies the takeoff AI traces: every surface that separates conditioned space from something
// that isn't conditioned. Each traced shape belongs to exactly one. From the Teachable Takeoff AI
// blueprint (Nov 9, 2026) and AMBIT's measuring guide (lib/takeoff/guide.ts). Client-safe.

import { DEFAULT_HEIGHT, TEAM_PITCH } from "@/lib/takeoff/guide";

export type AssemblyKey =
  | "slab"
  | "exterior_walls"
  | "garage_partition_walls"
  | "knee_walls"
  | "attic_demising_walls"
  | "attic_ceilings"
  | "under_decking"
  | "vaulted_ceilings"
  | "cathedral_ceilings"
  | "sloped_ceilings"
  | "roof_line"
  | "garage_roof_line"
  | "garage_ceiling"
  | "floor_over_ambient"
  | "floor_over_garage"
  | "foundation_walls"
  | "rim_joist_ambient"
  | "rim_joist_attic";

/** line = length x height; area = flat area; sloped = flat area x the pitch factor. */
export type Measure = "line" | "area" | "sloped";

export type Assembly = {
  key: AssemblyKey;
  n: number;
  label: string;
  between: string;
  measure: Measure;
  /** Slab: area and perimeter. */
  perimeter?: boolean;
  what: string;
  /** Starting height (feet) or pitch (rise per 12) when the plans don't say. */
  height?: number;
  pitch?: number;
  /** How the item starts out (the team can change it). */
  material: string | null;
  thickness_in: number | null;
  area_code: string | null;
  color: string;
};

export const ASSEMBLIES: Assembly[] = [
  {
    key: "slab", n: 1, label: "Slab", between: "Conditioned space ↔ ground (on grade)", measure: "area", perimeter: true,
    what: "The first floor slab under conditioned space. Record its area and full perimeter, including the edge between the garage and living space. Area always equals the first floor conditioned footprint; never count the second floor.",
    material: null, thickness_in: null, area_code: null, color: "#64748b",
  },
  {
    key: "exterior_walls", n: 2, label: "Exterior walls", between: "Conditioned space ↔ outdoors", measure: "line", height: DEFAULT_HEIGHT.wall,
    what: "Vertical walls that separate conditioned space from outdoors. Trace the outside face.",
    material: "open_cell", thickness_in: 5.5, area_code: "EW", color: "#e33527",
  },
  {
    key: "garage_partition_walls", n: 3, label: "Garage partition walls", between: "Conditioned space ↔ unconditioned attached garage", measure: "line", height: DEFAULT_HEIGHT.wall,
    what: "Vertical walls between living space and an attached garage.",
    material: "fiberglass_batts", thickness_in: null, area_code: "EW", color: "#d97706",
  },
  {
    key: "knee_walls", n: 4, label: "Knee walls", between: "Conditioned space ↔ vented attic", measure: "line", height: DEFAULT_HEIGHT.knee,
    what: "Vertical walls between conditioned space and a vented attic, plus tray or coffered ceiling risers, dormer cheek walls and bonus-room walls that face the attic over the garage. Also wherever an interior wall has a lower ceiling on one side and a higher one on the other; the height is the difference.",
    material: "open_cell", thickness_in: 5.5, area_code: "KW", color: "#7c3aed",
  },
  {
    key: "attic_demising_walls", n: 5, label: "Attic demising walls", between: "Encapsulated (sealed) attic ↔ vented attic", measure: "line", height: DEFAULT_HEIGHT.demising,
    what: "Walls inside the attic that separate a spray-foamed sealed attic from vented attic space, such as over a porch or an unconditioned garage.",
    material: "open_cell", thickness_in: 5.5, area_code: "RL", color: "#0891b2",
  },
  {
    key: "attic_ceilings", n: 6, label: "Attic ceilings", between: "Conditioned space below ↔ vented attic above", measure: "area",
    what: "Flat, horizontal ceilings under a vented attic.",
    material: "blown_fiberglass", thickness_in: null, area_code: "CL", color: "#2563eb",
  },
  {
    key: "under_decking", n: 7, label: "Under decking", between: "Conditioned space below ↔ vented attic above, under a platform", measure: "area",
    what: "Ceiling sections under an HVAC platform or other attic decking. They can't be blown in later, so they're listed on their own.",
    material: "fiberglass_batts", thickness_in: null, area_code: "CL", color: "#0d9488",
  },
  {
    key: "vaulted_ceilings", n: 8, label: "Vaulted ceilings", between: "Conditioned space ↔ vented attic behind", measure: "sloped", pitch: TEAM_PITCH,
    what: "A one-sided diagonal ceiling that is open to the attic on its back side.",
    material: "blown_fiberglass", thickness_in: null, area_code: "CL", color: "#4f46e5",
  },
  {
    key: "cathedral_ceilings", n: 9, label: "Cathedral ceilings", between: "Conditioned space ↔ vented attic behind", measure: "sloped", pitch: TEAM_PITCH,
    what: "A two-sided diagonal ceiling that is open to the attic on its back side.",
    material: "blown_fiberglass", thickness_in: null, area_code: "CL", color: "#6d28d9",
  },
  {
    key: "sloped_ceilings", n: 10, label: "Sloped ceilings", between: "Conditioned space ↔ roof deck and outdoors (no attic)", measure: "sloped", pitch: TEAM_PITCH,
    what: "A one-sided diagonal ceiling where the insulation fills the cavity from drywall to roof sheathing. There is no attic behind it.",
    material: "open_cell", thickness_in: 5.5, area_code: "RL", color: "#db2777",
  },
  {
    key: "roof_line", n: 11, label: "Roof line", between: "Sealed attic ↔ outdoors", measure: "sloped", pitch: TEAM_PITCH,
    what: "The roof plane that gets spray foam when the attic is encapsulated. It stops at the exterior wall line; overhangs are not included.",
    material: "open_cell", thickness_in: 7, area_code: "RL", color: "#16a34a",
  },
  {
    key: "garage_roof_line", n: 12, label: "Garage roof line", between: "Sealed attic over the garage ↔ outdoors", measure: "sloped", pitch: TEAM_PITCH,
    what: "The roof plane over the garage when the attic above the garage is encapsulated as part of the whole encapsulation.",
    material: "open_cell", thickness_in: 7, area_code: "RL", color: "#65a30d",
  },
  {
    key: "garage_ceiling", n: 13, label: "Garage ceiling", between: "Garage below ↔ sealed attic above", measure: "area",
    what: "The garage ceiling under an encapsulated attic. Keep it as its own line, because the garage can't share air with the house even when insulated.",
    material: "blown_fiberglass", thickness_in: null, area_code: "CL", color: "#ca8a04",
  },
  {
    key: "floor_over_ambient", n: 14, label: "Floor over ambient", between: "Conditioned space above ↔ outdoors below", measure: "area",
    what: "A floor with living space above and outdoors below: a second floor cantilevered past the first floor footprint, or a room over an open or unconditioned porch.",
    material: "closed_cell", thickness_in: 3, area_code: "FL", color: "#be123c",
  },
  {
    key: "floor_over_garage", n: 15, label: "Floor over garage", between: "Conditioned space above ↔ unconditioned garage below", measure: "area",
    what: "A floor with living space above (for example a bonus room) and the garage below.",
    material: "closed_cell", thickness_in: 3, area_code: "FL", color: "#b45309",
  },
  {
    key: "foundation_walls", n: 16, label: "Foundation walls", between: "Conditioned space ↔ ground or outside air", measure: "line", height: DEFAULT_HEIGHT.foundation,
    what: "Basement walls, above or below grade, or stem walls of an encapsulated crawlspace.",
    material: "closed_cell", thickness_in: 2, area_code: null, color: "#475569",
  },
  {
    key: "rim_joist_ambient", n: 17, label: "Rim joist (to ambient)", between: "Conditioned space ↔ outdoors", measure: "line", height: DEFAULT_HEIGHT.rim,
    what: "The band or rim joist between two conditioned floors, exposed to outdoors.",
    material: "closed_cell", thickness_in: 3, area_code: "RJ", color: "#9333ea",
  },
  {
    key: "rim_joist_attic", n: 18, label: "Rim joist (to attic)", between: "Conditioned space ↔ unconditioned attic", measure: "line", height: DEFAULT_HEIGHT.rim,
    what: "The band or rim joist between conditioned space and an unconditioned attic.",
    material: "closed_cell", thickness_in: 3, area_code: "RJ", color: "#a21caf",
  },
];

export const ASSEMBLY_KEYS = ASSEMBLIES.map((a) => a.key) as AssemblyKey[];
export const assemblyOf = (k: string | null | undefined) => ASSEMBLIES.find((a) => a.key === k) ?? null;

/** For the prompt: one line per assembly. */
export function assemblyCatalogText(): string {
  const how = { line: "line (length × height)", area: "polygon (flat area)", sloped: "polygon (flat area × pitch factor)" } as const;
  return ASSEMBLIES.map((a) => `${a.n}. ${a.key} — ${a.label}. Between: ${a.between}. Traced as: ${how[a.measure]}${a.perimeter ? ", plus its full perimeter" : ""}. ${a.what}`).join("\n");
}

export const ASSEMBLY_GUIDE = `An assembly is a surface that separates CONDITIONED space from something that isn't conditioned. Every traced shape belongs to exactly one assembly.
Ask two questions about every surface:
1. Is there conditioned space on one side? If not, skip it.
2. What is on the other side? The answer picks the assembly.
Interior walls and floors between two conditioned spaces are never assemblies.

Picking the assembly. If you're unsure which one fits, state in your analysis what is on each side of the surface first; that decides it. Common confusions:
- Vaulted or sloped: is there attic air behind it (vaulted), or is the cavity filled to the roof deck (sloped)?
- Attic ceiling or garage ceiling: a garage ceiling is only an assembly when the attic above it is sealed. Under a vented attic it doesn't separate conditioned space from anything, so it's skipped.
- Floor over garage or floor over ambient: check what is below. Garage = floor over garage; outdoors or an open porch = floor over ambient.

Default heights and pitches when the plans don't say: 9 ft exterior and garage partition walls; 4 ft knee walls; 6 ft attic demising walls; 8 ft foundation walls; 11.25 in (a 2x12) rim joists; 10/10 pitch (= 12 rise per 12, slope factor 1.414) for vaulted, cathedral and sloped ceilings and roof lines. Always replace a default with the plan's real number, and say in notes when a default was used.`;
