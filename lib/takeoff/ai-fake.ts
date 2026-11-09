import "server-only";

// A stand-in answer for testing the takeoff AI screens without calling Claude. Only used when the server
// has TAKEOFF_AI_FAKE=1 (never set in production). It "reads" a simple house in the middle of the picture.

export function fakeSheetRead(w: number, h: number, name: string, correction?: string | null, pdfText = "") {
  const elev = /elevation/i.test(pdfText) || /elev/i.test(name);
  const x0 = Math.round(w * 0.3);
  const y0 = Math.round(h * 0.28);
  const x1 = Math.round(w * 0.7);
  const y1 = Math.round(h * 0.68);
  const gx = Math.round(w * 0.55);
  const midY = Math.round((y0 + y1) / 2);
  const fixed = Boolean(correction);
  return {
    analysis: `Stand-in reading of ${name} for testing. First floor plan; conditioned rectangle with a garage on the right.${fixed ? ` Correction applied: ${correction}` : ""}`,
    sheet_kind: elev ? "elevation" : "floor_plan",
    sheet_number: name.slice(0, 10),
    level: "first floor",
    elevation_side: elev ? "front" : "none",
    scale: { text: '1/4" = 1\'-0"', feet_per_inch: 4 },
    dimension_check: { found: true, x1: x0, y1: y0 - 20, x2: x1, y2: y0 - 20, feet: 55, quote: "55'-0\"" },
    assemblies: [
      { assembly: "exterior_walls", instance: "house", points: [[gx, y0], [x0, y0], [x0, y1], [gx, y1]], height_ft: 10, pitch: 0, height_source: "plan", note: "10' plate per section" },
      { assembly: "garage_partition_walls", instance: "garage wall", points: [[gx, y0], [gx, y1]], height_ft: 10, pitch: 0, height_source: "plan", note: "" },
      { assembly: "slab", instance: "first floor footprint", points: [[x0, y0], [gx, y0], [gx, y1], [x0, y1]], height_ft: 0, pitch: 0, height_source: "none", note: "" },
      { assembly: "attic_ceilings", instance: "living areas", points: [[x0, y0], [gx, y0], [gx, midY], [x0, midY]], height_ft: 0, pitch: 0, height_source: "none", note: "" },
      fixed
        ? { assembly: "vaulted_ceilings", instance: "master bedroom", points: [[x0, midY], [gx, midY], [gx, y1], [x0, y1]], height_ft: 0, pitch: 12, height_source: "default", note: "10/10 default" }
        : { assembly: "attic_ceilings", instance: "bedrooms", points: [[x0, midY], [gx, midY], [gx, y1], [x0, y1]], height_ft: 0, pitch: 0, height_source: "none", note: "" },
      { assembly: "knee_walls", instance: "tray riser", points: [[x0 + 30, midY], [gx - 30, midY]], height_ft: 2, pitch: 0, height_source: "plan", note: "10' vs 8' ceiling" },
    ],
    components: [
      { kind: "window", code: "3050", width_ft: 3, height_ft: 5, side: "front", x: Math.round((x0 + gx) / 2), y: y1, wall: "exterior_walls", note: "" },
      { kind: "window", code: "3050", width_ft: 3, height_ft: 5, side: "rear", x: Math.round((x0 + gx) / 2), y: y0, wall: "exterior_walls", note: "" },
      { kind: "door", code: "3068", width_ft: 3, height_ft: 6.67, side: "front", x: x0 + 40, y: y1, wall: "exterior_walls", note: "entry" },
      { kind: "garage_door", code: "16'-0\" x 8'-0\"", width_ft: 16, height_ft: 8, side: "front", x: Math.round((gx + x1) / 2), y: y1, wall: "other", note: "" },
    ],
    facts: [
      { topic: "plate_height", value: "10 ft", where: "first floor", quote: "10' CLG HT" },
      { topic: "attic_type", value: "vented", where: "notes", quote: "R-38 BLOWN" },
    ],
    notes: ["Stand-in reading for testing.", "Pitch not given: 10/10 default used for the vault."],
  };
}

export function fakeReconcile(sheets: string[]) {
  return {
    analysis: "Stand-in check.",
    facts: [{ topic: "plate_height", value: "10 ft first floor", sheets }],
    heights: [{ what: "First floor plate", height_ft: 10, sheets }],
    pitches: [{ where: "Master vault", rise: 12, sheets }],
    components: [
      { kind: "window", code: "3050", width_ft: 3, height_ft: 5, qty: 2, side: "front", sheets },
      { kind: "door", code: "3068", width_ft: 3, height_ft: 6.67, qty: 1, side: "front", sheets },
    ],
    discrepancies: [
      { title: "Master bedroom pitch not given", detail: "The vault is shown with slope arrows only; the 10/10 default was used.", severity: "medium", sheets: sheets.slice(0, 1) },
      { title: "No foundation plan", detail: "Slab taken from the first floor plan.", severity: "low", sheets: [] },
    ],
    builder: "",
    summary: "Stand-in: a one-story house with an attached garage.",
  };
}
