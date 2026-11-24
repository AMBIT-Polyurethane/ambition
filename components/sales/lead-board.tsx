"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, X } from "lucide-react";
import { moveLead, saveLead, type LeadInput } from "@/app/(app)/sales/actions";
import { STAGES, type Lead, type LeadStage } from "@/lib/crm-shared";
import { initials } from "@/lib/format";

const blank: LeadInput = { name: "", contact_name: "", phone: "", email: "", city: "", state: "", size_note: "", source: "", notes: "" };

/** New customers, from first conversation to their second order. Move a card with its arrows. */
export function LeadBoard({ leads, reps, me, all, customers }: { leads: Lead[]; reps: { id: string; name: string }[]; me: string; all: boolean; customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<LeadInput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, go] = useTransition();
  const live = leads.filter((l) => l.stage !== "lost");
  const lost = leads.filter((l) => l.stage === "lost");

  const move = (l: Lead, stage: LeadStage, why?: string) =>
    go(async () => {
      setErr(null);
      const r = await moveLead(l.id, stage, why);
      if (!r.ok) return setErr(r.error);
      setLostFor(null);
      setReason("");
      router.refresh();
    });
  const save = () =>
    go(async () => {
      if (!open) return;
      setErr(null);
      const r = await saveLead(open);
      if (!r.ok) return setErr(r.error);
      setOpen(null);
      router.refresh();
    });
  const edit = (l: Lead) =>
    setOpen({ id: l.id, name: l.name, contact_name: l.contact_name ?? "", phone: l.phone ?? "", email: l.email ?? "", city: l.city ?? "", state: l.state ?? "", size_note: l.size_note ?? "", source: l.source ?? "", notes: l.notes ?? "", rep_id: l.rep_id, company_id: l.company_id });
  const set = (k: keyof LeadInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setOpen((o) => (o ? { ...o, [k]: e.target.value } : o));

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="small muted">{live.length} open · {lost.length} lost in the last 60 days</span>
        <button type="button" className="b2 sm" onClick={() => setOpen({ ...blank, rep_id: me })}><Plus size={15} /> Add a lead</button>
      </div>
      {err ? <div className="alert err small" role="alert">{err}</div> : null}
      {open ? (
        <section className="card2 crm-lead-form" aria-label={open.id ? "Change lead" : "New lead"}>
          <div className="card2-h"><b>{open.id ? "Change lead" : "New lead"}</b><button type="button" className="iconbtn" aria-label="Close" onClick={() => setOpen(null)}><X size={18} /></button></div>
          <div className="crm-form-grid">
            <label className="field"><span className="label">Company</span><input className="input sm" value={open.name} onChange={set("name")} autoFocus /></label>
            <label className="field"><span className="label">Contact</span><input className="input sm" value={open.contact_name} onChange={set("contact_name")} /></label>
            <label className="field"><span className="label">Phone</span><input className="input sm" type="tel" value={open.phone} onChange={set("phone")} /></label>
            <label className="field"><span className="label">Email</span><input className="input sm" type="email" value={open.email} onChange={set("email")} /></label>
            <label className="field"><span className="label">City</span><input className="input sm" value={open.city} onChange={set("city")} /></label>
            <label className="field"><span className="label">State</span><input className="input sm" value={open.state} onChange={set("state")} maxLength={2} /></label>
            <label className="field"><span className="label">How big</span><input className="input sm" value={open.size_note} onChange={set("size_note")} placeholder="~6 sets a month, 2 rigs" /></label>
            <label className="field"><span className="label">Where from</span><input className="input sm" value={open.source} onChange={set("source")} placeholder="Trade show, referral, website…" /></label>
            {all ? (
              <label className="field"><span className="label">Rep</span>
                <select className="select sm" value={open.rep_id ?? ""} onChange={set("rep_id")}>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="field"><span className="label">Their customer account (once they have one)</span>
              <select className="select sm" value={open.company_id ?? ""} onChange={set("company_id")}>
                <option value="">Not yet</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <label className="field" style={{ padding: "0 18px" }}><span className="label">Notes</span><textarea className="textarea" rows={2} value={open.notes} onChange={set("notes")} /></label>
          <div className="row" style={{ gap: 10, padding: "12px 18px 16px" }}>
            <button type="button" className="b2 sm" onClick={save} disabled={pending || (open.name ?? "").trim().length < 2}>{pending ? <LoaderCircle size={15} className="spin" /> : null} Save</button>
            <button type="button" className="b2 quiet sm" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </section>
      ) : null}
      <div className="crm-board">
        {STAGES.map((s, si) => {
          const cards = live.filter((l) => l.stage === s.key);
          return (
            <section key={s.key} className="crm-col" aria-label={s.label}>
              <div className="crm-col-h"><b>{s.label}</b><span className="pill">{cards.length}</span></div>
              <span className="tiny faint">{s.hint}</span>
              {cards.map((l) => (
                <article key={l.id} className={`crm-card${l.days_in_stage >= 14 ? " stale" : ""}`}>
                  <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
                    <button type="button" className="crm-card-name" onClick={() => edit(l)}>{l.name}</button>
                    <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{l.days_in_stage ? `${l.days_in_stage} days` : "Today"}</span>
                  </div>
                  {l.contact_name || l.city ? <span className="tiny muted">{[l.contact_name, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span> : null}
                  {l.size_note ? <span className="tiny">{l.size_note}</span> : null}
                  {l.company_id ? <Link href={`/sales/customers/${l.company_id}`} className="tiny">{l.company_name ?? "Customer account"} · {l.orders} order{l.orders === 1 ? "" : "s"}</Link> : null}
                  <div className="row between" style={{ gap: 6, marginTop: 2 }}>
                    <span className="row" style={{ gap: 4 }}>
                      <button type="button" className="crm-mv" aria-label={`Move ${l.name} back`} disabled={pending || si === 0} onClick={() => move(l, STAGES[si - 1].key)}><ArrowLeft size={14} /></button>
                      <button type="button" className="crm-mv" aria-label={`Move ${l.name} to ${STAGES[si + 1]?.label ?? ""}`} disabled={pending || si === STAGES.length - 1} onClick={() => move(l, STAGES[si + 1].key)}><ArrowRight size={14} /></button>
                      <button type="button" className="crm-mv lost" onClick={() => setLostFor(l.id)} disabled={pending}>Lost</button>
                    </span>
                    {all && l.rep_name ? <span className="crm-rep" title={l.rep_name}>{initials(l.rep_name)}</span> : null}
                  </div>
                  {lostFor === l.id ? (
                    <div className="col" style={{ gap: 6 }}>
                      <input className="input sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (price, went with Lapolla…)" aria-label="Why it was lost" autoFocus />
                      <div className="row" style={{ gap: 6 }}>
                        <button type="button" className="b2 sm danger" onClick={() => move(l, "lost", reason)} disabled={pending}>Mark lost</button>
                        <button type="button" className="b2 quiet sm" onClick={() => setLostFor(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      {lost.length ? (
        <details className="card2" style={{ padding: "12px 18px" }}>
          <summary className="small"><b>Lost in the last 60 days ({lost.length})</b></summary>
          <ul className="crm-lost">
            {lost.map((l) => (
              <li key={l.id}>
                <b className="small">{l.name}</b>
                <span className="tiny faint">{l.lost_reason ?? "No reason given"}{all && l.rep_name ? ` · ${l.rep_name}` : ""}</span>
                <button type="button" className="b2 quiet sm" onClick={() => move(l, "lead")} disabled={pending}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
