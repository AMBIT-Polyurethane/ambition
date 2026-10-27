import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can } from "@/lib/access";
import { addDays, centralStart, deskAccess } from "@/lib/order-desk";
import { todayCentral } from "@/lib/sale";
import type { Profile } from "@/lib/types";

// Data for the Home screen widgets. Each one asks only for what it shows, and none of them ever breaks Home:
// anything missing (an update not run yet) just comes back empty.

type Db = SupabaseClient;

/** Which widgets someone gets. Admins get the business view; everyone else gets their own job. */
export function widgetsFor(p: Profile) {
  const emp = p.role === "employee" || p.role === "admin";
  const admin = p.role === "admin";
  const warehouse = emp && p.job_role === "warehouse";
  return {
    admin,
    spot: warehouse,
    calendar: emp && !admin && (warehouse || can(p, "order_desk")),
    queue: emp && !admin && can(p, "order_desk"),
    credit: emp && !admin && can(p, "credit_check"),
    sales: emp && !admin && deskAccess(p) === "mine",
  };
}

// ------------------------------------------------------------------ locations
export type InvBranch = { id: string; name: string };

/** Locations with live inventory, the person's own first. */
export async function inventoryBranches(db: Db, profile: Pick<Profile, "branch_id">): Promise<InvBranch[]> {
  const [{ data: sheets }, { data: branches }] = await Promise.all([
    db.from("inventory_sheets").select("branch_id").eq("enabled", true),
    db.from("branches").select("id, name, sort").order("sort"),
  ]);
  const on = new Set(((sheets ?? []) as { branch_id: string }[]).map((s) => s.branch_id));
  const list = ((branches ?? []) as { id: string; name: string }[]).filter((b) => on.has(b.id));
  return list.sort((a, b) => (a.id === profile.branch_id ? -1 : b.id === profile.branch_id ? 1 : 0));
}

// ------------------------------------------------------------------ spot checks
export type SpotLine = { id: number; sku: string; name: string | null; unit: string | null; lot_no: string | null; counted_qty: number | null };
export type SpotCount = { id: number; day: string; status: string; lines: SpotLine[] };

/** Today's spot check and any weekdays missed, for one location (assigned on the spot if needed). */
export async function spotChecks(db: Db, branch: string): Promise<{ today: SpotCount | null; missed: SpotCount[]; waiting: number } | null> {
  const ensured = await db.rpc("spot_check_ensure", { p_branch: branch });
  if (ensured.error) return null;
  const today = todayCentral();
  const { data } = await db
    .from("inventory_counts")
    .select("id, day, status, lines:inventory_count_lines(id, sku, name, unit, lot_no, counted_qty)")
    .eq("branch_id", branch)
    .eq("kind", "spot")
    .gte("day", addDays(today, -30))
    .order("day", { ascending: false });
  const rows = ((data ?? []) as SpotCount[]).map((c) => ({ ...c, lines: [...c.lines].sort((a, b) => a.id - b.id) }));
  return {
    today: rows.find((c) => c.day === today) ?? null,
    missed: rows.filter((c) => c.day < today && c.status === "open"),
    waiting: rows.filter((c) => c.status === "submitted").length,
  };
}

// ------------------------------------------------------------------ calendar
export type CalItem = { kind: "pickup" | "delivery" | "incoming"; id: string; title: string; sub: string; href: string; late?: boolean };
export type CalDay = { day: string; items: CalItem[] };

/** The next 7 days at one location: customer pickups, deliveries and incoming trucks (anything late shows today). */
export async function calendar(db: Db, branch: string, days = 7): Promise<CalDay[]> {
  const today = todayCentral();
  const end = addDays(today, days - 1);
  const [{ data: orders }, { data: inbound }] = await Promise.all([
    db
      .from("orders")
      .select("id, order_no, company_name, scheduled_for, delivery_method, stage")
      .eq("branch_id", branch)
      .eq("stage", "scheduled")
      .lte("scheduled_for", end)
      .order("scheduled_for"),
    db
      .from("inbound_deliveries")
      .select("id, vendor, expected_on, ref, status, lines:inbound_lines(sku, qty)")
      .eq("branch_id", branch)
      .eq("status", "expected")
      .lte("expected_on", end)
      .order("expected_on"),
  ]);
  const out: CalDay[] = Array.from({ length: days }, (_, i) => ({ day: addDays(today, i), items: [] }));
  const put = (day: string, item: CalItem) => out[Math.max(0, out.findIndex((d) => d.day === (day < today ? today : day)))]?.items.push(item);
  for (const o of (orders ?? []) as { id: string; order_no: number; company_name: string; scheduled_for: string; delivery_method: string }[]) {
    const pickup = o.delivery_method === "pickup";
    put(o.scheduled_for, {
      kind: pickup ? "pickup" : "delivery",
      id: o.id,
      title: o.company_name,
      sub: `ORD-${o.order_no}${o.scheduled_for < today ? ` · was due ${o.scheduled_for.slice(5).replace("-", "/")}` : ""}`,
      href: `/orders/${o.id}`,
      late: o.scheduled_for < today,
    });
  }
  for (const d of (inbound ?? []) as { id: number; vendor: string; expected_on: string; ref: string | null; lines: { sku: string; qty: number }[] | null }[]) {
    const lines = d.lines ?? [];
    const what = lines.slice(0, 2).map((l) => `${Number(l.qty)} ${l.sku}`).join(", ") + (lines.length > 2 ? ` +${lines.length - 2} more` : "");
    put(d.expected_on, {
      kind: "incoming",
      id: String(d.id),
      title: d.vendor,
      sub: `${[d.ref, what].filter(Boolean).join(" · ") || "Truck"}${d.expected_on < today ? ` · was due ${d.expected_on.slice(5).replace("-", "/")}` : ""}`,
      href: `/inventory/incoming/${d.id}`,
      late: d.expected_on < today,
    });
  }
  return out;
}

// ------------------------------------------------------------------ sales (orders placed in the app)
type OrderRow = { id: string; branch_id: string | null; est_subtotal: number; created_at: string; placed_by: string | null };

const monthStart = (day: string) => `${day.slice(0, 8)}01`;
/** The same stretch of last month (1st through today's date, or its last day). */
function lastMonthWindow(today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 11 : d.getUTCMonth() - 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(d.getUTCDate(), lastDay)).padStart(2, "0")}`;
  return { from, to };
}

async function ordersBetween(db: Db, from: string, to: string, mine?: string): Promise<OrderRow[]> {
  let q = db
    .from("orders")
    .select("id, branch_id, est_subtotal, created_at, placed_by")
    .neq("status", "cancelled")
    .gte("created_at", centralStart(from))
    .lt("created_at", centralStart(addDays(to, 1)))
    .limit(5000);
  if (mine) q = q.eq("placed_by", mine);
  const { data } = await q;
  return ((data ?? []) as OrderRow[]).map((o) => ({ ...o, est_subtotal: Number(o.est_subtotal ?? 0) }));
}

export type SalesSummary = {
  total: number;
  orders: number;
  last: number;
  lastOrders: number;
  byBranch: { id: string; name: string; total: number; orders: number }[];
  top: { sku: string; name: string; total: number; qty: number; unit: string; orders: number }[];
  month: string;
};

/** Admin: this month's orders by location and the top products (list prices; customer-priced items not included). */
export async function salesSummary(db: Db): Promise<SalesSummary> {
  const today = todayCentral();
  const from = monthStart(today);
  const lw = lastMonthWindow(today);
  const [now, last, { data: branches }, { data: items }] = await Promise.all([
    ordersBetween(db, from, today),
    ordersBetween(db, lw.from, lw.to),
    db.from("branches").select("id, name, sort").order("sort"),
    db
      .from("order_items")
      .select("order_id, sku, name, unit, qty, line_total, ord:orders!inner(created_at, status)")
      .gte("ord.created_at", centralStart(from))
      .neq("ord.status", "cancelled")
      .limit(10000),
  ]);
  const names = new Map(((branches ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const by = new Map<string, { total: number; orders: number }>();
  for (const o of now) {
    const k = o.branch_id ?? "dropship";
    const cur = by.get(k) ?? { total: 0, orders: 0 };
    by.set(k, { total: cur.total + o.est_subtotal, orders: cur.orders + 1 });
  }
  const byBranch = [...names.keys(), "dropship"]
    .filter((k) => by.has(k))
    .map((k) => ({ id: k, name: k === "dropship" ? "Drop ship" : names.get(k) ?? k, ...by.get(k)! }))
    .sort((a, b) => b.orders - a.orders || b.total - a.total);
  // Top products by how many orders had them: spray foam and other customer-priced items have no price in the app,
  // and drums, bags and cases don't add up, so the count of orders is the fair way to rank them.
  const prod = new Map<string, { sku: string; name: string; total: number; qty: number; unit: string; ids: Set<string> }>();
  for (const it of (items ?? []) as unknown as { order_id: string; sku: string; name: string; unit: string; qty: number; line_total: number | null }[]) {
    const cur = prod.get(it.sku) ?? { sku: it.sku, name: it.name, total: 0, qty: 0, unit: it.unit, ids: new Set<string>() };
    cur.total += Number(it.line_total ?? 0);
    cur.qty += Number(it.qty ?? 0);
    cur.ids.add(it.order_id);
    prod.set(it.sku, cur);
  }
  const top = [...prod.values()]
    .map(({ ids, ...p }) => ({ ...p, orders: ids.size }))
    .sort((a, b) => b.orders - a.orders || b.qty - a.qty)
    .slice(0, 5);
  const month = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return {
    total: now.reduce((a, o) => a + o.est_subtotal, 0),
    orders: now.length,
    last: last.reduce((a, o) => a + o.est_subtotal, 0),
    lastOrders: last.length,
    byBranch,
    top,
    month,
  };
}

/** Sales rep: their own month so far, against last month and their goal. */
export async function myMonth(db: Db, profile: Pick<Profile, "id"> & { monthly_goal?: number | null }) {
  const today = todayCentral();
  const lw = lastMonthWindow(today);
  const [now, last] = await Promise.all([ordersBetween(db, monthStart(today), today, profile.id), ordersBetween(db, lw.from, lw.to, profile.id)]);
  const d = new Date(`${today}T12:00:00Z`);
  const daysIn = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    total: now.reduce((a, o) => a + o.est_subtotal, 0),
    orders: now.length,
    last: last.reduce((a, o) => a + o.est_subtotal, 0),
    lastOrders: last.length,
    goal: profile.monthly_goal ? Number(profile.monthly_goal) : null,
    dayOfMonth: d.getUTCDate(),
    daysIn,
  };
}

// ------------------------------------------------------------------ inventory movement
export type Mover = { sku: string; name: string; unit: string; now: number; before: number };

/** Admin: what's selling faster or slower (units ordered, last 30 days against the 30 before). */
export async function movers(db: Db): Promise<{ up: Mover[]; down: Mover[] }> {
  const today = todayCentral();
  const mid = addDays(today, -29);
  const start = addDays(today, -59);
  const { data } = await db
    .from("order_items")
    .select("sku, name, unit, qty, ord:orders!inner(created_at, status)")
    .gte("ord.created_at", centralStart(start))
    .neq("ord.status", "cancelled")
    .limit(20000);
  const midAt = centralStart(mid);
  const m = new Map<string, Mover>();
  for (const it of (data ?? []) as unknown as { sku: string; name: string; unit: string; qty: number; ord: { created_at: string } }[]) {
    const cur = m.get(it.sku) ?? { sku: it.sku, name: it.name, unit: it.unit, now: 0, before: 0 };
    if (it.ord.created_at >= midAt) cur.now += Number(it.qty);
    else cur.before += Number(it.qty);
    m.set(it.sku, cur);
  }
  const all = [...m.values()].filter((x) => x.now + x.before >= 3);
  const up = all.filter((x) => x.now > x.before).sort((a, b) => b.now - b.before - (a.now - a.before)).slice(0, 3);
  const down = all.filter((x) => x.now < x.before).sort((a, b) => a.now - a.before - (b.now - b.before)).slice(0, 3);
  return { up, down };
}

// ------------------------------------------------------------------ queues
const count = (q: PromiseLike<{ count: number | null; error: unknown }>) => Promise.resolve(q).then((r) => (r.error ? 0 : r.count ?? 0), () => 0);

/** CRM: the order desk queue and today's pickups / deliveries. */
export async function deskQueue(db: Db) {
  const today = todayCentral();
  const head = { count: "exact" as const, head: true };
  const [needsPo, toSchedule, customer, today_, late] = await Promise.all([
    count(db.from("orders").select("id", head).eq("stage", "needs_po")),
    count(db.from("orders").select("id", head).eq("stage", "schedule")),
    count(db.from("orders").select("id", head).eq("stage", "customer")),
    count(db.from("orders").select("id", head).eq("stage", "scheduled").eq("scheduled_for", today)),
    count(db.from("orders").select("id", head).eq("stage", "scheduled").lt("scheduled_for", today)),
  ]);
  return { needsPo, toSchedule, customer, today: today_, late };
}

/** Accounting: credit checks waiting and on hold. */
export async function creditQueue(db: Db) {
  const head = { count: "exact" as const, head: true };
  const [credit, hold] = await Promise.all([
    count(db.from("orders").select("id", head).eq("stage", "credit")),
    count(db.from("orders").select("id", head).eq("stage", "hold")),
  ]);
  return { credit, hold };
}

/** Admin: counts waiting for approval at every location. */
export async function countsWaiting(db: Db) {
  const { data } = await db.from("inventory_counts").select("id, kind, branch_id, day, submitted_at").eq("status", "submitted").order("submitted_at");
  return (data ?? []) as { id: number; kind: "spot" | "reconcile"; branch_id: string; day: string | null; submitted_at: string }[];
}

/** Admin: how each location's spot checks stand today. */
export async function spotOverview(db: Db) {
  const today = todayCentral();
  // Make sure each location's checks exist (even if nobody there has opened the app), so a missed day shows up.
  const { data: sheets } = await db.from("inventory_sheets").select("branch_id").eq("enabled", true);
  await Promise.all(((sheets ?? []) as { branch_id: string }[]).map((s) => db.rpc("spot_check_ensure", { p_branch: s.branch_id })));
  const { data } = await db.from("inventory_counts").select("branch_id, day, status").eq("kind", "spot").gte("day", addDays(today, -30)).lte("day", today);
  const by = new Map<string, { today: string | null; missed: number }>();
  for (const r of (data ?? []) as { branch_id: string; day: string; status: string }[]) {
    const cur = by.get(r.branch_id) ?? { today: null, missed: 0 };
    if (r.day === today) cur.today = r.status;
    else if (r.status === "open") cur.missed++;
    by.set(r.branch_id, cur);
  }
  return by;
}
