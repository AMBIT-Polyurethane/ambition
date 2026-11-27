import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { todayCentral } from "@/lib/sale";

// Graco and Binks parts (Guns & Parts) can only be ADVERTISED at MSRP (0105). Anyone signed in to an ADC account,
// and every placed order, gets the real price instead: our price, the sale price, or the customer's own price,
// whichever is lowest. Never shown on a public page: only in the signed-in shopper's own store and cart, on their
// order, and to staff.

export type MyPrice = { price: number; sale: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The real price of each MSRP item. `companyId` = an AMBIT customer account (a verified match or the shopper's
 * own link): they get the full sale price and their customer prices. Everyone else gets our price, or the store's
 * sale price (the sale price, but no more than 5% under our price, like every other sale item on ADC).
 */
export async function msrpRealPrices(opts: { companyId?: string | null; productIds?: string[] } = {}): Promise<Map<string, MyPrice>> {
  const out = new Map<string, MyPrice>();
  if (!serviceReady()) return out;
  const db = serviceClient();
  const { data: cats } = await db.from("categories").select("id").eq("adc_msrp", true);
  const catIds = ((cats ?? []) as { id: string }[]).map((c) => c.id);
  if (!catIds.length) return out;
  let q = db.from("products").select("id, list_price").in("category_id", catIds).eq("active", true).limit(5000);
  if (opts.productIds?.length) q = q.in("id", opts.productIds);
  const { data: prods } = await q;
  const list = (prods ?? []) as { id: string; list_price: number | null }[];
  if (!list.length) return out;
  const ids = list.map((p) => p.id);
  const today = todayCentral();

  // Our price: the list price, else the highest Sell Price on a location's stock list (like the store does).
  const noList = list.filter((p) => p.list_price === null).map((p) => p.id);
  const sheet = new Map<string, number>();
  if (noList.length) {
    const { data: inv } = await db.from("inventory").select("product_id, sell_price").in("product_id", noList).gt("sell_price", 0).limit(10000);
    for (const r of (inv ?? []) as { product_id: string; sell_price: number }[]) sheet.set(r.product_id, Math.max(sheet.get(r.product_id) ?? 0, Number(r.sell_price)));
  }

  // The sale running today, if any.
  const sale = new Map<string, number>();
  const { data: sales } = await db.from("web_sales").select("id, starts_on, ends_on").eq("active", true).lte("starts_on", today).gte("ends_on", today).order("ends_on").limit(1);
  const s = ((sales ?? []) as { id: number }[])[0];
  if (s) {
    const { data: items } = await db.from("web_sale_items").select("product_id, price").eq("sale_id", s.id).in("product_id", ids).not("price", "is", null).limit(10000);
    for (const i of (items ?? []) as { product_id: string; price: number }[]) sale.set(i.product_id, Number(i.price));
  }

  // The customer's own prices (per unit, in effect today).
  const mine = new Map<string, number>();
  if (opts.companyId) {
    const { data: cp } = await db
      .from("customer_prices")
      .select("product_id, price, basis, effective_on, expires_on")
      .eq("company_id", opts.companyId)
      .in("product_id", ids)
      .eq("basis", "unit")
      .lte("effective_on", today)
      .limit(10000);
    for (const r of (cp ?? []) as { product_id: string; price: number; expires_on: string | null }[]) {
      if (r.expires_on && r.expires_on < today) continue;
      mine.set(r.product_id, Number(r.price));
    }
  }

  for (const p of list) {
    const base = p.list_price !== null ? Number(p.list_price) : sheet.get(p.id) ?? null;
    const sp = sale.get(p.id);
    let salePrice: number | null = null;
    if (sp !== undefined && base !== null && sp < base) salePrice = opts.companyId ? sp : Math.max(sp, r2(base * 0.95));
    const own = mine.get(p.id) ?? null;
    const options = [base, salePrice, own].filter((v): v is number => v !== null && v > 0);
    if (!options.length) continue;
    const best = Math.min(...options);
    out.set(p.id, { price: r2(best), sale: salePrice !== null && best === salePrice && (own === null || own > salePrice) });
  }
  return out;
}
