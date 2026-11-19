"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Building2, Check, CircleAlert, Copy, KeyRound, LoaderCircle, Mail, Plus, Search, Send, Trash2, UserRound } from "lucide-react";
import { saveCustomer, sendPartnerInvite, setCustomerPrice, type CustomerInput } from "@/app/store/desk-actions";

export type DeskCustomer = {
  id: string;
  company: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  terms: string | null;
  off_pct: number;
  notes: string | null;
  active: boolean;
  has_login: boolean;
  invited_at: string | null;
};
export type DeskPriceItem = { id: string; sku: string; name: string; image_url: string | null; price: number | null; per_customer: boolean };

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const show = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function DeskCustomers({ slug, customers: start, items, prices: startPrices, readOnly, pick }: { slug: string; customers: DeskCustomer[]; items: DeskPriceItem[]; prices: Record<string, Record<string, number>>; readOnly: boolean; pick: string | null }) {
  const [customers, setCustomers] = useState(start);
  const [prices, setPrices] = useState(startPrices);
  const [sel, setSel] = useState<string | "new" | null>(pick ?? start[0]?.id ?? null);
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = customers.filter((c) => words.every((w) => `${c.company} ${c.contact ?? ""} ${c.email ?? ""} ${c.city ?? ""}`.toLowerCase().includes(w)));
  const cur = sel === "new" ? null : customers.find((c) => c.id === sel) ?? null;
  return (
    <div className="adc-stack-s">
      <div className="ptn-desk-h">
        <span>
          <h1 className="adc-h1">Customers</h1>
          <span className="adc-muted">Your contractors: their info, their prices and their logins. They only see their own prices.</span>
        </span>
        {!readOnly ? <button type="button" className="adc-cta" onClick={() => setSel("new")}><Plus size={18} aria-hidden="true" /> Add a customer</button> : null}
      </div>
      <div className="ptn-cust">
        <div className="ptn-cust-list">
          <label className="adc-search light"><Search size={18} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer" aria-label="Find a customer" /></label>
          {list.map((c) => (
            <button key={c.id} type="button" className={sel === c.id ? "on" : undefined} onClick={() => setSel(c.id)}>
              <Building2 size={18} aria-hidden="true" />
              <span>
                <b>{c.company}</b>
                <span>{[c.contact, c.city].filter(Boolean).join(" · ") || c.email || "No contact yet"}</span>
                <span className={`ptn-login${c.has_login ? " on" : c.invited_at ? " sent" : ""}`}>{c.has_login ? "Has a login" : c.invited_at ? "Invite sent" : "No login yet"}{c.active ? "" : " · Inactive"}</span>
              </span>
            </button>
          ))}
          {!list.length ? <span className="adc-muted small" style={{ padding: 8 }}>No customers match.</span> : null}
        </div>
        <div className="ptn-cust-b">
          {sel === "new" ? (
            <CustomerForm
              slug={slug}
              c={null}
              readOnly={readOnly}
              onSaved={(row) => {
                setCustomers((cur) => [...cur, row].sort((a, b) => a.company.localeCompare(b.company)));
                setSel(row.id);
              }}
            />
          ) : cur ? (
            <CustomerDetail
              key={cur.id}
              slug={slug}
              c={cur}
              items={items}
              prices={prices[cur.id] ?? {}}
              readOnly={readOnly}
              onSaved={(row) => setCustomers((all) => all.map((x) => (x.id === row.id ? row : x)))}
              onPrice={(itemId, v) => setPrices((all) => {
                const mine = { ...(all[cur.id] ?? {}) };
                if (v === null) delete mine[itemId];
                else mine[itemId] = v;
                return { ...all, [cur.id]: mine };
              })}
            />
          ) : (
            <div className="adc-empty"><UserRound size={28} aria-hidden="true" /><b>No customers yet.</b><span>Add your first contractor, then send them a login.</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerDetail({ slug, c, items, prices, readOnly, onSaved, onPrice }: { slug: string; c: DeskCustomer; items: DeskPriceItem[]; prices: Record<string, number>; readOnly: boolean; onSaved: (c: DeskCustomer) => void; onPrice: (itemId: string, v: number | null) => void }) {
  const foam = items.filter((i) => i.per_customer);
  const special = items.filter((i) => !i.per_customer && prices[i.id] !== undefined);
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? items.filter((i) => !i.per_customer && prices[i.id] === undefined && words.every((w) => `${i.sku} ${i.name}`.toLowerCase().includes(w))).slice(0, 12) : [];
  return (
    <div className="adc-stack-s">
      <div className="ptn-cust-h">
        <span className="ptn-av" aria-hidden="true">{c.company.slice(0, 1).toUpperCase()}</span>
        <span><b>{c.company}</b><span className="adc-muted small">{[c.contact, c.email, c.phone].filter(Boolean).join(" · ")}</span></span>
      </div>
      <InviteBox slug={slug} c={c} readOnly={readOnly} onSent={(when) => onSaved({ ...c, invited_at: when })} />
      <CustomerForm slug={slug} c={c} readOnly={readOnly} onSaved={onSaved} />

      {foam.length ? (
        <section className="ptn-card" aria-label="Spray foam price per lb">
          <span className="ptn-card-h"><b>AMBIT spray foam: {c.company}&apos;s price per lb</b></span>
          <span className="adc-muted small">They see this price when signed in. Leave it empty and the store says &quot;Priced for your account&quot; and you confirm it on the order.</span>
          {foam.map((i) => <PriceRow key={i.id} slug={slug} customerId={c.id} item={i} value={prices[i.id]} perLb readOnly={readOnly} onSaved={(v) => onPrice(i.id, v)} />)}
        </section>
      ) : null}

      <section className="ptn-card" aria-label="Special prices">
        <span className="ptn-card-h"><b>Special prices</b></span>
        <span className="adc-muted small">
          {c.off_pct ? `${c.company} gets ${c.off_pct}% off your store price on everything. ` : ""}A special price here wins over the store price{c.off_pct ? " and the % off" : ""}.
        </span>
        {special.map((i) => <PriceRow key={i.id} slug={slug} customerId={c.id} item={i} value={prices[i.id]} readOnly={readOnly} onSaved={(v) => onPrice(i.id, v)} />)}
        {!special.length ? <span className="adc-muted small">No special prices yet.</span> : null}
        {!readOnly ? (
          <>
            <label className="adc-search light"><Search size={18} aria-hidden="true" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a special price: find an item" aria-label="Find an item to give a special price" /></label>
            {found.map((i) => <PriceRow key={i.id} slug={slug} customerId={c.id} item={i} value={undefined} readOnly={readOnly} onSaved={(v) => { onPrice(i.id, v); setQ(""); }} />)}
          </>
        ) : null}
      </section>
    </div>
  );
}

function PriceRow({ slug, customerId, item, value, perLb, readOnly, onSaved }: { slug: string; customerId: string; item: DeskPriceItem; value: number | undefined; perLb?: boolean; readOnly: boolean; onSaved: (v: number | null) => void }) {
  const [val, setVal] = useState(show(value));
  const last = useRef(show(value));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const save = async (v: string) => {
    if (v.trim() === last.current.trim()) return;
    setState("saving");
    const r = await setCustomerPrice(slug, customerId, item.id, v);
    if (!r.ok) {
      setState("error");
      setErr(r.error);
      return;
    }
    last.current = v;
    setErr(null);
    setState("saved");
    onSaved(v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));
    setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
  };
  return (
    <div className="ptn-prow2">
      <span className="ptn-line-ph xs">{item.image_url ? <img src={item.image_url} alt="" className="adc-img" /> : null}</span>
      <span className="ptn-line-b"><span className="adc-sku">{item.sku}</span><b>{item.name}</b></span>
      <span className="adc-muted small num">{perLb ? "" : item.price !== null ? `Store ${usd(item.price)}` : "No store price"}</span>
      <span className={`ptn-cell ${state}`}>
        <span className="ptn-cell-in">
          <span className="ptn-cur" aria-hidden="true">$</span>
          <input inputMode="decimal" value={val} disabled={readOnly} onChange={(e) => setVal(e.target.value)} onBlur={() => save(val)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label={`${item.name} price`} placeholder="-" />
          {perLb ? <span className="ptn-suf">/lb</span> : null}
          <span className="ptn-cell-st" aria-hidden="true">{state === "saving" ? <LoaderCircle size={14} className="spin" /> : state === "saved" ? <Check size={14} strokeWidth={3} /> : state === "error" ? <CircleAlert size={14} /> : null}</span>
        </span>
        {err ? <span className="ptn-cell-err" role="alert">{err}</span> : null}
      </span>
      {!readOnly && value !== undefined ? <button type="button" className="ptn-icon" onClick={() => { setVal(""); save(""); }} aria-label={`Remove ${item.name} price`}><Trash2 size={15} /></button> : <span />}
    </div>
  );
}

function InviteBox({ slug, c, readOnly, onSent }: { slug: string; c: DeskCustomer; readOnly: boolean; onSent: (when: string) => void }) {
  const [email, setEmail] = useState(c.email ?? "");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (c.has_login) {
    return <div className="ptn-invite on"><KeyRound size={18} aria-hidden="true" /><span><b>{c.company} has a login.</b> They sign in with {c.email ?? "their email"} to see their prices and orders.</span></div>;
  }
  return (
    <div className="ptn-invite">
      <Mail size={18} aria-hidden="true" />
      <span className="ptn-invite-b">
        <b>{c.invited_at ? `Invite sent ${new Date(c.invited_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. They haven't made their login yet.` : "Give them a login"}</b>
        <span className="adc-muted small">We email them a link to make their password. Then they see their prices and their order history when they sign in.</span>
        {!readOnly ? (
          <span className="ptn-invite-f">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Their email" aria-label="Their email" />
            <button
              type="button"
              className="adc-add"
              disabled={pending || !email.includes("@")}
              onClick={() =>
                start(async () => {
                  const r = await sendPartnerInvite(slug, "customer", c.id, email);
                  if (!r.ok) return setRes({ ok: false, text: r.error });
                  setRes({ ok: true, text: r.message ?? "Sent.", link: r.link });
                  onSent(new Date().toISOString());
                })
              }
            >
              {pending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} {c.invited_at ? "Send a new invite" : "Send login invite"}
            </button>
          </span>
        ) : null}
        {res ? (
          <span className={res.ok ? "ptn-ok small" : "adc-err"} role="status">
            {res.text}
            {res.link ? (
              <button type="button" className="ptn-linkbtn" onClick={() => { navigator.clipboard?.writeText(res.link!); setCopied(true); }}>
                <Copy size={14} /> {copied ? "Copied" : "Copy the link"}
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function CustomerForm({ slug, c, readOnly, onSaved }: { slug: string; c: DeskCustomer | null; readOnly: boolean; onSaved: (c: DeskCustomer) => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [active, setActive] = useState(c?.active ?? true);
  const terms = useMemo(() => ["Due on receipt", "Net 15", "Net 30", "Card on file", "COD"], []);
  const submit = (f: FormData) => {
    const s = (k: string) => String(f.get(k) ?? "");
    const input: CustomerInput = {
      id: c?.id ?? null,
      company: s("company"), contact: s("contact"), email: s("email"), phone: s("phone"),
      street: s("street"), city: s("city"), state: s("state"), zip: s("zip"),
      terms: s("terms"), off_pct: s("off_pct"), notes: s("notes"), active,
    };
    setErr(null);
    setOk(false);
    start(async () => {
      const r = await saveCustomer(slug, input);
      if (!r.ok) return setErr(r.error);
      setOk(true);
      const t = (v: string) => v.trim() || null;
      onSaved({
        id: r.id!, company: input.company.trim(), contact: t(input.contact), email: t(input.email)?.toLowerCase() ?? null, phone: t(input.phone),
        street: t(input.street), city: t(input.city), state: t(input.state)?.toUpperCase() ?? null, zip: t(input.zip), terms: t(input.terms),
        off_pct: Number(input.off_pct) || 0, notes: t(input.notes), active, has_login: c?.has_login ?? false, invited_at: c?.invited_at ?? null,
      });
    });
  };
  return (
    <form action={submit} className="ptn-card" aria-label="Customer info">
      <span className="ptn-card-h"><b>{c ? "Their info" : "New customer"}</b></span>
      <fieldset className="ptn-fs" disabled={readOnly || pending}>
        <div className="adc-f2">
          <label className="adc-f wide"><span>Company</span><input name="company" required defaultValue={c?.company ?? ""} maxLength={160} /></label>
          <label className="adc-f"><span>Contact name</span><input name="contact" defaultValue={c?.contact ?? ""} maxLength={120} /></label>
          <label className="adc-f"><span>Email</span><input name="email" type="email" defaultValue={c?.email ?? ""} maxLength={160} /></label>
          <label className="adc-f"><span>Phone</span><input name="phone" type="tel" defaultValue={c?.phone ?? ""} maxLength={40} /></label>
          <label className="adc-f"><span>Terms</span><input name="terms" list="ptn-terms" defaultValue={c?.terms ?? ""} maxLength={40} /></label>
          <label className="adc-f wide"><span>Street (we fill this in at checkout)</span><input name="street" defaultValue={c?.street ?? ""} maxLength={160} /></label>
          <label className="adc-f"><span>City</span><input name="city" defaultValue={c?.city ?? ""} maxLength={80} /></label>
          <span className="adc-f2 tight">
            <label className="adc-f"><span>State</span><input name="state" defaultValue={c?.state ?? ""} maxLength={2} /></label>
            <label className="adc-f"><span>ZIP</span><input name="zip" defaultValue={c?.zip ?? ""} maxLength={10} /></label>
          </span>
          <label className="adc-f"><span>% off your store price on everything</span><input name="off_pct" inputMode="decimal" defaultValue={c?.off_pct ? String(c.off_pct) : ""} placeholder="0" /></label>
          <label className="adc-f wide"><span>Notes (only you see these)</span><textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} maxLength={2000} /></label>
        </div>
        <label className="ptn-toggle"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (can sign in and see their prices)</label>
        <datalist id="ptn-terms">{terms.map((t) => <option key={t} value={t} />)}</datalist>
      </fieldset>
      {err ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {err}</div> : null}
      {!readOnly ? (
        <span className="ptn-modal-f" style={{ justifyContent: "flex-start" }}>
          <button type="submit" className="adc-cta" disabled={pending}>{pending ? <><LoaderCircle size={18} className="spin" /> Saving...</> : c ? "Save their info" : "Add customer"}</button>
          {ok ? <span className="ptn-saved"><Check size={16} strokeWidth={3} /> Saved</span> : null}
        </span>
      ) : null}
    </form>
  );
}
