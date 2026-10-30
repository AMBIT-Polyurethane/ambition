"use client";

import { useRef, useState } from "react";
import { Camera, FileUp, LoaderCircle, X } from "lucide-react";
import { completeOrder, setOrderPo } from "@/app/(app)/orders/actions";
import { uploadOrderFiles } from "@/lib/order-file-upload";
import { dateShort, orderNo, qtyText } from "@/lib/format";
import type { PriceLine } from "@/lib/order-doc/loads";

/** Pick one or more files (PDF or photo). On a phone this offers the camera too. */
function FilePick({ label, files, setFiles, required, camera }: { label: string; files: File[]; setFiles: (f: File[]) => void; required?: boolean; camera?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="label">{label}</span>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 6));
          e.target.value = "";
        }}
      />
      {files.length ? (
        <div className="file-chips">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="file-chip">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" className={`btn sm ${required && !files.length ? "" : "dark"}`} onClick={() => ref.current?.click()} style={{ alignSelf: "flex-start", gap: 8 }}>
        {camera ? <Camera size={16} /> : <FileUp size={16} />} {files.length ? "Add another page" : camera ? "Take photo or choose file" : "Choose file"}
      </button>
    </div>
  );
}

function useSend() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { busy, setBusy, error, setError };
}

export type { PriceLine };

const money2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const priceOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/[$,\s]/g, ""));
const priceNum = (v: string) => Number(v.replace(/[$,\s]/g, ""));

/**
 * Order desk: Sales Order # and Invoice # side by side (both required), the price of each line from the invoice
 * (required for spray foam, fiberglass and anything else priced per customer; list prices are filled in for the
 * rest and can be changed to match the invoice). No invoice file: the invoices live in QuickBooks. ISO that goes with more than
 * one foam set (closed cell and open cell, say) has a price box for each set, since each set has its own price.
 */
export function NumbersForm({ orderId, po, invoice, lines = [] }: { orderId: string; po: string | null; invoice: string | null; lines?: PriceLine[] }) {
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, l.price === null ? "" : l.price.toFixed(2)])));
  const { busy, setBusy, error, setError } = useSend();
  const amount = (l: PriceLine) => Math.round(priceNum(prices[l.key]) * l.qty * 100) / 100;
  const total = lines.reduce((a, l) => a + (priceOk(prices[l.key] ?? "") ? amount(l) : 0), 0);
  const missing = lines.filter((l) => !priceOk(prices[l.key] ?? ""));
  const split = lines.some((l) => l.with !== undefined);
  const filled = lines.filter((l) => l.fromLast);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!String(fd.get("po") ?? "").trim()) return setError("Enter the Sales Order #.");
    if (!String(fd.get("invoice") ?? "").trim()) return setError("Enter the Invoice # too.");
    if (missing.length) {
      const what = missing.map((l) => (l.with === undefined ? l.sku : `${l.sku} ${l.withName ? `with ${l.withName}` : "(extra)"}`));
      return setError(`Enter the price for ${[...new Set(what)].join(", ")} (from the invoice).`);
    }
    setError(null);
    setBusy(true);
    // One entry per order line; a split ISO line sends a price for each foam set.
    const out = new Map<number, { id: number; price?: number; parts?: { with: number | null; qty: number; price: number }[] }>();
    for (const l of lines) {
      const price = priceNum(prices[l.key]);
      if (l.with === undefined) out.set(l.id, { id: l.id, price });
      else {
        const e = out.get(l.id) ?? { id: l.id, parts: [] };
        e.parts!.push({ with: l.with, qty: l.qty, price });
        out.set(l.id, e);
      }
    }
    fd.set("prices", JSON.stringify([...out.values()]));
    try {
      await setOrderPo(fd);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="col" style={{ gap: 10 }}>
      <input type="hidden" name="id" value={orderId} />
      <div className="grid2">
        <label className="field">
          <span className="label">Add Sales Order #</span>
          <input className="input sm" name="po" required defaultValue={po ?? ""} placeholder="Sales Order #" />
        </label>
        <label className="field">
          <span className="label">Add Invoice #</span>
          <input className="input sm" name="invoice" required defaultValue={invoice ?? ""} placeholder="Invoice #" />
        </label>
      </div>
      {lines.length ? (
        <div className="price-box">
          <div className="row between" style={{ gap: 8 }}>
            <span className="label">Prices from the invoice (each)</span>
            <span className="small">Total <b>{money2(total)}</b></span>
          </div>
          {filled.length ? (
            <div className="price-note small">
              {filled.length === lines.length ? "Every price is" : `${filled.length} of ${lines.length} prices are`} filled in from this customer&apos;s last
              order in the past 30 days. Check each one against this invoice and change any that are different.
            </div>
          ) : null}
          {lines.map((l) => {
            const v = prices[l.key] ?? "";
            const bad = v !== "" && !priceOk(v);
            const part = l.with !== undefined;
            return (
              <div key={l.key} className={`price-line${l.cp && !priceOk(v) ? " need" : ""}${part ? " part" : ""}`}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <label htmlFor={`price-${l.key}`} className="price-label">
                    <span className="price-name">{l.name}</span>
                    {part ? (
                      <span className="price-set">{l.withName ? `ISO for the ${l.withName} set` : "Extra ISO (not with a resin)"}</span>
                    ) : null}
                    <span className="tiny faint">
                      {l.sku} · {part && l.of ? `${l.qty} of ${qtyText(l.of, l.unit)}` : qtyText(l.qty, l.unit)}
                      {l.cp ? " · customer pricing, required" : ""}
                      {priceOk(v) ? ` · ${money2(amount(l))}` : ""}
                    </span>
                  </label>
                  {l.last ? (
                    <span className="price-last tiny">
                      {l.fromLast && priceOk(v) && priceNum(v) === l.last.price ? "From" : `Last price ${money2(l.last.price)} on`} {orderNo(l.last.order)}, {dateShort(l.last.on)}
                      {!priceOk(v) || priceNum(v) !== l.last.price ? (
                        <button
                          type="button"
                          className="linkbtn tiny"
                          aria-label={`Use the last price, ${money2(l.last.price)}, for ${l.sku}`}
                          onClick={() => setPrices((p) => ({ ...p, [l.key]: l.last!.price.toFixed(2) }))}
                        >
                          Use it
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <span className="price-in">
                  <span aria-hidden="true">$</span>
                  <input
                    id={`price-${l.key}`}
                    className="input sm"
                    inputMode="decimal"
                    value={v}
                    placeholder={l.cp ? "Price" : "0.00"}
                    aria-label={part ? `Price each for ${l.sku} ${l.withName ? `with ${l.withName}` : "extra"}` : `Price each for ${l.sku}`}
                    aria-invalid={bad || undefined}
                    onChange={(e) => setPrices((p) => ({ ...p, [l.key]: e.target.value }))}
                  />
                </span>
              </div>
            );
          })}
          {split ? (
            <span className="tiny faint">
              The ISO (A side) is split by foam set, like the invoice, so each set gets its own price. Enter the price per drum: the
              invoice amount for that line divided by its drums (for example $13,020 ÷ 12 drums = $1,085.00).
            </span>
          ) : null}
          <span className="tiny faint">Spray foam, fiberglass and other customer-priced items need their price. The others start at list price: change any to match the invoice. These prices count toward sales goals.</span>
        </div>
      ) : null}
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="submit" className="btn sm" disabled={busy} style={{ alignSelf: "flex-start", gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null}
        {busy ? "Saving…" : po ? "Save changes" : "Save Sales Order #, Invoice # & prices"}
      </button>
    </form>
  );
}

/** Delivered / picked up: the signed BOL (photo or scan) goes with it. */
export function CompleteForm({ orderId, pickup, hasBol }: { orderId: string; pickup: boolean; hasBol: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const { busy, setBusy, error, setError } = useSend();
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!files.length && !hasBol) return setError("Add a photo or scan of the signed BOL first.");
    setError(null);
    setBusy(true);
    const up = await uploadOrderFiles(orderId, "bol", files);
    if (up.error) {
      setBusy(false);
      return setError(up.error);
    }
    const fd = new FormData();
    fd.append("id", orderId);
    for (const f of up.ok) {
      fd.append("file_path", f.path);
      fd.append("file_name", f.name);
    }
    try {
      await completeOrder(fd);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="col" style={{ gap: 10 }}>
      <FilePick label={hasBol ? "Signed BOL (already attached, add more pages if needed)" : "Signed BOL (photo or scan, required)"} files={files} setFiles={setFiles} required={!hasBol} camera />
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="submit" className="btn dark sm" disabled={busy || (!files.length && !hasBol)} style={{ alignSelf: "flex-start", gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null}
        {busy ? "Saving…" : pickup ? "Mark picked up" : "Mark delivered"}
      </button>
    </form>
  );
}
