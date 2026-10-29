// Blown fiberglass coverage charts, from each maker's own data sheet. A chart row says how many bags
// cover 1,000 sq ft (net, without framing) to reach an R-value. Quotes and material orders always use
// the row at or above the R-value asked for, so a job is never short.

export type AtticRow = { r: number; bags_per_1000: number; sqft_per_bag: number; lbs_per_sqft: number; inches: number };
export type WallRow = { framing: "2x4" | "2x6" | "2x8" | "2x10"; depth_in: number; r: number; pcf: number; bags_per_1000: number; sqft_per_bag: number; lbs_per_sqft: number };
export type CoverageChart = {
  key: string;
  maker: string;
  product: string;
  /** How to find it in AMBIT's catalog or a product name. */
  match: RegExp;
  bag_lbs: number;
  source: string;
  attic: AtticRow[];
  walls: WallRow[];
  note?: string;
};

const wall = (framing: WallRow["framing"], depth_in: number, r: number, pcf: number, sqft_per_bag: number, bags?: number, lbs?: number): WallRow => ({
  framing,
  depth_in,
  r,
  pcf,
  sqft_per_bag,
  bags_per_1000: bags ?? Math.round((1000 / sqft_per_bag) * 10) / 10,
  lbs_per_sqft: lbs ?? Math.round(((pcf * depth_in) / 12) * 1000) / 1000,
});
const attic = (r: number, bags_per_1000: number, sqft_per_bag: number, lbs_per_sqft: number, inches: number): AtticRow => ({ r, bags_per_1000, sqft_per_bag, lbs_per_sqft, inches });

export const COVERAGE: CoverageChart[] = [
  {
    key: "knauf_jsu",
    maker: "Knauf",
    product: "Jet Stream Ultra",
    match: /jet\s*stream/i,
    bag_lbs: 32,
    source: "Knauf North America, Performance+ Jet Stream Ultra product page (coverage charts), Oct 2026",
    attic: [
      attic(11, 4.7, 210.8, 0.152, 4),
      attic(13, 5.7, 175.3, 0.183, 4.75),
      attic(19, 8.4, 119.3, 0.268, 6.75),
      attic(22, 9.8, 102.2, 0.313, 7.75),
      attic(26, 11.8, 85.0, 0.377, 9.125),
      attic(30, 13.6, 73.3, 0.437, 10.375),
      attic(38, 17.8, 56.2, 0.569, 13),
      attic(44, 20.9, 47.8, 0.67, 14.875),
      attic(49, 23.5, 42.5, 0.753, 16.375),
      attic(60, 29.7, 33.6, 0.952, 19.75),
    ],
    walls: [wall("2x4", 3.5, 15, 1.8, 61.0, 16.4, 0.525), wall("2x6", 5.5, 23, 1.8, 38.8, 25.8, 0.825), wall("2x8", 7.25, 31, 1.8, 29.4, 34.0, 1.088), wall("2x10", 9.25, 39, 1.8, 23.1, 43.4, 1.388)],
  },
  {
    key: "jm_climate_pro",
    maker: "Johns Manville",
    product: "Climate Pro B-7700",
    match: /climate\s*pro/i,
    bag_lbs: 31.5,
    source: "JM Climate Pro B-7700 attic coverage chart BID-403 (04/22) and cavity wall data sheet BID-402 (09/25)",
    attic: [
      attic(11, 4.6, 215.9, 0.15, 4.25),
      attic(13, 5.5, 181.3, 0.17, 5),
      attic(19, 8.0, 125.4, 0.25, 7),
      attic(22, 9.3, 108.0, 0.29, 8),
      attic(26, 11.2, 88.9, 0.35, 9.5),
      attic(30, 13.0, 77.1, 0.41, 10.75),
      attic(38, 17.0, 59.0, 0.53, 13.5),
      attic(44, 19.6, 50.9, 0.62, 15.25),
      attic(49, 22.4, 44.6, 0.71, 17),
      attic(60, 27.9, 35.8, 0.88, 20.25),
    ],
    walls: [
      wall("2x4", 3.5, 14, 1.2, 90.0),
      wall("2x4", 3.5, 15, 1.5, 72.0),
      wall("2x6", 5.5, 22, 1.2, 57.3),
      wall("2x6", 5.5, 23, 1.4, 49.1),
      wall("2x6", 5.5, 24, 1.8, 38.2),
      wall("2x8", 7.25, 31, 1.6, 32.6),
      wall("2x10", 9.25, 40, 1.8, 22.7),
    ],
    note: "Wall rows read from JM's data sheet; bags per 1,000 sq ft worked out from the coverage per bag.",
  },
  {
    key: "oc_l77",
    maker: "Owens Corning",
    product: "ProPink L77",
    match: /\bl77\b|propink/i,
    bag_lbs: 32,
    source: "Owens Corning ProPink L77 product data sheet, May 2026",
    attic: [
      attic(13, 5.4, 184.6, 0.173, 4.75),
      attic(19, 8.0, 125.0, 0.256, 7),
      attic(22, 9.4, 106.3, 0.301, 8),
      attic(26, 11.2, 89.6, 0.357, 9.25),
      attic(30, 13.0, 77.0, 0.416, 10.5),
      attic(38, 16.7, 59.9, 0.534, 13.25),
      attic(44, 19.7, 50.7, 0.631, 15),
      attic(49, 22.2, 45.0, 0.711, 16.75),
      attic(60, 28.0, 35.8, 0.895, 20),
    ],
    walls: [wall("2x4", 3.5, 14, 1.3, 84.4, 11.8, 0.379), wall("2x4", 3.5, 15, 1.95, 56.3, 17.8, 0.569), wall("2x6", 5.5, 22, 1.3, 53.7, 18.6, 0.596), wall("2x6", 5.5, 23, 1.5, 46.5, 21.5, 0.688), wall("2x6", 5.5, 24, 2.25, 31.0, 32.2, 1.031)],
  },
  {
    key: "ct_insulsafe_sp",
    maker: "CertainTeed",
    product: "InsulSafe SP",
    match: /insul\s*safe/i,
    bag_lbs: 31,
    source: "CertainTeed InsulSafe SP fiberglass blowing insulation fact sheet (10/25)",
    attic: [
      attic(11, 5.0, 200.5, 0.155, 4.5),
      attic(13, 5.9, 170.4, 0.182, 5.25),
      attic(19, 8.6, 116.2, 0.267, 7.5),
      attic(22, 9.9, 101.4, 0.306, 8.5),
      attic(26, 11.8, 84.8, 0.366, 10),
      attic(30, 13.8, 72.5, 0.427, 11.5),
      attic(38, 17.9, 55.7, 0.556, 14.5),
      attic(44, 20.8, 48.0, 0.646, 16.5),
      attic(49, 23.5, 42.6, 0.727, 18.25),
      attic(60, 28.9, 34.5, 0.897, 21.75),
    ],
    walls: [wall("2x4", 3.5, 14, 1.2, 88.6, 11.3), wall("2x4", 3.5, 15, 1.6, 66.4, 15.1), wall("2x6", 5.5, 22, 1.2, 56.4, 17.7), wall("2x6", 5.5, 24, 1.8, 37.6, 26.6), wall("2x8", 7.25, 29, 1.2, 42.8, 23.4), wall("2x8", 7.25, 31, 1.6, 32.1, 31.2)],
  },
];

export const chartFor = (key: string | null | undefined) => (key ? COVERAGE.find((c) => c.key === key) ?? null : null);
export const chartKeyFor = (name: string) => COVERAGE.find((c) => c.match.test(name))?.key ?? null;

/** The attic row for an R-value: the first one at or above it (the top row if it's higher than the chart goes). */
export function atticRow(chart: CoverageChart, r: number | null | undefined): AtticRow | null {
  if (!chart.attic.length) return null;
  const rows = [...chart.attic].sort((a, b) => a.r - b.r);
  if (!r || r <= 0) return null;
  return rows.find((x) => x.r >= r - 0.01) ?? rows[rows.length - 1];
}

/** The wall (dense-pack / BIBS) row for a framing size: the R asked for, or the densest row. */
export function wallRow(chart: CoverageChart, framing: string | null | undefined, r?: number | null): WallRow | null {
  const rows = chart.walls.filter((w) => w.framing === framing).sort((a, b) => a.r - b.r || a.pcf - b.pcf);
  if (!rows.length) return null;
  if (r && r > 0) return rows.find((x) => x.r >= r - 0.01) ?? rows[rows.length - 1];
  return rows[rows.length - 1];
}

export const atticRs = (chart: CoverageChart | null) => (chart ? [...new Set(chart.attic.map((x) => x.r))].sort((a, b) => a - b) : [11, 13, 19, 22, 26, 30, 38, 44, 49, 60]);
export const wallFramings = (chart: CoverageChart | null) => (chart ? [...new Set(chart.walls.map((x) => x.framing))] : ["2x4", "2x6"]);
