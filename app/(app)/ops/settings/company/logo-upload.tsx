"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setLogo } from "../actions";

/** Pick a logo: saved in the public "ops-logos" storage under the company's folder. */
export function LogoUpload({ companyId, url }: { companyId: string; url: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return setError("Use a PNG, JPG, WebP or SVG image.");
    if (f.size > 5 * 1024 * 1024) return setError("That image is over 5 MB.");
    start(async () => {
      const ext = f.type === "image/svg+xml" ? "svg" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
      const path = `${companyId}/logo-${Date.now()}.${ext}`;
      const up = await createClient().storage.from("ops-logos").upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) return setError(`Couldn't upload: ${up.error.message}`);
      const r = await setLogo(path);
      if (!r.ok) return setError(r.error ?? "Couldn't save the logo.");
      setPreview(URL.createObjectURL(f));
      router.refresh();
    });
  };

  return (
    <div className="row wrap" style={{ gap: 14, alignItems: "center" }}>
      <div className="ops-logo-box">{preview ? <img src={preview} alt="Your logo" /> : <span className="tiny faint">No logo yet</span>}</div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="col" style={{ gap: 8 }}>
        <button type="button" className="btn sm" disabled={pending} onClick={() => ref.current?.click()}>
          <ImageUp size={15} /> {pending ? "Uploading…" : preview ? "Change logo" : "Upload logo"}
        </button>
        {preview ? (
          <button
            type="button"
            className="linkbtn tiny"
            disabled={pending}
            onClick={() => start(async () => {
              const r = await setLogo(null);
              if (r.ok) {
                setPreview(null);
                router.refresh();
              }
            })}
          >
            <Trash2 size={12} /> Remove
          </button>
        ) : null}
        {error ? <span className="tiny red">{error}</span> : null}
      </div>
    </div>
  );
}
