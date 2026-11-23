"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Eye, LoaderCircle, Search, Undo2, Users, Package, Percent } from "lucide-react";
import { money } from "@/lib/format";
import type { Basis, PriceBatch } from "@/lib/prices";
import { bulkApply, bulkPreview, bulkUndo, type BulkInput, type BulkPreview } from "@/app/(app)/prices/actions";

export type DashCust = { id: string; name: string; state: string; rep: string; distributor: boolean; own: number };
export type DashItem = { id: string; sku: string; name: string; unit: string; category_id: string | null; basis: Basis; base: number | null };
type Batch = PriceBatch & { pending: number };

const PER: Record<Basis, string> = { lb: "per lb", sqft: "per sq ft", unit: "each" };
const price = (v: number | null, basis: Basis) => (v === null ? "–" : basis === "sqft" ? `$${v.toFixed(3)}` : money(v));
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The pricing dashboard: 1. who (the base price list and/or customers, filtered and ticked), 2. which items (whole
 * groups or single SKUs), 3. the change (a %, an amount, or a new price, from a date). Preview first, then apply.
 * Every change is kept and can be undone.
 */
export function PricingDashboard({ customers, items, cats, batches, today }: { customers: DashCust[]; items: DashItem[]; cats: { id: string; name: string }[]; batches: Batch[]; today: string }) {
  const router = useRouter();
  const [pending, go] = useTransition();

  // 1. Who
  const [base, setBase] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cq, setCq] = useState("");
  const [rep, setRep] = useState("");
  const [st, setSt] = useState("");
  const [kind, setKind] = useState<"all" | "contractors" | "distributors">("all");
  const [hasOwn, setHasOwn] = useState<"any" | "yes" | "no">("any");
  const reps = useMemo(() => [...new Set(customers.map((c) => c.rep).filter(Boolean))].sort(), [customers]);
  const states = useMemo(() => [...new Set(customers.map((c) => c.state).filter(Boolean))].sort(), [customers]);
  const ct = cq.trim().toLowerCase();
  const shownCust = customers.filter((c) =>
    (!ct || c.name.toLowerCase().includes(ct)) && (!rep || c.rep === rep) && (!st || c.state === st) &&
    (kind === "all" || (kind === "distributors") === c.distributor) && (hasOwn === "any" || (hasOwn === "yes") === c.own > 0));
  const allShownPicked = shownCust.length > 0 && shownCust.every((c) => picked.has(c.id));
  const toggleCust = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickShown = (on: boolean) => setPicked((s) => { const n = new Set(s); for (const c of shownCust) { if (on) n.add(c.id); else n.delete(c.id); } return n; });

  // 2. Which items
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [iq, setIq] = useState("");
  const byCat = useMemo(() => {
    const m = new Map<string, DashItem[]>();
    for (const i of items) { const k = i.category_id ?? "other"; m.set(k, [...(m.get(k) ?? []), i]); }
    return m;
  }, [items]);
  const catList = [...cats.filter((c) => byCat.has(c.id)), ...(byCat.has("other") ? [{ id: "other", name: "Other" }] : [])];
  const it = iq.trim().toLowerCase();
  const toggleItem = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setCat = (cat: string, on: boolean) => setChosen((s) => { const n = new Set(s); for (const i of byCat.get(cat) ?? []) { if (on) n.add(i.id); else n.delete(i.id); } return n; });
  const chosenItems = items.filter((i) => chosen.has(i.id));
  const bases = [...new Set(chosenItems.map((i) => i.basis))];

  // 3. The change
  const [method, setMethod] = useState<"pct" | "add" | "set">("pct");
  const [amount, setAmount] = useState("");
  const [eff, setEff] = useState(today);
  const [onlyOwn, setOnlyOwn] = useState(true);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const input = (): BulkInput => ({
    customers: [...picked], all_customers: false, include_base: base, products: [...chosen], method, amount, effective_on: eff, only_own: onlyOwn, note,
  });
  const ready = (base || picked.size > 0) && chosen.size > 0 && amount.trim() !== "" && Number.isFinite(Number(amount.replace(/[$,%\s]/g, "")));
  const stale = () => { setPreview(null); setConfirm(false); setMsg(null); };
  const unitWord = bases.length === 1 ? PER[bases[0]] : "on each item's own basis (per lb for foam, per sq ft for batts, each for the rest)";

  function doPreview() {
    setMsg(null); setConfirm(false);
    go(async () => {
      const r = await bulkPreview(input());
      if (!r.ok) { setPreview(null); return setMsg({ ok: false, text: r.error }); }
      setPreview(r.preview);
      if (!r.preview.changes) setMsg({ ok: false, text: "Nothing would change. Check who and which items you picked, or untick \"Only customers with their own price\"." });
    });
  }
  function doApply() {
    if (!confirm) return setConfirm(true);
    go(async () => {
      const r = await bulkApply(input());
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: r.now ? `Done: ${r.changes.toLocaleString()} prices changed (change #${r.batch}). Orders placed from now on use them.` : `Scheduled: ${r.changes.toLocaleString()} prices change on ${day(eff)} (change #${r.batch}). Until then everyone keeps today's price.` });
      setPreview(null); setConfirm(false); setAmount(""); setNote("");
      router.refresh();
    });
  }
  function undo(id: number) {
    go(async () => {
      const r = await bulkUndo(id);
      setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error });
      router.refresh();
    });
  }

  const who = `${base ? "Base price list" : ""}${base && picked.size ? " + " : ""}${picked.size ? `${picked.size.toLocaleString()} customer${picked.size === 1 ? "" : "s"}` : ""}` || "Nobody yet";

  return (
    <div className="pm">
      <p className="small muted" style={{ margin: 0 }}>
        Change many prices at once. Customers without a price of their own pay the <b>base price</b>; a customer&apos;s own price always wins. Pick who, pick the items, pick the change, then <b>Preview</b>. Nothing changes until you click <b>Apply</b>, and every change can be undone below.
      </p>

      <div className="pm-grid">
        {/* 1. Who */}
        <section className="card pm-card" aria-labelledby="pm-who">
          <div className="pm-h"><span className="pm-n">1</span><h2 id="pm-who"><Users size={17} /> Who</h2><span className="pm-sum">{who}</span></div>
          <label className="pm-base">
            <input type="checkbox" checked={base} onChange={(e) => { setBase(e.target.checked); stale(); }} />
            <span><b>Base price list</b><span className="tiny faint">Everyone without their own price on an item pays this.</span></span>
          </label>
          <div className="search"><Search size={17} /><input className="input" value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Find a customer" aria-label="Find a customer" /></div>
          <div className="pm-filters">
            <select className="select sm" value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Sales rep"><option value="">Every rep</option>{reps.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <select className="select sm" value={st} onChange={(e) => setSt(e.target.value)} aria-label="State"><option value="">Every state</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select className="select sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind of customer"><option value="all">Contractors and distributors</option><option value="contractors">Contractors only</option><option value="distributors">Distributors only</option></select>
            <select className="select sm" value={hasOwn} onChange={(e) => setHasOwn(e.target.value as typeof hasOwn)} aria-label="Own prices"><option value="any">With or without own prices</option><option value="yes">Has own prices</option><option value="no">On base prices only</option></select>
          </div>
          <div className="row between" style={{ gap: 8 }}>
            <label className="check small"><input type="checkbox" checked={allShownPicked} onChange={(e) => { pickShown(e.target.checked); stale(); }} /> Select all {shownCust.length.toLocaleString()} shown</label>
            {picked.size ? <button type="button" className="linkbtn small" onClick={() => { setPicked(new Set()); stale(); }}>Clear ({picked.size})</button> : null}
          </div>
          <ul className="pm-list" aria-label="Customers">
            {shownCust.slice(0, 400).map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => { toggleCust(c.id); stale(); }} />
                  <span className="pm-name">{c.name}</span>
                  <span className="tiny faint">{[c.state, c.rep, c.distributor ? "Distributor" : "", c.own ? `${c.own} own` : ""].filter(Boolean).join(" · ")}</span>
                </label>
              </li>
            ))}
            {shownCust.length > 400 ? <li className="tiny faint" style={{ padding: 8 }}>{(shownCust.length - 400).toLocaleString()} more: use Select all, or narrow the list.</li> : null}
            {!shownCust.length ? <li className="tiny faint" style={{ padding: 8 }}>No customers match.</li> : null}
          </ul>
        </section>

        {/* 2. Which items */}
        <section className="card pm-card" aria-labelledby="pm-what">
          <div className="pm-h"><span className="pm-n">2</span><h2 id="pm-what"><Package size={17} /> Which items</h2><span className="pm-sum">{chosen.size ? `${chosen.size} item${chosen.size === 1 ? "" : "s"}` : "None yet"}</span></div>
          <div className="search"><Search size={17} /><input className="input" value={iq} onChange={(e) => setIq(e.target.value)} placeholder="Find an item or SKU" aria-label="Find an item" /></div>
          <ul className="pm-list pm-cats" aria-label="Item groups">
            {catList.map((c) => {
              const list = byCat.get(c.id) ?? [];
              const shown = it ? list.filter((i) => `${i.sku} ${i.name}`.toLowerCase().includes(it)) : list;
              if (it && !shown.length) return null;
              const n = list.filter((i) => chosen.has(i.id)).length;
              const isOpen = open === c.id || !!it;
              return (
                <li key={c.id}>
                  <div className="pm-cat">
                    <input type="checkbox" checked={n === list.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < list.length; }} onChange={(e) => { setCat(c.id, e.target.checked); stale(); }} aria-label={`All of ${c.name}`} />
                    <button type="button" className="pm-cat-b" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} <b>{c.name}</b>
                      <span className="tiny faint">{n ? `${n} of ${list.length}` : `${list.length} items`} · {PER[list[0]?.basis ?? "unit"]}</span>
                    </button>
                  </div>
                  {isOpen ? (
                    <ul className="pm-items">
                      {shown.map((i) => (
                        <li key={i.id}>
                          <label>
                            <input type="checkbox" checked={chosen.has(i.id)} onChange={() => { toggleItem(i.id); stale(); }} />
                            <span className="pm-name">{i.name}</span>
                            <span className="tiny faint">{i.sku} · base {price(i.base, i.basis)} {PER[i.basis]}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {chosen.size ? <button type="button" className="linkbtn small" onClick={() => { setChosen(new Set()); stale(); }}>Clear items</button> : null}
        </section>

        {/* 3. The change */}
        <section className="card pm-card" aria-labelledby="pm-how">
          <div className="pm-h"><span className="pm-n">3</span><h2 id="pm-how"><Percent size={17} /> The change</h2></div>
          <div className="seg sm" role="group" aria-label="How to change">
            <button type="button" className={method === "pct" ? "on" : ""} onClick={() => { setMethod("pct"); stale(); }}>Raise by %</button>
            <button type="button" className={method === "add" ? "on" : ""} onClick={() => { setMethod("add"); stale(); }}>Raise by $</button>
            <button type="button" className={method === "set" ? "on" : ""} onClick={() => { setMethod("set"); stale(); }}>New price</button>
          </div>
          <label className="field">
            <span className="label">{method === "pct" ? "Percent (use a minus for a cut, like -5)" : method === "add" ? `Dollars ${unitWord} (minus for a cut)` : `New price ${unitWord}`}</span>
            <span className="pm-amt">
              {method !== "pct" ? <span aria-hidden="true">$</span> : null}
              <input id="pm-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); stale(); }} placeholder={method === "pct" ? "10" : method === "add" ? (bases.length === 1 && bases[0] === "lb" ? "0.10" : "5.00") : "2.45"} />
              {method === "pct" ? <span aria-hidden="true">%</span> : null}
            </span>
          </label>
          {method !== "pct" && bases.length > 1 ? <div className="alert warn small"><CircleAlert size={16} /><span>These items are priced different ways ({bases.map((b) => PER[b]).join(", ")}). The amount goes on each one as it&apos;s priced. Pick one group at a time to be sure.</span></div> : null}
          <label className="field">
            <span className="label"><CalendarClock size={14} style={{ verticalAlign: "-2px" }} /> Starts</span>
            <input id="pm-eff" className="input" type="date" min={today} value={eff} onChange={(e) => { setEff(e.target.value); stale(); }} />
            <span className="tiny faint">{eff > today ? "Orders placed before then keep today's price." : "Today: orders placed from now on use the new prices."}</span>
          </label>
          <label className="check small">
            <input type="checkbox" checked={onlyOwn} onChange={(e) => { setOnlyOwn(e.target.checked); stale(); }} />
            <span>Only customers with their own price on an item. <span className="faint">Untick to give every picked customer their own price, worked out from the base price.</span></span>
          </label>
          <label className="field">
            <span className="label">Note (optional)</span>
            <input id="pm-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: 2027 price increase letter" maxLength={500} />
          </label>
          <button type="button" className="btn" disabled={!ready || pending} onClick={doPreview}>
            {pending && !confirm ? <LoaderCircle size={16} className="spin" /> : <Eye size={16} />} Preview
          </button>
        </section>
      </div>

      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{msg.text}</span></div> : null}

      {preview && preview.changes ? (
        <section className="card pm-preview" aria-label="Preview">
          <div className="row between wrap" style={{ gap: 10 }}>
            <div className="col" style={{ gap: 2 }}>
              <b>{preview.changes.toLocaleString()} price{preview.changes === 1 ? "" : "s"} would change</b>
              <span className="small muted">
                {[preview.base ? `${preview.base} base price${preview.base === 1 ? "" : "s"}` : "", preview.customers ? `${preview.customers.toLocaleString()} customer${preview.customers === 1 ? "" : "s"}` : "", `${preview.products} item${preview.products === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                {preview.down ? ` · ${preview.down.toLocaleString()} go down` : ""} · {eff > today ? `starting ${day(eff)}` : "starting today"}
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {confirm ? <button type="button" className="btn sm ghost" onClick={() => setConfirm(false)}>Not yet</button> : null}
              <button type="button" className="btn sm" disabled={pending} onClick={doApply}>
                {pending && confirm ? <LoaderCircle size={16} className="spin" /> : null}
                {confirm ? `Yes, change ${preview.changes.toLocaleString()} prices` : "Apply"}
              </button>
            </div>
          </div>
          <div className="cr-wrap" style={{ maxHeight: 460 }}>
            <table className="cr-table">
              <thead><tr><th>Customer</th><th style={{ textAlign: "left" }}>Item</th><th>Now</th><th>New</th><th>Change</th></tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.company_id ? r.company : <b>Base price</b>}{r.company_id && !r.own ? <span className="tiny faint"> (from base)</span> : null}</td>
                    <td style={{ textAlign: "left" }}><span className="small">{r.product}</span><div className="tiny faint">{r.sku}</div></td>
                    <td>{price(r.old, r.basis)} <span className="tiny faint">{PER[r.basis]}</span></td>
                    <td><b>{price(r.new, r.basis)}</b> <span className="tiny faint">{PER[r.basis]}</span></td>
                    <td className={r.old !== null && r.new < r.old ? "red" : "pm-up"}>{r.old === null ? "new" : `${r.new >= r.old ? "+" : ""}${r.basis === "sqft" ? (r.new - r.old).toFixed(3) : (r.new - r.old).toFixed(2)}${r.old ? ` (${(((r.new - r.old) / r.old) * 100).toFixed(1)}%)` : ""}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.changes > preview.rows.length ? <span className="tiny faint">Showing the first {preview.rows.length.toLocaleString()} of {preview.changes.toLocaleString()}.</span> : null}
        </section>
      ) : null}

      <section className="card col" style={{ gap: 8 }} aria-label="Changes made">
        <b className="small">Changes made</b>
        {batches.length ? (
          <div className="cr-wrap">
            <table className="cr-table">
              <thead><tr><th>#</th><th>Change</th><th>Prices</th><th>Starts</th><th>By</th><th>Status</th><th /></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="faint">{b.id}</td>
                    <td><b>{b.label}</b>{b.note ? <div className="tiny faint">{b.note}</div> : null}</td>
                    <td>{b.changes.toLocaleString()}<div className="tiny faint">{b.customers ? `${b.customers.toLocaleString()} customers` : "Base prices"} · {b.products} items</div></td>
                    <td>{day(b.effective_on)}</td>
                    <td className="small">{b.created_by_name ?? ""}<div className="tiny faint">{day(b.created_at)}</div></td>
                    <td>{b.undone_at ? <span className="pill grey">Undone</span> : b.pending ? <span className="pill warn">Waiting · {b.pending}</span> : <span className="pill ok">In effect</span>}</td>
                    <td>{!b.undone_at ? <button type="button" className="btn sm ghost" disabled={pending} onClick={() => undo(b.id)}><Undo2 size={14} /> Undo</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <span className="small muted">No changes yet.</span>}
      </section>
    </div>
  );
}
