"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Percent, Search, Undo2 } from "lucide-react";
import { money } from "@/lib/format";
import { BASIS_LABEL, basisFor, perUnit, setPrice, SOURCE_LABEL, type Basis, type CustPrice, type PendingChange, type PriceEdit, type PriceItem } from "@/lib/prices";
import { saveBasePrices, saveCategoryMarkup, savePrices } from "@/app/(app)/prices/actions";

type Row = { price: string; basis: Basis; effective_on: string; expires_on: string };
const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "" : String(Math.round(n * 10 ** d) / 10 ** d));
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

/**
 * One customer's price on every item: type a price, pick per lb / sq ft / unit, save. Blank = they pay the base price.
 * With mode "base" (0106) it's the base price list itself: what everyone without their own price pays.
 */
export function CustomerPrices({ company, items, cats, prices, editable, today, mode = "customer", base = {}, pending: upcoming = [], admin = false, costs = {}, markups = {} }: {
  company: string; items: PriceItem[]; cats: { id: string; name: string }[]; prices: CustPrice[]; editable: boolean; today: string;
  mode?: "customer" | "base"; base?: Record<string, { price: number; basis: Basis }>; pending?: PendingChange[];
  /** Admins (0091 / 0112): our purchase price per item, and the markups set for this customer by group. */
  admin?: boolean; costs?: Record<string, number>; markups?: Record<string, { pct: number; items: number | null; by: string | null; at: string }>;
}) {
  const isBase = mode === "base";
  const soon = new Map(upcoming.map((c) => [c.product_id, c]));
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
  // Markup on our cost for a whole group (admins): typed per group, applied to the price boxes, remembered on Save.
  const showCost = admin && !isBase;
  const [markIn, setMarkIn] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<{ cat: string; pct: number; n: number } | null>(null);

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

  /** Every item in the group with a purchase price: their price = cost x (1 + markup), in the row's own unit (per lb, sq ft or each). */
  function applyMarkup(group: string) {
    const pct = Number((markIn[group] ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(pct) || pct <= -100 || (markIn[group] ?? "").trim() === "") return setMsg({ ok: false, text: "Type the markup %, like 25." });
    const next: Record<string, Row> = {};
    let n = 0;
    for (const p of items.filter((x) => x.category_id === group)) {
      const cost = costs[p.id];
      if (!cost || cost <= 0) continue;
      const r = row(p);
      const each = cost * (1 + pct / 100);
      const k = perUnit(1, r.basis, p);
      const basis: Basis = k ? r.basis : "unit";
      const v = k ? each / k : each;
      next[p.id] = { ...r, basis, price: fmt(v, basis === "unit" ? 2 : 4) };
      n++;
    }
    if (!n) return setMsg({ ok: false, text: "None of these items has a purchase price yet, so there's nothing to mark up." });
    setEdit((m) => ({ ...m, ...next }));
    setApplied({ cat: group, pct, n });
    setMsg({ ok: true, text: `${pct}% markup filled in on ${n} item${n === 1 ? "" : "s"}. Check them, then tap Save prices.` });
  }

  function save() {
    const out: PriceEdit[] = dirty.map((p) => { const r = row(p); return { company_id: company, product_id: p.id, price: r.price.trim() || null, basis: r.basis, effective_on: r.effective_on || null, expires_on: r.expires_on || null }; });
    const badDates = out.find((o) => o.expires_on && o.effective_on && o.expires_on < o.effective_on);
    if (badDates) return setMsg({ ok: false, text: "An expiry date is before its start date." });
    go(async () => {
      const r = isBase
        ? await saveBasePrices(out.map((o) => ({ product_id: o.product_id, price: o.price, basis: o.basis })))
        : await savePrices(out, "manual", applied ? `${applied.pct}% markup on cost` : undefined);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      let note = "";
      if (applied && !isBase) {
        const m = await saveCategoryMarkup(company, applied.cat, applied.pct, applied.n);
        note = m.ok ? ` The ${applied.pct}% markup is saved for ${catName.get(applied.cat) ?? "this group"}.` : ` ${m.error}`;
      }
      setEdit({});
      setApplied(null);
      setMsg({ ok: true, text: `Saved ${r.saved} price${r.saved === 1 ? "" : "s"}.${note}` });
      router.refresh();
    });
  }

  return (
    <div className="col" style={{ gap: 12, paddingBottom: dirty.length ? 70 : 0 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="search grow" style={{ minWidth: 220 }}><Search size={18} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item or SKU" aria-label="Search items" /></div>
      </div>
      <div className="chips wrap">
        <button type="button" className={`chip sm${cat === "priced" ? " on" : ""}`} onClick={() => setCat("priced")}>{isBase ? "Has a base price" : "Has a price"} · {count("priced")}</button>
        {cats.filter((c) => count(c.id)).map((c) => <button key={c.id} type="button" className={`chip sm${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>{c.name} · {count(c.id)}</button>)}
        <button type="button" className={`chip sm${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>Every item · {count("all")}</button>
      </div>
      {showCost && editable && cat !== "all" && cat !== "priced" ? (() => {
        const inCat = items.filter((p) => p.category_id === cat);
        const withCost = inCat.filter((p) => (costs[p.id] ?? 0) > 0).length;
        const m = markups[cat];
        return (
          <div className="card cp-markup">
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <b className="small"><Percent size={14} aria-hidden /> Markup on our cost · {catName.get(cat)}</b>
              <span className="tiny muted">
                {m ? `Set to ${m.pct}% on ${day(m.at)}${m.by ? ` by ${m.by.split(" ")[0]}` : ""}${m.items ? ` (${m.items} items)` : ""}. ` : "Not set for this customer yet. "}
                {withCost} of {inCat.length} items have a purchase price{withCost < inCat.length ? "; the rest are left as they are" : ""}.
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="cp-money"><input className="input sm" style={{ width: 90 }} inputMode="decimal" placeholder={m ? String(m.pct) : "25"} aria-label={`Markup % for ${catName.get(cat)}`}
                value={markIn[cat] ?? ""} onChange={(e) => setMarkIn((x) => ({ ...x, [cat]: e.target.value.replace(/[^\d.-]/g, "") }))}
                onKeyDown={(e) => e.key === "Enter" && applyMarkup(cat)} /><span>%</span></span>
              <button type="button" className="btn sm dark" disabled={!withCost} onClick={() => applyMarkup(cat)}>Apply to {withCost} item{withCost === 1 ? "" : "s"}</button>
            </div>
          </div>
        );
      })() : null}
      {shown.length ? (
        <div className="cr-wrap">
          <table className="cr-table cp-table">
            <thead><tr><th>Item</th>{isBase ? null : <th>Base</th>}<th>{isBase ? "Base price" : "Their price"}</th><th>Priced</th><th>= Each</th>{showCost ? <><th className="cp-adm">Purchase price</th><th className="cp-adm">Sell price</th><th className="cp-adm">Margin $</th><th className="cp-adm">Margin %</th></> : null}{isBase ? null : <><th>Starts (optional)</th><th>Ends (optional)</th></>}<th>Last change</th></tr></thead>
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
                    {isBase ? null : (
                      <td className="faint">
                        {base[p.id] ? <>{base[p.id].basis === "sqft" ? `$${base[p.id].price.toFixed(3)}` : money(base[p.id].price)}<span className="tiny"> {base[p.id].basis === "unit" ? "" : BASIS_LABEL[base[p.id].basis]}</span></> : "–"}
                      </td>
                    )}
                    <td>
                      <span className="cp-money"><span>$</span>
                        <input className="input sm" value={r.price} disabled={!editable} inputMode="decimal" placeholder="–" aria-label={`${p.name} price`}
                          onChange={(e) => set(p, { price: e.target.value.replace(/[^\d.]/g, "") })} />
                      </span>
                      {soon.get(p.id) ? (
                        <div className="tiny" style={{ color: "var(--warn-text)", marginTop: 4 }}>
                          → {money(Number(soon.get(p.id)!.new_price))} {soon.get(p.id)!.basis === "unit" ? "" : BASIS_LABEL[soon.get(p.id)!.basis]} from {day(soon.get(p.id)!.effective_on)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <select className="select sm" value={r.basis} disabled={!editable} onChange={(e) => set(p, { basis: e.target.value as Basis })} aria-label="Priced per">
                        <option value="lb">{BASIS_LABEL.lb}</option><option value="sqft">{BASIS_LABEL.sqft}</option><option value="unit">per {p.unit}</option>
                      </select>
                    </td>
                    <td className="faint">
                      {each !== null && r.basis !== "unit" ? `${money(each)} / ${p.unit}` : "–"}
                      {n !== null && r.basis === "lb" && p.category_id === "ambit-foam" && !/^ISO/i.test(p.sku) && setPrice(n, p) ? <div className="tiny">{money(setPrice(n, p)!)} / set</div> : null}
                    </td>
                    {showCost ? (() => {
                      const cost = costs[p.id];
                      const own = each !== null ? each : n !== null && r.basis === "unit" ? n : null;
                      const fromBase = own === null && base[p.id] ? perUnit(base[p.id].price, base[p.id].basis, p) : null;
                      const sell = own ?? fromBase;
                      const m$ = sell !== null && cost ? sell - cost : null;
                      const mp = m$ !== null && sell ? (m$ / sell) * 100 : null;
                      return <>
                        <td className="cp-adm">{cost ? money(cost) : <span className="faint">–</span>}</td>
                        <td className="cp-adm">{sell !== null ? <>{money(sell)}{own === null ? <span className="tiny faint"> base</span> : null}</> : <span className="faint">–</span>}</td>
                        <td className={`cp-adm${m$ !== null && m$ < 0 ? " err-text" : ""}`}>{m$ !== null ? money(m$) : <span className="faint">–</span>}</td>
                        <td className={`cp-adm${mp !== null && mp < 0 ? " err-text" : mp !== null && mp < 10 ? " warn-text" : ""}`}>{mp !== null ? `${mp.toFixed(1)}%` : <span className="faint">–</span>}</td>
                      </>;
                    })() : null}
                    {isBase ? null : <>
                      <td>{r.price ? <input className="input sm cp-date" type="date" value={r.effective_on} disabled={!editable} onChange={(e) => set(p, { effective_on: e.target.value })} aria-label="Starts" /> : <span className="faint">–</span>}</td>
                      <td>{r.price ? <input className="input sm cp-date" type="date" value={r.expires_on} disabled={!editable} onChange={(e) => set(p, { expires_on: e.target.value })} aria-label="Ends" /> : <span className="faint">–</span>}</td>
                    </>}
                    <td className="tiny faint" style={{ textAlign: "left" }}>
                      {c ? <>{SOURCE_LABEL[c.source] ?? c.source}{c.source_ref ? ` ${c.source_ref}` : ""} · {c.updated_by_name ?? ""} · {day(c.updated_at)}{expired ? <span className="pill red" style={{ marginLeft: 4 }}>Expired</span> : null}</> : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="card small muted center">{cat === "priced" ? (isBase ? "No base prices yet. Pick a group above and type them." : "No special prices yet. Pick a group above and type their prices.") : "No items match."}</div>}
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
