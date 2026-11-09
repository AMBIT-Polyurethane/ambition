// Turns the AI pre-scan (what the plans say) plus the contractor's answers into ready-to-measure takeoff
// items, one per assembly in AMBIT's measuring guide (lib/takeoff/guide.ts): exterior walls (one per wall
// height), garage partition walls, knee walls, attic demising walls, foundation walls, rim joists, the attic
// ceiling or the roof line, vaulted / cathedral / sloped / tray ceilings, under-decking, the garage roof line
// and ceiling, slab, and floors over the garage or outdoors. Nothing is measured for them: they trace the shapes.

import type { Merged, ScanInsulation } from "@/lib/takeoff/prescan";
import type { TItem } from "@/lib/takeoff/calc";
import { DEFAULT_HEIGHT, TEAM_PITCH } from "@/lib/takeoff/guide";

export type Answers = {
  /** Is the garage part of the conditioned house? */
  garageInside: boolean | null;
  /** Foam at the roofline (sealed attic) instead of a vented attic. */
  sealedAttic: boolean;
  /** Sealed attic: porch and garage attics stay vented, walled off from the house's attic. */
  demising: boolean;
  pitch: number | null;
  heights: number[];
  framing: "2x4" | "2x6" | "2x8" | "unknown";
  foundation: "slab" | "crawl_vented" | "crawl_sealed" | "basement" | "unknown";
  stories: number | null;
};

export type Proposed = { key: string; on: boolean; why: string; item: Partial<TItem> & { name: string; kind: TItem["kind"] } };

const half = (n: number) => Math.ceil(n * 2) / 2;
/** Inches of foam for an R-value (open cell about R-3.7 an inch, closed cell about R-6.9): a starting point to check. */
export const inchesFor = (material: string, r: number | null) => (r ? (material === "closed_cell" ? half(r / 6.9) : material === "open_cell" ? half(r / 3.7) : null) : null);

const ft = (h: number) => {
  const f = Math.floor(h);
  const i = Math.round((h - f) * 12);
  return i ? `${f}'-${i}"` : `${f}'`;
};

function pickFor(merged: Merged, codes: ScanInsulation["area_code"][]) {
  // The garage wall's own callout isn't the exterior walls'.
  return merged.insulation.filter((i) => codes.includes(i.area_code) && !(i.area_code === "EW" && /garage/i.test(`${i.location} ${i.quote}`))).sort((a, b) => b.sheets - a.sheets || (b.r_value ?? 0) - (a.r_value ?? 0))[0] ?? null;
}

function materialOf(c: ScanInsulation | null, fallback: string) {
  if (!c || c.material === "unspecified") return fallback;
  if (c.material === "blown_cellulose" || c.material === "mineral_wool" || c.material === "rigid_board") return c.material;
  return c.material;
}

/** Reasonable first answers from what the plans say. */
export function defaultAnswers(m: Merged): Answers {
  return {
    garageInside: m.garage === "attached" ? false : null,
    sealedAttic: m.attic === "sealed" || m.attic === "both" || pickFor(m, ["RL"])?.material === "open_cell" || pickFor(m, ["RL"])?.material === "closed_cell",
    demising: m.attic === "both" || (m.attic === "sealed" && (m.garage === "attached" || m.porch === true)),
    pitch: m.pitches[0]?.rise ?? TEAM_PITCH,
    heights: m.heights.length ? m.heights.map((h) => h.feet) : [],
    framing: m.framing,
    foundation: m.foundation ?? "unknown",
    stories: m.stories,
  };
}

export function proposeItems(m: Merged, a: Answers): Proposed[] {
  const out: Proposed[] = [];
  const wallDepth = a.framing === "2x6" ? 5.5 : a.framing === "2x8" ? 7.25 : 3.5;
  const quoteOf = (c: ScanInsulation | null) => (c ? `Plans: "${c.quote}"` : "");
  const fromPlans = a.pitch !== null && m.pitches.some((p) => p.rise === a.pitch);
  const pitch = a.pitch ?? TEAM_PITCH;
  const pitchWhy = fromPlans ? `${pitch}/12 pitch from the plans` : pitch === TEAM_PITCH ? "No pitch on the plans: 10/10 (12/12) team default, check it" : `${pitch}/12 pitch`;
  const taber = /taber/i.test(m.builder ?? "");
  const ceilings = m.ceilings ?? [];
  const has = (k: string) => ceilings.filter((c) => c.kind === k);
  const where = (list: { where: string }[]) => [...new Set(list.map((c) => c.where).filter(Boolean))].slice(0, 4).join(", ");
  const stories = a.stories ?? m.stories ?? 1;
  const garageOut = m.garage === "attached" && a.garageInside === false;

  // ---- walls
  const ew = pickFor(m, ["EW"]);
  const ewMat = materialOf(ew, "open_cell");
  const ewIn = ew?.thickness_in ?? (ewMat === "open_cell" || ewMat === "closed_cell" ? Math.min(wallDepth, inchesFor(ewMat, ew?.r_value ?? null) ?? wallDepth) : null);
  const heights = a.heights.length ? a.heights : [DEFAULT_HEIGHT.wall];
  heights.forEach((h, i) =>
    out.push({
      key: `ew-${h}`,
      on: true,
      why: [heights.length > 1 ? `Wall height ${ft(h)} on the plans` : a.heights.length ? `Plate height ${ft(h)}` : "No wall height on the plans: 9' to start, check it", "Trace the outside face, a corner at every jog", quoteOf(ew)].filter(Boolean).join(" · "),
      item: { name: heights.length > 1 ? `Exterior walls (${ft(h)})` : "Exterior walls", kind: "linear", material: ewMat, thickness_in: ewIn, r_value: ew?.r_value ? `R-${ew.r_value}` : null, height_ft: h, area_code: "EW", sort: i },
    }),
  );

  // The garage sits beside the first floor: use its wall height.
  const firstH = m.heights.find((h) => a.heights.includes(h.feet) && h.where.some((w) => /first|main|1st|ground|garage/i.test(w)))?.feet ?? (a.heights.length ? Math.max(...a.heights) : DEFAULT_HEIGHT.wall);
  if (garageOut) {
    // What the plans call for on the garage wall itself, if anything; else the same as the exterior walls.
    const gc = m.insulation.find((i) => /garage/i.test(`${i.location} ${i.quote}`) && /wall/i.test(`${i.location} ${i.quote}`)) ?? null;
    const gMat = gc ? materialOf(gc, ewMat) : ewMat;
    const gIn = gc ? gc.thickness_in ?? (gMat === "open_cell" || gMat === "closed_cell" ? Math.min(wallDepth, inchesFor(gMat, gc.r_value) ?? wallDepth) : null) : ewIn;
    const gR = gc?.r_value ?? (gc ? null : ew?.r_value ?? null);
    out.push({
      key: "gw",
      on: true,
      why: gc ? `Plans: "${gc.quote}"` : "Attached garage outside the conditioned house: the walls between it and the living space",
      item: { name: "Garage partition walls", kind: "linear", material: gMat, thickness_in: gIn, r_value: gR ? `R-${gR}` : null, height_ft: firstH, area_code: "EW" },
    });
  }

  // Knee walls: a ceiling that changes height, tray / coffered risers, vaults, bonus rooms facing the attic.
  const kw = pickFor(m, ["KW"]);
  const steps = [...new Set(ceilings.map((c) => c.feet).filter((f): f is number => Boolean(f)))].sort((x, y) => x - y);
  const step = steps.length > 1 ? Math.round((steps[1] - steps[0]) * 100) / 100 : null;
  const risers = [...has("tray"), ...has("coffered"), ...has("vaulted"), ...has("cathedral")];
  const kneeSigns = Boolean(kw) || (!a.sealedAttic && (risers.length > 0 || step !== null || m.living_over_garage === true));
  if (kneeSigns) {
    const kMat = materialOf(kw, a.sealedAttic ? "open_cell" : "fiberglass_batts");
    out.push({
      key: "kw",
      on: true,
      why: [
        kw ? quoteOf(kw) : "",
        step ? `Ceilings step from ${ft(steps[0])} to ${ft(steps[1])}: knee walls along that line are ${ft(step)} high` : `No height on the plans: ${ft(DEFAULT_HEIGHT.knee)} to start`,
        risers.length ? `Risers at: ${where(risers)}` : m.living_over_garage ? "Bonus room walls that face the attic" : "",
      ].filter(Boolean).join(" · "),
      item: { name: "Knee walls", kind: "linear", material: kMat, thickness_in: kw?.thickness_in ?? (kMat === "open_cell" || kMat === "closed_cell" ? inchesFor(kMat, kw?.r_value ?? null) ?? 3.5 : null), r_value: kw?.r_value ? `R-${kw.r_value}` : null, height_ft: step ?? DEFAULT_HEIGHT.knee, area_code: "KW" },
    });
  }

  // ---- the attic: foam at the roof line (sealed) or insulation on the attic floor (vented)
  const rl = pickFor(m, ["RL"]);
  const cl = pickFor(m, ["CL"]);
  const rlMat = materialOf(rl, "open_cell");
  const rlIn = rl?.thickness_in ?? inchesFor(rlMat, rl?.r_value ?? null) ?? 5.5;
  if (a.sealedAttic) {
    out.push({
      key: "rl",
      on: true,
      why: [rl ? quoteOf(rl) : "Sealed attic: foam at the roof deck", pitchWhy, "Plan area × pitch; foam stops at the exterior wall line (no overhangs)"].join(" · "),
      item: { name: "Roof line (sealed attic)", kind: "area", material: rlMat, thickness_in: rlIn, r_value: rl?.r_value ? `R-${rl.r_value}` : null, pitch, area_code: "RL" },
    });
    // Gable walls between the sealed attic and the vented porch / garage attics.
    if (a.demising) {
      const spots = [...(garageOut ? ["garage"] : []), ...(m.porch ? ["porch"] : [])];
      for (const spot of spots.length ? spots : ["porch or garage"])
        out.push({
          key: `dm-${spot}`,
          on: true,
          why: `Walls off the vented ${spot} attic from the sealed attic. Trace its bottom; the height comes from the ${pitch}/12 pitch`,
          item: { name: `Attic demising wall (${spot})`, kind: "linear", shape: "gable", material: rlMat, thickness_in: rlIn, pitch, area_code: "RL" },
        });
    } else if (garageOut) {
      out.push({
        key: "grl",
        on: true,
        why: `The attic over the garage is sealed too: foam its roof line · ${pitchWhy}`,
        item: { name: "Garage roof line", kind: "area", material: rlMat, thickness_in: rlIn, pitch, area_code: "RL" },
      });
      out.push({
        key: "gcl",
        on: true,
        why: "The garage can't share air with the house, so its ceiling under the sealed attic is its own line",
        item: { name: "Garage ceiling", kind: "area", material: materialOf(cl, "blown_fiberglass"), area_code: "CL" },
      });
    }
  }
  if (!a.sealedAttic || cl) {
    const mat = materialOf(cl, "blown_fiberglass");
    out.push({
      key: "cl",
      on: !a.sealedAttic,
      why: [cl ? quoteOf(cl) : "Vented attic: insulation on the attic floor", has("tray").length ? "Include the flat middle of tray ceilings" : ""].filter(Boolean).join(" · "),
      item: { name: a.sealedAttic ? "Ceiling (vented areas)" : "Attic ceiling (flat)", kind: "area", material: mat, thickness_in: cl?.thickness_in ?? (mat === "open_cell" || mat === "closed_cell" ? inchesFor(mat, cl?.r_value ?? null) : null), r_value: cl?.r_value ? `R-${cl.r_value}` : "R-38", area_code: "CL" },
    });
  }
  if (!a.sealedAttic && m.hvac_platform) {
    out.push({
      key: "ud",
      on: true,
      why: "Ceiling under the HVAC platform or attic decking: batts before the decking goes down (it can't be blown later)",
      item: { name: "Under decking", kind: "area", material: "fiberglass_batts", r_value: cl?.r_value ? `R-${cl.r_value}` : null, area_code: "CL" },
    });
  }

  // Diagonal ceilings. Under a sealed attic they're inside the envelope (the roof line covers them), except sloped
  // ceilings, which have no attic behind them at all.
  const slopeWhy = (list: { where: string }[]) =>
    [where(list) ? `On the plans: ${where(list)}` : "", pitchWhy, "Plan area × pitch", taber ? "Homes by Taber: about 10/10; a low side with no height starts at 8' and slopes up to 10'" : ""].filter(Boolean).join(" · ");
  if (!a.sealedAttic) {
    if (has("vaulted").length)
      out.push({ key: "vt", on: true, why: `One-sided slope open to the attic behind · ${slopeWhy(has("vaulted"))}`, item: { name: "Vaulted ceiling", kind: "area", material: materialOf(cl, "blown_fiberglass"), pitch, area_code: "CL" } });
    if (has("cathedral").length)
      out.push({ key: "ct", on: true, why: `Two-sided slope open to the attic behind · ${slopeWhy(has("cathedral"))}`, item: { name: "Cathedral ceiling", kind: "area", material: materialOf(cl, "blown_fiberglass"), pitch, area_code: "CL" } });
    if (has("tray").length || has("coffered").length)
      out.push({
        key: "tr",
        on: true,
        why: `Tray and coffered ceilings break into three parts: the flat middle (on the attic ceiling), slopes next to exterior walls that follow the roof line, and slopes next to interior space open to the attic. Trace each slope on the floor plan · ${slopeWhy([...has("tray"), ...has("coffered")])}`,
        item: { name: "Tray ceiling slopes", kind: "area", material: materialOf(cl, "blown_fiberglass"), pitch, area_code: "CL" },
      });
  }
  if (has("sloped").length)
    out.push({ key: "sl", on: true, why: `Insulation fills the cavity from drywall to roof deck; no attic behind · ${slopeWhy(has("sloped"))}`, item: { name: "Sloped ceiling", kind: "area", material: rlMat, thickness_in: rlIn, pitch, area_code: "RL" } });

  // ---- rim joists and the foundation
  const rj = pickFor(m, ["RJ"]);
  const rimFt = Math.round(((m.rim_joist_in ?? 11.25) / 12) * 10000) / 10000;
  const rimWhy = m.rim_joist_in ? `${m.rim_joist_in}" rim from the plans` : "No rim depth on the plans: 11 1/4\" (2x12) to start";
  if (rj || stories >= 2)
    out.push({ key: "rj", on: true, why: [rj ? quoteOf(rj) : "Between the floors, exposed to outdoors", rimWhy].join(" · "), item: { name: "Rim joist to outdoors", kind: "linear", material: materialOf(rj, "closed_cell"), thickness_in: rj?.thickness_in ?? inchesFor(materialOf(rj, "closed_cell"), rj?.r_value ?? null) ?? 3, r_value: rj?.r_value ? `R-${rj.r_value}` : null, height_ft: rimFt, area_code: "RJ" } });
  if (stories >= 2 && !a.sealedAttic)
    out.push({ key: "rja", on: false, why: `Where a second floor's band joist faces a lower attic (over the garage or a first-floor wing) · ${rimWhy}`, item: { name: "Rim joist to attic", kind: "linear", material: "closed_cell", thickness_in: 3, height_ft: rimFt, area_code: "RJ" } });
  if (a.foundation === "basement" || a.foundation === "crawl_sealed")
    out.push({
      key: "fw",
      on: true,
      why: `${a.foundation === "basement" ? "Basement walls" : "Stem walls of the encapsulated crawlspace"} · ${ft(DEFAULT_HEIGHT.foundation)} to start unless the plans say`,
      item: { name: "Foundation walls", kind: "linear", material: "closed_cell", thickness_in: 2, height_ft: DEFAULT_HEIGHT.foundation, area_code: null },
    });

  // ---- floors
  if (a.foundation === "slab" || a.foundation === "unknown")
    out.push({
      key: "slab",
      on: a.foundation === "slab",
      why: "The first floor's conditioned footprint only (a second floor is never slab). Trace it on the foundation plan; the area and the full perimeter, including the edge along the garage, are both on the report",
      item: { name: "Slab", kind: "area", material: null, area_code: null },
    });
  if (m.living_over_garage && garageOut)
    out.push({ key: "fg", on: true, why: "Living space over the garage: insulate the floor above it", item: { name: "Floor over garage", kind: "area", material: "closed_cell", thickness_in: 3, area_code: null } });
  if (m.floor_over_outdoors)
    out.push({ key: "fo", on: true, why: "Cantilevered floor or living space over a porch: outdoors below", item: { name: "Floor over outdoors", kind: "area", material: "closed_cell", thickness_in: 3, area_code: null } });

  const pw = pickFor(m, ["PW"]);
  if (pw)
    out.push({ key: "pw", on: false, why: `${quoteOf(pw)} · Interior walls between conditioned rooms aren't part of the thermal envelope`, item: { name: "Interior walls (sound)", kind: "linear", material: materialOf(pw, "fiberglass_batts"), r_value: pw.r_value ? `R-${pw.r_value}` : "R-13", height_ft: heights[0], area_code: "PW" } });
  return out;
}
