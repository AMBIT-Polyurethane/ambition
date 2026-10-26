"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, ImagePlus, LoaderCircle, X } from "lucide-react";
import { uploadPhotos } from "@/lib/photo-upload";
import { setComplaintPhotos } from "@/app/(app)/complaints/actions";

/** Photos on a complaint report: add more (camera or library) and remove any. */
export function ComplaintPhotos({ id, photos, editable }: { id: string; photos: { path: string; url: string | null }[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const up = await uploadPhotos(Array.from(files).slice(0, 12 - photos.length), "complaints");
    if (up.errors.length) setError(up.errors.join(" "));
    if (up.ok.length) await setComplaintPhotos(id, [...photos.map((p) => p.path), ...up.ok.map((u) => u.path)]);
    if (cam.current) cam.current.value = "";
    if (pick.current) pick.current.value = "";
    setBusy(false);
    router.refresh();
  };

  const remove = async (path: string) => {
    setBusy(true);
    await setComplaintPhotos(id, photos.map((p) => p.path).filter((p) => p !== path));
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      {photos.length ? (
        <div className="photo-row">
          {photos.map((p, i) => (
            <div key={p.path} className="photo-thumb lg">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={`Photo ${i + 1}`} /></a>
              ) : null}
              {editable ? (
                <button type="button" aria-label="Remove photo" onClick={() => remove(p.path)} disabled={busy}>
                  <X size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <span className="small faint">No photos yet.</span>
      )}
      {editable && photos.length < 12 ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn sm dark" onClick={() => cam.current?.click()} disabled={busy} style={{ gap: 8 }}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Camera size={16} />} Take photo
          </button>
          <button type="button" className="btn sm dark" onClick={() => pick.current?.click()} disabled={busy} style={{ gap: 8 }}>
            <ImagePlus size={16} /> Add photos
          </button>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
          <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
        </div>
      ) : null}
      {error ? <div className="alert err small">{error}</div> : null}
    </div>
  );
}
