import { notFound, redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { getWorkspace } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { DEFAULT_SETTINGS } from "@/lib/ops/defaults";
import { catalogProducts, linesFromTakeoff, loadProducts, loadQuote, quoteParams } from "@/lib/ops/quotes";
import { priceLines, type QLine, type QProduct } from "@/lib/ops/quote-calc";
import { materialNeeds, type CatalogItem } from "@/lib/ops/materials";
import { TopBar } from "@/components/ui";
import { MaterialList } from "./material-list";

export const metadata = { title: "Material order" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** What a quote (one option) or a takeoff needs from AMBIT, ready to drop into an order. */
export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const s = await requireActive();
  const w = await getWorkspace();
  const ws = w?.ws ?? null;
  const supabase = s.supabase;
  const staff = can(s.profile, "takeoff");
  if (!(ws && opsCan.order(ws.role)) && !staff) redirect("/");

  let title = "Material order";
  let back = "/ops/quotes";
  let lines: QLine[] = [];
  let products: QProduct[] = [];
  const settings = ws?.settings ?? DEFAULT_SETTINGS;

  if (sp.quote && UUID.test(sp.quote) && ws) {
    const loaded = await loadQuote(supabase, sp.quote);
    if (!loaded) notFound();
    const q = loaded.quote;
    const opt = loaded.options.find((o) => o.id === sp.option) ?? loaded.options.find((o) => o.id === q.signed_option_id) ?? loaded.options[0];
    products = await loadProducts(supabase, ws.company.id);
    const addons = q.status === "signed" ? new Set(q.signed_addons ?? []) : new Set<string>();
    lines = loaded.lines.filter((l) => l.option_id === opt?.id || (l.option_id === null && addons.has(l.id)));
    lines = priceLines(lines, new Map(products.map((p) => [p.id, p])), settings, quoteParams(q, settings));
    title = `Materials for quote #${q.number}${loaded.options.length > 1 && opt ? ` (${opt.name})` : ""}`;
    back = `/ops/quotes/${q.id}`;
  } else if (sp.takeoff && UUID.test(sp.takeoff)) {
    const { data: t } = await supabase.from("takeoffs").select("id, name, company_id, ops_company_id").eq("id", sp.takeoff).maybeSingle();
    if (!t) notFound();
    products = t.ops_company_id && ws ? await loadProducts(supabase, ws.company.id) : await catalogProducts(supabase, t.company_id);
    const r = await linesFromTakeoff(supabase, t.id, products, settings);
    lines = priceLines(r.lines, new Map(products.map((p) => [p.id, p])), settings, { price_level: "retail", target_margin: null, floor_margin: null, burden_pct: null, tax_rate: null, tax_labor: false, tax_exempt: false, deposit_pct: null, min_job: null });
    title = `Materials for ${t.name}`;
    back = `/takeoff/${t.id}`;
  } else {
    redirect(ws ? "/ops/quotes" : "/takeoff");
  }

  const { data: cat } = await supabase.from("products").select("id, sku, name, unit").eq("active", true);
  const catalog = new Map(((cat ?? []) as CatalogItem[]).map((c) => [c.sku.trim().toUpperCase(), c]));
  const needs = materialNeeds(lines, new Map(products.map((p) => [p.id, p])), catalog);
  return (
    <main className="shell">
      <TopBar title="Material order" back={back} />
      <MaterialList title={title} needs={needs} staff={staff && !ws} />
    </main>
  );
}
