import Link from "next/link";
import { ArrowRightLeft, CircleAlert, CircleCheck, Factory, PackageCheck, Plus, Truck } from "lucide-react";
import { requireOps, locationsOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { loadRigs } from "@/lib/ops/jobs-server";
import { loadProducts } from "@/lib/ops/quotes";
import { ISO_MAKERS, STOCK_COLS, lotText, qtyText, stockItems, totals, type Place, type StockRow } from "@/lib/ops/stock";
import type { CatalogItem } from "@/lib/ops/materials";
import { dateShort, dateTime, orderNo } from "@/lib/format";
import { unitsText } from "@/lib/ops/schedule";
import { Submit } from "@/components/forms";
import { TopBar } from "@/components/ui";
import { OrderButton } from "@/components/ops/order-button";
import { addStock, countStock, moveStock, setReorder } from "./actions";

export const metadata = { title: "Stock" };
export const dynamic = "force-dynamic";

type Move = { id: number; at: string; kind: string; name: string; unit: string | null; maker: string; lot_no: string; qty: number; from_kind: string | null; from_id: string | null; to_kind: string | null; to_id: string | null; note: string | null; by_name: string | null };
type OpenOrder = { id: string; order_no: number; status: string; scheduled_for: string | null; stage: string | null; items: { product_id: string | null; sku: string | null; name: string; qty: number; unit: string | null }[] };

const KIND: Record<string, string> = { ambit_delivery: "AMBIT delivery", received: "Added", count: "Counted", adjust: "Changed", move: "Moved", used: "Used" };

/** The shop and every rig: ISO by maker and lot, resin by lot, bags and supplies. */
export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.jobs);
  const co = ws.company.id;
  const dispatch = opsCan.dispatch(ws.role);
  const [locations, rigs, products, { data: stockRows }, { data: mins }, { data: moves }, { data: orders }, { data: cat }] = await Promise.all([
    locationsOf(supabase, co),
    loadRigs(supabase, co),
    loadProducts(supabase, co),
    supabase.from("ops_stock").select(STOCK_COLS).eq("company_id", co).order("name"),
    supabase.from("ops_stock_min").select("item_key, product_id, name, unit, min_qty").eq("company_id", co),
    supabase.from("ops_stock_moves").select("id, at, kind, name, unit, maker, lot_no, qty, from_kind, from_id, to_kind, to_id, note, by_name").eq("company_id", co).order("at", { ascending: false }).limit(25),
    supabase.from("orders").select("id, order_no, status, scheduled_for, stage, items:order_items(product_id, sku, name, qty, unit)").eq("company_id", co).in("status", ["new", "processing"]).order("created_at", { ascending: false }).limit(20),
    supabase.from("products").select("id, sku, name, unit").eq("active", true),
  ]);
  const catalog = new Map(((cat ?? []) as CatalogItem[]).map((c) => [c.sku.trim().toUpperCase(), c]));
  const items = stockItems(products, catalog);
  const rows = (stockRows ?? []) as StockRow[];
  const places: Place[] = [...locations.map((l) => ({ kind: "location" as const, id: l.id, name: l.name })), ...rigs.map((r) => ({ kind: "rig" as const, id: r.id, name: r.name, color: r.color }))];
  const placeName = (k: string | null, id: string | null) => places.find((p) => p.kind === k && p.id === id)?.name ?? (k === "rig" ? "a rig" : k === "location" ? "the shop" : "");
  const open = (orders ?? []) as OpenOrder[];
  const coming = new Map<string, number>();
  for (const o of open) for (const i of o.items) if (i.sku) coming.set(i.sku.trim().toUpperCase(), (coming.get(i.sku.trim().toUpperCase()) ?? 0) + Number(i.qty));
  const tot = totals(rows);
  type Min = { item_key: string; product_id: string | null; name: string; unit: string; min_qty: number };
  const minList = (mins ?? []) as Min[];
  const minBy = new Map(minList.map((m) => [m.item_key, m]));
  // Everything worth listing in the summary: stocked, on a reorder point, or a product they use.
  const keys = [...new Set([...rows.map((r) => r.item_key), ...minList.map((m) => m.item_key)])];
  const info = (k: string) => {
    const r = rows.find((x) => x.item_key === k);
    const i = items.find((x) => x.item_key === k);
    const m = minBy.get(k);
    return { name: r?.name ?? i?.name ?? m?.name ?? k, unit: r?.unit ?? i?.unit ?? m?.unit ?? "each", product_id: r?.product_id ?? i?.product_id ?? m?.product_id ?? null };
  };
  const low = keys
    .map((k) => ({ k, ...info(k), have: tot.get(k) ?? 0, coming: coming.get(k) ?? 0, min: minBy.get(k)?.min_qty ?? 0 }))
    .filter((x) => x.min > 0 && x.have + x.coming < x.min);
  const backTo = "/ops/stock";

  return (
    <main className="shell wide">
      <TopBar
        title="Stock"
        back="/ops/schedule"
        right={<Link href={`/ops/stock/check`} className="btn sm" style={{ marginLeft: "auto" }}><PackageCheck size={15} /> Stock check</Link>}
      />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="small muted" style={{ margin: 0 }}>
        AMBIT orders are added to {locations[0]?.name ?? "your shop"} by themselves when AMBIT marks them picked up or delivered, by the lots AMBIT loaded. Move drums onto a rig when you load it. Starting out? Add what&apos;s in the shop and on each rig below.
      </p>

      {low.length ? (
        <section className="card col stock-low" style={{ gap: 10 }}>
          <b><CircleAlert size={16} style={{ verticalAlign: -3, color: "var(--warn)" }} /> Running low</b>
          <ul className="stock-list">
            {low.map((x) => (
              <li key={x.k}><span className="grow">{x.name}</span><span className="small">{qtyText(x.have)}{x.coming ? ` + ${qtyText(x.coming)} coming` : ""} of {unitsText(x.min, x.unit)}</span></li>
            ))}
          </ul>
          <OrderButton
            items={low.filter((x) => x.product_id).map((x) => ({ product_id: x.product_id!, qty: Math.ceil(x.min - x.have - x.coming) }))}
            label="Order what's low from AMBIT"
            note="Brings you back up to each reorder point. You can change the amounts on the order."
          />
        </section>
      ) : null}

      <section className="col" style={{ gap: 10 }}>
        <b style={{ fontSize: 17 }}>Everything on hand</b>
        {keys.length ? (
          <div className="table-wrap">
            <table className="ops-table stock-sum">
              <thead><tr><th>Item</th>{places.map((p) => <th key={`${p.kind}${p.id}`} className="num">{p.name}</th>)}<th className="num">Total</th><th className="num">Coming</th><th className="num">Reorder at</th></tr></thead>
              <tbody>
                {keys.map((k) => {
                  const i = info(k);
                  const total = tot.get(k) ?? 0;
                  const m = minBy.get(k);
                  const isLow = m && total + (coming.get(k) ?? 0) < m.min_qty;
                  return (
                    <tr key={k} className={isLow ? "low" : ""}>
                      <td><span className="col tight"><span>{i.name}</span><span className="tiny faint">{i.unit}</span></span></td>
                      {places.map((p) => {
                        const n = rows.filter((r) => r.item_key === k && r.place_kind === p.kind && r.place_id === p.id).reduce((a, r) => a + Number(r.qty), 0);
                        return <td key={`${p.kind}${p.id}`} className="num">{n ? qtyText(n) : <span className="faint">–</span>}</td>;
                      })}
                      <td className="num"><b>{qtyText(total)}</b></td>
                      <td className="num">{coming.get(k) ? qtyText(coming.get(k)!) : <span className="faint">–</span>}</td>
                      <td className="num">
                        {dispatch ? (
                          <form action={setReorder} className="stock-min">
                            <input type="hidden" name="back" value={backTo} />
                            <input type="hidden" name="item_key" value={k} />
                            <input type="hidden" name="product_id" value={i.product_id ?? ""} />
                            <input type="hidden" name="name" value={i.name} />
                            <input type="hidden" name="unit" value={i.unit} />
                            <input className="input sm" name="min" inputMode="decimal" defaultValue={m?.min_qty ?? ""} placeholder="–" aria-label={`Reorder point for ${i.name}`} />
                            <Submit className="btn sm dark" pendingText="…">Set</Submit>
                          </form>
                        ) : m ? qtyText(m.min_qty) : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card small muted">Nothing in stock yet. Add what you have below; AMBIT orders come in by themselves once they&apos;re delivered.</div>
        )}
      </section>

      {places.map((p) => {
        const here = rows.filter((r) => r.place_kind === p.kind && r.place_id === p.id);
        return (
          <section key={`${p.kind}${p.id}`} className="card col" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              {p.kind === "rig" ? <span className="rig-dot sm" style={{ background: p.color ?? "#71717a" }} aria-hidden="true" /> : <Factory size={17} />}
              <b className="grow">{p.name}</b>
              <span className="tiny faint">{p.kind === "rig" ? "Rig" : "Shop"} · {here.length} item{here.length === 1 ? "" : "s"}</span>
            </div>
            {here.length ? (
              <ul className="stock-rows">
                {here.map((r) => (
                  <li key={r.id}>
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="small ellipsis">{r.name}</span>
                      <span className="tiny faint ellipsis">{lotText(r)} · updated {dateShort(r.updated_at)}</span>
                    </span>
                    <b className="stock-qty">{unitsText(r.qty, r.unit) ?? "0"}</b>
                    {dispatch ? (
                      <details className="stock-act">
                        <summary className="linkbtn small">Count or move</summary>
                        <div className="col" style={{ gap: 8, marginTop: 8 }}>
                          <form action={countStock} className="row" style={{ gap: 6 }}>
                            <input type="hidden" name="back" value={backTo} />
                            <input type="hidden" name="id" value={r.id} />
                            <input className="input sm" name="qty" inputMode="decimal" defaultValue={qtyText(r.qty)} aria-label="What's really there" style={{ width: 90 }} />
                            <Submit className="btn sm dark" pendingText="…">Save count</Submit>
                          </form>
                          {places.length > 1 ? (
                            <form action={moveStock} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <input type="hidden" name="back" value={backTo} />
                              <input type="hidden" name="id" value={r.id} />
                              <input className="input sm" name="qty" inputMode="decimal" defaultValue={qtyText(r.qty)} aria-label="How many to move" style={{ width: 80 }} />
                              <select className="select sm" name="to" aria-label="Move to" defaultValue={places.find((x) => !(x.kind === p.kind && x.id === p.id)) ? `${places.find((x) => !(x.kind === p.kind && x.id === p.id))!.kind}:${places.find((x) => !(x.kind === p.kind && x.id === p.id))!.id}` : ""}>
                                {places.filter((x) => !(x.kind === p.kind && x.id === p.id)).map((x) => <option key={`${x.kind}${x.id}`} value={`${x.kind}:${x.id}`}>{x.name}</option>)}
                              </select>
                              <Submit className="btn sm dark" pendingText="…"><ArrowRightLeft size={14} /> Move</Submit>
                            </form>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="small muted">{p.kind === "rig" ? "Nothing on this rig. Move drums here from the shop when you load it." : "Nothing here yet."}</span>
            )}
          </section>
        );
      })}

      {dispatch ? (
        <form action={addStock} className="card col" style={{ gap: 10 }}>
          <input type="hidden" name="back" value={backTo} />
          <b><Plus size={16} style={{ verticalAlign: -3 }} /> Add stock</b>
          <span className="tiny faint">For a starting count, or anything bought somewhere other than AMBIT. AMBIT orders come in by themselves.</span>
          <div className="grid2">
            <label className="field">
              <span className="label">Where</span>
              <select className="select sm" name="place" defaultValue={places[0] ? `${places[0].kind}:${places[0].id}` : ""}>
                {places.map((p) => <option key={`${p.kind}${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}{p.kind === "rig" ? " (rig)" : ""}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">What</span>
              <select className="select sm" name="item" required defaultValue="">
                <option value="" disabled>Pick…</option>
                {items.map((i) => <option key={i.item_key} value={JSON.stringify(i)}>{i.name}{i.foam === "iso" ? " (A side)" : i.foam === "resin" ? " (B side)" : ""}</option>)}
              </select>
            </label>
          </div>
          <div className="grid3">
            <label className="field">
              <span className="label">How many</span>
              <input className="input sm" name="qty" inputMode="decimal" required placeholder="2 (or 0.5)" />
            </label>
            <label className="field">
              <span className="label">ISO maker</span>
              <select className="select sm" name="maker" defaultValue="Covestro">
                {ISO_MAKERS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <span className="tiny faint">Only for ISO</span>
            </label>
            <label className="field">
              <span className="label">Lot # (on the drum)</span>
              <input className="input sm" name="lot" maxLength={60} placeholder="Optional" />
            </label>
          </div>
          <Submit className="btn sm" pendingText="Adding…">Add to stock</Submit>
        </form>
      ) : null}

      {open.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b><Truck size={16} style={{ verticalAlign: -3 }} /> On the way from AMBIT</b>
          <ul className="stock-list">
            {open.map((o) => (
              <li key={o.id}>
                <span className="grow col tight" style={{ minWidth: 0 }}>
                  <Link href={`/orders/${o.id}`} className="small">{orderNo(o.order_no)}</Link>
                  <span className="tiny faint ellipsis">{o.items.map((i) => `${qtyText(Number(i.qty))} ${i.name}`).join(" · ")}</span>
                </span>
                <span className="tiny faint">{o.scheduled_for ? dateShort(o.scheduled_for) : "Date not set yet"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(moves ?? []).length ? (
        <section className="col" style={{ gap: 8 }}>
          <b>Recent changes</b>
          <ul className="stock-log">
            {((moves ?? []) as Move[]).map((m) => (
              <li key={m.id}>
                <span className="tiny faint">{dateTime(m.at)}</span>
                <span className="small">
                  <b>{KIND[m.kind] ?? m.kind}</b> {unitsText(m.qty, m.unit)} {m.name}
                  {m.maker || m.lot_no ? ` (${lotText(m)})` : ""}
                  {m.kind === "move" ? ` · ${placeName(m.from_kind, m.from_id)} → ${placeName(m.to_kind, m.to_id)}` : m.to_kind ? ` · into ${placeName(m.to_kind, m.to_id)}` : m.from_kind ? ` · out of ${placeName(m.from_kind, m.from_id)}` : ""}
                  {m.note ? ` · ${m.note}` : ""}
                  {m.by_name ? ` · ${m.by_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
