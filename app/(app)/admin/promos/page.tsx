import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Eye, EyeOff, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { PromoSlideCard } from "@/components/promo-banner";
import { PromoCatalog, PromoForm, type PromoPick } from "@/components/promo-admin";
import { toSlides } from "@/lib/promos";
import { todayCentral } from "@/lib/sale";
import { dateShort } from "@/lib/format";
import type { PromoRow } from "@/lib/promo-themes";
import type { Category, Product } from "@/lib/types";
import { deletePromo, movePromo, savePromo, showPromo } from "./actions";

export const metadata = { title: "Home banner" };
export const dynamic = "force-dynamic";

const WHO = { all: "Everyone", employee: "AMBIT staff", customer: "Contractors" } as const;

export default async function PromosAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data, error }, { data: prodData }, { data: catData }, { data: branchData }] = await Promise.all([
    supabase.from("promos").select("*").order("sort").order("created_at"),
    supabase.from("products").select("*").eq("active", true).order("sort").order("name").limit(2000),
    supabase.from("categories").select("*"),
    supabase.from("branches").select("name, sort").eq("active", true).order("sort"),
  ]);
  const rows = (data ?? []) as PromoRow[];
  const cpByCat = new Map(((catData ?? []) as Category[]).map((c) => [c.id, c.customer_priced]));
  const picks: PromoPick[] = ((prodData ?? []) as Product[]).map((p) => ({
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    list_price: p.list_price === null ? null : Number(p.list_price),
    cp: p.customer_priced ?? (p.category_id ? cpByCat.get(p.category_id) ?? false : false),
    image_url: p.image_url,
    sale_price: p.sale_price == null ? null : Number(p.sale_price),
    sale_ends: p.sale_ends ?? null,
  }));
  const cities = ((branchData ?? []) as { name: string }[]).map((b) => b.name);
  const { slides, products } = await toSlides(supabase, rows);
  const today = todayCentral();

  return (
    <main className="shell">
      <TopBar title="Home banner" back="/admin" />
      <p className="muted small" style={{ margin: 0 }}>
        The slides that scroll across the top of Home. They move on their own every 5 seconds, in this order. Tap a slide on Home to open the product in Order.
      </p>

      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      {error ? (
        <div className="alert warn small">The banner isn&apos;t set up in the database yet. Run supabase/migrations/0015_sales_and_banner.sql in Supabase.</div>
      ) : null}

      <PromoCatalog products={picks} cities={cities}>
        <div className="col" style={{ gap: 18 }}>
          {rows.map((r, i) => {
            const slide = slides[i];
            const p = r.product_id ? products.get(r.product_id) : undefined;
            const status = !r.active
              ? { cls: "grey", text: "Hidden" }
              : !slide
                ? { cls: "red", text: "Product not in catalog" }
                : r.starts_on && r.starts_on > today
                  ? { cls: "warn", text: `Starts ${dateShort(r.starts_on)}` }
                  : r.ends_on && r.ends_on < today
                    ? { cls: "grey", text: "Ended" }
                    : { cls: "ok", text: "Showing" };
            return (
              <section key={r.id} id={`p-${r.id}`} className="card col" style={{ gap: 12 }}>
                <div className="row between wrap" style={{ gap: 8 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <b className="small">Slide {i + 1}</b>
                    <span className={`pill ${status.cls}`}>{status.text}</span>
                    {r.audience !== "all" ? <span className="pill grey">{WHO[r.audience]}</span> : null}
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <form action={movePromo}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button className="iconbtn sm" type="submit" aria-label="Move earlier" disabled={i === 0}><ArrowUp size={16} /></button>
                    </form>
                    <form action={movePromo}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button className="iconbtn sm" type="submit" aria-label="Move later" disabled={i === rows.length - 1}><ArrowDown size={16} /></button>
                    </form>
                    <form action={showPromo}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="on" value={r.active ? "0" : "1"} />
                      <button className="iconbtn sm" type="submit" aria-label={r.active ? "Hide this slide" : "Show this slide"} title={r.active ? "Hide" : "Show"}>
                        {r.active ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </form>
                  </span>
                </div>

                {slide ? (
                  <div className="promo-static" style={{ opacity: r.active ? 1 : 0.55 }}><PromoSlideCard s={slide} /></div>
                ) : (
                  <div className="small muted">This slide&apos;s product was removed or hidden from the catalog, so the slide is skipped. Pick another product below.</div>
                )}

                <details>
                  <summary className="linkbtn small">Edit this slide</summary>
                  <div style={{ marginTop: 14 }}>
                    <PromoForm action={savePromo} row={r} sku={p?.sku} />
                    <form action={deletePromo} style={{ marginTop: 14 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="linkbtn small red"><Trash2 size={13} /> Delete this slide</button>
                    </form>
                  </div>
                </details>
              </section>
            );
          })}

          <details className="card" open={rows.length === 0}>
            <summary><b>+ Add a slide</b></summary>
            <div style={{ marginTop: 14 }}>
              <PromoForm action={savePromo} />
            </div>
          </details>
        </div>
      </PromoCatalog>
    </main>
  );
}
