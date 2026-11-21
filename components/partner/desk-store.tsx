"use client";

import { useState, useTransition } from "react";
import { Check, CircleAlert, ImagePlus, LoaderCircle, Palette, Phone, Truck, Type } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toBannerImage } from "@/lib/images";
import { saveStore, type StoreInput } from "@/app/store/desk-actions";

const SWATCHES = ["#2d694b", "#1f4e79", "#7a1f1f", "#3b3b3b", "#8a5a00", "#4b2d69"];

/** The store's contact info (on every page and email) and its look (logo, colors, the words on the home page). */
export function DeskStore({ slug, s: start, readOnly }: { slug: string; s: StoreInput; readOnly: boolean }) {
  const [s, setS] = useState(start);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start2] = useTransition();
  const set = (k: keyof StoreInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setBusy("Uploading your logo...");
    try {
      const { blob, ext } = await toBannerImage(f, 900);
      const supabase = createClient();
      const path = `partners/${slug}/logo-${Date.now().toString(36)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, blob, { contentType: `image/${ext}`, cacheControl: "31536000" });
      if (error) throw new Error(error.message);
      setS((cur) => ({ ...cur, logo_url: supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl }));
    } catch (e) {
      setErr(`That logo didn't upload: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    start2(async () => {
      setErr(null);
      setOk(null);
      const r = await saveStore(slug, s);
      if (!r.ok) setErr(r.error);
      else setOk(r.message ?? "Saved.");
    });
  return (
    <div className="adc-stack-s">
      <div className="ptn-desk-h">
        <span>
          <h1 className="adc-h1">Store look, contact &amp; shipping</h1>
          <span className="adc-muted">Your phone and email show on every page of your store and on every email it sends. Shipping shows at checkout.</span>
        </span>
      </div>
      <fieldset className="ptn-fs ptn-look" disabled={readOnly || pending}>
        <section className="ptn-card">
          <span className="ptn-card-h"><Phone size={18} aria-hidden="true" /><b>Contact info</b></span>
          <label className="adc-f"><span>Store name</span><input value={s.name} onChange={set("name")} maxLength={120} /></label>
          <label className="adc-f"><span>Owner</span><input value={s.owner_name} onChange={set("owner_name")} maxLength={120} /></label>
          <label className="adc-f"><span>Email (orders come here; customers&apos; replies go here)</span><input type="email" value={s.email} onChange={set("email")} maxLength={160} /></label>
          <label className="adc-f"><span>Phone</span><input type="tel" value={s.phone} onChange={set("phone")} maxLength={40} /></label>
        </section>
        <section className="ptn-card">
          <span className="ptn-card-h"><Palette size={18} aria-hidden="true" /><b>Logo and colors</b></span>
          <div className="ptn-logo-prev" style={{ background: s.color }}>{s.logo_url ? <img src={s.logo_url} alt="Your logo" /> : <b>{s.name}</b>}</div>
          {!readOnly ? (
            <span className="ptn-photo-b">
              <label className="adc-ghost dark ptn-file"><ImagePlus size={17} aria-hidden="true" /> Change logo<input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} /></label>
              <span className="adc-muted small">{busy ?? "A white logo on a see-through background looks best on your color."}</span>
            </span>
          ) : null}
          <span className="adc-f"><span>Main color</span></span>
          <div className="ptn-swatches">
            {SWATCHES.map((c) => <button key={c} type="button" className={s.color === c ? "on" : undefined} style={{ background: c }} onClick={() => setS({ ...s, color: c, color2: c })} aria-label={`Use ${c}`} />)}
            <label className="ptn-pick">Your own <input type="color" value={s.color} onChange={(e) => setS({ ...s, color: e.target.value, color2: e.target.value })} /></label>
          </div>
        </section>
        <section className="ptn-card wide">
          <span className="ptn-card-h"><Truck size={18} aria-hidden="true" /><b>Shipping</b></span>
          <span className="adc-muted small">Shoppers see this at checkout and it&apos;s added to their order. Leave the flat amount empty to quote shipping on each order yourself. Pickup is always free.</span>
          <div className="adc-f2">
            <label className="adc-f"><span>Shipping per order ($)</span><input inputMode="decimal" value={s.ship_flat} onChange={set("ship_flat")} placeholder="e.g. 25" maxLength={12} /></label>
            <label className="adc-f"><span>Free shipping on orders over ($)</span><input inputMode="decimal" value={s.ship_free_over} onChange={set("ship_free_over")} placeholder="e.g. 500 (empty: never free)" maxLength={12} /></label>
            <label className="adc-f"><span>Ship-from ZIP (for shipping estimates)</span><input inputMode="numeric" value={s.ship_zip} onChange={set("ship_zip")} placeholder="e.g. 65301" maxLength={10} /></label>
            <label className="adc-f"><span>Note at checkout (optional)</span><input value={s.ship_note} onChange={set("ship_note")} placeholder="e.g. Ships UPS Ground in 1-2 business days" maxLength={300} /></label>
          </div>
        </section>
        <section className="ptn-card wide">
          <span className="ptn-card-h"><Type size={18} aria-hidden="true" /><b>Words on your home page</b></span>
          <div className="adc-f2">
            <label className="adc-f"><span>Short line under your logo (English)</span><input value={s.tagline} onChange={set("tagline")} maxLength={160} /></label>
            <label className="adc-f"><span>Same line in Spanish</span><input value={s.tagline_es} onChange={set("tagline_es")} maxLength={160} /></label>
            <label className="adc-f"><span>Big headline (English)</span><input value={s.hero_title} onChange={set("hero_title")} maxLength={160} /></label>
            <label className="adc-f"><span>Big headline in Spanish</span><input value={s.hero_title_es} onChange={set("hero_title_es")} maxLength={160} /></label>
            <label className="adc-f"><span>Text under the headline (English)</span><textarea rows={3} value={s.hero_text} onChange={set("hero_text")} maxLength={400} /></label>
            <label className="adc-f"><span>Text under the headline in Spanish</span><textarea rows={3} value={s.hero_text_es} onChange={set("hero_text_es")} maxLength={400} /></label>
          </div>
        </section>
      </fieldset>
      {err ? <div className="adc-err" role="alert"><CircleAlert size={18} aria-hidden="true" /> {err}</div> : null}
      {ok ? <div className="ptn-ok" role="status"><Check size={18} aria-hidden="true" /><span>{ok}</span></div> : null}
      {!readOnly ? (
        <span><button type="button" className="adc-cta" onClick={save} disabled={pending || Boolean(busy)}>{pending ? <><LoaderCircle size={18} className="spin" /> Saving...</> : "Save"}</button></span>
      ) : null}
    </div>
  );
}
