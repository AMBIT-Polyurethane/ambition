"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle, Lock, Plus, Search, Send, Trash2, Truck, Warehouse, X } from "lucide-react";
import { money, plural } from "@/lib/format";
import { previewPrices, saveEstimate, type EstimateInput, type PricedLine } from "@/app/(app)/estimates/actions";

export type EstCustomer = { id: string; name: string; account_no: string | null; city: string | null; state: string | null; default_branch_id: string | null };
export type EstProduct = { id: string; sku: string; name: string; unit: string; category_id: string | null };
export type EstBranch = { id: string; name: string; state: string };

type Line = { product_id: string; qty: string };

const isDrum = (p: EstProduct) => p.category_id === "ambit-foam" && /^drums?$/i.test(p.unit);
const isIso = (p: EstProduct) => isDrum(p) && /^ISO/i.test(p.sku);
const isResin = (p: EstProduct) => isDrum(p) && !/^ISO/i.test(p.sku);
const qtyOf = (q: string) => {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

/**
 * Build or change an estimate: the customer, pickup or delivery, and the items. Prices come from the customer's
 * price list (shown as you go) and can't be changed here. Spray foam: each resin drum gets its ISO drum.
 */
export function EstimateForm({
  customers,
  products,
  branches,
  initial,
}: {
  customers: EstCustomer[];
  products: EstProduct[];
  branches: EstBranch[];
  initial?: Partial<EstimateInput> & { id?: string; est_no?: number };
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const iso = useMemo(() => products.find((p) => isIso(p) && p.sku.toUpperCase() === "ISO") ?? products.find(isIso) ?? null, [products]);
  const [company, setCompany] = useState(initial?.company_id ?? "");
  const [custQ, setCustQ] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [method, setMethod] = useState<"pickup" | "jobsite">(initial?.delivery_method ?? "pickup");
  const [branch, setBranch] = useState(initial?.branch_id ?? "");
  const [addr, setAddr] = useState(initial?.ship_address ?? "");
  const [st, setSt] = useState(initial?.ship_state ?? "");
  const [zip, setZip] = useState(initial?.ship_zip ?? "");
  const [custNote, setCustNote] = useState(initial?.customer_note ?? "");
  const [staffNote, setStaffNote] = useState(initial?.staff_note ?? "");
  const [lines, setLines] = useState<Line[]>(() => (initial?.items ?? []).map((i) => ({ product_id: i.product_id, qty: String(i.qty) })));
  // ISO follows the resin drums (one each) until someone types the ISO themselves.
  const [autoIso, setAutoIso] = useState(() => !initial?.items?.length);
  const [q, setQ] = useState("");
  const [prices, setPrices] = useState<Map<string, PricedLine>>(new Map());
  const [pricing, setPricing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const cust = customers.find((c) => c.id === company) ?? null;
  const custHits = useMemo(() => {
    const t = custQ.trim().toLowerCase();
    if (!t) return [];
    return customers.filter((c) => `${c.name} ${c.account_no ?? ""} ${c.city ?? ""} ${c.state ?? ""}`.toLowerCase().includes(t)).slice(0, 8);
  }, [custQ, customers]);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const words = t.split(/\s+/);
    return products.filter((p) => words.every((w) => `${p.sku} ${p.name}`.toLowerCase().includes(w))).slice(0, 10);
  }, [q, products]);

  /** ISO = the resin drums (one ISO drum for each), when it's following them. */
  const withIso = (ls: Line[], auto = autoIso): Line[] => {
    if (!auto || !iso) return ls;
    const resin = ls.reduce((n, l) => n + (byId.get(l.product_id) && isResin(byId.get(l.product_id)!) ? qtyOf(l.qty) : 0), 0);
    const rest = ls.filter((l) => l.product_id !== iso.id);
    if (!resin) return rest;
    const at = ls.findIndex((l) => l.product_id === iso.id);
    const isoLine = { product_id: iso.id, qty: String(resin) };
    if (at < 0) return [...rest, isoLine];
    const out = [...ls];
    out[at] = isoLine;
    return out;
  };
  const add = (p: EstProduct) => {
    setLines((ls) => {
      const at = ls.findIndex((l) => l.product_id === p.id);
      const next = at >= 0 ? ls.map((l, i) => (i === at ? { ...l, qty: String(qtyOf(l.qty) + 1) } : l)) : [...ls, { product_id: p.id, qty: "1" }];
      return withIso(next);
    });
    setQ("");
    searchRef.current?.focus();
  };
  const setQty = (pid: string, v: string) => {
    if (iso && pid === iso.id) setAutoIso(false);
    setLines((ls) => withIso(ls.map((l) => (l.product_id === pid ? { ...l, qty: v } : l)), iso && pid === iso.id ? false : autoIso));
  };
  const remove = (pid: string) => setLines((ls) => withIso(ls.filter((l) => l.product_id !== pid), iso && pid === iso.id ? false : autoIso));

  // Today's prices for this customer, as the items change (read-only).
  const key = JSON.stringify([company, lines.map((l) => [l.product_id, qtyOf(l.qty)])]);
  useEffect(() => {
    const items = lines.map((l) => ({ product_id: l.product_id, qty: qtyOf(l.qty) })).filter((l) => l.qty > 0);
    if (!company || !items.length) {
      setPrices(new Map());
      return;
    }
    let stop = false;
    setPricing(true);
    const t = setTimeout(() => {
      previewPrices(company, items).then((rows) => {
        if (stop) return;
        setPrices(new Map(rows.map((r) => [r.product_id, r])));
        setPricing(false);
      });
    }, 350);
    return () => {
      stop = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const subtotal = lines.reduce((n, l) => n + (prices.get(l.product_id)?.line_total ?? 0), 0);
  const unpriced = lines.some((l) => qtyOf(l.qty) > 0 && prices.size > 0 && prices.get(l.product_id)?.unit_price == null);

  const save = (done: boolean) => {
    setError(null);
    if (!company) return setError("Pick the customer.");
    if (method === "pickup" && !branch) return setError("Pick the AMBIT location they'll pick up at.");
    if (method === "jobsite" && (addr.trim().length < 3 || !/^\d{5}/.test(zip.trim()))) return setError("Add the address to deliver to, with its ZIP.");
    const items = lines.map((l) => ({ product_id: l.product_id, qty: qtyOf(l.qty) })).filter((l) => l.qty > 0);
    if (!items.length) return setError("Add at least one item.");
    go(async () => {
      const r = await saveEstimate(
        {
          id: initial?.id ?? null,
          company_id: company,
          delivery_method: method,
          branch_id: method === "pickup" ? branch : "",
          ship_address: addr,
          ship_state: st,
          ship_zip: zip,
          customer_note: custNote,
          staff_note: staffNote,
          items,
        },
        done,
      );
      if (!r.ok) return setError(r.error);
      router.push(`/estimates/${r.id}`);
      router.refresh();
    });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card col" style={{ gap: 10 }}>
        <div className="eyebrow">Customer</div>
        {cust ? (
          <div className="row between" style={{ gap: 8 }}>
            <div className="col tight">
              <b>{cust.name}</b>
              <span className="tiny faint">{[cust.account_no ? `#${cust.account_no}` : null, [cust.city, cust.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
            </div>
            <button type="button" className="btn sm dark" onClick={() => { setCompany(""); setCustQ(""); setCustOpen(true); }}>Change</button>
          </div>
        ) : (
          <div className="search" style={{ position: "relative" }}>
            <Search size={17} />
            <input
              className="input"
              autoFocus
              value={custQ}
              onChange={(e) => { setCustQ(e.target.value); setCustOpen(true); }}
              onFocus={() => setCustOpen(true)}
              placeholder="Type the customer's name, account # or city"
              aria-label="Find the customer"
            />
            {custOpen && custHits.length ? (
              <div className="est-pop" role="listbox">
                {custHits.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setCompany(c.id);
                      setCustOpen(false);
                      if (!branch && c.default_branch_id) setBranch(c.default_branch_id);
                    }}
                  >
                    <b>{c.name}</b>
                    <span className="tiny faint">{[c.account_no ? `#${c.account_no}` : null, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="eyebrow">Pickup or delivery</div>
        <div className="seg sm" role="radiogroup" aria-label="Pickup or delivery">
          <button type="button" className={method === "pickup" ? "on" : ""} onClick={() => setMethod("pickup")} aria-pressed={method === "pickup"}><Warehouse size={15} /> Pickup</button>
          <button type="button" className={method === "jobsite" ? "on" : ""} onClick={() => setMethod("jobsite")} aria-pressed={method === "jobsite"}><Truck size={15} /> Deliver</button>
        </div>
        {method === "pickup" ? (
          <label className="field">
            <span className="label">AMBIT location</span>
            <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Pick the location…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}, {b.state}</option>)}
            </select>
            <span className="tiny faint">Sales tax is the pickup location&apos;s. No freight.</span>
          </label>
        ) : (
          <div className="est-addr">
            <label className="field">
              <span className="label">Deliver to (street, city)</span>
              <input className="input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="1200 Main St, Tulsa" />
            </label>
            <label className="field">
              <span className="label">State</span>
              <input className="input" value={st} onChange={(e) => setSt(e.target.value.toUpperCase().slice(0, 2))} placeholder="OK" autoCapitalize="characters" />
            </label>
            <label className="field">
              <span className="label">ZIP</span>
              <input className="input" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value.replace(/[^\d-]/g, "").slice(0, 10))} placeholder="74103" />
            </label>
            <span className="tiny faint" style={{ gridColumn: "1 / -1" }}>A CRM adds the freight before it can be sent. Sales tax is the ZIP&apos;s (or the state&apos;s) rate.</span>
          </div>
        )}
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="row between" style={{ gap: 8 }}>
          <div className="eyebrow">Items</div>
          <span className="tiny faint row" style={{ gap: 4 }}><Lock size={12} /> Prices come from {cust ? `${cust.name}'s` : "the customer's"} price list</span>
        </div>
        <div className="search" style={{ position: "relative" }}>
          <Search size={17} />
          <input ref={searchRef} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an item: type a SKU or name (HFO, 5.0, 246627…)" aria-label="Add an item" />
          {hits.length ? (
            <div className="est-pop" role="listbox">
              {hits.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => add(p)}>
                  <span><b>{p.sku}</b> <span className="small">{p.name}</span></span>
                  <span className="tiny faint">{p.unit}{isResin(p) && autoIso ? " · ISO added with it" : ""}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {lines.length ? (
          <div className="cr-wrap">
            <table className="cr-table est-lines">
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th><th aria-label="Remove" /></tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = byId.get(l.product_id);
                  const pr = prices.get(l.product_id);
                  return (
                    <tr key={l.product_id}>
                      <td>
                        <b>{p?.sku ?? "?"}</b> <span className="small muted">{p?.name}</span>
                        {p && isIso(p) && autoIso ? <div className="tiny faint">One for each resin drum</div> : null}
                        {pr?.basis === "lb" && pr.per != null ? <div className="tiny faint">{money(pr.per)}/lb{pr.source === "customer" ? " (their price)" : " (base price)"}</div> : null}
                      </td>
                      <td>
                        <input className="input sm est-qty" inputMode="decimal" value={l.qty} onChange={(e) => setQty(l.product_id, e.target.value)} aria-label={`How many ${p?.sku ?? ""}`} />
                        <div className="tiny faint">{p ? plural(p.unit, qtyOf(l.qty) || 2) : ""}</div>
                      </td>
                      <td>{pricing && !pr ? "…" : pr?.unit_price == null ? <span className="warn-t small">Call</span> : money(pr.unit_price)}</td>
                      <td><b>{pr?.line_total == null ? "–" : money(pr.line_total)}</b></td>
                      <td>
                        <button type="button" className="iconbtn" aria-label={`Remove ${p?.sku ?? "item"}`} onClick={() => remove(l.product_id)}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    <span className="small muted">Items{pricing ? <LoaderCircle size={13} className="spin" style={{ marginLeft: 6, verticalAlign: "-2px" }} /> : null}</span>
                  </td>
                  <td><b>{company ? money(subtotal) : "–"}</b></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>No items yet. Search above to add them.</p>
        )}
        {!company && lines.length ? <div className="tiny faint">Pick the customer to see their prices.</div> : null}
        {unpriced ? <div className="alert warn small"><CircleAlert size={16} /><span>Items marked <b>Call</b> have no price for this customer yet (no customer price or base price). They show as &quot;Call&quot; on the estimate.</span></div> : null}
        {iso && !autoIso && lines.some((l) => byId.get(l.product_id) && isResin(byId.get(l.product_id)!)) ? (
          <button type="button" className="linkbtn small" style={{ alignSelf: "flex-start" }} onClick={() => { setAutoIso(true); setLines((ls) => withIso(ls, true)); }}>
            <Plus size={13} /> Match the ISO to the resin drums again
          </button>
        ) : null}
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <label className="field">
          <span className="label">Note for the customer (on the estimate)</span>
          <textarea className="input" rows={2} value={custNote} onChange={(e) => setCustNote(e.target.value)} placeholder="Job name, timing, anything they asked about" />
        </label>
        <label className="field">
          <span className="label">Note for AMBIT only (the CRM sees it)</span>
          <textarea className="input" rows={2} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} placeholder="Liftgate needed, residential, call before delivery…" />
        </label>
      </section>

      {error ? <div className="alert err small" role="alert"><CircleAlert size={16} /><span>{error}</span></div> : null}
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={pending} onClick={() => save(true)}>
          {pending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
          {method === "pickup" ? "Done: ready to send" : "Done: send to the CRMs for freight"}
        </button>
        <button type="button" className="btn dark" disabled={pending} onClick={() => save(false)}>Save draft</button>
        <button type="button" className="btn ghost" disabled={pending} onClick={() => router.back()}><X size={16} /> Cancel</button>
      </div>
    </div>
  );
}
