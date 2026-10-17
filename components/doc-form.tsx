"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { copyDocFile, saveDoc, type ImportResult } from "@/app/(app)/admin/actions";
import { DOC_TYPES, LIBRARY_SHELVES, docProducts } from "@/lib/docs";
import type { DocumentRow } from "@/lib/types";

export function DocForm({ doc, families = [], onDone }: { doc?: DocumentRow; families?: string[]; onDone?: (res: ImportResult) => void }) {
  const [path, setPath] = useState(doc?.storage_path ?? "");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const [audience, setAudience] = useState(doc?.audience ?? "all");
  const [type, setType] = useState(doc?.doc_type ?? "TDS");
  const listId = `fam-${doc?.id ?? "new"}`;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const clean = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const key = `${audience === "employee" ? "internal/" : ""}${type.toLowerCase()}/${Date.now()}-${clean}`;
    const { error } = await createClient().storage.from("docs").upload(key, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) setMsg({ ok: false, message: `Upload failed: ${error.message}` });
    else {
      setPath(key);
      setMsg({ ok: true, message: "File uploaded. Press Save to keep it." });
    }
  };

  const recopy = () =>
    start(async () => {
      if (!doc) return;
      setMsg(null);
      const res = await copyDocFile(doc.id);
      setMsg(res);
    });

  const code = type === "ESR" || type === "CCRR";

  return (
    <form
      className="col"
      action={(fd) =>
        start(async () => {
          fd.set("storage_path", path);
          const res = await saveDoc(fd);
          setMsg(res);
          if (res.ok && !doc) onDone?.(res);
        })
      }
    >
      {doc ? <input type="hidden" name="id" value={doc.id} /> : null}
      <datalist id={listId}>{families.map((f) => <option key={f} value={f} />)}</datalist>
      <datalist id={`${listId}-shelf`}>{LIBRARY_SHELVES.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="grid3">
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span className="label">Title</span>
          <input className="input sm" name="title" defaultValue={doc?.title ?? ""} required />
        </label>
        <label className="field">
          <span className="label">Type</span>
          <select className="select sm" name="doc_type" value={type} onChange={(e) => setType(e.target.value)}>
            {DOC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.short === t.id ? `${t.id} · ${t.label}` : t.label}</option>)}
          </select>
        </label>
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span className="label">Products (comma between several)</span>
          <input className="input sm" name="products" list={listId} defaultValue={doc ? docProducts(doc).join(", ") : ""} placeholder="e.g. AMBI-TITE 204" />
        </label>
        <label className="field">
          <span className="label">{type === "Industry" ? "Library shelf" : "Code / number"}</span>
          {type === "Industry" ? (
            <input className="input sm" name="category" list={`${listId}-shelf`} defaultValue={doc?.category ?? ""} placeholder="Insulation" />
          ) : (
            <input className="input sm" name="code" defaultValue={doc?.code ?? ""} placeholder={code ? "e.g. ESR-4427" : "e.g. TSB-016"} />
          )}
        </label>
        {type === "Industry" ? null : <input type="hidden" name="category" value={doc?.category ?? ""} />}
        {type === "Industry" ? (
          <label className="field">
            <span className="label">Code / number</span>
            <input className="input sm" name="code" defaultValue={doc?.code ?? ""} placeholder="e.g. SPFA-126" />
          </label>
        ) : null}
        <label className="field">
          <span className="label">Revision</span>
          <input className="input sm" name="revision" defaultValue={doc?.revision ?? ""} placeholder="e.g. Rev. 10/01/2024" />
        </label>
        <label className="field">
          <span className="label">{code ? "Renewal date" : "Renewal / expiry (optional)"}</span>
          <input className="input sm" name="renewal_on" type="date" defaultValue={doc?.renewal_on ?? ""} />
        </label>
        <label className="field">
          <span className="label">Who can see it</span>
          <select className="select sm" name="audience" value={audience} onChange={(e) => setAudience(e.target.value as DocumentRow["audience"])}>
            <option value="all">Everyone</option>
            <option value="customer">Contractors (and staff)</option>
            <option value="employee">AMBIT staff only</option>
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="label">Short description</span>
          <input className="input sm" name="description" defaultValue={doc?.description ?? ""} />
        </label>
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span className="label">Link to the file (e.g. on ambitpu.com)</span>
          <input className="input sm" name="url" type="url" defaultValue={doc?.url ?? ""} placeholder="https://…" />
        </label>
        <div className="field">
          <span className="label">Or upload a file</span>
          <label className="btn dark sm">
            <Upload size={14} /> {uploading ? "Uploading…" : path ? "Replace file" : "Choose PDF"}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx,.xlsx" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
        <label className="check" style={{ gridColumn: "span 2" }}>
          <input type="checkbox" name="keep_copy" defaultChecked /> Keep a copy of the linked file in the app
        </label>
        <label className="field">
          <span className="label">Sort</span>
          <input className="input sm" name="sort" type="number" defaultValue={doc?.sort ?? 0} />
        </label>
        {doc ? (
          <label className="check" style={{ alignSelf: "end" }}>
            <input type="checkbox" name="active" defaultChecked={doc.active} /> Visible
          </label>
        ) : null}
      </div>
      <div className="tiny faint">
        {path ? `Stored in the app: ${path}` : doc?.url ? "Not copied yet. The app opens the website link." : "No file yet."}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="submit" className="btn sm" disabled={pending || uploading}>{pending ? "Working…" : doc ? "Save" : "Add document"}</button>
        {doc?.url ? (
          <button type="button" className="btn dark sm" onClick={recopy} disabled={pending || uploading} title="Download the link again and replace the stored copy">
            <RefreshCw size={14} /> {path ? "Re-copy from link" : "Copy into the app"}
          </button>
        ) : null}
        {msg ? <span className={`small ${msg.ok ? "" : "red"}`}>{msg.message}</span> : null}
      </div>
    </form>
  );
}
