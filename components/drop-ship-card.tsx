import { PackageCheck, Send, Truck } from "lucide-react";
import { dropShipLines, dropShipsSent } from "@/lib/drop-ship";
import { sendDropShipNow } from "@/app/(app)/orders/actions";
import { Submit } from "@/components/forms";

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const LABEL = { new: "New: they're getting it ready", shipped: "Shipped", done: "Done (delivered and billed)", cancelled: "Cancelled by them" } as const;

/** Staff only: the order's gun parts that Contractors Foam Supply drop ships, and where that order stands on their side. */
export async function DropShipCard({ orderId, canSend, open }: { orderId: string; canSend: boolean; open: boolean }) {
  const [lines, sent] = await Promise.all([dropShipLines(orderId), dropShipsSent(orderId)]);
  if (!lines.length && !sent.length) return null;
  const cost = lines.reduce((s, l) => s + (l.cost ?? 0) * l.qty, 0);
  return (
    <section className="card2" aria-label="Drop ship">
      <div className="card2-h">
        <b style={{ whiteSpace: "nowrap" }}><Truck size={17} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> Drop ship</b>
        <span className="up2-sub">Contractors Foam Supply ships these straight to the customer and bills AMBIT for the parts and the shipping. They never come out of our stock.</span>
      </div>
      <div className="col" style={{ gap: 8, padding: "4px 16px 16px" }}>
        {lines.map((l) => (
          <span key={l.item_id} className="row between small" style={{ gap: 10 }}>
            <span><span className="mono muted">{l.sku}</span> {l.qty} × {l.name}</span>
            <span className="muted">{l.cost === null ? "price to confirm" : `${usd(l.cost)} ea to us`}</span>
          </span>
        ))}
        {lines.length ? <span className="small"><b>Our cost:</b> {usd(cost)}{lines.some((l) => l.cost === null) ? " + parts to price" : ""}, plus their shipping</span> : null}
      {sent.length ? (
        sent.map((d) => (
          <div key={d.no} className="alert ok small" style={{ margin: 0 }}>
            <PackageCheck size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>
              Sent to {d.partnerName} as <b>{d.no}</b> on {new Date(d.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Status: <b>{LABEL[d.status]}</b>
              {d.tracking ? <> · Tracking <b>{d.tracking}</b></> : null}
              {d.shipCost !== null ? <> · Shipping they billed: <b>{usd(d.shipCost)}</b></> : null}
              {` · Parts: ${usd(d.subtotal)}${d.hasQuote ? " + to price" : ""}`}
            </span>
          </div>
        ))
      ) : open ? (
        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="small muted">Not sent yet. These go to Contractors Foam Supply automatically when the order is released at the credit check.</span>
          {canSend ? (
            <form action={sendDropShipNow}>
              <input type="hidden" name="id" value={orderId} />
              <Submit className="b2 quiet sm" pendingText="Sending…"><Send size={15} /> Send to them now</Submit>
            </form>
          ) : null}
        </div>
      ) : null}
      </div>
    </section>
  );
}
