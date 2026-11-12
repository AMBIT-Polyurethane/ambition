"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, ListChecks, Search, Send, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { Submit } from "@/components/forms";
import type { StockRow } from "@/lib/inventory/view";
import type { Category } from "@/lib/types";
import { requestReorder, saveReorderPoints } from "@/app/(app)/inventory/reorder-actions";

const q2 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const reorderNow = (r: StockRow) => r.reorder_point !== null && r.net !== null && r.net <= r.reorder_point;
const md = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}` : "–");
/** Same rules as lib/inventory/reorder (kept here so the screen can show them as you type). */
const suggestRop = (sold60: number, weeks: number) => (sold60 > 0 ? Math.max(1, Math.ceil((sold60 / 60) * weeks * 7)) : 0);
const suggestQty = (r: StockRow, sold60: number) => {
  const net = r.net ?? 0;
  const target = r.max_qty && r.max_qty > 0 ? r.max_qty : Math.max((r.reorder_point ?? 0) * 2, Math.ceil(sold60 / 2), 1);
  return Math.max(1, Math.ceil(target - net));
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "reorder", label: "At reorder point" },
  { key: "norop", label: "No reorder point" },
  { key: "reserved", label: "Reserved" },
  { key: "uncounted", label: "Not counted" },
] as const;

type Mode = "view" | "rop" | "pick" | "qty";

export function InventoryList({
  rows,
  branch,
  branchName,
  categories,
  action,
  initialFilter,
  sheetUrl,
  sold60 = {},
  canRop = false,
  canReorder = false,
  buyer = "purchasing",
}: {
  rows: StockRow[];
  branch: string;
  branchName?: string;
  categories: Category[];
  action: (form: FormData) => Promise<void>;
  initialFilter: string;
  sheetUrl?: string;
  /** product id -> how many sold at this location in the last 60 days (0064). */
  sold60?: Record<string, number>;
  /** Can set reorder points here (admins, CRMs, this location's warehouse manager). */
  canRop?: boolean;
  /** Can send a reorder request (admins and CRMs). */
  canReorder?: boolean;
  /** Who reorder requests go to ("Al Rearick"). */
  buyer?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [f, setF] = useState<string>(FILTERS.some((x) => x.key === initialFilter) ? initialFilter : "all");
  const [cat, setCat] = useState("all");
  const [mode, setMode] = useState<Mode>("view");
  const [weeks, setWeeks] = useState(3);
  const [rop, setRop] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cats = useMemo(() => categories.filter((c) => rows.some((r) => r.category_id === c.id)), [categories, rows]);
  const needle = q.trim().toLowerCase();
  const sold = (id: string) => sold60[id] ?? 0;
  const noRop = rows.filter((r) => r.reorder_point === null).length;
  const shown = rows.filter(
    (r) =>
      (cat === "all" || r.category_id === cat) &&
      (f === "all" ||
        (f === "reorder" && reorderNow(r)) ||
        (f === "norop" && r.reorder_point === null) ||
        (f === "reserved" && r.pending > 0) ||
        (f === "uncounted" && r.on_hand === null)) &&
      (!needle || `${r.sku} ${r.name}`.toLowerCase().includes(needle)),
  );

  // ---------------------------------------------------------------- reorder points
  const ropText = (r: StockRow) => (r.product_id in rop ? rop[r.product_id] : r.reorder_point === null ? "" : q2(r.reorder_point));
  const changed = rows.filter((r) => r.product_id in rop && (rop[r.product_id].trim() === "" ? null : Number(rop[r.product_id])) !== r.reorder_point);
  const badRop = changed.some((r) => rop[r.product_id].trim() !== "" && !(Number(rop[r.product_id]) >= 0));
  function fill(all: boolean) {
    const next = { ...rop };
    for (const r of shown) {
      if (!all && (ropText(r).trim() !== "")) continue;
      next[r.product_id] = String(suggestRop(sold(r.product_id), weeks));
    }
    setRop(next);
  }
  async function saveRop() {
    if (!changed.length || badRop) return;
    setBusy(true);
    setMsg(null);
    const res = await saveReorderPoints(
      branch,
      changed.map((r) => ({ product: r.product_id, rop: rop[r.product_id].trim() === "" ? null : Number(rop[r.product_id]) })),
    );
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: `Saved ${res.n ?? changed.length} reorder ${changed.length === 1 ? "point" : "points"}. The spreadsheet's Reorder Point column updates in a minute or two.` });
    setRop({});
    setMode("view");
    router.refresh();
  }

  // ---------------------------------------------------------------- reorder request
  const pickedRows = rows.filter((r) => r.product_id in picked);
  const atRop = rows.filter((r) => reorderNow(r) && !(r.reorder_point === 0 && !sold(r.product_id)));
  const toggle = (r: StockRow) =>
    setPicked((p) => {
      const n = { ...p };
      if (r.product_id in n) delete n[r.product_id];
      else n[r.product_id] = String(suggestQty(r, sold(r.product_id)));
      return n;
    });
  const pickAtRop = () =>
    setPicked((p) => {
      const n = { ...p };
      // Skips items with a reorder point of 0 that didn't sell in 60 days (nobody's buying them).
      for (const r of atRop) if (!(r.product_id in n)) n[r.product_id] = String(suggestQty(r, sold(r.product_id)));
      return n;
    });
  const badQty = pickedRows.some((r) => !(Number(picked[r.product_id]) > 0));
  async function send() {
    if (!pickedRows.length || badQty) return;
    setBusy(true);
    setMsg(null);
    const res = await requestReorder(branch, note, pickedRows.map((r) => ({ product: r.product_id, qty: Number(picked[r.product_id]) })));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: `Reorder request ${res.ref} (${pickedRows.length} ${pickedRows.length === 1 ? "item" : "items"}): ${res.note ?? "sent."}` });
    setPicked({});
    setNote("");
    setMode("view");
    router.refresh();
  }

  const cancel = () => (setMode("view"), setRop({}), setPicked({}), setMsg(null));
  const cols = mode === "pick" ? "inv-row inv-wide pick" : "inv-row inv-wide";

  return (
    <section className="section">
      {msg ? (
        <div className={`alert ${msg.ok ? "ok" : "err"}`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />}
          <span>{msg.text}</span>
        </div>
      ) : null}

      {mode === "view" && (canRop || canReorder) ? (
        <div className="inv-actions">
          {canRop ? (
            <button type="button" className="btn sm dark" onClick={() => (setMode("rop"), setMsg(null))}>
              <SlidersHorizontal size={15} /> Set reorder points{noRop ? <span className="pill warn" style={{ marginLeft: 4 }}>{noRop} missing</span> : null}
            </button>
          ) : null}
          {canReorder ? (
            <button type="button" className="btn sm" onClick={() => (setMode("pick"), setMsg(null))}>
              <ListChecks size={15} /> Reorder
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "rop" ? (
        <div className="card col inv-mode">
          <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
            <div className="col tight">
              <b>Set reorder points</b>
              <span className="tiny muted">
                When Available drops to this number, the item shows under &ldquo;At reorder point&rdquo;. Type a number in the Reorder at
                column, or let the app suggest one from what sold here in the last 60 days. Nothing changes until you tap Save.
              </span>
            </div>
            <button type="button" className="iconbtn" aria-label="Cancel" onClick={cancel}><X size={18} /></button>
          </div>
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <Sparkles size={16} className="red" />
            <span className="small">Suggest enough for</span>
            <select className="select sm" style={{ width: "auto" }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Weeks of sales">
              {[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} {w === 1 ? "week" : "weeks"}</option>)}
            </select>
            <span className="small">of sales</span>
            <button type="button" className="btn sm ghost" onClick={() => fill(false)}>Fill the blanks</button>
            <button type="button" className="btn sm ghost" onClick={() => fill(true)}>Replace all shown</button>
          </div>
          <span className="tiny faint">Items that didn&apos;t sell in 60 days get 0 (reorder when it runs out). Suggestions only fill the items shown below, so you can do one group at a time.</span>
        </div>
      ) : null}

      {mode === "pick" ? (
        <div className="card col inv-mode">
          <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
            <div className="col tight">
              <b>Reorder: check the items to order</b>
              <span className="tiny muted">Check every item {branchName ? `${branchName} needs` : "you need"}, then tap Next to enter how many. It goes to {buyer} as a reorder request.</span>
            </div>
            <button type="button" className="iconbtn" aria-label="Cancel" onClick={cancel}><X size={18} /></button>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn sm ghost" onClick={pickAtRop}>Check everything at reorder point ({atRop.length})</button>
            {pickedRows.length ? <button type="button" className="btn sm ghost" onClick={() => setPicked({})}>Uncheck all</button> : null}
          </div>
        </div>
      ) : null}

      {mode === "qty" ? (
        <div className="card col inv-mode">
          <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
            <div className="col tight">
              <b>How many of each?</b>
              <span className="tiny muted">Filled in up to the item&apos;s Max (or about twice its reorder point). Change any of them.</span>
            </div>
            <button type="button" className="iconbtn" aria-label="Back" onClick={() => setMode("pick")}><X size={18} /></button>
          </div>
          <div className="list rr-qty">
            {pickedRows.map((r) => (
              <div key={r.product_id} className="rr-qty-row">
                <span className="inv-name">
                  <b>{r.name}</b>
                  <span className="tiny faint">{r.sku} · available {q2(r.net)} · reorder at {q2(r.reorder_point)} · sold {q2(sold(r.product_id))} in 60 days</span>
                </span>
                <label className="rr-qty-in">
                  <input
                    className="input sm"
                    inputMode="decimal"
                    value={picked[r.product_id]}
                    onChange={(e) => setPicked((p) => ({ ...p, [r.product_id]: e.target.value.replace(/[^\d.]/g, "") }))}
                    aria-label={`How many ${r.name}`}
                  />
                  <span className="tiny faint">{r.unit}</span>
                </label>
                <button type="button" className="iconbtn sm" aria-label={`Remove ${r.name}`} onClick={() => toggle(r)}><X size={15} /></button>
              </div>
            ))}
          </div>
          <label className="field">
            <span className="label">Note for {buyer} (optional)</span>
            <textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Needed before the Tulsa job on the 20th, ship with the Covestro truck…" />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={busy || !pickedRows.length || badQty} onClick={send}>
              <Send size={16} /> {busy ? "Sending…" : `Send to ${buyer}`}
            </button>
            <button type="button" className="btn dark" onClick={() => setMode("pick")}>Back</button>
          </div>
        </div>
      ) : null}

      {mode !== "qty" ? (
        <>
          <div className="search">
            <Search size={18} />
            <input className="input" type="search" placeholder="Search SKU or item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inventory" />
          </div>
          <div className="chips" role="tablist" aria-label="Show">
            {FILTERS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={f === x.key} className={`chip sm${f === x.key ? " on" : ""}`} onClick={() => setF(x.key)}>
                {x.label}
                {x.key === "norop" && noRop ? ` · ${noRop}` : ""}
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
        </>
      ) : null}

      {mode === "qty" ? null : shown.length === 0 ? (
        <div className="card muted small center">Nothing matches.</div>
      ) : (
        <div className="list inv-list">
          <div className={`${cols} inv-cols`} aria-hidden="true">
            {mode === "pick" ? <span /> : null}
            <span>Item</span>
            <span className="hide-sm">In stock</span>
            <span className="hide-sm">Reserved</span>
            <span>Available</span>
            <span>Reorder at</span>
            <span>Sold 60 days</span>
          </div>
          {shown.map((r) => {
            const cells = (
              <>
                <span className="inv-name">
                  <b>{r.name}</b>
                  <span className="tiny faint">
                    {r.sku}
                    <span className="show-sm"> · {q2(r.on_hand)} in stock{r.pending ? ` · ${q2(r.pending)} reserved` : ""}</span>
                    {r.lots ? ` · ${r.lots.length} ${r.lots.length === 1 ? "lot" : "lots"}` : r.last_counted ? ` · counted ${r.last_counted.slice(5).replace("-", "/")}${r.counted_by ? ` by ${r.counted_by}` : ""}` : ""}
                  </span>
                </span>
                <span className="num hide-sm">{q2(r.on_hand)}</span>
                <span className="num faint hide-sm">{r.pending ? q2(r.pending) : "–"}</span>
                <span className={`num avail ${reorderNow(r) ? "warn" : r.label === "out" ? "out" : ""}`}>{q2(r.net)}</span>
              </>
            );
            const soldCell = <span className="num faint">{sold(r.product_id) ? q2(sold(r.product_id)) : "–"}</span>;
            if (mode === "rop") {
              const v = ropText(r);
              const dirty = r.product_id in rop && v !== (r.reorder_point === null ? "" : q2(r.reorder_point));
              return (
                <div key={r.product_id} className={`${cols} inv-plain`}>
                  {cells}
                  <span className="num">
                    <input
                      className={`input sm rop-in${dirty ? " dirty" : ""}${v === "" ? " blank" : ""}`}
                      inputMode="decimal"
                      value={v}
                      placeholder={String(suggestRop(sold(r.product_id), weeks))}
                      onChange={(e) => setRop((p) => ({ ...p, [r.product_id]: e.target.value.replace(/[^\d.]/g, "") }))}
                      aria-label={`Reorder point for ${r.name}`}
                    />
                  </span>
                  {soldCell}
                </div>
              );
            }
            if (mode === "pick") {
              const on = r.product_id in picked;
              return (
                <label key={r.product_id} className={`${cols} inv-plain${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r)} aria-label={`Reorder ${r.name}`} />
                  {cells}
                  <span className="num">{q2(r.reorder_point)}</span>
                  {soldCell}
                </label>
              );
            }
            return (
              <details key={r.product_id} id={`p-${r.product_id}`} className="inv-item">
                <summary className={cols}>
                  {cells}
                  <span className={`num${r.reorder_point === null ? " faint" : ""}`} title={r.rop_set_by_name ? `Set by ${r.rop_set_by_name}` : undefined}>{q2(r.reorder_point)}</span>
                  {soldCell}
                </summary>
                {r.lots ? (
                  <div className="inv-form" style={{ display: "block" }}>
                    {r.lots.length ? (
                      <table className="lot-table">
                        <thead>
                          <tr><th>Lot #</th><th>Use by</th><th className="num">Left</th><th className="num">Reserved</th><th className="num">Available</th></tr>
                        </thead>
                        <tbody>
                          {r.lots.map((l) => (
                            <tr key={l.id} className={l.expired ? "exp" : ""}>
                              <td>{l.lot_no || "(no lot #)"}</td>
                              <td>{md(l.use_by)}{l.expired ? " · expired" : l.exp ? "" : l.use_by ? " *" : ""}</td>
                              <td className="num">{q2(l.remaining)}</td>
                              <td className="num">{l.held ? q2(l.held) : "–"}</td>
                              <td className="num"><b>{q2(l.available)}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="small muted" style={{ margin: 0 }}>No lots on the spreadsheet yet.</p>
                    )}
                    <p className="lot-note">
                      Counted by lot. Change quantities on the FOAM LOTS tab of the {sheetUrl ? <a href={sheetUrl} target="_blank" rel="noopener noreferrer">spreadsheet</a> : "spreadsheet"}; the app adds pickups to Shipped Out.
                      {r.lots.some((l) => !l.exp && l.use_by) ? " * No Exp date: 12 months after Mfg." : ""}
                    </p>
                  </div>
                ) : (
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
                )}
              </details>
            );
          })}
        </div>
      )}

      {mode === "rop" ? (
        <div className="inv-bar">
          <span className="small"><b>{changed.length}</b> {changed.length === 1 ? "change" : "changes"}{badRop ? " · a number isn't right" : ""}</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm dark" onClick={cancel}>Cancel</button>
            <button type="button" className="btn sm" disabled={busy || !changed.length || badRop} onClick={saveRop}>{busy ? "Saving…" : "Save reorder points"}</button>
          </div>
        </div>
      ) : null}
      {mode === "pick" ? (
        <div className="inv-bar">
          <span className="small"><b>{pickedRows.length}</b> checked</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm dark" onClick={cancel}>Cancel</button>
            <button type="button" className="btn sm" disabled={!pickedRows.length} onClick={() => (setMode("qty"), window.scrollTo({ top: 0, behavior: "smooth" }))}>Next: how many</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
