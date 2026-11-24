"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, LoaderCircle, Mail, PackageCheck, RefreshCw, Send, Truck, XCircle } from "lucide-react";
import { cancelEstimate, customerEmails, estimateToOrder, repriceEstimate, sendEstimate, setFreight, submitEstimate } from "@/app/(app)/estimates/actions";
import type { EstimateStatus } from "@/lib/estimates";

type Msg = { ok: boolean; text: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>
      {msg.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
      <span>{msg.text}</span>
    </div>
  );
}

/** The CRM's box: the quoted freight, and the tax rate if the table's isn't right. */
export function FreightForm({
  id,
  status,
  delivery,
  freight,
  freightNote,
  taxRate,
  taxManual,
  taxFreight,
  taxSource,
  validUntil,
}: {
  id: string;
  status: EstimateStatus;
  delivery: "pickup" | "jobsite";
  freight: number | null;
  freightNote: string | null;
  taxRate: number | null;
  taxManual: boolean;
  taxFreight: boolean;
  taxSource: string | null;
  validUntil: string | null;
}) {
  const router = useRouter();
  const [f, setF] = useState(freight === null ? "" : freight.toFixed(2));
  const [note, setNote] = useState(freightNote ?? "");
  const [rate, setRate] = useState(taxManual && taxRate !== null ? String(taxRate) : "");
  const [onFreight, setOnFreight] = useState(taxFreight);
  const [until, setUntil] = useState(validUntil ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, go] = useTransition();
  const first = status === "needs_freight";
  const save = () =>
    go(async () => {
      setMsg(null);
      const r = await setFreight(id, { freight: f, freight_note: note, tax_rate: rate, tax_freight: onFreight, valid_until: until });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: first ? "Freight added. It's ready to send, and the rep got an email." : "Saved." });
      router.refresh();
    });
  return (
    <section className={`card col${first ? " est-need" : ""}`} style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <Truck size={18} style={{ color: "var(--red-text)" }} />
        <b>{first ? "Add the freight" : delivery === "pickup" ? "Freight and tax" : "Change the freight or tax"}</b>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <label className="field">
          <span className="label">Quoted freight ($)</span>
          <input className="input" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} placeholder={delivery === "pickup" ? "0.00" : "350.00"} autoFocus={first} />
        </label>
        <label className="field">
          <span className="label">Carrier / note (on the estimate)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="LTL, liftgate, 2 pallets" />
        </label>
        <label className="field">
          <span className="label">Tax rate % (blank = rate table)</span>
          <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={taxRate !== null && !taxManual ? `${taxRate} (${taxSource ?? "table"})` : "8.25"} />
        </label>
        <label className="field">
          <span className="label">Good until</span>
          <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>
      {rate.trim() ? (
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={onFreight} onChange={(e) => setOnFreight(e.target.checked)} /> Tax the freight too
        </label>
      ) : null}
      <Note msg={msg} />
      <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={save}>
        {pending ? <LoaderCircle size={16} className="spin" /> : <CircleCheck size={16} />} {first ? "Save: ready to send" : "Save"}
      </button>
    </section>
  );
}

/** Rep or CRM: email it to the customer (priced again at today's prices first), with a PDF attached. */
export function SendForm({ id, companyId, sentTo, canSend, why }: { id: string; companyId: string; sentTo: string | null; canSend: boolean; why: string | null }) {
  const router = useRouter();
  const [to, setTo] = useState(sentTo ?? "");
  const [message, setMessage] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, go] = useTransition();
  const [looked, setLooked] = useState(Boolean(sentTo));
  const fill = () => {
    if (looked) return;
    setLooked(true);
    void customerEmails(companyId).then((list) => setTo((t) => t || list.slice(0, 2).join(", ")));
  };
  const send = () =>
    go(async () => {
      setMsg(null);
      const r = await sendEstimate(id, { to, message });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: `Sent to ${r.to.join(", ")}. You're copied, and replies go to the rep.` });
      router.refresh();
    });
  return (
    <section className="card col" style={{ gap: 10 }} onFocus={fill} onMouseEnter={fill}>
      <div className="row" style={{ gap: 8 }}>
        <Mail size={18} style={{ color: "var(--red-text)" }} />
        <b>{sentTo ? "Send it again" : "Send it to the customer"}</b>
      </div>
      {!canSend ? (
        <p className="small muted" style={{ margin: 0 }}>{why}</p>
      ) : (
        <>
          <label className="field">
            <span className="label">To (customer&apos;s email; separate several with commas)</span>
            <input className="input" type="email" multiple value={to} onChange={(e) => setTo(e.target.value)} placeholder="buyer@theircompany.com" />
          </label>
          <label className="field">
            <span className="label">Message (optional)</span>
            <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Here's the estimate for the Jones job we talked about." />
          </label>
          <span className="tiny faint">It&apos;s priced again at today&apos;s prices before it goes. The PDF is attached, and it says it&apos;s an estimate, not an order or invoice.</span>
          <Note msg={msg} />
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={send}>
            {pending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Send estimate
          </button>
        </>
      )}
    </section>
  );
}

/** The other buttons: done (to the CRMs), today's prices, turn into an order, cancel. */
export function EstimateButtons({ id, status, delivery, canOrder, canEdit }: { id: string; status: EstimateStatus; delivery: "pickup" | "jobsite"; canOrder: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [sure, setSure] = useState<null | "order" | "cancel">(null);
  const [pending, go] = useTransition();
  const live = status !== "converted" && status !== "cancelled";
  const run = (f: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) =>
    go(async () => {
      setMsg(null);
      const r = await f();
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: ok });
      router.refresh();
    });
  const toOrder = () =>
    go(async () => {
      setMsg(null);
      const r = await estimateToOrder(id);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      router.push(`/order?draft=${r.draft}`);
    });
  if (!live) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {status === "draft" && canEdit ? (
          <button type="button" className="btn" disabled={pending} onClick={() => run(() => submitEstimate(id), delivery === "pickup" ? "Ready to send." : "Sent to the CRMs for the freight.")}>
            <Send size={16} /> {delivery === "pickup" ? "Done: ready to send" : "Done: send to the CRMs for freight"}
          </button>
        ) : null}
        {canOrder ? (
          sure === "order" ? (
            <>
              <button type="button" className="btn" disabled={pending} onClick={toOrder}>{pending ? <LoaderCircle size={16} className="spin" /> : <PackageCheck size={16} />} Yes, open it as an order</button>
              <button type="button" className="btn ghost" onClick={() => setSure(null)}>Not yet</button>
            </>
          ) : (
            <button type="button" className="btn dark" disabled={pending} onClick={() => setSure("order")}><PackageCheck size={16} /> Turn into an order</button>
          )
        ) : null}
        <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => repriceEstimate(id), "Priced again at today's prices.")}>
          <RefreshCw size={15} /> Today&apos;s prices
        </button>
        {sure === "cancel" ? (
          <>
            <button type="button" className="btn danger" disabled={pending} onClick={() => run(() => cancelEstimate(id), "Cancelled.")}>Yes, cancel it</button>
            <button type="button" className="btn ghost" onClick={() => setSure(null)}>Keep it</button>
          </>
        ) : (
          <button type="button" className="btn ghost" disabled={pending} onClick={() => setSure("cancel")}><XCircle size={15} /> Cancel estimate</button>
        )}
      </div>
      {sure === "order" ? (
        <span className="tiny faint">The order screen opens with this customer, delivery and items. Check it and place it there. Prices are that day&apos;s, and the quoted freight is in the order notes.</span>
      ) : null}
      <Note msg={msg} />
    </div>
  );
}
