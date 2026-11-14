"use client";

import { useEffect, useState } from "react";
import { CircleCheck, HandCoins, X } from "lucide-react";
import { PaymentForm, type OpenInv } from "@/components/credit/payment-form";

/** The Record payment button on the customer dashboard: opens a side panel (full screen on a phone). */
export function PaymentDrawer({ company, name, invoices, terms, admin, setter, today, open: start = false }: {
  company: string; name: string; invoices: OpenInv[]; terms: string | null; admin: boolean; setter: boolean; today: string; open?: boolean;
}) {
  const [open, setOpen] = useState(start);
  const [done, setDone] = useState("");
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => { setDone(""); setOpen(true); }}><HandCoins size={15} /> Record payment</button>
      {done ? <div className="alert ok pay-done" role="status"><CircleCheck size={18} /><span>{done}</span><button type="button" className="icon-btn" onClick={() => setDone("")} aria-label="Dismiss"><X size={16} /></button></div> : null}
      {open ? (
        <div className="drawer-back" onClick={() => setOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Record a payment for ${name}`} onClick={(e) => e.stopPropagation()}>
            <header className="drawer-head">
              <div className="col tight" style={{ minWidth: 0 }}><b>Record a payment</b><span className="tiny faint ellipsis">{name}</span></div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
            </header>
            <div className="drawer-body">
              <PaymentForm company={company} invoices={invoices} terms={terms} admin={admin} setter={setter} today={today} onDone={(said) => { setDone(said); setOpen(false); }} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
