import Link from "next/link";
import { ArrowDownLeft, CircleCheck } from "lucide-react";
import { Submit } from "@/components/forms";
import { dateShort, dateTime, money, orderNo } from "@/lib/format";
import { receiveReturn } from "@/app/(app)/orders/return-actions";

export type ReturnLine = {
  id: number; sku: string; name: string; unit: string | null; qty: number; lot_no: string | null; mfg: string | null; exp: string | null;
  condition: "stock" | "damaged"; unit_credit: number | null; line_credit: number | null; note: string | null;
  inbound_id: number | null; received_at: string | null; received_by_name: string | null;
};

/** On an exchange or return (0065): what's coming back, the credit, and receiving it back into stock. */
export function OrderReturnsCard({
  orderId, kind, reason, originalNo, originalId, lines, outTotal, outAccount, canReceive,
}: {
  orderId: string;
  kind: "return" | "exchange";
  reason: string | null;
  originalNo: number | null;
  originalId: string | null;
  lines: ReturnLine[];
  /** The replacement's list-price total (exchange), and whether any of it is account priced. */
  outTotal: number;
  outAccount: boolean;
  canReceive: boolean;
}) {
  const credit = lines.reduce((s, l) => s + Number(l.line_credit ?? 0), 0);
  const waiting = lines.filter((l) => !l.inbound_id);
  const received = lines.filter((l) => l.inbound_id);
  const reports = [...new Set(received.map((l) => l.inbound_id))];
  return (
    <section className="card col ret-card" style={{ gap: 10 }}>
      <div className="row between" style={{ gap: 8 }}>
        <span className="eyebrow">{kind === "exchange" ? "Exchange" : "Return"} · coming back</span>
        <span className={`pill ${waiting.length ? "warn" : "ok"}`}>{waiting.length ? "Waiting to come back" : "Received"}</span>
      </div>
      {reason ? <span className="small">Reason: <b>{reason}</b></span> : null}
      {originalNo && originalId ? <span className="small muted">From <Link href={`/orders/${originalId}`}>{orderNo(originalNo)}</Link></span> : null}
      <div className="list">
        {lines.map((l) => (
          <div key={l.id} className="product">
            <ArrowDownLeft size={18} className="red" style={{ flex: "none" }} />
            <div className="grow">
              <div className="name">{l.name}</div>
              <div className="desc">
                {l.sku} · {Number(l.qty)} {l.unit ?? ""}
                {l.lot_no ? ` · Lot ${l.lot_no}` : ""}
                {l.mfg ? ` · Mfg ${dateShort(l.mfg)}` : ""}
                {l.exp ? ` · Exp ${dateShort(l.exp)}` : ""}
              </div>
              <div className="tiny faint">
                {l.condition === "damaged" ? "Damaged: not going back into stock" : "Back into stock"}
                {l.note ? ` · ${l.note}` : ""}
                {l.received_at ? ` · received ${dateTime(l.received_at)}${l.received_by_name ? ` by ${l.received_by_name}` : ""}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>{l.line_credit !== null ? <b>−{money(Number(l.line_credit))}</b> : <span className="tiny faint">Credit on invoice</span>}</div>
          </div>
        ))}
      </div>
      <div className="col" style={{ gap: 4 }}>
        <div className="row between"><span className="muted small">Credit for what comes back</span><b>{credit ? `−${money(credit)}` : "–"}</b></div>
        {kind === "exchange" ? (
          <div className="row between">
            <span className="small"><b>Customer pays the difference</b></span>
            <b className="red">{!outAccount && credit ? money(Math.max(0, outTotal - credit)) : "New items' price − the credit (set at the Sales Order # step)"}</b>
          </div>
        ) : null}
      </div>
      {reports.length ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {reports.map((r) => (
            <Link key={r} href={`/inventory/incoming/${r}`} className="btn sm dark"><CircleCheck size={14} /> Receiving Report #{r}</Link>
          ))}
        </div>
      ) : null}
      {waiting.length && canReceive ? (
        <form action={receiveReturn} className="no-print">
          <input type="hidden" name="id" value={orderId} />
          <Submit className="btn block" pendingText="Receiving…">Receive the returned items</Submit>
          <span className="tiny faint">Makes a Receiving Report with the lots and dates above. Good items go back into stock (after an admin approves it); damaged ones don&apos;t.</span>
        </form>
      ) : null}
    </section>
  );
}
