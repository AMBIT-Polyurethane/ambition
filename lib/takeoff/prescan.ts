// AI pre-scan for Takeoff: Claude reads each plan sheet (the picture plus the PDF's own text) and reports
// what an insulation estimator looks for: insulation called out per area, roof pitches, wall (plate)
// heights, framing, garage and porches, whether the attic is vented or sealed, the ceilings (vaulted, tray,
// cathedral, room heights), the foundation and floors, and the scale. The takeoff screen turns that into
// ready-to-measure items following AMBIT's measuring guide (lib/takeoff/guide.ts); the contractor still
// traces the shapes.

import { SCAN_RULES } from "@/lib/takeoff/guide";

export type ScanInsulation = {
  location: string;
  area_code: "EW" | "PW" | "KW" | "CL" | "RL" | "RJ" | "FL" | "other";
  material: "open_cell" | "closed_cell" | "blown_fiberglass" | "fiberglass_batts" | "blown_cellulose" | "mineral_wool" | "rigid_board" | "unspecified";
  r_value: number | null;
  thickness_in: number | null;
  quote: string;
};
export type SheetScan = {
  sheet_kind: "floor_plan" | "roof_plan" | "elevation" | "section" | "details" | "notes" | "site" | "other";
  insulation: ScanInsulation[];
  roof_pitches: { rise: number; where: string; quote: string }[];
  wall_heights: { feet: number; where: string; quote: string }[];
  exterior_framing: "2x4" | "2x6" | "2x8" | "unknown";
  garage: "attached" | "detached" | "none" | "unknown";
  living_over_garage: boolean | null;
  porch: boolean | null;
  attic: "vented" | "sealed" | "both" | "unknown";
  stories: number | null;
  climate_zone: string | null;
  notes: string[];
  // Session 1 of the takeoff training (Nov 8, 2026)
  scale_text: string | null;
  not_to_scale: boolean;
  overall_dims: { feet: number; what: string; quote: string }[];
  ceilings: { kind: CeilingKind; where: string; feet: number | null; quote: string }[];
  foundation: "slab" | "crawl_vented" | "crawl_sealed" | "basement" | "unknown";
  rim_joist_in: number | null;
  floor_over_outdoors: boolean | null;
  hvac_platform: boolean | null;
  builder: string | null;
};
export type CeilingKind = "flat" | "vaulted" | "cathedral" | "tray" | "coffered" | "sloped";
const CEILING_KINDS: CeilingKind[] = ["flat", "vaulted", "cathedral", "tray", "coffered", "sloped"];

export const SCAN_SCHEMA = {
  type: "object",
  properties: {
    sheet_kind: { type: "string", enum: ["floor_plan", "roof_plan", "elevation", "section", "details", "notes", "site", "other"] },
    insulation: {
      type: "array",
      description: "Every insulation callout on this sheet (notes, schedules, sections, wall tags).",
      items: {
        type: "object",
        properties: {
          location: { type: "string", description: "Where it goes in plain words: Exterior walls, Attic floor / ceiling, Roof deck, Vaulted ceiling, Knee walls, Rim joist, Garage common wall, Floor over garage, Interior walls (sound)" },
          area_code: { type: "string", enum: ["EW", "PW", "KW", "CL", "RL", "RJ", "FL", "other"], description: "EW exterior walls, PW partition/interior walls, KW knee walls, CL ceiling/attic floor, RL roofline/roof deck/vaulted, RJ rim joist, FL floors" },
          material: { type: "string", enum: ["open_cell", "closed_cell", "blown_fiberglass", "fiberglass_batts", "blown_cellulose", "mineral_wool", "rigid_board", "unspecified"] },
          r_value: { type: "number", description: "0 when no R-value is given" },
          thickness_in: { type: "number", description: "Inches, only when the plans give them; otherwise 0" },
          quote: { type: "string", description: "The exact words on the sheet" },
        },
        required: ["location", "area_code", "material", "r_value", "thickness_in", "quote"],
      },
    },
    roof_pitches: {
      type: "array",
      items: { type: "object", properties: { rise: { type: "number", description: "Rise per 12 (6 for 6/12 or 6:12)" }, where: { type: "string" }, quote: { type: "string" } }, required: ["rise", "where", "quote"] },
    },
    wall_heights: {
      type: "array",
      description: "Plate or ceiling heights of walls, one per different height.",
      items: { type: "object", properties: { feet: { type: "number" }, where: { type: "string", description: "e.g. First floor, Second floor, Garage, Great room" }, quote: { type: "string" } }, required: ["feet", "where", "quote"] },
    },
    exterior_framing: { type: "string", enum: ["2x4", "2x6", "2x8", "unknown"] },
    garage: { type: "string", enum: ["attached", "detached", "none", "unknown"] },
    living_over_garage: { type: "string", enum: ["yes", "no", "unknown"] },
    porch: { type: "string", enum: ["yes", "no", "unknown"], description: "A covered porch or patio under the main roof" },
    attic: { type: "string", enum: ["vented", "sealed", "both", "unknown"], description: "sealed = unvented / conditioned attic, foam at the rafters" },
    stories: { type: "integer", description: "0 when not shown" },
    climate_zone: { type: "string", description: "e.g. 3A, or empty" },
    notes: { type: "array", items: { type: "string" }, description: "Anything else an insulation estimator should know (air sealing, fire rating, vented soffits, cathedral areas). Short." },
    scale_text: { type: "string", description: "The main drawing's printed scale exactly as written, e.g. 1/4\" = 1'-0\". Empty if none." },
    not_to_scale: { type: "boolean", description: "True if the sheet or its main drawing says NOT TO SCALE / NTS" },
    overall_dims: {
      type: "array",
      description: "Long written overall dimensions (overall house width or depth), for checking the scale. Up to 3.",
      items: { type: "object", properties: { feet: { type: "number" }, what: { type: "string", description: "e.g. Overall width, first floor" }, quote: { type: "string" } }, required: ["feet", "what", "quote"] },
    },
    ceilings: {
      type: "array",
      description: "Ceiling notes and room ceiling heights: one entry per room or area with a noted ceiling type or height.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["flat", "vaulted", "cathedral", "tray", "coffered", "sloped"], description: "vaulted = one-sided slope open to the attic behind; cathedral = two-sided; sloped = insulation fills the cavity to the roof deck, no attic behind; tray/coffered = raised center with risers" },
          where: { type: "string", description: "Room or area, e.g. Master bedroom, Great room, Bonus room" },
          feet: { type: "number", description: "Ceiling height in feet if given (the high point for a vault); 0 if not" },
          quote: { type: "string" },
        },
        required: ["kind", "where", "feet", "quote"],
      },
    },
    foundation: { type: "string", enum: ["slab", "crawl_vented", "crawl_sealed", "basement", "unknown"], description: "crawl_sealed = encapsulated / unvented crawlspace" },
    rim_joist_in: { type: "number", description: "Rim or band joist depth in inches if shown (2x10 = 9.25, 2x12 = 11.25, 11 7/8 TJI = 11.875); 0 if not" },
    floor_over_outdoors: { type: "string", enum: ["yes", "no", "unknown"], description: "A cantilevered floor, or living space over an open or unconditioned porch" },
    hvac_platform: { type: "string", enum: ["yes", "no", "unknown"], description: "An HVAC platform or attic decking/storage shown in the attic" },
    builder: { type: "string", description: "The builder's name from the title block, or empty" },
  },
  required: ["sheet_kind", "insulation", "roof_pitches", "wall_heights", "exterior_framing", "garage", "living_over_garage", "porch", "attic", "stories", "climate_zone", "notes", "scale_text", "not_to_scale", "overall_dims", "ceilings", "foundation", "rim_joist_in", "floor_over_outdoors", "hvac_platform", "builder"],
} as const;

export const SCAN_SYSTEM = `You read ONE sheet of a construction plan set for an insulation contractor (spray foam, blown fiberglass, batts).
Report only what this sheet shows. Never guess: use null, "unknown" or an empty list when the sheet doesn't say.
- Insulation: every callout (energy notes, insulation schedules, wall sections, tags). Copy the exact words into "quote". R-values as numbers (R-38 -> 38).
- Roof pitch: slope marks like 6/12, 6:12, "8 IN 12" (rise per 12 of run).
- Wall heights: plate heights and ceiling heights ("9'-0\\" PLATE HT", "CLG 10'-0\\""), in feet (9'-1 1/8" -> 9.1). One entry per different height.
- Exterior framing: 2x4 or 2x6 studs if shown.
- Garage: attached, detached or none; whether there's living space over it.
- Porch: a covered porch or patio under the main roof.
- Attic: "sealed" if the plans call for an unvented/conditioned attic or foam at the rafters/roof deck; "vented" if they show attic vents, soffit/ridge vents or ceiling insulation; "both" if part of each.
The second text block (if any) is the PDF's own text from this sheet, out of order; use it to read small print exactly.

${SCAN_RULES}`;

/** One sheet's findings, cleaned up (numbers in range, short strings). */
export function cleanScan(raw: unknown): SheetScan {
  const r = (raw ?? {}) as Partial<SheetScan>;
  const str = (v: unknown, n = 160) => String(v ?? "").trim().slice(0, n);
  const yn = (v: unknown) => (v === true || v === "yes" ? true : v === false || v === "no" ? false : null);
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null);
  return {
    sheet_kind: (["floor_plan", "roof_plan", "elevation", "section", "details", "notes", "site", "other"].includes(String(r.sheet_kind)) ? r.sheet_kind : "other") as SheetScan["sheet_kind"],
    insulation: (Array.isArray(r.insulation) ? r.insulation : []).slice(0, 30).map((x) => ({
      location: str(x.location, 80) || "Insulation",
      area_code: (["EW", "PW", "KW", "CL", "RL", "RJ", "FL", "other"].includes(String(x.area_code)) ? x.area_code : "other") as ScanInsulation["area_code"],
      material: (["open_cell", "closed_cell", "blown_fiberglass", "fiberglass_batts", "blown_cellulose", "mineral_wool", "rigid_board", "unspecified"].includes(String(x.material)) ? x.material : "unspecified") as ScanInsulation["material"],
      r_value: num(x.r_value, 1, 100),
      thickness_in: num(x.thickness_in, 0.25, 24),
      quote: str(x.quote, 200),
    })),
    roof_pitches: (Array.isArray(r.roof_pitches) ? r.roof_pitches : []).slice(0, 10).map((x) => ({ rise: num(x.rise, 0.5, 24) ?? 0, where: str(x.where, 80), quote: str(x.quote, 80) })).filter((x) => x.rise > 0),
    wall_heights: (Array.isArray(r.wall_heights) ? r.wall_heights : []).slice(0, 10).map((x) => ({ feet: num(x.feet, 2, 40) ?? 0, where: str(x.where, 80), quote: str(x.quote, 80) })).filter((x) => x.feet > 0),
    exterior_framing: (["2x4", "2x6", "2x8"].includes(String(r.exterior_framing)) ? r.exterior_framing : "unknown") as SheetScan["exterior_framing"],
    garage: (["attached", "detached", "none"].includes(String(r.garage)) ? r.garage : "unknown") as SheetScan["garage"],
    living_over_garage: yn(r.living_over_garage),
    porch: yn(r.porch),
    attic: (["vented", "sealed", "both"].includes(String(r.attic)) ? r.attic : "unknown") as SheetScan["attic"],
    stories: num(r.stories, 1, 10),
    climate_zone: r.climate_zone ? str(r.climate_zone, 20) : null,
    notes: (Array.isArray(r.notes) ? r.notes : []).slice(0, 8).map((x) => str(x, 200)).filter(Boolean),
    scale_text: r.scale_text ? str(r.scale_text, 40) || null : null,
    not_to_scale: r.not_to_scale === true,
    overall_dims: (Array.isArray(r.overall_dims) ? r.overall_dims : []).slice(0, 3).map((x) => ({ feet: num(x.feet, 5, 1000) ?? 0, what: str(x.what, 60), quote: str(x.quote, 60) })).filter((x) => x.feet > 0),
    ceilings: (Array.isArray(r.ceilings) ? r.ceilings : []).slice(0, 20).map((x) => ({
      kind: (CEILING_KINDS.includes(x.kind as CeilingKind) ? x.kind : "flat") as CeilingKind,
      where: str(x.where, 60),
      feet: num(x.feet, 6, 40),
      quote: str(x.quote, 80),
    })),
    foundation: (["slab", "crawl_vented", "crawl_sealed", "basement"].includes(String(r.foundation)) ? r.foundation : "unknown") as SheetScan["foundation"],
    rim_joist_in: num(r.rim_joist_in, 5, 24),
    floor_over_outdoors: yn(r.floor_over_outdoors),
    hvac_platform: yn(r.hvac_platform),
    builder: r.builder ? str(r.builder, 60) || null : null,
  };
}

export type ScanResult = { sheets: { sheet_id: string; name: string | null; scan: SheetScan }[]; at: string; cost_cents: number };

/** Everything the sheets said, put together (repeats merged). */
export function mergeScans(list: SheetScan[]) {
  const ins = new Map<string, ScanInsulation & { sheets: number }>();
  for (const s of list)
    for (const i of s.insulation) {
      const k = `${i.area_code}|${i.material}|${i.r_value ?? ""}|${i.thickness_in ?? ""}`;
      const cur = ins.get(k);
      if (cur) cur.sheets++;
      else ins.set(k, { ...i, sheets: 1 });
    }
  const pitches = new Map<number, { rise: number; where: string[] }>();
  for (const s of list) for (const p of s.roof_pitches) pitches.set(p.rise, { rise: p.rise, where: [...new Set([...(pitches.get(p.rise)?.where ?? []), p.where].filter(Boolean))] });
  const heights = new Map<number, { feet: number; where: string[] }>();
  for (const s of list) for (const h of s.wall_heights) {
    const k = Math.round(h.feet * 10) / 10;
    heights.set(k, { feet: k, where: [...new Set([...(heights.get(k)?.where ?? []), h.where].filter(Boolean))] });
  }
  const pick = <T,>(vals: T[], unknown: T) => vals.find((v) => v !== unknown) ?? unknown;
  const attics = list.map((s) => s.attic);
  const attic = attics.includes("both") || (attics.includes("sealed") && attics.includes("vented")) ? "both" : pick(attics, "unknown");
  return {
    insulation: [...ins.values()],
    pitches: [...pitches.values()].sort((a, b) => b.rise - a.rise),
    heights: [...heights.values()].sort((a, b) => a.feet - b.feet),
    framing: pick(list.map((s) => s.exterior_framing), "unknown"),
    garage: list.some((s) => s.garage === "attached") ? "attached" : pick(list.map((s) => s.garage), "unknown"),
    living_over_garage: list.some((s) => s.living_over_garage === true) ? true : list.some((s) => s.living_over_garage === false) ? false : null,
    porch: list.some((s) => s.porch === true) ? true : list.some((s) => s.porch === false) ? false : null,
    attic: attic as SheetScan["attic"],
    stories: Math.max(0, ...list.map((s) => s.stories ?? 0)) || null,
    climate_zone: list.find((s) => s.climate_zone)?.climate_zone ?? null,
    notes: [...new Set(list.flatMap((s) => s.notes))].slice(0, 12),
    ceilings: mergeCeilings(list),
    foundation: pick(list.map((s) => s.foundation ?? "unknown"), "unknown"),
    rim_joist_in: list.find((s) => s.rim_joist_in)?.rim_joist_in ?? null,
    floor_over_outdoors: list.some((s) => s.floor_over_outdoors === true) ? true : list.some((s) => s.floor_over_outdoors === false) ? false : null,
    hvac_platform: list.some((s) => s.hvac_platform === true) ? true : list.some((s) => s.hvac_platform === false) ? false : null,
    builder: list.find((s) => s.builder)?.builder ?? null,
    scales: list.map((s) => ({ text: s.scale_text ?? null, nts: Boolean(s.not_to_scale), dims: s.overall_dims ?? [] })),
  };
}

/** Each room's ceiling once (the same room on several sheets is one). */
function mergeCeilings(list: SheetScan[]) {
  const out = new Map<string, SheetScan["ceilings"][number]>();
  for (const s of list)
    for (const c of s.ceilings ?? []) {
      const k = `${c.kind}|${c.where.toLowerCase()}`;
      const cur = out.get(k);
      if (!cur || (!cur.feet && c.feet)) out.set(k, c);
    }
  return [...out.values()];
}
export type Merged = ReturnType<typeof mergeScans>;
