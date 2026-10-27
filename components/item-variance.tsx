import { Submit } from "@/components/forms";
import { changeLot, swapItem } from "@/app/(app)/orders/actions";
import { dateShort, dateTime, qtyText } from "@/lib/format";
import { brandOf, pickText, type LotPick } from "@/lib/order-doc/loads";
import { showsPicks } from "@/lib/order-doc/load";
import type { OrderItem } from "@/lib/types";

// The item variance table: what was ordered next to what's being loaded (product type and lot / batch).
// Admins and people with the Item variance box can change either one; every change is kept with who, when and why.

export type LotChoice = { lot_id: number; sku: string; lot_no: string; exp: string | null; use_by: string | null; available: number; expired: boolean };
export type Alternative = { product_id: string; sku: string; name: string; on_hand: number | null; available: number | null };
export type Variance = { id: number; order_item_id: number | null; kind: "type" | "lot"; from_text: string | null; to_text: string | null; reason: string | null; stage: string | null; by_name: string | null; created_at: string };

export type VarianceData = {
  orderId: string;
  lines: OrderItem[];
  picks: Map<number, LotPick[]>;
  choices: Map<number, LotChoice[]>;
  alternatives: Map<number, Alternative[]>;
  log: Variance[];
  canEdit: boolean;
};

const choiceText = (c: LotChoice) =>
  [brandOf(c.sku), `Lot ${c.lot_no || "(no lot #)"}`, c.exp ? `exp ${dateShort(c.exp)}` : c.use_by ? `use by ${dateShort(c.use_by)}` : null, `${Math.max(0, c.available)} available`, c.expired ? "EXPIRED" : null]
    .filter(Boolean)
    .join(" · ");

const altText = (a: Alternative) => `${a.name} (${a.sku})${a.available !== null ? ` · ${Math.max(0, Number(a.available))} available` : ""}`;

/** One line per change, newest last. */
export function VarianceLog({ log }: { log: Variance[] }) {
  if (!log.length) return null;
  return (
    <div className="vary-log">
      {log.map((v) => (
        <div key={v.id} className="vary-log-row">
          <b>{v.kind === "type" ? "Type changed" : "Lot changed"}:</b> {v.from_text} → <b>{v.to_text}</b>
          {v.reason ? <> · “{v.reason}”</> : null}
          <span className="faint"> · {v.by_name ?? "AMBIT"}, {dateTime(v.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

/** The table itself. `open` expands it (the step it belongs to is the one being worked on). */
export function ItemVariance({ data, open, title }: { data: VarianceData; open: boolean; title: string }) {
  const { orderId, lines, picks, choices, alternatives, canEdit } = data;
  const changed = lines.filter((l) => l.ordered_sku).length;
  return (
    <details className="vary" open={open}>
      <summary>
        {title}
        <span className="faint"> · {lines.length} {lines.length === 1 ? "item" : "items"}{changed ? ` · ${changed} loading a different type` : ""}</span>
      </summary>
      <div className="vary-table" role="table" aria-label="Item variance">
        <div className="vary-row vary-head" role="row">
          <span role="columnheader">Ordered</span>
          <span role="columnheader">Loading (type)</span>
          <span role="columnheader">Lot / batch</span>
        </div>
        {lines.map((l) => {
          const all = (picks.get(l.id) ?? []).filter((p) => p.state !== "cancelled");
          // Only spray foam (by lot, or from another brand) has lots worth listing.
          const ps = showsPicks(l.sku, all) || all.some((p) => (choices.get(p.id) ?? []).length > 0) ? all : [];
          const alts = alternatives.get(l.id) ?? [];
          const done = all.some((p) => p.state === "done");
          return (
            <div key={l.id} className="vary-row" role="row">
              <div role="cell" className="vary-cell">
                <span className="vary-k">Ordered</span>
                <b>{l.ordered_name ?? l.name}</b>
                <span className="tiny faint">{l.ordered_sku ?? l.sku} · {qtyText(Number(l.qty), l.unit)}</span>
              </div>
              <div role="cell" className="vary-cell">
                <span className="vary-k">Loading (type)</span>
                {l.ordered_sku ? (
                  <>
                    <b className="vary-changed">{l.name}</b>
                    <span className="tiny faint">{l.sku} · changed</span>
                  </>
                ) : (
                  <span className="small">As ordered</span>
                )}
                {canEdit && alts.length && !done ? (
                  <details className="vary-edit">
                    <summary className="linkbtn tiny">Load a different type</summary>
                    <form action={swapItem} className="col" style={{ gap: 6, marginTop: 6 }}>
                      <input type="hidden" name="id" value={orderId} />
                      <input type="hidden" name="item" value={l.id} />
                      <select className="select sm" name="product" required defaultValue="" aria-label="Load instead">
                        <option value="" disabled>Load instead…</option>
                        {alts.map((a) => (
                          <option key={a.product_id} value={a.product_id}>
                            {a.sku === l.ordered_sku ? "Back to what was ordered: " : ""}
                            {altText(a)}
                          </option>
                        ))}
                      </select>
                      <input className="input sm" name="reason" required minLength={3} maxLength={300} placeholder="Why? e.g. Out of Summer, loading Winter" aria-label="Reason" />
                      <Submit className="btn sm dark" pendingText="Saving…">Save change</Submit>
                    </form>
                  </details>
                ) : null}
              </div>
              <div role="cell" className="vary-cell">
                <span className="vary-k">Lot / batch</span>
                {ps.length ? (
                  ps.map((p) => {
                    const opts = (choices.get(p.id) ?? []).filter((c) => c.lot_id === p.lot_id || c.lot_no || c.available > 0);
                    return (
                      <div key={p.id} className="col tight">
                        <span className="small">
                          <b>{qtyText(p.qty, l.unit)}</b> {pickText(p)}
                          {p.state === "done" ? <span className="faint"> · picked up</span> : null}
                        </span>
                        {canEdit && p.state === "reserved" && opts.length ? (
                          <details className="vary-edit">
                            <summary className="linkbtn tiny">Change lot</summary>
                            <form action={changeLot} className="col" style={{ gap: 6, marginTop: 6 }}>
                              <input type="hidden" name="id" value={orderId} />
                              <input type="hidden" name="line" value={p.id} />
                              <select className="select sm" name="lot" defaultValue={p.lot_id ?? ""} aria-label="Lot">
                                {p.lot_id === null ? <option value="">Choose a lot…</option> : null}
                                {opts.map((c) => (
                                  <option key={c.lot_id} value={c.lot_id} disabled={c.lot_id !== p.lot_id && c.available < p.qty}>
                                    {choiceText(c)}{c.lot_id === p.lot_id ? " (now)" : ""}
                                  </option>
                                ))}
                              </select>
                              <input className="input sm" name="reason" maxLength={300} placeholder="Why? (optional)" aria-label="Reason" />
                              <Submit className="btn sm dark" pendingText="Saving…">Use this lot</Submit>
                              <span className="tiny faint">Moves all {qtyText(p.qty, l.unit)}. Lots without enough available are greyed out.</span>
                            </form>
                          </details>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <span className="tiny faint">Not tracked by lot</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {canEdit ? <p className="tiny faint" style={{ margin: "8px 0 0" }}>Price stays as ordered. Fix it on the invoice if the new type costs more or less.</p> : null}
    </details>
  );
}
