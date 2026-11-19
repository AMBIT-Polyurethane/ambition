import { CircleAlert, CircleCheck } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { saleOn } from "@/lib/sale";
import { priceRules } from "@/lib/price-requests";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { FloorPrices } from "@/components/floor-prices";
import { saveRules } from "../native-actions";

export const metadata = { title: "Price request rules" };
export const dynamic = "force-dynamic";

/** Admins: when the app approves a price request by itself, and each product's floor price. */
export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [rules, { data: cats }, { data: prods }, floorsRes, who] = await Promise.all([
    priceRules(supabase),
    supabase.from("categories").select("id, name").order("sort"),
    supabase.from("products").select("id, sku, name, unit, list_price, sale_price, sale_ends, category_id, admin_only").eq("active", true).order("name"),
    supabase.from("price_floors").select("product_id, floor"),
    supabase.from("profiles").select("full_name, email, role, perms").eq("status", "active").eq("demo", false).in("role", ["admin", "employee"]),
  ]);
  const people = ((who.data ?? []) as { full_name: string | null; email: string; role: string; perms: string[] | null }[]).filter((p) => p.role === "admin" || (p.perms ?? []).includes("prf_approve"));
  const names = Array.from(new Set([rules.score_auto.approver, ...people.map((p) => p.full_name || p.email)].filter(Boolean))).sort();
  const floors = Object.fromEntries(((floorsRes.data ?? []) as { product_id: string; floor: number }[]).map((f) => [f.product_id, Number(f.floor)]));
  type P = { id: string; sku: string; name: string; unit: string; list_price: number | null; sale_price: number | null; sale_ends: string | null; category_id: string | null; admin_only?: boolean | null };
  const categories = (cats ?? []) as { id: string; name: string }[];
  return (
    <main className="shell">
      <TopBar title="Price request rules" back="/price-requests/approvals" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      {floorsRes.error ? <div className="alert warn small">This needs the 0066 database update first.</div> : null}
      <form action={saveRules} className="card col" style={{ gap: 12 }}>
        <div className="rules-score">
          <label className="check">
            <input type="checkbox" name="score_on" defaultChecked={rules.score_auto.enabled} /> <b>Approve automatically when the quality score is high</b>
          </label>
          <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            <span className="small">Score of</span>
            <input className="input sm" style={{ width: 70, textAlign: "right" }} name="score_min" inputMode="numeric" defaultValue={rules.score_auto.min} aria-label="Lowest score that is approved automatically" />
            <span className="small">or better, approved as</span>
            <select className="select sm" name="score_by" defaultValue={rules.score_auto.approver} style={{ width: "auto", minWidth: 180 }} aria-label="Approved in this person's name">
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <span className="tiny muted">
            When a rep sends a price request, the app scores it right away (the same score you see on each request). At or above this score,
            every line is approved at the price asked and the rep is emailed. Below it, it waits for a manager like always.
          </span>
        </div>
        <label className="check">
          <input type="checkbox" name="enabled" defaultChecked={rules.enabled} /> <b>Approve price requests automatically when they meet these rules</b>
        </label>
        <span className="tiny muted">
          A line is approved right away when its price is (1) not under the product&apos;s floor price, and (2) no more than the % below list price set here.
          Products with no list price (spray foam, account pricing) are approved only at or above their floor price. Anything else goes to a manager.
        </span>
        <div className="grid2">
          <label className="field"><span className="label">Most % under list (any product)</span><input className="input sm" name="max_pct" inputMode="decimal" defaultValue={rules.max_pct} /></label>
          <label className="field"><span className="label">Most lines per request for automatic approval</span><input className="input sm" name="max_lines" inputMode="numeric" defaultValue={rules.max_lines} /></label>
        </div>
        <div className="field">
          <span className="label">By product group (blank = the % above)</span>
          <div className="rules-cats">
            {categories.map((c) => (
              <div key={c.id} className="rules-cat">
                <span className="small grow">{c.name}</span>
                <input className="input sm" style={{ width: 70, textAlign: "right" }} name={`cat:${c.id}`} inputMode="decimal" defaultValue={rules.cat_pct[c.id] ?? ""} placeholder={String(rules.max_pct)} aria-label={`Most % under list for ${c.name}`} />
                <span className="tiny faint">%</span>
                <label className="check tiny"><input type="checkbox" name={`never:${c.id}`} defaultChecked={rules.never.includes(c.id)} /> Always a manager</label>
              </div>
            ))}
          </div>
        </div>
        <Submit className="btn" pendingText="Saving…">Save rules</Submit>
      </form>
      <FloorPrices
        categories={categories}
        products={((prods ?? []) as P[]).filter((p) => !p.admin_only).map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, cat: p.category_id, list: saleOn(p.sale_price, p.sale_ends) ? Number(p.sale_price) : p.list_price === null ? null : Number(p.list_price) }))}
        floors={floors}
      />
    </main>
  );
}
