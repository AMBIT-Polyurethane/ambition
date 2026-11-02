"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, CircleAlert, FileText, LoaderCircle, Plus, Sparkles, SplitSquareVertical, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/photo-upload";
import { plural } from "@/lib/format";
import { ItemPick, type StockItem } from "@/components/incoming-forms";
import { readBolAction, receiveReport, type ReportLine } from "@/app/(app)/inventory/hub-actions";
import type { BolRead } from "@/lib/inventory/bol";

// The Receiving Report: snap or upload the BOL, the app fills in the lines, whoever unloads checks each one
// (what the BOL says, what came, how many arrived damaged, lot / batch # and expiration) and sends it to an
// admin for approval. Stock and the spreadsheet change when an admin approves it (an admin's own report
// goes straight in).

type Line = {
  key: number;
  id: number | null;
  item: StockItem | null;
  qty: string; // on the BOL / expected
  recv: string; // what came
  damaged: string; // arrived damaged: not put in stock
  lot: string;
  mfg: string;
  exp: string;
  autoExp?: boolean; // filled in from the Mfg date and shelf life
  note: string;
  raw?: string | null;
  conf?: "high" | "medium" | "low" | null;
  hint?: string | null;
  fixed?: boolean; // a transfer line: the item and lot come from the sending location
};

export type ReportDelivery = {
  id: number;
  vendor: string;
  transfer: boolean;
  bol_no: string | null;
  po_no: string | null;
  carrier: string | null;
  note: string | null;
  lines: {
    id: number;
    product_id: string;
    sku: string;
    name: string | null;
    unit: string | null;
    qty: number;
    received_qty?: number | null;
    damaged_qty?: number | null;
    lot_no: string | null;
    mfg: string | null;
    exp: string | null;
    note?: string | null;
  }[];
};

let seq = 1;
const num = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Number(s) : null);
const blank = (): Line => ({ key: seq++, id: null, item: null, qty: "", recv: "", damaged: "", lot: "", mfg: "", exp: "", note: "" });
/** Mfg date + shelf life in months, as YYYY-MM-DD. */
export function expFrom(mfg: string, months: number | null | undefined): string {
  if (!months || !/^\d{4}-\d{2}-\d{2}$/.test(mfg)) return "";
  const d = new Date(`${mfg}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function ReceivingForm({
  branch,
  branchName,
  items,
  delivery,
  today,
  aiReady,
  vendors,
  admin,
}: {
  branch: string;
  branchName: string;
  items: StockItem[];
  delivery?: ReportDelivery;
  today: string;
  aiReady: boolean;
  vendors: string[];
  /** Admins receive straight into stock; everyone else sends the report to an admin for approval. */
  admin: boolean;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.product_id, i])), [items]);
  const transfer = Boolean(delivery?.transfer);
  const [vendor, setVendor] = useState(delivery?.vendor ?? "");
  const [bol, setBol] = useState(delivery?.bol_no ?? "");
  const [po, setPo] = useState(delivery?.po_no ?? "");
  const [carrier, setCarrier] = useState(delivery?.carrier ?? "");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState(delivery?.note ?? "");
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]);
  const [ai, setAi] = useState<{ read: boolean; cost: number; notes: string | null }>({ read: false, cost: 0, notes: null });
  const [lines, setLines] = useState<Line[]>(() =>
    delivery?.lines.length
      ? delivery.lines.map((l) => ({
          key: seq++,
          id: l.id,
          item: byId.get(l.product_id) ?? { product_id: l.product_id, sku: l.sku, name: l.name ?? l.sku, unit: l.unit ?? "each", lots: Boolean(l.lot_no) },
          qty: String(Number(l.qty)),
          recv: String(Number(l.received_qty ?? l.qty)),
          damaged: l.damaged_qty ? String(Number(l.damaged_qty)) : "",
          lot: l.lot_no ?? "",
          mfg: l.mfg ?? "",
          exp: l.exp ?? "",
          note: l.note ?? "",
          fixed: transfer,
        }))
      : [blank()],
  );
  const [busy, setBusy] = useState<null | "upload" | "read" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Mfg date typed: the expiration follows it (unless someone typed their own). */
  const setMfg = (l: Line, mfg: string) => {
    const auto = expFrom(mfg, l.item?.shelfLife);
    set(l.key, auto && (!l.exp || l.autoExp) ? { mfg, exp: auto, autoExp: true } : { mfg });
  };

  /** Put what the AI read onto the report (matching lines already there when it's an expected delivery). */
  const apply = (r: BolRead) => {
    if (!transfer && r.vendor && (!vendor.trim() || !delivery)) setVendor(r.vendor);
    if (r.bol_no) setBol(r.bol_no);
    if (r.po_no) setPo(r.po_no);
    if (r.carrier) setCarrier(r.carrier);
    setAi((a) => ({ read: true, cost: a.cost + r.cost_cents, notes: r.notes }));
    setLines((cur) => {
      const out = cur.filter((l) => l.item || l.qty || l.recv).map((l) => ({ ...l }));
      const used = new Set<number>();
      for (const x of r.lines) {
        const item = x.product_id ? byId.get(x.product_id) ?? null : null;
        const hit = item ? out.find((l) => !used.has(l.key) && l.item?.product_id === item.product_id && (!l.fixed || !l.lot || !x.lot_no || l.lot.toUpperCase() === x.lot_no)) : undefined;
        if (hit) {
          used.add(hit.key);
          hit.recv = String(x.qty);
          if (!hit.fixed) {
            hit.lot = x.lot_no ?? hit.lot;
            hit.mfg = x.mfg ?? hit.mfg;
            hit.exp = x.exp ?? (expFrom(hit.mfg, hit.item?.shelfLife) || hit.exp);
          }
          hit.raw = x.raw;
          hit.conf = x.confidence;
          hit.hint = x.note;
          continue;
        }
        if (transfer) continue; // a transfer only receives what was sent
        const mfg = x.mfg ?? "";
        const exp = x.exp ?? expFrom(mfg, item?.shelfLife);
        const l: Line = { key: seq++, id: null, item, qty: String(x.qty), recv: String(x.qty), damaged: "", lot: x.lot_no ?? "", mfg, exp, autoExp: !x.exp && Boolean(exp), note: "", raw: x.raw, conf: x.confidence, hint: x.note };
        used.add(l.key);
        out.push(l);
      }
      return out.length ? out : [blank()];
    });
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setBusy("upload");
    const supabase = createClient();
    const added: { path: string; name: string }[] = [];
    for (const f of Array.from(list).slice(0, 4)) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isImg = f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
      if (!isPdf && !isImg) {
        setError(`${f.name}: use a photo or a PDF.`);
        continue;
      }
      let body: Blob = f;
      let type = isPdf ? "application/pdf" : f.type || "image/jpeg";
      if (isImg) {
        body = await shrink(f, 2400, 0.85);
        if (body !== f) type = "image/jpeg";
      }
      if (body.size > 25 * 1024 * 1024) {
        setError(`${f.name} is over 25 MB.`);
        continue;
      }
      const ext = isPdf ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      const path = `${branch}/bol-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await supabase.storage.from("inventory-files").upload(path, body, { contentType: type, upsert: false });
      if (up.error) {
        setError(`${f.name}: couldn't upload (${up.error.message}).`);
        continue;
      }
      added.push({ path, name: f.name.slice(0, 120) || "BOL" });
    }
    if (!added.length) return setBusy(null);
    setFiles((fs) => [...fs, ...added]);
    if (!aiReady) return setBusy(null);
    setBusy("read");
    const r = await readBolAction({ branch, paths: added.map((a) => a.path) });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    apply(r.read);
  };

  const receive = async () => {
    setError(null);
    if (!transfer && !vendor.trim()) return setError("Who is it from? (the shipper on the BOL)");
    const out: ReportLine[] = [];
    for (const l of lines) {
      if (!l.item && !l.qty && !l.recv) continue;
      if (!l.item) return setError(`Pick the item for "${l.raw ?? "the line with no item"}" (or remove the line).`);
      const r = num(l.recv);
      if (r === null) return setError(`How many ${l.item.sku} came? (0 if none)`);
      const q = l.qty.trim() ? num(l.qty) : r;
      if (q === null) return setError(`Check the BOL quantity for ${l.item.sku}.`);
      const d = l.damaged.trim() ? num(l.damaged) : 0;
      if (d === null) return setError(`Check how many ${l.item.sku} arrived damaged.`);
      if (d > r) return setError(`More ${l.item.sku} arrived damaged than came in.`);
      const good = r - d;
      if ((l.item.lots || l.item.track) && good > 0 && !l.lot.trim()) return setError(`Enter the lot / batch # for ${l.item.sku}.`);
      const exp = l.exp || expFrom(l.mfg, l.item.shelfLife);
      if (l.item.track && good > 0 && !exp) return setError(`Enter the expiration date for ${l.item.sku}${l.item.shelfLife ? " (or its Mfg date)" : ""}.`);
      out.push({ id: l.id, product_id: l.item.product_id, qty: q, received_qty: r, damaged_qty: d, lot_no: l.lot.trim().toUpperCase(), mfg: l.mfg, exp, note: l.note.trim() });
    }
    if (!out.length) return setError("Add at least one item.");
    setBusy("save");
    const res = await receiveReport({
      id: delivery?.id ?? null,
      branch,
      head: { vendor, bol_no: bol, po_no: po, carrier, received_on: day, note: [note.trim(), ai.notes ? `From the BOL: ${ai.notes}` : ""].filter(Boolean).join(" · "), files, read_by_ai: ai.read, ai_cost_cents: ai.cost },
      lines: out,
    });
    setBusy(null);
    if (res && !res.ok) setError(res.error);
  };

  const short = lines.filter((l) => l.item && num(l.recv) !== null && num(l.qty) !== null && num(l.recv)! < num(l.qty)!).length;
  const damaged = lines.filter((l) => l.item && (num(l.damaged) ?? 0) > 0).length;

  return (
    <div className="col" style={{ gap: 12 }}>
      <section className="card col recv-bol" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <Sparkles size={18} style={{ flex: "none", marginTop: 2, color: "var(--red-text)" }} />
          <div className="col tight">
            <b>{transfer ? "Attach the BOL (optional)" : "Read the BOL"}</b>
            <span className="tiny faint">
              {aiReady
                ? transfer
                  ? "Snap the signed BOL to keep it with this transfer."
                  : "Take a photo or upload the PDF. The app fills in the shipper, BOL #, PO #, carrier and every line with its lot numbers. Then check it."
                : "Attach the BOL photo or PDF to keep it with the report."}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm" onClick={() => camRef.current?.click()} disabled={busy !== null}><Camera size={16} /> Take a photo</button>
          <button type="button" className="btn sm dark" onClick={() => pickRef.current?.click()} disabled={busy !== null}><Upload size={16} /> Photo or PDF</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {busy === "upload" || busy === "read" ? (
          <div className="row small muted" style={{ gap: 8 }} role="status"><LoaderCircle size={16} className="spin" /> {busy === "upload" ? "Uploading…" : "Reading the BOL… (about 20 seconds)"}</div>
        ) : null}
        {files.length ? (
          <div className="row tiny" style={{ gap: 6, flexWrap: "wrap" }}>
            {files.map((f) => <span key={f.path} className="pill grey"><FileText size={12} /> {f.name}</span>)}
          </div>
        ) : null}
        {ai.read ? (
          <div className="alert warn small" role="status">
            <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
            <span>Filled in from the BOL. Check every line against what&apos;s on the truck, especially the ones marked <b>check</b>. Change anything that&apos;s off.{ai.notes ? ` The BOL also says: ${ai.notes}` : ""}</span>
          </div>
        ) : null}
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="grid2">
          <label className="field">
            <span className="label">From (shipper)</span>
            <input className="input sm" list="recv-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Covestro" disabled={transfer} />
            <datalist id="recv-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="field">
            <span className="label">Received on</span>
            <input className="input sm" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">BOL #</span>
            <input className="input sm" value={bol} onChange={(e) => setBol(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">PO #</span>
            <input className="input sm" value={po} onChange={(e) => setPo(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Carrier</span>
            <input className="input sm" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </label>
          <div className="field">
            <span className="label">To</span>
            <span className="small" style={{ padding: "8px 0" }}>{branchName}</span>
          </div>
        </div>
      </section>

      <div className="eyebrow">What came in</div>
      <div className="col" style={{ gap: 10 }}>
        {lines.map((l) => {
          const r = num(l.recv);
          const q = num(l.qty);
          const off = r !== null && q !== null && r !== q;
          return (
            <div key={l.key} className={`card col recv-line${l.conf === "low" || (!l.item && l.raw) ? " recv-low" : l.conf === "medium" ? " recv-check" : ""}`} style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  {l.fixed && l.item ? (
                    <div>
                      <b>{l.item.sku}</b> <span className="small muted">{l.item.name}</span>
                    </div>
                  ) : (
                    <ItemPick items={items} value={l.item} onPick={(it) => set(l.key, { item: it, conf: l.conf === "low" ? "medium" : l.conf })} />
                  )}
                  {l.raw ? <div className="tiny faint" style={{ marginTop: 4 }}>BOL says: {l.raw}</div> : null}
                  {l.conf && l.conf !== "high" ? <div className="tiny warn-t" style={{ marginTop: 2 }}>Check: {l.hint || (l.item ? "make sure this is the right item" : "pick the item this line is")}</div> : null}
                </div>
                {!l.fixed ? (
                  <button type="button" className="iconbtn" aria-label="Remove this line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}>
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
              <div className={l.item?.lots || l.item?.track ? "grid4 recv-grid recv-lots" : "grid3"}>
                <label className="field">
                  <span className="label">{transfer ? "Sent" : delivery && l.id ? "Expected / on BOL" : "On the BOL"}</span>
                  <input className="input sm" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} disabled={l.fixed} placeholder={l.item ? plural(l.item.unit, 2) : ""} />
                </label>
                <label className="field">
                  <span className="label">Came in</span>
                  <input className={`input sm${off ? " warn-in" : ""}`} inputMode="decimal" value={l.recv} onChange={(e) => set(l.key, { recv: e.target.value })} placeholder="0 if none" />
                </label>
                <label className="field">
                  <span className="label">Damaged</span>
                  <input className={`input sm${(num(l.damaged) ?? 0) > 0 ? " warn-in" : ""}`} inputMode="decimal" value={l.damaged} onChange={(e) => set(l.key, { damaged: e.target.value })} placeholder="0" aria-label={`How many ${l.item?.sku ?? ""} arrived damaged`} />
                </label>
                {l.item?.lots || l.item?.track ? (
                  <>
                    <label className="field">
                      <span className="label">Lot / Batch #</span>
                      <input className="input sm" value={l.lot} onChange={(e) => set(l.key, { lot: e.target.value.toUpperCase() })} autoCapitalize="characters" disabled={l.fixed && Boolean(l.lot)} />
                    </label>
                    <label className="field">
                      <span className="label">Mfg date</span>
                      <input className="input sm" type="date" value={l.mfg} onChange={(e) => setMfg(l, e.target.value)} disabled={l.fixed} />
                    </label>
                    <label className="field">
                      <span className="label">Exp date{l.item?.track ? " *" : ""}</span>
                      <input className="input sm" type="date" value={l.exp} onChange={(e) => set(l.key, { exp: e.target.value, autoExp: false })} disabled={l.fixed} />
                      {l.autoExp && l.exp ? <span className="tiny faint">Mfg + {l.item?.shelfLife} months</span> : null}
                    </label>
                  </>
                ) : null}
              </div>
              {off || l.note || (num(l.damaged) ?? 0) > 0 ? (
                <input className="input sm" value={l.note} onChange={(e) => set(l.key, { note: e.target.value })} placeholder={(num(l.damaged) ?? 0) > 0 ? "What's damaged? (add a photo with the BOL)" : off ? "Why is it different? (short, refused…)" : "Note"} />
              ) : null}
              {(l.item?.lots || l.item?.track) && !l.fixed ? (
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ alignSelf: "flex-start", gap: 6 }}
                  onClick={() => setLines((ls) => {
                    const i = ls.findIndex((x) => x.key === l.key);
                    const copy: Line = { key: seq++, id: null, item: l.item, qty: "", recv: "", damaged: "", lot: "", mfg: l.mfg, exp: l.exp, autoExp: l.autoExp, note: "" };
                    return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
                  })}
                >
                  <SplitSquareVertical size={15} /> Another lot / batch of this
                </button>
              ) : null}
            </div>
          );
        })}
        {!transfer ? (
          <button type="button" className="btn sm dark" style={{ alignSelf: "flex-start", gap: 6 }} onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus size={16} /> Add a line
          </button>
        ) : null}
      </div>

      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Seal #, damage, who unloaded…" />
      </label>
      {short ? <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{short} {short === 1 ? "line came in short" : "lines came in short"} of the BOL. Only what came in goes into stock.</span></div> : null}
      {damaged ? <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{damaged} {damaged === 1 ? "line has" : "lines have"} damaged items. Damaged items don&apos;t go into stock. Snap a photo of the damage with the BOL.</span></div> : null}
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="button" className="btn" onClick={receive} disabled={busy !== null} style={{ gap: 8 }}>
        {busy === "save" ? <LoaderCircle size={16} className="spin" /> : null} {admin ? "Receive: add to stock" : "Send for admin approval"}
      </button>
      <p className="tiny faint center" style={{ margin: 0 }}>
        {admin
          ? <>Everything that came in good goes onto TOTAL IN STOCK at {branchName}. Spray foam goes onto FOAM LOTS; other lots / batches go onto RECEIVED LOTS. The BOL stays with the report.</>
          : <>An admin checks the report, then the stock and {branchName}&apos;s spreadsheet update. Until then these items can&apos;t be ordered from here.</>}
      </p>
    </div>
  );
}
