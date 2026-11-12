"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Plus, Search, Send, Sparkles, Trash2 } from "lucide-react";
import { CustomerPicker } from "@/components/customer-picker";
import { unpackCustomer, type PackedCustomer } from "@/lib/customers";
import { money } from "@/lib/format";
import { submitPriceRequest } from "@/app/(app)/price-requests/native-actions";
import type { Branch } from "@/lib/types";

export type PrProduct = { id: string; sku: string; name: string; unit: string; cat: string | null; list: number | null };
type Line = { key: number; p: PrProduct; price: string; volume: string };

/** Rep: a price request in the app. Each line shows how far under list it is, and whether it meets the rules. */
export function PriceRequestForm({
  companies, branches, products, categories, rules, defaultBranch, startCompany,
}: {
  companies: PackedCustomer[];
  branches: { id: string; name: string }[];
  products: PrProduct[];
  categories: { id: string; name: string }[];
  /** The auto-approve rules (when they're on): max % under list overall and by category, categories never auto-approved. */
  rules: { max_pct: number; cat_pct: Record<string, number>; never: string[] } | null;
  defaultBranch: string;
  startCompany: string;
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState(() => companies.map(unpackCustomer));
  const [company, setCompany] = useState(startCompany);
  const [prospect, setProspect] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [branch, setBranch] = useState(defaultBranch);
  const [note, setNote] = useState("");
  const [days, setDays] = useState(90);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(
    () => (words.length ? products.filter((p) => !lines.some((l) => l.p.id === p.id) && words.every((w) => `${p.sku} ${p.name}`.toLowerCase().includes(w))).slice(0, 8) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, products, lines],
  );
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "";
  const hint = (l: Line) => {
    const price = Number(l.price);
    if (!(price > 0)) return null;
    const off = l.p.list ? Math.round((1 - price / l.p.list) * 1000) / 10 : null;
    if (!rules) return { ok: false, text: off !== null ? (off > 0 ? `${off}% under list` : "At or above list") : "No list price" };
    if (rules.never.includes(l.p.cat ?? "")) return { ok: false, text: `${catName(l.p.cat) || "This group"} always goes to a manager` };
    if (off === null) return { ok: false, text: "No list price: a manager decides (unless it's at or above the floor price)" };
    const max = rules.cat_pct[l.p.cat ?? ""] ?? rules.max_pct;
    return off <= max ? { ok: true, text: `${off > 0 ? `${off}% under list` : "At or above list"}: meets the rules (approved right away unless it's under the floor price)` } : { ok: false, text: `${off}% under list: over the ${max}% the rules allow, a manager decides` };
  };
  const ready = (company || (prospect && name.trim())) && lines.some((l) => Number(l.price) > 0);

  const send = () =>
    go(async () => {
      setError(null);
      const res = await submitPriceRequest({
        companyId: prospect ? "" : company,
        companyName: prospect ? name : "",
        contact,
        branch,
        note,
        validDays: days,
        lines: lines.map((l) => ({ product_id: l.p.id, price: Number(l.price), volume: l.volume })),
      });
      if (!res.ok) return setError(res.error);
      const msg = res.auto === res.lines ? "Approved right away: every price met the rules." : res.auto ? `${res.auto} of ${res.lines} approved right away; the rest went to a manager.` : "Sent to a manager. You'll get an email when it's answered.";
      router.push(`/price-requests/n/${res.id}?msg=${encodeURIComponent(msg)}`);
    });

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card col" style={{ gap: 10 }}>
        <div className="row between" style={{ gap: 8 }}>
          <span className="label">Customer</span>
          <button type="button" className="linkbtn small" onClick={() => setProspect((v) => !v)}>{prospect ? "Pick an existing customer" : "New prospect (not a customer yet)"}</button>
        </div>
        {prospect ? (
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" aria-label="Company name" />
        ) : (
          <CustomerPicker customers={customers} value={company} onChange={setCompany} onAdded={(c) => setCustomers((l) => [...l, c])} branches={branches as Branch[]} canAdd={false} />
        )}
        <div className="grid2">
          <label className="field"><span className="label">Contact (optional)</span><input className="input sm" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name, phone" /></label>
          <label className="field">
            <span className="label">Location</span>
            <select className="select sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Any</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <span className="label">Products and the price you need</span>
        {lines.map((l) => {
          const hnt = hint(l);
          return (
            <div key={l.key} className="pr-line">
              <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
                <div className="col tight" style={{ minWidth: 0 }}>
                  <b className="small">{l.p.name}</b>
                  <span className="tiny faint">{l.p.sku} · {l.p.list !== null ? `list ${money(l.p.list)} / ${l.p.unit}` : "no list price (account pricing)"}</span>
                </div>
                <button type="button" className="iconbtn sm" aria-label={`Remove ${l.p.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={15} /></button>
              </div>
              <div className="grid2">
                <label className="field"><span className="label">Price you need (per {l.p.unit})</span><input className="input sm" inputMode="decimal" value={l.price} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, price: e.target.value.replace(/[^\d.]/g, "") } : x)))} placeholder="$" /></label>
                <label className="field"><span className="label">Volume (optional)</span><input className="input sm" value={l.volume} maxLength={80} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, volume: e.target.value } : x)))} placeholder="6 sets a month" /></label>
              </div>
              {hnt ? <span className={`tiny pr-hint${hnt.ok ? " ok" : ""}`}>{hnt.ok ? <Sparkles size={12} /> : null} {hnt.text}</span> : null}
            </div>
          );
        })}
        <div className="search">
          <Search size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lines.length ? "Add another product" : "Search a product or SKU"} aria-label="Find a product" />
        </div>
        {hits.length ? (
          <div className="list">
            {hits.map((p) => (
              <button key={p.id} type="button" className="item" onClick={() => (setLines((ls) => [...ls, { key: Date.now(), p, price: "", volume: "" }]), setQ(""))}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{p.name}</div>
                  <div className="s ellipsis">{p.sku}{p.list !== null ? ` · list ${money(p.list)}` : ""}</div>
                </div>
                <Plus size={16} className="chev" />
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <label className="field">
          <span className="label">Why (helps the manager decide)</span>
          <textarea className="textarea" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Competitor quote, expected volume, a new account we're winning…" />
        </label>
        <label className="field">
          <span className="label">Good for</span>
          <select className="select sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </section>

      {error ? <div className="alert err"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{error}</span></div> : null}
      <button type="button" className="btn block" disabled={!ready || pending} onClick={send}><Send size={16} /> {pending ? "Sending…" : "Send price request"}</button>
    </div>
  );
}
