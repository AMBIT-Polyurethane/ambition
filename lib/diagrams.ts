/**
 * Exploded parts diagrams: the manufacturer's drawing with a dot on every part. Hover a dot to see the part number,
 * click it to add the part to the cart. Used by the ADC web store and the AMBIT order screen.
 *
 * Points are in the drawing's own pixels (w x h); the page scales them. A part can have more than one dot (it shows
 * twice in the drawing) and table rows can be boxes. Parts that aren't in the catalog yet still show: on the ADC store
 * they go on the order with "price to confirm"; in the app they say to ask AMBIT.
 */

import { ST1_SHAPES } from "@/lib/diagram-shapes-st1";

export type PartGroup = "body" | "a" | "b" | "air" | "seal" | "mix" | "check";

export const PART_GROUPS: Record<PartGroup, { label: string; color: string }> = {
  a: { label: "A-side (ISO)", color: "#E33527" },
  b: { label: "B-side (resin)", color: "#2563EB" },
  mix: { label: "Mix chamber & tips", color: "#16A34A" },
  air: { label: "Air & valves", color: "#D97706" },
  seal: { label: "O-rings & seals", color: "#9333EA" },
  check: { label: "Check valve parts", color: "#0891B2" },
  body: { label: "Gun body", color: "#475569" },
};

export type DiagramPart = {
  /** The number in the drawing (blank for table-only parts). */
  n: string;
  sku: string;
  name: string;
  group: PartGroup;
  /** Where the part is drawn: [x, y] in drawing pixels (one per copy; places the tip). */
  at?: [number, number][];
  /** The part's own outline in the drawing (SVG paths, drawing pixels): hover lights up the part itself. */
  shapes?: string[];
  /** Table rows: [x, y, w, h]. */
  box?: [number, number, number, number][];
  qty?: string;
  /** Shown under the name: e.g. a piece that only comes in an assembly (its sku is the assembly's). */
  note?: string;
};

export type Diagram = {
  slug: string;
  title: string;
  /** The gun this is for (its product page links here). */
  forSku: string;
  image: string;
  w: number;
  h: number;
  source: string;
  parts: DiagramPart[];
};

const ST1: Diagram = {
  slug: "st1",
  title: "Carlisle ST1 gun: every part",
  forSku: "336508",
  image: "/diagrams/st1-parts.png",
  w: 1233,
  h: 798,
  source: "Carlisle ST1 plural component air purge spray gun, components (DOC 336741 D)",
  parts: [
    { n: "1", sku: "336352", name: "Handle", group: "body", at: [[440, 440]] },
    { n: "2", sku: "336359", name: "Shaft guide", group: "body", at: [[352, 350]] },
    { n: "3", sku: "336417", name: "O-ring, head and handle junction (2-pack)", group: "seal", at: [[315, 365]] },
    { n: "4", sku: "336353", name: "Head", group: "body", at: [[262, 385]] },
    { n: "5", sku: "336375", name: "Side seal cartridge assembly, A-side", group: "a", at: [[342, 422]] },
    { n: "6", sku: "336376", name: "Side seal cartridge assembly, B-side", group: "b", at: [[170, 365]] },
    { n: "7", sku: "336356", name: "Manifold screw", group: "body", at: [[187, 400], [210, 630]], qty: "2 per gun" },
    { n: "8", sku: "336360", name: "Check valve, A-side", group: "a", at: [[285, 462]] },
    { n: "9", sku: "336361", name: "Check valve, B-side", group: "b", at: [[242, 455]] },
    { n: "10", sku: "336415", name: "O-ring, guide and housing (10-pack)", group: "seal", at: [[120, 410], [668, 508], [838, 542]], box: [[580, 631, 182, 17], [770, 694, 204, 11]] },
    { n: "11", sku: "336437", name: "Guide (includes item 10)", group: "mix", at: [[160, 430]] },
    { n: "12", sku: "336446", name: "Mix chamber", group: "mix", at: [[115, 450]] },
    { n: "13", sku: "336452", name: "Mix tip 00 (.052)", group: "mix", at: [[67, 467]], box: [[880, 441, 92, 14]] },
    { n: "14", sku: "336355", name: "Fluid manifold", group: "body", at: [[215, 575]] },
    { n: "15", sku: "336372", name: "Manual valve", group: "air", at: [[190, 598], [232, 640]], qty: "2 per gun" },
    { n: "16", sku: "336357", name: "Swivel adapter, A-side", group: "a", at: [[300, 562]] },
    { n: "17", sku: "336358", name: "Swivel adapter, B-side", group: "b", at: [[232, 530]] },
    { n: "18", sku: "336335", name: "Pipe plug, 1/8 NPT 303 SS", group: "body", at: [[282, 597]], qty: "2 per gun" },
    { n: "19", sku: "336384", name: "Trigger stud", group: "body", at: [[417, 557]] },
    { n: "20", sku: "336365", name: "Trigger screw", group: "body", at: [[345, 527]] },
    { n: "21", sku: "336363", name: "Trigger", group: "body", at: [[370, 590]] },
    { n: "22", sku: "336370", name: "Rod and piston assembly", group: "air", at: [[612, 245]] },
    { n: "23", sku: "336419", name: "O-ring, air piston (2-pack)", group: "seal", at: [[667, 220]] },
    { n: "24", sku: "336373", name: "End cap", group: "air", at: [[482, 172]] },
    { n: "25", sku: "336735", name: "Spring", group: "air", at: [[532, 152]] },
    { n: "26", sku: "336413", name: "O-ring, safety stop (2-pack)", group: "seal", at: [[555, 145]] },
    { n: "27", sku: "336737", name: "Safety stop knob", group: "air", at: [[595, 125]] },
    { n: "28", sku: "336736", name: "Lock arm", group: "air", at: [[368, 222]] },
    { n: "29", sku: "336420", name: "O-ring, end cap (2-pack)", group: "seal", at: [[425, 198]] },
    { n: "30", sku: "336394", name: "Check valve assembly, air", group: "air", at: [[495, 297]] },
    { n: "31", sku: "336401", name: "Stud", group: "body", at: [[440, 725]] },
    { n: "32", sku: "336399", name: "Clip", group: "body", at: [[445, 680]] },
    { n: "33", sku: "336400", name: "Spacer", group: "body", at: [[427, 650]] },
    { n: "34", sku: "336374", name: "Muffler", group: "air", at: [[445, 602]] },
    { n: "35", sku: "336412", name: "O-ring, air valve and piston rod (10-pack)", group: "seal", at: [[525, 270], [505, 345]], qty: "4 per gun" },
    { n: "36", sku: "336366", name: "Valve stem", group: "air", at: [[575, 320]] },
    { n: "37", sku: "336367", name: "Spring", group: "air", at: [[622, 302]] },
    { n: "38", sku: "336395", name: "QD base", group: "air", at: [[660, 285]] },
    { n: "39", sku: "336396", name: "QD stem", group: "air", at: [[707, 262]] },
    { n: "40", sku: "336398", name: "Strap", group: "body", at: [[530, 565]] },
    { n: "41", sku: "336643", name: "Hose", group: "air", at: [[800, 275]] },
    { n: "42", sku: "336408", name: "Ball valve", group: "air", at: [[825, 385]] },
    { n: "43", sku: "336397", name: "QD coupler", group: "air", at: [[732, 152]] },
    { n: "44", sku: "336436", name: "Flush manifold assembly", group: "body", at: [[220, 720]] },
    { n: "45", sku: "336738", name: "Grease fitting", group: "air", at: [[205, 460]] },
    { n: "50", sku: "336375", name: "Side seal cartridge housing", note: "Not sold by itself. It comes in the side seal cartridge assembly: A-side 336375, B-side 336376.", group: "seal", shapes: ["M608,484 L607,494 L609,496 L610,502 L614,505 L619,505 L620,507 L627,507 L628,506 L635,507 L638,510 L649,511 L654,504 L655,493 L652,490 L644,489 L641,486 L637,485 L634,481 L625,476 L619,476 Z"], box: [[580, 610, 182, 19]] },
    { n: "56", sku: "336360", name: "Spring retainer, check valve", note: "Not sold by itself. It comes in the fluid check valve: A-side 336360, B-side 336361.", group: "check", shapes: ["M882.7,557.3 L885.0,555.3 L888.3,556.0 L893.3,554.0 L898.3,553.3 L902.7,556.0 L904.0,561.7 L903.3,568.3 L900.0,571.7 L893.3,570.7 L889.3,567.3 L888.3,562.7 L884.0,561.7 Z"], box: [[770, 660, 204, 10]] },
    { n: "60", sku: "336360", name: "Check valve housing (A / B side)", note: "Not sold by itself. It comes in the fluid check valve: A-side 336360, B-side 336361.", group: "check", shapes: ["M791.7,527.3 L795.0,522.7 L803.3,521.7 L808.3,527.3 L823.3,532.7 L833.3,535.0 L836.7,538.3 L837.3,546.7 L834.0,550.7 L823.3,550.0 L810.0,546.7 L797.3,545.0 L792.3,541.7 L790.0,535.0 Z"], box: [[770, 706, 204, 11]] },
    { n: "52", sku: "336378", name: "Spring, side seal", group: "seal", at: [[695, 517]], box: [[580, 651, 182, 17]] },
    { n: "53", sku: "336414", name: "O-ring, side seal (10-pack)", group: "seal", at: [[712, 522]], box: [[580, 671, 182, 17]] },
    { n: "54", sku: "336379", name: "Side seal, poly (2-pack with o-rings)", group: "seal", at: [[730, 531]], box: [[580, 691, 182, 15]] },
    { n: "54", sku: "336410", name: "Side seal, poly (50-pack with o-rings)", group: "seal", box: [[580, 710, 182, 15]] },
    { n: "", sku: "336381", name: "Side seals, stainless steel", group: "seal" },
    { n: "55", sku: "336422", name: "Screen, 40 mesh (10-pack)", group: "check", at: [[920, 570]], box: [[770, 638, 204, 11]] },
    { n: "55", sku: "336423", name: "Screen, 60 mesh (10-pack)", group: "check", box: [[770, 649, 204, 11]] },
    { n: "57", sku: "336362", name: "Spring, check valve", group: "check", at: [[868, 555]], box: [[770, 670, 204, 11]] },
    { n: "58", sku: "336427", name: "Ball, check valve (10-pack)", group: "check", at: [[850, 550]], box: [[770, 682, 204, 11]] },
    { n: "61", sku: "336418", name: "O-ring, check valve face (10-pack)", group: "seal", at: [[787, 532]], box: [[770, 717, 204, 20]] },
    // Mix chamber and mix tip combos (include drill bits)
    { n: "", sku: "336441", name: "Mix chamber B + mix tip 01 combo (4242)", group: "mix", box: [[822, 140, 152, 15]] },
    { n: "", sku: "336442", name: "Mix chamber C + mix tip 15 combo (4747)", group: "mix", box: [[822, 155, 152, 15]] },
    { n: "", sku: "336443", name: "Mix chamber D + mix tip 02 combo (5252)", group: "mix", box: [[822, 170, 152, 15]] },
    { n: "", sku: "336444", name: "Mix chamber E + mix tip 03 combo (6060)", group: "mix", box: [[822, 185, 152, 15]] },
    { n: "", sku: "336445", name: "Mix chamber F + mix tip 04 combo (7070)", group: "mix", box: [[822, 200, 152, 15]] },
    // Individual mix chambers (include impingement drill bit)
    { n: "", sku: "336447", name: "Mix chamber B, 01 (.042)", group: "mix", box: [[857, 307, 115, 14]] },
    { n: "", sku: "336448", name: "Mix chamber C, 15 (.047)", group: "mix", box: [[857, 321, 115, 14]] },
    { n: "", sku: "336449", name: "Mix chamber D, 02 (.052)", group: "mix", box: [[857, 336, 115, 14]] },
    { n: "", sku: "336450", name: "Mix chamber E, 03 (.060)", group: "mix", box: [[857, 349, 115, 14]] },
    { n: "", sku: "336451", name: "Mix chamber F, 04 (.070)", group: "mix", box: [[857, 363, 115, 14]] },
    // Individual mix tips (include drill bit)
    { n: "", sku: "336453", name: "Mix tip 01 (.060)", group: "mix", box: [[880, 456, 92, 14]] },
    { n: "", sku: "336454", name: "Mix tip 15 (.064)", group: "mix", box: [[880, 471, 92, 14]] },
    { n: "", sku: "336455", name: "Mix tip 02 (.070)", group: "mix", box: [[880, 485, 92, 14]] },
    { n: "", sku: "336456", name: "Mix tip 03 (.086)", group: "mix", box: [[880, 500, 92, 14]] },
    { n: "", sku: "336457", name: "Mix tip 04 (.093)", group: "mix", box: [[880, 514, 92, 14]] },
    // Extension tips (include drill bit)
    { n: "", sku: "336458", name: "Extension tip 01 XS (.060), adds 1/2 in", group: "mix", box: [[56, 173, 149, 15]] },
    { n: "", sku: "336459", name: "Extension tip 01 XL (.060), adds 1 in", group: "mix", box: [[56, 189, 149, 15]] },
    { n: "", sku: "336460", name: "Extension tip 15 XS (.064), adds 1/2 in", group: "mix", box: [[56, 205, 149, 15]] },
    { n: "", sku: "336461", name: "Extension tip 15 XL (.064), adds 1 in", group: "mix", box: [[56, 221, 149, 15]] },
    { n: "", sku: "336462", name: "Extension tip 02 XS (.070), adds 1/2 in", group: "mix", box: [[56, 237, 149, 15]] },
    { n: "", sku: "336463", name: "Extension tip 02 XL (.070), adds 1 in", group: "mix", box: [[56, 253, 149, 15]] },
  ],
};

// The printed PARTS LIST on the right: every row (items 1 to 45) is a box too. Row centers, measured on the drawing.
const ST1_ROWS = [101.5, 116, 131, 147.5, 162.5, 177.5, 193, 207.5, 223, 238, 253.5, 267.5, 282, 296.5, 311, 325.5, 340, 354.5, 369, 383.5,
  398, 412.5, 427, 441.5, 455.5, 469.5, 483, 496.5, 510, 523.5, 537.5, 551.5, 565, 578.5, 592.5, 607, 620.5, 634.5, 648.5, 662, 676, 690,
  703.5, 717.5, 731];
for (const p of ST1.parts) {
  const k = Number(p.n);
  if (!p.n || !Number.isInteger(k) || k < 1 || k > 45) continue;
  if (ST1.parts.find((x) => x.n === p.n) !== p) continue;
  const y = ST1_ROWS[k - 1];
  p.box = [...(p.box ?? []), [985, Math.round(y - 6.5), 197, 13]];
}

// Each part's outline, traced from the drawing (lib/diagram-shapes-st1.ts). A part listed twice gets them once.
for (const p of ST1.parts) {
  if (ST1.parts.find((x) => x.sku === p.sku) !== p) continue;
  if (ST1_SHAPES[p.sku]) p.shapes = ST1_SHAPES[p.sku];
}

export const DIAGRAMS: Diagram[] = [ST1];
export const diagramFor = (sku: string | null | undefined) => DIAGRAMS.find((d) => d.forSku.toLowerCase() === (sku ?? "").toLowerCase()) ?? null;
export const diagramBySlug = (slug: string) => DIAGRAMS.find((d) => d.slug === slug) ?? null;
/** Every part number in every diagram (to look up prices once). */
export const diagramSkus = (d: Diagram) => [...new Set(d.parts.map((p) => p.sku))];
