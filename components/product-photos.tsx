"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Images, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { RASTER, runPool, toJpeg, uploadProductPhoto } from "@/lib/images";
import { setProductImages, type ImportResult } from "@/app/(app)/admin/actions";

// One product's photo (inside the product's edit panel).
export function ProductPhotoField({ sku, url }: { sku: string; url: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ImportResult | null>(null);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const jpeg = await toJpeg(file);
      const publicUrl = await uploadProductPhoto(createClient(), sku, jpeg);
      setMsg(await setProductImages([{ sku, url: publicUrl }]));
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setMsg(await setProductImages([{ sku, url: null }]));
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="row wrap" style={{ gap: 12 }}>
      {url ? <img className="thumb lg" src={url} alt="" /> : <div className="thumb lg empty"><Camera size={22} /></div>}
      <div className="col tight">
        <label className="btn sm dark" style={{ alignSelf: "flex-start" }}>
          <Camera size={14} /> {busy ? "Saving…" : url ? "Replace photo" : "Add photo"}
          <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {url ? (
          <button type="button" className="linkbtn small" onClick={remove} disabled={busy}>
            <Trash2 size={12} /> Remove photo
          </button>
        ) : null}
        {msg ? <span className={`tiny ${msg.ok ? "faint" : "red"}`}>{msg.message}</span> : null}
      </div>
    </div>
  );
}

// Many photos at once, matched to products by file name (e.g. 336508.jpg).
export function BulkPhotoUpload({ skus }: { skus: string[] }) {
  const router = useRouter();
  const [matched, setMatched] = useState<{ sku: string; file: File }[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const bySku = new Map(skus.map((s) => [s.toLowerCase(), s]));
  const pick = (files: FileList | null) => {
    setResult(null);
    const m: { sku: string; file: File }[] = [];
    const u: string[] = [];
    for (const f of Array.from(files ?? [])) {
      if (!RASTER.test(f.name)) { u.push(f.name); continue; }
      const base = f.name.replace(/\.[^.]+$/, "").trim().toLowerCase();
      const sku = bySku.get(base) ?? bySku.get(base.replace(/_/g, " ")) ?? bySku.get(base.replace(/_/g, "-"));
      if (sku) m.push({ sku, file: f });
      else u.push(f.name);
    }
    setMatched(m);
    setUnmatched(u);
  };

  const run = () =>
    start(async () => {
      const supabase = createClient();
      const saved: { sku: string; url: string }[] = [];
      const failed: string[] = [];
      await runPool(matched, 4, async ({ sku, file }) => {
        try {
          saved.push({ sku, url: await uploadProductPhoto(supabase, sku, await toJpeg(file)) });
        } catch {
          failed.push(sku);
        }
      }, (n) => setProgress(`Uploading ${n} of ${matched.length}…`));
      setProgress(null);
      const res = saved.length ? await setProductImages(saved) : { ok: false, message: "Nothing was uploaded." };
      setResult(failed.length ? { ok: false, message: `${res.message} ${failed.length} failed: ${failed.slice(0, 5).join(", ")}` } : res);
      setMatched([]);
      router.refresh();
    });

  return (
    <div className="col">
      <p className="small muted" style={{ margin: 0 }}>
        Name each photo with its SKU (for example <b>336508.jpg</b> or <b>AMB-SEAL-50.png</b>), select them all and upload.
        Photos are resized automatically.
      </p>
      <label className="btn sm dark" style={{ alignSelf: "flex-start" }}>
        <Images size={16} /> Choose photos
        <input type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
      </label>
      {matched.length || unmatched.length ? (
        <div className="small muted">
          <b style={{ color: "var(--text)" }}>{matched.length}</b> matched to a SKU
          {unmatched.length ? <> · {unmatched.length} not matched ({unmatched.slice(0, 4).join(", ")}{unmatched.length > 4 ? "…" : ""})</> : null}
        </div>
      ) : null}
      {matched.length ? (
        <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} disabled={pending} onClick={run}>
          {pending ? progress ?? "Uploading…" : `Upload ${matched.length} photo${matched.length === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {result ? <div className={`alert ${result.ok ? "ok" : "err"}`}>{result.message}</div> : null}
    </div>
  );
}
