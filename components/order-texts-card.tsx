"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, LoaderCircle } from "lucide-react";
import { setOrderSms } from "@/app/(app)/orders/sms-actions";

const pretty = (p: string | null) => {
  const d = String(p ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p ?? "";
};

/** Staff: the customer mobile that gets this order's texts (approval link, scheduled, picked up / delivered). */
export function OrderTextsCard({ orderId, phone, ready, optedOut }: { orderId: string; phone: string | null; ready: boolean; optedOut: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [num, setNum] = useState(pretty(phone));
  const [agreed, setAgreed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const save = (clear = false) =>
    go(async () => {
      setMsg(null);
      const r = await setOrderSms({ order: orderId, phone: clear ? "" : num, agreed });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: r.msg });
      setEdit(false);
      router.refresh();
    });
  return (
    <section className="card2" aria-label="Customer texts" style={{ padding: "14px 18px" }}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <MessageSquareText size={18} aria-hidden style={{ color: "var(--text2)" }} />
        <b className="small" style={{ flex: 1 }}>Customer texts</b>
        {!edit ? <button type="button" className="b2 quiet sm" onClick={() => (setEdit(true), setMsg(null))}>{phone ? "Change" : "Add a mobile"}</button> : null}
      </div>
      {!edit ? (
        <p className="tiny faint" style={{ margin: "6px 0 0" }}>
          {phone ? <>Approval link, scheduled, and picked up / delivered go to <b>{pretty(phone)}</b>{optedOut ? " (replied STOP: no texts until they reply START)" : ""}.</> : "No texts on this order. Add the customer's mobile if they want texts."}
          {!ready ? " Texting isn't switched on yet." : ""}
        </p>
      ) : (
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          <input className="input sm" inputMode="tel" value={num} onChange={(e) => setNum(e.target.value)} placeholder="(405) 555-0134" aria-label="Customer mobile" />
          <label className="check small"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <span>The customer agreed to get texts about their orders</span></label>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="b2 sm" disabled={pending} onClick={() => save()}>{pending ? <LoaderCircle size={14} className="spin" /> : null} Save</button>
            {phone ? <button type="button" className="b2 quiet sm" disabled={pending} onClick={() => save(true)}>Stop texts on this order</button> : null}
            <button type="button" className="b2 quiet sm" disabled={pending} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg ? <p className={`tiny ${msg.ok ? "ok-text" : "err-text"}`} style={{ margin: "6px 0 0" }} role={msg.ok ? "status" : "alert"}>{msg.text}</p> : null}
    </section>
  );
}
