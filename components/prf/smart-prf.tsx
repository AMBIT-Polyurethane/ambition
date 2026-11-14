"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, Check, CircleAlert, CircleCheck, FileSignature, History, LoaderCircle, Send, Sparkles, UserPlus } from "lucide-react";
import { money } from "@/lib/format";
import { BASIS_LABEL, basisFor, perUnit, type Basis } from "@/lib/prices";
import { CREDIT_RANGES, CUSTOMER_TYPES, EMPTY_CUSTOMER, linesOf, PRODUCT_LINES, TERMS, type LineKey, type PrfCustomer } from "@/lib/prf";
import { customerPricesFor, submitSmartPrf } from "@/app/(app)/price-requests/native-actions";
import { SendLink } from "@/components/forms/send-link";

export type PrfCo = { id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; bill_address: string | null; city: string | null; state: string | null;
  terms: string | null; credit_limit: number | null; credit_status: string | null; sales_rep_id: string | null };
export type PrfItem = { id: string; sku: string; name: string; unit: string; category_id: string | null; list: number | null; sqft_per_unit: number | null };
type Kind = "existing" | "new" | "previous";
type Line = { price: string; volume: string };

const fmtTel = (v: string) => { const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10); return d.length < 4 ? d : d.length < 7 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STEPS = ["Customer", "Details", "Products", "Prices", "Send"];

/** Fill the customer boxes from what the app already knows about them. */
function fromCompany(c: PrfCo): PrfCustomer {
  const [first, ...rest] = (c.contact_name ?? "").trim().split(/\s+/);
  const lines = (c.bill_address ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean);
  const m = /^(.*?),\s*([A-Za-z]{2})\s+(\d{5})/.exec(lines[1] ?? "");
  const lim = Number(c.credit_limit ?? 0);
  const range = !lim ? CREDIT_RANGES[0] : lim < 10000 ? CREDIT_RANGES[1] : lim < 25000 ? CREDIT_RANGES[2] : lim < 50000 ? CREDIT_RANGES[3] : lim < 100000 ? CREDIT_RANGES[4] : lim < 250000 ? CREDIT_RANGES[5] : CREDIT_RANGES[6];
  const t = (c.terms ?? "").toLowerCase();
  const terms = TERMS.find((x) => t.includes(x.toLowerCase().replace("due on receipt", "receipt"))) ?? (/net\s*30/.test(t) ? "Net 30" : "");
  return { ...EMPTY_CUSTOMER, legal_name: c.name, contact_first: first ?? "", contact_last: rest.join(" "), email: c.email ?? "", phone: c.phone ? fmtTel(c.phone) : "",
    street: lines[0] ?? "", city: m?.[1] ?? c.city ?? "", state: (m?.[2] ?? c.state ?? "").toUpperCase(), zip: m?.[3] ?? "", billing_terms: terms, credit_range: range };
}

/**
 * The smart Price Request. Existing or new customer first; every customer box is required (existing customers come
 * pre-filled); pick the product lines and only those items show; foam is per lb and fiberglass per sq ft. A new
 * customer goes straight on to the Credit Application and Account Setup.
 */
export function SmartPrf({ companies, items, rules, branch, startCompany }: {
  companies: PrfCo[]; items: PrfItem[]; branch: string; startCompany?: string;
  rules: { max_pct: number; cat_pct: Record<string, number>; never: string[]; max_lines: number } | null;
}) {
  const start = companies.find((c) => c.id === startCompany);
  const [at, setAt] = useState(start ? 1 : 0);
  const [kind, setKind] = useState<Kind | null>(start ? "existing" : null);
  const [co, setCo] = useState<PrfCo | null>(start ?? null);
  const [q, setQ] = useState("");
  const [cu, setCu] = useState<PrfCustomer>(start ? fromCompany(start) : EMPTY_CUSTOMER);
  const [lines, setLines] = useState<LineKey[]>([]);
  const [prices, setPrices] = useState<Record<string, Line>>({});
  const [theirs, setTheirs] = useState<Record<string, { price: number; basis: Basis }>>({});
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const [days, setDays] = useState(90);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ id: number; auto: number; lines: number } | null>(null);
  const [pending, go] = useTransition();
  const top = useRef<HTMLDivElement>(null);
  const scrollTop = () => setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);

  const pick = (c: PrfCo) => {
    setCo(c); setCu(fromCompany(c)); setQ("");
    go(async () => { const r = await customerPricesFor(c.id); setTheirs(Object.fromEntries(r.map((x) => [x.product_id, { price: Number(x.price), basis: x.basis }]))); });
  };
  const t = q.trim().toLowerCase();
  const hits = t ? companies.filter((c) => `${c.name} ${c.contact_name ?? ""} ${c.city ?? ""}`.toLowerCase().includes(t)).slice(0, 8) : [];
  const shown = useMemo(() => items.filter((p) => linesOf(p).some((l) => lines.includes(l))), [items, lines]);
  const set = (k: keyof PrfCustomer, v: string) => { setCu((c) => ({ ...c, [k]: v })); setErrs((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const priced = shown.filter((p) => Number(prices[p.id]?.price) > 0);
  // ISO goes with every foam: show it once, under the first foam line picked.
  const isoHome = PRODUCT_LINES.find((l) => ["insulation", "roofing", "lifting"].includes(l.key) && lines.includes(l.key))?.key;

  function rule(p: PrfItem, price: number): string | null {
    if (!rules || basisFor(p) !== "unit" || !p.list || rules.never.includes(p.category_id ?? "")) return null;
    const pct = (1 - price / p.list) * 100;
    const max = rules.cat_pct[p.category_id ?? ""] ?? rules.max_pct;
    return pct <= max ? "Approves itself" : null;
  }

  function validate(step: number): boolean {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!kind) e.kind = "Pick one.";
      if (kind === "existing" && !co) e.co = "Pick the customer.";
    }
    if (step === 1) {
      const need: (keyof PrfCustomer)[] = ["legal_name", "contact_first", "contact_last", "email", "phone", "street", "city", "state", "zip", "customer_type", "rigs", "monthly_sets", "current_mfr", "billing_terms", "credit_range", "freight_included", "tax_ack"];
      if (kind !== "existing") need.push("wants_credit");
      for (const k of need) if (!cu[k].trim()) e[k] = "Required";
      if (cu.email && !EMAIL.test(cu.email)) e.email = "Check the email";
      if (cu.phone && cu.phone.replace(/\D/g, "").length < 10) e.phone = "10 digits";
      if (cu.state && !/^[A-Za-z]{2}$/.test(cu.state)) e.state = "2 letters";
      if (cu.zip && !/^\d{5}$/.test(cu.zip)) e.zip = "5 digits";
      for (const k of ["rigs", "monthly_sets"] as const) if (cu[k] && !/^\d+(\.\d+)?$/.test(cu[k])) e[k] = "A number";
      if (kind !== "existing" && companies.some((c) => c.name.trim().toLowerCase() === cu.legal_name.trim().toLowerCase())) e.legal_name = "This customer is already in the app. Go back and pick Existing.";
    }
    if (step === 2 && !lines.length) e.lines = "Pick at least one product line.";
    if (step === 3 && !priced.length) e.prices = "Type a price for at least one item.";
    if (step === 4 && !note.trim()) e.note = "Add a note.";
    setErrs(e);
    setMsg(Object.keys(e).length ? (e.legal_name && Object.keys(e).length === 1 ? e.legal_name : "Fill in the boxes marked in red.") : "");
    return !Object.keys(e).length;
  }
  const next = () => { if (validate(at)) { setAt(at + 1); scrollTop(); } };

  function submit() {
    if (!validate(4)) return;
    go(async () => {
      const r = await submitSmartPrf({
        customer_kind: kind!, company_id: kind === "existing" ? co?.id ?? null : null, customer: cu, product_lines: lines, branch, note, valid_days: days,
        lines: priced.map((p) => ({ product_id: p.id, price: prices[p.id].price, basis: basisFor(p), volume: prices[p.id].volume })),
      });
      if (!r.ok) { setMsg(r.error); return; }
      setDone(r); scrollTop();
    });
  }

  const field = (k: keyof PrfCustomer, label: string, w = 3, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className={`fx-field w${w}`}>
      <label className="fx-label" htmlFor={`prf-${k}`}>{label}<i aria-hidden="true">*</i></label>
      <input id={`prf-${k}`} className={`input${errs[k] ? " bad" : ""}`} value={cu[k]} {...props}
        onChange={(e) => set(k, k === "phone" ? fmtTel(e.target.value) : k === "state" ? e.target.value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() : k === "zip" ? e.target.value.replace(/\D/g, "").slice(0, 5) : e.target.value)} />
      {errs[k] ? <span className="fx-err">{errs[k]}</span> : null}
    </div>
  );
  const pills = (k: keyof PrfCustomer, label: string, opts: string[], w = 6) => (
    <div className={`fx-field w${w}`}>
      <span className="fx-label">{label}<i aria-hidden="true">*</i></span>
      <div className="fx-pills" role="radiogroup" aria-label={label}>
        {opts.map((o) => <button key={o} type="button" role="radio" aria-checked={cu[k] === o} className={cu[k] === o ? "on" : ""} onClick={() => set(k, o)}><span className="fx-tick">{cu[k] === o ? <Check size={13} /> : null}</span>{o}</button>)}
      </div>
      {errs[k] ? <span className="fx-err">{errs[k]}</span> : null}
    </div>
  );

  if (done) {
    const isNew = kind !== "existing";
    const wantsCredit = cu.wants_credit.startsWith("Yes");
    const prefill = { company_name: cu.legal_name };
    const name = `${cu.contact_first} ${cu.contact_last}`.trim();
    return (
      <div className="col" style={{ gap: 14 }} ref={top}>
        <div className="fx-done card">
          <span className="fx-done-icon"><CircleCheck size={34} /></span>
          <h2 className="h2" style={{ margin: 0 }}>Price request PR-{1000 + done.id} sent</h2>
          <span className="small muted center">{done.auto === done.lines ? "Every price met the rules and is approved." : done.auto ? `${done.auto} of ${done.lines} prices approved by the rules; the rest went to a manager.` : "It went to a manager for approval. You'll get a notification."}</span>
          <div className="row wrap center" style={{ gap: 8 }}><Link href={`/price-requests/n/${done.id}`} className="btn dark">Open it</Link><Link href="/price-requests/new" className="btn dark">New request</Link></div>
        </div>
        {isNew ? (
          <section className="card col" style={{ gap: 12 }}>
            <b>Next for {cu.legal_name}: open the account</b>
            <span className="small muted">Their customer details are filled in already. Once Accounting approves the account setup, {cu.legal_name} is added to the app and these prices become theirs.</span>
            <div className="prf-next">
              {wantsCredit ? (
                <div className="prf-next-card">
                  <span className="fx-tile-ic"><FileSignature size={18} /></span>
                  <b>1. Credit Application</b><span className="tiny muted">They asked for terms. Bank, trade references, signatures.</span>
                  <Link href={`/forms/credit_app?prf=${done.id}`} className="btn sm">Fill it in with them</Link>
                  <SendLink formKey="credit_app" prf={done.id} company={null} prefill={{ ...prefill, ap_contact: name, ap_email: cu.email, ap_phone: cu.phone }} email={cu.email} name={name} title="Credit Application" />
                </div>
              ) : null}
              <div className="prf-next-card">
                <span className="fx-tile-ic"><Building2 size={18} /></span>
                <b>{wantsCredit ? "2." : "1."} Customer Account Setup</b><span className="tiny muted">Company, shipping, tax and the personal guarantee.</span>
                <Link href={`/forms/account_setup?prf=${done.id}`} className="btn sm">Fill it in with them</Link>
                <SendLink formKey="account_setup" prf={done.id} company={null} prefill={{ ...prefill, purchaser: name, company_email: cu.email, company_phone: cu.phone, company_street: cu.street, company_city: cu.city, company_state: cu.state, company_zip: cu.zip }} email={cu.email} name={name} title="Account Setup" />
              </div>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fx" ref={top}>
      <ol className="fx-steps" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : ""}><button type="button" disabled={i > at} onClick={() => setAt(i)}><span className="fx-dot">{i < at ? <Check size={12} /> : i + 1}</span><span className="fx-step-name">{s}</span></button></li>)}
      </ol>
      <div className="fx-bar" aria-hidden="true"><span style={{ width: `${(at / (STEPS.length - 1)) * 100}%` }} /></div>

      <section className="fx-card card">
        {at === 0 ? (
          <>
            <header className="fx-card-head"><h2 className="h2">Who is it for?</h2><span className="small muted">Start here. New customers go on to the credit application and account setup.</span></header>
            <div className="prf-kind">
              {([["existing", "Existing customer", "Already buying from AMBIT", Building2], ["new", "New customer", "Never bought from us", UserPlus], ["previous", "Coming back", "Bought before, not in the app now", History]] as const).map(([k, l, h, I]) => (
                <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => { setKind(k); setErrs({}); if (k !== "existing") { setCo(null); setTheirs({}); setCu((c) => (co ? EMPTY_CUSTOMER : c)); } }}>
                  <I size={22} /><b>{l}</b><span className="tiny muted">{h}</span>
                </button>
              ))}
            </div>
            {errs.kind ? <span className="fx-err">{errs.kind}</span> : null}
            {kind === "existing" ? (
              <div className="fx-field w6">
                <label className="fx-label" htmlFor="prf-co">Customer<i>*</i></label>
                {co ? (
                  <div className="prf-picked"><Building2 size={18} /><span className="col tight grow"><b>{co.name}</b><span className="tiny muted">{[co.contact_name, co.city && co.state ? `${co.city}, ${co.state}` : null, co.terms].filter(Boolean).join(" · ")}</span></span>
                    <button type="button" className="link-btn" onClick={() => { setCo(null); setCu(EMPTY_CUSTOMER); setTheirs({}); }}>Change</button></div>
                ) : (
                  <div className="fx-combo">
                    <input id="prf-co" className={`input${errs.co ? " bad" : ""}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a customer name" autoFocus autoComplete="off" />
                    {hits.length ? <div className="fx-combo-list">{hits.map((c) => <button key={c.id} type="button" onClick={() => pick(c)}><b>{c.name}</b><span className="tiny faint">{[c.contact_name, c.city && c.state ? `${c.city}, ${c.state}` : null].filter(Boolean).join(" · ")}</span></button>)}</div> : null}
                  </div>
                )}
                {errs.co ? <span className="fx-err">{errs.co}</span> : null}
              </div>
            ) : null}
          </>
        ) : at === 1 ? (
          <>
            <header className="fx-card-head"><h2 className="h2">Customer details</h2><span className="small muted">{kind === "existing" ? "Filled in from the app. Check it and fill any gaps." : "Every box is needed to quote and open the account."}</span></header>
            <div className="fx-grid">
              {field("legal_name", "Legal business name", 6)}
              {field("contact_first", "Contact first name")}{field("contact_last", "Last name")}
              {field("email", "Business email", 3, { type: "email", inputMode: "email" })}{field("phone", "Business phone", 3, { inputMode: "tel" })}
              {field("street", "Street address", 6)}
              {field("city", "City")}{field("state", "State", 1)}{field("zip", "ZIP", 2, { inputMode: "numeric" })}
              {pills("customer_type", "They are a", CUSTOMER_TYPES)}
              {field("rigs", "Foam rigs", 2, { inputMode: "numeric" })}{field("monthly_sets", "Sets a month", 2, { inputMode: "numeric" })}{field("current_mfr", "Buying from now", 2, { placeholder: "e.g. Lapolla, or none" })}
              {pills("billing_terms", "Billing terms they have now", TERMS)}
              {pills("credit_range", "Credit line they have now", CREDIT_RANGES)}
              {kind !== "existing" ? pills("wants_credit", "Do they want credit with AMBIT?", ["Yes, they want terms", "No, COD / prepay"]) : null}
              {pills("freight_included", "Freight included in the price?", ["Yes", "No"])}
              <div className="fx-field w6">
                <button type="button" className={`prf-ack${cu.tax_ack ? " on" : ""}`} onClick={() => set("tax_ack", cu.tax_ack ? "" : "Yes")}>
                  <span className="fx-tick">{cu.tax_ack ? <Check size={13} /> : null}</span>I told the customer sales tax is added unless AMBIT has their exemption certificate.<i>*</i></button>
                {errs.tax_ack ? <span className="fx-err">Required</span> : null}
              </div>
            </div>
          </>
        ) : at === 2 ? (
          <>
            <header className="fx-card-head"><h2 className="h2">What are you quoting?</h2><span className="small muted">Only these products show on the next step.</span></header>
            <div className="prf-lines">
              {PRODUCT_LINES.map((l) => {
                const on = lines.includes(l.key);
                const n = items.filter((p) => linesOf(p).includes(l.key)).length;
                return <button key={l.key} type="button" className={on ? "on" : ""} onClick={() => { setLines(on ? lines.filter((x) => x !== l.key) : [...lines, l.key]); setErrs({}); }} disabled={!n}>
                  <span className="fx-tick">{on ? <Check size={13} /> : null}</span><span className="col tight"><b>{l.label}</b><span className="tiny muted">{l.hint} · {n} items</span></span></button>;
              })}
            </div>
            {errs.lines ? <span className="fx-err">{errs.lines}</span> : null}
          </>
        ) : at === 3 ? (
          <>
            <header className="fx-card-head"><h2 className="h2">Prices</h2><span className="small muted">Type the price you need on each item you&apos;re quoting. Leave the rest blank. Foam is <b>per lb</b>, fiberglass <b>per sq ft</b>.</span></header>
            {shown.length > 12 ? <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find an item (R13, 23 in, Knauf, AMBI-TITE…)" aria-label="Find an item" /> : null}
            {PRODUCT_LINES.filter((l) => lines.includes(l.key)).map((l) => (
              <div key={l.key} className="col" style={{ gap: 6 }}>
                <b className="small">{l.label}</b>
                <div className="prf-items">
                  {items.filter((p) => linesOf(p).includes(l.key) && (!p.sku.toUpperCase().startsWith("ISO") || l.key === isoHome))
                    .filter((p) => !find.trim() || Number(prices[p.id]?.price) > 0 || find.toLowerCase().split(/\s+/).filter(Boolean).every((w) => `${p.sku} ${p.name}`.toLowerCase().includes(w))).map((p) => {
                    const b = basisFor(p);
                    const v = prices[p.id] ?? { price: "", volume: "" };
                    const n = Number(v.price);
                    const each = n > 0 ? perUnit(n, b, { name: p.name, sqft_per_unit: p.sqft_per_unit }) : null;
                    const now = theirs[p.id];
                    const r = n > 0 ? rule(p, n) : null;
                    return (
                      <div key={p.id} className={`prf-item${n > 0 ? " on" : ""}`}>
                        <span className="col tight grow" style={{ minWidth: 0 }}>
                          <b className="small">{p.name}</b>
                          <span className="tiny faint">{p.sku}{b === "unit" && p.list ? ` · list ${money(p.list)}` : ""}{now ? ` · they pay ${money(now.price)} ${BASIS_LABEL[now.basis]}` : ""}</span>
                          {n > 0 ? <span className="tiny">{each !== null && b !== "unit" ? <>= {money(each)} / {p.unit} </> : null}{b === "unit" && p.list ? <span className={n < p.list ? "warn-text" : "ok-text"}>{n < p.list ? `${(((p.list - n) / p.list) * 100).toFixed(1)}% under list` : "at or over list"}</span> : null}{r ? <span className="ok-text"> · <Sparkles size={11} /> {r}</span> : null}</span> : null}
                        </span>
                        <span className="cp-money"><span>$</span><input className="input sm" inputMode="decimal" placeholder={b === "lb" ? "0.00/lb" : b === "sqft" ? "0.000/sqft" : "0.00"} value={v.price} aria-label={`${p.name} price ${BASIS_LABEL[b]}`}
                          onChange={(e) => { setPrices((m) => ({ ...m, [p.id]: { ...v, price: e.target.value.replace(/[^\d.]/g, "") } })); setErrs({}); }} /></span>
                        <input className="input sm prf-vol" placeholder="Volume" value={v.volume} aria-label={`${p.name} volume`} onChange={(e) => setPrices((m) => ({ ...m, [p.id]: { ...v, volume: e.target.value } }))} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {errs.prices ? <span className="fx-err">{errs.prices}</span> : null}
          </>
        ) : (
          <>
            <header className="fx-card-head"><h2 className="h2">Check it and send</h2></header>
            <dl className="fx-dl">
              <div><dt>Customer</dt><dd><b>{cu.legal_name}</b> ({kind === "existing" ? "existing" : kind === "new" ? "new" : "coming back"}) · {cu.contact_first} {cu.contact_last} · {cu.phone} · {cu.email}</dd></div>
              <div><dt>Address</dt><dd>{cu.street}, {cu.city}, {cu.state} {cu.zip}</dd></div>
              <div><dt>Business</dt><dd>{cu.customer_type} · {cu.rigs} rigs · {cu.monthly_sets} sets a month · buying from {cu.current_mfr}</dd></div>
              <div><dt>Terms now</dt><dd>{cu.billing_terms} · {cu.credit_range}{cu.wants_credit ? ` · ${cu.wants_credit}` : ""} · freight {cu.freight_included === "Yes" ? "included" : "not included"}</dd></div>
              <div><dt>Prices</dt><dd>{priced.map((p) => `${p.name}: ${money(Number(prices[p.id].price))} ${BASIS_LABEL[basisFor(p)]}${prices[p.id].volume ? ` (${prices[p.id].volume})` : ""}`).join("\n")}</dd></div>
            </dl>
            <div className="fx-grid">
              <div className="fx-field w6">
                <label className="fx-label" htmlFor="prf-note">Note for the approver<i>*</i></label>
                <textarea id="prf-note" className={`input fx-area${errs.note ? " bad" : ""}`} value={note} onChange={(e) => { setNote(e.target.value); setErrs({}); }} placeholder="Who they buy from now and at what price, why this price wins the business, anything else" />
                {errs.note ? <span className="fx-err">{errs.note}</span> : null}
              </div>
              <div className="fx-field w3">
                <label className="fx-label" htmlFor="prf-days">Prices good for</label>
                <select id="prf-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>{n} days</option>)}</select>
              </div>
            </div>
          </>
        )}
      </section>

      {msg ? <div className="alert err" role="alert"><CircleAlert size={18} /><span>{msg}</span></div> : null}
      <div className="fx-nav">
        {at > 0 ? <button type="button" className="btn dark" onClick={() => { setAt(at - 1); setMsg(""); setErrs({}); scrollTop(); }}><ArrowLeft size={16} /> Back</button> : <span />}
        {at < STEPS.length - 1
          ? <button type="button" className="btn fx-go" onClick={next}>Next <ArrowRight size={16} /></button>
          : <button type="button" className="btn fx-go" disabled={pending} onClick={submit}>{pending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Send for approval</button>}
      </div>
    </div>
  );
}
