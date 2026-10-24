"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadBannerImage } from "@/lib/images";
import { saleOn } from "@/lib/sale";
import { PROMO_THEMES, type PromoKind, type PromoRow, type PromoSlide } from "@/lib/promo-themes";
import { PromoSlideCard } from "@/components/promo-banner";
import { Submit } from "@/components/forms";

// Admin → Home banner: the form for one slide, with a live preview of how it will look.

export type PromoPick = {
  sku: string;
  name: string;
  unit: string;
  list_price: number | null;
  cp: boolean;
  image_url: string | null;
  sale_price: number | null;
  sale_ends: string | null;
};

const Ctx = createContext<{ products: Map<string, PromoPick>; cities: string[] }>({ products: new Map(), cities: [] });

/** Gives every slide form the product list once (instead of once per form). */
export function PromoCatalog({ products, cities, children }: { products: PromoPick[]; cities: string[]; children: React.ReactNode }) {
  const value = useMemo(() => ({ products: new Map(products.map((p) => [p.sku.toLowerCase(), p])), cities }), [products, cities]);
  return (
    <Ctx.Provider value={value}>
      <datalist id="promo-skus">
        {products.map((p) => (
          <option key={p.sku} value={`${p.sku} · ${p.name}`} />
        ))}
      </datalist>
      {children}
    </Ctx.Provider>
  );
}

const money2 = (v: number | null) => (v === null ? "" : v.toFixed(2));

export function PromoForm({
  action,
  row,
  sku,
}: {
  action: (form: FormData) => Promise<void>;
  row?: PromoRow;
  sku?: string;
}) {
  const { products, cities } = useContext(Ctx);
  const first = sku ? products.get(sku.toLowerCase()) : undefined;
  const [kind, setKind] = useState<PromoKind>(row?.kind ?? "product");
  const [pick, setPick] = useState(first ? `${first.sku} · ${first.name}` : "");
  const [eyebrow, setEyebrow] = useState(row?.eyebrow ?? "");
  const [title, setTitle] = useState(row?.title ?? "");
  const [subtitle, setSubtitle] = useState(row?.subtitle ?? "");
  const [image, setImage] = useState(row?.image_url ?? "");
  const [theme, setTheme] = useState(row?.theme ?? "blue");
  const [sale, setSale] = useState(money2(first?.sale_price ?? null));
  const [saleEnds, setSaleEnds] = useState(first?.sale_ends ?? "");
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);

  const product = products.get(pick.split(" · ")[0].trim().toLowerCase());

  const preview: PromoSlide = (() => {
    const base = { id: row?.id ?? "new", kind, eyebrow: eyebrow || null, subtitle: subtitle || null, theme, href: "", external: false };
    if (kind === "product") {
      const salePrice = sale.trim() === "" ? null : Number(sale.replace(/[$,\s]/g, ""));
      const on = !!product && saleOn(salePrice, saleEnds || null);
      const list = product?.list_price ?? null;
      const now = on ? salePrice : product?.cp ? null : list;
      return {
        ...base,
        title: title || product?.name || "Pick a product",
        image: image || product?.image_url || null,
        price: product ? { now, was: on && list !== null && now !== null && list > now ? list : null, unit: product.unit, sale: on, account: !on && product.cp } : undefined,
      };
    }
    return { ...base, title: title || "Your title", image: image || (kind === "locations" ? "/promos/map-south.svg" : null), cities: kind === "locations" ? cities : undefined };
  })();

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setUpErr(null);
    try {
      setImage(await uploadBannerImage(createClient(), file));
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form action={action} className="col" style={{ gap: 14 }}>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <input type="hidden" name="image_url" value={image} />

      <div className="promo-preview" aria-label="Preview">
        <PromoSlideCard s={preview} />
      </div>

      <div className="seg" role="radiogroup" aria-label="Kind of slide">
        {([
          ["product", "Product"],
          ["locations", "Locations map"],
          ["custom", "Picture or news"],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />

      {kind === "product" ? (
        <>
          <label className="field">
            <span className="label">Product</span>
            <input
              className="input"
              name="sku"
              list="promo-skus"
              value={pick}
              onChange={(e) => {
                setPick(e.target.value);
                const p = products.get(e.target.value.split(" · ")[0].trim().toLowerCase());
                if (p) {
                  setSale(money2(p.sale_price));
                  setSaleEnds(p.sale_ends ?? "");
                }
              }}
              placeholder="Type a SKU or product name"
              autoComplete="off"
              required
            />
            {product ? (
              <span className="tiny faint">
                {product.cp ? "Normally priced to each customer's account" : product.list_price !== null ? `Regular price $${product.list_price.toFixed(2)} / ${product.unit}` : "No list price"}
              </span>
            ) : pick ? (
              <span className="tiny red">No product with that SKU yet. Pick one from the list.</span>
            ) : null}
          </label>
          <div className="grid2">
            <label className="field">
              <span className="label">Sale price</span>
              <input className="input" name="sale_price" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="Blank = regular price" />
            </label>
            <label className="field">
              <span className="label">Sale ends (last day)</span>
              <input className="input" name="sale_ends" type="date" value={saleEnds} onChange={(e) => setSaleEnds(e.target.value)} />
            </label>
          </div>
          <p className="tiny faint" style={{ margin: "-6px 0 0" }}>
            The sale price is charged on new orders too, until the last day (or until you clear it). Leave the last day blank to keep the sale going.
          </p>
        </>
      ) : null}

      <div className="grid2">
        <label className="field">
          <span className="label">Small label</span>
          <input className="input" name="eyebrow" value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} placeholder={kind === "product" ? "Featured, New, Limited time" : "AMBIT Distribution"} maxLength={28} />
        </label>
        <label className="field">
          <span className="label">Title{kind === "product" ? " (blank = product name)" : ""}</span>
          <input className="input" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required={kind !== "product"} />
        </label>
      </div>
      <label className="field">
        <span className="label">Line under the title</span>
        <input className="input" name="subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={120} />
      </label>

      <div className="field">
        <span className="label">Picture</span>
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="btn sm dark">
            <ImagePlus size={15} /> {busy ? "Uploading…" : image ? "Replace picture" : "Upload a picture"}
            <input type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {image ? (
            <button type="button" className="linkbtn small" onClick={() => setImage("")}>
              <Trash2 size={13} /> {kind === "product" ? "Use the product's photo" : kind === "locations" ? "Use the AMBIT map" : "Remove picture"}
            </button>
          ) : null}
        </div>
        <span className="tiny faint">PNG pictures with a see-through background look best (like the product cut-outs).</span>
        {upErr ? <span className="tiny red">{upErr}</span> : null}
      </div>

      <div className="field">
        <span className="label">Color</span>
        <div className="swatches" role="radiogroup" aria-label="Slide color">
          {Object.entries(PROMO_THEMES).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={theme === k} aria-label={t.label} title={t.label} className={theme === k ? "on" : ""} style={{ background: t.bg }} onClick={() => setTheme(k)} />
          ))}
        </div>
        <input type="hidden" name="theme" value={theme} />
      </div>

      <label className="field">
        <span className="label">Opens (optional)</span>
        <input className="input" name="link" defaultValue={row?.link ?? ""} placeholder={kind === "product" ? "Blank = the product in Order" : kind === "locations" ? "Blank = Branches" : "/docs or https://…"} />
      </label>

      <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <label className="field">
          <span className="label">Who sees it</span>
          <select className="select" name="audience" defaultValue={row?.audience ?? "all"}>
            <option value="all">Everyone</option>
            <option value="employee">AMBIT staff</option>
            <option value="customer">Contractors</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Show from</span>
          <input className="input" name="starts_on" type="date" defaultValue={row?.starts_on ?? ""} />
        </label>
        <label className="field">
          <span className="label">Show until</span>
          <input className="input" name="ends_on" type="date" defaultValue={row?.ends_on ?? ""} />
        </label>
      </div>

      <div className="row between wrap" style={{ gap: 10 }}>
        <label className="check"><input type="checkbox" name="active" defaultChecked={row ? row.active : true} /> Show on Home</label>
        <Submit className="btn sm" pendingText="Saving…">{row ? "Save slide" : "Add slide"}</Submit>
      </div>
    </form>
  );
}
