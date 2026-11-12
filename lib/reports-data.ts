import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { every } from "@/lib/inventory/pages";
import { addDays, centralStart, STAGES, stageOf } from "@/lib/order-desk";
import { money, orderNo } from "@/lib/format";
import { saleOn } from "@/lib/sale";
import { goalBoard } from "@/lib/sales-goals-server";
import { sum as sumGoals } from "@/lib/sales-goals";
import { prRef, PR_STATUS } from "@/lib/price-requests";
import { reorderRef } from "@/lib/inventory/reorder";
import { paperwork, readFiles } from "@/lib/report-files";
import { computeTaxState, type CertRow } from "@/lib/tax";
import { splitOf } from "@/lib/expense-kinds";
import { COMPLAINT_STATUS } from "@/lib/complaints";
import type { Profile } from "@/lib/types";

// The data behind each report in the Reports section (lib/reports.ts lists them). Each builder returns a table for
// ReportTable (search, filters, sort, download), a few numbers for the top, and a link per row where there's a page
// to open. Everything is read as the signed-in person, so the database's own rules still apply.

export type Cell = string | number | null;
export type Stat = { t: string; tone?: "ok" | "warn" | "grey" | "" };
export type ReportOut = {
  head: string[];
  num: boolean[];
  money?: boolean[];
  rows: Cell[][];
  flag?: (boolean | "err")[];
  total?: Cell[];
  stats?: Stat[];
  note?: string;
  /** A page to open for each row (the order, the report...), shown on the column `linkCol`. */
  links?: (string | null)[];
  linkCol?: number;
  /** Asked for before anything shows (pick a customer, type a lot #). */
  prompt?: string;
  cents?: boolean;
};

export type Ctx = {
  db: SupabaseClient;
  p: Profile;
  today: string;
  from: string | null;
  to: string | null;
  /** A location picked with the chips (or a warehouse manager's own). */
  branch: string | null;
  /** Sales reps: only their own customers' orders. */
  rep: string | null;
  sp: Record<string, string | undefined>;
};

// ------------------------------------------------------------------ helpers
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
/** A timestamp as its Central-time day, "YYYY-MM-DD" (the tables show it as 11/12/26). */
export const dayOf = (ts: string | null | undefined) => (ts ? DAY_FMT.format(new Date(ts)) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const pct = (x: number) => Math.round(x * 1000) / 10; // 0.1234 → 12.3
const T = (v: boolean[]) => v;

async function names(db: SupabaseClient) {
  const [{ data: people }, { data: branches }] = await Promise.all([
    db.from("profiles").select("id, full_name, email"),
    db.from("branches").select("id, name, sort").order("sort"),
  ]);
  const person = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((x) => [x.id, x.full_name || x.email]));
  const branch = new Map(((branches ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  return { person, branch };
}
const repName = (o: { sales_rep_id: string | null; house_account?: boolean | null }, person: Map<string, string>) =>
  o.sales_rep_id ? person.get(o.sales_rep_id) ?? "Unknown rep" : o.house_account ? "House account" : "No rep";

type SaleLine = { product_id: string | null; sku: string; name: string; unit: string; qty: number; unit_price: number | null; line_total: number | null; customer_priced: boolean; added_by_customer?: boolean };
type SaleOrder = {
  id: string;
  order_no: number;
  company_id: string | null;
  company_name: string;
  branch_id: string | null;
  sales_rep_id: string | null;
  house_account: boolean | null;
  created_at: string;
  kind?: string | null;
  order_items: SaleLine[];
};

/**
 * Orders that count as sales between two days (the same rules as Sales goals): not cancelled, not a return, on the
 * day they were placed, at the invoice prices entered so far (a line still waiting for its price counts $0).
 */
async function salesOrders(c: Ctx, from: string | null, to: string | null, opts: { branch?: string | null } = {}): Promise<SaleOrder[]> {
  const branch = opts.branch === undefined ? c.branch : opts.branch;
  const rows = await every<SaleOrder>(
    (a, z) => {
      let q = c.db
        .from("orders")
        .select("id, order_no, company_id, company_name, branch_id, sales_rep_id, house_account, created_at, kind, order_items(product_id, sku, name, unit, qty, unit_price, line_total, customer_priced, added_by_customer)")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .order("order_no", { ascending: false })
        .range(a, z);
      if (from) q = q.gte("created_at", centralStart(from));
      if (to) q = q.lt("created_at", centralStart(addDays(to, 1)));
      if (branch) q = q.eq("branch_id", branch);
      if (c.rep) q = q.eq("sales_rep_id", c.rep);
      return q;
    },
    30_000,
  );
  return rows.filter((o) => o.kind !== "return" && (o.order_items ?? []).length);
}
const orderTotal = (o: SaleOrder) => r2((o.order_items ?? []).reduce((s, l) => s + (l.line_total == null ? 0 : Number(l.line_total)), 0));
const waitingPrice = (o: SaleOrder) => (o.order_items ?? []).some((l) => l.line_total == null);

/** The same length of time just before [from, to] (for "compared with the period before"). */
function before(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to) return null;
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

// ------------------------------------------------------------------ Sales & pricing
async function salesByRep(c: Ctx): Promise<ReportOut> {
  const [orders, nm] = await Promise.all([salesOrders(c, c.from, c.to), names(c.db)]);
  type Acc = { id: string; name: string; orders: number; customers: Set<string>; sales: number; waiting: number; top: Map<string, number> };
  const by = new Map<string, Acc>();
  for (const o of orders) {
    const key = o.sales_rep_id ?? (o.house_account ? "house" : "none");
    const a = by.get(key) ?? { id: key, name: repName(o, nm.person), orders: 0, customers: new Set(), sales: 0, waiting: 0, top: new Map() };
    const t = orderTotal(o);
    a.orders++;
    a.customers.add(o.company_id ?? o.company_name);
    a.sales += t;
    if (waitingPrice(o)) a.waiting++;
    a.top.set(o.company_name, (a.top.get(o.company_name) ?? 0) + t);
    by.set(key, a);
  }
  // Monthly goals when the range is one calendar month (the goal board is by month).
  let goals: Map<string, number> | null = null;
  const oneMonth = Boolean(c.from && c.to && c.from.slice(0, 7) === c.to.slice(0, 7) && c.from.endsWith("-01"));
  if (oneMonth) {
    const board = await goalBoard(c.db, c.from!.slice(0, 7) + "-01");
    if (board) goals = new Map(board.people.map((x) => [x.id, sumGoals(x.goals)]));
  }
  const list = [...by.values()].sort((a, b) => b.sales - a.sales);
  if (goals && !list.some((a) => (goals!.get(a.id) ?? 0) > 0)) goals = null; // nobody here has a goal this month
  const rows: Cell[][] = list.map((a) => {
    const goal = goals?.get(a.id) ?? null;
    const top = [...a.top.entries()].sort((x, y) => y[1] - x[1])[0];
    return [a.name, a.orders, a.customers.size, r2(a.sales), a.orders ? r2(a.sales / a.orders) : null, ...(goals ? [goal || null, goal ? pct(a.sales / goal) : null] : []), a.waiting, top ? top[0] : ""];
  });
  const total = list.reduce((s, a) => s + a.sales, 0);
  return {
    head: ["Rep", "Orders", "Customers", "Sales", "Average order", ...(goals ? ["Monthly goal", "% of goal"] : []), "Orders waiting on prices", "Top customer"],
    num: T([false, true, true, true, true, ...(goals ? [true, true] : []), true, false]),
    money: T([false, false, false, true, true, ...(goals ? [true, false] : []), false, false]),
    rows,
    flag: list.map((a) => (goals ? (goals.get(a.id) ?? 0) > 0 && a.sales < (goals.get(a.id) ?? 0) * 0.5 : false)),
    total: ["Total", list.reduce((s, a) => s + a.orders, 0), null, r2(total), null, ...(goals ? [null, null] : []), list.reduce((s, a) => s + a.waiting, 0), ""],
    stats: [{ t: `${money(total)} in sales` }, { t: `${orders.length} orders`, tone: "grey" }],
    note: `Sales count the day an order was placed, at the invoice prices entered so far (lines still waiting for a price count $0). Cancelled orders and returns don't count.${goals ? " Goals are each person's monthly goals from Sales goals; highlighted reps are under half their goal." : oneMonth ? " No monthly goals are set for these reps this month (Sales goals)." : " Pick a single month (This month, Last month) to see goals."}`,
  };
}

async function stoppedOrdering(c: Ctx): Promise<ReportOut> {
  const days = [60, 90, 180].includes(Number(c.sp.d)) ? Number(c.sp.d) : 90;
  const since = addDays(c.today, -(365 + days));
  const [orders, nm] = await Promise.all([salesOrders(c, since, null), names(c.db)]);
  type Acc = { name: string; rep: string; last: string; orders: number; sales: number; branch: string | null; items: Map<string, number>; id: string | null };
  const by = new Map<string, Acc>();
  const yearAgo = addDays(c.today, -365);
  for (const o of orders) {
    const key = o.company_id ?? `name:${o.company_name}`;
    const day = dayOf(o.created_at)!;
    const a = by.get(key) ?? { id: o.company_id, name: o.company_name, rep: repName(o, nm.person), last: day, orders: 0, sales: 0, branch: o.branch_id, items: new Map() };
    if (day > a.last) a.last = day;
    if (day >= yearAgo) {
      a.orders++;
      a.sales += orderTotal(o);
      for (const l of o.order_items) a.items.set(l.sku, (a.items.get(l.sku) ?? 0) + Number(l.qty));
    }
    by.set(key, a);
  }
  const cutoff = addDays(c.today, -days);
  const list = [...by.values()].filter((a) => a.last < cutoff && a.orders > 0).sort((a, b) => b.sales - a.sales);
  return {
    head: ["Customer", "Rep", "Location", "Last order", "Days since", "Orders (last 12 months)", "Sales (last 12 months)", "Usually buys"],
    num: T([false, false, false, false, true, true, true, false]),
    money: T([false, false, false, false, false, false, true, false]),
    rows: list.map((a) => [
      a.name,
      a.rep,
      a.branch ? nm.branch.get(a.branch) ?? a.branch : "",
      a.last,
      daysBetween(a.last, c.today),
      a.orders,
      r2(a.sales),
      [...a.items.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([s]) => s).join(", "),
    ]),
    flag: list.map((a) => daysBetween(a.last, c.today) > 180),
    links: list.map((a) => (a.id ? `/credit/${a.id}` : null)),
    linkCol: 0,
    stats: [{ t: `${list.length} customers with no order in ${days}+ days`, tone: list.length ? "warn" : "ok" }, { t: `${money(list.reduce((s, a) => s + a.sales, 0))} they bought in the last 12 months`, tone: "grey" }],
    note: `Customers who ordered in the last 12 months but not in the last ${days} days, the biggest first. Highlighted: over 180 days.`,
  };
}

async function salesByCustomer(c: Ctx): Promise<ReportOut> {
  const prev = before(c.from, c.to);
  const [orders, old, nm] = await Promise.all([salesOrders(c, c.from, c.to), prev ? salesOrders(c, prev.from, prev.to) : Promise.resolve([] as SaleOrder[]), names(c.db)]);
  type Acc = { id: string | null; name: string; rep: string; orders: number; sales: number; last: string; waiting: number };
  const by = new Map<string, Acc>();
  for (const o of orders) {
    const key = o.company_id ?? `name:${o.company_name}`;
    const a = by.get(key) ?? { id: o.company_id, name: o.company_name, rep: repName(o, nm.person), orders: 0, sales: 0, last: dayOf(o.created_at)!, waiting: 0 };
    a.orders++;
    a.sales += orderTotal(o);
    if (waitingPrice(o)) a.waiting++;
    const d = dayOf(o.created_at)!;
    if (d > a.last) a.last = d;
    by.set(key, a);
  }
  const was = new Map<string, number>();
  for (const o of old) {
    const key = o.company_id ?? `name:${o.company_name}`;
    was.set(key, (was.get(key) ?? 0) + orderTotal(o));
  }
  const keys = [...by.keys()].sort((a, b) => by.get(b)!.sales - by.get(a)!.sales);
  const total = keys.reduce((s, k) => s + by.get(k)!.sales, 0);
  return {
    head: ["Customer", "Rep", "Orders", "Sales", "Average order", "Last order", ...(prev ? ["Period before", "Change"] : []), "Orders waiting on prices"],
    num: T([false, false, true, true, true, false, ...(prev ? [true, false] : []), true]),
    money: T([false, false, false, true, true, false, ...(prev ? [true, false] : []), false]),
    rows: keys.map((k) => {
      const a = by.get(k)!;
      const w = was.get(k) ?? 0;
      const ch = prev ? (w > 0 ? `${a.sales >= w ? "+" : ""}${pct((a.sales - w) / w)}%` : "New") : null;
      return [a.name, a.rep, a.orders, r2(a.sales), r2(a.sales / a.orders), a.last, ...(prev ? [r2(w), ch] : []), a.waiting];
    }),
    flag: keys.map((k) => prev !== null && (was.get(k) ?? 0) > 0 && by.get(k)!.sales < (was.get(k) ?? 0) * 0.5),
    links: keys.map((k) => (by.get(k)!.id ? `/credit/${by.get(k)!.id}` : null)),
    linkCol: 0,
    total: ["Total", "", keys.reduce((s, k) => s + by.get(k)!.orders, 0), r2(total), null, "", ...(prev ? [r2([...was.values()].reduce((s, v) => s + v, 0)), ""] : []), null],
    stats: [{ t: `${keys.length} customers` }, { t: `${money(total)} in sales`, tone: "grey" }],
    note: prev ? `"Period before" is the same number of days just before (${prev.from} to ${prev.to}). Highlighted: down by more than half.` : undefined,
  };
}

async function salesByProduct(c: Ctx): Promise<ReportOut> {
  const [orders, { data: prods }, { data: cats }] = await Promise.all([
    salesOrders(c, c.from, c.to),
    c.db.from("products").select("id, category_id"),
    c.db.from("categories").select("id, name"),
  ]);
  const catOf = new Map(((prods ?? []) as { id: string; category_id: string | null }[]).map((p) => [p.id, p.category_id]));
  const catName = new Map(((cats ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  type Acc = { sku: string; name: string; unit: string; group: string; units: number; sales: number; pricedUnits: number; orders: Set<string>; customers: Set<string> };
  const by = new Map<string, Acc>();
  for (const o of orders) {
    for (const l of o.order_items) {
      const key = (l.product_id ?? l.sku).toUpperCase();
      const a = by.get(key) ?? { sku: l.sku, name: l.name, unit: l.unit, group: catName.get(catOf.get(l.product_id ?? "") ?? "") ?? "Other", units: 0, sales: 0, pricedUnits: 0, orders: new Set(), customers: new Set() };
      a.units += Number(l.qty);
      if (l.line_total != null) {
        a.sales += Number(l.line_total);
        a.pricedUnits += Number(l.qty);
      }
      a.orders.add(o.id);
      a.customers.add(o.company_id ?? o.company_name);
      by.set(key, a);
    }
  }
  const list = [...by.values()].sort((a, b) => b.sales - a.sales || b.units - a.units);
  const total = list.reduce((s, a) => s + a.sales, 0);
  return {
    head: ["Group", "SKU", "Item", "Unit", "Units sold", "Sales", "Average price", "Orders", "Customers"],
    num: T([false, false, false, false, true, true, true, true, true]),
    money: T([false, false, false, false, false, true, true, false, false]),
    rows: list.map((a) => [a.group, a.sku, a.name, a.unit, r2(a.units), r2(a.sales), a.pricedUnits ? r2(a.sales / a.pricedUnits) : null, a.orders.size, a.customers.size]),
    total: ["Total", "", "", "", null, r2(total), null, null, null],
    stats: [{ t: `${list.length} SKUs sold` }, { t: `${money(total)} in sales`, tone: "grey" }],
    note: "Average price is sales ÷ the units that have their invoice price.",
  };
}

async function salesByLocation(c: Ctx): Promise<ReportOut> {
  const [orders, nm] = await Promise.all([salesOrders(c, c.from, c.to, { branch: null }), names(c.db)]);
  const months = new Map<string, Map<string, number>>();
  const used = new Set<string>();
  for (const o of orders) {
    const m = dayOf(o.created_at)!.slice(0, 7);
    const b = o.branch_id ?? "none";
    used.add(b);
    const row = months.get(m) ?? new Map();
    row.set(b, (row.get(b) ?? 0) + orderTotal(o));
    months.set(m, row);
  }
  const cols = [...nm.branch.keys()].filter((b) => used.has(b)).concat(used.has("none") ? ["none"] : []);
  const label = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const keys = [...months.keys()].sort().reverse();
  const rows = keys.map((m) => {
    const row = months.get(m)!;
    const vals = cols.map((b) => r2(row.get(b) ?? 0));
    return [label(m), ...vals, r2(vals.reduce((s, v) => s + v, 0))] as Cell[];
  });
  const totals = cols.map((b) => r2(keys.reduce((s, m) => s + (months.get(m)!.get(b) ?? 0), 0)));
  return {
    head: ["Month", ...cols.map((b) => (b === "none" ? "No location" : nm.branch.get(b) ?? b)), "All locations"],
    num: [false, ...cols.map(() => true), true],
    money: [false, ...cols.map(() => true), true],
    rows,
    total: ["Total", ...totals, r2(totals.reduce((s, v) => s + v, 0))],
    stats: [{ t: `${money(totals.reduce((s, v) => s + v, 0))} in sales` }],
    note: "By the month each order was placed (Central time).",
  };
}

async function discounts(c: Ctx): Promise<ReportOut> {
  const [orders, { data: prods }, { data: floors }, nm] = await Promise.all([
    salesOrders(c, c.from, c.to),
    c.db.from("products").select("id, list_price, sale_price, sale_ends"),
    c.db.from("price_floors").select("product_id, floor"),
    names(c.db),
  ]);
  const prod = new Map(((prods ?? []) as { id: string; list_price: number | null; sale_price: number | null; sale_ends: string | null }[]).map((p) => [p.id, p]));
  const floor = new Map(((floors ?? []) as { product_id: string; floor: number }[]).map((f) => [f.product_id, Number(f.floor)]));
  const rows: Cell[][] = [];
  const flag: (boolean | "err")[] = [];
  const links: string[] = [];
  let given = 0;
  for (const o of orders) {
    for (const l of o.order_items) {
      if (l.unit_price == null || !l.product_id) continue;
      const p = prod.get(l.product_id);
      const list = p && p.list_price != null && Number(p.list_price) > 0 ? Number(p.list_price) : null;
      const f = floor.get(l.product_id) ?? null;
      const price = Number(l.unit_price);
      const underList = list !== null && price < list - 0.005;
      const underFloor = f !== null && price < f - 0.005;
      if (!underList && !underFloor) continue;
      if (list !== null && underList) given += (list - price) * Number(l.qty);
      rows.push([
        dayOf(o.created_at),
        orderNo(o.order_no),
        o.company_name,
        repName(o, nm.person),
        l.sku,
        l.name,
        Number(l.qty),
        price,
        list,
        list !== null ? pct((list - price) / list) : null,
        f,
        underFloor ? "Below floor" : "",
        list !== null ? r2((list - price) * Number(l.qty)) : null,
      ]);
      flag.push(underFloor ? "err" : false);
      links.push(`/orders/${o.id}`);
    }
  }
  return {
    head: ["Date", "Order", "Customer", "Rep", "SKU", "Item", "Qty", "Sold at", "List price", "% off list", "Floor price", "Floor", "Discount given"],
    num: T([false, false, false, false, false, false, true, true, true, true, true, false, true]),
    money: T([false, false, false, false, false, false, false, true, true, false, true, false, true]),
    rows,
    flag,
    links,
    linkCol: 1,
    cents: true,
    total: ["Total", "", "", "", "", "", null, null, null, null, null, "", r2(given)],
    stats: [{ t: `${rows.length} discounted lines` }, { t: `${flag.filter((x) => x === "err").length} below the floor price`, tone: flag.some((x) => x === "err") ? "warn" : "ok" }, { t: `${money(given)} off list`, tone: "grey" }],
    note: "Compared with today's list price and floor price (Price requests › Rules). Lines priced per customer only show when the item has a list price or a floor. Red: below the floor.",
  };
}

async function priceRequestLog(c: Ctx): Promise<ReportOut> {
  const all = c.p.role === "admin" || ["prf_approve", "order_desk", "credit_check"].some((k) => (c.p.perms ?? []).includes(k));
  let q = c.db
    .from("price_requests")
    .select("id, created_by, rep_name, company_name, status, decided_by_name, decided_at, decision_note, valid_until, created_at, lines:price_request_lines(sku, list_price, requested_price, approved_price, status, auto)")
    .order("created_at", { ascending: false })
    .limit(3000);
  if (c.from) q = q.gte("created_at", centralStart(c.from));
  if (c.to) q = q.lt("created_at", centralStart(addDays(c.to, 1)));
  if (!all) q = q.eq("created_by", c.p.id);
  const { data, error } = await q;
  if (error) return { head: ["Note"], num: [false], rows: [[/price_requests/.test(error.message) ? "Price requests need the 0066 database update." : error.message]] };
  type L = { sku: string; list_price: number | null; requested_price: number | null; approved_price: number | null; status: string; auto: boolean | null };
  type R = { id: number; rep_name: string | null; company_name: string; status: keyof typeof PR_STATUS; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; valid_until: string | null; created_at: string; lines: L[] };
  const list = (data ?? []) as R[];
  const offOf = (l: L) => (l.list_price && l.requested_price != null ? (Number(l.list_price) - Number(l.requested_price)) / Number(l.list_price) : null);
  return {
    head: ["Date", "Request", "Customer", "Rep", "Status", "Lines", "Auto-approved", "Average % off list", "Items", "Decided by", "Decided", "Good through", "Note"],
    num: T([false, false, false, false, false, true, true, true, false, false, false, false, false]),
    rows: list.map((r) => {
      const offs = r.lines.map(offOf).filter((x): x is number => x !== null);
      return [
        dayOf(r.created_at),
        prRef(r.id),
        r.company_name,
        r.rep_name ?? "",
        PR_STATUS[r.status]?.label ?? r.status,
        r.lines.length,
        r.lines.filter((l) => l.auto).length,
        offs.length ? pct(offs.reduce((s, x) => s + x, 0) / offs.length) : null,
        r.lines.map((l) => `${l.sku} @ ${l.requested_price != null ? money(Number(l.requested_price)) : "?"}${l.status === "approved" ? " ✓" : l.status === "denied" ? " ✗" : ""}`).join(", "),
        r.decided_by_name ?? (r.lines.length && r.lines.every((l) => l.auto) ? "Automatic" : ""),
        dayOf(r.decided_at),
        r.valid_until,
        r.decision_note ?? "",
      ];
    }),
    flag: list.map((r) => r.status === "pending"),
    links: list.map((r) => `/price-requests/n/${r.id}`),
    linkCol: 1,
    stats: [
      { t: `${list.length} requests` },
      { t: `${list.filter((r) => r.status === "approved" || r.status === "partly").length} approved`, tone: "ok" },
      { t: `${list.filter((r) => r.status === "pending").length} waiting`, tone: list.some((r) => r.status === "pending") ? "warn" : "grey" },
    ],
    note: `${all ? "" : "Your own requests. "}Price requests made in the app (older Jotform requests stay in Jotform). Highlighted: still waiting.`,
  };
}

async function addons(c: Ctx): Promise<ReportOut> {
  const [orders, nm] = await Promise.all([salesOrders(c, c.from, c.to), names(c.db)]);
  const rows: Cell[][] = [];
  const links: string[] = [];
  const withAdd = new Set<string>();
  let total = 0;
  for (const o of orders) {
    for (const l of o.order_items) {
      if (!l.added_by_customer) continue;
      withAdd.add(o.id);
      total += l.line_total == null ? 0 : Number(l.line_total);
      rows.push([dayOf(o.created_at), orderNo(o.order_no), o.company_name, repName(o, nm.person), l.sku, l.name, Number(l.qty), n(l.unit_price), n(l.line_total)]);
      links.push(`/orders/${o.id}`);
    }
  }
  return {
    head: ["Date", "Order", "Customer", "Rep", "SKU", "Item", "Qty", "Price", "Line total"],
    num: T([false, false, false, false, false, false, true, true, true]),
    money: T([false, false, false, false, false, false, false, true, true]),
    rows,
    links,
    linkCol: 1,
    total: ["Total", "", "", "", "", "", null, null, r2(total)],
    stats: [{ t: `${rows.length} items added` }, { t: `${withAdd.size} orders`, tone: "grey" }, { t: `${money(total)} added`, tone: "ok" }],
    note: "Items the customer added from the order approval email (\"Need anything else?\").",
  };
}

async function priceSheet(c: Ctx): Promise<ReportOut> {
  const company = c.sp.c && /^[0-9a-f-]{36}$/i.test(c.sp.c) ? c.sp.c : null;
  if (!company) return { head: [], num: [], rows: [], prompt: "Pick a customer to see their prices." };
  const since = addDays(c.today, -365);
  const [{ data: co }, prRes, ordRes, { data: prods }, { data: cats }] = await Promise.all([
    c.db.from("companies").select("id, name, account_no").eq("id", company).maybeSingle(),
    c.db
      .from("price_requests")
      .select("id, valid_until, decided_at, created_at, lines:price_request_lines(product_id, sku, name, unit, approved_price, status)")
      .eq("company_id", company)
      .in("status", ["approved", "partly"])
      .order("created_at", { ascending: false })
      .limit(200),
    c.db
      .from("orders")
      .select("id, order_no, created_at, kind, order_items(product_id, sku, name, unit, qty, unit_price)")
      .eq("company_id", company)
      .neq("status", "cancelled")
      .gte("created_at", centralStart(since))
      .order("created_at", { ascending: false })
      .limit(1000),
    c.db.from("products").select("id, sku, name, unit, list_price, sale_price, sale_ends, customer_priced, category_id, active"),
    c.db.from("categories").select("id, name, customer_priced, sort").order("sort"),
  ]);
  if (!co) return { head: [], num: [], rows: [], prompt: "That customer wasn't found. Pick another." };
  type P = { id: string; sku: string; name: string; unit: string; list_price: number | null; sale_price: number | null; sale_ends: string | null; customer_priced: boolean | null; category_id: string | null; active: boolean };
  const prod = new Map(((prods ?? []) as P[]).map((p) => [p.id, p]));
  const catList = (cats ?? []) as { id: string; name: string; customer_priced: boolean }[];
  const cat = new Map(catList.map((x) => [x.id, x]));
  const rank = new Map(catList.map((x, i) => [x.id, i]));
  type Row = { pid: string; sku: string; name: string; unit: string; approved: number | null; approvedRef: string | null; through: string | null; last: number | null; lastDay: string | null; lastOrder: string | null; lastId: string | null; qty12: number; orders12: number };
  const rows = new Map<string, Row>();
  const get = (pid: string, sku: string, name: string, unit: string) => {
    const r = rows.get(pid) ?? { pid, sku, name, unit, approved: null, approvedRef: null, through: null, last: null, lastDay: null, lastOrder: null, lastId: null, qty12: 0, orders12: 0 };
    rows.set(pid, r);
    return r;
  };
  type PR = { id: number; valid_until: string | null; lines: { product_id: string | null; sku: string; name: string; unit: string; approved_price: number | null; status: string }[] };
  for (const r of (prRes.data ?? []) as PR[]) {
    if (r.valid_until && r.valid_until < c.today) continue;
    for (const l of r.lines) {
      if (l.status !== "approved" || l.approved_price == null || !l.product_id) continue;
      const x = get(l.product_id, l.sku, l.name, l.unit);
      if (x.approved === null) {
        x.approved = Number(l.approved_price);
        x.approvedRef = prRef(r.id);
        x.through = r.valid_until;
      }
    }
  }
  type O = { id: string; order_no: number; created_at: string; kind: string | null; order_items: { product_id: string | null; sku: string; name: string; unit: string; qty: number; unit_price: number | null }[] };
  for (const o of (ordRes.data ?? []) as O[]) {
    if (o.kind === "return") continue;
    const seen = new Set<string>();
    for (const l of o.order_items) {
      if (!l.product_id) continue;
      const x = get(l.product_id, l.sku, l.name, l.unit);
      x.qty12 += Number(l.qty);
      if (!seen.has(l.product_id)) x.orders12++;
      seen.add(l.product_id);
      if (x.last === null && l.unit_price != null) {
        x.last = Number(l.unit_price);
        x.lastDay = dayOf(o.created_at);
        x.lastOrder = orderNo(o.order_no);
        x.lastId = o.id;
      }
    }
  }
  const list = [...rows.values()].sort((a, b) => {
    const pa = prod.get(a.pid);
    const pb = prod.get(b.pid);
    return (rank.get(pa?.category_id ?? "") ?? 99) - (rank.get(pb?.category_id ?? "") ?? 99) || a.sku.localeCompare(b.sku, undefined, { numeric: true });
  });
  const out: Cell[][] = [];
  const links: (string | null)[] = [];
  for (const r of list) {
    const p = prod.get(r.pid);
    const list$ = p?.list_price != null && Number(p.list_price) > 0 ? Number(p.list_price) : null;
    const sale = p ? saleOn(p.sale_price, p.sale_ends, c.today) : false;
    const cp = !sale && Boolean(p?.customer_priced ?? (p?.category_id ? cat.get(p.category_id)?.customer_priced : false));
    // Their price: an approved price request first, then (account pricing) what they last paid, then the sale or list price.
    const [price, from] =
      r.approved !== null
        ? [r.approved, `Approved price ${r.approvedRef}${r.through ? `, good through ${r.through}` : ""}`]
        : cp && r.last !== null
          ? [r.last, `Account pricing: last invoiced ${r.lastDay} on ${r.lastOrder}`]
          : sale
            ? [Number(p!.sale_price), `On sale${p!.sale_ends ? ` through ${p!.sale_ends}` : ""}`]
            : cp
              ? [null, "Account pricing: no invoiced price yet"]
              : [list$, list$ === null ? "No price set" : "List price"];
    out.push([p ? (p.category_id ? cat.get(p.category_id)?.name ?? "Other" : "Other") : "Other", r.sku, r.name, r.unit, price, from, list$, r.last, r.lastDay, r.qty12 ? r2(r.qty12) : null]);
    links.push(r.lastId ? `/orders/${r.lastId}` : null);
  }
  return {
    head: ["Group", "SKU", "Item", "Unit", "Their price", "Where it comes from", "List price", "Last paid", "Last ordered", "Bought (12 months)"],
    num: T([false, false, false, false, true, false, true, true, false, true]),
    money: T([false, false, false, false, true, false, true, true, false, false]),
    rows: out,
    links,
    linkCol: 8,
    cents: true,
    stats: [
      { t: `${list.filter((r) => r.approved !== null).length} approved prices`, tone: "ok" },
      { t: `${list.length} items`, tone: "grey" },
    ],
    note: "Items with an approved price request (still good) plus everything they've bought in the last 12 months. Their price: an approved price first, then what they last paid for account-priced items (spray foam), then the sale or list price.",
  };
}

// ------------------------------------------------------------------ Orders
type DeskOrder = {
  id: string;
  order_no: number;
  company_name: string;
  branch_id: string | null;
  sales_rep_id: string | null;
  house_account: boolean | null;
  created_at: string;
  status: string;
  stage: string | null;
  approval_status: string | null;
  approval_sent_at: string | null;
  approved_at: string | null;
  ambit_po: string | null;
  po_at: string | null;
  credit_status: string | null;
  credit_at: string | null;
  scheduled_for: string | null;
  scheduled_at: string | null;
  invoice_update_at: string | null;
  pay_waiting_at: string | null;
  needed_by: string | null;
  delivery_method: string;
  est_subtotal: number | null;
  invoiced_total: number | null;
  completed_at: string | null;
  invoice_no: string | null;
  kind?: string | null;
};
const DESK_COLS =
  "id, order_no, company_name, branch_id, sales_rep_id, house_account, created_at, status, stage, approval_status, approval_sent_at, approved_at, ambit_po, po_at, credit_status, credit_at, scheduled_for, scheduled_at, invoice_update_at, pay_waiting_at, needed_by, delivery_method, est_subtotal, invoiced_total, completed_at, invoice_no, kind";

async function openOrders(c: Ctx): Promise<ReportOut> {
  const [orders, nm] = await Promise.all([
    every<DeskOrder>((a, z) => {
      let q = c.db.from("orders").select(DESK_COLS).not("status", "in", "(completed,cancelled)").order("created_at").range(a, z);
      if (c.branch) q = q.eq("branch_id", c.branch);
      if (c.rep) q = q.eq("sales_rep_id", c.rep);
      return q;
    }),
    names(c.db),
  ]);
  // When it reached the step it's on (best known time).
  const since = (o: DeskOrder, st: string): string =>
    (st === "customer"
      ? o.approval_sent_at
      : st === "needs_po"
        ? o.approved_at
        : st === "invoice_update"
          ? o.invoice_update_at
          : st === "credit"
            ? o.pay_waiting_at ?? o.po_at
            : st === "hold" || st === "schedule"
              ? o.credit_at
              : st === "scheduled"
                ? o.scheduled_at
                : null) ?? o.created_at;
  const list = orders
    .map((o) => ({ o, st: stageOf(o as never) ?? "credit" }))
    .filter(({ st }) => st !== "completed" && st !== "cancelled")
    .map(({ o, st }) => ({ o, st, inStep: daysBetween(dayOf(since(o, st))!, c.today), open: daysBetween(dayOf(o.created_at)!, c.today) }))
    .sort((a, b) => b.inStep - a.inStep);
  const steps = new Map<string, number>();
  for (const x of list) steps.set(x.st, (steps.get(x.st) ?? 0) + 1);
  return {
    head: ["Order", "Customer", "Location", "Rep", "Step", "Days on this step", "Days open", "Needed by", "Placed", "Estimate"],
    num: T([false, false, false, false, false, true, true, false, false, true]),
    money: T([false, false, false, false, false, false, false, false, false, true]),
    rows: list.map(({ o, st, inStep, open }) => [
      orderNo(o.order_no),
      o.company_name,
      o.branch_id ? nm.branch.get(o.branch_id) ?? o.branch_id : "",
      repName(o, nm.person),
      st === "credit" && o.pay_waiting_at ? "Waiting on customer payment" : STAGES[st as keyof typeof STAGES]?.label ?? st,
      inStep,
      open,
      o.needed_by,
      dayOf(o.created_at),
      n(o.invoiced_total) ?? n(o.est_subtotal),
    ]),
    flag: list.map(({ inStep, o }) => (o.needed_by && o.needed_by < c.today ? "err" : inStep >= 3)),
    links: list.map(({ o }) => `/orders/${o.id}`),
    linkCol: 0,
    stats: [{ t: `${list.length} open orders` }, ...[...steps.entries()].sort((a, b) => b[1] - a[1]).map(([st, k]) => ({ t: `${k} ${STAGES[st as keyof typeof STAGES]?.short ?? st}`, tone: "grey" as const }))],
    note: "The longest on their step first. Highlighted: 3+ days on the same step. Red: past the day the customer needed it.",
  };
}

async function shippedLog(c: Ctx): Promise<ReportOut> {
  const [orders, nm] = await Promise.all([
    every<DeskOrder>((a, z) => {
      let q = c.db.from("orders").select(DESK_COLS).eq("status", "completed").order("completed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(a, z);
      // By the day it was completed (older orders without that time: the day they were placed).
      if (c.from || c.to) {
        const lo = c.from ? centralStart(c.from) : null;
        const hi = c.to ? centralStart(addDays(c.to, 1)) : null;
        const w = (col: string) => [lo ? `${col}.gte."${lo}"` : "", hi ? `${col}.lt."${hi}"` : ""].filter(Boolean).join(",");
        q = q.or(`and(${w("completed_at")}),and(completed_at.is.null,${w("created_at")})`);
      }
      if (c.branch) q = q.eq("branch_id", c.branch);
      if (c.rep) q = q.eq("sales_rep_id", c.rep);
      return q;
    }),
    names(c.db),
  ]);
  const picked = orders.filter((o) => o.delivery_method === "pickup").length;
  return {
    head: ["Completed", "Order", "Customer", "Location", "How", "Invoice #", "Rep", "Total"],
    num: T([false, false, false, false, false, false, false, true]),
    money: T([false, false, false, false, false, false, false, true]),
    rows: orders.map((o) => [
      dayOf(o.completed_at ?? o.created_at),
      orderNo(o.order_no),
      o.company_name,
      o.branch_id ? nm.branch.get(o.branch_id) ?? o.branch_id : "",
      o.kind === "return" ? "Return" : o.delivery_method === "pickup" ? "Picked up" : "Shipped out",
      o.invoice_no ?? "",
      repName(o, nm.person),
      n(o.invoiced_total) ?? n(o.est_subtotal),
    ]),
    flag: orders.map((o) => !o.invoice_no),
    links: orders.map((o) => `/orders/${o.id}`),
    linkCol: 1,
    stats: [{ t: `${orders.length} completed` }, { t: `${orders.length - picked} shipped out`, tone: "grey" }, { t: `${picked} picked up`, tone: "grey" }],
    note: "By the day each order was marked Shipped Out or Picked Up. Highlighted: no invoice # yet.",
  };
}

async function returnsLog(c: Ctx): Promise<ReportOut> {
  type R = { id: number; order_id: string; sku: string; name: string; qty: number; lot_no: string | null; exp: string | null; condition: string; line_credit: number | null; received_at: string | null; received_by_name: string | null; inbound_id: number | null; ord: { order_no: number; company_name: string; kind: string | null; return_reason: string | null; created_at: string; branch_id: string | null; sales_rep_id: string | null } | null };
  const [rows0, nm] = await Promise.all([
    every<R>((a, z) => {
      let q = c.db
        .from("order_returns")
        .select("id, order_id, sku, name, qty, lot_no, exp, condition, line_credit, received_at, received_by_name, inbound_id, ord:orders!inner(order_no, company_name, kind, return_reason, created_at, branch_id, sales_rep_id)")
        .order("id", { ascending: false })
        .range(a, z);
      if (c.from) q = q.gte("ord.created_at", centralStart(c.from));
      if (c.to) q = q.lt("ord.created_at", centralStart(addDays(c.to, 1)));
      if (c.branch) q = q.eq("ord.branch_id", c.branch);
      if (c.rep) q = q.eq("ord.sales_rep_id", c.rep);
      return q;
    }),
    names(c.db),
  ]);
  const rows = rows0.filter((r) => r.ord);
  const credit = rows.reduce((s, r) => s + (r.line_credit == null ? 0 : Number(r.line_credit)), 0);
  return {
    head: ["Date", "Order", "Kind", "Customer", "Location", "SKU", "Item", "Qty", "Lot / batch", "Exp", "Condition", "Credit", "Received", "Received by", "Reason"],
    num: T([false, false, false, false, false, false, false, true, false, false, false, true, false, false, false]),
    money: T([false, false, false, false, false, false, false, false, false, false, false, true, false, false, false]),
    rows: rows.map((r) => [
      dayOf(r.ord!.created_at),
      orderNo(r.ord!.order_no),
      r.ord!.kind === "exchange" ? "Exchange" : "Return",
      r.ord!.company_name,
      r.ord!.branch_id ? nm.branch.get(r.ord!.branch_id) ?? "" : "",
      r.sku,
      r.name,
      Number(r.qty),
      r.lot_no ?? "",
      r.exp,
      r.condition === "damaged" ? "Damaged" : "Back in stock",
      n(r.line_credit),
      dayOf(r.received_at),
      r.received_by_name ?? "",
      r.ord!.return_reason ?? "",
    ]),
    flag: rows.map((r) => !r.received_at),
    links: rows.map((r) => `/orders/${r.order_id}`),
    linkCol: 1,
    total: ["Total", "", "", "", "", "", "", null, "", "", "", r2(credit), "", "", ""],
    stats: [{ t: `${rows.length} items back` }, { t: `${rows.filter((r) => !r.received_at).length} not received yet`, tone: rows.some((r) => !r.received_at) ? "warn" : "ok" }, { t: `${money(credit)} in credits`, tone: "grey" }],
    note: "Highlighted: the items haven't come back yet.",
  };
}

// ------------------------------------------------------------------ Inventory & purchasing
async function lotTrace(c: Ctx): Promise<ReportOut> {
  const lot = String(c.sp.lot ?? "").trim().toUpperCase().replace(/[^A-Z0-9 ._/-]/g, "").slice(0, 40);
  if (lot.length < 3) return { head: [], num: [], rows: [], prompt: "Type a lot or batch number (at least 3 characters). Part of a number works too." };
  const like = `%${lot}%`;
  const nm = await names(c.db);
  const B = (b: string | null) => (b ? nm.branch.get(b) ?? b : "");
  const [inb, xfer, sold, back, onHand, ccr] = await Promise.all([
    c.db.from("inbound_lines").select("lot_no, sku, received_qty, qty, exp, delivery:inbound_deliveries!inner(id, vendor, branch_id, status, received_at, submitted_at, transfer_id)").ilike("lot_no", like).limit(500),
    c.db.from("inventory_transfer_lines").select("lot_no, sku, qty, transfer:inventory_transfers!inner(id, from_branch, to_branch, status, created_at, received_at)").ilike("lot_no", like).limit(500),
    // Lines replaced by an order edit are "cancelled": only the live ones count.
    c.db.from("inventory_lines").select("lot_no, sku, qty, branch_id, state, ord:orders!inner(id, order_no, company_name, status, created_at, completed_at)").ilike("lot_no", like).neq("state", "cancelled").limit(1000),
    c.db.from("order_returns").select("lot_no, sku, qty, condition, received_at, ord:orders!inner(id, order_no, company_name, created_at)").ilike("lot_no", like).limit(500),
    c.db.from("inventory_lots").select("lot_no, sku, branch_id, remaining, exp, use_by").ilike("lot_no", like).limit(200),
    c.db.from("complaint_reports").select("id, report_no, company_name, status, created_at, lot_numbers").ilike("lot_numbers", like).limit(200),
  ]);
  type Ev = { day: string | null; what: string; where: string; who: string; lot: string; sku: string; qty: number | null; ref: string; link: string | null };
  const ev: Ev[] = [];
  type In = { lot_no: string; sku: string; received_qty: number | null; qty: number; delivery: { id: number; vendor: string; branch_id: string; status: string; received_at: string | null; submitted_at: string | null; transfer_id: number | null } };
  for (const r of (inb.data ?? []) as unknown as In[]) {
    if (r.delivery.transfer_id) continue; // shown as the transfer
    if (r.delivery.status === "cancelled") continue;
    ev.push({ day: dayOf(r.delivery.received_at ?? r.delivery.submitted_at), what: r.delivery.status === "received" ? "Received" : "Received (waiting for approval)", where: B(r.delivery.branch_id), who: r.delivery.vendor, lot: r.lot_no, sku: r.sku, qty: n(r.received_qty) ?? n(r.qty), ref: `Receiving Report #${r.delivery.id}`, link: `/inventory/incoming/${r.delivery.id}` });
  }
  type X = { lot_no: string; sku: string; qty: number; transfer: { id: number; from_branch: string; to_branch: string; status: string; created_at: string; received_at: string | null } };
  for (const r of (xfer.data ?? []) as unknown as X[]) {
    if (r.transfer.status === "cancelled") continue;
    ev.push({ day: dayOf(r.transfer.created_at), what: r.transfer.received_at ? "Transferred (received)" : "Transferred (on the way)", where: `${B(r.transfer.from_branch)} → ${B(r.transfer.to_branch)}`, who: "", lot: r.lot_no, sku: r.sku, qty: Number(r.qty), ref: `Transfer T-${r.transfer.id}`, link: `/inventory/transfers/${r.transfer.id}` });
  }
  type S = { lot_no: string; sku: string; qty: number; branch_id: string; state: string; ord: { id: string; order_no: number; company_name: string; status: string; created_at: string; completed_at: string | null } };
  const customers = new Set<string>();
  for (const r of (sold.data ?? []) as unknown as S[]) {
    if (r.ord.status === "cancelled") continue;
    customers.add(r.ord.company_name);
    ev.push({ day: dayOf(r.ord.completed_at ?? r.ord.created_at), what: r.state === "done" || r.ord.status === "completed" ? "Sold (shipped / picked up)" : "Sold (reserved, not out yet)", where: B(r.branch_id), who: r.ord.company_name, lot: r.lot_no, sku: r.sku, qty: Number(r.qty), ref: orderNo(r.ord.order_no), link: `/orders/${r.ord.id}` });
  }
  type Bk = { lot_no: string; sku: string; qty: number; condition: string; received_at: string | null; ord: { id: string; order_no: number; company_name: string; created_at: string } };
  for (const r of (back.data ?? []) as unknown as Bk[]) {
    ev.push({ day: dayOf(r.received_at ?? r.ord.created_at), what: `Returned${r.condition === "damaged" ? " (damaged)" : ""}${r.received_at ? "" : " (not back yet)"}`, where: "", who: r.ord.company_name, lot: r.lot_no, sku: r.sku, qty: Number(r.qty), ref: orderNo(r.ord.order_no), link: `/orders/${r.ord.id}` });
  }
  type Cc = { id: string; report_no: string | null; company_name: string | null; status: string; created_at: string; lot_numbers: string | null };
  for (const r of (ccr.data ?? []) as Cc[]) {
    ev.push({ day: dayOf(r.created_at), what: `Complaint (${COMPLAINT_STATUS[r.status]?.label ?? r.status})`, where: "", who: r.company_name ?? "", lot: r.lot_numbers ?? "", sku: "", qty: null, ref: r.report_no ?? "Complaint report", link: `/complaints/${r.id}` });
  }
  type Oh = { lot_no: string; sku: string; branch_id: string; remaining: number; exp: string | null; use_by: string | null };
  for (const r of (onHand.data ?? []) as Oh[]) {
    if (Number(r.remaining) <= 0) continue;
    ev.push({ day: c.today, what: "In stock now", where: B(r.branch_id), who: "", lot: r.lot_no, sku: r.sku, qty: Number(r.remaining), ref: r.exp ? `Exp ${r.exp}` : r.use_by ? `Use by ${r.use_by}` : "", link: null });
  }
  ev.sort((a, b) => String(a.day ?? "").localeCompare(String(b.day ?? "")));
  const lots = new Set(ev.map((e) => e.lot.toUpperCase()).filter(Boolean));
  return {
    head: ["Date", "What happened", "Location", "Customer / vendor", "Lot / batch", "SKU", "Qty", "Record"],
    num: T([false, false, false, false, false, false, true, false]),
    rows: ev.map((e) => [e.day, e.what, e.where, e.who, e.lot, e.sku, e.qty, e.ref]),
    flag: ev.map((e) => e.what.startsWith("Complaint")),
    links: ev.map((e) => e.link),
    linkCol: 7,
    stats: [
      { t: `Lot ${lot}` },
      { t: `${customers.size} ${customers.size === 1 ? "customer" : "customers"}`, tone: "grey" },
      { t: `${r2(ev.filter((e) => e.what.startsWith("Received")).reduce((x, e) => x + (e.qty ?? 0), 0))} received · ${r2(ev.filter((e) => e.what.startsWith("Sold")).reduce((x, e) => x + (e.qty ?? 0), 0))} sold`, tone: "grey" },
      ...(lots.size > 1 ? [{ t: `${lots.size} lot numbers match`, tone: "warn" as const }] : []),
      ...(ev.some((e) => e.what.startsWith("Complaint")) ? [{ t: "Has complaint reports", tone: "warn" as const }] : []),
    ],
    note: "Oldest first: where the lot came in, moved, went out to customers, came back, any complaint report that mentions it, and what's in stock now. Sales show once an order line has its lot on the PENDING ORDERS sheet.",
  };
}

type Delivery = {
  id: number;
  branch_id: string;
  vendor: string;
  status: string;
  bol_no: string | null;
  po_no: string | null;
  expected_on: string;
  received_at: string | null;
  submitted_at: string | null;
  received_by_name: string | null;
  submitted_by_name: string | null;
  approved_by_name: string | null;
  transfer_id: number | null;
  files: unknown;
  note: string | null;
  rest_of?: number | null;
  partial?: boolean | null;
  lines: { sku: string; qty: number; received_qty: number | null; damaged_qty: number | null }[];
};

async function receivingLog(c: Ctx): Promise<ReportOut> {
  const [list0, nm] = await Promise.all([
    every<Delivery>((a, z) => {
      let q = c.db
        .from("inbound_deliveries")
        .select("id, branch_id, vendor, status, bol_no, po_no, expected_on, received_at, submitted_at, received_by_name, submitted_by_name, approved_by_name, transfer_id, files, note, lines:inbound_lines(sku, qty, received_qty, damaged_qty)")
        .in("status", ["received", "submitted"])
        .is("transfer_id", null)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .range(a, z);
      if (c.from) q = q.gte("submitted_at", centralStart(c.from));
      if (c.to) q = q.lt("submitted_at", centralStart(addDays(c.to, 1)));
      if (c.branch) q = q.eq("branch_id", c.branch);
      return q;
    }),
    names(c.db),
  ]);
  const list = list0.filter((d) => !d.vendor.startsWith("Return: "));
  let shortN = 0;
  let damN = 0;
  let paperN = 0;
  const rows = list.map((d) => {
    const short = d.lines.reduce((s, l) => s + Math.max(0, Number(l.qty) - Number(l.received_qty ?? l.qty)), 0);
    const dam = d.lines.reduce((s, l) => s + Number(l.damaged_qty ?? 0), 0);
    const pw = paperwork(readFiles(d.files));
    const papers = pw.labeled ? (pw.bol && pw.packing ? "BOL + packing list" : !pw.bol ? "Missing BOL" : "Missing packing list") : pw.bol ? "Files (before BOL + packing list)" : "No files";
    if (short) shortN++;
    if (dam) damN++;
    if (papers.startsWith("Missing") || papers === "No files") paperN++;
    return {
      d,
      bad: short > 0 || dam > 0 || papers.startsWith("Missing") || papers === "No files",
      cells: [
        dayOf(d.submitted_at ?? d.received_at),
        `#${d.id}`,
        B(nm.branch, d.branch_id),
        d.vendor,
        d.bol_no ?? "",
        d.po_no ?? "",
        d.lines.map((l) => `${Number(l.received_qty ?? l.qty)} ${l.sku}`).join(", "),
        short || null,
        dam || null,
        papers,
        d.status === "received" ? "Received" : "Waiting for approval",
        d.received_by_name ?? d.submitted_by_name ?? "",
        d.approved_by_name ?? "",
      ] as Cell[],
    };
  });
  return {
    head: ["Date", "Report", "Location", "Vendor", "BOL #", "PO #", "What came in", "Short", "Damaged", "Paperwork", "Status", "Received by", "Approved by"],
    num: T([false, false, false, false, false, false, false, true, true, false, false, false, false]),
    rows: rows.map((r) => r.cells),
    flag: rows.map((r) => r.bad),
    links: rows.map((r) => `/inventory/incoming/${r.d.id}`),
    linkCol: 1,
    stats: [
      { t: `${rows.length} trucks` },
      { t: `${shortN} short`, tone: shortN ? "warn" : "grey" },
      { t: `${damN} with damage`, tone: damN ? "warn" : "grey" },
      { t: `${paperN} missing paperwork`, tone: paperN ? "warn" : "ok" },
    ],
    note: "Receiving Reports from vendors (transfers and customer returns have their own logs). Highlighted: short, damaged, or missing the BOL or packing list.",
  };
}
const B = (m: Map<string, string>, b: string | null) => (b ? m.get(b) ?? b : "");

async function reorderLog(c: Ctx): Promise<ReportOut> {
  type R = { id: number; branch_id: string; requested_by_name: string | null; note: string | null; status: string; handled_by_name: string | null; handled_at: string | null; handled_note: string | null; created_at: string; lines: { sku: string; qty: number }[] };
  const [{ data, error }, nm] = await Promise.all(
    [
      (() => {
        let q = c.db
          .from("reorder_requests")
          .select("id, branch_id, requested_by_name, note, status, handled_by_name, handled_at, handled_note, created_at, lines:reorder_request_lines(sku, qty)")
          .order("created_at", { ascending: false })
          .limit(3000);
        if (c.from) q = q.gte("created_at", centralStart(c.from));
        if (c.to) q = q.lt("created_at", centralStart(addDays(c.to, 1)));
        if (c.branch) q = q.eq("branch_id", c.branch);
        return q;
      })(),
      names(c.db),
    ] as const,
  );
  if (error) return { head: ["Note"], num: [false], rows: [[/reorder_requests/.test(error.message) ? "Reorder requests need the 0064 database update." : error.message]] };
  const list = (data ?? []) as R[];
  const LABEL: Record<string, string> = { open: "Open", ordered: "Ordered", cancelled: "Cancelled" };
  const open = list.filter((r) => r.status === "open");
  return {
    head: ["Date", "Request", "Location", "Requested by", "Items", "Lines", "Status", "Handled by", "Handled", "Days open", "Note"],
    num: T([false, false, false, false, false, true, false, false, false, true, false]),
    rows: list.map((r) => [
      dayOf(r.created_at),
      reorderRef(r.id),
      B(nm.branch, r.branch_id),
      r.requested_by_name ?? "",
      r.lines.map((l) => `${Number(l.qty)} ${l.sku}`).join(", "),
      r.lines.length,
      LABEL[r.status] ?? r.status,
      r.handled_by_name ?? "",
      dayOf(r.handled_at),
      daysBetween(dayOf(r.created_at)!, dayOf(r.handled_at) ?? c.today),
      [r.note, r.handled_note].filter(Boolean).join(" · "),
    ]),
    flag: list.map((r) => r.status === "open" && daysBetween(dayOf(r.created_at)!, c.today) >= 3),
    links: list.map((r) => `/inventory/reorders/${r.id}`),
    linkCol: 1,
    stats: [{ t: `${list.length} requests` }, { t: `${open.length} open`, tone: open.length ? "warn" : "ok" }, { t: `${list.filter((r) => r.status === "ordered").length} ordered`, tone: "grey" }],
    note: "Highlighted: open 3 days or more.",
  };
}

async function partials(c: Ctx): Promise<ReportOut> {
  const [{ data, error }, nm] = await Promise.all([
    (() => {
      let q = c.db
        .from("inbound_deliveries")
        .select("id, branch_id, vendor, status, po_no, expected_on, rest_of, note, lines:inbound_lines(sku, qty)")
        .eq("status", "expected")
        .not("rest_of", "is", null)
        .order("expected_on");
      if (c.branch) q = q.eq("branch_id", c.branch);
      return q;
    })(),
    names(c.db),
  ]);
  if (error) return { head: ["Note"], num: [false], rows: [[/rest_of/.test(error.message) ? "Partial receipts need the 0065 database update." : error.message]] };
  type R = { id: number; branch_id: string; vendor: string; po_no: string | null; expected_on: string; rest_of: number; lines: { sku: string; qty: number }[] };
  const list = (data ?? []) as R[];
  const firstIds = [...new Set(list.map((r) => r.rest_of))];
  const { data: firsts } = firstIds.length ? await c.db.from("inbound_deliveries").select("id, submitted_at, received_at").in("id", firstIds) : { data: [] };
  const firstDay = new Map(((firsts ?? []) as { id: number; submitted_at: string | null; received_at: string | null }[]).map((f) => [f.id, dayOf(f.submitted_at ?? f.received_at)]));
  const late = list.filter((r) => r.expected_on < c.today);
  return {
    head: ["Expected", "Days late", "Location", "Vendor", "PO #", "Still coming", "Part received on", "Received"],
    num: T([false, true, false, false, false, false, false, false]),
    rows: list.map((r) => [
      r.expected_on,
      r.expected_on < c.today ? daysBetween(r.expected_on, c.today) : null,
      B(nm.branch, r.branch_id),
      r.vendor,
      r.po_no ?? "",
      r.lines.map((l) => `${Number(l.qty)} ${l.sku}`).join(", "),
      `Report #${r.rest_of}`,
      firstDay.get(r.rest_of) ?? null,
    ]),
    flag: list.map((r) => r.expected_on < c.today),
    links: list.map((r) => `/inventory/incoming/${r.id}`),
    linkCol: 5,
    stats: [{ t: `${list.length} partial orders waiting` }, { t: `${late.length} late`, tone: late.length ? "warn" : "ok" }],
    note: "The rest of POs that came in part way (Receiving › Partial receipt). Highlighted: past the expected date.",
  };
}

async function transfersLog(c: Ctx): Promise<ReportOut> {
  type R = { id: number; from_branch: string; to_branch: string; status: string; arrive_on: string | null; ref: string | null; created_by_name: string | null; created_at: string; received_at: string | null; received_by_name: string | null; lines: { sku: string; qty: number; lot_no: string | null }[] };
  const [{ data }, nm] = await Promise.all([
    (() => {
      let q = c.db
        .from("inventory_transfers")
        .select("id, from_branch, to_branch, status, arrive_on, ref, created_by_name, created_at, received_at, received_by_name, lines:inventory_transfer_lines(sku, qty, lot_no)")
        .order("created_at", { ascending: false })
        .limit(3000);
      if (c.from) q = q.gte("created_at", centralStart(c.from));
      if (c.to) q = q.lt("created_at", centralStart(addDays(c.to, 1)));
      if (c.branch) q = q.or(`from_branch.eq.${c.branch},to_branch.eq.${c.branch}`);
      return q;
    })(),
    names(c.db),
  ]);
  const list = (data ?? []) as R[];
  const moving = list.filter((r) => r.status !== "cancelled" && !r.received_at);
  return {
    head: ["Sent", "Transfer", "From", "To", "Items", "Status", "Arriving", "Received", "Days in transit", "Sent by", "Received by", "Reference"],
    num: T([false, false, false, false, false, false, false, false, true, false, false, false]),
    rows: list.map((r) => [
      dayOf(r.created_at),
      `T-${r.id}`,
      B(nm.branch, r.from_branch),
      B(nm.branch, r.to_branch),
      r.lines.map((l) => `${Number(l.qty)} ${l.sku}${l.lot_no ? ` (${l.lot_no})` : ""}`).join(", "),
      r.status === "cancelled" ? "Cancelled" : r.received_at ? "Received" : "On the way",
      r.arrive_on,
      dayOf(r.received_at),
      r.status === "cancelled" ? null : daysBetween(dayOf(r.created_at)!, dayOf(r.received_at) ?? c.today),
      r.created_by_name ?? "",
      r.received_by_name ?? "",
      r.ref ?? "",
    ]),
    flag: list.map((r) => r.status !== "cancelled" && !r.received_at && Boolean(r.arrive_on && r.arrive_on < c.today)),
    links: list.map((r) => `/inventory/transfers/${r.id}`),
    linkCol: 1,
    stats: [{ t: `${list.length} transfers` }, { t: `${moving.length} on the way`, tone: moving.length ? "warn" : "grey" }],
    note: "Highlighted: still on the way after the day it was due.",
  };
}

// ------------------------------------------------------------------ Money & admin
async function payments(c: Ctx): Promise<ReportOut> {
  let q = c.db
    .from("customer_payments")
    .select("id, company_id, amount, paid_on, method, ref, invoice_no, note, entered_by_name, created_at, company:companies(name)")
    .is("voided_at", null)
    .order("paid_on", { ascending: false })
    .limit(5000);
  if (c.from) q = q.gte("paid_on", c.from);
  if (c.to) q = q.lte("paid_on", c.to);
  const { data, error } = await q;
  if (error) return { head: ["Note"], num: [false], rows: [[/customer_payments/.test(error.message) ? "Payments need the 0066 database update." : error.message]] };
  type R = { id: number; company_id: string; amount: number; paid_on: string; method: string | null; ref: string | null; invoice_no: string | null; note: string | null; entered_by_name: string | null; company: { name: string } | null };
  const list = (data ?? []) as unknown as R[];
  const total = list.reduce((s, r) => s + Number(r.amount), 0);
  // Week totals (weeks start Monday).
  const weekOf = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };
  const weeks = new Map<string, number>();
  for (const r of list) weeks.set(weekOf(r.paid_on), (weeks.get(weekOf(r.paid_on)) ?? 0) + Number(r.amount));
  const byMethod = new Map<string, number>();
  for (const r of list) byMethod.set(r.method || "Other", (byMethod.get(r.method || "Other") ?? 0) + Number(r.amount));
  return {
    head: ["Paid on", "Week of", "Customer", "Amount", "How", "Check # / ref", "Invoice #", "Entered by", "Note"],
    num: T([false, false, false, true, false, false, false, false, false]),
    money: T([false, false, false, true, false, false, false, false, false]),
    rows: list.map((r) => [r.paid_on, weekOf(r.paid_on), r.company?.name ?? "", Number(r.amount), r.method ?? "", r.ref ?? "", r.invoice_no ?? "", r.entered_by_name ?? "", r.note ?? ""]),
    links: list.map((r) => `/credit/${r.company_id}`),
    linkCol: 2,
    cents: true,
    total: ["Total", "", "", r2(total), "", "", "", "", ""],
    stats: [
      { t: `${money(total)} received` },
      { t: `${list.length} payments`, tone: "grey" },
      ...[...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ t: `${m}: ${money(v)}`, tone: "grey" as const })),
    ],
    note: `Payments entered in Credit & collections (voided ones left out). ${weeks.size > 1 ? "Filter or sort by \"Week of\" to see each week." : ""}`.trim(),
  };
}

async function expenses(c: Ctx): Promise<ReportOut> {
  type R = { id: string; user_id: string; bought_on: string; amount: number; tip: number | null; category: string; paid_with: string | null; lines: unknown; deleted_at: string | null };
  const [list, nm] = await Promise.all([
    every<R>((a, z) => {
      let q = c.db.from("expense_receipts").select("id, user_id, bought_on, amount, tip, category, paid_with, lines, deleted_at").is("deleted_at", null).order("bought_on", { ascending: false }).range(a, z);
      if (c.from) q = q.gte("bought_on", c.from);
      if (c.to) q = q.lte("bought_on", c.to);
      return q;
    }),
    names(c.db),
  ]);
  type Acc = { who: string; cat: string; receipts: Set<string>; amount: number; card: number; personal: number };
  const by = new Map<string, Acc>();
  for (const r of list) {
    for (const l of splitOf(r as never)) {
      const key = `${r.user_id}|${l.category}`;
      const a = by.get(key) ?? { who: nm.person.get(r.user_id) ?? "Unknown", cat: l.category, receipts: new Set(), amount: 0, card: 0, personal: 0 };
      a.receipts.add(r.id);
      a.amount += Number(l.amount);
      if (r.paid_with === "personal") a.personal += Number(l.amount);
      else a.card += Number(l.amount);
      by.set(key, a);
    }
  }
  const rows = [...by.values()].sort((a, b) => a.who.localeCompare(b.who) || b.amount - a.amount);
  const total = rows.reduce((s, a) => s + a.amount, 0);
  const people = new Set(rows.map((a) => a.who));
  return {
    head: ["Employee", "Category", "Receipts", "Amount", "Company card", "Personal (to pay back)"],
    num: T([false, false, true, true, true, true]),
    money: T([false, false, false, true, true, true]),
    rows: rows.map((a) => [a.who, a.cat, a.receipts.size, r2(a.amount), r2(a.card), r2(a.personal)]),
    cents: true,
    total: ["Total", "", list.length, r2(total), r2(rows.reduce((s, a) => s + a.card, 0)), r2(rows.reduce((s, a) => s + a.personal, 0))],
    stats: [{ t: `${money(total)} spent` }, { t: `${list.length} receipts`, tone: "grey" }, { t: `${people.size} people`, tone: "grey" }],
    note: "By the day on each receipt. A receipt split across categories counts in each one.",
  };
}

async function taxCerts(c: Ctx): Promise<ReportOut> {
  const [{ data: cos }, { data: certs }, nm] = await Promise.all([
    c.db.from("companies").select("id, name, account_no, sales_rep_id, tax_exempt").eq("tax_exempt", true).eq("active", true).order("name"),
    c.db.from("tax_certificates").select("*"),
    names(c.db),
  ]);
  const byCo = new Map<string, CertRow[]>();
  for (const x of (certs ?? []) as CertRow[]) byCo.set(x.company_id, [...(byCo.get(x.company_id) ?? []), x]);
  type Co = { id: string; name: string; account_no: string | null; sales_rep_id: string | null };
  const rows: { co: Co; st: ReturnType<typeof computeTaxState>; cert: CertRow | null }[] = [];
  for (const co of (cos ?? []) as Co[]) {
    const st = computeTaxState(true, byCo.get(co.id) ?? [], c.today);
    if (st.state === "ok") continue;
    const cert = (byCo.get(co.id) ?? []).find((x) => x.id === st.cert_id) ?? null;
    rows.push({ co, st, cert });
  }
  const order = { expired: 0, missing: 1, pending: 2, expiring: 3 } as Record<string, number>;
  rows.sort((a, b) => (order[a.st.state] ?? 9) - (order[b.st.state] ?? 9) || (a.st.days_left ?? 0) - (b.st.days_left ?? 0));
  const LABEL: Record<string, string> = { expired: "Expired", missing: "No certificate on file", pending: "Waiting to be verified", expiring: "Expires soon" };
  const count = (s: string) => rows.filter((r) => r.st.state === s).length;
  return {
    head: ["Customer", "Account #", "Rep", "Status", "Expires", "Days left", "State", "Certificate #", "Waiting to verify"],
    num: T([false, false, false, false, false, true, false, false, true]),
    rows: rows.map((r) => [r.co.name, r.co.account_no ?? "", r.co.sales_rep_id ? nm.person.get(r.co.sales_rep_id) ?? "" : "", LABEL[r.st.state] ?? r.st.state, r.st.expires_on, r.st.days_left, r.cert?.state ?? "", r.cert?.cert_number ?? "", r.st.pending || null]),
    flag: rows.map((r) => (r.st.state === "expired" || r.st.state === "missing" ? "err" : true)),
    links: rows.map((r) => `/tax/${r.co.id}`),
    linkCol: 0,
    stats: [
      { t: `${count("expired")} expired`, tone: count("expired") ? "warn" : "ok" },
      { t: `${count("missing")} missing`, tone: count("missing") ? "warn" : "ok" },
      { t: `${count("pending")} waiting to verify`, tone: "grey" },
      { t: `${count("expiring")} expire in 60 days`, tone: "grey" },
    ],
    note: "Active customers marked tax-exempt whose certificate isn't current. Red: their orders are charged tax until a current certificate is verified.",
  };
}

async function complaints(c: Ctx): Promise<ReportOut> {
  type R = { id: string; report_no: string | null; status: string; company_name: string | null; product: string | null; lot_numbers: string | null; created_by_name: string | null; created_at: string; submitted_at: string | null; closed_at: string | null; closed_by_name: string | null; resolution: string | null };
  let q = c.db
    .from("complaint_reports")
    .select("id, report_no, status, company_name, product, lot_numbers, created_by_name, created_at, submitted_at, closed_at, closed_by_name, resolution")
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(3000);
  if (c.from) q = q.gte("created_at", centralStart(c.from));
  if (c.to) q = q.lt("created_at", centralStart(addDays(c.to, 1)));
  const { data } = await q;
  const list = (data ?? []) as R[];
  const byProduct = new Map<string, number>();
  for (const r of list) byProduct.set(r.product || "Not given", (byProduct.get(r.product || "Not given") ?? 0) + 1);
  const open = list.filter((r) => r.status !== "closed");
  return {
    head: ["Date", "Report", "Customer", "Product", "Lots", "Status", "Days open", "Closed", "Closed by", "Resolution", "Started by"],
    num: T([false, false, false, false, false, false, true, false, false, false, false]),
    rows: list.map((r) => [
      dayOf(r.submitted_at ?? r.created_at),
      r.report_no ?? "",
      r.company_name ?? "",
      r.product ?? "",
      r.lot_numbers ?? "",
      COMPLAINT_STATUS[r.status]?.label ?? r.status,
      daysBetween(dayOf(r.submitted_at ?? r.created_at)!, dayOf(r.closed_at) ?? c.today),
      dayOf(r.closed_at),
      r.closed_by_name ?? "",
      r.resolution ?? "",
      r.created_by_name ?? "",
    ]),
    flag: list.map((r) => r.status !== "closed" && daysBetween(dayOf(r.submitted_at ?? r.created_at)!, c.today) >= 14),
    links: list.map((r) => `/complaints/${r.id}`),
    linkCol: 1,
    stats: [
      { t: `${list.length} reports` },
      { t: `${open.length} open`, tone: open.length ? "warn" : "ok" },
      ...[...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, k]) => ({ t: `${p}: ${k}`, tone: "grey" as const })),
    ],
    note: "Submitted complaint reports (drafts left out). Highlighted: open 14 days or more. Lot Trace shows everything about one lot.",
  };
}

// ------------------------------------------------------------------ the list
export const BUILDERS: Record<string, (c: Ctx) => Promise<ReportOut>> = {
  "price-sheet": priceSheet,
  "sales-rep": salesByRep,
  stopped: stoppedOrdering,
  "sales-customer": salesByCustomer,
  "sales-product": salesByProduct,
  "sales-location": salesByLocation,
  discounts,
  "price-requests": priceRequestLog,
  addons,
  "open-orders": openOrders,
  shipped: shippedLog,
  returns: returnsLog,
  "lot-trace": lotTrace,
  receiving: receivingLog,
  reorders: reorderLog,
  partials,
  transfers: transfersLog,
  payments,
  expenses,
  "tax-certs": taxCerts,
  complaints,
};
