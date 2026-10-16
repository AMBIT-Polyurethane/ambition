import { requireAdmin } from "@/lib/session";
import { money, searchSafe } from "@/lib/format";
import { TopBar } from "@/components/ui";
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
      <label className="field"><span className="label">Sort</span><input className="input sm" name="sort" type="number" defaultValue={p?.sort ?? 0} /></label>
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
  const products = (data ?? []) as Product[];
  const cats = (catData ?? []) as Category[];
  const catName = new Map(cats.map((c) => [c.id, c]));

  return (
    <main className="shell wide">
      <TopBar title="Products & pricing" back="/admin" />
      <CsvImport kind="products" />

      <details className="card">
        <summary><b>Product photos</b> <span className="small muted">· {products.filter((p) => p.image_url).length} of {products.length} have a photo</span></summary>
        <div style={{ marginTop: 14 }}><BulkPhotoUpload skus={products.map((p) => p.sku)} /></div>
      </details>

      <details className="card">
        <summary><b>Categories</b> <span className="small muted">· choose which show &ldquo;Based on customer pricing&rdquo;</span></summary>
        <div className="col" style={{ marginTop: 14 }}>
          {cats.map((c) => (
            <form key={c.id} action={saveCategory} className="row wrap" style={{ gap: 10 }}>
              <input type="hidden" name="id" value={c.id} />
              <input className="input sm" name="name" defaultValue={c.name} style={{ maxWidth: 220 }} />
              <input className="input sm" name="sort" type="number" defaultValue={c.sort} style={{ width: 80 }} aria-label="Sort" />
              <label className="check"><input type="checkbox" name="customer_priced" defaultChecked={c.customer_priced} /> Customer pricing</label>
              <Submit className="btn sm dark">Save</Submit>
            </form>
          ))}
          <form action={saveCategory} className="row wrap" style={{ gap: 10 }}>
            <input className="input sm" name="name" placeholder="New category" style={{ maxWidth: 220 }} />
            <input className="input sm" name="sort" type="number" defaultValue={cats.length + 1} style={{ width: 80 }} aria-label="Sort" />
            <label className="check"><input type="checkbox" name="customer_priced" /> Customer pricing</label>
            <Submit className="btn sm dark">Add</Submit>
          </form>
        </div>
      </details>

      <details className="card">
        <summary><b>+ Add one product</b></summary>
        <form action={saveProduct} className="col" style={{ marginTop: 14 }}>
          <ProductFields cats={cats} />
          <div><Submit className="btn sm">Add product</Submit></div>
        </form>
      </details>

      <form action="/admin/products"><input className="input sm" name="q" defaultValue={q} placeholder="Search name or SKU" /></form>
      <div className="list">
        {products.map((p) => {
          const cat = p.category_id ? catName.get(p.category_id) : undefined;
          const cp = p.customer_priced ?? cat?.customer_priced ?? false;
          return (
            <details key={p.id}>
              <summary className="item" style={{ minHeight: 56, opacity: p.active ? 1 : 0.5 }}>
                {p.image_url ? <img className="thumb sm" src={p.image_url} alt="" loading="lazy" /> : <div className="thumb sm empty" />}
                <div className="grow">
                  <div className="t ellipsis">{p.name}{p.active ? "" : " (hidden)"}</div>
                  <div className="s ellipsis">{p.sku} · {cat?.name ?? "No category"} · {p.unit}</div>
                </div>
                <span className="small nowrap">{cp ? <span className="cp-tag" style={{ marginTop: 0 }}>Customer pricing</span> : p.list_price !== null ? money(p.list_price) : <span className="faint">On invoice</span>}</span>
              </summary>
              <div style={{ padding: "4px 16px 12px" }}><ProductPhotoField sku={p.sku} url={p.image_url} /></div>
              <form action={saveProduct} className="col" style={{ padding: "0 16px 16px" }}>
                <input type="hidden" name="id" value={p.id} />
                <ProductFields p={p} cats={cats} />
                <div className="row">
                  <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Show in catalog</label>
                  <Submit className="btn sm">Save</Submit>
                </div>
              </form>
            </details>
          );
        })}
      </div>
    </main>
  );
}
