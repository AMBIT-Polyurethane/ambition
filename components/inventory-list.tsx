"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, ListChecks, Plus, Search, Send, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { ProductPhoto } from "@/components/product-photo";
import { ItemSettings } from "@/components/inventory/item-settings";
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
  { key: "reorder", label: "Running low" },
  { key: "reserved", label: "Reserved" },
  { key: "uncounted", label: "Not counted" },
  { key: "norop", label: "No reorder point" },
] as const;

/** What a row needs, in plain words: problems sort to the top of their group. */
function statusOf(r: StockRow): { tone: "err" | "warn" | "ok" | ""; text: string; rank: number } {
  if (r.net !== null && r.net < 0) return { tone: "err", text: `Short ${q2(-r.net)}`, rank: 0 };
  if (r.net !== null && r.net === 0 && r.on_hand !== null) return { tone: "err", text: "Out", rank: 1 };
  if (reorderNow(r)) return { tone: "warn", text: "Low", rank: 2 };
  if (r.on_hand === null) return { tone: "", text: "Not counted", rank: 3 };
  return { tone: "ok", text: "OK", rank: 4 };
}
const FIRST = 10; // rows shown per group before "Show all"

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
  readOnly = false,
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
  /** Look only: a warehouse manager viewing another location (no counts, holds or reorder points). */
  readOnly?: boolean;
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
      (!needle || `${r.sku} ${r.name} ${(r.lots ?? []).map((l) => l.lot_no).join(" ")}`.toLowerCase().includes(needle)),
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
    setMsg({ ok: true, text: `Saved ${res.n ?? changed.length} reorder ${changed.length === 1 ? "point" : "points"}.` });
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
  const cols = `stk-row${mode === "pick" ? " pick" : ""}${mode === "rop" ? " rop" : ""}`;

  // ---------------------------------------------------------------- groups (problems first, the rest fold up)
  const [openG, setOpenG] = useState<Record<string, boolean>>({});
  const [allG, setAllG] = useState<Record<string, boolean>>({});
  const counts: Record<string, number> = {
    reorder: rows.filter(reorderNow).length,
    reserved: rows.filter((r) => r.pending > 0).length,
    uncounted: rows.filter((r) => r.on_hand === null).length,
    norop: noRop,
  };
  const order = new Map(rows.map((r, i) => [r.product_id, i]));
  const byNeed = (list: StockRow[]) =>
    mode === "view" ? [...list].sort((a, z) => statusOf(a).rank - statusOf(z).rank || (order.get(a.product_id) ?? 0) - (order.get(z.product_id) ?? 0)) : list;
  type Group = { id: string; name: string; rows: StockRow[]; problems: number; open: boolean };
  const groups: Group[] = (() => {
    if (cat !== "all" || needle || f !== "all") return [{ id: "", name: "", rows: byNeed(shown), problems: 0, open: true }];
    const out: Group[] = [];
    const named = new Set(cats.map((c) => c.id));
    for (const c of cats) {
      const rs = shown.filter((r) => r.category_id === c.id);
      if (rs.length) out.push({ id: c.id, name: c.name, rows: byNeed(rs), problems: rs.filter((r) => statusOf(r).rank <= 2).length, open: false });
    }
    const other = shown.filter((r) => !r.category_id || !named.has(r.category_id));
    if (other.length) out.push({ id: "other", name: "Other", rows: byNeed(other), problems: other.filter((r) => statusOf(r).rank <= 2).length, open: false });
    // Open the first group and every group with something to do; small lists open everything.
    out.forEach((g, i) => (g.open = shown.length <= 40 || i === 0 || g.problems > 0));
    return out;
  })();

  const row = (r: StockRow) => {
    const st = statusOf(r);
    const cells = (
      <>
        <ProductPhoto src={r.image_url} alt={r.name} size={88} className="stk-ph" />
        <span className="inv-name stk-name">
          <b>{r.name}</b>
          <span className="tiny faint">
            {r.sku}
            <span className="show-sm"> · {q2(r.on_hand)} in stock{r.pending ? ` · ${q2(r.pending)} reserved` : ""}</span>
            {r.adding ? " · just added" : ""}
            {r.lots ? ` · ${r.lots.length} ${r.lots.length === 1 ? "lot" : "lots"}` : r.last_counted ? ` · counted ${r.last_counted.slice(5).replace("-", "/")}${r.counted_by ? ` by ${r.counted_by}` : ""}` : ""}
          </span>
        </span>
        <span className="num c-in">{q2(r.on_hand)}</span>
        <span className="num faint c-res">{r.pending ? q2(r.pending) : "–"}</span>
        <span className={`num avail c-av ${st.tone === "err" ? "out" : st.tone === "warn" ? "warn" : ""}`}>{q2(r.net)}</span>
      </>
    );
    const soldCell = <span className="num faint c-sold">{sold(r.product_id) ? q2(sold(r.product_id)) : "–"}</span>;
    const stCell = (
      <span className="c-st">
        {st.tone === "ok" ? <span className="stk-ok"><span className="dot" />OK</span> : <span className={`pill2 sm ${st.tone}`}>{st.text}</span>}
      </span>
    );
    if (mode === "rop") {
      const v = ropText(r);
      const dirty = r.product_id in rop && v !== (r.reorder_point === null ? "" : q2(r.reorder_point));
      return (
        <div key={r.product_id} className={`${cols} inv-plain`}>
          {cells}
          <span className="num c-rop">
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
          {stCell}
        </div>
      );
    }
    if (mode === "pick") {
      const on = r.product_id in picked;
      return (
        <label key={r.product_id} className={`${cols} inv-plain${on ? " on" : ""}`}>
          <input type="checkbox" checked={on} onChange={() => toggle(r)} aria-label={`Reorder ${r.name}`} />
          {cells}
          <span className="num c-rop">{q2(r.reorder_point)}</span>
          {soldCell}
          {stCell}
        </label>
      );
    }
    return (
      <details key={r.product_id} id={`p-${r.product_id}`} className="inv-item stk-item">
        <summary className={cols}>
          {cells}
          <span className={`num c-rop${r.reorder_point === null ? " faint" : ""}`} title={r.rop_set_by_name ? `Set by ${r.rop_set_by_name}` : undefined}>{q2(r.reorder_point)}</span>
          {soldCell}
          {stCell}
        </summary>
        <div className="stk-open">
          {r.image_url ? <ProductPhoto src={r.image_url} alt={r.name} size={220} className="stk-big" /> : null}
          <div className="stk-open-b">
            {r.lots ? (
              <div className="inv-form" style={{ display: "block" }}>
                {r.lots.length ? (
                  <table className="lot-table">
                    <thead>
                      <tr><th>Lot #</th><th>Use by</th><th className="num">Left</th><th className="num">Reserved</th><th className="num">Available</th></tr>
                    </thead>
                    <tbody>
                      {r.lots.map((l) => (
                        <Fragment key={l.id}>
                          <tr className={l.expired ? "exp" : ""}>
                            <td><Link href={`/inventory/lots/${l.id}`}>{l.lot_no || "(no lot #)"}</Link></td>
                            <td>{md(l.use_by)}{l.expired ? " · expired" : l.exp ? "" : l.use_by ? " *" : ""}</td>
                            <td className="num">{q2(l.remaining)}</td>
                            <td className="num">{l.held ? q2(l.held) : "–"}</td>
                            <td className="num"><b>{q2(l.available)}</b></td>
                          </tr>
                          {l.hold ? (
                            <tr className="lot-hold">
                              <td colSpan={5}><a href={`/inventory/holds?b=${branch}`}>Held for {l.hold}</a></td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>No lots yet.</p>
                )}
                <p className="lot-note">
                  Counted by lot. Fix a count, a damaged drum or a date on <Link href={`/inventory/lots?b=${branch}`}>Foam lots</Link>; tap a lot # for its history.
                  {readOnly ? null : <>{" "}<a href={`/inventory/holds?b=${branch}`}>Hold drums for a customer</a>.</>}
                  {r.lots.some((l) => !l.exp && l.use_by) ? " * No Exp date: HFO 6 months after Mfg, everything else 12." : ""}
                </p>
              </div>
            ) : readOnly ? (
              <p className="small muted inv-look">Look only. Counts and changes for {branchName ?? "this location"} are made by its own warehouse.</p>
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
            {canRop && !readOnly ? (
              <ItemSettings
                branch={branch} product={r.product_id} unit={r.unit} rop={r.reorder_point} max={r.max_qty}
                vendor={r.vendor ?? null} lead={r.lead_days ?? null} setBy={r.rop_set_by_name}
              />
            ) : null}
          </div>
        </div>
      </details>
    );
  };

  return (
    <section className="section">
      {msg ? (
        <div className={`alert ${msg.ok ? "ok" : "err"}`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />}
          <span>{msg.text}</span>
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
        <div className="stk-bar">
          <label className="stk-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" placeholder="Search item, SKU or lot" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock" />
          </label>
          <div className="seg2" role="group" aria-label="Show">
            {FILTERS.map((x) => (
              <button key={x.key} type="button" className={f === x.key ? "on" : undefined} aria-pressed={f === x.key} onClick={() => setF(x.key)}>
                {x.label}
                {counts[x.key] ? <span className={`stk-n${x.key === "reorder" || x.key === "norop" ? " warn" : ""}`}>{counts[x.key]}</span> : null}
              </button>
            ))}
          </div>
          {cats.length > 1 ? (
            <label className="stk-select">
              <span>Category</span>
              <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                <option value="all">All</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </label>
          ) : null}
          {mode === "view" && (canRop || canReorder) ? (
            <span className="stk-actions">
              {canRop ? (
                <Link className="b2 quiet sm" href={`/inventory/stock/add?b=${branch}`}>
                  <Plus size={15} /> Add an item
                </Link>
              ) : null}
              {canRop ? (
                <button type="button" className="b2 quiet sm" onClick={() => (setMode("rop"), setMsg(null))}>
                  <SlidersHorizontal size={15} /> Reorder points
                </button>
              ) : null}
              {canReorder ? (
                <button type="button" className="b2 sm" onClick={() => (setMode("pick"), setMsg(null))}>
                  <ListChecks size={16} /> Reorder
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {mode === "qty" ? null : shown.length === 0 ? (
        <div className="card2 card2-b muted center">Nothing matches.</div>
      ) : (
        <div className="card2 stk-list">
          <div className={`stk-row stk-cols${mode === "pick" ? " pick" : ""}${mode === "rop" ? " rop" : ""}`} aria-hidden="true">
            {mode === "pick" ? <span /> : null}
            <span />
            <span>Item</span>
            <span className="c-in">In stock</span>
            <span className="c-res">Reserved</span>
            <span className="c-av">Available</span>
            <span className="c-rop">Reorder at</span>
            <span className="c-sold">Sold, 60 days</span>
            <span className="c-st">Status</span>
          </div>
          {groups.map((g) => {
            const open = !g.id || (openG[g.id] ?? g.open);
            const all = allG[g.id] || mode !== "view" || !g.id;
            const list = open ? (all ? g.rows : g.rows.slice(0, FIRST)) : [];
            return (
              <div key={g.id || "flat"} className="stk-grp">
                {g.id ? (
                  <button type="button" className="stk-grp-h" aria-expanded={open} onClick={() => setOpenG((m) => ({ ...m, [g.id]: !open }))}>
                    {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                    <b>{g.name}</b>
                    <span className="faint">{g.rows.length} {g.rows.length === 1 ? "item" : "items"}</span>
                    {g.problems ? <span className="pill2 warn sm">{g.problems} need{g.problems === 1 ? "s" : ""} you</span> : null}
                  </button>
                ) : null}
                {list.map(row)}
                {open && !all && g.rows.length > FIRST ? (
                  <button type="button" className="stk-more-btn" onClick={() => setAllG((m) => ({ ...m, [g.id]: true }))}>
                    Show all {g.rows.length} in {g.name} <ChevronDown size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
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
