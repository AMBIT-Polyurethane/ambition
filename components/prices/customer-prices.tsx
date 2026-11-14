"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Search, Undo2 } from "lucide-react";
import { money } from "@/lib/format";
import { BASIS_LABEL, basisFor, perUnit, SOURCE_LABEL, type Basis, type CustPrice, type PriceEdit, type PriceItem } from "@/lib/prices";
import { savePrices } from "@/app/(app)/prices/actions";

type Row = { price: string; basis: Basis; effective_on: string; expires_on: string };
const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "" : String(Math.round(n * 10 ** d) / 10 ** d));
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

/** One customer's price on every item: type a price, pick per lb / sq ft / unit, save. Blank = no special price. */
export function CustomerPrices({ company, items, cats, prices, editable, today }: {
  company: string; items: PriceItem[]; cats: { id: string; name: string }[]; prices: CustPrice[]; editable: boolean; today: string;
}) {
  const router = useRouter();
  const saved = useMemo(() => new Map(prices.map((p) => [p.product_id, p])), [prices]);
  const start = (p: PriceItem): Row => {
    const c = saved.get(p.id);
    return { price: c ? fmt(Number(c.price), 4) : "", basis: c?.basis ?? basisFor(p), effective_on: c?.effective_on ?? "", expires_on: c?.expires_on ?? "" };
  };
  const [edit, setEdit] = useState<Record<string, Row>>({});
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(prices.length ? "priced" : cats.find((c) => c.id === "ambit-foam") ? "ambit-foam" : "all");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();

  const row = (p: PriceItem) => edit[p.id] ?? start(p);
  const changed = (p: PriceItem) => {
    const e = edit[p.id];
    if (!e) return false;
    const s = start(p);
    return (e.price.trim() === "" ? "" : String(Number(e.price))) !== (s.price === "" ? "" : String(Number(s.price))) || (e.price !== "" && (e.basis !== s.basis || e.effective_on !== s.effective_on || e.expires_on !== s.expires_on));
  };
  const set = (p: PriceItem, patch: Partial<Row>) => { setMsg(null); setEdit((m) => ({ ...m, [p.id]: { ...row(p), ...patch } })); };
  const dirty = items.filter(changed);
  const count = (k: string) => items.filter((p) => (k === "all" ? true : k === "priced" ? saved.has(p.id) : p.category_id === k)).length;
  const t = q.trim().toLowerCase();
  const shown = items.filter((p) => (cat === "all" ? true : cat === "priced" ? saved.has(p.id) || !!edit[p.id] : p.category_id === cat) && (!t || `${p.sku} ${p.name}`.toLowerCase().includes(t)));
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  function save() {
    const out: PriceEdit[] = dirty.map((p) => { const r = row(p); return { company_id: company, product_id: p.id, price: r.price.trim() || null, basis: r.basis, effective_on: r.effective_on || null, expires_on: r.expires_on || null }; });
    const badDates = out.find((o) => o.expires_on && o.effective_on && o.expires_on < o.effective_on);
    if (badDates) return setMsg({ ok: false, text: "An expiry date is before its start date." });
    go(async () => {
      const r = await savePrices(out, "manual");
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setEdit({});
      setMsg({ ok: true, text: `Saved ${r.saved} price${r.saved === 1 ? "" : "s"}.` });
      router.refresh();
    });
  }

  return (
    <div className="col" style={{ gap: 12, paddingBottom: dirty.length ? 70 : 0 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="search grow" style={{ minWidth: 220 }}><Search size={18} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item or SKU" aria-label="Search items" /></div>
      </div>
      <div className="chips wrap">
        <button type="button" className={`chip sm${cat === "priced" ? " on" : ""}`} onClick={() => setCat("priced")}>Has a price · {count("priced")}</button>
        {cats.filter((c) => count(c.id)).map((c) => <button key={c.id} type="button" className={`chip sm${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>{c.name} · {count(c.id)}</button>)}
        <button type="button" className={`chip sm${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>Every item · {count("all")}</button>
      </div>
      {shown.length ? (
        <div className="cr-wrap">
          <table className="cr-table cp-table">
            <thead><tr><th>Item</th><th>List</th><th>Their price</th><th>Priced</th><th>= Each</th><th>Starts (optional)</th><th>Ends (optional)</th><th>Last change</th></tr></thead>
            <tbody>
              {shown.map((p) => {
                const r = row(p);
                const c = saved.get(p.id);
                const n = r.price.trim() === "" ? null : Number(r.price);
                const each = n !== null && Number.isFinite(n) ? perUnit(n, r.basis, p) : null;
                const expired = c?.expires_on && c.expires_on < today;
                return (
                  <tr key={p.id} className={changed(p) ? "dirty" : ""}>
                    <td><b className="small">{p.name}</b><div className="tiny faint">{p.sku} · {p.unit}{cat === "all" || cat === "priced" ? ` · ${catName.get(p.category_id ?? "") ?? ""}` : ""}</div></td>
                    <td className="faint">{p.list_price !== null ? money(Number(p.list_price)) : "–"}</td>
                    <td>
                      <span className="cp-money"><span>$</span>
                        <input className="input sm" value={r.price} disabled={!editable} inputMode="decimal" placeholder="–" aria-label={`${p.name} price`}
                          onChange={(e) => set(p, { price: e.target.value.replace(/[^\d.]/g, "") })} />
                      </span>
                    </td>
                    <td>
                      <select className="select sm" value={r.basis} disabled={!editable} onChange={(e) => set(p, { basis: e.target.value as Basis })} aria-label="Priced per">
                        <option value="lb">{BASIS_LABEL.lb}</option><option value="sqft">{BASIS_LABEL.sqft}</option><option value="unit">per {p.unit}</option>
                      </select>
                    </td>
                    <td className="faint">{each !== null && r.basis !== "unit" ? `${money(each)} / ${p.unit}` : "–"}</td>
                    <td>{r.price ? <input className="input sm cp-date" type="date" value={r.effective_on} disabled={!editable} onChange={(e) => set(p, { effective_on: e.target.value })} aria-label="Starts" /> : <span className="faint">–</span>}</td>
                    <td>{r.price ? <input className="input sm cp-date" type="date" value={r.expires_on} disabled={!editable} onChange={(e) => set(p, { expires_on: e.target.value })} aria-label="Ends" /> : <span className="faint">–</span>}</td>
                    <td className="tiny faint" style={{ textAlign: "left" }}>
                      {c ? <>{SOURCE_LABEL[c.source] ?? c.source}{c.source_ref ? ` ${c.source_ref}` : ""} · {c.updated_by_name ?? ""} · {day(c.updated_at)}{expired ? <span className="pill red" style={{ marginLeft: 4 }}>Expired</span> : null}</> : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="card small muted center">{cat === "priced" ? "No special prices yet. Pick a group above and type their prices." : "No items match."}</div>}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`}>{msg.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<span>{msg.text}</span></div> : null}
      {editable && dirty.length ? (
        <div className="save-bar">
          <span className="small"><b>{dirty.length}</b> change{dirty.length === 1 ? "" : "s"}</span>
          <button type="button" className="btn sm ghost" onClick={() => { setEdit({}); setMsg(null); }}><Undo2 size={15} /> Undo</button>
          <button type="button" className="btn sm" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save prices"}</button>
        </div>
      ) : null}
    </div>
  );
}
