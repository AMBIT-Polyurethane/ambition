import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { msConnection, msReady } from "@/lib/microsoft";
import { todayCentral } from "@/lib/sale";
import { resolveFile, Workbook } from "@/lib/inventory/workbook";
import {
  STATUS,
  STOCK_MARK,
  fingerprint,
  norm,
  parseCountSheet,
  parsePendingSheet,
  runs,
  sheetDate,
  slug,
  statusKind,
  stockMark,
  titleCase,
  unitFromUom,
  type PendingCol,
  type PendingRow,
  type PendingSheet,
  type SheetItem,
  type StatusKind,
} from "@/lib/inventory/sheet";

// Two-way sync between a branch's inventory workbook and the app.
//
// TOTAL IN STOCK (per item), compared with the value both sides last agreed on:
//   changed only on the sheet  -> the app takes the sheet's number
//   changed only in the app    -> the app writes its number to the sheet
//   changed on both            -> a new count on the sheet (Last Counted changed) wins outright;
//                                 otherwise both changes are kept (sheet number + the app's change)
// PENDING ORDERS:
//   app orders are added as "Pending Pickup" lines the moment they're placed, set to "Cancelled"
//   or "Picked Up / Completed" when that happens in the app; picked up = taken out of TOTAL IN STOCK
//   once (the Notes say "[Stock taken ...]"). Lines marked Picked Up / Completed on the sheet are
//   taken out of stock the same way.
// New SKUs on the COUNT SHEET become products in the app (the app keeps control of names and prices).

export type SyncSummary = {
  at: string;
  ms: number;
  items: number;
  new_products: string[];
  from_sheet: number;
  to_sheet: number;
  conflicts: number;
  lines_added: number;
  lines_updated: number;
  sheet_closed: number;
  sheet_reserved: number;
  full: boolean;
  duplicates: string[];
};

export type SyncResult = { branch: string; ok: boolean; skipped?: string; error?: string; summary?: SyncSummary };

type Cfg = {
  branch_id: string;
  share_url: string;
  file_name: string | null;
  drive_id: string | null;
  item_id: string | null;
  enabled: boolean;
  connected_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  row_seen: Record<string, string> | null;
  sync_wanted_at: string | null;
};

type Inv = {
  branch_id: string;
  product_id: string;
  sku: string;
  on_hand: number | null;
  synced_on_hand: number | null;
  sheet_pending: number;
  reorder_point: number | null;
  max_qty: number | null;
  unit_weight: number | null;
  last_counted: string | null;
  counted_by: string | null;
  count_dirty: boolean;
  on_sheet: boolean;
  sheet_row: number | null;
};

type Ord = {
  id: string;
  order_no: number;
  status: string;
  stage: string | null;
  ambit_po: string | null;
  company_name: string;
  po_number: string | null;
  created_at: string;
  delivery_method: string;
  needed_by: string | null;
};

type Line = {
  order_item_id: number;
  order_id: string;
  product_id: string;
  sku: string;
  qty: number;
  state: "reserved" | "done" | "cancelled";
  done_by: string | null;
  stock_taken: boolean;
  sheet_row: number | null;
  sheet_status: string | null;
  needs_write: boolean;
  item: { unit_price: number | null; customer_priced: boolean } | null;
  ord: Ord | null;
};

type Log = { branch_id: string; kind: string; sku?: string | null; message: string; qty_before?: number | null; qty_after?: number | null; by_name: string };

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);
const show = (n: number | null) => (n === null ? "blank" : String(Math.round(n * 100) / 100));
const r2 = (n: number) => Math.round(n * 100) / 100;
const orderLabel = (n: number) => `ORD-${n}`;

/** Runs the sync for one branch. Quick no-op when nothing is set up or another sync is running. */
export async function syncBranch(branch: string, opts: { force?: boolean; why?: string } = {}): Promise<SyncResult> {
  if (!serviceReady()) return { branch, ok: false, skipped: "SUPABASE_SECRET_KEY isn't set" };
  if (!msReady()) return { branch, ok: false, skipped: "Microsoft isn't set up" };
  const db = serviceClient();
  const { data: cfg } = await db.from("inventory_sheets").select("*").eq("branch_id", branch).maybeSingle<Cfg>();
  if (!cfg || !cfg.enabled) return { branch, ok: false, skipped: "no spreadsheet for this branch" };
  if (!(await msConnection())) return { branch, ok: false, skipped: "Microsoft isn't connected yet" };
  const wanted = cfg.sync_wanted_at && (!cfg.last_sync_at || cfg.sync_wanted_at > cfg.last_sync_at);
  if (!opts.force && !wanted && cfg.last_sync_at && Date.now() - Date.parse(cfg.last_sync_at) < 45_000) {
    return { branch, ok: true, skipped: "synced moments ago" };
  }
  const { data: locked } = await db.rpc("inventory_try_lock", { p_branch: branch, p_secs: 170 });
  if (!locked) return { branch, ok: true, skipped: "another sync is running" };

  let result: SyncResult = { branch, ok: false };
  try {
    for (let round = 0; round < 3; round++) {
      const started = new Date().toISOString();
      await db.from("inventory_sheets").update({ last_sync_at: started }).eq("branch_id", branch);
      const { data: fresh } = await db.from("inventory_sheets").select("*").eq("branch_id", branch).single<Cfg>();
      const t0 = Date.now();
      try {
        const one = await runOnce(db, fresh!);
        one.ms = Date.now() - t0;
        const summary = result.summary ? mergeSummary(result.summary, one) : one;
        await db
          .from("inventory_sheets")
          .update({ last_ok_at: new Date().toISOString(), last_error: null, last_summary: summary })
          .eq("branch_id", branch);
        result = { branch, ok: true, summary };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from("inventory_sheets").update({ last_error: msg.slice(0, 500) }).eq("branch_id", branch);
        if (msg !== fresh?.last_error) {
          await db.from("inventory_log").insert({ branch_id: branch, kind: "error", message: `Sync didn't finish: ${msg}`.slice(0, 600), by_name: "AMBIT A.I." });
        }
        return { branch, ok: false, error: msg };
      }
      // Something changed in the app while this ran? Go again so the sheet gets it now.
      const { data: later } = await db.from("inventory_sheets").select("sync_wanted_at").eq("branch_id", branch).single<{ sync_wanted_at: string | null }>();
      if (!later?.sync_wanted_at || later.sync_wanted_at <= started) break;
    }
  } finally {
    await db.rpc("inventory_unlock", { p_branch: branch });
  }
  return result;
}

/** Two runs back to back (something changed in the app during the first) count as one sync. */
function mergeSummary(a: SyncSummary, b: SyncSummary): SyncSummary {
  return {
    ...b,
    ms: a.ms + b.ms,
    new_products: [...a.new_products, ...b.new_products],
    from_sheet: a.from_sheet + b.from_sheet,
    to_sheet: a.to_sheet + b.to_sheet,
    conflicts: a.conflicts + b.conflicts,
    lines_added: a.lines_added + b.lines_added,
    lines_updated: a.lines_updated + b.lines_updated,
    sheet_closed: a.sheet_closed + b.sheet_closed,
    full: a.full || b.full,
  };
}

/** Every branch with a spreadsheet (the 2-minute timer). */
export async function syncAll(opts: { force?: boolean } = {}): Promise<SyncResult[]> {
  if (!serviceReady()) return [];
  const { data } = await serviceClient().from("inventory_sheets").select("branch_id").eq("enabled", true);
  const out: SyncResult[] = [];
  for (const r of (data ?? []) as { branch_id: string }[]) out.push(await syncBranch(r.branch_id, opts));
  return out;
}

/** After the page answers: push a change from the app to the sheet right away (the timer catches anything missed). */
export function kickSync(branch: string | null | undefined, why: string) {
  if (!branch || !serviceReady() || !msReady()) return;
  try {
    after(async () => {
      try {
        await syncBranch(branch, { why });
      } catch {
        // recorded on the next run
      }
    });
  } catch {
    // not inside a request
  }
}

/** Every branch, after the page answers (used right after connecting Microsoft). */
export function kickAll() {
  if (!serviceReady() || !msReady()) return;
  try {
    after(async () => {
      try {
        await syncAll({ force: true });
      } catch {
        // recorded on the next run
      }
    });
  } catch {
    // not inside a request
  }
}

/** An order changed in the app: get its branch's sheet up to date now. */
export async function kickForOrder(supabase: SupabaseClient, orderId: string, why: string) {
  if (!serviceReady() || !msReady()) return;
  const { data } = await supabase.from("orders").select("branch_id, delivery_method").eq("id", orderId).maybeSingle<{ branch_id: string | null; delivery_method: string }>();
  if (data?.branch_id && data.delivery_method !== "dropship") kickSync(data.branch_id, why);
}

// ======================================================================================

async function runOnce(db: SupabaseClient, cfg: Cfg): Promise<SyncSummary> {
  const branch = cfg.branch_id;
  const today = todayCentral();
  const logs: Log[] = [];
  const sum: SyncSummary = {
    at: new Date().toISOString(),
    ms: 0,
    items: 0,
    new_products: [],
    from_sheet: 0,
    to_sheet: 0,
    conflicts: 0,
    lines_added: 0,
    lines_updated: 0,
    sheet_closed: 0,
    sheet_reserved: 0,
    full: false,
    duplicates: [],
  };
  const log = (kind: string, message: string, sku?: string | null, before?: number | null, afterQty?: number | null, by = "Spreadsheet") =>
    logs.push({ branch_id: branch, kind, sku: sku ?? null, message: message.slice(0, 600), qty_before: before ?? null, qty_after: afterQty ?? null, by_name: by });

  // ---------------------------------------------------------------- the workbook
  const file = await resolveFile(cfg.share_url, cfg);
  if (file.driveId !== cfg.drive_id || file.itemId !== cfg.item_id || file.name !== cfg.file_name) {
    await db.from("inventory_sheets").update({ drive_id: file.driveId, item_id: file.itemId, file_name: file.name }).eq("branch_id", branch);
  }
  const wb = await Workbook.open(file);
  try {
    const names = await wb.sheetNames();
    const countTab = names.find((n) => norm(n) === "count sheet") ?? names.find((n) => norm(n).includes("count"));
    const pendTab = names.find((n) => norm(n) === "pending orders") ?? names.find((n) => norm(n).includes("pending"));
    if (!countTab) throw new Error(`"${file.name}" has no COUNT SHEET tab.`);
    if (!pendTab) throw new Error(`"${file.name}" has no PENDING ORDERS tab.`);
    const count = parseCountSheet(await wb.used(countTab));
    const pend = parsePendingSheet(await wb.used(pendTab));
    sum.items = count.items.length;
    sum.duplicates = count.duplicates;
    if (count.items.length === 0) throw new Error("COUNT SHEET has no items on it (nothing under the SKU header).");

    // -------------------------------------------------------------- new items -> products
    const productId = await ensureProducts(db, count.items, sum, log);
    const itemByKey = new Map(count.items.map((i) => [i.key, i]));

    // -------------------------------------------------------------- stock rows for new items
    const inv = await loadInventory(db, branch);
    const fresh = count.items.filter((i) => productId.has(i.key) && !inv.has(productId.get(i.key)!));
    if (fresh.length) {
      const rows = fresh.map((i) => ({
        branch_id: branch,
        product_id: productId.get(i.key)!,
        sku: i.sku,
        on_hand: i.stock,
        synced_on_hand: i.stock,
        reorder_point: i.rop,
        max_qty: i.max,
        unit_weight: i.weight,
        last_counted: i.counted,
        counted_by: i.countedBy || null,
        sheet_row: i.row,
        on_sheet: true,
      }));
      for (let k = 0; k < rows.length; k += 500) {
        const { error } = await db.from("inventory").upsert(rows.slice(k, k + 500), { onConflict: "branch_id,product_id", ignoreDuplicates: true });
        if (error) throw new Error(`Couldn't save stock rows: ${error.message}`);
      }
    }

    // -------------------------------------------------------------- PENDING ORDERS
    const stockedKeys = new Set(count.items.map((i) => i.key));
    const manualPending = await reconcilePending(db, wb, pendTab, pend, cfg, itemByKey, productId, stockedKeys, today, sum, log);

    // -------------------------------------------------------------- TOTAL IN STOCK and the rest of each row
    const now = await loadInventory(db, branch);
    const stockCol = count.cols.stock!;
    const seenProducts = new Set<string>();
    for (const item of count.items) {
      const pid = productId.get(item.key);
      if (!pid) continue;
      seenProducts.add(pid);
      const row = now.get(pid);
      if (!row) continue;
      const K = item.stock;
      const A = num(row.on_hand);
      const B = num(row.synced_on_hand);
      const patch: Record<string, unknown> = {};
      const sheetChanged = !same(K, B);
      const appChanged = !same(A, B);
      let writeK: number | null | undefined;
      let writeCount = false;

      if (row.count_dirty) {
        // A count made in the app. A newer count typed on the sheet still beats it.
        if (sheetChanged && item.counted && (!row.last_counted || item.counted > row.last_counted)) {
          patch.on_hand = K;
          patch.synced_on_hand = K;
          patch.count_dirty = false;
          sum.conflicts++;
          log("conflict", `Counted on the sheet (${item.counted}) after the app's count: the sheet's ${show(K)} is kept.`, item.sku, A, K);
        } else {
          writeK = A;
          writeCount = true;
          patch.synced_on_hand = A;
          patch.count_dirty = false;
        }
      } else if (sheetChanged && !appChanged) {
        patch.on_hand = K;
        patch.synced_on_hand = K;
        sum.from_sheet++;
        log("sheet", `TOTAL IN STOCK changed on the sheet: ${show(B)} → ${show(K)}.`, item.sku, A, K);
      } else if (!sheetChanged && appChanged) {
        writeK = A;
        patch.synced_on_hand = A;
      } else if (sheetChanged && appChanged) {
        sum.conflicts++;
        if (item.counted && item.counted !== row.last_counted) {
          patch.on_hand = K;
          patch.synced_on_hand = K;
          log("conflict", `Counted on the sheet while stock also changed in the app: the count (${show(K)}) wins.`, item.sku, A, K);
        } else {
          // Keep both: the sheet's change is added to the app's number in one step, and the total goes to the sheet.
          const merged = r2((K ?? 0) + ((A ?? 0) - (B ?? 0)));
          writeK = merged;
          await db.rpc("inventory_bump", {
            p_branch: branch,
            p_product: pid,
            p_delta: r2((K ?? 0) - (B ?? 0)),
            p_kind: "conflict",
            p_message: `Changed on the sheet (${show(B)} → ${show(K)}) and in the app (${show(B)} → ${show(A)}) at once: both kept, ${show(merged)}.`,
          });
          patch.synced_on_hand = merged;
        }
      }

      if (writeK !== undefined) {
        await wb.write(countTab, item.row, stockCol, [[writeK ?? ""]]);
        sum.to_sheet++;
        if (writeCount && count.cols.counted && count.cols.by && count.cols.by === count.cols.counted + 1 && row.last_counted) {
          await wb.write(countTab, item.row, count.cols.counted, [[sheetDate(row.last_counted), row.counted_by ?? ""]]);
        } else if (writeCount && row.last_counted) {
          if (count.cols.counted) await wb.write(countTab, item.row, count.cols.counted, [[sheetDate(row.last_counted)]]);
          if (count.cols.by) await wb.write(countTab, item.row, count.cols.by, [[row.counted_by ?? ""]]);
        }
      }

      // Everything else on the row comes from the sheet.
      if (!writeCount && !row.count_dirty) {
        if ((item.counted ?? null) !== (row.last_counted ?? null)) patch.last_counted = item.counted;
        if ((item.countedBy || null) !== (row.counted_by || null)) patch.counted_by = item.countedBy || null;
      }
      if (!same(item.rop, num(row.reorder_point))) patch.reorder_point = item.rop;
      if (!same(item.max, num(row.max_qty))) patch.max_qty = item.max;
      if (!same(item.weight, num(row.unit_weight))) patch.unit_weight = item.weight;
      if (row.sheet_row !== item.row) patch.sheet_row = item.row;
      if (!row.on_sheet) patch.on_sheet = true;
      if (row.sku !== item.sku) patch.sku = item.sku;
      const pendingHere = r2(manualPending.get(item.key) ?? 0);
      if (!same(pendingHere, num(row.sheet_pending))) patch.sheet_pending = pendingHere;

      if (Object.keys(patch).length) {
        const stamp = new Date().toISOString();
        const match = <T extends { eq: (c: string, v: unknown) => T; is: (c: string, v: null) => T }>(q: T) => (A === null ? q.is("on_hand", null) : q.eq("on_hand", A));
        if ("on_hand" in patch) {
          // Taking the sheet's number: never over a change the app made a moment ago (the next run sorts it out).
          const { error } = await match(db.from("inventory").update({ ...patch, updated_at: stamp }).eq("branch_id", branch).eq("product_id", pid));
          if (error) throw new Error(`Couldn't save stock for ${item.sku}: ${error.message}`);
        } else {
          // The sheet now shows what was written, whatever happens next in the app.
          const { count_dirty, ...rest } = patch;
          if (Object.keys(rest).length) {
            const { error } = await db.from("inventory").update({ ...rest, updated_at: stamp }).eq("branch_id", branch).eq("product_id", pid);
            if (error) throw new Error(`Couldn't save stock for ${item.sku}: ${error.message}`);
          }
          // A newer count made in the app while this ran keeps its flag, so its date and name go to the sheet next time.
          if (count_dirty === false) await match(db.from("inventory").update({ count_dirty: false }).eq("branch_id", branch).eq("product_id", pid));
        }
      }
    }

    // Taken off the sheet: no longer stocked here.
    const gone = [...now.values()].filter((r) => r.on_sheet && !seenProducts.has(r.product_id));
    for (const r of gone) {
      await db.from("inventory").update({ on_sheet: false, updated_at: new Date().toISOString() }).eq("branch_id", branch).eq("product_id", r.product_id);
      log("sheet", `${r.sku} is no longer on the COUNT SHEET, so it no longer shows stock here.`, r.sku);
    }

    if (logs.length) await db.from("inventory_log").insert(logs);
    if (!cfg.connected_at) await db.from("inventory_sheets").update({ connected_at: new Date().toISOString() }).eq("branch_id", branch);
    return sum;
  } catch (e) {
    if (logs.length) await db.from("inventory_log").insert(logs);
    throw e;
  } finally {
    await wb.close();
  }
}

async function loadInventory(db: SupabaseClient, branch: string): Promise<Map<string, Inv>> {
  const { data, error } = await db.from("inventory").select("*").eq("branch_id", branch).range(0, 9999);
  if (error) throw new Error(`Couldn't read stock: ${error.message}`);
  return new Map(((data ?? []) as Inv[]).map((r) => [r.product_id, r]));
}

/** SKU on the sheet -> product id. Adds products for SKUs the app doesn't have yet. */
async function ensureProducts(
  db: SupabaseClient,
  items: SheetItem[],
  sum: SyncSummary,
  log: (kind: string, message: string, sku?: string | null, before?: number | null, after?: number | null, by?: string) => void,
): Promise<Map<string, string>> {
  const { data: prods, error } = await db.from("products").select("id, sku").range(0, 19999);
  if (error) throw new Error(`Couldn't read products: ${error.message}`);
  const map = new Map(((prods ?? []) as { id: string; sku: string }[]).map((p) => [p.sku.trim().toUpperCase(), p.id]));
  const missing = items.filter((i) => !map.has(i.key));
  if (!missing.length) return map;

  const { data: cats } = await db.from("categories").select("id, name, sort");
  const catList = (cats ?? []) as { id: string; name: string; sort: number }[];
  let nextSort = catList.reduce((m, c) => Math.max(m, c.sort ?? 0), 0) + 1;
  const catFor = async (group: string): Promise<string | null> => {
    if (!group.trim()) return null;
    const s = slug(group);
    const hit = catList.find((c) => c.id === s || slug(c.name) === s);
    if (hit) return hit.id;
    const { error: ce } = await db.from("categories").insert({ id: s, name: titleCase(group), customer_priced: false, sort: nextSort++ });
    if (ce && !/duplicate/i.test(ce.message)) return null;
    catList.push({ id: s, name: titleCase(group), sort: nextSort });
    log("new_item", `New category "${titleCase(group)}" from the sheet.`, null, null, null, "Spreadsheet");
    return s;
  };

  for (const i of missing) {
    const category_id = await catFor(i.group);
    const { data: made, error: pe } = await db
      .from("products")
      .insert({
        sku: i.sku,
        name: i.desc,
        category_id,
        unit: unitFromUom(i.uom),
        list_price: i.price !== null && i.price > 0 ? r2(i.price) : null,
        active: true,
      })
      .select("id")
      .single<{ id: string }>();
    if (pe || !made) {
      log("error", `Couldn't add ${i.sku} as a product: ${pe?.message ?? "unknown"}`, i.sku, null, null, "AMBIT A.I.");
      continue;
    }
    map.set(i.key, made.id);
    sum.new_products.push(i.sku);
    log("new_item", `New item on the sheet added to the app: ${i.sku} · ${i.desc}${i.price ? ` · ${i.price.toFixed(2)}` : ""}.`, i.sku, null, i.stock, "Spreadsheet");
  }
  return map;
}

/**
 * PENDING ORDERS: app order lines in and out of the sheet, STATUS changes made on the sheet back into the app,
 * and stock for lines typed straight into the sheet. Returns what those typed lines hold back, per SKU.
 */
async function reconcilePending(
  db: SupabaseClient,
  wb: Workbook,
  tab: string,
  pend: PendingSheet,
  cfg: Cfg,
  itemByKey: Map<string, SheetItem>,
  productId: Map<string, string>,
  stockedKeys: Set<string>,
  today: string,
  sum: SyncSummary,
  log: (kind: string, message: string, sku?: string | null, before?: number | null, after?: number | null, by?: string) => void,
): Promise<Map<string, number>> {
  const branch = cfg.branch_id;
  const c = pend.cols;
  const canWrite = (k: PendingCol) => Boolean(c[k]) && pend.writable.includes(k);

  const { data: lineData, error } = await db
    .from("inventory_lines")
    .select(
      "order_item_id, order_id, product_id, sku, qty, state, done_by, stock_taken, sheet_row, sheet_status, needs_write, item:order_items(unit_price, customer_priced), ord:orders(id, order_no, status, stage, ambit_po, company_name, po_number, created_at, delivery_method, needed_by)",
    )
    .eq("branch_id", branch)
    .order("order_item_id")
    .range(0, 9999);
  if (error) throw new Error(`Couldn't read order lines: ${error.message}`);
  const lines = ((lineData ?? []) as unknown as Line[]).map((l) => ({ ...l, qty: Number(l.qty) }));

  const byKey = new Map<string, PendingRow[]>();
  for (const r of pend.rows) {
    const k = `${r.order.toUpperCase()}|${r.key}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const claimed = new Set<number>();
  const free = [...pend.free];

  // Cell changes on existing rows: row -> column -> value
  const edits = new Map<number, Partial<Record<PendingCol, unknown>>>();
  const edit = (row: PendingRow, k: PendingCol, v: unknown) => {
    if (!canWrite(k)) return;
    edits.set(row.row, { ...(edits.get(row.row) ?? {}), [k]: v });
  };
  const withMark = (notes: string) => (STOCK_MARK.test(notes) ? notes : `${notes ? `${notes} ` : ""}${stockMark(today)}`);
  const withoutMark = (notes: string) => notes.replace(/\s*\[stock taken[^\]]*\]/gi, "").trim();
  const setStatus = (row: PendingRow, kind: Exclude<StatusKind, "other" | "">, l?: Line) => {
    edit(row, "status", STATUS[kind]);
    if (kind === "pending") {
      if (row.closed) edit(row, "closed", "");
      if (STOCK_MARK.test(row.notes)) edit(row, "notes", withoutMark(row.notes));
    } else {
      if (!row.closed) edit(row, "closed", sheetDate(today));
      if (kind === "done" && (!l || l.stock_taken)) edit(row, "notes", withMark(row.notes));
    }
  };

  const appends: { line: Line; kind: "pending" | "done" }[] = [];
  const lineUpdates: { id: number; patch: Record<string, unknown>; ifState?: string }[] = [];
  const ordersToCheck = new Set<string>();
  const isOpen = (o: Ord) => o.status !== "cancelled" && o.status !== "completed";

  for (const l of lines) {
    const o = l.ord;
    if (!o) continue;
    const want: "pending" | "done" | "cancelled" = l.state === "reserved" ? "pending" : l.state;
    const cands = (byKey.get(`${orderLabel(o.order_no)}|${l.sku.toUpperCase()}`) ?? []).filter((r) => !claimed.has(r.row));
    const row = cands.find((r) => r.row === l.sheet_row) ?? cands[0];

    if (!row) {
      if (l.state === "reserved") {
        appends.push({ line: l, kind: "pending" });
        if (l.sheet_row) log("sheet", `${orderLabel(o.order_no)} ${l.sku} was missing from PENDING ORDERS (still open in the app), so it was added back.`, l.sku, null, null, "AMBIT A.I.");
      } else if (l.state === "done" && !l.sheet_row && l.needs_write) {
        appends.push({ line: l, kind: "done" }); // picked up before it ever reached the sheet: keep the record
      } else if (l.needs_write) {
        lineUpdates.push({ id: l.order_item_id, patch: { needs_write: false } });
      }
      continue;
    }
    claimed.add(row.row);

    const last = l.sheet_status ? statusKind(l.sheet_status) : null;
    let final: string = row.status;
    if (last !== null && row.kind !== last) {
      // Someone changed STATUS on the sheet.
      if (row.kind === "done" && l.state === "reserved") {
        const { data: took } = await db.rpc("inventory_line_done_on_sheet", { p_line: l.order_item_id, p_status: row.status });
        if (took) {
          sum.sheet_closed++;
          l.stock_taken = true;
          if (!row.closed) edit(row, "closed", sheetDate(today));
          edit(row, "notes", withMark(row.notes));
          ordersToCheck.add(o.id);
        }
      } else if (row.kind === "cancelled" && l.state === "reserved") {
        lineUpdates.push({ id: l.order_item_id, patch: { state: "cancelled", done_by: "sheet" }, ifState: "reserved" });
        if (!row.closed) edit(row, "closed", sheetDate(today));
        log("sheet", `${orderLabel(o.order_no)} ${l.sku} set to Cancelled on the sheet: its stock is released (the order itself is still open in the app).`, l.sku);
      } else if (row.kind === "pending" && l.state !== "reserved" && l.done_by === "sheet" && isOpen(o)) {
        if (l.stock_taken) {
          await db.rpc("inventory_bump", {
            p_branch: branch,
            p_product: l.product_id,
            p_delta: l.qty,
            p_kind: "sheet",
            p_message: `${orderLabel(o.order_no)} set back to Pending Pickup on the sheet: ${l.qty} put back in stock.`,
          });
        }
        lineUpdates.push({ id: l.order_item_id, patch: { state: "reserved", done_by: null, stock_taken: false }, ifState: l.state });
        if (row.closed) edit(row, "closed", "");
        if (STOCK_MARK.test(row.notes)) edit(row, "notes", withoutMark(row.notes));
      } else if (row.kind !== want && (want === "pending" || row.kind !== "other")) {
        // The app's state stands (for example a line on a cancelled order can't be picked up).
        setStatus(row, want, l);
        final = STATUS[want];
        log("sheet", `${orderLabel(o.order_no)} ${l.sku}: STATUS set back to ${STATUS[want]} (that's where the order is in the app).`, l.sku, null, null, "AMBIT A.I.");
      }
    } else if (row.kind !== want) {
      setStatus(row, want, l);
      final = STATUS[want];
    }
    // Picked up and taken out of stock: the Notes say so (once).
    if (statusKind(final) === "done" && l.stock_taken && !STOCK_MARK.test(row.notes) && !edits.get(row.row)?.notes) {
      edit(row, "notes", withMark(row.notes));
    }

    const po = (o.ambit_po ?? "").trim();
    if (po && row.po !== po) edit(row, "po", po);
    if (edits.has(row.row)) sum.lines_updated++;
    lineUpdates.push({ id: l.order_item_id, patch: { sheet_row: row.row, sheet_status: final, needs_write: false, written_at: new Date().toISOString() } });
  }

  // ------------------------------------------------ write changed cells (one call per row)
  const editable: PendingCol[] = ["status", "po", "closed", "notes"];
  for (const [rowNo, cells] of edits) {
    const row = pend.rows.find((r) => r.row === rowNo)!;
    const current: Partial<Record<PendingCol, unknown>> = { status: row.status, po: row.po, closed: row.closed ? sheetDate(row.closed) : "", notes: row.notes };
    const cols = editable.filter((k) => canWrite(k) && k in cells).map((k) => c[k]!);
    for (const run of runs(cols)) {
      // Fill the gaps in a run with what's there now, so nothing else changes.
      const values = run.map((col) => {
        const k = (Object.keys(c) as PendingCol[]).find((x) => c[x] === col)!;
        return k in cells ? cells[k] : current[k] ?? "";
      });
      await wb.write(tab, rowNo, run[0], [values]);
    }
  }

  // ------------------------------------------------ add new lines
  const rowValues = (l: Line, kind: "pending" | "done"): Partial<Record<PendingCol, unknown>> => {
    const o = l.ord!;
    const item = itemByKey.get(l.sku.toUpperCase());
    const price = l.item?.customer_priced ? "" : l.item?.unit_price ?? "";
    const wt = item?.weight ? r2(item.weight * l.qty) : "";
    const how = o.delivery_method === "jobsite" ? "Job site delivery" : "Branch pickup";
    const notes = [`AMBIT A.I. app · ${how}`, o.needed_by ? `needed ${sheetDate(o.needed_by)}` : "", kind === "done" ? stockMark(today) : ""].filter(Boolean).join(" · ");
    const skuCell = typeof item?.skuRaw === "string" && /^0\d+$/.test(item.skuRaw) ? `'${item.skuRaw}` : item?.skuRaw ?? l.sku;
    return {
      order: orderLabel(o.order_no),
      date: sheetDate(todayCentral(new Date(o.created_at))),
      customer: [o.company_name, o.po_number ? `PO ${o.po_number}` : ""].filter(Boolean).join(" · "),
      sku: skuCell,
      desc: item?.desc ?? l.sku,
      uom: item?.uom ?? "",
      qty: l.qty,
      price,
      weight: wt,
      status: STATUS[kind],
      po: o.ambit_po ?? "",
      closed: kind === "done" ? sheetDate(today) : "",
      notes,
    };
  };
  const placed: { line: Line; row: number; kind: "pending" | "done" }[] = [];
  for (const a of appends) {
    const r = free.shift();
    if (r === undefined) {
      sum.full = true;
      log("error", `PENDING ORDERS is full, so ${orderLabel(a.line.ord!.order_no)} ${a.line.sku} couldn't be added. Clear out closed lines (or add rows inside the table) and it goes in on the next sync.`, a.line.sku, null, null, "AMBIT A.I.");
      continue;
    }
    placed.push({ line: a.line, row: r, kind: a.kind });
  }
  const cols = pend.writable.filter((k) => c[k]).map((k) => c[k]!);
  const colKey = new Map((Object.keys(c) as PendingCol[]).map((k) => [c[k]!, k]));
  // Consecutive rows go in one call per column run.
  for (let i = 0; i < placed.length; ) {
    let j = i + 1;
    while (j < placed.length && placed[j].row === placed[j - 1].row + 1) j++;
    const block = placed.slice(i, j);
    for (const run of runs(cols)) {
      const values = block.map((p) => {
        const v = rowValues(p.line, p.kind);
        return run.map((col) => v[colKey.get(col)!] ?? "");
      });
      await wb.write(tab, block[0].row, run[0], values);
    }
    for (const p of block) {
      sum.lines_added++;
      lineUpdates.push({
        id: p.line.order_item_id,
        patch: { sheet_row: p.row, sheet_status: STATUS[p.kind], needs_write: false, written_at: new Date().toISOString() },
      });
    }
    i = j;
  }

  for (const u of lineUpdates) {
    let q = db.from("inventory_lines").update({ ...u.patch, updated_at: new Date().toISOString() }).eq("order_item_id", u.id);
    if (u.ifState) q = q.eq("state", u.ifState);
    await q;
  }

  // Every line picked up on the sheet, and the order was ready for pickup / delivery: close it in the app too.
  for (const id of ordersToCheck) {
    const [{ count: items }, { count: done }, { data: o }] = await Promise.all([
      db.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", id),
      db.from("inventory_lines").select("order_item_id", { count: "exact", head: true }).eq("order_id", id).eq("state", "done"),
      db.from("orders").select("order_no, status, stage").eq("id", id).single<{ order_no: number; status: string; stage: string | null }>(),
    ]);
    if (!o || o.status === "completed" || o.status === "cancelled" || !items || items !== done) continue;
    if (o.stage === "scheduled") {
      await db.from("orders").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id).neq("status", "completed");
      log("order", `${orderLabel(o.order_no)}: every line was marked Picked Up / Completed on the sheet, so the order is complete in the app too.`, null, null, null, "Spreadsheet");
    } else {
      log("order", `${orderLabel(o.order_no)}: every line was marked Picked Up / Completed on the sheet. Finish the order in the app (it isn't scheduled yet).`, null, null, null, "Spreadsheet");
    }
  }

  // ------------------------------------------------ lines typed straight into the sheet
  const seen = cfg.row_seen; // null the first time: just remember what's there
  const connectedDay = cfg.connected_at ? todayCentral(new Date(cfg.connected_at)) : today;
  const nextSeen: Record<string, string> = {};
  const occurrences = new Map<string, number>();
  const reserved = new Map<string, number>();
  for (const r of pend.rows) {
    if (claimed.has(r.row)) continue;
    let fp = fingerprint(r);
    const n = (occurrences.get(fp) ?? 0) + 1;
    occurrences.set(fp, n);
    fp += `#${n}`;
    if (r.kind === "pending" && r.qty && stockedKeys.has(r.key)) {
      reserved.set(r.key, (reserved.get(r.key) ?? 0) + r.qty);
      sum.sheet_reserved++;
    }
    if (seen && r.kind === "done" && !STOCK_MARK.test(r.notes) && r.qty && r.qty > 0) {
      const prev = seen[fp];
      const eligible = prev === "pending" || (prev === undefined && (!r.closed || r.closed >= connectedDay));
      const pid = productId.get(r.key);
      if (eligible && pid && stockedKeys.has(r.key)) {
        // The note goes on first, so a hiccup can never take the same line out of stock twice.
        const note = withMark(r.notes);
        const cells: Partial<Record<PendingCol, unknown>> = { notes: note };
        if (!r.closed && canWrite("closed")) cells.closed = sheetDate(today);
        const current: Partial<Record<PendingCol, unknown>> = { status: r.status, po: r.po, closed: r.closed ? sheetDate(r.closed) : "", notes: r.notes };
        const wcols = (["closed", "notes"] as PendingCol[]).filter((k) => canWrite(k) && k in cells).map((k) => c[k]!);
        for (const run of runs(wcols)) {
          await wb.write(tab, r.row, run[0], [run.map((col) => {
            const k = colKey.get(col)!;
            return k in cells ? cells[k] : current[k] ?? "";
          })]);
        }
        await db.rpc("inventory_bump", {
          p_branch: branch,
          p_product: pid,
          p_delta: -r.qty,
          p_kind: "sheet",
          p_message: `${r.order || "A line"}${r.customer ? ` (${r.customer})` : ""} marked Picked Up / Completed on the sheet: ${r.qty} taken out of stock.`,
        });
        sum.sheet_closed++;
      }
    }
    nextSeen[fp] = r.kind || "blank";
  }
  await db.from("inventory_sheets").update({ row_seen: nextSeen }).eq("branch_id", branch);
  return reserved;
}
