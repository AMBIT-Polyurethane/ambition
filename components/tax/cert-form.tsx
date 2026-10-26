"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { addCertificate } from "@/app/(app)/tax/actions";
import { CERT_KINDS, US_STATES } from "@/lib/tax";

/** Add a tax-exempt certificate: Accounting (verified right away) or a contractor's renewal (waits for Accounting). */
export function CertForm({ companyId, asCustomer, defaultState }: { companyId: string; asCustomer: boolean; defaultState?: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState(defaultState ?? "OK");
  const [num, setNum] = useState("");
  const [kind, setKind] = useState("resale");
  const [issued, setIssued] = useState("");
  const [expires, setExpires] = useState("");
  const [noExp, setNoExp] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setDone(null);
    if (!noExp && !expires) return setError("Enter the expiration date, or tick “No expiration date”.");
    if (asCustomer && !file) return setError("Add a photo or PDF of the certificate.");
    setBusy(true);
    let path: string | null = null;
    if (file) {
      if (file.size > 15 * 1024 * 1024) {
        setBusy(false);
        return setError("That file is over 15 MB.");
      }
      const ext = (/\.(pdf|jpe?g|png|webp)$/i.exec(file.name)?.[1] ?? (file.type === "application/pdf" ? "pdf" : "jpg")).toLowerCase();
      path = `${companyId}/${crypto.randomUUID()}.${ext}`;
      const up = await createClient().storage.from("tax-certs").upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
      if (up.error) {
        setBusy(false);
        return setError(`Couldn't upload the file (${up.error.message}). PDFs and photos only.`);
      }
    }
    const r = await addCertificate({
      companyId,
      state,
      cert_number: num,
      kind,
      issued_on: issued,
      expires_on: expires,
      no_expiration: noExp,
      file_path: path,
      file_name: file?.name ?? null,
      note,
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(asCustomer ? "Thanks! AMBIT's Accounting team will check it and let you know." : "Certificate added and verified.");
    setFile(null);
    setNum("");
    setExpires("");
    setIssued("");
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid2">
        <label className="field">
          <span className="label">State</span>
          <select className="select sm" value={state} onChange={(e) => setState(e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Type</span>
          <select className="select sm" value={kind} onChange={(e) => setKind(e.target.value)}>
            {CERT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="label">Certificate or permit number</span>
        <input className="input sm" value={num} onChange={(e) => setNum(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          <span className="label">Issued</span>
          <input className="input sm" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Expires</span>
          <input className="input sm" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={noExp} />
        </label>
      </div>
      <label className="check small">
        <input type="checkbox" checked={noExp} onChange={(e) => setNoExp(e.target.checked)} /> No expiration date
      </label>
      <div className="col" style={{ gap: 6 }}>
        <span className="label">The certificate (PDF or photo)</span>
        <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn sm dark" onClick={() => fileRef.current?.click()} style={{ alignSelf: "flex-start", gap: 8 }}>
          <FileUp size={16} /> {file ? file.name : "Choose file"}
        </button>
      </div>
      <label className="field">
        <span className="label">Note (optional)</span>
        <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      {done ? <div className="alert ok small" role="status">{done}</div> : null}
      <button type="button" className="btn sm" onClick={save} disabled={busy} style={{ alignSelf: "flex-start", gap: 8 }}>
        {busy ? <LoaderCircle size={16} className="spin" /> : null} {asCustomer ? "Send to AMBIT" : "Add certificate"}
      </button>
    </div>
  );
}
