"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, PackageOpen, Plus, Trash2, Truck } from "lucide-react";
import { ItemPick, type StockItem } from "@/components/incoming-forms";
import { markPartial, unmarkPartial } from "@/app/(app)/inventory/partial-actions";

type Line = { product_id: string; sku: string; name: string | null; unit: string | null; qty: number; received_qty: number | null };
type Row = { key: number; item: StockItem | null; qty: string };

/** On a Receiving Report: "Partial receipt: the rest of the PO is still coming". Makes the follow-up delivery. */
export function PartialReceipt({
  id, lines, items, today, rest,
}: {
  id: number;
  lines: Line[];
  items: StockItem[];
  today: string;
  /** Already marked partial: the follow-up delivery. */
  rest: { id: number; status: string; expected_on: string; lines: string } | null;
}) {
  const router = useRouter();
  const plus7 = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const byId = new Map(items.map((i) => [i.product_id, i]));
  // Starts with what came up short on this report.
  const start: Row[] = lines
    .filter((l) => l.received_qty !== null && Number(l.received_qty) < Number(l.qty))
    .map((l, k) => ({ key: k, item: byId.get(l.product_id) ?? { product_id: l.product_id, sku: l.sku, name: l.name ?? l.sku, unit: l.unit ?? "each", lots: false }, qty: String(Number(l.qty) - Number(l.received_qty)) }));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(start.length ? start : [{ key: 0, item: null, qty: "" }]);
  const [expected, setExpected] = useState(rest?.expected_on ?? plus7);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sure, setSure] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await markPartial({ id, expected, note, lines: rows.filter((r) => r.item).map((r) => ({ product_id: r.item!.product_id, qty: Number(r.qty) })) });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setOpen(false);
    router.refresh();
  }
  async function undo() {
    setBusy(true);
    const res = await unmarkPartial(id);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setSure(false);
    router.refresh();
  }

  if (rest && !open) {
    return (
      <section className="card col partial-card" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <PackageOpen size={18} className="red" />
          <b>Partial receipt: the rest of this order is still coming</b>
        </div>
        <Link href={`/inventory/incoming/${rest.id}`} className="item" style={{ padding: "10px 12px", borderRadius: 12, background: "var(--s2)" }}>
          <Truck size={18} className="chev" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t">{rest.status === "expected" ? `Expected ${new Date(`${rest.expected_on}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : rest.status === "received" || rest.status === "submitted" ? "The rest came in" : "Cancelled"}</div>
            <div className="s ellipsis">{rest.lines}</div>
          </div>
        </Link>
        {rest.status === "expected" ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn sm dark" onClick={() => setOpen(true)}>Change what&apos;s still coming</button>
            {sure ? (
              <>
                <button type="button" className="btn sm danger" disabled={busy} onClick={undo}>Yes, it all came</button>
                <button type="button" className="btn sm ghost" onClick={() => setSure(false)}>Keep it</button>
              </>
            ) : (
              <button type="button" className="linkbtn small" onClick={() => setSure(true)}>Not partial after all</button>
            )}
          </div>
        ) : null}
        {err ? <div className="alert err small"><CircleAlert size={16} style={{ flex: "none" }} /><span>{err}</span></div> : null}
      </section>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn dark block no-print" onClick={() => setOpen(true)}>
        <PackageOpen size={17} /> Partial receipt: the rest is still coming
      </button>
    );
  }

  return (
    <section className="card col no-print" style={{ gap: 10 }}>
      <b>What&apos;s still coming on this PO?</b>
      <span className="tiny muted">
        Everything that didn&apos;t come on this truck. It becomes an expected delivery, listed under Receiving › Waiting on the rest of the order,
        and you receive it there when it shows up. {start.length ? "Items that came up short are already filled in." : ""}
      </span>
      <div className="col" style={{ gap: 8 }}>
        {rows.map((r) => (
          <div key={r.key} className="partial-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <ItemPick items={items} value={r.item} onPick={(i) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, item: i } : x)))} />
            </div>
            <input
              className="input sm"
              style={{ width: 80, textAlign: "right" }}
              inputMode="decimal"
              placeholder="How many"
              value={r.qty}
              onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, qty: e.target.value.replace(/[^\d.]/g, "") } : x)))}
              aria-label="How many are still coming"
            />
            <span className="tiny faint" style={{ minWidth: 34 }}>{r.item?.unit ?? ""}</span>
            <button type="button" className="iconbtn sm" aria-label="Remove" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: Date.now(), item: null, qty: "" }]))}><Trash2 size={15} /></button>
          </div>
        ))}
        <button type="button" className="linkbtn small" style={{ alignSelf: "flex-start" }} onClick={() => setRows((rs) => [...rs, { key: Date.now(), item: null, qty: "" }])}><Plus size={14} /> Add an item that&apos;s still coming</button>
      </div>
      <div className="grid2">
        <label className="field">
          <span className="label">Expected</span>
          <input className="input sm" type="date" value={expected} min={today} onChange={(e) => setExpected(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Note (optional)</span>
          <input className="input sm" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Back-ordered at Covestro, ships next week" />
        </label>
      </div>
      {err ? <div className="alert err small"><CircleAlert size={16} style={{ flex: "none" }} /><span>{err}</span></div> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={busy || !rows.some((r) => r.item && Number(r.qty) > 0)} onClick={save}>{busy ? "Saving…" : "Save: mark partial"}</button>
        <button type="button" className="btn dark" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  );
}
