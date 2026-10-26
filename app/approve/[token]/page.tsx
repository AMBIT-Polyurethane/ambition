import type { Metadata } from "next";
import { CircleAlert, CircleCheck, Clock, FileDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { docFromJson } from "@/lib/order-doc/load";
import { DELIVERY_LABEL, dateShort, dateTime, money, orderNo, plural, qtyText } from "@/lib/format";
import { foamLoads, splitNote } from "@/lib/order-doc/loads";
import { ApproveForm } from "./approve-form";

// The link is the key: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = { title: "Approve your order", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** The page the customer opens from the approval email. No account needed: the link itself is the key. */
export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("order_approval_view", { p_token: token });
  const doc = docFromJson(data);

  if (!doc) {
    return (
      <Frame>
        <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>This approval link isn&apos;t valid. It may have been replaced by a newer email. Ask your AMBIT rep to send the order again, or call AMBIT at (817) 677-1200.</span>
        </div>
      </Frame>
    );
  }

  const o = doc.order;
  const rep = o.placed_by_name ?? "your AMBIT rep";
  const repContact = [o.placed_by_phone, o.placed_by_email].filter(Boolean).join(" · ");
  const branch = doc.branch ? `${doc.branch.name}, ${doc.branch.state}` : null;

  return (
    <Frame>
      <div>
        <div className="eyebrow" style={{ color: "var(--red-text)" }}>Order for your approval</div>
        <h1 className="h1" style={{ marginTop: 6 }}>{orderNo(o.order_no)}</h1>
        <div className="muted">{o.company_name}{o.account_no ? ` · ${o.account_no}` : ""}</div>
      </div>

      {doc.state === "approved" ? (
        <div className="alert ok"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>Approved by {o.approved_by_name ?? "you"} on {dateTime(o.approved_at)}. AMBIT has your order and a copy is in your email.</span>
        </div>
      ) : doc.state === "changes_requested" ? (
        <div className="alert warn"><Clock size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>You asked for changes. {rep} will send you an updated order to approve.</span>
        </div>
      ) : doc.state === "expired" ? (
        <div className="alert warn"><Clock size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>This link expired on {dateShort(o.approval_expires_at)}. Ask {rep}{repContact ? ` (${repContact})` : ""} to send it again.</span>
        </div>
      ) : doc.state === "cancelled" ? (
        <div className="alert info"><span>This order was cancelled. Nothing will ship.</span></div>
      ) : doc.state === "pending" ? (
        <p className="muted" style={{ margin: 0 }}>
          {rep} at AMBIT put this order together for you. Check the items, quantities and delivery details, then approve it below. <b style={{ color: "var(--text)" }}>Nothing is picked or shipped until you approve.</b>
        </p>
      ) : null}

      <section className="card">
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Delivery</dt>
          <dd>
            {DELIVERY_LABEL[o.delivery_method]}
            {o.delivery_method === "pickup"
              ? `: ${branch ?? ""}${doc.branch?.address ? `\n${doc.branch.address}` : ""}`
              : `${branch && o.delivery_method === "jobsite" ? ` from ${branch}` : ""}\n${o.ship_address ?? ""}`}
          </dd>
          <dt>PO number</dt><dd>{o.po_number ?? "None"}</dd>
          <dt>Needed by</dt><dd>{o.needed_by ? dateShort(o.needed_by) : "Not set"}</dd>
          {o.notes ? (<><dt>Notes</dt><dd>{o.notes}</dd></>) : null}
          <dt>From</dt><dd>{rep}, AMBIT Polyurethane{repContact ? `\n${repContact}` : ""}</dd>
        </dl>
      </section>

      <section className="section">
        <div className="eyebrow">{doc.items.length} {doc.items.length === 1 ? "item" : "items"}</div>
        <div className="list">
          {foamLoads(doc.items).flatMap((g, gi) => g.rows.map((row, ri) => ({ row, i: row.item, gi, ri }))).map(({ row, i, gi, ri }) => (
            <div key={`${i.id}-${gi}-${ri}`} className={`product${gi > 0 && ri === 0 ? " load-break" : ""}`}>
              <div className="grow">
                <div className="name">{i.name}</div>
                <div className="desc">{i.sku} · <b>{qtyText(row.qty, i.unit)}</b></div>
                {splitNote(row, plural(i.unit, 2)) ? <div className="tiny faint">{splitNote(row, plural(i.unit, 2))}</div> : null}
              </div>
              <div style={{ textAlign: "right" }}>
                {i.customer_priced ? (
                  <span className="cp-tag">Account pricing</span>
                ) : i.line_total !== null ? (
                  <>
                    <div style={{ fontWeight: 800 }}>{money(row.qty === Number(i.qty) ? i.line_total : Number(i.unit_price ?? 0) * row.qty)}</div>
                    <div className="tiny faint">{money(i.unit_price)} / {i.unit}</div>
                  </>
                ) : (
                  <span className="tiny faint">On invoice</span>
                )}
              </div>
            </div>
          ))}
          <div className="row between" style={{ padding: "14px 16px" }}>
            <span className="muted small">Estimated list-price subtotal</span>
            <b>{money(o.est_subtotal)}</b>
          </div>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          {o.has_customer_pricing ? "Spray foam and fiberglass are billed at your account pricing. " : ""}
          Final pricing, tax and freight are confirmed on your AMBIT invoice.
        </p>
      </section>

      <div className="card small" style={{ borderColor: "var(--red)" }}>
        <b style={{ color: "var(--red-text)", letterSpacing: "0.08em" }}>THIS IS NOT AN INVOICE</b>
        <div className="muted" style={{ marginTop: 4 }}>This is an order form only. AMBIT&apos;s accounting staff will send the invoice after the order is approved.</div>
      </div>

      <a href={`/approve/${token}/pdf`} target="_blank" rel="noopener" className="btn dark block"><FileDown size={16} /> Download the order (PDF)</a>

      {doc.state === "pending" ? <ApproveForm token={token} defaultName={doc.company?.contact_name ?? ""} rep={rep} /> : null}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-light approve-page">
      <main className="shell no-tabs" style={{ maxWidth: 640 }}>
        <header className="row between" style={{ paddingTop: 6 }}>
          <img src="/brand/logo-dark.png" alt="AMBIT Polyurethane" style={{ height: 34, width: "auto" }} />
          <span className="tiny faint">(817) 677-1200</span>
        </header>
        {children}
        <p className="tiny faint center" style={{ margin: "8px 0 0" }}>AMBIT Polyurethane · orders@ambitpu.com · www.AMBITPU.com</p>
      </main>
    </div>
  );
}
