"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Search } from "lucide-react";
import { saveListValues } from "@/app/(app)/inventory/hub-actions";

// Admins set what each item is worth on the Inventory Hub dashboards (never shown on order screens).
// Each row shows what the dashboards use today, so it's easy to see what's missing.

export type ValueRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  group: string;
  /** Catalog price (what the order screen shows for items that aren't customer priced). */
  catalog: number | null;
  /** The List value saved now. */
  list: number | null;
  /** Units on hand, all locations. */
  onHand: number;
  /** Locations whose spreadsheet lists it / that have some in stock. */
  locations: number;
  stockedAt: number;
  /** COUNT SHEET Sell Prices that aren't blank. */
  sheet: number[];
};

type Show = "needs" | "stock" | "all";

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
const whole = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const clean = (s: string) => s.replace(/[$,\s]/g, "");

export function ValueEditor({ rows, locationCount }: { rows: ValueRow[]; locationCount: number }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const needsAny = rows.some((r) => r.onHand > 0 && !r.list && !r.sheet.length && !r.catalog);
  const [show, setShow] = useState<Show>(needsAny ? "needs" : "all");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group))], [rows]);
  const valueOf = (r: ValueRow) => (r.id in edits ? edits[r.id] : r.list === null ? "" : String(r.list));
  const listNow = (r: ValueRow) => {
    const v = Number(clean(valueOf(r)));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const needs = (r: ValueRow) => r.onHand > 0 && !listNow(r) && !r.sheet.length && !r.catalog;
  const changed = rows.filter((r) => r.id in edits && clean(edits[r.id]) !== (r.list === null ? "" : String(r.list)));
  const bad = changed.filter((r) => clean(edits[r.id]) !== "" && !(Number(clean(edits[r.id])) >= 0));

  const shown = rows.filter((r) => {
    if (group && r.group !== group) return false;
    if (show === "needs" && !(needs(r) || r.id in edits)) return false;
    if (show === "stock" && !(r.onHand > 0)) return false;
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return w.every((x) => `${r.sku} ${r.name}`.toLowerCase().includes(x));
  });
  const needCount = rows.filter(needs).length;

  const sheetText = (r: ValueRow) => {
    if (!r.sheet.length) return "Sheet Sell Price: blank";
    const lo = Math.min(...r.sheet);
    const hi = Math.max(...r.sheet);
    const where = r.sheet.length === r.locations ? (r.locations === 1 ? "1 location" : `all ${r.locations} locations`) : `${r.sheet.length} of ${r.locations} locations`;
    return `Sheet Sell Price: ${lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`} (${where})`;
  };
  const usedText = (r: ValueRow) => {
    const lv = listNow(r);
    if (lv) return { text: `${money(lv)} each (List value)`, tone: "ok" };
    if (r.sheet.length) return { text: "each location's Sheet Sell Price", tone: "" };
    if (r.catalog) return { text: `${money(r.catalog)} each (catalog price)`, tone: "" };
    return { text: r.onHand > 0 ? "no value: left out of totals" : "no value", tone: r.onHand > 0 ? "warn" : "" };
  };

  const save = () => {
    setMsg(null);
    if (bad.length) return setMsg({ ok: false, text: `Check ${bad[0].sku}: type a dollar amount, like 950 or 39.90.` });
    start(async () => {
      const r = await saveListValues(changed.map((x) => ({ id: x.id, value: clean(edits[x.id]) })));
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: `Saved ${r.saved} ${r.saved === 1 ? "value" : "values"}. The dashboards and reports use them now.` });
      setEdits({});
      router.refresh();
    });
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card small col" style={{ gap: 6 }}>
        <span>
          <b>What each item is worth on the Inventory Hub</b>: an estimate of what it sells for, used only for stock value on the dashboard
          and reports. Only admins see this page. It never shows on the order screens, Place an order, or to customers.
        </span>
        <span className="muted">
          The dashboards use an item&apos;s List value first. If it has none, they use the Sell Price on that location&apos;s COUNT SHEET, then the catalog
          price. Leave a box blank to use those. One value per item, used at all {locationCount} {locationCount === 1 ? "location" : "locations"}.
        </span>
      </div>

      <div className="row lv-bar" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="search grow" style={{ minWidth: 200 }}>
          <Search size={16} />
          <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU or item" aria-label="Search SKU or item" />
        </div>
        <select className="select sm" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
          <option value="">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="select sm" value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show">
          <option value="needs">Needs a value ({needCount})</option>
          <option value="stock">In stock</option>
          <option value="all">All items ({rows.length})</option>
        </select>
      </div>

      {shown.length ? (
        <div className="card lv-list" style={{ padding: 0 }}>
          {shown.map((r) => {
            const used = usedText(r);
            const dirty = changed.some((c) => c.id === r.id);
            return (
              <div key={r.id} className={`lv-row${dirty ? " dirty" : ""}`}>
                <div className="col tight" style={{ minWidth: 0 }}>
                  <b className="lv-name">{r.name}</b>
                  <span className="tiny faint">{r.sku} · per {r.unit} · {r.group}</span>
                  <span className="tiny muted">
                    {r.onHand > 0 ? `${whole(r.onHand)} in stock at ${r.stockedAt} ${r.stockedAt === 1 ? "location" : "locations"}` : "None in stock"}
                    {" · "}
                    {sheetText(r)}
                    {r.catalog ? ` · Catalog ${money(r.catalog)}` : ""}
                  </span>
                  <span className={`tiny lv-used ${used.tone}`}>Dashboards use: {used.text}</span>
                </div>
                <label className="lv-in">
                  <span className="tiny faint">List value</span>
                  <span className="row" style={{ gap: 4 }}>
                    <span className="muted">$</span>
                    <input
                      className="input sm"
                      inputMode="decimal"
                      value={valueOf(r)}
                      onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value }))}
                      placeholder="blank"
                      aria-label={`List value for ${r.sku}`}
                    />
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card small muted">
          {show === "needs" ? "Every item in stock has a value. " : "Nothing matches. "}
          <button type="button" className="linklike" onClick={() => { setShow("all"); setQ(""); setGroup(""); }}>Show all items</button>
        </div>
      )}

      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>{msg.text}</div> : null}

      {/* The Save bar shows once something has changed, so it never covers the list for nothing. */}
      {changed.length ? (
        <div className="lv-save">
          <button type="button" className="btn" onClick={save} disabled={pending} style={{ gap: 8 }}>
            {pending ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}
            Save {changed.length} {changed.length === 1 ? "change" : "changes"}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => { setEdits({}); setMsg(null); }} disabled={pending}>Undo</button>
        </div>
      ) : null}
    </div>
  );
}
