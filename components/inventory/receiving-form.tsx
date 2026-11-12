"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CircleAlert, CircleCheck, FileText, LoaderCircle, Plus, Sparkles, SplitSquareVertical, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/photo-upload";
import { dateTime, plural } from "@/lib/format";
import { ItemPick, type StockItem } from "@/components/incoming-forms";
import { bolMatches, readBolAction, receiveReport, type ReportLine } from "@/app/(app)/inventory/hub-actions";
import type { BolRead } from "@/lib/inventory/bol";
import { paperwork, type ReportFile } from "@/lib/report-files";
import type { BolMatch } from "@/lib/incoming";

// The Receiving Report: snap or upload the BOL and the packing list (both are required, 0067), the app fills in
// the lines and checks the BOL's lot numbers (often handwritten) against the packing list's (the manufacturer's),
// whoever unloads checks each line (what came, how many arrived damaged, lot / batch # and expiration) and sends
// it to an admin for approval. Stock and the spreadsheet change when an admin approves it (an admin's own report
// goes straight in).

type Kind = "bol" | "packing";

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
  raw?: string | null; // what the BOL says
  rawPack?: string | null; // what the packing list says
  conf?: "high" | "medium" | "low" | null;
  hint?: string | null;
  fixed?: boolean; // a transfer line: the item and lot come from the sending location
  /** What each document said for this line (to check the BOL against the manufacturer's packing list). */
  bolLot?: string | null;
  packLot?: string | null;
  bolQty?: number | null;
  packQty?: number | null;
  lotFrom?: Kind | null; // which document the lot / dates came from (the packing list wins)
  recvTyped?: boolean; // "Came in" was typed by hand: a later read doesn't change it
};

export type ReportDelivery = {
  id: number;
  vendor: string;
  transfer: boolean;
  /** expected (receive it, or fix it after it was sent back) or submitted (an admin changing it before approving). */
  status?: string;
  /** Paperwork already on the report (kept when it's sent again). */
  files?: ReportFile[];
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
  const [files, setFiles] = useState<ReportFile[]>([]);
  const have = useMemo(() => delivery?.files ?? [], [delivery?.files]);
  const [ai, setAi] = useState<{ read: boolean; cost: number; notes: Partial<Record<Kind, string>>; kinds: Kind[] }>({ read: false, cost: 0, notes: {}, kinds: [] });
  // Both the BOL and the packing list are required on a report from a vendor (not a transfer, and not when an
  // admin is changing a report while approving it).
  const needPapers = !transfer && delivery?.status !== "submitted";
  const [noPack, setNoPack] = useState(false);
  const [noPackWhy, setNoPackWhy] = useState("");
  // Sent-back reports for this same truck: closed when this one is sent (unless unticked).
  const [keepOld, setKeepOld] = useState<number[]>([]);
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
  const [busyKind, setBusyKind] = useState<Kind>("bol");
  const [error, setError] = useState<string | null>(null);
  // The BOL # is already on another report here: same truck sent twice, or a new load on the same ticket?
  const [matches, setMatches] = useState<BolMatch[]>([]);
  const [newLoad, setNewLoad] = useState(false);
  useEffect(() => {
    if (transfer) return;
    const b = bol.trim();
    if (b.length < 3) {
      setMatches([]);
      return;
    }
    let stop = false;
    const t = setTimeout(() => {
      bolMatches({ branch, bol: b, except: delivery?.id ?? null }).then((m) => {
        if (!stop) setMatches(m);
      });
    }, 500);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [bol, branch, transfer, delivery?.id]);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const pickKind = useRef<Kind>("bol");
  const all = [...have, ...files];
  const pw = paperwork(all);
  const sentBack = matches.filter((m) => m.status === "sent_back");
  const closing = sentBack.filter((m) => !keepOld.includes(m.id));
  const dupes = matches.filter((m) => !closing.some((c) => c.id === m.id));

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Mfg date typed: the expiration follows it (unless someone typed their own). */
  const setMfg = (l: Line, mfg: string) => {
    const auto = expFrom(mfg, l.item?.shelfLife);
    set(l.key, auto && (!l.exp || l.autoExp) ? { mfg, exp: auto, autoExp: true } : { mfg });
  };

  /**
   * Put what the AI read onto the report (matching lines already there when it's an expected delivery). The BOL
   * and the packing list are read one at a time: the packing list's lot numbers and dates are the manufacturer's,
   * so they win over the BOL's (often handwritten); each document's own lot and count stay on the line to compare.
   */
  const apply = (r: BolRead, kind: Kind) => {
    const pack = kind === "packing";
    if (!transfer && r.vendor && (!vendor.trim() || !delivery)) setVendor((v) => (pack && v.trim() ? v : r.vendor!));
    if (r.bol_no) setBol((b) => (pack && b.trim() ? b : r.bol_no!));
    if (r.po_no) setPo((x) => (x.trim() && (pack || ai.kinds.includes("packing")) ? x : r.po_no!));
    if (r.carrier) setCarrier((c) => (pack && c.trim() ? c : r.carrier!));
    setAi((a) => ({ read: true, cost: a.cost + r.cost_cents, notes: r.notes ? { ...a.notes, [kind]: r.notes } : a.notes, kinds: a.kinds.includes(kind) ? a.kinds : [...a.kinds, kind] }));
    setLines((cur) => {
      const out = cur.filter((l) => l.item || l.qty || l.recv).map((l) => ({ ...l }));
      const used = new Set<number>();
      for (const x of r.lines) {
        const item = x.product_id ? byId.get(x.product_id) ?? null : null;
        const lot = x.lot_no ?? null;
        const free = item ? out.filter((l) => !used.has(l.key) && l.item?.product_id === item.product_id && (!l.fixed || !l.lot || !lot || l.lot.toUpperCase() === lot)) : [];
        const hit =
          free.find((l) => lot && [l.lot, l.bolLot, l.packLot].some((v) => v && v.toUpperCase() === lot)) ??
          free.find((l) => (pack ? l.packQty == null : l.bolQty == null)) ??
          free[0];
        if (hit) {
          used.add(hit.key);
          const first = hit.bolQty == null && hit.packQty == null;
          if (first && !hit.recvTyped) hit.recv = String(x.qty);
          if (pack) {
            hit.packLot = lot;
            hit.packQty = x.qty;
            hit.rawPack = x.raw;
          } else {
            hit.bolLot = lot;
            hit.bolQty = x.qty;
            hit.raw = x.raw;
          }
          if (!hit.fixed) {
            if (pack || hit.lotFrom !== "packing") {
              hit.lot = lot ?? hit.lot;
              hit.mfg = x.mfg ?? hit.mfg;
              hit.exp = x.exp ?? (expFrom(hit.mfg, hit.item?.shelfLife) || hit.exp);
              if (lot) hit.lotFrom = kind;
            } else {
              // The packing list already set the lot: only fill in a date it didn't have.
              if (!hit.mfg && x.mfg) hit.mfg = x.mfg;
              if (!hit.exp && x.exp) hit.exp = x.exp;
            }
          }
          if (pack || hit.packQty == null) {
            hit.conf = x.confidence;
            hit.hint = x.note;
          }
          continue;
        }
        if (transfer) continue; // a transfer only receives what was sent
        const mfg = x.mfg ?? "";
        const exp = x.exp ?? expFrom(mfg, item?.shelfLife);
        const l: Line = {
          key: seq++, id: null, item, qty: String(x.qty), recv: String(x.qty), damaged: "", lot: lot ?? "", mfg, exp, autoExp: !x.exp && Boolean(exp), note: "",
          raw: pack ? null : x.raw, rawPack: pack ? x.raw : null, conf: x.confidence, hint: x.note,
          bolLot: pack ? null : lot, packLot: pack ? lot : null, bolQty: pack ? null : x.qty, packQty: pack ? x.qty : null, lotFrom: lot ? kind : null,
        };
        used.add(l.key);
        out.push(l);
      }
      return out.length ? out : [blank()];
    });
  };

  const addFiles = async (list: FileList | null, kind: Kind) => {
    if (!list?.length) return;
    setError(null);
    setBusyKind(kind);
    setBusy("upload");
    const supabase = createClient();
    const added: ReportFile[] = [];
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
      const path = `${branch}/${kind === "packing" ? "pack" : "bol"}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await supabase.storage.from("inventory-files").upload(path, body, { contentType: type, upsert: false });
      if (up.error) {
        setError(`${f.name}: couldn't upload (${up.error.message}).`);
        continue;
      }
      added.push({ path, name: f.name.slice(0, 120) || (kind === "packing" ? "Packing list" : "BOL"), kind });
    }
    if (!added.length) return setBusy(null);
    setFiles((fs) => [...fs, ...added]);
    if (kind === "packing") setNoPack(false);
    if (!aiReady) return setBusy(null);
    setBusy("read");
    const r = await readBolAction({ branch, paths: added.map((a) => a.path), kind });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    apply(r.read, kind);
  };
  const pick = (kind: Kind, camera: boolean) => {
    pickKind.current = kind;
    (camera ? camRef : pickRef).current?.click();
  };

  const receive = async () => {
    setError(null);
    const papers = () => document.getElementById("recv-papers")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (needPapers && !pw.bol) {
      papers();
      return setError("Add the BOL first: take a photo of it or upload the PDF (step 1 at the top).");
    }
    if (needPapers && !pw.packing && !(noPack && noPackWhy.trim().length >= 3)) {
      papers();
      return setError(noPack ? "Say why there's no packing list (step 2 at the top)." : 'Add the packing list (step 2 at the top). If none came with this truck, tick "No packing list came with this truck" and say why.');
    }
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
    if (dupes.length && !newLoad) {
      document.getElementById("bol-again")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return setError(`BOL ${bol.trim()} is already on another report. If it's the same truck, don't send it again. If it's a new load on the same ticket, tick "This is a new load" above.`);
    }
    setBusy("save");
    const read = [
      ai.notes.bol ? `From the BOL: ${ai.notes.bol}` : "",
      ai.notes.packing ? `From the packing list: ${ai.notes.packing}` : "",
    ];
    const res = await receiveReport({
      id: delivery?.id ?? null,
      branch,
      head: { vendor, bol_no: bol, po_no: po, carrier, received_on: day, note: [note.trim(), ...read].filter(Boolean).join(" · "), files, read_by_ai: ai.read, ai_cost_cents: ai.cost },
      lines: out,
      newLoad: dupes.length > 0 && newLoad,
      noPacking: needPapers && !pw.packing && noPack ? noPackWhy.trim() : undefined,
      replaces: closing.map((m) => m.id),
    });
    setBusy(null);
    if (res && !res.ok) setError(res.error);
  };

  const short = lines.filter((l) => l.item && num(l.recv) !== null && num(l.qty) !== null && num(l.recv)! < num(l.qty)!).length;
  const damaged = lines.filter((l) => l.item && (num(l.damaged) ?? 0) > 0).length;

  return (
    <div className="col" style={{ gap: 12 }}>
      <section id="recv-papers" className="card col recv-bol" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <Sparkles size={18} style={{ flex: "none", marginTop: 2, color: "var(--red-text)" }} />
          <div className="col tight">
            <b>{transfer ? "Attach the BOL (optional)" : "The BOL and the packing list"}</b>
            <span className="tiny faint">
              {transfer
                ? "Snap the signed BOL to keep it with this transfer."
                : aiReady
                  ? "Both are needed on every Receiving Report. Snap or upload each one: the app fills in the report, then checks the lot numbers on the BOL (often written in by hand) against the packing list (the manufacturer's numbers)."
                  : "Both are needed on every Receiving Report. Snap or upload each one to keep it with the report."}
            </span>
          </div>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files, pickKind.current); e.target.value = ""; }} />
        <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void addFiles(e.target.files, pickKind.current); e.target.value = ""; }} />
        <div className={transfer ? "col" : "recv-docs"}>
          {(transfer ? (["bol"] as Kind[]) : (["bol", "packing"] as Kind[])).map((k, n) => {
            const mine = all.filter((f) => (k === "bol" ? f.kind === "bol" || !f.kind : f.kind === k));
            const done = mine.length > 0;
            return (
              <div key={k} className={`recv-doc${done ? " done" : noPack && k === "packing" ? " skip" : needPapers ? " need" : ""}`}>
                <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
                  <div className="col tight" style={{ minWidth: 0 }}>
                    <b>{transfer ? "BOL" : `${n + 1}. ${k === "bol" ? "BOL (bill of lading)" : "Packing list"}`}</b>
                    <span className="tiny faint">
                      {k === "bol"
                        ? "The trucking paperwork the driver signs."
                        : "From the manufacturer: what's on the truck, with their lot / batch numbers. Often in a pouch on the first pallet, or emailed."}
                    </span>
                  </div>
                  {done ? (
                    <span className="pill ok" style={{ flex: "none" }}><CircleCheck size={12} /> Added</span>
                  ) : needPapers && !(noPack && k === "packing") ? (
                    <span className="pill warn" style={{ flex: "none" }}>Needed</span>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn sm" onClick={() => pick(k, true)} disabled={busy !== null}><Camera size={16} /> Take a photo</button>
                  <button type="button" className="btn sm dark" onClick={() => pick(k, false)} disabled={busy !== null}><Upload size={16} /> Photo or PDF</button>
                </div>
                {(busy === "upload" || busy === "read") && busyKind === k ? (
                  <div className="row small muted" style={{ gap: 8 }} role="status">
                    <LoaderCircle size={16} className="spin" /> {busy === "upload" ? "Uploading…" : `Reading the ${k === "packing" ? "packing list" : "BOL"}… (about 20 seconds)`}
                  </div>
                ) : null}
                {mine.length ? (
                  <div className="row tiny" style={{ gap: 6, flexWrap: "wrap" }}>
                    {mine.map((f) => (
                      <span key={f.path} className="pill grey"><FileText size={12} /> {f.name}{have.includes(f) ? " · on the report" : ""}</span>
                    ))}
                  </div>
                ) : null}
                {k === "packing" && needPapers && !done ? (
                  <div className="col" style={{ gap: 6 }}>
                    <label className="check small">
                      <input type="checkbox" checked={noPack} onChange={(e) => { setNoPack(e.target.checked); setError(null); }} />
                      <span>No packing list came with this truck</span>
                    </label>
                    {noPack ? (
                      <input
                        className="input sm"
                        value={noPackWhy}
                        onChange={(e) => setNoPackWhy(e.target.value)}
                        maxLength={200}
                        placeholder="Why? (for example: the driver didn't have one, asked Covestro to email it)"
                        aria-label="Why there's no packing list"
                      />
                    ) : null}
                    {noPack ? <span className="tiny faint">The report is flagged for the admin, and the packing list can be added to it later.</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {ai.read ? (
          <div className="alert warn small" role="status">
            <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
            <span>
              Filled in from the {ai.kinds.length > 1 ? "BOL and the packing list" : ai.kinds[0] === "packing" ? "packing list" : "BOL"}. Check every line against what&apos;s on the truck, especially the ones marked <b>check</b>. Change anything that&apos;s off.
              {ai.notes.bol ? ` The BOL also says: ${ai.notes.bol}` : ""}
              {ai.notes.packing ? ` The packing list also says: ${ai.notes.packing}` : ""}
            </span>
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

      {sentBack.length ? (
        <section className="alert info bol-again" role="status">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 2 }} />
          <div className="col" style={{ gap: 8, minWidth: 0 }}>
            <b>This truck was sent back to fix on {sentBack.length === 1 ? "another report" : `${sentBack.length} other reports`}</b>
            <ul className="bol-list">
              {sentBack.map((m) => (
                <li key={m.id}>
                  <a href={`/inventory/incoming/${m.id}`} target="_blank" rel="noopener noreferrer">#{m.id}</a> {m.lines || "no lines"} · sent back {dateTime(m.at)}{m.by ? ` by ${m.by}` : ""}{m.note ? `: “${m.note}”` : ""}
                </li>
              ))}
            </ul>
            <span className="small">Nothing from {sentBack.length === 1 ? "it" : "them"} went into stock. When you send this report, {sentBack.length === 1 ? "that one is" : "those are"} closed as redone here, so the truck only counts once.</span>
            {sentBack.map((m) => (
              <label key={m.id} className="check">
                <input type="checkbox" checked={!keepOld.includes(m.id)} onChange={(e) => setKeepOld((k) => (e.target.checked ? k.filter((x) => x !== m.id) : [...k, m.id]))} />
                <span><b>Close #{m.id}</b>: it&apos;s this same truck</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {dupes.length ? (
        <section id="bol-again" className="alert warn bol-again" role="alert">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 2 }} />
          <div className="col" style={{ gap: 8, minWidth: 0 }}>
            <b>BOL {bol.trim()} is already on {dupes.length === 1 ? "a report" : `${dupes.length} reports`} here</b>
            <ul className="bol-list">
              {dupes.map((m) => (
                <li key={m.id}>
                  <a href={`/inventory/incoming/${m.id}`} target="_blank" rel="noopener noreferrer">#{m.id}</a>{" "}
                  {m.lines || "no lines"} · {m.status === "received" ? "received" : m.status === "sent_back" ? "sent back, not closed" : "waiting for approval"} {dateTime(m.at)}{m.by ? ` · ${m.by}` : ""}
                </li>
              ))}
            </ul>
            <span className="small">
              <b>Same truck?</b> Don&apos;t send it again. Open the report above instead{dupes.some((m) => m.status === "submitted") ? " (an admin can still fix it before approving)" : ""}.
            </span>
            <span className="small">
              <b>A new load on the same ticket?</b> (The plant&apos;s shuttle loads all carry one transfer order #.) Count this load, then tick:
            </span>
            <label className="check">
              <input type="checkbox" checked={newLoad} onChange={(e) => { setNewLoad(e.target.checked); setError(null); }} />
              <span><b>This is a new load</b>: load {dupes.length + 1} on BOL {bol.trim()}</span>
            </label>
          </div>
        </section>
      ) : null}

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
                  {l.rawPack ? <div className="tiny faint" style={{ marginTop: l.raw ? 0 : 4 }}>Packing list says: {l.rawPack}</div> : null}
                  {l.conf && l.conf !== "high" ? <div className="tiny warn-t" style={{ marginTop: 2 }}>Check: {l.hint || (l.item ? "make sure this is the right item" : "pick the item this line is")}</div> : null}
                  {l.bolLot && l.packLot && l.bolLot.toUpperCase() !== l.packLot.toUpperCase() ? (
                    <div className="tiny warn-t" style={{ marginTop: 2 }}>
                      Lots don&apos;t match: the BOL says <b>{l.bolLot}</b>, the packing list says <b>{l.packLot}</b>. The packing list is the manufacturer&apos;s number; check it against the labels on the drums.
                    </div>
                  ) : null}
                  {l.bolQty != null && l.packQty != null && l.bolQty !== l.packQty ? (
                    <div className="tiny warn-t" style={{ marginTop: 2 }}>Counts don&apos;t match: the BOL says {l.bolQty}, the packing list says {l.packQty}. Count what came off the truck.</div>
                  ) : null}
                  {ai.kinds.length > 1 && !l.fixed && l.item && (l.bolQty == null) !== (l.packQty == null) ? (
                    <div className="tiny warn-t" style={{ marginTop: 2 }}>Only on the {l.packQty == null ? "BOL" : "packing list"}. Check it&apos;s really on this truck.</div>
                  ) : null}
                  {l.bolLot && l.packLot && l.bolLot.toUpperCase() === l.packLot.toUpperCase() ? (
                    <div className="tiny" style={{ marginTop: 2, color: "var(--ok-text)" }}><CircleCheck size={11} style={{ verticalAlign: "-1px" }} /> Lot matches the packing list</div>
                  ) : null}
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
                  <input className={`input sm${off ? " warn-in" : ""}`} inputMode="decimal" value={l.recv} onChange={(e) => set(l.key, { recv: e.target.value, recvTyped: true })} placeholder="0 if none" />
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
