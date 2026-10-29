// Turns the AI pre-scan (what the plans say) plus the contractor's answers into ready-to-measure takeoff
// items: one exterior-wall item per wall height, the attic or the roof deck, garage walls, attic
// demising walls (sized from the roof pitch), knee walls and rim joist. Nothing is measured for them:
// they trace the shapes.

import type { Merged, ScanInsulation } from "@/lib/takeoff/prescan";
import type { TItem } from "@/lib/takeoff/calc";

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
    pitch: m.pitches[0]?.rise ?? null,
    heights: m.heights.length ? m.heights.map((h) => h.feet) : [],
    framing: m.framing,
  };
}

export function proposeItems(m: Merged, a: Answers): Proposed[] {
  const out: Proposed[] = [];
  const wallDepth = a.framing === "2x6" ? 5.5 : a.framing === "2x8" ? 7.25 : 3.5;
  const quoteOf = (c: ScanInsulation | null) => (c ? `Plans: "${c.quote}"` : "");

  // Exterior walls: one item per wall height.
  const ew = pickFor(m, ["EW"]);
  const ewMat = materialOf(ew, "open_cell");
  const ewIn = ew?.thickness_in ?? (ewMat === "open_cell" || ewMat === "closed_cell" ? Math.min(wallDepth, inchesFor(ewMat, ew?.r_value ?? null) ?? wallDepth) : null);
  const heights = a.heights.length ? a.heights : [9];
  heights.forEach((h, i) =>
    out.push({
      key: `ew-${h}`,
      on: true,
      why: [heights.length > 1 ? `Wall height ${ft(h)} on the plans` : a.heights.length ? `Plate height ${ft(h)}` : "No wall height on the plans: 9' to start, check it", quoteOf(ew)].filter(Boolean).join(" · "),
      item: { name: heights.length > 1 ? `Exterior walls (${ft(h)})` : "Exterior walls", kind: "linear", material: ewMat, thickness_in: ewIn, r_value: ew?.r_value ? `R-${ew.r_value}` : null, height_ft: h, area_code: "EW", sort: i },
    }),
  );

  // The attic: foam at the roofline (sealed) or insulation on the attic floor (vented).
  const rl = pickFor(m, ["RL"]);
  const cl = pickFor(m, ["CL"]);
  if (a.sealedAttic) {
    const mat = materialOf(rl, "open_cell");
    out.push({
      key: "rl",
      on: true,
      why: [rl ? quoteOf(rl) : "Sealed attic: foam at the roof deck", a.pitch ? `${a.pitch}/12 pitch from the plans` : "No pitch on the plans: set it"].join(" · "),
      item: { name: "Roof deck (sealed attic)", kind: "area", material: mat, thickness_in: rl?.thickness_in ?? inchesFor(mat, rl?.r_value ?? null) ?? 5.5, r_value: rl?.r_value ? `R-${rl.r_value}` : null, pitch: a.pitch, area_code: "RL" },
    });
    // Gable walls between the sealed attic and the vented porch / garage attics.
    if (a.demising) {
      const spots = [...(m.garage === "attached" && !a.garageInside ? ["garage"] : []), ...(m.porch ? ["porch"] : [])];
      for (const spot of spots.length ? spots : ["porch or garage"])
        out.push({
          key: `dm-${spot}`,
          on: true,
          why: `Walls off the vented ${spot} attic from the sealed attic. Trace its bottom; the height comes from the ${a.pitch ?? 6}/12 pitch`,
          item: { name: `Attic demising wall (${spot})`, kind: "linear", shape: "gable", material: mat, thickness_in: rl?.thickness_in ?? inchesFor(mat, rl?.r_value ?? null) ?? 5.5, pitch: a.pitch ?? 6, area_code: "RL" },
        });
    }
  }
  if (!a.sealedAttic || cl) {
    const mat = materialOf(cl, "blown_fiberglass");
    out.push({
        key: "cl",
        on: !a.sealedAttic,
        why: cl ? quoteOf(cl) : "Vented attic: insulation on the attic floor",
        item: { name: a.sealedAttic ? "Ceiling (vented areas)" : "Attic floor / ceiling", kind: "area", material: mat, thickness_in: cl?.thickness_in ?? (mat === "open_cell" || mat === "closed_cell" ? inchesFor(mat, cl?.r_value ?? null) : null), r_value: cl?.r_value ? `R-${cl.r_value}` : "R-38", area_code: "CL" },
      });
  }

  // Garage: the wall to the house (and the ceiling or floor between them) when the garage isn't conditioned.
  if (m.garage === "attached" && a.garageInside === false) {
    // What the plans call for on the garage wall itself, if anything; else the same as the exterior walls.
    const gc = m.insulation.find((i) => /garage/i.test(`${i.location} ${i.quote}`) && /wall/i.test(`${i.location} ${i.quote}`)) ?? null;
    const gMat = gc ? materialOf(gc, ewMat) : ewMat;
    const gIn = gc ? gc.thickness_in ?? (gMat === "open_cell" || gMat === "closed_cell" ? Math.min(wallDepth, inchesFor(gMat, gc.r_value) ?? wallDepth) : null) : ewIn;
    const gR = gc?.r_value ?? (gc ? null : ew?.r_value ?? null);
    out.push({
      key: "gw",
      on: true,
      why: gc ? `Plans: "${gc.quote}"` : "Attached garage outside the conditioned house: insulate the wall between them",
      item: { name: "Garage common wall", kind: "linear", material: gMat, thickness_in: gIn, r_value: gR ? `R-${gR}` : null, height_ft: heights[0], area_code: "EW" },
    });
    if (m.living_over_garage)
      out.push({
        key: "fg",
        on: true,
        why: "Living space over the garage: insulate the floor above it",
        item: { name: "Floor over garage", kind: "area", material: "closed_cell", thickness_in: 3, area_code: null },
      });
  }

  const kw = pickFor(m, ["KW"]);
  if (kw)
    out.push({ key: "kw", on: true, why: quoteOf(kw), item: { name: "Knee walls", kind: "linear", material: materialOf(kw, "open_cell"), thickness_in: kw.thickness_in ?? inchesFor(materialOf(kw, "open_cell"), kw.r_value) ?? 3.5, r_value: kw.r_value ? `R-${kw.r_value}` : null, height_ft: 4, area_code: "KW" } });
  const rj = pickFor(m, ["RJ"]);
  if (rj)
    out.push({ key: "rj", on: true, why: quoteOf(rj), item: { name: "Rim joist", kind: "linear", material: materialOf(rj, "closed_cell"), thickness_in: rj.thickness_in ?? inchesFor(materialOf(rj, "closed_cell"), rj.r_value) ?? 3, r_value: rj.r_value ? `R-${rj.r_value}` : null, height_ft: 1, area_code: "RJ" } });
  const pw = pickFor(m, ["PW"]);
  if (pw)
    out.push({ key: "pw", on: false, why: quoteOf(pw), item: { name: "Interior walls (sound)", kind: "linear", material: materialOf(pw, "fiberglass_batts"), r_value: pw.r_value ? `R-${pw.r_value}` : "R-13", height_ft: heights[0], area_code: "PW" } });
  return out;
}
