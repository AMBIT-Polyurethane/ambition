"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Palette, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logoColors } from "@/lib/ops/palette";
import { setLogo, setTheme } from "../actions";

type Theme = { primary?: string | null; secondary?: string | null; palette?: string[] | null } | null;

/**
 * Pick a logo: saved in the public "ops-logos" storage under the company's folder. Its colors are picked
 * out right away and the whole workspace (buttons, widgets, charts) switches to them.
 */
export function LogoUpload({ companyId, url, theme }: { companyId: string; url: string | null; theme?: Theme }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url);
  const [colors, setColors] = useState<Theme>(theme ?? null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const applyColors = async (src: Blob | string) => {
    const c = await logoColors(src);
    if (!c) {
      setNote("Your logo is black, white or grey, so AMBIT's colors stay on. Pick a Brand color below if you like.");
      return;
    }
    const r = await setTheme(c);
    if (!r.ok) return setError(r.error ?? "Couldn't save the colors.");
    setColors(c);
    setNote("Colors picked from your logo. Your buttons, widgets and charts use them now.");
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setNote(null);
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
      await applyColors(f);
      router.refresh();
    });
  };

  const sw = colors?.primary ? [colors.primary, colors.secondary, ...(colors.palette ?? [])].filter((c, i, a): c is string => !!c && a.indexOf(c) === i).slice(0, 5) : [];

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 14, alignItems: "center" }}>
        <div className="ops-logo-box">{preview ? <img src={preview} alt="Your logo" /> : <span className="tiny faint">No logo yet</span>}</div>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="col" style={{ gap: 8 }}>
          <button type="button" className="btn sm" disabled={pending} onClick={() => ref.current?.click()}>
            <ImageUp size={15} /> {pending ? "Working…" : preview ? "Change logo" : "Upload logo"}
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
        </div>
      </div>

      <div className="brand-colors">
        <span className="row" style={{ gap: 8, alignItems: "center" }}>
          <Palette size={16} />
          <b className="small">Your colors</b>
        </span>
        {sw.length ? (
          <div className="brand-swatches">
            {sw.map((c, i) => (
              <span key={c} className="brand-sw">
                <i style={{ background: c }} />
                <span className="tiny faint">{i === 0 ? "Main" : i === 1 ? "Accent" : c.toUpperCase()}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="tiny faint">AMBIT&apos;s colors until you add a logo. Upload one and its colors are picked out for you.</span>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          {preview ? (
            <button type="button" className="btn sm dark" disabled={pending} onClick={() => start(async () => { setError(null); await applyColors(preview); router.refresh(); })}>
              <Sparkles size={14} /> Pick colors from my logo
            </button>
          ) : null}
          {sw.length ? (
            <button type="button" className="btn sm ghost" disabled={pending} onClick={() => start(async () => {
              const r = await setTheme(null);
              if (r.ok) { setColors(null); setNote("Back to AMBIT's colors."); router.refresh(); }
            })}>
              <RotateCcw size={14} /> Use AMBIT colors
            </button>
          ) : null}
        </div>
        {note ? <span className="tiny" style={{ color: "var(--ok-text)" }}>{note}</span> : null}
        {error ? <span className="tiny danger-text">{error}</span> : null}
      </div>
    </div>
  );
}
