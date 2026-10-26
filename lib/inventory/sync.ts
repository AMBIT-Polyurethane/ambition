import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { msConnection, msReady } from "@/lib/microsoft";
import { todayCentral } from "@/lib/sale";
import { resolveFile, Workbook } from "@/lib/inventory/workbook";
import { LOTS_TAB, countSheetTotal, lotFormulas, lotRange, newLotsTab, parseLotsSheet, type DbLot, type LotCol, type LotsSheet, type PendingRef } from "@/lib/inventory/lots";
import {
  STATUS,
  STOCK_MARK,
  colLetter,
  fingerprint,
  formulaAt,
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
  lotInNotes,
  lotTag,
  withLotTag,
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
// FOAM LOTS (spray foam by brand and lot): the sheet owns each lot's Starting Qty / Shipped In / Adj / dates,
//   the app adds pickups to Shipped Out. A product with lots gets its TOTAL IN STOCK from its lots (a formula
//   on the COUNT SHEET); app order lines name their lot in the PENDING ORDERS Notes ("[Lot PA86002836]").
//   The app adds the tab the first time, from the lots it has.

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
  lots?: number;
  lot_issues?: string[];
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
  id: number;
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
  lot_id: number | null;
  lot_no: string | null;
  prev_sku: string | null;
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
    lot_issues: [...new Set([...(a.lot_issues ?? []), ...(b.lot_issues ?? [])])],
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
    const countGrid = await wb.used(countTab);
    const count = parseCountSheet(countGrid);
    const pend = parsePendingSheet(await wb.used(pendTab));
    sum.items = count.items.length;
    sum.duplicates = count.duplicates;
    if (count.items.length === 0) throw new Error("COUNT SHEET has no items on it (nothing under the SKU header).");

    // -------------------------------------------------------------- new items -> products
    const productId = await ensureProducts(db, count.items, sum, log);
    const itemByKey = new Map(count.items.map((i) => [i.key, i]));

    // -------------------------------------------------------------- FOAM LOTS (added the first time)
    const lots = await syncLotsIn(db, wb, names, cfg, count, countTab, pend, pendTab, productId, sum, log);

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
    const stockedKeys = new Set([...count.items.map((i) => i.key), ...lots.skuKeys]);
    const { reserved: manualPending, lotReserved } = await reconcilePending(db, wb, pendTab, pend, cfg, itemByKey, productId, stockedKeys, lots, today, sum, log);
    await syncLotsOut(db, wb, branch, lots, lotReserved, sum);

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
      const isLot = lots.products.has(pid);
      const K = item.stock;
      const A = num(row.on_hand);
      const B = num(row.synced_on_hand);
      const patch: Record<string, unknown> = {};
      const sheetChanged = !same(K, B);
      const appChanged = !same(A, B);
      let writeK: number | null | undefined;
      let writeCount = false;

      if (isLot) {
        // Counted by lot: TOTAL IN STOCK is a formula that adds up the lots on FOAM LOTS.
        if (lots.tab && lots.sheet && count.cols.sku && !formulaAt(countGrid, item.row, stockCol)) {
          const f = countSheetTotal(lots.tab, lots.sheet, `$${colLetter(count.cols.sku)}${item.row}`);
          if (f) {
            await wb.write(countTab, item.row, stockCol, [[f]]);
            sum.to_sheet++;
            log(
              "sheet",
              K !== null && !lots.created
                ? `${show(K)} was typed into TOTAL IN STOCK for ${item.sku}, but it's counted by lot: the lot total is back. Change the lots on the ${lots.tab} tab instead (Adj for a count difference).`
                : `TOTAL IN STOCK for ${item.sku} now adds up its lots on the ${lots.tab} tab.`,
              item.sku,
              null,
              null,
              "AMBIT A.I.",
            );
          }
        }
      } else if (row.count_dirty) {
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

    // Counted by lot but not on the COUNT SHEET (Winter resins, ISO brands): lines typed into PENDING ORDERS still hold stock.
    for (const r of now.values()) {
      if (seenProducts.has(r.product_id) || !lots.products.has(r.product_id)) continue;
      const pendingHere = r2(manualPending.get(r.sku.toUpperCase()) ?? 0);
      if (!same(pendingHere, num(r.sheet_pending))) {
        await db.from("inventory").update({ sheet_pending: pendingHere, updated_at: new Date().toISOString() }).eq("branch_id", branch).eq("product_id", r.product_id);
      }
    }

    // Taken off the sheet: no longer stocked here.
    const gone = [...now.values()].filter((r) => r.on_sheet && !seenProducts.has(r.product_id) && !lots.products.has(r.product_id));
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

// ======================================================================================
// FOAM LOTS

type Lots = {
  tab: string | null;
  sheet: LotsSheet | null;
  /** "SKU|LOT" (upper case) -> lot id */
  ids: Map<string, number>;
  /** Products counted by lot at this branch. */
  products: Set<string>;
  /** Their SKUs (upper case). */
  skuKeys: Set<string>;
  /** Shipped Out on the sheet right now, per lot id. */
  sheetOut: Map<number, number>;
  pendRef: PendingRef;
  /** The tab was added on this run. */
  created: boolean;
};

type DbLotRow = DbLot & { branch_id: string; on_sheet: boolean; sheet_row: number | null; sheet_pending: number; remaining: number };

/** Reads FOAM LOTS into the app (adding the tab first if the branch has lots but no tab yet). */
async function syncLotsIn(
  db: SupabaseClient,
  wb: Workbook,
  names: string[],
  cfg: Cfg,
  count: ReturnType<typeof parseCountSheet>,
  countTab: string,
  pend: PendingSheet,
  pendTab: string,
  productId: Map<string, string>,
  sum: SyncSummary,
  log: (kind: string, message: string, sku?: string | null, before?: number | null, after?: number | null, by?: string) => void,
): Promise<Lots> {
  const branch = cfg.branch_id;
  const pc = pend.cols;
  const pendRef: PendingRef =
    pc.qty && pc.sku && pc.notes && pc.status ? { tab: pendTab, first: pend.headerRow + 1, last: Math.max(pend.end, pend.headerRow + 1), qty: pc.qty, sku: pc.sku, notes: pc.notes, status: pc.status } : null;
  const out: Lots = { tab: null, sheet: null, ids: new Map(), products: new Set(), skuKeys: new Set(), sheetOut: new Map(), pendRef, created: false };

  const { data: lotData, error } = await db.from("inventory_lots").select("*").eq("branch_id", branch).order("sort").order("id").range(0, 4999);
  if (error) throw new Error(`Couldn't read foam lots: ${error.message}`);
  const dbLots = ((lotData ?? []) as DbLotRow[]).map((l) => ({ ...l, lot_no: l.lot_no ?? "" }));
  let tab = names.find((n) => norm(n) === norm(LOTS_TAB)) ?? null;
  if (!tab && !dbLots.length) return out; // nothing counted by lot here

  const { data: prodData } = await db.from("products").select("id, sku, name, pick_rank").in("id", [...new Set(dbLots.map((l) => l.product_id))]);
  const prod = new Map(((prodData ?? []) as { id: string; sku: string; name: string; pick_rank: number }[]).map((p) => [p.id, p]));

  if (!tab) {
    // First time: the tab, laid out like the old inventory sheet, from the lots the app has.
    const { data: b } = await db.from("branches").select("name, state").eq("id", branch).maybeSingle<{ name: string; state: string }>();
    const rank = (l: DbLot) => prod.get(l.product_id)?.pick_rank ?? 100;
    const live = dbLots
      .filter((l) => l.on_sheet)
      .sort((a, z) => a.sort - z.sort || rank(a) - rank(z) || (a.use_by ?? "9999").localeCompare(z.use_by ?? "9999") || a.id - z.id);
    const t = newLotsTab(b ? `${b.name} ${b.state}` : branch.toUpperCase(), live, (l) => prod.get(l.product_id)?.name ?? l.sku, pendRef);
    await wb.addSheet(LOTS_TAB);
    await wb.write(LOTS_TAB, 1, 1, t.values);
    for (const [address, part, body] of t.looks) await wb.format(LOTS_TAB, address, part, body);
    await wb.freezeRows(LOTS_TAB, 4);
    for (const l of live) {
      if (Number(l.out_unsynced)) await db.rpc("inventory_lot_written", { p_lot: l.id, p_sheet_out: Number(l.shipped_out), p_written: Number(l.out_unsynced) });
    }
    tab = LOTS_TAB;
    out.created = true;
    log("sheet", `Added the ${LOTS_TAB} tab: spray foam by brand and lot (${live.length} lots). Keep each lot's quantities up to date there.`, null, null, null, "AMBIT A.I.");

    // The COUNT SHEET rows for these products now add up their lots (the formulas go in below); say so in their Notes.
    const lotSkus = new Set(dbLots.map((l) => l.sku.toUpperCase()));
    for (const item of count.items) {
      if (!lotSkus.has(item.key)) continue;
      if (count.cols.notes) await wb.write(countTab, item.row, count.cols.notes, [[`Counted by lot: see the ${LOTS_TAB} tab.`]]);
      if (count.cols.desc && lotSkus.has(`${item.key}-W`) && !/summer|winter/i.test(item.desc)) {
        await wb.write(countTab, item.row, count.cols.desc, [[`${item.desc} (Summer)`]]);
      }
    }
  }

  const sheet = parseLotsSheet(await wb.used(tab));
  if (!sheet) throw new Error(`The ${tab} tab has no header row with SKU, Lot #, Starting Qty and Shipped Out.`);
  out.tab = tab;
  out.sheet = sheet;
  const issues: string[] = sheet.dupes.map((d) => `${d} is on ${tab} twice (only the first row counts)`);

  // ---- the sheet's lots into the app
  const byKey = new Map(dbLots.map((l) => [`${l.product_id}|${l.lot_no.toUpperCase()}`, l]));
  const matched = new Set<number>();
  const show = (n: number) => String(r2(n));
  for (const r of sheet.rows) {
    const pid = productId.get(r.key);
    if (!pid) {
      issues.push(`${r.sku} on ${tab} row ${r.row} isn't a product in the app (check the SKU)`);
      continue;
    }
    const fields = {
      sku: r.sku,
      label: r.label || null,
      mfg: r.mfg,
      exp: r.exp,
      starting: r2(r.starting),
      shipped_out: r2(r.out),
      shipped_in: r2(r.in),
      adj: r2(r.adj),
      notes: r.notes || null,
      sheet_row: r.row,
      on_sheet: true,
      sort: r.row,
    };
    const ex = byKey.get(`${pid}|${r.lotKey}`);
    let id: number;
    if (ex) {
      id = ex.id;
      matched.add(ex.id);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        const cur = (ex as unknown as Record<string, unknown>)[k];
        const differs = typeof v === "number" ? !same(v, num(cur)) : (v ?? null) !== (cur ?? null);
        if (differs) patch[k] = v;
      }
      if (Object.keys(patch).length) {
        const { error: ue } = await db.from("inventory_lots").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", ex.id);
        if (ue) throw new Error(`Couldn't save lot ${r.lot || r.sku}: ${ue.message}`);
        const before = Number(ex.starting) - Number(ex.shipped_out) + Number(ex.shipped_in) + Number(ex.adj);
        const after = r.starting - r.out + r.in + r.adj;
        if (!same(before, after)) {
          sum.from_sheet++;
          log("sheet", `Lot ${r.lot || "(no lot #)"} changed on ${tab}: ${show(before)} → ${show(after)} left.`, r.sku, before, after);
        }
      }
    } else {
      const { data: made, error: ie } = await db
        .from("inventory_lots")
        .insert({ branch_id: branch, product_id: pid, lot_no: r.lot, ...fields })
        .select("id")
        .single<{ id: number }>();
      if (ie || !made) throw new Error(`Couldn't add lot ${r.lot || r.sku}: ${ie?.message ?? "unknown"}`);
      id = made.id;
      sum.from_sheet++;
      log("sheet", `New lot on ${tab}: ${r.lot || "(no lot #)"}, ${show(r.starting - r.out + r.in + r.adj)} on hand.`, r.sku, null, r.starting - r.out + r.in + r.adj);
    }
    out.ids.set(`${r.key}|${r.lotKey}`, id);
    out.sheetOut.set(id, r.out);
  }

  // ---- lots taken off the sheet
  const { data: openPicks } = await db.from("inventory_lines").select("lot_id, qty").eq("branch_id", branch).eq("state", "reserved").not("lot_id", "is", null);
  const pickedFrom = new Map<number, number>();
  for (const p of (openPicks ?? []) as { lot_id: number; qty: number }[]) pickedFrom.set(p.lot_id, (pickedFrom.get(p.lot_id) ?? 0) + Number(p.qty));
  for (const l of dbLots) {
    if (matched.has(l.id) || !l.on_sheet) continue;
    await db.from("inventory_lots").update({ on_sheet: false, sheet_row: null, updated_at: new Date().toISOString() }).eq("id", l.id);
    const held = pickedFrom.get(l.id);
    log(
      "sheet",
      `Lot ${l.lot_no || "(no lot #)"} is no longer on ${tab}, so it's out of stock.${held ? ` ${show(held)} on open orders still point at it: change their lot on the order page.` : ""}`,
      l.sku,
    );
  }

  // ---- formula columns on rows that don't have them yet (new lots typed in by hand)
  const range = lotRange(sheet);
  for (const r of sheet.rows) {
    if (!r.missing.length) continue;
    const f = lotFormulas(sheet.cols, r.row, range, pendRef);
    const cols = r.missing.filter((k) => f[k]).map((k) => sheet.cols[k]!);
    const byCol = new Map((Object.keys(sheet.cols) as LotCol[]).map((k) => [sheet.cols[k]!, k]));
    for (const run of runs(cols)) await wb.write(tab, r.row, run[0], [run.map((c) => f[byCol.get(c)!] ?? "")]);
  }

  const { data: all } = await db.from("inventory_lots").select("product_id, sku").eq("branch_id", branch).range(0, 4999);
  for (const l of (all ?? []) as { product_id: string; sku: string }[]) {
    out.products.add(l.product_id);
    out.skuKeys.add(l.sku.toUpperCase());
  }
  sum.lots = sheet.rows.length;
  sum.lot_issues = issues;
  return out;
}

/** Pickups made in the app onto Shipped Out, what lines typed into PENDING ORDERS hold per lot, and the totals. */
async function syncLotsOut(db: SupabaseClient, wb: Workbook, branch: string, lots: Lots, lotReserved: Map<number, number>, sum: SyncSummary) {
  if (!lots.products.size) return;
  const { data } = await db.from("inventory_lots").select("id, shipped_out, out_unsynced, sheet_row, sheet_pending, on_sheet").eq("branch_id", branch).range(0, 4999);
  const outCol = lots.sheet?.cols.out;
  for (const l of (data ?? []) as { id: number; shipped_out: number; out_unsynced: number; sheet_row: number | null; sheet_pending: number; on_sheet: boolean }[]) {
    const held = r2(lotReserved.get(l.id) ?? 0);
    if (!same(held, num(l.sheet_pending))) await db.from("inventory_lots").update({ sheet_pending: held }).eq("id", l.id);
    const add = r2(Number(l.out_unsynced));
    if (!add || !l.on_sheet || !l.sheet_row || !lots.tab || !outCol) continue;
    const now = lots.sheetOut.get(l.id) ?? Number(l.shipped_out);
    await wb.write(lots.tab, l.sheet_row, outCol, [[r2(now + add)]]);
    await db.rpc("inventory_lot_written", { p_lot: l.id, p_sheet_out: now, p_written: add });
    sum.to_sheet++;
  }
  await db.rpc("inventory_lots_rollup_all", { p_branch: branch });
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
  lots: Lots,
  today: string,
  sum: SyncSummary,
  log: (kind: string, message: string, sku?: string | null, before?: number | null, after?: number | null, by?: string) => void,
): Promise<{ reserved: Map<string, number>; lotReserved: Map<number, number> }> {
  const branch = cfg.branch_id;
  const c = pend.cols;
  const canWrite = (k: PendingCol) => Boolean(c[k]) && pend.writable.includes(k);

  const { data: lineData, error } = await db
    .from("inventory_lines")
    .select(
      "id, order_item_id, order_id, product_id, sku, qty, state, done_by, stock_taken, sheet_row, sheet_status, needs_write, lot_id, lot_no, prev_sku, item:order_items(unit_price, customer_priced), ord:orders(id, order_no, status, stage, ambit_po, company_name, po_number, created_at, delivery_method, needed_by)",
    )
    .eq("branch_id", branch)
    .order("id")
    .range(0, 9999);
  if (error) throw new Error(`Couldn't read order lines: ${error.message}`);
  const lines = ((lineData ?? []) as unknown as Line[]).map((l) => ({ ...l, qty: Number(l.qty) }));

  // Names for SKUs that aren't on the COUNT SHEET (Winter resins, ISO brands).
  const notListed = [...new Set(lines.filter((l) => !itemByKey.has(l.sku.toUpperCase())).map((l) => l.product_id))];
  const { data: prodData } = notListed.length ? await db.from("products").select("id, name, unit").in("id", notListed) : { data: [] };
  const prodInfo = new Map(((prodData ?? []) as { id: string; name: string; unit: string }[]).map((p) => [p.id, p]));

  const byOrder = new Map<string, PendingRow[]>();
  for (const r of pend.rows) {
    const k = r.order.toUpperCase();
    byOrder.set(k, [...(byOrder.get(k) ?? []), r]);
  }
  // Spray foam lines carry their lot in the Notes; a line with no lot yet says so.
  const lotLine = (l: Line) => l.lot_id !== null || lots.products.has(l.product_id);
  const lotOk = (r: PendingRow, l: Line) => (l.lot_id !== null ? r.lot !== null && r.lot.toUpperCase() === (l.lot_no ?? "").toUpperCase() : r.lot === null);
  const claimed = new Set<number>();
  const free = [...pend.free];

  // Cell changes on existing rows: row -> column -> value
  const edits = new Map<number, Partial<Record<PendingCol, unknown>>>();
  const edit = (row: PendingRow, k: PendingCol, v: unknown) => {
    if (!canWrite(k)) return;
    edits.set(row.row, { ...(edits.get(row.row) ?? {}), [k]: v });
  };
  const withMark = (notes: string) => (STOCK_MARK.test(notes) ? notes : `${notes ? `${notes} ` : ""}${stockMark(today)}`);
  const notesNow = (row: PendingRow) => String(edits.get(row.row)?.notes ?? row.notes);
  const withoutMark = (notes: string) => notes.replace(/\s*\[stock taken[^\]]*\]/gi, "").trim();
  const setStatus = (row: PendingRow, kind: Exclude<StatusKind, "other" | "">, l?: Line) => {
    edit(row, "status", STATUS[kind]);
    if (kind === "pending") {
      if (row.closed) edit(row, "closed", "");
      if (STOCK_MARK.test(notesNow(row))) edit(row, "notes", withoutMark(notesNow(row)));
    } else {
      if (!row.closed) edit(row, "closed", sheetDate(today));
      if (kind === "done" && (!l || l.stock_taken)) edit(row, "notes", withMark(notesNow(row)));
    }
  };

  const appends: { line: Line; kind: "pending" | "done" }[] = [];
  const lineUpdates: { id: number; patch: Record<string, unknown>; ifState?: string }[] = [];
  const reserved = new Map<string, number>();
  const lotReserved = new Map<number, number>();
  const ordersToCheck = new Set<string>();
  const isOpen = (o: Ord) => o.status !== "cancelled" && o.status !== "completed";

  // What an app line looks like on PENDING ORDERS.
  const rowValues = (l: Line, kind: "pending" | "done"): Partial<Record<PendingCol, unknown>> => {
    const o = l.ord!;
    const item = itemByKey.get(l.sku.toUpperCase());
    const price = l.item?.customer_priced ? "" : l.item?.unit_price ?? "";
    const wt = item?.weight ? r2(item.weight * l.qty) : "";
    const how = o.delivery_method === "jobsite" ? "Job site delivery" : "Branch pickup";
    const notes = [
      `AMBIT A.I. app · ${how}`,
      o.needed_by ? `needed ${sheetDate(o.needed_by)}` : "",
      lotLine(l) ? lotTag(l.lot_id !== null ? l.lot_no ?? "" : null) : "",
      kind === "done" ? stockMark(today) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const skuCell = typeof item?.skuRaw === "string" && /^0\d+$/.test(item.skuRaw) ? `'${item.skuRaw}` : item?.skuRaw ?? l.sku;
    const info = prodInfo.get(l.product_id);
    return {
      order: orderLabel(o.order_no),
      date: sheetDate(todayCentral(new Date(o.created_at))),
      customer: [o.company_name, o.po_number ? `PO ${o.po_number}` : ""].filter(Boolean).join(" · "),
      sku: skuCell,
      desc: item?.desc ?? info?.name ?? l.sku,
      uom: item?.uom ?? (info?.unit ? info.unit.toUpperCase() : ""),
      qty: l.qty,
      price,
      weight: wt,
      status: STATUS[kind],
      po: o.ambit_po ?? "",
      closed: kind === "done" ? sheetDate(today) : "",
      notes,
    };
  };
  for (const l of lines) {
    const o = l.ord;
    if (!o) continue;
    const want: "pending" | "done" | "cancelled" = l.state === "reserved" ? "pending" : l.state;
    const sku = l.sku.toUpperCase();
    const prev = l.prev_sku ? l.prev_sku.toUpperCase() : null;
    const cands = (byOrder.get(orderLabel(o.order_no).toUpperCase()) ?? []).filter((r) => !claimed.has(r.row) && (r.key === sku || r.key === prev));
    const row =
      cands.find((r) => r.row === l.sheet_row) ??
      (lotLine(l) ? cands.find((r) => r.key === sku && lotOk(r, l)) : undefined) ??
      cands.find((r) => r.key === sku) ??
      cands[0];

    if (!row) {
      if (l.state === "reserved") {
        appends.push({ line: l, kind: "pending" });
        if (l.sheet_row) log("sheet", `${orderLabel(o.order_no)} ${l.sku} was missing from PENDING ORDERS (still open in the app), so it was added back.`, l.sku, null, null, "AMBIT A.I.");
      } else if (l.state === "done" && !l.sheet_row && l.needs_write) {
        appends.push({ line: l, kind: "done" }); // picked up before it ever reached the sheet: keep the record
      } else if (l.needs_write) {
        lineUpdates.push({ id: l.id, patch: { needs_write: false } });
      }
      continue;
    }
    claimed.add(row.row);

    const last = l.sheet_status ? statusKind(l.sheet_status) : null;
    let final: string = row.status;
    if (last !== null && row.kind !== last) {
      // Someone changed STATUS on the sheet.
      if (row.kind === "done" && l.state === "reserved") {
        const { data: took } = await db.rpc("inventory_line_done_on_sheet", { p_line: l.id, p_status: row.status });
        if (took) {
          sum.sheet_closed++;
          l.stock_taken = true;
          if (!row.closed) edit(row, "closed", sheetDate(today));
          edit(row, "notes", withMark(notesNow(row)));
          ordersToCheck.add(o.id);
        }
      } else if (row.kind === "cancelled" && l.state === "reserved") {
        lineUpdates.push({ id: l.id, patch: { state: "cancelled", done_by: "sheet" }, ifState: "reserved" });
        if (!row.closed) edit(row, "closed", sheetDate(today));
        log("sheet", `${orderLabel(o.order_no)} ${l.sku} set to Cancelled on the sheet: its stock is released (the order itself is still open in the app).`, l.sku);
      } else if (row.kind === "pending" && l.state !== "reserved" && l.done_by === "sheet" && isOpen(o)) {
        if (l.stock_taken) {
          await db.rpc("inventory_line_stock", {
            p_line: l.id,
            p_sign: 1,
            p_kind: "sheet",
            p_what: `${orderLabel(o.order_no)} set back to Pending Pickup on the sheet: `,
            p_who: "Spreadsheet",
          });
        }
        lineUpdates.push({ id: l.id, patch: { state: "reserved", done_by: null, stock_taken: false }, ifState: l.state });
        if (row.closed) edit(row, "closed", "");
        if (STOCK_MARK.test(notesNow(row))) edit(row, "notes", withoutMark(notesNow(row)));
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
    if (statusKind(final) === "done" && l.stock_taken && !STOCK_MARK.test(notesNow(row))) {
      edit(row, "notes", withMark(notesNow(row)));
    }
    // Moved to another brand on the order page: the row gets the new SKU.
    if (row.key !== sku) {
      const v = rowValues(l, "pending");
      for (const k of ["sku", "desc", "uom", "weight"] as PendingCol[]) edit(row, k, v[k] ?? "");
    }
    // Spray foam: the lot it comes from, in the Notes.
    if (lotLine(l)) {
      const cur = notesNow(row);
      if (!lotOk({ ...row, lot: lotInNotes(cur) }, l)) edit(row, "notes", withLotTag(cur, l.lot_id !== null ? l.lot_no ?? "" : null));
    }

    const po = (o.ambit_po ?? "").trim();
    if (po && row.po !== po) edit(row, "po", po);
    if (edits.has(row.row)) sum.lines_updated++;
    lineUpdates.push({
      id: l.id,
      patch: { sheet_row: row.row, sheet_status: final, needs_write: false, written_at: new Date().toISOString(), ...(l.prev_sku && canWrite("sku") ? { prev_sku: null } : {}) },
    });
  }

  // ------------------------------------------------ write changed cells (one call per row)
  const editable: PendingCol[] = ["sku", "desc", "uom", "weight", "status", "po", "closed", "notes"];
  for (const [rowNo, cells] of edits) {
    const row = pend.rows.find((r) => r.row === rowNo)!;
    const current: Partial<Record<PendingCol, unknown>> = { sku: row.sku, status: row.status, po: row.po, closed: row.closed ? sheetDate(row.closed) : "", notes: row.notes };
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
        id: p.line.id,
        patch: { sheet_row: p.row, sheet_status: STATUS[p.kind], needs_write: false, written_at: new Date().toISOString() },
      });
    }
    i = j;
  }

  for (const u of lineUpdates) {
    let q = db.from("inventory_lines").update({ ...u.patch, updated_at: new Date().toISOString() }).eq("id", u.id);
    if (u.ifState) q = q.eq("state", u.ifState);
    await q;
  }

  // Every line picked up on the sheet, and the order was ready for pickup / delivery: close it in the app too.
  for (const id of ordersToCheck) {
    const [{ count: items }, { data: picks }, { data: o }] = await Promise.all([
      db.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", id),
      db.from("inventory_lines").select("order_item_id, state").eq("order_id", id),
      db.from("orders").select("order_no, status, stage").eq("id", id).single<{ order_no: number; status: string; stage: string | null }>(),
    ]);
    // Every item has its stock lines (one per lot), and all of them are picked up.
    const ps = (picks ?? []) as { order_item_id: number; state: string }[];
    const allDone = ps.length > 0 && ps.every((p) => p.state === "done") && new Set(ps.map((p) => p.order_item_id)).size === items;
    if (!o || o.status === "completed" || o.status === "cancelled" || !items || !allDone) continue;
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
  const lotOf = (r: PendingRow) => (r.lot !== null ? lots.ids.get(`${r.key}|${r.lot.toUpperCase()}`) : undefined);
  for (const r of pend.rows) {
    if (claimed.has(r.row)) continue;
    let fp = fingerprint(r);
    const n = (occurrences.get(fp) ?? 0) + 1;
    occurrences.set(fp, n);
    fp += `#${n}`;
    if (r.kind === "pending" && r.qty && stockedKeys.has(r.key)) {
      reserved.set(r.key, (reserved.get(r.key) ?? 0) + r.qty);
      const lot = lotOf(r);
      if (lot !== undefined) lotReserved.set(lot, (lotReserved.get(lot) ?? 0) + r.qty);
      sum.sheet_reserved++;
    }
    if (seen && r.kind === "done" && !STOCK_MARK.test(r.notes) && r.qty && r.qty > 0) {
      const prev = seen[fp];
      const eligible = prev === "pending" || (prev === undefined && (!r.closed || r.closed >= connectedDay));
      const pid = productId.get(r.key);
      const lot = lotOf(r);
      if (eligible && pid && lots.products.has(pid) && lot === undefined) {
        // Counted by lot, but the line doesn't say which lot: nothing to take it out of.
        log(
          "sheet",
          `${r.order || "A line"}${r.customer ? ` (${r.customer})` : ""}: ${r.qty} ${r.sku} marked Picked Up / Completed with no "[Lot ...]" in its Notes, so ${lots.tab ?? "FOAM LOTS"} wasn't changed. Add them to Shipped Out on the right lot.`,
          r.sku,
        );
      } else if (eligible && pid && stockedKeys.has(r.key)) {
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
        const what = `${r.order || "A line"}${r.customer ? ` (${r.customer})` : ""} marked Picked Up / Completed on the sheet: ${r.qty}`;
        if (lot !== undefined) {
          await db.rpc("inventory_lot_out", { p_lot: lot, p_qty: r.qty, p_message: `${what} taken out of lot ${r.lot || "(no lot #)"} (Shipped Out on ${lots.tab}).` });
        } else {
          await db.rpc("inventory_bump", { p_branch: branch, p_product: pid, p_delta: -r.qty, p_kind: "sheet", p_message: `${what} taken out of stock.` });
        }
        sum.sheet_closed++;
      }
    }
    nextSeen[fp] = r.kind || "blank";
  }
  await db.from("inventory_sheets").update({ row_seen: nextSeen }).eq("branch_id", branch);
  return { reserved, lotReserved };
}
