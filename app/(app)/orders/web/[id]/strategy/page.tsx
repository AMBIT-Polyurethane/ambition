import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, ChevronLeft, CircleAlert, Factory, Package, RefreshCw, Truck, Warehouse } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { money, monthDay } from "@/lib/format";
import type { PlanOption, Shipment, Strategy } from "@/lib/adc-logistics";
import { recalcAdcStrategy } from "../../actions";
import { PrintButton } from "./print";

export const metadata = { title: "Best Strategy" };
export const dynamic = "force-dynamic";

type Row = {
  id: number; created_at: string; name: string; company: string | null; email: string; phone: string; delivery: string; pickup_branch: string | null;
  address: { street: string; street2?: string; city: string; state: string; zip: string } | null; subtotal: number; match: string | null;
  company_id: string | null; ship_est: number | null; strategy: Strategy | null; alerts: string[] | null; site: string | null; unload: string | null; tax_exempt: boolean | null;
};
const KIND: Record<Shipment["kind"], string> = { parcel: "Parcel (UPS / FedEx Ground)", ltl: "LTL freight", truck: "Full truck", vendor: "Vendor ships", pickup: "Customer picks up" };
const MATCH: Record<string, [string, string]> = {
  verified: ["AMBIT customer (verified)", "pill2 ok sm"],
  unverified: ["Not verified: prepay until confirmed", "pill2 err sm"],
  added: ["New customer: added to A.I.", "pill2 err sm"],
  new: ["New customer", "pill2 err sm"],
};

function Plan({ o, best }: { o: PlanOption; best: boolean }) {
  return (
    <section className={`card2 bs-plan${best ? " best" : ""}${o.ok ? "" : " no"}`}>
      <div className="bs-plan-h">
        <span>{best ? <span className="pill2 ok sm">Best</span> : null} <b>{o.title}</b></span>
        <b className="bs-cost">{o.ok ? (o.total === null ? `${money(o.shipments.reduce((t, s) => t + (s.cost ?? 0), 0))} + quotes` : money(o.total)) : "Not possible"}</b>
      </div>
      {o.ok ? (
        <>
          <div className="small muted">{o.shipments.length} {o.shipments.length === 1 ? "shipment" : "shipments"}{o.days ? ` · ${o.days}` : ""}</div>
          {o.transfers.length ? (
            <div className="bs-transfers">
              <b className="small">Transfers first</b>
              {o.transfers.map((t, i) => (
                <span key={i} className="small"><Warehouse size={14} aria-hidden="true" /> {t.qty} x {t.sku} · {t.fromName} <ArrowRight size={13} aria-hidden="true" /> {t.toName}</span>
              ))}
            </div>
          ) : null}
          <table className="webo-t">
            <thead><tr><th>From</th><th>How</th><th>What</th><th className="n">Weight</th><th className="n">Miles</th><th className="n">Est.</th><th>Time</th></tr></thead>
            <tbody>
              {o.shipments.map((s, i) => (
                <tr key={i}>
                  <td>{s.kind === "vendor" ? <Factory size={14} aria-hidden="true" /> : <Package size={14} aria-hidden="true" />} {s.fromName}</td>
                  <td>{KIND[s.kind]}</td>
                  <td>{s.lines.map((l) => `${l.qty} x ${l.sku}`).join(", ")}{s.note ? <div className="tiny faint">{s.note}</div> : null}</td>
                  <td className="n">{Math.round(s.weight).toLocaleString("en-US")} lb</td>
                  <td className="n">{s.miles === null ? "-" : s.miles.toLocaleString("en-US")}</td>
                  <td className="n"><b>{s.cost === null ? "Quote" : money(s.cost)}</b></td>
                  <td className="small">{s.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="small muted">{o.why}</div>
      )}
    </section>
  );
}

/** One ADC web order's Best Strategy: who the customer is, what to do first, and the ways to ship it, best first. */
export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();
  if (!isEmployee(profile) || !(profile.role === "admin" || can(profile, "order_desk") || can(profile, "ordering"))) redirect("/");
  const { data } = await supabase.from("adc_orders").select("*").eq("id", Number(id)).maybeSingle();
  const o = data as Row | null;
  if (!o) notFound();
  const s = o.strategy;
  const opts = s ? [...s.options].sort((a, b) => (a.key === s.best ? -1 : b.key === s.best ? 1 : Number(b.ok) - Number(a.ok))) : [];
  const [mLabel, mPill] = MATCH[o.match ?? ""] ?? ["Customer not checked", "pill2 sm"];
  const a = o.address;
  return (
    <main className="shell wide bs">
      <div className="o2-head">
        <div className="o2-head-l">
          <Link href="/orders/web" className="o2-back" aria-label="Back to web orders"><ChevronLeft size={22} /></Link>
          <div className="o2-title">
            <h1>Best Strategy · ADC-{1000 + o.id}</h1>
            <span className="o2-sub">{o.company || o.name} · {monthDay(o.created_at)} · {money(o.subtotal)}</span>
          </div>
        </div>
        <div className="o2-head-r bs-noprint">
          <form action={recalcAdcStrategy}>
            <input type="hidden" name="id" value={o.id} />
            <button type="submit" className="b2 quiet sm"><RefreshCw size={16} /> Run again with today&apos;s stock</button>
          </form>
          <PrintButton />
        </div>
      </div>

      {o.alerts?.length ? (
        <div className="bs-red" role="alert">
          <b><CircleAlert size={20} aria-hidden="true" /> Action needed before this ships</b>
          {o.alerts.map((x, i) => <span key={i}>{x}</span>)}
        </div>
      ) : null}

      <section className="card2 bs-who">
        <span><span className={mPill}>{mLabel}</span>{o.company_id ? <> <Link href={`/customers/${o.company_id}`} className="small">Open the customer</Link></> : null}</span>
        <span className="small"><b>{o.name}</b>{o.company ? ` · ${o.company}` : ""} · {o.phone} · {o.email}</span>
        <span className="small">
          <Truck size={14} aria-hidden="true" />{" "}
          {o.delivery === "pickup" ? `Picks up at ${o.pickup_branch ?? "?"}` : a ? `${o.delivery === "truckload" ? "Full truck to" : "Ship to"} ${a.street}, ${a.city}, ${a.state} ${a.zip}` : "No address"}
          {o.delivery !== "pickup" ? ` · ${o.site === "home" ? "home / job site" : "business"} · ${o.unload === "liftgate" ? "needs a liftgate" : o.unload === "forklift" ? "has a forklift" : "has a dock"}` : ""}
          {o.tax_exempt ? " · says tax exempt" : ""}
        </span>
        {s ? <span className="small">{Math.round(s.weight).toLocaleString("en-US")} lb in all{o.delivery !== "pickup" && s.estimate !== null ? ` · customer was shown ${money(s.estimate)} estimated shipping` : ""} · figured {monthDay(s.at)}</span> : null}
      </section>

      {!s ? (
        <div className="card2">No Best Strategy on this order yet (it came in before the update). Click <b>Run again with today&apos;s stock</b>.</div>
      ) : (
        <>
          {opts.map((p) => <Plan key={p.key + p.title} o={p} best={p.key === s.best} />)}
          {s.vendor.length ? (
            <section className="card2">
              <b>Not enough stock at any location: order from the vendor</b>
              <ul className="small">{s.vendor.map((v) => <li key={v.sku}>{v.qty} x {v.sku} {v.name}{v.vendor ? ` · ${v.vendor}` : " · vendor not set on the product"}{v.lead ? ` · ${v.lead} days lead time` : ""}</li>)}</ul>
            </section>
          ) : null}
          {s.notes.length ? <section className="card2 small muted">{s.notes.map((n, i) => <div key={i}>{n}</div>)}</section> : null}
          <p className="tiny faint">Estimates use carrier-style rates by weight and distance (fuel and a 10% cushion included, rounded up). Get a real quote before you bill freight.</p>
        </>
      )}
    </main>
  );
}
