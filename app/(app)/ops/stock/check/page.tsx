import Link from "next/link";
import { CircleAlert, CircleCheck, PackageCheck } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { LINE_COLS, TRIP_COLS, loadRigs, toLine } from "@/lib/ops/jobs-server";
import { loadProducts } from "@/lib/ops/quotes";
import { materialNeeds, type CatalogItem } from "@/lib/ops/materials";
import type { QLine } from "@/lib/ops/quote-calc";
import { STOCK_COLS, qtyText, type CheckRow, type StockRow } from "@/lib/ops/stock";
import { addDays, isDay, rangeText, todayCentral, unitsText, weekStart, type Trip } from "@/lib/ops/schedule";
import { TopBar } from "@/components/ui";
import { OrderButton } from "@/components/ops/order-button";

export const metadata = { title: "Stock check" };
export const dynamic = "force-dynamic";

type TripRow = Trip & { job: { id: string; number: number; status: string; customer: { name: string } | null } | null };

/** Does the scheduled work have what it needs? Foam in whole sets (an ISO and a resin drum each), bags. */
export default async function StockCheckPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  const co = ws.company.id;
  const one = sp.trip && /^[0-9a-f-]{36}$/i.test(sp.trip) ? sp.trip : null;
  const from = isDay(sp.from) ? sp.from : weekStart(todayCentral());
  const to = isDay(sp.to) && sp.to >= from ? sp.to : addDays(from, 6);
  const sel = `${TRIP_COLS}, job:ops_jobs!inner(id, number, status, customer:ops_customers(name))`;
  const { data: tripData } = one
    ? await supabase.from("ops_trips").select(sel).eq("id", one)
    : await supabase.from("ops_trips").select(sel).eq("company_id", co).in("status", ["scheduled", "in_progress"]).lte("start_date", to).gte("end_date", from).order("start_date");
  const trips = ((tripData ?? []) as unknown as TripRow[]).filter((t) => t.job && t.job.status !== "cancelled");
  const ids = trips.map((t) => t.id);
  const [rigs, products, { data: lineRows }, { data: stockRows }, { data: orders }, { data: cat }] = await Promise.all([
    loadRigs(supabase, co, true),
    loadProducts(supabase, co),
    ids.length ? supabase.from("ops_job_lines").select(LINE_COLS).in("trip_id", ids) : Promise.resolve({ data: [] }),
    supabase.from("ops_stock").select(STOCK_COLS).eq("company_id", co),
    supabase.from("orders").select("id, order_no, scheduled_for, items:order_items(product_id, sku, qty)").eq("company_id", co).in("status", ["new", "processing"]),
    supabase.from("products").select("id, sku, name, unit").eq("active", true),
  ]);
  const lines = (lineRows ?? []).map((r) => toLine(r as Record<string, unknown>));
  const catalog = new Map(((cat ?? []) as CatalogItem[]).map((c) => [c.sku.trim().toUpperCase(), c]));
  const needs = materialNeeds(lines as unknown as QLine[], new Map(products.map((p) => [p.id, p])), catalog);
  const stock = (stockRows ?? []) as StockRow[];
  const tripRigs = new Set(trips.map((t) => t.rig_id).filter(Boolean) as string[]);
  const coming = new Map<string, number>();
  type O = { id: string; order_no: number; scheduled_for: string | null; items: { product_id: string | null; sku: string | null; qty: number }[] };
  for (const o of (orders ?? []) as O[]) for (const i of o.items) if (i.sku) coming.set(i.sku.trim().toUpperCase(), (coming.get(i.sku.trim().toUpperCase()) ?? 0) + Number(i.qty));
  const rows: CheckRow[] = needs.rows.map((n) => {
    const key = n.sku.trim().toUpperCase();
    const mine = stock.filter((s) => s.item_key === key);
    const onRig = mine.filter((s) => s.place_kind === "rig" && (one ? tripRigs.has(s.place_id) : true)).reduce((a, s) => a + Number(s.qty), 0);
    const inShop = mine.filter((s) => s.place_kind === "location").reduce((a, s) => a + Number(s.qty), 0);
    const c = coming.get(key) ?? 0;
    return { item_key: key, product_id: n.product_id, name: n.name, unit: n.unit, need: n.qty, exact: n.exact, onRig, inShop, coming: c, short: Math.max(0, Math.ceil(n.qty - onRig - inShop - c - 1e-9)), why: n.why };
  });
  const short = rows.filter((r) => r.short > 0);
  const toLoad = one ? rows.filter((r) => r.need > r.onRig && r.inShop > 0) : [];
  const rigName = (id: string | null) => rigs.find((r) => r.id === id)?.name ?? "the rig";
  const title = one && trips[0] ? `#${trips[0].job?.number} ${trips[0].job?.customer?.name ?? ""} · ${trips[0].name}` : `${rangeText(from, 1)} – ${rangeText(to, 1)}`;

  return (
    <main className="shell">
      <TopBar title="Stock check" back={one && trips[0] ? `/ops/jobs/${trips[0].job_id}` : `/ops/schedule?d=${from}`} />
      <div className="col tight">
        <b style={{ fontSize: 18 }}>{title}</b>
        <span className="small muted">
          {one
            ? trips[0]?.start_date ? `${rangeText(trips[0].start_date, trips[0].days)} on ${rigName(trips[0].rig_id)}` : "Not on the board yet"
            : `${trips.length} scheduled trip${trips.length === 1 ? "" : "s"}`}
          . Foam is counted in whole sets: one ISO drum and one resin drum each.
        </span>
      </div>
      {!one ? (
        <div className="chips">
          <Link className="chip" href={`/ops/stock/check?from=${addDays(from, -7)}&to=${addDays(from, -1)}`}>Last week</Link>
          <Link className={`chip${from === weekStart(todayCentral()) ? " on" : ""}`} href="/ops/stock/check">This week</Link>
          <Link className="chip" href={`/ops/stock/check?from=${addDays(weekStart(todayCentral()), 7)}&to=${addDays(weekStart(todayCentral()), 13)}`}>Next week</Link>
          <Link className="chip" href={`/ops/stock/check?from=${weekStart(todayCentral())}&to=${addDays(weekStart(todayCentral()), 13)}`}>Next 2 weeks</Link>
        </div>
      ) : null}

      {rows.length ? (
        <>
          {short.length ? (
            <div className="alert warn"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>Short on {short.length} item{short.length === 1 ? "" : "s"}, even counting what&apos;s on the way from AMBIT.</span></div>
          ) : (
            <div className="alert ok"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>You have enough{coming.size ? " (counting AMBIT orders on the way)" : ""}.</span></div>
          )}
          <div className="table-wrap">
            <table className="ops-table check-table">
              <thead>
                <tr><th>Item</th><th className="num">Needs</th><th className="num">{one ? "On the rig" : "On rigs"}</th><th className="num">In the shop</th><th className="num">Coming</th><th className="num">Short</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item_key} className={r.short ? "low" : ""}>
                    <td><span className="col tight"><span>{r.name}</span><span className="tiny faint">{r.why}</span></span></td>
                    <td className="num"><b>{unitsText(r.need, r.unit)}</b></td>
                    <td className="num">{qtyText(r.onRig)}</td>
                    <td className="num">{qtyText(r.inShop)}</td>
                    <td className="num">{r.coming ? qtyText(r.coming) : "–"}</td>
                    <td className="num">{r.short ? <b className="red">{qtyText(r.short)}</b> : <CircleCheck size={15} className="ok-text" aria-label="Enough" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {toLoad.length ? (
            <div className="alert info small">
              <span>Load before the trip: {toLoad.map((r) => `${unitsText(Math.min(r.inShop, r.need - r.onRig), r.unit)} of ${r.name}`).join(", ")} from the shop onto {rigName(trips[0]?.rig_id ?? null)}. <Link href="/ops/stock">Move them on the Stock page</Link>.</span>
            </div>
          ) : null}
          <OrderButton
            items={short.map((r) => ({ product_id: r.product_id ?? "", qty: r.short }))}
            label={short.length ? `Order what's short from AMBIT (${short.length})` : "Nothing to order"}
            note={short.length ? "They go in your AMBIT order cart; pick the location and date there." : undefined}
          />
        </>
      ) : (
        <div className="card small muted">
          <PackageCheck size={16} style={{ verticalAlign: -3 }} /> {trips.length ? "The scheduled work doesn't need anything from AMBIT (or its lines have no sizes yet)." : "No scheduled trips here yet."}
        </div>
      )}
      {needs.elsewhere.length ? <div className="alert info small"><span>Not from AMBIT: {needs.elsewhere.map((e) => `${e.name} (${qtyText(e.exact)} ${e.unit})`).join(", ")}.</span></div> : null}
      {needs.missing.length ? <div className="alert warn small"><span>Couldn&apos;t match these to AMBIT&apos;s catalog: {needs.missing.join(", ")}.</span></div> : null}
      {!one && trips.length ? (
        <section className="col" style={{ gap: 6 }}>
          <b className="small">Trips counted</b>
          <ul className="stock-list">
            {trips.map((t) => (
              <li key={t.id}><Link href={`/ops/jobs/${t.job_id}`} className="small grow">#{t.job?.number} {t.job?.customer?.name} · {t.name}</Link><span className="tiny faint">{rangeText(t.start_date, t.days)} · {rigName(t.rig_id)}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
