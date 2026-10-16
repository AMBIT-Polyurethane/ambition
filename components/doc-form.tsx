"use client";

import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { saveDoc, type ImportResult } from "@/app/(app)/admin/actions";
import type { DocumentRow } from "@/lib/types";

const TYPES = ["TDS", "SDS", "ESR", "TSB", "Guide", "Training", "Marketing", "Other"];

export function DocForm({ doc, onDone }: { doc?: DocumentRow; onDone?: () => void }) {
  const [path, setPath] = useState(doc?.storage_path ?? "");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const [audience, setAudience] = useState(doc?.audience ?? "all");

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const clean = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const key = `${audience === "employee" ? "internal/" : ""}${Date.now()}-${clean}`;
    const { error } = await createClient().storage.from("docs").upload(key, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) setMsg({ ok: false, message: `Upload failed: ${error.message}` });
    else setPath(key);
  };

  return (
    <form
      className="col"
      action={(fd) =>
        start(async () => {
          fd.set("storage_path", path);
          const res = await saveDoc(fd);
          setMsg(res);
          if (res.ok && !doc) onDone?.();
        })
      }
    >
      {doc ? <input type="hidden" name="id" value={doc.id} /> : null}
      <div className="grid3">
        <label className="field" style={{ gridColumn: "span 2" }}>
          <span className="label">Title</span>
          <input className="input sm" name="title" defaultValue={doc?.title ?? ""} required />
        </label>
        <label className="field">
          <span className="label">Type</span>
          <select className="select sm" name="doc_type" defaultValue={doc?.doc_type ?? "TDS"}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Product</span>
          <input className="input sm" name="product" defaultValue={doc?.product ?? ""} placeholder="e.g. AMBI-SEAL" />
        </label>
        <label className="field">
          <span className="label">Code</span>
          <input className="input sm" name="code" defaultValue={doc?.code ?? ""} placeholder="e.g. TSB-016" />
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
          <span className="label">Link (if the file lives on a website)</span>
          <input className="input sm" name="url" type="url" defaultValue={doc?.url ?? ""} placeholder="https://…" />
        </label>
        <div className="field">
          <span className="label">Or upload a file</span>
          <label className="btn dark sm">
            <Upload size={14} /> {uploading ? "Uploading…" : path ? "Replace file" : "Choose PDF"}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.pptx,.xlsx" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
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
      {path ? <div className="tiny faint">File: {path}</div> : null}
      <div className="row">
        <button type="submit" className="btn sm" disabled={pending || uploading}>{pending ? "Saving…" : doc ? "Save" : "Add document"}</button>
        {msg ? <span className={`small ${msg.ok ? "" : "red"}`}>{msg.message}</span> : null}
      </div>
    </form>
  );
}
