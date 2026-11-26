"use client";

import { useState, useTransition } from "react";
import { MessageSquareText, LoaderCircle } from "lucide-react";
import { saveMySms } from "@/app/(app)/profile/sms-actions";

/** Profile: text alerts (staff) or order texts (contractors), with the mobile they go to. */
export function MyTexts({ phone, on, staff, admin }: { phone: string | null; on: boolean; staff: boolean; admin: boolean }) {
  const [num, setNum] = useState(phone ?? "");
  const [want, setWant] = useState(on);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();
  const save = () => go(async () => { setMsg(null); const r = await saveMySms({ phone: num, on: want }); setMsg(r.ok ? { ok: true, text: r.msg } : { ok: false, text: r.error }); });
  return (
    <section className="card col" style={{ gap: 10 }} aria-label="Texts">
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <MessageSquareText size={18} aria-hidden />
        <b>{staff ? "Text alerts" : "Order texts"}</b>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {staff
          ? `Get a text when an order hands off to you (credit released, ready to schedule, pickup today)${admin ? ", and when something waits on you (price requests, lot fixes, expense reports)" : ""}.`
          : "Get texts about your AMBIT orders: approval links, scheduled pickups and deliveries, and when they're picked up or delivered."}
      </p>
      <input className="input sm" type="tel" inputMode="tel" value={num} onChange={(e) => setNum(e.target.value)} placeholder="Mobile number" aria-label="Mobile number" />
      <label className="check small">
        <input type="checkbox" checked={want} onChange={(e) => setWant(e.target.checked)} />
        <span>Text me at this number. Message and data rates may apply; reply STOP to opt out anytime, HELP for help.</span>
      </label>
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn sm" disabled={pending} onClick={save}>{pending ? <LoaderCircle size={15} className="spin" /> : null} Save</button>
        {msg ? <span className={`small ${msg.ok ? "ok-text" : "err-text"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</span> : null}
      </div>
    </section>
  );
}
