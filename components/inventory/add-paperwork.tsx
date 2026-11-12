"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FilePlus2, LoaderCircle, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/photo-upload";
import { addReportFiles } from "@/app/(app)/inventory/hub-actions";
import { FILE_KIND, type ReportFile } from "@/lib/report-files";

type Kind = NonNullable<ReportFile["kind"]>;

/**
 * Add paperwork to a Receiving Report that was already sent: the packing list that came by email, the BOL, a photo
 * of damage. It's added to the report (nothing in stock changes).
 */
export function AddPaperwork({ id, branch, missing, open: startOpen }: { id: number; branch: string; missing: Kind | null; open?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(startOpen));
  const [kind, setKind] = useState<Kind>(missing ?? "packing");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setMsg(null);
    setBusy(true);
    const supabase = createClient();
    const added: ReportFile[] = [];
    for (const f of Array.from(list).slice(0, 4)) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isImg = f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
      if (!isPdf && !isImg) {
        setMsg({ ok: false, t: `${f.name}: use a photo or a PDF.` });
        continue;
      }
      let body: Blob = f;
      let type = isPdf ? "application/pdf" : f.type || "image/jpeg";
      if (isImg) {
        body = await shrink(f, 2400, 0.85);
        if (body !== f) type = "image/jpeg";
      }
      if (body.size > 25 * 1024 * 1024) {
        setMsg({ ok: false, t: `${f.name} is over 25 MB.` });
        continue;
      }
      const ext = isPdf ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      const path = `${branch}/${kind === "packing" ? "pack" : kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await supabase.storage.from("inventory-files").upload(path, body, { contentType: type, upsert: false });
      if (up.error) {
        setMsg({ ok: false, t: `${f.name}: couldn't upload (${up.error.message}).` });
        continue;
      }
      added.push({ path, name: f.name.slice(0, 120) || FILE_KIND[kind], kind });
    }
    if (!added.length) return setBusy(false);
    const r = await addReportFiles({ id, files: added });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: `${FILE_KIND[kind]} added to the report.` });
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className={`btn sm ${missing ? "" : "ghost"}`} style={{ alignSelf: "flex-start", gap: 6 }} onClick={() => setOpen(true)}>
        <FilePlus2 size={15} /> {missing ? `Add the ${FILE_KIND[missing].toLowerCase()}` : "Add paperwork"}
      </button>
    );
  }
  return (
    <div className="col add-paper" style={{ gap: 8 }}>
      <span className="eyebrow">Add paperwork</span>
      <div className="chips" role="radiogroup" aria-label="What is it?">
        {(["packing", "bol", "other"] as Kind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip sm${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>
            {FILE_KIND[k]}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn sm" disabled={busy} onClick={() => cam.current?.click()}><Camera size={16} /> Take a photo</button>
        <button type="button" className="btn sm dark" disabled={busy} onClick={() => pick.current?.click()}><Upload size={16} /> Photo or PDF</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      </div>
      {busy ? <div className="row small muted" style={{ gap: 8 }} role="status"><LoaderCircle size={16} className="spin" /> Uploading…</div> : null}
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"} small`} role={msg.ok ? "status" : "alert"}>{msg.t}</div> : null}
    </div>
  );
}
