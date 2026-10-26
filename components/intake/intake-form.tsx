"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { uploadPhotos } from "@/lib/photo-upload";
import { readIntake } from "@/app/(app)/order/intake/actions";

/** AI order intake: paste the order (text, email) or snap the handwritten one. */
export function IntakeForm({ ready }: { ready: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list).map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 4);
    setFiles(next);
    if (camRef.current) camRef.current.value = "";
    if (pickRef.current) pickRef.current.value = "";
  };

  const go = async () => {
    if (busy) return;
    setError(null);
    if (!text.trim() && !files.length) {
      setError("Paste the order or add a photo of it first.");
      return;
    }
    let paths: string[] = [];
    if (files.length) {
      setBusy("Uploading photos…");
      const up = await uploadPhotos(files.map((f) => f.file), "intake");
      if (up.errors.length && !up.ok.length) {
        setError(up.errors.join(" "));
        setBusy(null);
        return;
      }
      paths = up.ok.map((u) => u.path);
    }
    setBusy("Reading the order and matching AMBIT products…");
    const r = await readIntake({ text, photos: paths });
    if (r.id) {
      router.push(`/order/intake/${r.id}`);
      return;
    }
    setError(r.error ?? "Something went wrong.");
    setBusy(null);
  };

  return (
    <div className="card col" style={{ gap: 14 }}>
      <label className="field">
        <span className="label">Paste the order</span>
        <textarea
          className="textarea"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paste a text or email, for example:\nHey it's Mike w/ Lopez. Need 4 sets 5.0 and 2 sets 204 for pickup OKC Thursday, PO 7781. Also 10 bags R13x15."}
          disabled={!!busy}
        />
      </label>

      <div className="col" style={{ gap: 8 }}>
        <span className="label">Or a photo of it (up to 4)</span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm dark" onClick={() => camRef.current?.click()} disabled={!!busy || files.length >= 4} style={{ gap: 8 }}>
            <Camera size={16} /> Take photo
          </button>
          <button type="button" className="btn sm dark" onClick={() => pickRef.current?.click()} disabled={!!busy || files.length >= 4} style={{ gap: 8 }}>
            <ImagePlus size={16} /> Choose photos
          </button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
        <input ref={pickRef} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
        {files.length ? (
          <div className="photo-row">
            {files.map((f, i) => (
              <div key={f.url} className="photo-thumb">
                <img src={f.url} alt={`Photo ${i + 1}`} />
                {!busy ? (
                  <button type="button" aria-label="Remove photo" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <div className="alert err small" role="alert">{error}</div> : null}
      {!ready ? <div className="alert info small">AI order intake needs the Claude connection (an admin adds ANTHROPIC_API_KEY in Vercel).</div> : null}

      <button type="button" className="btn" onClick={go} disabled={!!busy || !ready} style={{ gap: 10 }}>
        {busy ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />} {busy ?? "Read the order"}
      </button>
      <p className="tiny faint" style={{ margin: 0 }}>
        Nothing is sent to the customer or to orders@ from here. You check every line next, then finish it on the Order screen.
      </p>
    </div>
  );
}
