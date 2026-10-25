"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Submit } from "@/components/forms";
import type { StockRow } from "@/lib/inventory/view";
import type { Category } from "@/lib/types";

const q2 = (n: number | null) => (n === null ? "–" : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const reorderNow = (r: StockRow) => r.reorder_point !== null && r.net !== null && r.net <= r.reorder_point;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "reorder", label: "Reorder" },
  { key: "reserved", label: "Reserved" },
  { key: "uncounted", label: "Not counted" },
] as const;

export function InventoryList({
  rows,
  branch,
  categories,
  action,
  initialFilter,
}: {
  rows: StockRow[];
  branch: string;
  categories: Category[];
  action: (form: FormData) => Promise<void>;
  initialFilter: string;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<string>(FILTERS.some((x) => x.key === initialFilter) ? initialFilter : "all");
  const [cat, setCat] = useState("all");
  const cats = useMemo(() => categories.filter((c) => rows.some((r) => r.category_id === c.id)), [categories, rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (cat === "all" || r.category_id === cat) &&
      (f === "all" || (f === "reorder" && reorderNow(r)) || (f === "reserved" && r.pending > 0) || (f === "uncounted" && r.on_hand === null)) &&
      (!needle || `${r.sku} ${r.name}`.toLowerCase().includes(needle)),
  );

  return (
    <section className="section">
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Search SKU or item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inventory" />
      </div>
      <div className="chips" role="tablist" aria-label="Show">
        {FILTERS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={f === x.key} className={`chip sm${f === x.key ? " on" : ""}`} onClick={() => setF(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {cats.length > 1 ? (
        <div className="chips" role="tablist" aria-label="Group">
          <button type="button" role="tab" aria-selected={cat === "all"} className={`chip sm${cat === "all" ? " on2" : ""}`} onClick={() => setCat("all")}>Every group</button>
          {cats.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={`chip sm${cat === c.id ? " on2" : ""}`} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="card muted small center">Nothing matches.</div>
      ) : (
        <div className="list inv-list">
          <div className="inv-row inv-cols" aria-hidden="true">
            <span>Item</span>
            <span>In stock</span>
            <span>Reserved</span>
            <span>Available</span>
          </div>
          {shown.map((r) => (
            <details key={r.product_id} id={`p-${r.product_id}`} className="inv-item">
              <summary className="inv-row">
                <span className="inv-name">
                  <b>{r.name}</b>
                  <span className="tiny faint">
                    {r.sku}
                    {r.reorder_point !== null ? ` · reorder at ${q2(r.reorder_point)}` : ""}
                    {r.last_counted ? ` · counted ${r.last_counted.slice(5).replace("-", "/")}${r.counted_by ? ` by ${r.counted_by}` : ""}` : ""}
                  </span>
                </span>
                <span className="num">{q2(r.on_hand)}</span>
                <span className="num faint">{r.pending ? q2(r.pending) : "–"}</span>
                <span className={`num avail ${reorderNow(r) ? "warn" : r.label === "out" ? "out" : ""}`}>{q2(r.net)}</span>
              </summary>
              <form action={action} className="inv-form">
                <input type="hidden" name="branch" value={branch} />
                <input type="hidden" name="product" value={r.product_id} />
                <input type="hidden" name="sku" value={r.sku} />
                <label className="field">
                  <span className="label">What happened</span>
                  <select className="select sm" name="mode" defaultValue="count">
                    <option value="count">Counted it (this is what&apos;s on the shelf)</option>
                    <option value="received">Received (add to stock)</option>
                    <option value="removed">Damaged / used / moved (take out)</option>
                  </select>
                </label>
                <label className="field">
                  <span className="label">How many ({r.unit})</span>
                  <input className="input sm" name="qty" inputMode="decimal" required placeholder={r.on_hand !== null ? q2(r.on_hand) : "0"} autoComplete="off" />
                </label>
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <span className="label">Note (optional)</span>
                  <input className="input sm" name="note" maxLength={200} placeholder="Truck from Covestro, lot numbers, …" />
                </label>
                <Submit className="btn sm" pendingText="Saving…">Save</Submit>
              </form>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
