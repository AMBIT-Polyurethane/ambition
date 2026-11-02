import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { colLetter, norm, sheetDate } from "@/lib/inventory/sheet";
import type { Workbook } from "@/lib/inventory/workbook";

// The RECEIVED LOTS tab (0041): every lot / batch of an item tracked by lot that isn't spray foam on FOAM LOTS,
// as it was received and approved in the app. A log, newest at the bottom; the app only ever adds rows.

export const RECEIVED_TAB = "RECEIVED LOTS";
const HEADERS = ["Received", "SKU", "Description", "Lot / Batch #", "Mfg Date", "Exp Date", "Qty", "From", "BOL #", "Received By", "Approved By"];
const HEADER_ROW = 4;

type Batch = {
  id: number;
  sku: string;
  name: string | null;
  lot_no: string;
  mfg: string | null;
  exp: string | null;
  qty: number;
  received_on: string;
  vendor: string | null;
  bol_no: string | null;
  received_by_name: string | null;
  approved_by_name: string | null;
};

/** Adds the batches that aren't on the sheet yet (making the tab the first time). Gives back how many went on. */
export async function syncReceivedLots(db: SupabaseClient, wb: Workbook, names: string[], branch: string): Promise<number> {
  const { data, error } = await db
    .from("inventory_batches")
    .select("id, sku, name, lot_no, mfg, exp, qty, received_on, vendor, bol_no, received_by_name, approved_by_name")
    .eq("branch_id", branch)
    .eq("on_sheet", false)
    .order("received_on")
    .order("id")
    .limit(500);
  if (error) throw new Error(`Couldn't read received lots: ${error.message}`);
  const fresh = (data ?? []) as Batch[];
  if (!fresh.length) return 0;

  const width = HEADERS.length;
  const last = colLetter(width);
  let tab = names.find((n) => norm(n) === norm(RECEIVED_TAB));
  let next: number;
  if (!tab) {
    const { data: b } = await db.from("branches").select("name, state").eq("id", branch).maybeSingle<{ name: string; state: string }>();
    const place = b ? `${b.name} ${b.state}` : branch.toUpperCase();
    const pad = (t: string) => [t, ...Array(width - 1).fill("")];
    await wb.addSheet(RECEIVED_TAB);
    tab = RECEIVED_TAB;
    await wb.write(tab, 1, 1, [
      pad(`${place}  ·  RECEIVED LOTS`),
      pad("Every lot / batch received in the AMBIT A.I. app and approved by an admin (spray foam drums are on FOAM LOTS). The app adds rows here; TOTAL IN STOCK on the COUNT SHEET already includes them."),
      pad(""),
      [...HEADERS],
    ]);
    await wb.format(tab, `A1:${last}1`, "/font", { bold: true, size: 16 });
    await wb.format(tab, `A2:${last}2`, "/font", { italic: true, color: "#52525B" });
    await wb.format(tab, `A${HEADER_ROW}:${last}${HEADER_ROW}`, "/fill", { color: "#D9D9D9" });
    await wb.format(tab, `A${HEADER_ROW}:${last}${HEADER_ROW}`, "/font", { bold: true });
    await wb.format(tab, `C:C`, "", { columnWidth: 220 });
    await wb.freezeRows(tab, HEADER_ROW);
    next = HEADER_ROW + 1;
  } else {
    const g = await wb.used(tab);
    next = Math.max(HEADER_ROW + 1, g.top + g.values.length);
  }

  const rows = fresh.map((b) => [
    sheetDate(b.received_on),
    b.sku,
    b.name ?? "",
    `'${b.lot_no}`,
    b.mfg ? sheetDate(b.mfg) : "",
    b.exp ? sheetDate(b.exp) : "",
    Number(b.qty),
    b.vendor ?? "",
    b.bol_no ?? "",
    b.received_by_name ?? "",
    b.approved_by_name ?? "",
  ]);
  await wb.write(tab, next, 1, rows);
  const { error: markErr } = await db.rpc("inventory_batches_written", { p_ids: fresh.map((b) => b.id), p_rows: fresh.map((_, i) => next + i) });
  if (markErr) throw new Error(`Couldn't mark received lots as written: ${markErr.message}`);
  return fresh.length;
}
