import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download, FileText, Pencil } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can, canEstimate, canFreight } from "@/lib/access";
import { dateShort, dateTime, money, plural } from "@/lib/format";
import { ESTIMATE_STATUS, deliveryText, estNo, loadEstimate, partsText } from "@/lib/estimates";
import { TopBar } from "@/components/ui";
import { EstimateButtons, FreightForm, SendForm } from "@/components/estimates/estimate-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimate" };

const STEPS = [
  { key: "draft", label: "Rep lists the items" },
  { key: "needs_freight", label: "CRM adds freight" },
  { key: "ready", label: "Send to customer" },
  { key: "converted", label: "Order" },
] as const;

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireEmployee();
  if (!canEstimate(profile)) redirect("/");
  const d = await loadEstimate(supabase, id);
  if (!d) notFound();
  const { est: e, items } = d;
  const { data: b } = e.branch_id ? await supabase.from("branches").select("name").eq("id", e.branch_id).maybeSingle<{ name: string }>() : { data: null };
  const { data: ord } = e.order_id ? await supabase.from("orders").select("order_no").eq("id", e.order_id).maybeSingle<{ order_no: number }>() : { data: null };
  const st = ESTIMATE_STATUS[e.status];
  const freightOk = canFreight(profile);
  const live = e.status !== "converted" && e.status !== "cancelled";
  const at = e.status === "sent" ? 2 : e.status === "cancelled" ? -1 : STEPS.findIndex((s) => s.key === e.status);
  const rate = e.tax_rate === null ? null : Number(e.tax_rate).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const canSend = e.status === "ready" || e.status === "sent";

  return (
    <main className="shell full">
      <TopBar
        title={`${estNo(e.est_no)} · ${e.company_name}`}
        back="/estimates"
        right={
          <a className="btn sm dark" href={`/estimates/${e.id}/pdf`} target="_blank" rel="noreferrer">
            <FileText size={15} /> PDF
          </a>
        }
      />
      <div className="est-layout">
        <div className="col" style={{ gap: 14 }}>
          {e.status !== "cancelled" ? (
            <div className="est-steps" aria-label="Where this estimate is">
              {STEPS.map((s, i) => (
                <div key={s.key} className={i < at || e.status === "converted" ? "done" : i === at ? "now" : ""}>
                  {i + 1}. {s.label}
                  <span>
                    {i === 0 ? e.created_by_name ?? "" : i === 1 ? (e.delivery_method === "pickup" ? "Pickup: no freight" : e.freight_by_name ?? "") : i === 2 ? (e.sent_at ? `Sent ${dateShort(e.sent_at)}` : "") : ord ? `Order ${ord.order_no}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <section className="card col" style={{ gap: 10 }}>
            <div className="row between wrap" style={{ gap: 8 }}>
              <div className="col tight">
                <b style={{ fontSize: 17 }}>{e.company_name}</b>
                <span className="small muted">{deliveryText(e, b?.name ?? null)}</span>
              </div>
              <span className={`pill ${st.pill}`} title={st.hint}>{st.label}</span>
            </div>
            <div className="tiny faint">
              Built by {e.created_by_name ?? "?"} on {dateShort(e.created_at)} · priced {dateShort(e.priced_on)} from {e.company_name}&apos;s price list
              {e.valid_until ? ` · good until ${dateShort(e.valid_until)}` : ""}
            </div>
            <div className="cr-wrap">
              <table className="cr-table est-lines">
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const parts = partsText(it, items, money);
                    return (
                      <tr key={it.id}>
                        <td>
                          <b>{it.sku}</b> <span className="small muted">{it.name}</span>
                          {it.basis === "lb" && it.per_price !== null && !parts ? <div className="tiny faint">{money(it.per_price)}/lb{it.price_source === "customer" ? " (their price)" : " (base price)"}</div> : null}
                          {parts ? <div className="tiny faint">{parts}</div> : null}
                        </td>
                        <td>{it.qty} {plural(it.unit, it.qty)}</td>
                        <td>{it.unit_price === null ? <span className="warn-t small">Call</span> : money(it.unit_price)}</td>
                        <td><b>{it.line_total === null ? "–" : money(it.line_total)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {e.customer_note ? <div className="small"><span className="label">Note for the customer</span><div style={{ whiteSpace: "pre-wrap" }}>{e.customer_note}</div></div> : null}
            {e.staff_note ? <div className="small"><span className="label">AMBIT only</span><div style={{ whiteSpace: "pre-wrap" }}>{e.staff_note}</div></div> : null}
            {live ? (
              <div className="row wrap" style={{ gap: 8 }}>
                <Link href={`/estimates/${e.id}/edit`} className="btn sm dark"><Pencil size={14} /> Change items or delivery</Link>
                <a className="btn sm ghost" href={`/estimates/${e.id}/pdf?download=1`}><Download size={14} /> Download PDF</a>
              </div>
            ) : null}
          </section>

          {live ? <EstimateButtons id={e.id} status={e.status} delivery={e.delivery_method} canOrder={can(profile, "ordering")} canEdit /> : null}
          {e.status === "converted" && e.order_id ? (
            <div className="alert ok small">
              <span>Turned into {ord ? <Link href={`/orders/${e.order_id}`}>order {ord.order_no}</Link> : "an order"}{e.converted_at ? ` on ${dateTime(e.converted_at)}` : ""}{e.converted_by_name ? ` by ${e.converted_by_name}` : ""}.</span>
            </div>
          ) : null}
        </div>

        <div className="col" style={{ gap: 14 }}>
          <section className="card est-tot">
            <div><span className="muted">Items</span><span>{money(e.subtotal)}</span></div>
            <div>
              <span className="muted">Freight{e.freight_note && e.delivery_method !== "pickup" ? ` (${e.freight_note})` : ""}</span>
              <span>{e.delivery_method === "pickup" ? "Pickup" : e.freight === null ? <span className="warn-t">Needs a CRM</span> : money(e.freight)}</span>
            </div>
            <div>
              <span className="muted">
                Sales tax{e.tax_exempt ? " (exempt: certificate on file)" : rate !== null ? ` ${rate}%` : ""}
                {!e.tax_exempt && e.tax_source ? <span className="tiny faint" style={{ display: "block" }}>{e.tax_source}{e.tax_freight ? "" : ", not on freight"}</span> : null}
              </span>
              <span>{e.tax === null ? <span className="warn-t" title="Add a rate in Estimates > Tax rates, or a CRM can type one">No rate</span> : money(e.tax)}</span>
            </div>
            <div className="grand"><span>Total</span><span>{money(e.total ?? e.subtotal)}</span></div>
            {e.has_unpriced ? <span className="tiny warn-t">Some items have no price for this customer (they show as Call).</span> : null}
            {e.sent_at ? <span className="tiny faint">Sent {dateTime(e.sent_at)} to {e.sent_to}{e.sent_by_name ? ` by ${e.sent_by_name}` : ""}</span> : null}
          </section>

          {live && freightOk && (e.status !== "draft" || e.delivery_method === "jobsite") ? (
            <FreightForm
              id={e.id}
              status={e.status}
              delivery={e.delivery_method}
              freight={e.freight}
              freightNote={e.freight_note}
              taxRate={e.tax_rate}
              taxManual={e.tax_rate_manual}
              taxFreight={e.tax_freight}
              taxSource={e.tax_source}
              validUntil={e.valid_until}
            />
          ) : null}
          {live ? (
            <SendForm
              id={e.id}
              companyId={e.company_id}
              sentTo={e.sent_to}
              canSend={canSend}
              why={
                e.status === "draft"
                  ? `Click "Done" first${e.delivery_method === "jobsite" ? ": a CRM adds the freight, then it can be sent" : ""}.`
                  : e.status === "needs_freight"
                    ? "Waiting for a CRM to add the freight. The rep gets an email when it's ready."
                    : null
              }
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
