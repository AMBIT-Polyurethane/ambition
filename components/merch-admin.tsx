"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Camera, CircleAlert, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toJpeg } from "@/lib/images";
import { saveMerch } from "@/app/(app)/admin/merch/actions";

export type MerchRow = { id: string; name: string; description: string | null; price: number | null; image_url: string | null; sizes: string | null; sort: number; active: boolean };

/** Add a merch item, or change one: photo, name, price, sizes, description. */
export function MerchEditor({ item }: { item: MerchRow | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<string | null>(item?.image_url ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      const jpeg = await toJpeg(f, 1400, 0.88);
      const supabase = createClient();
      const path = `merch/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("product-images").upload(path, jpeg, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw new Error(error.message);
      setImg(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setErr(`That photo didn't upload: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = (f: FormData) => {
    setErr(null);
    const s = (k: string) => String(f.get(k) ?? "");
    start(async () => {
      const r = await saveMerch({ id: item?.id ?? null, name: s("name"), description: s("description"), price: s("price"), sizes: s("sizes"), image_url: img });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setOpen(false);
      if (!item) setImg(null);
      router.refresh();
    });
  };

  if (!open) {
    return item ? (
      <button type="button" className="b2 quiet sm" onClick={() => setOpen(true)}><Pencil size={15} /> Edit</button>
    ) : (
      <button type="button" className="b2" onClick={() => setOpen(true)}><Plus size={17} /> Add a shirt, hat or other item</button>
    );
  }
  return (
    <form action={submit} className="card2 merch-ed">
      <div className="merch-ed-h">
        <b>{item ? `Change ${item.name}` : "New merch item"}</b>
        <button type="button" className="b2 quiet sm icon" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="merch-ed-g">
        <label className="merch-up">
          {img ? <img src={img} alt="" /> : <span><Camera size={26} aria-hidden="true" /> Add a photo</span>}
          {busy ? <span className="merch-up-busy"><LoaderCircle size={20} className="spin" /></span> : null}
          <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <div className="merch-ed-f">
          <label className="field"><span>Name</span><input className="input" name="name" required defaultValue={item?.name ?? ""} placeholder="AMBIT Hoodie" /></label>
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ flex: 1 }}><span>Price ($)</span><input className="input" name="price" inputMode="decimal" defaultValue={item?.price ?? ""} placeholder="29.99" /></label>
            <label className="field" style={{ flex: 2 }}><span>Sizes or colors</span><input className="input" name="sizes" defaultValue={item?.sizes ?? ""} placeholder="S, M, L, XL, 2XL" /></label>
          </div>
          <label className="field"><span>Description</span><textarea className="input" name="description" rows={3} defaultValue={item?.description ?? ""} placeholder="Heavy cotton, red ADC logo on the chest" /></label>
        </div>
      </div>
      {err ? <div className="alert warn small"><CircleAlert size={16} aria-hidden="true" /> {err}</div> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="b2" disabled={pending || busy}>{pending ? <><LoaderCircle size={16} className="spin" /> Saving</> : item ? "Save" : "Add it"}</button>
        <button type="button" className="b2 quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
