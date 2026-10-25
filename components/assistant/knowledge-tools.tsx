"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileUp, LoaderCircle, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { pdfPagesText } from "@/lib/pdf-text";
import { DOC_KIND, KINDS, chunkPages, kindInfo, type ChunkRow } from "@/lib/assistant/config";
import { createSource, refreshAssistantAdmin, saveChunks, sourceFailed } from "@/app/(app)/admin/assistant/actions";

export type LibraryDoc = {
  id: string;
  title: string;
  doc_type: string;
  code: string | null;
  source: { id: string; status: string; chars: number; updated_at: string; enabled: boolean } | null;
};

type Line = { text: string; tone: "ok" | "err" | "busy" };

const BATCH = 150;

async function storeText(sourceId: string, chunks: ChunkRow[]): Promise<string | null> {
  if (!chunks.length) {
    await sourceFailed(sourceId, "No words found in this PDF (a scanned image?).");
    return "No words found in this PDF. If it's a scan, it needs a PDF with real text.";
  }
  for (let i = 0; i < chunks.length; i += BATCH) {
    const r = await saveChunks(sourceId, chunks.slice(i, i + BATCH), i > 0);
    if (r.error) return r.error;
  }
  return null;
}

const docTitle = (d: LibraryDoc) => (d.code && !d.title.toLowerCase().includes(d.code.toLowerCase()) ? `${d.code} ${d.title}` : d.title);

/** Admin → Ask AMBIT → Teach: add PDFs and AMBIT documents. The words are read here in the browser. */
export function KnowledgeTools({ docs, canTeach }: { docs: LibraryDoc[]; canTeach: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const kinds = KINDS.filter((k) => canTeach || k.id !== "teaching");
  const [kind, setKind] = useState<string>(canTeach ? "teaching" : "product");
  const [staffOnly, setStaffOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const say = (text: string, tone: Line["tone"] = "busy") => setLines((l) => [...l.filter((x) => x.tone !== "busy"), { text, tone }]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || busy) return;
    setBusy(true);
    setLines([]);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      const name = file.name;
      try {
        if (!/\.pdf$/i.test(name) && file.type !== "application/pdf") {
          say(`${name}: only PDFs can be added.`, "err");
          continue;
        }
        if (file.size > 50 * 1024 * 1024) {
          say(`${name}: over 50 MB. Split it into smaller PDFs.`, "err");
          continue;
        }
        const data = await file.arrayBuffer();
        const pages = await pdfPagesText(data.slice(0), (p, of) => say(`${name}: reading page ${p} of ${of}…`));
        const title = name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
        const chunks = chunkPages(title, pages);
        if (!chunks.length) {
          say(`${name}: no words found (it looks like a scan). Use a PDF with real text.`, "err");
          continue;
        }
        say(`${name}: uploading…`);
        const path = `${crypto.randomUUID()}/${name.replace(/[^\w.\- ]+/g, "_")}`;
        const up = await supabase.storage.from("knowledge").upload(path, file, { contentType: "application/pdf", upsert: false });
        if (up.error) {
          say(`${name}: upload failed (${up.error.message}).`, "err");
          continue;
        }
        const made = await createSource({ kind, origin: "upload", title, storage_path: path, file_name: name, pages: pages.length, staff_only: staffOnly });
        if (!made.id) {
          await supabase.storage.from("knowledge").remove([path]);
          say(`${name}: ${made.error ?? "couldn't save it."}`, "err");
          continue;
        }
        say(`${name}: saving ${chunks.length} pieces…`);
        const err = await storeText(made.id, chunks);
        say(err ? `${name}: ${err}` : `${name}: added (${pages.length} pages). Ask AMBIT uses it now.`, err ? "err" : "ok");
      } catch (e) {
        say(`${name}: couldn't read this PDF (${(e as Error).message || "unknown error"}).`, "err");
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
    await refreshAssistantAdmin();
    router.refresh();
  };

  const addDoc = async (d: LibraryDoc): Promise<boolean> => {
    const k = DOC_KIND[d.doc_type];
    const t = docTitle(d);
    if (!k) return false;
    if (k === "teaching" && !canTeach) {
      say(`${t}: only AMBIT's building-science teacher can add bulletins and teaching.`, "err");
      return false;
    }
    try {
      say(`${t}: getting the PDF…`);
      const r = await fetch(`/api/assistant/doc-pdf?id=${d.id}`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        say(`${t}: ${j?.error ?? "couldn't get the PDF"}.`, "err");
        return false;
      }
      const pages = await pdfPagesText(await r.arrayBuffer(), (p, of) => say(`${t}: reading page ${p} of ${of}…`));
      const made = await createSource({ kind: k, origin: "document", title: t, document_id: d.id, pages: pages.length });
      if (!made.id) {
        say(`${t}: ${made.error ?? "couldn't save it."}`, "err");
        return false;
      }
      const err = await storeText(made.id, chunkPages(t, pages));
      say(err ? `${t}: ${err}` : `${t}: added (${pages.length} pages).`, err ? "err" : "ok");
      return !err;
    } catch (e) {
      say(`${t}: couldn't read it (${(e as Error).message || "unknown error"}).`, "err");
      return false;
    }
  };

  const run = async (list: LibraryDoc[]) => {
    if (busy || !list.length) return;
    setBusy(true);
    setLines([]);
    let ok = 0;
    for (const d of list) if (await addDoc(d)) ok++;
    say(`Done: ${ok} of ${list.length} added.`, ok === list.length ? "ok" : "err");
    setBusy(false);
    await refreshAssistantAdmin();
    router.refresh();
  };

  const usable = docs.filter((d) => DOC_KIND[d.doc_type] && (canTeach || DOC_KIND[d.doc_type] !== "teaching"));
  const notYet = usable.filter((d) => !d.source || d.source.status !== "ready");

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card col">
        <b>Add PDFs</b>
        <span className="small muted">
          TSBs, teaching, IECC / IRC / IBC sections, ACCA or ASHRAE material, neutral research. Never anything from SPFA or the foam
          industry. PDFs need real text (not scans); up to 50 MB each.
        </span>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="field" style={{ flex: "1 1 240px" }}>
            <span className="label">What it is</span>
            <select className="select sm" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </label>
          <label className="check" style={{ alignSelf: "flex-end", minHeight: 40 }}>
            <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} disabled={busy} /> AMBIT staff only
          </label>
        </div>
        <span className="tiny faint">{kindInfo(kind).hint}</span>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy} style={{ alignSelf: "flex-start", gap: 8 }}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />} Choose PDFs
        </button>
      </div>

      <div className="card col">
        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <b>AMBIT documents</b>
          <button type="button" className="btn sm dark" onClick={() => run(notYet)} disabled={busy || !notYet.length} style={{ gap: 8 }}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {notYet.length ? `Add all ${notYet.length} not added yet` : "All added"}
          </button>
        </div>
        <span className="small muted">
          From Product docs: bulletins (TSBs) count as AMBIT teaching; data sheets, SDS, ESR / CCRR, guides and warranties as AMBIT product docs.
          The SPFA library and brochures are never used.
        </span>
        <div className="ai-doc-list">
          {usable.map((d) => {
            const s = d.source;
            return (
              <div key={d.id} className="ai-doc">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600, fontSize: 14 }}>{docTitle(d)}</div>
                  <div className="tiny faint">
                    {d.doc_type} · {kindInfo(DOC_KIND[d.doc_type]).short} ·{" "}
                    {s ? (s.status === "ready" ? `${Math.round(s.chars / 1000)}k characters${s.enabled ? "" : " · turned off"}` : s.status === "error" ? "couldn't read it" : "no text found") : "not added"}
                  </div>
                </div>
                <button type="button" className="btn sm dark" onClick={() => run([d])} disabled={busy}>
                  {s ? "Re-read" : "Add"}
                </button>
              </div>
            );
          })}
          {!usable.length ? <p className="tiny faint">No AMBIT documents in Product docs yet.</p> : null}
        </div>
      </div>

      {lines.length ? (
        <div className="card col" role="status" aria-live="polite" style={{ gap: 6 }}>
          {lines.map((l, i) => (
            <div key={i} className="row small" style={{ gap: 8, alignItems: "flex-start", color: l.tone === "err" ? "var(--err-text)" : l.tone === "ok" ? "var(--ok-text)" : "var(--text2)" }}>
              {l.tone === "busy" ? <LoaderCircle size={15} className="spin" style={{ flex: "none", marginTop: 2 }} /> : l.tone === "ok" ? <CircleCheck size={15} style={{ flex: "none", marginTop: 2 }} /> : <CircleAlert size={15} style={{ flex: "none", marginTop: 2 }} />}
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
