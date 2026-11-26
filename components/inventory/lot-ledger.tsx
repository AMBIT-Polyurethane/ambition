"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Check, CircleAlert, CircleCheck, ClipboardCheck, LoaderCircle, Repeat, Search, X } from "lucide-react";
import { decideLotFix, fixLot, fixLotDates, switchLot } from "@/app/(app)/inventory/lot-actions";

export type LedgerLot = {
  id: number; product_id: string; sku: string; name: string; unit: string | null; lot_no: string | null;
  mfg: string | null; exp: string | null; expired: boolean; soon: boolean;
  starting: number; out: number; inn: number; adj: number; sending: number;
  left: number; promised: number; held: number; free: number;
  group: string; band: string; bandText: string; adding: boolean;
};
export type LedgerProduct = { id: string; sku: string; name: string; unit: string | null };
export type WaitingFix = { id: number; lot_no: string | null; from_sku: string | null; qty: number; reason: string | null; note: string | null; by_name: string | null; created_at: string };

const q2 = (n: number) => String(Math.round(n * 100) / 100);
const sgn = (n: number) => (n > 0 ? `+${q2(n)}` : q2(n));
const us = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "–");
const isIso = (sku: string) => /ISO/i.test(sku);
const key = (lot: string | null) => (lot ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const REASON: Record<string, string> = { count: "count difference", damaged: "damaged", used: "used here" };
type Mode = "fix" | "product" | "dates";
type Fix = "count" | "damaged" | "used";
const FILTERS = [
  { k: "all", label: "All" },
  { k: "soon", label: "Expiring in 60 days" },
  { k: "promised", label: "On orders" },
  { k: "held", label: "Held" },
  { k: "empty", label: "Empty lots" },
] as const;

/**
 * Inventory > Foam lots: the location's FOAM LOTS tab in the app (same columns, same groups), with Fix count,
 * Change product and Dates on each lot. Changes go onto the spreadsheet within 2 minutes.
 */
export function LotLedger({
  branchName, lots, products, fixLevel, canChange, canDecide, waiting, changesWeek, pick,
}: {
  branchName: string; lots: LedgerLot[]; products: LedgerProduct[];
  /** full: any amount; limited: 2 drums at a time, more waits for an admin; null: look only. */
  fixLevel: "full" | "limited" | null;
  canChange: boolean; canDecide: boolean; waiting: WaitingFix[]; changesWeek: number; pick: number | null;
}) {
  const router = useRouter();
  const [find, setFind] = useState("");
  const [f, setF] = useState<string>("all");
  const [open, setOpen] = useState<number | null>(pick);
  const [mode, setMode] = useState<Mode>("fix");
  const [fix, setFix] = useState<Fix>("count");
  const [qty, setQty] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [exp, setExp] = useState("");
  const [mfg, setMfg] = useState("");
  const [why, setWhy] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, go] = useTransition();

  const t = find.trim().toLowerCase();
  const shown = lots.filter((l) =>
    (f === "empty" ? l.left === 0 : l.left !== 0 || l.adding || l.id === open) &&
    (f !== "soon" || l.soon) && (f !== "promised" || l.promised > 0) && (f !== "held" || l.held > 0) &&
    (!t || `${l.sku} ${l.name} ${l.lot_no ?? ""}`.toLowerCase().includes(t)),
  );
  const groups = useMemo(() => {
    const m = new Map<string, LedgerLot[]>();
    for (const l of shown) m.set(l.group, [...(m.get(l.group) ?? []), l]);
    return [...m.entries()];
  }, [shown]);
  const live = lots.filter((l) => l.left > 0);
  const onHand = live.reduce((s, l) => s + l.left, 0);
  const promised = live.reduce((s, l) => s + l.promised, 0);
  const soonN = live.filter((l) => l.soon).reduce((s, l) => s + l.left, 0);

  const cur = lots.find((l) => l.id === open) ?? null;
  const targets = cur ? products.filter((p) => p.id !== cur.product_id && (p.unit ?? "").toLowerCase() === (cur.unit ?? "").toLowerCase() && isIso(p.sku) === isIso(cur.sku)) : [];
  const target = targets.find((p) => p.id === to) ?? null;
  const sameLot = (pid: string) => (cur ? lots.find((l) => l.product_id === pid && key(l.lot_no) === key(cur.lot_no) && key(cur.lot_no) !== "") ?? null : null);
  const n = Number(qty.replace(/,/g, ""));
  const delta = cur && qty.trim() !== "" && n >= 0 ? (fix === "count" ? n - cur.left : -n) : null;
  const rowsOfLot = cur && key(cur.lot_no) ? lots.filter((l) => key(l.lot_no) === key(cur.lot_no)).length : 1;

  const start = (l: LedgerLot, m: Mode) => {
    setOpen(l.id); setMode(m); setMsg(null); setNote(""); setFix("count");
    setQty(m === "product" ? (l.free ? q2(l.free) : "") : "");
    setExp(l.exp ?? ""); setMfg(l.mfg ?? "");
    const ok = products.filter((p) => p.id !== l.product_id && (p.unit ?? "").toLowerCase() === (l.unit ?? "").toLowerCase() && isIso(p.sku) === isIso(l.sku));
    setTo((ok.find((p) => /^ALPHA/i.test(p.sku)) ?? ok[0])?.id ?? "");
  };
  const finish = (r: { ok: true; msg: string } | { ok: false; error: string }) => {
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: r.msg });
    setOpen(null);
    router.refresh();
  };
  const save = () =>
    go(async () => {
      if (!cur) return;
      setMsg(null);
      if (mode === "fix") return finish(await fixLot({ lot: cur.id, reason: fix, qty, note }));
      if (mode === "product") return finish(await switchLot({ lot: cur.id, qty, product: to, note }));
      finish(await fixLotDates({ lot: cur.id, exp: exp !== (cur.exp ?? "") ? exp : "", mfg: mfg !== (cur.mfg ?? "") ? mfg : "", note }));
    });
  const decide = (id: number, ok: boolean) => go(async () => { setMsg(null); finish(await decideLotFix({ id, ok, note: why[id] ?? "" })); });

  const canSave =
    mode === "fix" ? delta !== null && delta !== 0 && (cur?.left ?? 0) + delta >= 0 && (fix === "count" || note.trim().length > 2)
    : mode === "product" ? !!cur && n > 0 && n <= cur.free && !!to && note.trim().length > 2
    : !!cur && ((!!exp && exp !== (cur.exp ?? "")) || (!!mfg && mfg !== (cur.mfg ?? "")));

  const panel = (l: LedgerLot) => (
    <div className="ldg-panel" role="region" aria-label={`Change lot ${l.lot_no ?? ""}`}>
      <div className="row between" style={{ gap: 8 }}>
        {canChange ? <div className="seg sm" role="radiogroup" aria-label="What to change">
          {fixLevel ? <button type="button" className={mode === "fix" ? "on" : ""} aria-pressed={mode === "fix"} onClick={() => start(l, "fix")}><ClipboardCheck size={15} /> Fix count</button> : null}
          <button type="button" className={mode === "product" ? "on" : ""} aria-pressed={mode === "product"} onClick={() => start(l, "product")} disabled={!l.free}><Repeat size={15} /> Change product</button>
          <button type="button" className={mode === "dates" ? "on" : ""} aria-pressed={mode === "dates"} onClick={() => start(l, "dates")}><CalendarDays size={15} /> Dates</button>
        </div> : <b className="small"><ClipboardCheck size={15} style={{ verticalAlign: -2 }} /> Fix the count on lot {l.lot_no ?? "(no lot #)"}</b>}
        <button type="button" className="iconbtn" aria-label="Close" onClick={() => setOpen(null)}><X size={18} /></button>
      </div>
      {mode === "fix" ? (
        <>
          <div className="chips wrap" role="radiogroup" aria-label="Kind of fix">
            {(["count", "damaged", "used"] as Fix[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={fix === k} className={`chip sm${fix === k ? " on" : ""}`} onClick={() => { setFix(k); setQty(""); }}>
                {k === "count" ? "I counted it" : k === "damaged" ? "Damaged drum" : "Used here"}
              </button>
            ))}
          </div>
          <div className="ldg-grid">
            <label className="field"><span className="label">{fix === "count" ? "How many are there" : "How many"}</span>
              <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} autoFocus aria-label={fix === "count" ? "How many are there" : "How many"} aria-describedby={`ldg-h-${l.id}`} />
              <span className="tiny faint" id={`ldg-h-${l.id}`}>{q2(l.left)} on hand now</span>
            </label>
            <label className="field ldg-why"><span className="label">{fix === "count" ? "Note (optional)" : "What happened"}</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={fix === "count" ? "Counted Monday morning" : fix === "damaged" ? "Forklift punctured it unloading" : "Rig test for the new crew"} />
            </label>
          </div>
          {delta !== null && delta !== 0 ? (
            <div className="ldg-preview" aria-live="polite">
              <span><b>{l.sku}</b> lot {l.lot_no ?? "(no lot #)"}: {q2(l.left)} <ArrowRight size={13} aria-hidden /> <b>{q2(l.left + delta)}</b> ({sgn(delta)} on Adj)</span>
              {fixLevel === "limited" && Math.abs(delta) > 2 ? <span className="tiny warn-text">More than 2 drums: an admin OKs it first. Nothing changes until then.</span> : null}
              {l.left + delta < 0 ? <span className="tiny err-text">That&apos;s more than the lot has.</span> : null}
            </div>
          ) : null}
        </>
      ) : mode === "product" ? (
        <>
          <div className="ldg-grid">
            <label className="field"><span className="label">How many {l.unit ?? "drum"}s</span>
              <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} aria-label={`How many ${l.unit ?? "drum"}s`} aria-describedby={`ldg-f-${l.id}`} />
              <span className="tiny faint" id={`ldg-f-${l.id}`}>{q2(l.free)} free{l.promised + l.held ? ` (${q2(l.promised + l.held)} on orders or held)` : ""}</span>
            </label>
            <label className="field"><span className="label">Change to</span>
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Change to">
                {targets.length ? null : <option value="">No product to change to here</option>}
                {targets.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
              </select>
              <span className="tiny faint">{isIso(l.sku) ? "ISO changes only to another ISO." : "Resin changes only to another resin."}</span>
            </label>
            <label className="field ldg-why"><span className="label">Why</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={target && /^ALPHA/i.test(target.sku) ? `Sold as ${target.name}` : "What happened"} />
            </label>
          </div>
          {target && n > 0 ? (
            <div className="ldg-preview" aria-live="polite">
              <span><b>{l.sku}</b> lot {l.lot_no ?? "(no lot #)"}: {q2(l.left)} <ArrowRight size={13} aria-hidden /> <b>{q2(l.left - n)}</b></span>
              <span><b>{target.sku}</b> lot {l.lot_no ?? "(no lot #)"}: {q2(sameLot(target.id)?.left ?? 0)} <ArrowRight size={13} aria-hidden /> <b>{q2((sameLot(target.id)?.left ?? 0) + n)}</b>{sameLot(target.id) ? "" : " (new row on FOAM LOTS)"}</span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="ldg-grid">
            <label className="field"><span className="label">Expires</span><input className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
            <label className="field"><span className="label">Made on</span><input className="input" type="date" value={mfg} onChange={(e) => setMfg(e.target.value)} /></label>
            <label className="field ldg-why"><span className="label">Why (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Typed wrong on the sheet" /></label>
          </div>
          <span className="tiny faint">{rowsOfLot > 1 ? `Lot ${l.lot_no} is on ${rowsOfLot} rows here (different products). All ${rowsOfLot} get the new date.` : "The new date goes onto FOAM LOTS."}</span>
        </>
      )}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={pending || !canSave} onClick={save}>
          {pending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{" "}
          {mode === "fix" ? (fixLevel === "limited" && delta !== null && Math.abs(delta) > 2 ? "Send for an admin's OK" : "Save the fix") : mode === "product" ? "Move the drums" : "Save the dates"}
        </button>
        {mode === "product" && n > l.free ? <span className="small err-text">Only {q2(l.free)} free on this lot.</span> : null}
      </div>
    </div>
  );

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="ldg-kpis">
        <div className="ihub-kpi"><span className="l">On hand</span><b>{q2(onHand)}</b><span className="s">{live.length} lots with drums</span></div>
        <div className="ihub-kpi"><span className="l">On orders</span><b>{q2(promised)}</b><span className="s">Pending Pickup</span></div>
        <div className={`ihub-kpi${soonN ? " warn" : ""}`}><span className="l">Expiring in 60 days</span><b>{q2(soonN)}</b><span className="s">sell these first</span></div>
        <div className="ihub-kpi"><span className="l">Changes this week</span><b>{changesWeek}</b><span className="s">each with who and why</span></div>
      </div>

      {waiting.length ? (
        <section className="card2" aria-label="Waiting for an admin">
          <div className="card2-h"><b>Waiting for an admin&apos;s OK</b><span className="small faint">{waiting.length}</span></div>
          <ul className="ldg-wait">
            {waiting.map((w) => (
              <li key={w.id}>
                <span className="col tight" style={{ minWidth: 0 }}>
                  <span className="small"><b>{sgn(Number(w.qty))}</b> on {w.from_sku} lot <b>{w.lot_no || "(no lot #)"}</b> ({REASON[w.reason ?? ""] ?? "fix"})</span>
                  <span className="tiny faint">{w.by_name ?? "?"} · {new Date(w.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{w.note ? ` · ${w.note}` : ""}</span>
                </span>
                {canDecide ? (
                  <span className="ldg-wait-acts">
                    <input className="input sm" value={why[w.id] ?? ""} onChange={(e) => setWhy((m) => ({ ...m, [w.id]: e.target.value }))} placeholder="Note (optional)" aria-label="Note" />
                    <button type="button" className="b2 sm" disabled={pending} onClick={() => decide(w.id, true)}><Check size={14} /> OK it</button>
                    <button type="button" className="b2 quiet sm" disabled={pending} onClick={() => decide(w.id, false)}>Turn down</button>
                  </span>
                ) : <span className="tiny faint">An admin OKs it</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card2" aria-label="Lots" style={{ padding: 0 }}>
        <div className="ldg-tools">
          <div className="search" style={{ position: "relative", flex: "1 1 260px" }}>
            <Search size={17} />
            <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a lot # or product" aria-label="Find a lot" />
          </div>
          <div className="chips wrap" role="tablist" aria-label="Show">
            {FILTERS.map((x) => <button key={x.k} type="button" role="tab" aria-selected={f === x.k} className={`chip sm${f === x.k ? " on" : ""}`} onClick={() => setF(x.k)}>{x.label}</button>)}
          </div>
        </div>
        {msg ? (
          <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"} style={{ margin: "0 16px 12px" }}>
            {msg.ok ? <CircleCheck size={16} style={{ flex: "none", marginTop: 1 }} /> : <CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />}<span>{msg.text}</span>
          </div>
        ) : null}
        <div className="tbl-wrap">
          <table className="ldg-tbl">
            <thead>
              <tr>
                <th scope="col">Lot #</th><th scope="col">Exp</th>
                <th scope="col" className="num c-x">Starting</th><th scope="col" className="num c-x">Shipped out</th><th scope="col" className="num c-x">Shipped in</th><th scope="col" className="num c-x">Adj</th>
                <th scope="col" className="num">Remaining</th><th scope="col" className="num c-x">Pending pickup</th><th scope="col" className="num">Available</th>
                <th scope="col"><span className="sr-only">Change</span></th>
              </tr>
            </thead>
            {groups.length ? groups.map(([g, ls]) => (
              <tbody key={g}>
                <tr className="ldg-band"><th colSpan={10} scope="colgroup" style={{ background: ls[0].band, color: ls[0].bandText }}>{g}</th></tr>
                {ls.map((l, i) => (
                  <Fragment key={l.id}>
                    {i === 0 || ls[i - 1].product_id !== l.product_id ? (
                      <tr className="ldg-prod"><td colSpan={10}><b>{l.name}</b> <span className="tiny faint">{l.sku} · {q2(ls.filter((x) => x.product_id === l.product_id).reduce((s, x) => s + x.left, 0))} on hand</span></td></tr>
                    ) : null}
                    <tr className={`ldg-row${open === l.id ? " on" : ""}${l.left === 0 ? " empty" : ""}`}>
                      <td><Link href={`/inventory/lots/${l.id}`} className="ldg-lot">{l.lot_no || "(no lot #)"}</Link>{l.adding ? <span className="tiny faint" style={{ display: "block" }}>being added to FOAM LOTS</span> : null}</td>
                      <td><span className={l.expired ? "pill2 sm err" : l.soon ? "pill2 sm warn" : "small"}>{us(l.exp)}</span></td>
                      <td className="num c-x">{q2(l.starting)}</td>
                      <td className="num c-x">{q2(l.out)}</td>
                      <td className="num c-x">{q2(l.inn)}</td>
                      <td className="num c-x">{q2(l.adj)}{l.sending ? <span className="tiny faint" style={{ display: "block" }}>{sgn(l.sending)} sending</span> : null}</td>
                      <td className="num"><b>{q2(l.left)}</b></td>
                      <td className="num c-x">{l.promised ? q2(l.promised) : "–"}</td>
                      <td className="num"><b>{q2(l.free)}</b>{l.held ? <span className="tiny ldg-held" style={{ display: "block" }}>{q2(l.held)} held</span> : null}</td>
                      <td className="ldg-acts">
                        {!l.adding && (fixLevel || canChange) ? (
                          <button type="button" className="b2 quiet sm" onClick={() => (open === l.id ? setOpen(null) : start(l, fixLevel ? "fix" : "product"))} aria-expanded={open === l.id}>Change</button>
                        ) : null}
                      </td>
                    </tr>
                    {open === l.id && !l.adding ? <tr className="ldg-open"><td colSpan={10}>{panel(l)}</td></tr> : null}
                  </Fragment>
                ))}
              </tbody>
            )) : (
              <tbody><tr><td colSpan={10} className="small muted" style={{ padding: 18 }}>No lots match.</td></tr></tbody>
            )}
          </table>
        </div>
        <p className="tiny faint" style={{ margin: 0, padding: "10px 16px 14px" }}>
          Remaining = Starting − Shipped out + Shipped in + Adj. Tap a lot # for its whole history.
        </p>
      </section>
    </div>
  );
}
