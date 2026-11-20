/**
 * Exploded parts diagrams: the manufacturer's drawing with a dot on every part. Hover a dot to see the part number,
 * click it to add the part to the cart. Used by the ADC web store and the AMBIT order screen.
 *
 * Points are in the drawing's own pixels (w x h); the page scales them. A part can have more than one dot (it shows
 * twice in the drawing). The drawings are cleaned of their printed tables and notes: the parts list beside the drawing
 * has every part number and name, and table-only parts (tips, chambers, kits) live there. Parts that aren't in the catalog yet still show: on the ADC store
 * they go on the order with "price to confirm"; in the app they say to ask AMBIT.
 */

import { ST1_SHAPES } from "@/lib/diagram-shapes-st1";
import { FUSION_FX, FUSION_PC } from "@/lib/diagram-fusion";

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
  /** Where the item number sits (drawings whose printed labels were replaced with numbers). */
  tag?: [number, number][];
  qty?: string;
  /** Shown under the name: e.g. a piece that only comes in an assembly (its sku is the assembly's). */
  note?: string;
  noteEs?: string;
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
  /** Size of the item-number circles and of the plain spots, in drawing pixels. */
  tagR?: number;
  spotR?: number;
  parts: DiagramPart[];
};

const ST1: Diagram = {
  slug: "st1",
  title: "Carlisle ST1 gun: every part",
  forSku: "336508",
  image: "/diagrams/st1-parts-hd.webp",
  w: 911,
  h: 685,
  source: "Carlisle ST1 plural component air purge spray gun, components (DOC 336741 D)",
  parts: [
    { n: "1", sku: "336352", name: "Handle", group: "body", at: [[398, 365]] },
    { n: "2", sku: "336359", name: "Shaft guide", group: "body", at: [[310, 275]] },
    { n: "3", sku: "336417", name: "O-ring, head and handle junction (2-pack)", group: "seal", at: [[273, 290]] },
    { n: "4", sku: "336353", name: "Head", group: "body", at: [[220, 310]] },
    { n: "5", sku: "336375", name: "Side seal cartridge assembly, A-side", group: "a", at: [[300, 347]] },
    { n: "6", sku: "336376", name: "Side seal cartridge assembly, B-side", group: "b", at: [[128, 290]] },
    { n: "7", sku: "336356", name: "Manifold screw", group: "body", at: [[145, 325], [168, 555]], qty: "2 per gun" },
    { n: "8", sku: "336360", name: "Check valve, A-side", group: "a", at: [[243, 387]] },
    { n: "9", sku: "336361", name: "Check valve, B-side", group: "b", at: [[200, 380]] },
    { n: "10", sku: "336415", name: "O-ring, guide and housing (10-pack)", group: "seal", at: [[78, 335], [626, 433], [796, 467]] },
    { n: "11", sku: "336437", name: "Guide (includes item 10)", group: "mix", at: [[118, 355]] },
    { n: "12", sku: "336446", name: "Mix chamber", group: "mix", at: [[73, 375]] },
    { n: "13", sku: "336452", name: "Mix tip 00 (.052)", group: "mix", at: [[25, 392]] },
    { n: "14", sku: "336355", name: "Fluid manifold", group: "body", at: [[173, 500]] },
    { n: "15", sku: "336372", name: "Manual valve", group: "air", at: [[148, 523], [190, 565]], qty: "2 per gun" },
    { n: "16", sku: "336357", name: "Swivel adapter, A-side", group: "a", at: [[258, 487]] },
    { n: "17", sku: "336358", name: "Swivel adapter, B-side", group: "b", at: [[190, 455]] },
    { n: "18", sku: "336335", name: "Pipe plug, 1/8 NPT 303 SS", group: "body", at: [[240, 522]], qty: "2 per gun" },
    { n: "19", sku: "336384", name: "Trigger stud", group: "body", at: [[375, 482]] },
    { n: "20", sku: "336365", name: "Trigger screw", group: "body", at: [[303, 452]] },
    { n: "21", sku: "336363", name: "Trigger", group: "body", at: [[328, 515]] },
    { n: "22", sku: "336370", name: "Rod and piston assembly", group: "air", at: [[570, 170]] },
    { n: "23", sku: "336419", name: "O-ring, air piston (2-pack)", group: "seal", at: [[625, 145]] },
    { n: "24", sku: "336373", name: "End cap", group: "air", at: [[440, 97]] },
    { n: "25", sku: "336735", name: "Spring", group: "air", at: [[490, 77]] },
    { n: "26", sku: "336413", name: "O-ring, safety stop (2-pack)", group: "seal", at: [[513, 70]] },
    { n: "27", sku: "336737", name: "Safety stop knob", group: "air", at: [[553, 50]] },
    { n: "28", sku: "336736", name: "Lock arm", group: "air", at: [[326, 147]] },
    { n: "29", sku: "336420", name: "O-ring, end cap (2-pack)", group: "seal", at: [[383, 123]] },
    { n: "30", sku: "336394", name: "Check valve assembly, air", group: "air", at: [[453, 222]] },
    { n: "31", sku: "336401", name: "Stud", group: "body", at: [[398, 650]] },
    { n: "32", sku: "336399", name: "Clip", group: "body", at: [[403, 605]] },
    { n: "33", sku: "336400", name: "Spacer", group: "body", at: [[385, 575]] },
    { n: "34", sku: "336374", name: "Muffler", group: "air", at: [[403, 527]] },
    { n: "35", sku: "336412", name: "O-ring, air valve and piston rod (10-pack)", group: "seal", at: [[483, 195], [463, 270]], qty: "4 per gun" },
    { n: "36", sku: "336366", name: "Valve stem", group: "air", at: [[533, 245]] },
    { n: "37", sku: "336367", name: "Spring", group: "air", at: [[580, 227]] },
    { n: "38", sku: "336395", name: "QD base", group: "air", at: [[618, 210]] },
    { n: "39", sku: "336396", name: "QD stem", group: "air", at: [[665, 187]] },
    { n: "40", sku: "336398", name: "Strap", group: "body", at: [[488, 490]] },
    { n: "41", sku: "336643", name: "Hose", group: "air", at: [[758, 200]] },
    { n: "42", sku: "336408", name: "Ball valve", group: "air", at: [[783, 310]] },
    { n: "43", sku: "336397", name: "QD coupler", group: "air", at: [[690, 77]] },
    { n: "44", sku: "336436", name: "Flush manifold assembly", group: "body", at: [[178, 645]] },
    { n: "45", sku: "336738", name: "Grease fitting", group: "air", at: [[163, 385]] },
    { n: "50", sku: "336375", name: "Side seal cartridge housing", note: "Not sold by itself. It comes in the side seal cartridge assembly: A-side 336375, B-side 336376.", noteEs: "No se vende por separado. Viene en el cartucho de sello lateral: lado A 336375, lado B 336376.", group: "seal", shapes: ["M566,409 L565,419 L567,421 L568,427 L572,430 L577,430 L578,432 L585,432 L586,431 L593,432 L596,435 L607,436 L612,429 L613,418 L610,415 L602,414 L599,411 L595,410 L592,406 L583,401 L577,401 Z"] },
    { n: "56", sku: "336360", name: "Spring retainer, check valve", note: "Not sold by itself. It comes in the fluid check valve: A-side 336360, B-side 336361.", noteEs: "No se vende por separado. Viene en la válvula check de fluido: lado A 336360, lado B 336361.", group: "check", shapes: ["M840.7,482.3 L843,480.3 L846.3,481 L851.3,479 L856.3,478.3 L860.7,481 L862,486.7 L861.3,493.3 L858,496.7 L851.3,495.7 L847.3,492.3 L846.3,487.7 L842,486.7 Z"] },
    { n: "60", sku: "336360", name: "Check valve housing (A / B side)", note: "Not sold by itself. It comes in the fluid check valve: A-side 336360, B-side 336361.", noteEs: "No se vende por separado. Viene en la válvula check de fluido: lado A 336360, lado B 336361.", group: "check", shapes: ["M749.7,452.3 L753,447.7 L761.3,446.7 L766.3,452.3 L781.3,457.7 L791.3,460 L794.7,463.3 L795.3,471.7 L792,475.7 L781.3,475 L768,471.7 L755.3,470 L750.3,466.7 L748,460 Z"] },
    { n: "52", sku: "336378", name: "Spring, side seal", group: "seal", at: [[653, 442]] },
    { n: "53", sku: "336414", name: "O-ring, side seal (10-pack)", group: "seal", at: [[670, 447]] },
    { n: "54", sku: "336379", name: "Side seal, poly (2-pack with o-rings)", group: "seal", at: [[688, 456]] },
    { n: "54", sku: "336410", name: "Side seal, poly (50-pack with o-rings)", group: "seal" },
    { n: "", sku: "336381", name: "Side seals, stainless steel", group: "seal" },
    { n: "55", sku: "336422", name: "Screen, 40 mesh (10-pack)", group: "check", at: [[878, 495]] },
    { n: "55", sku: "336423", name: "Screen, 60 mesh (10-pack)", group: "check" },
    { n: "57", sku: "336362", name: "Spring, check valve", group: "check", at: [[826, 480]] },
    { n: "58", sku: "336427", name: "Ball, check valve (10-pack)", group: "check", at: [[808, 475]] },
    { n: "61", sku: "336418", name: "O-ring, check valve face (10-pack)", group: "seal", at: [[745, 457]] },
    // Mix chamber and mix tip combos (include drill bits)
    { n: "", sku: "336441", name: "Mix chamber B + mix tip 01 combo (4242)", group: "mix" },
    { n: "", sku: "336442", name: "Mix chamber C + mix tip 15 combo (4747)", group: "mix" },
    { n: "", sku: "336443", name: "Mix chamber D + mix tip 02 combo (5252)", group: "mix" },
    { n: "", sku: "336444", name: "Mix chamber E + mix tip 03 combo (6060)", group: "mix" },
    { n: "", sku: "336445", name: "Mix chamber F + mix tip 04 combo (7070)", group: "mix" },
    // Individual mix chambers (include impingement drill bit)
    { n: "", sku: "336447", name: "Mix chamber B, 01 (.042)", group: "mix" },
    { n: "", sku: "336448", name: "Mix chamber C, 15 (.047)", group: "mix" },
    { n: "", sku: "336449", name: "Mix chamber D, 02 (.052)", group: "mix" },
    { n: "", sku: "336450", name: "Mix chamber E, 03 (.060)", group: "mix" },
    { n: "", sku: "336451", name: "Mix chamber F, 04 (.070)", group: "mix" },
    // Individual mix tips (include drill bit)
    { n: "", sku: "336453", name: "Mix tip 01 (.060)", group: "mix" },
    { n: "", sku: "336454", name: "Mix tip 15 (.064)", group: "mix" },
    { n: "", sku: "336455", name: "Mix tip 02 (.070)", group: "mix" },
    { n: "", sku: "336456", name: "Mix tip 03 (.086)", group: "mix" },
    { n: "", sku: "336457", name: "Mix tip 04 (.093)", group: "mix" },
    // Extension tips (include drill bit)
    { n: "", sku: "336458", name: "Extension tip 01 XS (.060), adds 1/2 in", group: "mix" },
    { n: "", sku: "336459", name: "Extension tip 01 XL (.060), adds 1 in", group: "mix" },
    { n: "", sku: "336460", name: "Extension tip 15 XS (.064), adds 1/2 in", group: "mix" },
    { n: "", sku: "336461", name: "Extension tip 15 XL (.064), adds 1 in", group: "mix" },
    { n: "", sku: "336462", name: "Extension tip 02 XS (.070), adds 1/2 in", group: "mix" },
    { n: "", sku: "336463", name: "Extension tip 02 XL (.070), adds 1 in", group: "mix" },
  ],
};

// Each part's outline, traced from the drawing (lib/diagram-shapes-st1.ts). A part listed twice gets them once.
for (const p of ST1.parts) {
  if (ST1.parts.find((x) => x.sku === p.sku) !== p) continue;
  if (ST1_SHAPES[p.sku]) p.shapes = ST1_SHAPES[p.sku];
}

export const DIAGRAMS: Diagram[] = [ST1, FUSION_FX, FUSION_PC];
export const diagramFor = (sku: string | null | undefined) => DIAGRAMS.find((d) => d.forSku.toLowerCase() === (sku ?? "").toLowerCase()) ?? null;
export const diagramBySlug = (slug: string) => DIAGRAMS.find((d) => d.slug === slug) ?? null;
/** Every part number in every diagram (to look up prices once). */
export const diagramSkus = (d: Diagram) => [...new Set(d.parts.map((p) => p.sku))];
