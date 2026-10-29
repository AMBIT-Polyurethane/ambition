import { NextResponse, type NextRequest } from "next/server";
import { takeoffAccess } from "@/lib/takeoff/access";
import { loadReport } from "@/lib/takeoff/load";
import { materialLabel, pitchFactor } from "@/lib/takeoff/calc";

// The takeoff as a spreadsheet (opens in Excel).
export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // never a formula in Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await takeoffAccess();
  if (!s) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const r = await loadReport(s.supabase, id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { t, items, totals, bySheet } = r;

  const rows: unknown[][] = [
    ["Takeoff", t.name],
    ["Customer", t.customer ?? ""],
    ["Address", t.address ?? ""],
    ["Bid due", t.due_date ?? ""],
    [],
    ["Item", "Measured as", "Material", "Thickness (in)", "R-value", "Pitch (x/12)", "Pitch factor", "Wall height (ft)", "Openings (sq ft)", "Length (ft)", "Area (sq ft)", "Count", "Board feet", "Shapes"],
  ];
  for (const it of items) {
    const tot = totals.get(it.id)!;
    rows.push([
      it.name,
      it.kind === "linear" ? "Walls / lengths" : it.kind === "area" ? "Area" : "Count",
      it.material ? materialLabel(it.material) : "",
      it.thickness_in,
      it.r_value ?? "",
      it.pitch,
      it.kind === "area" && it.pitch ? pitchFactor(it.pitch) : "",
      it.height_ft,
      it.kind === "linear" && it.deduct_sqft ? it.deduct_sqft : "",
      tot.lf,
      tot.sqft,
      tot.count,
      tot.bf,
      tot.marks,
    ]);
  }
  rows.push([], ["By sheet"], ["Sheet", "Scale", "Item", "Length (ft)", "Area (sq ft)", "Count", "Board feet"]);
  for (const { sheet, rows: list } of bySheet) {
    for (const { item, t: tot } of list) rows.push([sheet.name ?? `Page ${sheet.page}`, sheet.scale_label ?? "", item.name, tot.lf, tot.sqft, tot.count, tot.bf]);
  }
  const csv = "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
  const safe = t.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "takeoff";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Takeoff-${safe}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
