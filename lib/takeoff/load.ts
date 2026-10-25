import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemTotals, materialLabel, type TItem, type TMark, type TSheet, type Totals } from "@/lib/takeoff/calc";

export type TakeoffRow = {
  id: string;
  name: string;
  customer: string | null;
  address: string | null;
  due_date: string | null;
  status: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportData = {
  t: TakeoffRow;
  items: TItem[];
  sheets: TSheet[];
  marks: TMark[];
  totals: Map<string, Totals>;
  bySheet: { sheet: TSheet; rows: { item: TItem; t: Totals }[] }[];
  materials: { label: string; thickness: number | null; sqft: number; bf: number | null; items: string[] }[];
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Everything the report and the Excel download need, worked out once. */
export async function loadReport(supabase: SupabaseClient, id: string): Promise<ReportData | null> {
  const { data: t } = await supabase.from("takeoffs").select("*").eq("id", id).maybeSingle<TakeoffRow>();
  if (!t) return null;
  const [{ data: s }, { data: i }, { data: m }] = await Promise.all([
    supabase.from("takeoff_sheets").select("*").eq("takeoff_id", id).order("sort").order("page"),
    supabase.from("takeoff_items").select("*").eq("takeoff_id", id).order("sort").order("created_at"),
    supabase.from("takeoff_marks").select("id, item_id, sheet_id, points, cutout").eq("takeoff_id", id).range(0, 19999),
  ]);
  const sheets = ((s ?? []) as TSheet[]).map((x) => ({ ...x, width_pt: n(x.width_pt), height_pt: n(x.height_pt), ft_per_pt: n(x.ft_per_pt) }));
  const items = ((i ?? []) as TItem[]).map((x) => ({ ...x, thickness_in: n(x.thickness_in), height_ft: n(x.height_ft), pitch: n(x.pitch), deduct_sqft: Number(x.deduct_sqft ?? 0) }));
  const marks = (m ?? []) as TMark[];
  const sheetMap = new Map(sheets.map((x) => [x.id, x]));
  const totals = new Map(items.map((it) => [it.id, itemTotals(it, marks, sheetMap)]));

  const bySheet = sheets
    .map((sh) => ({
      sheet: sh,
      rows: items.map((it) => ({ item: it, t: itemTotals(it, marks, sheetMap, sh.id) })).filter((r) => r.t.marks > 0),
    }))
    .filter((x) => x.rows.length);

  const mats = new Map<string, { label: string; thickness: number | null; sqft: number; bf: number | null; items: string[] }>();
  for (const it of items) {
    const tot = totals.get(it.id)!;
    if (it.kind === "count" || tot.sqft === null) continue;
    const key = `${it.material ?? "none"}|${it.thickness_in ?? ""}`;
    const row = mats.get(key) ?? { label: materialLabel(it.material), thickness: it.thickness_in, sqft: 0, bf: null, items: [] };
    row.sqft += tot.sqft;
    if (tot.bf !== null) row.bf = (row.bf ?? 0) + tot.bf;
    row.items.push(it.name);
    mats.set(key, row);
  }
  return { t, items, sheets, marks, totals, bySheet, materials: [...mats.values()] };
}
