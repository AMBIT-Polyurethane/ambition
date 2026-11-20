import Link from "next/link";
import { ChevronDown, ChevronLeft, FileSpreadsheet, Images, Plus, Search, Tags } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { money, searchSafe } from "@/lib/format";
import { saleOn, todayCentral } from "@/lib/sale";
import { GOAL_GROUPS } from "@/lib/sales-goals";
import { Help } from "@/components/help";
import { MoreMenu } from "@/components/order2/menu";
import { ProductPhoto } from "@/components/product-photo";
import { Submit } from "@/components/forms";
import { CsvImport } from "@/components/csv-import";
import { BulkPhotoUpload, ProductPhotoField } from "@/components/product-photos";
import { saveCategory, saveProduct } from "@/app/(app)/admin/actions";
import type { Category, Product } from "@/lib/types";

export const metadata = { title: "Products" };

function ProductFields({ p, cats }: { p?: Product; cats: Category[] }) {
  return (
    <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      <label className="field"><span className="label">SKU</span><input className="input sm" name="sku" defaultValue={p?.sku ?? ""} required /></label>
      <label className="field" style={{ gridColumn: "span 2" }}><span className="label">Name</span><input className="input sm" name="name" defaultValue={p?.name ?? ""} required /></label>
      <label className="field" style={{ gridColumn: "span 2" }}><span className="label">Description</span><input className="input sm" name="description" defaultValue={p?.description ?? ""} placeholder="Size, pack, etc." /></label>
      <label className="field">
        <span className="label">Category</span>
        <select className="select sm" name="category_id" defaultValue={p?.category_id ?? ""}>
          <option value="">-</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="field"><span className="label">Unit</span><input className="input sm" name="unit" defaultValue={p?.unit ?? "each"} /></label>
      <label className="field"><span className="label">List price</span><input className="input sm" name="list_price" inputMode="decimal" defaultValue={p?.list_price ?? ""} placeholder="blank = on invoice" /></label>
      <label className="field">
        <span className="label">Customer pricing</span>
        <select className="select sm" name="customer_priced" defaultValue={p?.customer_priced === true ? "yes" : p?.customer_priced === false ? "no" : ""}>
          <option value="">Follow category</option>
          <option value="yes">Yes - hide list price</option>
          <option value="no">No - show list price</option>
        </select>
      </label>
      <label className="field"><span className="label">Sale price</span><input className="input sm" name="sale_price" inputMode="decimal" defaultValue={p?.sale_price ?? ""} placeholder="blank = no sale" /></label>
      <label className="field"><span className="label">Sale ends (last day)</span><input className="input sm" name="sale_ends" type="date" defaultValue={p?.sale_ends ?? ""} /></label>
      <label className="field">
        <span className="label">Sq ft per bag</span>
        <input className="input sm" name="sqft_per_unit" inputMode="decimal" defaultValue={p?.sqft_per_unit ?? ""} placeholder="Batts only" />
      </label>
      <label className="field"><span className="label">Sort</span><input className="input sm" name="sort" type="number" defaultValue={p?.sort ?? 0} /></label>
      <label className="field">
        <span className="label">Shelf life (months)</span>
        <input className="input sm" name="shelf_life_months" type="number" min={1} max={120} defaultValue={p?.shelf_life_months ?? ""} placeholder="Fills in Exp from Mfg" />
      </label>
      <label className="field" title="Used for ADC shipping estimates when the inventory spreadsheet has no weight for this item.">
        <span className="label">Ship weight (lb each)</span>
        <input className="input sm" name="ship_weight" inputMode="decimal" defaultValue={p?.ship_weight ?? ""} placeholder="If the sheet has none" />
      </label>
      <label className="field" title="For the ADC Best Strategy: who ships it when no AMBIT location has enough.">
        <span className="label">Vendor</span>
        <input className="input sm" name="vendor_name" defaultValue={p?.vendor_name ?? ""} placeholder="Who we buy it from" />
      </label>
      <label className="field"><span className="label">Vendor ships from (ZIP)</span><input className="input sm" name="vendor_zip" inputMode="numeric" maxLength={5} defaultValue={p?.vendor_zip ?? ""} /></label>
      <label className="field"><span className="label">Vendor lead time (days)</span><input className="input sm" name="vendor_lead_days" type="number" min={0} max={180} defaultValue={p?.vendor_lead_days ?? ""} /></label>
      <label className="check" style={{ alignSelf: "end", paddingBottom: 8 }} title="Receiving asks for the Lot / Batch # and expiration date, and they go onto the spreadsheet.">
        <input type="checkbox" name="track_lots" defaultChecked={p ? Boolean(p.track_lots) : false} /> Track lot &amp; expiration
      </label>
    </div>
  );
}

export default async function ProductsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = searchSafe(sp.q);
  const { supabase } = await requireAdmin();
  let query = supabase.from("products").select("*").order("active", { ascending: false }).order("sort").order("name").limit(1000);
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
  const [{ data }, { data: catData }] = await Promise.all([query, supabase.from("categories").select("*").order("sort")]);
  const all = (data ?? []) as Product[];
  const cats = (catData ?? []) as Category[];
  const catName = new Map(cats.map((c) => [c.id, c]));
  const today = todayCentral();

  // Left: categories with counts. Right: the products in the one picked, photo first.
  const c = sp.c && (sp.c === "none" || catName.has(sp.c)) ? sp.c : "all";
  const f = sp.f === "photo" || sp.f === "price" ? sp.f : "all";
  const inCat = (p: Product) => c === "all" || (c === "none" ? !p.category_id : p.category_id === c);
  const noPrice = (p: Product) => p.list_price === null && !(p.customer_priced ?? (p.category_id ? catName.get(p.category_id)?.customer_priced : false));
  const products = all.filter((p) => inCat(p) && (f === "all" || (f === "photo" ? !p.image_url : noPrice(p))));
  const active = all.filter((p) => p.active);
  const withPhoto = active.filter((p) => p.image_url).length;
  const counts = new Map<string, number>();
  for (const p of all) counts.set(p.category_id ?? "none", (counts.get(p.category_id ?? "none") ?? 0) + 1);
  const href = (o: { c?: string; f?: string; q?: string }) => {
    const u = new URLSearchParams();
    const cc = o.c ?? c;
    const ff = o.f ?? f;
    const qq = o.q ?? q;
    if (cc !== "all") u.set("c", cc);
    if (ff !== "all") u.set("f", ff);
    if (qq) u.set("q", qq);
    const s = u.toString();
    return `/admin/products${s ? `?${s}` : ""}`;
  };
  const noPhotoN = all.filter((p) => inCat(p) && !p.image_url).length;
  const noPriceN = all.filter((p) => inCat(p) && noPrice(p)).length;

  return (
    <main className="shell wide">
      <div className="o2 prd">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/admin" className="o2-back" aria-label="Back to Admin"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>Products &amp; pricing</h1>
              <span className="o2-sub">{active.length} in the catalog · {withPhoto} with a photo</span>
            </div>
          </div>
          <div className="o2-head-r">
            <Link href={`${href({})}${href({}).includes("?") ? "&" : "?"}add=1#add`} className="b2 sm"><Plus size={17} /> Add product</Link>
            <MoreMenu label="More: photos, import from Excel or CSV, categories">
              <Link className="menu2-i" href={`${href({})}${href({}).includes("?") ? "&" : "?"}photos=1#photos`}><Images size={18} /> Upload photos</Link>
              <Link className="menu2-i" href="/admin/products/afcat"><Images size={18} /> Photos from AFCAT</Link>
              <Link className="menu2-i" href="/admin/products/adc-photos"><Images size={18} /> ADC photos from app photos</Link>
              <Link className="menu2-i" href={`${href({})}${href({}).includes("?") ? "&" : "?"}import=1#import`}><FileSpreadsheet size={18} /> Import from Excel or CSV</Link>
              <Link className="menu2-i" href={`${href({})}${href({}).includes("?") ? "&" : "?"}cats=1#cats`}><Tags size={18} /> Categories</Link>
            </MoreMenu>
          </div>
        </div>

        <details className="card2 prd-photos" id="photos" open={sp.photos === "1" || withPhoto === 0}>
          <summary>
            <span className="prd-photos-ic"><Images size={20} /></span>
            <span className="prd-photos-b">
              <b>Product photos</b>
              <span>{withPhoto} of {active.length} products have one</span>
            </span>
            <span className="prd-bar" aria-hidden="true"><span style={{ width: `${active.length ? Math.round((withPhoto / active.length) * 100) : 0}%` }} /></span>
            <Help label="How photos work">
              Name each photo with the product&apos;s SKU (336508.jpg), pick them all at once and press Upload. A new photo replaces the old
              one. Photos are saved big and sharp so staff and customers can zoom in.
            </Help>
            <ChevronDown size={18} className="prd-chev" aria-hidden="true" />
          </summary>
          <div className="prd-photos-in">
            <div className="prd-up">
              <b>App photos <span className="faint">(AMBIT logo)</span></b>
              <span className="small muted">Staff and contractors see these in AMBIT Intelligence. Folder: AMBIT PHOTOS - UPLOAD THESE.</span>
              <BulkPhotoUpload skus={all.map((p) => p.sku)} />
            </div>
            <div className="prd-up">
              <b>ADC web store photos <span className="faint">(ADC logo)</span> · {active.filter((p) => (p as { adc_image_url?: string | null }).adc_image_url).length} of {active.length}</b>
              <span className="small muted">Guests see these on the ADC store. Folder: ADC PHOTOS - UPLOAD THESE.</span>
              <BulkPhotoUpload skus={all.map((p) => p.sku)} store="adc" />
            </div>
          </div>
        </details>

        <div className="prd-grid">
          <nav className="prd-cats" aria-label="Categories">
            <Link href={href({ c: "all" })} className={c === "all" ? "on" : undefined} aria-current={c === "all" ? "true" : undefined}><span>All products</span><span>{all.length}</span></Link>
            {cats.map((x) => (
              <Link key={x.id} href={href({ c: x.id })} className={c === x.id ? "on" : undefined} aria-current={c === x.id ? "true" : undefined}>
                <span>{x.name}</span><span>{counts.get(x.id) ?? 0}</span>
              </Link>
            ))}
            {counts.get("none") ? (
              <Link href={href({ c: "none" })} className={c === "none" ? "on" : undefined} aria-current={c === "none" ? "true" : undefined}><span>No category</span><span>{counts.get("none")}</span></Link>
            ) : null}
          </nav>

          <div className="prd-main">
            <div className="prd-bar2">
              <form action="/admin/products" className="stk-search" role="search">
                <Search size={18} aria-hidden="true" />
                {c !== "all" ? <input type="hidden" name="c" value={c} /> : null}
                {f !== "all" ? <input type="hidden" name="f" value={f} /> : null}
                <input type="search" name="q" defaultValue={q} placeholder="Search name or SKU" aria-label="Search products" />
              </form>
              <nav className="seg2" aria-label="Show">
                <Link href={href({ f: "all" })} className={f === "all" ? "on" : undefined}>All</Link>
                <Link href={href({ f: "photo" })} className={f === "photo" ? "on" : undefined}>No photo <span className="stk-n">{noPhotoN}</span></Link>
                <Link href={href({ f: "price" })} className={f === "price" ? "on" : undefined}>No price <span className="stk-n">{noPriceN}</span></Link>
              </nav>
            </div>

            <div className="card2 prd-list">
              <div className="prd-row prd-cols" aria-hidden="true">
                <span>Photo</span><span>Product</span><span className="c-unit">Unit</span><span className="c-price">Price</span><span />
              </div>
              {products.length === 0 ? <div className="prd-empty">{q ? `Nothing matches “${q}”.` : "Nothing here."}</div> : null}
              {products.map((p) => {
                const cat = p.category_id ? catName.get(p.category_id) : undefined;
                const cp = p.customer_priced ?? cat?.customer_priced ?? false;
                return (
                  <details key={p.id} className="prd-item" open={products.length === 1}>
                    <summary className="prd-row" style={{ opacity: p.active ? 1 : 0.55 }}>
                      <ProductPhoto src={p.image_url} alt={p.name} size={72} />
                      <span className="prd-name">
                        <b>{p.name}{p.active ? "" : " (hidden)"}</b>
                        <span>{p.sku}{c === "all" ? ` · ${cat?.name ?? "No category"}` : ""}{p.admin_only || cat?.admin_only ? " · private label" : ""}{p.track_lots ? ` · lot & exp${p.shelf_life_months ? ` (${p.shelf_life_months} mo)` : ""}` : ""}</span>
                      </span>
                      <span className="c-unit">{p.unit}</span>
                      <span className="c-price">
                        {saleOn(p.sale_price, p.sale_ends, today) ? (
                          <span className="prd-sale"><b>{money(Number(p.sale_price))}</b><span className="pill2 err sm">Sale{p.sale_ends ? ` to ${p.sale_ends.slice(5).replace("-", "/")}` : ""}</span></span>
                        ) : cp ? <span className="pill2 sm">Customer pricing</span> : p.list_price !== null ? <b>{money(p.list_price)}</b> : <span className="faint">On invoice</span>}
                      </span>
                      <ChevronDown size={18} className="prd-chev" aria-hidden="true" />
                    </summary>
                    <div className="prd-open">
                      <ProductPhotoField sku={p.sku} url={p.image_url} name={p.name} />
                      <form action={saveProduct} className="col prd-form">
                        <input type="hidden" name="id" value={p.id} />
                        <ProductFields p={p} cats={cats} />
                        <div className="row wrap">
                          <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Show in catalog</label>
                          <label className="check" title="Only admins ever see a private label product: not staff, not customers.">
                            <input type="checkbox" name="admin_only" defaultChecked={Boolean(p.admin_only)} /> Private label (admins only){cat?.admin_only ? " · its whole group is private" : ""}
                          </label>
                          <Submit className="b2 sm">Save</Submit>
                        </div>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </div>

        <details className="card2 prd-more" id="add" open={sp.add === "1"}>
          <summary><Plus size={18} /> <b>Add one product</b><ChevronDown size={18} className="prd-chev" aria-hidden="true" /></summary>
          <form action={saveProduct} className="col prd-more-in">
            <ProductFields cats={cats} />
            <div><Submit className="b2 sm">Add product</Submit></div>
          </form>
        </details>

        <details className="card2 prd-more" id="import" open={sp.import === "1"}>
          <summary><FileSpreadsheet size={18} /> <b>Import from Excel or CSV</b><ChevronDown size={18} className="prd-chev" aria-hidden="true" /></summary>
          <div className="prd-more-in"><CsvImport kind="products" /></div>
        </details>

        <details className="card2 prd-more" id="cats" open={sp.cats === "1"}>
          <summary><Tags size={18} /> <b>Categories</b> <span className="faint small">customer pricing, and which sales goal each one counts toward</span><ChevronDown size={18} className="prd-chev" aria-hidden="true" /></summary>
          <div className="col prd-more-in">
            {cats.map((x) => (
              <form key={x.id} action={saveCategory} className="row wrap" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={x.id} />
                <input className="input sm" name="name" defaultValue={x.name} style={{ maxWidth: 220 }} />
                <input className="input sm" name="sort" type="number" defaultValue={x.sort} style={{ width: 80 }} aria-label="Sort" />
                <label className="check"><input type="checkbox" name="customer_priced" defaultChecked={x.customer_priced} /> Customer pricing</label>
                <select className="select sm" name="goal_group" defaultValue={x.goal_group ?? "supplies"} aria-label="Sales goal group" style={{ width: "auto" }}>
                  {GOAL_GROUPS.map((g) => <option key={g.key} value={g.key}>Goal: {g.label}</option>)}
                </select>
                <Submit className="b2 sm quiet">Save</Submit>
              </form>
            ))}
            <form action={saveCategory} className="row wrap" style={{ gap: 10 }}>
              <input className="input sm" name="name" placeholder="New category" style={{ maxWidth: 220 }} />
              <input className="input sm" name="sort" type="number" defaultValue={cats.length + 1} style={{ width: 80 }} aria-label="Sort" />
              <label className="check"><input type="checkbox" name="customer_priced" /> Customer pricing</label>
              <select className="select sm" name="goal_group" defaultValue="supplies" aria-label="Sales goal group" style={{ width: "auto" }}>
                {GOAL_GROUPS.map((g) => <option key={g.key} value={g.key}>Goal: {g.label}</option>)}
              </select>
              <Submit className="b2 sm">Add</Submit>
            </form>
          </div>
        </details>
      </div>
    </main>
  );
}
