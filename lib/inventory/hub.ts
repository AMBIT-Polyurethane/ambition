import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, centralStart } from "@/lib/order-desk";
import { todayCentral } from "@/lib/sale";
import { every } from "@/lib/inventory/pages";

// The Inventory Hub's numbers: stock value, reorder, expiring foam lots, movement, aging stock to put
// on sale, and count accuracy, for one location or all of them. Read with the signed-in person's access.
//
// Dollar values are at sell price: the Sell Price on that location's COUNT SHEET; if it's blank, the
// average price on the last 6 months of orders (what customers actually paid), else the list price.
// Spray foam has no sheet or list price (it's priced per customer), so its value comes from orders.
// Anything with none of these shows as "no price".

export type HubBranch = { id: string; name: string; state: string };

export type HubItem = {
  branch: string;
  product_id: string;
  /** What it sells as (ISO brands sell as ISO A-Side). */
  parent: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  on_hand: number;
  pending: number;
  net: number;
  rop: number | null;
  max: number | null;
  price: number | null;
  value: number;
  /** Units shipped (completed orders) in the last 30 / 90 days. */
  sold30: number;
  sold90: number;
  soldValue30: number;
  lastSale: string | null; // YYYY-MM-DD
  /** Days with no sale (since the last one, or since the app started tracking this location). */
  idle: number;
  idleSince: "sale" | "start";
  /** Spray foam: the oldest lot still in stock. */
  oldestMfg: string | null;
  soonestUseBy: string | null;
};

export type HubLot = {
  branch: string;
  sku: string;
  name: string;
  lot_no: string;
  mfg: string | null;
  exp: string | null;
  use_by: string | null;
  days: number | null; // days left until use by (negative = expired)
  remaining: number;
  value: number;
};

export type WeekRow = { week: string; label: string; shipped: number; received: number };

export type CountRow = { id: number; branch: string; kind: string; day: string; status: string; lines: number; exact: number; off: number; varianceUnits: number; varianceValue: number };

export type MoveRow = { branch: string; sku: string; name: string; unit: string; sold30: number; sold90: number; soldValue90: number; received90: number; transferIn90: number; transferOut90: number };

export type Hub = {
  today: string;
  branches: HubBranch[];
  scope: string[]; // branch ids shown
  items: HubItem[];
  lots: HubLot[];
  weeks: WeekRow[];
  moves: MoveRow[];
  counts: CountRow[];
  categories: { name: string; value: number; items: number }[];
  kpi: {
    value: number;
    pricedItems: number;
    noPrice: number;
    reorder: number;
    withRop: number;
    stocked: number;
    expiringLots: number;
    expiringDrums: number;
    expiringValue: number;
    expiredLots: number;
    expiredDrums: number;
    agingValue: number;
    agingItems: number;
    shipped30: number;
    received30: number;
    inTransitOut: number;
    inTransitIn: number;
    expected: number;
    accuracy: number | null; // % of count lines that matched, last 90 days
    countLines: number;
  };
  trackingStart: Record<string, string>; // branch -> first day the app has orders / the sheet
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
/** Monday of the week a day is in. */
const weekOf = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(day, -back);
};

export const AGING_DAYS = 90;
export const EXPIRING_DAYS = 60;

type Prod = { id: string; sku: string; name: string; unit: string; list_price: number | null; category_id: string | null; stock_of: string | null };

export async function loadHub(db: SupabaseClient, scope: string[] | "all"): Promise<Hub> {
  const today = todayCentral();
  const since365 = centralStart(addDays(today, -365));
  const since180 = centralStart(addDays(today, -182));

  const [{ data: sheetRows }, { data: branchRows }, { data: catRows }] = await Promise.all([
    db.from("inventory_sheets").select("branch_id, enabled, connected_at"),
    db.from("branches").select("id, name, state, sort").order("sort"),
    db.from("categories").select("id, name"),
  ]);
  const live = ((sheetRows ?? []) as { branch_id: string; enabled: boolean; connected_at: string | null }[]).filter((s) => s.enabled);
  const branches = ((branchRows ?? []) as (HubBranch & { sort: number })[]).filter((b) => live.some((s) => s.branch_id === b.id)).map(({ id, name, state }) => ({ id, name, state }));
  const ids = scope === "all" ? branches.map((b) => b.id) : scope.filter((b) => branches.some((x) => x.id === b));
  const cats = new Map(((catRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const empty: Hub = {
    today,
    branches,
    scope: ids,
    items: [],
    lots: [],
    weeks: [],
    moves: [],
    counts: [],
    categories: [],
    kpi: { value: 0, pricedItems: 0, noPrice: 0, reorder: 0, withRop: 0, stocked: 0, expiringLots: 0, expiringDrums: 0, expiringValue: 0, expiredLots: 0, expiredDrums: 0, agingValue: 0, agingItems: 0, shipped30: 0, received30: 0, inTransitOut: 0, inTransitIn: 0, expected: 0, accuracy: null, countLines: 0 },
    trackingStart: {},
  };
  if (!ids.length) return empty;

  const [invRes, lotRes, levelRes, orderRes, priceRes, inRes, trOutRes, trInRes, trLineRes, countRes, expRes, firstRes] = await Promise.all([
    every((a, z) =>
      db
        .from("inventory")
        .select("branch_id, product_id, sku, on_hand, reorder_point, max_qty, sell_price, product:products(id, sku, name, unit, list_price, category_id, stock_of)")
        .in("branch_id", ids)
        .eq("on_sheet", true)
        .order("branch_id")
        .order("product_id")
        .range(a, z),
    ),
    every((a, z) => db.from("inventory_lots").select("branch_id, product_id, sku, lot_no, mfg, exp, use_by, remaining, label, on_sheet").in("branch_id", ids).eq("on_sheet", true).order("id").range(a, z)),
    Promise.all(ids.map((b) => db.rpc("stock_for", { p_branch: b }).then((r) => ({ b, rows: (r.data ?? []) as { product_id: string; pending: number | null; net: number | null }[] })))),
    every((a, z) =>
      db
        .from("order_items")
        .select("product_id, qty, line_total, ord:orders!inner(branch_id, status, created_at, completed_at)")
        .in("ord.branch_id", ids)
        .neq("ord.status", "cancelled")
        .gte("ord.created_at", since365)
        .order("id")
        .range(a, z),
    ),
    every((a, z) =>
      db
        .from("order_items")
        .select("product_id, qty, unit_price, ord:orders!inner(status, created_at)")
        .neq("ord.status", "cancelled")
        .gte("ord.created_at", since180)
        .gt("unit_price", 0)
        .order("id")
        .range(a, z),
    ),
    every((a, z) =>
      db
        .from("inbound_deliveries")
        .select("id, branch_id, received_at, transfer_id, lines:inbound_lines(product_id, received_qty)")
        .in("branch_id", ids)
        .eq("status", "received")
        .gte("received_at", since180)
        .order("id")
        .range(a, z),
    ),
    db.from("inventory_transfers").select("id", { count: "exact", head: true }).in("from_branch", ids).eq("status", "in_transit"),
    db.from("inventory_transfers").select("id", { count: "exact", head: true }).in("to_branch", ids).eq("status", "in_transit"),
    db
      .from("inventory_transfers")
      .select("id, from_branch, to_branch, created_at, status, lines:inventory_transfer_lines(product_id, qty)")
      .or(`from_branch.in.(${ids.join(",")}),to_branch.in.(${ids.join(",")})`)
      .neq("status", "cancelled")
      .gte("created_at", since180)
      .range(0, 4999),
    db
      .from("inventory_counts")
      .select("id, branch_id, kind, day, status, lines:inventory_count_lines(product_id, system_qty, counted_qty)")
      .in("branch_id", ids)
      .gte("day", addDays(today, -90))
      .in("status", ["matched", "submitted", "approved"])
      .order("day", { ascending: false })
      .range(0, 999),
    db.from("inbound_deliveries").select("id", { count: "exact", head: true }).in("branch_id", ids).eq("status", "expected"),
    Promise.all(ids.map((b) => db.from("orders").select("created_at").eq("branch_id", b).order("created_at").limit(1).then((r) => ({ b, at: ((r.data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null })))),
  ]);

  // Tracking start: the first order in the app at that location, or when its sheet was connected.
  const trackingStart: Record<string, string> = {};
  for (const { b, at } of firstRes) {
    const sheetAt = live.find((s) => s.branch_id === b)?.connected_at ?? null;
    const first = [at, sheetAt].filter(Boolean).map((x) => dayOf(x!)).sort()[0];
    trackingStart[b] = first ?? today;
  }

  // ---- prices: the location's COUNT SHEET Sell Price; if it has none, what customers paid lately, else
  // the list price. ISO brands use ISO A-Side's order price.
  type Inv = { branch_id: string; product_id: string; sku: string; on_hand: number | null; reorder_point: number | null; max_qty: number | null; sell_price: number | null; product: Prod | null };
  const inv = invRes as unknown as Inv[];
  const paid = new Map<string, { q: number; v: number }>();
  for (const r of priceRes as unknown as { product_id: string | null; qty: number; unit_price: number }[]) {
    if (!r.product_id) continue;
    const cur = paid.get(r.product_id) ?? { q: 0, v: 0 };
    cur.q += n(r.qty);
    cur.v += n(r.qty) * n(r.unit_price);
    paid.set(r.product_id, cur);
  }
  const parentOf = (p: Prod | null) => p?.stock_of ?? p?.id ?? "";
  const priceOf = (p: Prod | null): number | null => {
    if (!p) return null;
    for (const id of [p.id, p.stock_of]) {
      if (!id) continue;
      const x = paid.get(id);
      if (x && x.q > 0) return Math.round((x.v / x.q) * 100) / 100;
    }
    return p.list_price !== null && p.list_price !== undefined && Number(p.list_price) > 0 ? Number(p.list_price) : null;
  };
  const prodById = new Map<string, Prod>();
  for (const r of inv) if (r.product) prodById.set(r.product.id, r.product);
  const sheetPrice = new Map<string, number>();
  for (const r of inv) if (r.sell_price !== null && Number(r.sell_price) > 0) sheetPrice.set(`${r.branch_id}|${r.product_id}`, Number(r.sell_price));
  /** What one of this item is worth at this location. */
  const priceAt = (branch: string, id: string): number | null => sheetPrice.get(`${branch}|${id}`) ?? priceOf(prodById.get(id) ?? null);

  // ---- sales (completed orders) by location and item; ISO A-Side counts for every ISO brand
  type OrderLine = { product_id: string | null; qty: number; line_total: number | null; ord: { branch_id: string; status: string; created_at: string; completed_at: string | null } };
  const lines = orderRes as unknown as OrderLine[];
  const sold = new Map<string, { s30: number; s90: number; v30: number; v90: number; last: string | null }>(); // branch|parent product
  const weeksStart = weekOf(addDays(today, -7 * 11));
  const weekMap = new Map<string, WeekRow>();
  for (let w = 0; w < 12; w++) {
    const wk = addDays(weeksStart, 7 * w);
    weekMap.set(wk, { week: wk, label: new Date(`${wk}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), shipped: 0, received: 0 });
  }
  let shipped30 = 0;
  for (const l of lines) {
    if (!l.product_id) continue;
    const saleDay = dayOf(l.ord.completed_at ?? l.ord.created_at);
    const key = `${l.ord.branch_id}|${l.product_id}`;
    const cur = sold.get(key) ?? { s30: 0, s90: 0, v30: 0, v90: 0, last: null };
    if (!cur.last || saleDay > cur.last) cur.last = saleDay;
    if (l.ord.status === "completed") {
      const age = days(saleDay, today);
      if (age <= 30) {
        cur.s30 += n(l.qty);
        cur.v30 += n(l.line_total);
        shipped30 += n(l.line_total);
      }
      if (age <= 90) {
        cur.s90 += n(l.qty);
        cur.v90 += n(l.line_total);
      }
      const wk = weekMap.get(weekOf(saleDay));
      if (wk) wk.shipped += n(l.line_total);
    }
    sold.set(key, cur);
  }

  // ---- received (vendors and transfers in)
  const recv90 = new Map<string, number>();
  const trIn90 = new Map<string, number>();
  const trOut90 = new Map<string, number>();
  let received30 = 0;
  const prodPrice = (branch: string, id: string) => priceAt(branch, id) ?? 0;
  for (const d of inRes as unknown as { branch_id: string; received_at: string; transfer_id: number | null; lines: { product_id: string; received_qty: number | null }[] }[]) {
    const day = dayOf(d.received_at);
    const age = days(day, today);
    for (const l of d.lines ?? []) {
      const q = n(l.received_qty);
      const v = q * prodPrice(d.branch_id, l.product_id);
      const wk = weekMap.get(weekOf(day));
      if (wk) wk.received += v;
      if (age <= 30) received30 += v;
      if (age <= 90) {
        const key = `${d.branch_id}|${l.product_id}`;
        const m = d.transfer_id ? trIn90 : recv90;
        m.set(key, (m.get(key) ?? 0) + q);
      }
    }
  }
  for (const t of (trLineRes.data ?? []) as unknown as { from_branch: string; created_at: string; lines: { product_id: string; qty: number }[] }[]) {
    if (!ids.includes(t.from_branch) || days(dayOf(t.created_at), today) > 90) continue;
    for (const l of t.lines ?? []) {
      const key = `${t.from_branch}|${l.product_id}`;
      trOut90.set(key, (trOut90.get(key) ?? 0) + n(l.qty));
    }
  }

  // ---- lots (spray foam)
  type Lot = { branch_id: string; product_id: string; sku: string; lot_no: string; mfg: string | null; exp: string | null; use_by: string | null; remaining: number; label: string | null };
  const lotRows = lotRes as Lot[];
  const lotsOf = new Map<string, Lot[]>();
  for (const l of lotRows) {
    const key = `${l.branch_id}|${l.product_id}`;
    if (!lotsOf.has(key)) lotsOf.set(key, []);
    lotsOf.get(key)!.push(l);
  }
  const lots: HubLot[] = lotRows
    .filter((l) => n(l.remaining) > 0)
    .map((l) => {
      const p = prodById.get(l.product_id) ?? null;
      const price = priceAt(l.branch_id, l.product_id) ?? 0;
      return {
        branch: l.branch_id,
        sku: l.sku,
        name: l.label || p?.name || l.sku,
        lot_no: l.lot_no || "(no lot #)",
        mfg: l.mfg,
        exp: l.exp,
        use_by: l.use_by,
        days: l.use_by ? days(today, l.use_by) : null,
        remaining: n(l.remaining),
        value: n(l.remaining) * price,
      };
    })
    .sort((a, z) => (a.use_by ?? "9999").localeCompare(z.use_by ?? "9999"));

  // ---- items
  const level = new Map<string, { pending: number; net: number | null }>();
  for (const { b, rows } of levelRes) for (const r of rows) level.set(`${b}|${r.product_id}`, { pending: n(r.pending), net: r.net === null ? null : n(r.net) });

  const items: HubItem[] = inv
    .filter((r) => r.product)
    .map((r) => {
      const p = r.product!;
      const key = `${r.branch_id}|${p.id}`;
      const s = sold.get(`${r.branch_id}|${parentOf(p)}`) ?? sold.get(key);
      const lv = level.get(key);
      const onHand = n(r.on_hand);
      const price = priceAt(r.branch_id, p.id);
      const myLots = (lotsOf.get(key) ?? []).filter((l) => n(l.remaining) > 0);
      const start = trackingStart[r.branch_id] ?? today;
      const last = s?.last ?? null;
      return {
        branch: r.branch_id,
        product_id: p.id,
        parent: parentOf(p),
        sku: r.sku,
        name: p.name,
        category: (p.category_id && cats.get(p.category_id)) || "Other",
        unit: p.unit,
        on_hand: onHand,
        pending: lv?.pending ?? 0,
        net: lv?.net ?? onHand,
        rop: r.reorder_point === null ? null : n(r.reorder_point),
        max: r.max_qty === null ? null : n(r.max_qty),
        price,
        value: price ? Math.max(0, onHand) * price : 0,
        sold30: s?.s30 ?? 0,
        sold90: s?.s90 ?? 0,
        soldValue30: s?.v30 ?? 0,
        lastSale: last,
        idle: days(last ?? start, today),
        idleSince: last ? "sale" : "start",
        oldestMfg: myLots.map((l) => l.mfg).filter(Boolean).sort()[0] ?? null,
        soonestUseBy: myLots.map((l) => l.use_by).filter(Boolean).sort()[0] ?? null,
      } satisfies HubItem;
    });

  // ---- movement per item (90 days)
  const moves: MoveRow[] = items
    .map((i) => {
      const key = `${i.branch}|${i.product_id}`;
      const s = sold.get(`${i.branch}|${parentOf(prodById.get(i.product_id) ?? null)}`) ?? sold.get(key);
      return {
        branch: i.branch,
        sku: i.sku,
        name: i.name,
        unit: i.unit,
        sold30: i.sold30,
        sold90: i.sold90,
        soldValue90: s?.v90 ?? 0,
        received90: recv90.get(key) ?? 0,
        transferIn90: trIn90.get(key) ?? 0,
        transferOut90: trOut90.get(key) ?? 0,
      };
    })
    .filter((m) => m.sold90 || m.received90 || m.transferIn90 || m.transferOut90);
  // ISO A-Side sells as one item: show its sales once, not on every brand.
  const seenIso = new Set<string>();
  for (const m of moves) {
    const p = items.find((i) => i.branch === m.branch && i.sku === m.sku);
    const parent = p ? prodById.get(p.product_id)?.stock_of : null;
    if (!parent) continue;
    const k = `${m.branch}|${parent}`;
    if (seenIso.has(k)) {
      m.sold30 = 0;
      m.sold90 = 0;
      m.soldValue90 = 0;
    } else {
      seenIso.add(k);
      m.name = `${m.name} (all ISO brands sold)`;
    }
  }

  // ---- counts
  const counts: CountRow[] = ((countRes.data ?? []) as unknown as { id: number; branch_id: string; kind: string; day: string; status: string; lines: { product_id: string; system_qty: number | null; counted_qty: number | null }[] }[]).map((c) => {
    let exact = 0;
    let off = 0;
    let vu = 0;
    let vv = 0;
    for (const l of c.lines ?? []) {
      if (l.counted_qty === null || l.counted_qty === undefined || l.system_qty === null || l.system_qty === undefined) continue;
      const d = n(l.counted_qty) - n(l.system_qty);
      if (Math.abs(d) < 0.005) exact++;
      else {
        off++;
        vu += d;
        vv += d * prodPrice(c.branch_id, l.product_id);
      }
    }
    return { id: c.id, branch: c.branch_id, kind: c.kind, day: c.day, status: c.status, lines: exact + off, exact, off, varianceUnits: vu, varianceValue: vv };
  });

  // ---- categories (stock value)
  const catMap = new Map<string, { name: string; value: number; items: number }>();
  for (const i of items) {
    if (i.value <= 0) continue;
    const c = catMap.get(i.category) ?? { name: i.category, value: 0, items: 0 };
    c.value += i.value;
    c.items++;
    catMap.set(i.category, c);
  }

  const stocked = items.filter((i) => i.on_hand > 0);
  const aging = stocked.filter((i) => i.idle >= AGING_DAYS);
  const expiring = lots.filter((l) => l.days !== null && l.days >= 0 && l.days <= EXPIRING_DAYS);
  const expired = lots.filter((l) => l.days !== null && l.days < 0);
  const lineCount = counts.reduce((s, c) => s + c.lines, 0);
  const exactCount = counts.reduce((s, c) => s + c.exact, 0);

  return {
    today,
    branches,
    scope: ids,
    items,
    lots,
    weeks: [...weekMap.values()],
    moves,
    counts,
    categories: [...catMap.values()].sort((a, z) => z.value - a.value),
    trackingStart,
    kpi: {
      value: stocked.reduce((s, i) => s + i.value, 0),
      pricedItems: stocked.filter((i) => i.price).length,
      noPrice: stocked.filter((i) => !i.price).length,
      reorder: items.filter((i) => i.rop !== null && i.net <= i.rop).length,
      withRop: items.filter((i) => i.rop !== null).length,
      stocked: stocked.length,
      expiringLots: expiring.length,
      expiringDrums: expiring.reduce((s, l) => s + l.remaining, 0),
      expiringValue: expiring.reduce((s, l) => s + l.value, 0),
      expiredLots: expired.length,
      expiredDrums: expired.reduce((s, l) => s + l.remaining, 0),
      agingValue: aging.reduce((s, i) => s + i.value, 0),
      agingItems: aging.length,
      shipped30,
      received30,
      inTransitOut: trOutRes.count ?? 0,
      inTransitIn: trInRes.count ?? 0,
      expected: expRes.count ?? 0,
      accuracy: lineCount ? Math.round((exactCount / lineCount) * 1000) / 10 : null,
      countLines: lineCount,
    },
  };
}

/** Suggested reorder point: about 3 weeks of what sold in the last 90 days (2 weeks lead time + 1 week cushion). */
export const suggestedRop = (i: Pick<HubItem, "sold90">) => (i.sold90 > 0 ? Math.ceil((i.sold90 / 90) * 21) : null);

/** Aging buckets for stock on hand (days with no sale). */
export function agingBuckets(items: HubItem[]): { label: string; value: number; items: number }[] {
  const b = [
    { label: "0–30 days", min: 0, max: 30 },
    { label: "31–60 days", min: 31, max: 60 },
    { label: "61–90 days", min: 61, max: 90 },
    { label: "91–180 days", min: 91, max: 180 },
    { label: "Over 180 days", min: 181, max: 1e9 },
  ];
  return b.map((x) => {
    const hit = items.filter((i) => i.on_hand > 0 && i.idle >= x.min && i.idle <= x.max);
    return { label: x.label, value: hit.reduce((s, i) => s + i.value, 0), items: hit.length };
  });
}
