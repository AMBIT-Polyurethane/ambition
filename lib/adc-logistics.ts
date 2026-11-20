import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zipPoint } from "@/lib/zip3";

// ADC web orders: where the stock is, how to get it to the customer, and roughly what that costs.
// Every number here is an ESTIMATE on the high side (list-style carrier rates, fuel, a 10% cushion, rounded up),
// good enough to quote a customer and to compare options. The order desk confirms real freight before it ships.

export type Mode = "parcel" | "freight" | "pickup" | "truckload";
export type Delivery = "ship" | "pickup" | "truckload";
export type Site = { site: "business" | "home"; unload: "dock" | "forklift" | "liftgate" };
export type PlanIn = { product_id: string | null; sku: string; name: string; qty: number };

export type ShipLine = { sku: string; name: string; qty: number };
export type Shipment = {
  from: string; // a location id, or "vendor"
  fromName: string;
  kind: "parcel" | "ltl" | "truck" | "vendor" | "pickup";
  lines: ShipLine[];
  weight: number;
  miles: number | null;
  cost: number | null;
  days: string;
  note?: string;
};
export type Transfer = { sku: string; name: string; qty: number; from: string; fromName: string; to: string; toName: string };
export type PlanOption = {
  key: "one" | "split" | "gather" | "pickup";
  title: string;
  ok: boolean;
  why?: string;
  shipments: Shipment[];
  transfers: Transfer[];
  /** What moving stock between locations first would cost us (not the customer): our estimate, high side. */
  transferCost?: number;
  total: number | null;
  days: string;
};
export type VendorLine = { sku: string; name: string; qty: number; vendor: string | null; lead: number | null };
export type Strategy = {
  at: string;
  dest: { zip: string; state: string } | null;
  delivery: Delivery;
  site: Site;
  weight: number;
  estWeights: string[];
  vendor: VendorLine[];
  unknown: string[];
  options: PlanOption[];
  best: PlanOption["key"] | null;
  estimate: number | null;
  partial: boolean;
  notes: string[];
  /** How far the closest AMBIT location is from the customer (road miles). */
  nearest: { id: string; name: string; miles: number } | null;
};

type Branch = { id: string; name: string; lat: number; lng: number };
type Prod = {
  id: string; sku: string; name: string; unit: string | null; category_id: string | null; adc_set: boolean | null; truck_qty: number | null;
  ship_weight: number | null; vendor_name: string | null; vendor_zip: string | null; vendor_lead_days: number | null; adc_ship: string | null; cat_ship: string | null;
};

/** Where the five locations are, if the database doesn't have their map points yet (update 0100 adds them). */
const BRANCH_POINTS: Record<string, [number, number]> = {
  okc: [35.4169, -97.6451],
  atx: [32.7561, -97.077],
  smx: [29.8785, -98.02],
  jax: [30.4295, -81.8206],
  mob: [30.5936, -88.1893],
};
/** The ISO (A-side) drum that comes with every spray foam set. */
const ISO_DRUM_LB = 580;

const r2 = (v: number) => Math.round(v * 100) / 100;
const up5 = (v: number) => Math.ceil(v / 5) * 5;

/** Road miles between two map points (straight line plus 20% for roads). */
export function roadMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.2);
}

/** A weight guess (lb each) for items the spreadsheet has no weight for. Leans heavy on purpose. */
function guessWeight(p: Prod): number {
  const u = (p.unit ?? "").toLowerCase();
  const n = p.name.toLowerCase();
  const empty = p.category_id === "drums-and-containers" || n.includes("empty");
  if (u === "tote") return empty ? 140 : 2700;
  if (u === "drum") return empty ? 45 : /15[ -]?gal/.test(n) ? 165 : 560;
  if (u === "pail" || /5[ -]?gal|pail/.test(n)) return 62;
  if (u === "gallon" || u === "gal") return 12;
  if (u === "case") return 30;
  if (u === "bag" || u === "bundle") return 45;
  if (u === "box") return 12;
  if (u === "roll") return 4;
  if (u === "can") return 2;
  if (u === "pk" || u === "pack") return 0.5;
  if (p.category_id === "guns-and-parts") return 1;
  return 5;
}

// ---------------------------------------------------------------- carrier price models (estimates)
const zoneOf = (mi: number) => (mi < 150 ? 2 : mi < 300 ? 3 : mi < 600 ? 4 : mi < 1000 ? 5 : mi < 1400 ? 6 : mi < 1800 ? 7 : 8);
const PARCEL: Record<number, [base: number, perLb: number, days: string]> = {
  2: [11.5, 0.42, "1-2"], 3: [12, 0.55, "2"], 4: [12.8, 0.75, "2-3"], 5: [13.5, 0.95, "3-4"], 6: [14.5, 1.15, "4-5"], 7: [15, 1.3, "4-5"], 8: [15.8, 1.45, "5-6"],
};
/** UPS/FedEx Ground style: boxes of up to 45 lb, fuel 18%, home delivery fee, 10% cushion. */
function parcelCost(lb: number, mi: number, site: Site) {
  const boxes = Math.max(1, Math.ceil(lb / 45));
  const each = Math.max(1, lb / boxes);
  const [base, perLb, days] = PARCEL[zoneOf(mi)];
  let c = boxes * (base + perLb * each) * 1.18;
  if (site.site === "home") c += 6.5 * boxes;
  return { cost: c * 1.1, days: `${days} business days` };
}
/** LTL freight: pallets, per hundred pounds by distance with weight breaks, minimum charge, fuel 28%, liftgate and home fees, 10% cushion. */
function ltlCost(lb: number, mi: number, site: Site) {
  const pallets = Math.max(1, Math.ceil(lb / 1500));
  const cwt = Math.max(lb + pallets * 50, 200) / 100;
  // LTL weight breaks: the more it weighs, the less each hundred pounds costs.
  const lbs = cwt * 100;
  const brk = lbs < 500 ? 1 : lbs < 2000 ? 0.85 : lbs < 5000 ? 0.7 : lbs < 10000 ? 0.6 : 0.5;
  let c = Math.max(190, cwt * (9 + 0.032 * mi) * brk) * 1.28;
  if (site.unload === "liftgate") c += 75;
  if (site.site === "home") c += 85;
  const d = Math.ceil(mi / 450);
  return { cost: c * 1.1, days: `${Math.max(2, d + 1)}-${d + 3} business days` };
}
/** A full 53' dry van: per mile with a minimum, 10% cushion. */
function truckCost(mi: number, trucks: number) {
  const d = Math.ceil(mi / 550);
  return { cost: Math.max(850, mi * 3.4) * Math.max(1, trucks) * 1.1, days: `${1 + d}-${2 + d} business days` };
}

type Ctx = {
  branches: Branch[];
  prod: Map<string, Prod>;
  weight: Map<string, number>;
  avail: Map<string, Map<string, number>>; // branch -> product -> qty free to sell
  vendors: Map<string, Map<string, { vendor: string; lead: number | null }>>; // product -> branch -> preferred vendor on that sheet
};

async function loadCtx(db: SupabaseClient, ids: string[]): Promise<Ctx> {
  const [br, pr, inv, held] = await Promise.all([
    db.from("branches").select("*").eq("active", true).order("sort"),
    ids.length
      ? db.from("products").select("*, category:categories(adc_ship)").in("id", ids)
      : Promise.resolve({ data: [] as unknown[] }),
    ids.length
      ? db.from("inventory").select("*").in("product_id", ids).range(0, 9999)
      : Promise.resolve({ data: [] as unknown[] }),
    ids.length
      ? db.from("inventory_lines").select("branch_id, product_id, qty").eq("state", "reserved").in("product_id", ids).range(0, 9999)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const branches: Branch[] = [];
  for (const b of (br.data ?? []) as { id: string; name: string; lat?: number | null; lng?: number | null }[]) {
    const pt = b.lat !== null && b.lat !== undefined && b.lng !== null && b.lng !== undefined ? [Number(b.lat), Number(b.lng)] : BRANCH_POINTS[b.id];
    if (pt) branches.push({ id: b.id, name: b.name, lat: pt[0], lng: pt[1] });
  }
  const prod = new Map<string, Prod>();
  for (const p of (pr.data ?? []) as (Prod & { category?: { adc_ship: string | null } | null })[]) {
    prod.set(p.id, { ...p, cat_ship: p.category?.adc_ship ?? null, truck_qty: p.truck_qty === null ? null : Number(p.truck_qty), ship_weight: p.ship_weight === null || p.ship_weight === undefined ? null : Number(p.ship_weight) });
  }
  const reserved = new Map<string, number>();
  for (const l of (held.data ?? []) as { branch_id: string; product_id: string; qty: number }[]) {
    const k = `${l.branch_id}|${l.product_id}`;
    reserved.set(k, (reserved.get(k) ?? 0) + Number(l.qty));
  }
  const weight = new Map<string, number>();
  const avail = new Map<string, Map<string, number>>();
  const vendors = new Map<string, Map<string, { vendor: string; lead: number | null }>>();
  for (const r of (inv.data ?? []) as { branch_id: string; product_id: string; on_hand: number | null; sheet_pending: number | null; unit_weight: number | null; on_sheet: boolean; vendor?: string | null; lead_days?: number | null }[]) {
    if (r.unit_weight !== null && Number(r.unit_weight) > 0) weight.set(r.product_id, Math.max(weight.get(r.product_id) ?? 0, Number(r.unit_weight)));
    if (r.vendor && r.vendor.trim()) {
      if (!vendors.has(r.product_id)) vendors.set(r.product_id, new Map());
      vendors.get(r.product_id)!.set(r.branch_id, { vendor: r.vendor.trim(), lead: r.lead_days === null || r.lead_days === undefined ? null : Number(r.lead_days) });
    }
    if (!r.on_sheet || r.on_hand === null) continue;
    const free = Math.max(0, Number(r.on_hand) - Number(r.sheet_pending ?? 0) - (reserved.get(`${r.branch_id}|${r.product_id}`) ?? 0));
    if (!avail.has(r.branch_id)) avail.set(r.branch_id, new Map());
    avail.get(r.branch_id)!.set(r.product_id, free);
  }
  return { branches, prod, weight, avail, vendors };
}

/**
 * The Best Strategy for one order: the options (one location, the closest stock for each item, gather at the closest
 * location first), what each costs and how long it takes, which one is best, and the shipping estimate for the customer.
 */
export async function planOrder(
  db: SupabaseClient,
  input: { lines: PlanIn[]; delivery: Delivery; zip: string; pickup_branch?: string | null; site: Site },
): Promise<Strategy> {
  const lines = input.lines.filter((l) => l.qty > 0);
  const ids = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => Boolean(x)))];
  const ctx = await loadCtx(db, ids);
  const dest = input.delivery === "pickup" ? null : zipPoint(input.zip);
  const notes: string[] = [];
  const estWeights: string[] = [];
  const unknown: string[] = [];

  // Each line: weight per unit (a set adds its ISO drum), shipping mode, stock by location.
  type L = { l: PlanIn; p: Prod; mode: Mode; each: number; set: boolean };
  const known: L[] = [];
  for (const l of lines) {
    const p = l.product_id ? ctx.prod.get(l.product_id) : undefined;
    if (!p) {
      unknown.push(l.sku || l.name);
      continue;
    }
    let each = ctx.weight.get(p.id) ?? (p.ship_weight && p.ship_weight > 0 ? p.ship_weight : null);
    if (each === null) {
      each = guessWeight(p);
      estWeights.push(p.sku);
    }
    const set = Boolean(p.adc_set);
    if (set) each += ISO_DRUM_LB;
    const mode = ((p.adc_ship ?? p.cat_ship ?? "parcel") as Mode) || "parcel";
    known.push({ l, p, mode, each, set });
  }
  if (known.some((k) => k.set)) notes.push("Spray foam sets include the ISO (A-side) drum: about 580 lb each. Stock shown is the B-side drum.");
  const weightOf = (list: { k: L; qty: number }[]) => r2(list.reduce((s, x) => s + x.k.each * x.qty, 0));
  const totalWeight = weightOf(known.map((k) => ({ k, qty: k.l.qty })));

  const bname = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? id;
  const free = (b: string, pid: string) => ctx.avail.get(b)?.get(pid) ?? 0;
  const near = (pt: { lat: number; lng: number }) => [...ctx.branches].sort((a, b) => roadMiles(a, pt) - roadMiles(b, pt));

  // What one shipment from a point costs: truck, LTL freight or parcel.
  const ship = (from: { id: string; name: string; lat: number; lng: number } | null, list: { k: L; qty: number }[], vendor = false): Shipment => {
    const lb = weightOf(list);
    const shipLines = list.map((x) => ({ sku: x.k.p.sku, name: x.k.p.name, qty: x.qty }));
    if (!from || !dest) {
      return { from: vendor ? "vendor" : from?.id ?? "?", fromName: vendor ? "Vendor" : from?.name ?? "?", kind: vendor ? "vendor" : "ltl", lines: shipLines, weight: lb, miles: null, cost: null, days: "To confirm" };
    }
    const mi = roadMiles(from, dest);
    const truckLines = list.filter((x) => x.k.mode === "truckload");
    if (input.delivery === "truckload" && truckLines.length) {
      const fill = truckLines.reduce((s, x) => s + (x.k.p.truck_qty ? x.qty / x.k.p.truck_qty : 0), 0);
      // At least half a truck goes as a truck; a smaller part of a split load goes as LTL freight (or a truck if cheaper).
      if (fill >= 0.5 || truckLines.some((x) => !x.k.p.truck_qty)) {
        const t = truckCost(mi, Math.ceil(Math.max(1, fill) - 0.05));
        return { from: from.id, fromName: from.name, kind: "truck", lines: shipLines, weight: lb, miles: mi, cost: r2(t.cost), days: t.days };
      }
    }
    const freight = list.some((x) => x.k.mode === "freight" || x.k.mode === "truckload") || lb > 150;
    const c = freight ? ltlCost(lb, mi, input.site) : parcelCost(lb, mi, input.site);
    // Big freight (over about 8,000 lb) is usually cheaper as a whole truck (up to about 42,000 lb each).
    if (freight && lb > 8000) {
      const t = truckCost(mi, Math.ceil(lb / 42000));
      if (t.cost < c.cost) return { from: vendor ? "vendor" : from.id, fromName: from.name, kind: vendor ? "vendor" : "truck", lines: shipLines, weight: lb, miles: mi, cost: r2(t.cost), days: t.days };
    }
    return { from: vendor ? "vendor" : from.id, fromName: from.name, kind: vendor ? "vendor" : freight ? "ltl" : "parcel", lines: shipLines, weight: lb, miles: mi, cost: r2(c.cost), days: c.days };
  };

  // Not enough anywhere: the vendor ships the rest (an estimate only when we know where the vendor ships from).
  const network = (k: L) => ctx.branches.reduce((s, b) => s + free(b.id, k.p.id), 0);
  const short = new Map<string, number>();
  for (const k of known) {
    const s = Math.max(0, k.l.qty - network(k));
    if (s > 0) short.set(k.p.id, s);
  }
  // Who supplies it: the product's own Vendor box, else the Preferred Vendor on the closest location's spreadsheet.
  const anchor = dest ?? ctx.branches.find((b) => b.id === input.pickup_branch) ?? null;
  const supplier = (p: Prod): { vendor: string | null; lead: number | null } => {
    if (p.vendor_name) return { vendor: p.vendor_name, lead: p.vendor_lead_days };
    const per = ctx.vendors.get(p.id);
    if (!per || !per.size) return { vendor: null, lead: p.vendor_lead_days };
    const order = anchor ? near(anchor).map((b) => b.id) : ctx.branches.map((b) => b.id);
    const hit = order.map((id) => per.get(id)).find(Boolean) ?? [...per.values()][0];
    return { vendor: hit.vendor, lead: p.vendor_lead_days ?? hit.lead };
  };
  const vendor: VendorLine[] = known
    .filter((k) => short.has(k.p.id))
    .map((k) => ({ sku: k.p.sku, name: k.p.name, qty: short.get(k.p.id)!, ...supplier(k.p) }));
  const vendorShipments = (): Shipment[] => {
    const groups = new Map<string, { k: L; qty: number }[]>();
    for (const k of known) {
      const s = short.get(k.p.id);
      if (!s) continue;
      const key = `${supplier(k.p).vendor ?? "?"}|${k.p.vendor_zip ?? ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ k, qty: s });
    }
    return [...groups.values()].map((g) => {
      const p = g[0].k.p;
      const sup = supplier(p);
      const vz = p.vendor_zip ? zipPoint(p.vendor_zip) : null;
      const s = ship(vz && input.delivery !== "pickup" ? { id: "vendor", name: sup.vendor ?? "Vendor", lat: vz.lat, lng: vz.lng } : null, g, true);
      const lead = sup.lead;
      return {
        ...s,
        kind: "vendor" as const,
        fromName: sup.vendor ? `Vendor: ${sup.vendor}` : "Vendor (no Preferred Vendor on the spreadsheet)",
        days: lead ? `${lead} days for the vendor + ${s.days === "To confirm" ? "shipping" : s.days}` : s.days,
        note: input.delivery === "pickup" ? "Have the vendor ship to the pickup location." : p.vendor_zip ? "Vendor ships straight to the customer (drop ship)." : "Freight from the vendor: get a quote (or add the vendor's ship-from ZIP on the product).",
      };
    });
  };
  const inStock = (k: L) => k.l.qty - (short.get(k.p.id) ?? 0);
  const sum = (s: Shipment[]) => (s.some((x) => x.cost === null) ? null : r2(s.reduce((t, x) => t + (x.cost ?? 0), 0)));
  const knownSum = (s: Shipment[]) => r2(s.reduce((t, x) => t + (x.cost ?? 0), 0));
  const slowest = (s: Shipment[], extra?: string) => {
    const d = s.map((x) => x.days).filter((x) => x && x !== "To confirm");
    return [d.length ? d.sort((a, b) => parseInt(b) - parseInt(a))[0] : "To confirm", extra].filter(Boolean).join(" + ");
  };

  const options: PlanOption[] = [];

  if (input.delivery === "pickup") {
    // Pick up: anything the pickup location doesn't have is moved there first.
    const at = input.pickup_branch ?? "";
    const atB = ctx.branches.find((b) => b.id === at);
    const transfers: Transfer[] = [];
    for (const k of known) {
      let need = inStock(k) - Math.min(inStock(k), free(at, k.p.id));
      if (need <= 0 || !atB) continue;
      for (const b of near(atB)) {
        if (b.id === at || need <= 0) continue;
        const q = Math.min(need, free(b.id, k.p.id));
        if (q > 0) {
          transfers.push({ sku: k.p.sku, name: k.p.name, qty: q, from: b.id, fromName: b.name, to: at, toName: atB.name });
          need -= q;
        }
      }
    }
    const v = vendorShipments();
    options.push({
      key: "pickup",
      title: atB ? `Pick up at ${atB.name}` : "Pick up",
      ok: Boolean(atB),
      why: atB ? undefined : "No pickup location picked.",
      shipments: [{ from: at, fromName: atB?.name ?? at, kind: "pickup", lines: known.map((k) => ({ sku: k.p.sku, name: k.p.name, qty: inStock(k) })).filter((x) => x.qty > 0), weight: totalWeight, miles: 0, cost: 0, days: transfers.length ? "After the transfer arrives (4-7 business days)" : "Ready when we confirm" }, ...v],
      transfers,
      total: 0,
      days: transfers.length ? "4-7 business days (transfer first)" : "Ready when we confirm",
    });
  } else if (dest && known.length) {
    const stocked = known.filter((k) => inStock(k) > 0);
    const v = vendorShipments();

    // 1. Everything from one location.
    let bestOne: PlanOption | null = null;
    for (const b of ctx.branches) {
      if (!stocked.every((k) => free(b.id, k.p.id) >= inStock(k))) continue;
      const s = stocked.length ? [ship(b, stocked.map((k) => ({ k, qty: inStock(k) })))] : [];
      const o: PlanOption = { key: "one", title: `Ship everything from ${b.name}`, ok: true, shipments: [...s, ...v], transfers: [], total: sum([...s, ...v]), days: slowest([...s, ...v]) };
      if (!bestOne || knownSum(o.shipments) < knownSum(bestOne.shipments)) bestOne = o;
    }
    options.push(bestOne ?? { key: "one", title: "Ship everything from one location", ok: false, why: "No single location has every item in stock.", shipments: [], transfers: [], total: null, days: "" });

    // 2. The closest stock for each item (may be several shipments).
    const byBranch = new Map<string, { k: L; qty: number }[]>();
    for (const k of stocked) {
      let need = inStock(k);
      for (const b of near(dest)) {
        if (need <= 0) break;
        const q = Math.min(need, free(b.id, k.p.id));
        if (q <= 0) continue;
        if (!byBranch.has(b.id)) byBranch.set(b.id, []);
        byBranch.get(b.id)!.push({ k, qty: q });
        need -= q;
      }
    }
    const onlyFrom = byBranch.size === 1 ? [...byBranch.keys()][0] : null;
    if (byBranch.size > 1 || (onlyFrom && bestOne?.shipments[0]?.from !== onlyFrom)) {
      const s = [...byBranch.entries()].map(([b, list]) => ship(ctx.branches.find((x) => x.id === b)!, list));
      options.push({ key: "split", title: byBranch.size > 1 ? `Ship from ${byBranch.size} locations (closest stock for each item)` : `Ship from ${bname([...byBranch.keys()][0])} (closest stock)`, ok: true, shipments: [...s, ...v], transfers: [], total: sum([...s, ...v]), days: slowest([...s, ...v]) });
    }

    // 3. Move stock to the closest location first, then ship once.
    const hub = near(dest)[0];
    if (hub && stocked.length) {
      const transfers: Transfer[] = [];
      let possible = true;
      for (const k of stocked) {
        let need = inStock(k) - Math.min(inStock(k), free(hub.id, k.p.id));
        for (const b of near(hub)) {
          if (need <= 0) break;
          if (b.id === hub.id) continue;
          const q = Math.min(need, free(b.id, k.p.id));
          if (q > 0) {
            transfers.push({ sku: k.p.sku, name: k.p.name, qty: q, from: b.id, fromName: b.name, to: hub.id, toName: hub.name });
            need -= q;
          }
        }
        if (need > 0) possible = false;
      }
      if (possible && transfers.length) {
        const s = [ship(hub, stocked.map((k) => ({ k, qty: inStock(k) })))];
        // The transfers cost us real freight (no regular route between locations): price each leg like a shipment.
        let transferCost = 0;
        const legs = new Map<string, number>();
        for (const t of transfers) {
          const k = stocked.find((x) => x.p.sku === t.sku);
          legs.set(t.from, (legs.get(t.from) ?? 0) + (k ? k.each * t.qty : 0));
        }
        for (const [from, lb] of legs) {
          const b = ctx.branches.find((x) => x.id === from)!;
          const mi = roadMiles(b, hub);
          const big = lb > 8000 || stocked.some((k) => k.mode === "truckload" && transfers.some((t) => t.sku === k.p.sku && t.from === from));
          const c = big ? truckCost(mi, Math.ceil(lb / 42000)) : lb > 150 ? ltlCost(lb, mi, { site: "business", unload: "dock" }) : parcelCost(lb, mi, { site: "business", unload: "dock" });
          transferCost += c.cost + 60;
        }
        options.push({ key: "gather", title: `Move stock to ${hub.name} first, then ship once`, ok: true, shipments: [...s, ...v], transfers, transferCost: r2(transferCost), total: sum([...s, ...v]), days: slowest([...s, ...v], "4-7 days for the transfer") });
      }
    }
    if (!stocked.length && v.length) {
      options.push({ key: "split", title: "Vendor ships everything", ok: true, shipments: v, transfers: [], total: sum(v), days: slowest(v) });
    }
  }

  // Best: the lowest total cost to us. A transfer between locations (only when needed, no regular route) counts what
  // that freight would cost plus about $60 of handling; each extra shipment about $15.
  const ok = options.filter((o) => o.ok);
  const score = (o: PlanOption) => knownSum(o.shipments) + (o.transferCost ?? (o.transfers.length ? 150 : 0)) + Math.max(0, o.shipments.length - 1) * 15;
  ok.sort((a, b) => score(a) - score(b));
  const best = ok[0] ?? null;
  const partial = unknown.length > 0 || Boolean(best && best.shipments.some((s) => s.cost === null));
  const estimate = input.delivery === "pickup" ? 0 : best ? up5(knownSum(best.shipments)) : null;

  if (input.delivery !== "pickup" && !dest) notes.push("No good US ZIP code to estimate shipping from.");
  if (estWeights.length) notes.push(`Weights are estimated for ${estWeights.join(", ")} (no weight on the spreadsheet or the product).`);
  if (unknown.length) notes.push(`Not in the catalog, priced and shipped by hand: ${unknown.join(", ")}.`);
  if (input.site.site === "home") notes.push("Home delivery: carriers add a residential fee (included).");
  if (input.site.unload === "liftgate") notes.push("No dock or forklift: liftgate truck needed (included).");

  return {
    at: new Date().toISOString(),
    dest: dest ? { zip: input.zip.replace(/\D/g, "").slice(0, 5), state: dest.state } : null,
    delivery: input.delivery,
    site: input.site,
    weight: totalWeight,
    estWeights,
    vendor,
    unknown,
    options,
    best: best?.key ?? null,
    estimate,
    partial,
    notes,
    nearest: dest && ctx.branches.length ? (() => { const b = near(dest)[0]; return { id: b.id, name: b.name, miles: roadMiles(b, dest) }; })() : null,
  };
}

// ---------------------------------------------------------------- customers

const SUFFIX = /\b(llc|l\.l\.c|inc|incorporated|co|corp|corporation|company|ltd|the|and|of|pllc|lp)\b/g;
export const normName = (s: string) =>
  s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "").slice(-10);

export type Co = {
  id: string; name: string; account_no: string | null; phone: string | null; email: string | null; credit_status: string | null;
  credit_limit: number | null; ar_balance: number | null; pay_cod: boolean | null; terms: string | null; active: boolean;
};

/** Customers whose name is close to what they typed (shares its main words). */
async function nameCandidates(db: SupabaseClient, company: string): Promise<Co[]> {
  const words = normName(company).split(" ").filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
  if (!words.length) return [];
  const { data } = await db
    .from("companies")
    .select("id, name, account_no, phone, email, credit_status, credit_limit, ar_balance, pay_cod, terms, active")
    .ilike("name", `%${words[0]}%`)
    .limit(60);
  const want = new Set(normName(company).split(" ").filter((w) => w.length >= 3));
  return ((data ?? []) as Co[]).filter((c) => {
    const have = normName(c.name).split(" ").filter((w) => w.length >= 3);
    const hit = have.filter((w) => want.has(w)).length;
    return hit >= Math.min(2, want.size) || normName(c.name) === normName(company);
  });
}

/**
 * A shopper who says they're an AMBIT customer, matched by business name only (most customers don't know their
 * account #, so staff double-check every one). The exact name wins; otherwise the one closest name if it's clear.
 * Returns the match and any other close names for staff to look at.
 */
export async function matchCustomerByName(db: SupabaseClient, company: string): Promise<{ co: Co | null; others: Co[] }> {
  const list = (await nameCandidates(db, company)).filter((x) => x.active);
  if (!list.length) return { co: null, others: [] };
  const want = normName(company);
  const exact = list.find((x) => normName(x.name) === want);
  if (exact) return { co: exact, others: list.filter((x) => x.id !== exact.id).slice(0, 3) };
  if (list.length === 1) return { co: list[0], others: [] };
  // Several close names: the one sharing the most words, if it clearly leads.
  const words = new Set(want.split(" ").filter((w) => w.length >= 3));
  const score = (x: Co) => normName(x.name).split(" ").filter((w) => words.has(w)).length - Math.abs(normName(x.name).split(" ").length - words.size) * 0.1;
  const ranked = [...list].sort((a, b) => score(b) - score(a));
  if (score(ranked[0]) - score(ranked[1]) >= 1) return { co: ranked[0], others: ranked.slice(1, 4) };
  return { co: null, others: ranked.slice(0, 4) };
}

/** A new shopper who's already in A.I. (same email or phone, or the same name): so they aren't added twice. */
export async function findExisting(db: SupabaseClient, company: string, email: string, phone: string): Promise<{ co: Co; strong: boolean } | null> {
  const sel = "id, name, account_no, phone, email, credit_status, credit_limit, ar_balance, pay_cod, terms, active";
  const e = email.trim().toLowerCase();
  if (e) {
    const { data } = await db.from("companies").select(sel).ilike("email", e).limit(1);
    const hit = ((data ?? []) as Co[])[0];
    if (hit) return { co: hit, strong: true };
  }
  const d = digits(phone);
  const list = await nameCandidates(db, company);
  const byPhone = d.length === 10 ? list.find((x) => digits(x.phone) === d) : undefined;
  if (byPhone) return { co: byPhone, strong: true };
  const same = list.find((x) => normName(x.name) === normName(company));
  return same ? { co: same, strong: false } : null;
}

/** The location closest to a ZIP code (a new customer's home location). */
export async function nearestBranch(db: SupabaseClient, zip: string): Promise<string | null> {
  const pt = zipPoint(zip);
  if (!pt) return null;
  const ctx = await loadCtx(db, []);
  return [...ctx.branches].sort((a, b) => roadMiles(a, pt) - roadMiles(b, pt))[0]?.id ?? null;
}
