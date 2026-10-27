"use client";

import { useRef, useState } from "react";
import { Camera, FileUp, LoaderCircle, X } from "lucide-react";
import { completeOrder, setOrderPo } from "@/app/(app)/orders/actions";
import { uploadOrderFiles } from "@/lib/order-file-upload";

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

/** Order desk: Sales Order # and Invoice # side by side (both required), plus the invoice file if it's ready. */
export function NumbersForm({ orderId, po, invoice }: { orderId: string; po: string | null; invoice: string | null }) {
  const [files, setFiles] = useState<File[]>([]);
  const { busy, setBusy, error, setError } = useSend();
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!String(fd.get("po") ?? "").trim()) return setError("Enter the Sales Order #.");
    if (!String(fd.get("invoice") ?? "").trim()) return setError("Enter the Invoice # too.");
    setError(null);
    setBusy(true);
    const up = await uploadOrderFiles(orderId, "invoice", files);
    if (up.error) {
      setBusy(false);
      return setError(up.error);
    }
    for (const f of up.ok) {
      fd.append("file_path", f.path);
      fd.append("file_name", f.name);
    }
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
      <FilePick label="Upload invoice (optional, PDF or photo)" files={files} setFiles={setFiles} />
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      <button type="submit" className="btn sm" disabled={busy} style={{ alignSelf: "flex-start", gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null}
        {busy ? "Saving…" : po ? "Save changes" : "Save Sales Order # & Invoice #"}
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
