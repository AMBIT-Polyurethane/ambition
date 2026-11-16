import { Submit } from "@/components/forms";
import { fixLoadedLot } from "@/app/(app)/orders/actions";
import { dateShort } from "@/lib/format";

// Spray foam: which lot each drum really came from.
//  · At pickup (LotPickupCheck, inside the Mark picked up form): confirm the lots, or pick the one that went on the truck.
//  · After pickup (LotFixAfter, admins): change the lot or the brand; FOAM LOTS and the order's lot record follow.

export type LotOption = { lot_id: number; sku: string; name: string; lot_no: string | null; exp: string | null; use_by: string | null; available: number; expired: boolean; current: boolean; same_type: boolean };
export type LotLine = { line: number; item: string; qty: number; unit: string; sku: string; lot_id: number | null; lot_no: string | null; options: LotOption[] };

export const optionText = (o: LotOption, qty: number, after = false) =>
  [`${o.sku}`, `Lot ${o.lot_no || "(no lot #)"}`, o.exp ? `exp ${dateShort(o.exp)}` : o.use_by ? `use by ${dateShort(o.use_by)}` : null,
    o.current ? (after ? "what's recorded now" : "picked by the app") : `${Math.max(0, o.available)} left`, o.expired ? "EXPIRED" : null, !o.current && o.available < qty ? "not enough" : null]
    .filter(Boolean).join(" · ");

/** The lot the app picked was taken off FOAM LOTS (moved to DAMAGED DRUMS, say): someone has to pick the real one. */
const gone = (l: LotLine) => l.lot_id !== null && !l.options.some((o) => o.lot_id === l.lot_id);

/** One select per drum line, starting on the lot the app picked. Its name is lot:<line id>. */
export function LotPickupCheck({ lines }: { lines: LotLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="lotcheck">
      <b className="small">Lots going on the truck</b>
      <span className="tiny faint">Check the lot # on every drum. If one is different, pick the lot that&apos;s really going out (another brand of ISO is fine). It&apos;s saved on the item variance table and the spreadsheet follows.</span>
      {lines.map((l) => (
        <label key={l.line} className="lotcheck-row">
          <span className="col tight" style={{ minWidth: 0 }}><b className="small">{l.qty} {l.unit}{l.qty === 1 ? "" : "s"} · {l.item}</b><span className="tiny faint">{l.sku}</span></span>
          <select className="select sm" name={`lot:${l.line}`} defaultValue={gone(l) ? "" : String(l.lot_id ?? "")} required={gone(l)} aria-label={`Lot for ${l.item}`}>
            {l.lot_id === null ? <option value="">No lot picked</option> : null}
            {gone(l) ? <option value="" disabled>Lot {l.lot_no || "(no lot #)"} isn&apos;t on FOAM LOTS any more: pick the lot going out</option> : null}
            {l.options.some((o) => o.same_type) ? (
              <optgroup label="Same product">
                {l.options.filter((o) => o.same_type).map((o) => <option key={o.lot_id} value={o.lot_id} disabled={!o.current && o.available < l.qty}>{optionText(o, l.qty)}</option>)}
              </optgroup>
            ) : null}
            {l.options.some((o) => !o.same_type) ? (
              <optgroup label="Loaded a different product instead">
                {l.options.filter((o) => !o.same_type).map((o) => <option key={o.lot_id} value={o.lot_id} disabled={o.available < l.qty}>{optionText(o, l.qty)}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
      ))}
      <label className="check small"><input type="checkbox" name="lots_checked" value="1" required /> I checked the lot # on every drum against this list</label>
    </div>
  );
}

/** Admins, on a completed order: change what was loaded. Each line saves on its own, with a reason. */
export function LotFixAfter({ orderId, lines }: { orderId: string; lines: LotLine[] }) {
  if (!lines.length) return null;
  return (
    <details className="card lotfix">
      <summary><b>Wrong lot or brand went out?</b> <span className="tiny faint">· admins: fix what was loaded</span></summary>
      <p className="tiny faint" style={{ margin: "6px 0 10px" }}>
        Pick the lot that really left. The drums go back on the lot the app took them from and come off the right one (Shipped Out on FOAM LOTS, so the COUNT SHEET follows),
        and the order&apos;s lot record is corrected. Prices and the invoice don&apos;t change.
      </p>
      {lines.map((l) => (
        <form key={l.line} action={fixLoadedLot} className="lotfix-row">
          <input type="hidden" name="id" value={orderId} />
          <input type="hidden" name="line" value={l.line} />
          <span className="col tight" style={{ minWidth: 0 }}>
            <b className="small">{l.qty} {l.unit}{l.qty === 1 ? "" : "s"} · {l.item}</b>
            <span className="tiny faint">Recorded: {l.sku} · Lot {l.lot_no || "(none)"}</span>
          </span>
          <select className="select sm" name="lot" defaultValue={gone(l) ? "" : String(l.lot_id ?? "")} required aria-label={`Lot that really went out for ${l.item}`}>
            {l.lot_id === null ? <option value="" disabled>No lot recorded: pick one</option> : null}
            {gone(l) ? <option value="" disabled>Lot {l.lot_no || "(no lot #)"} isn&apos;t on FOAM LOTS any more: pick one</option> : null}
            {l.options.some((o) => o.same_type) ? (
              <optgroup label="Same product">
                {l.options.filter((o) => o.same_type).map((o) => <option key={o.lot_id} value={o.lot_id}>{optionText(o, l.qty, true)}</option>)}
              </optgroup>
            ) : null}
            {l.options.some((o) => !o.same_type) ? (
              <optgroup label="A different product went out">
                {l.options.filter((o) => !o.same_type).map((o) => <option key={o.lot_id} value={o.lot_id}>{optionText(o, l.qty, true)}</option>)}
              </optgroup>
            ) : null}
          </select>
          <input className="input sm" name="reason" required maxLength={300} placeholder="Why (e.g. packing slip shows Wanhua lot 2604P0345)" aria-label="Why it's changing" />
          <Submit className="btn sm" pendingText="Saving…">Save</Submit>
        </form>
      ))}
    </details>
  );
}
