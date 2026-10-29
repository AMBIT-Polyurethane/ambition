import Link from "next/link";
import { Check, Lock, Plus, RefreshCw, Search } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { YIELD_DEFAULTS } from "@/lib/ops/defaults";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { addFromCatalog, markProductsReviewed, refreshAmbitCosts, saveProduct } from "../actions";
import { YieldField } from "./yield-field";
import { COVERAGE, chartFor } from "@/lib/ops/coverage";

export const metadata = { title: "Products and AMBIT costs" };
export const dynamic = "force-dynamic";

type P = {
  id: string; product_id: string | null; kind: string; name: string; sku: string | null; unit: string; cost: number | null; cost_source: string; cost_note: string | null;
  yield_bf: number | null; lb_per_set: number | null; r_value: number | null; sqft_per_unit: number | null; waste_pct: number; active: boolean;
  coverage_key: string | null; description: string | null;
};

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: "Spray foam (sets)", kinds: ["foam_oc", "foam_cc", "foam_roof", "foam_other"] },
  { title: "Blown fiberglass", kinds: ["blown"] },
  { title: "Batts", kinds: ["batt"] },
  { title: "Coatings", kinds: ["coating", "intumescent"] },
  { title: "Supplies and other", kinds: ["supply", "bibs_mesh", "removal", "air_seal", "labor", "other"] },
];
const KINDS = [
  { key: "foam_oc", label: "Open cell foam (set)" },
  { key: "foam_cc", label: "Closed cell foam (set)" },
  { key: "foam_roof", label: "Roofing foam (set)" },
  { key: "blown", label: "Blown fiberglass (bag)" },
  { key: "batt", label: "Batts (bag)" },
  { key: "coating", label: "Roof coating" },
  { key: "intumescent", label: "Intumescent coating" },
  { key: "supply", label: "Supply" },
  { key: "other", label: "Other" },
];
const money2 = (n: number | null) => (n === null ? "–" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.manage);
  const q = (sp.q ?? "").trim().replace(/[\\%_,()]/g, " ").slice(0, 60);
  const [{ data }, { data: hits }] = await Promise.all([
    supabase.from("ops_products").select("*").eq("company_id", ws.company.id).order("sort").order("name"),
    q
      ? supabase.from("products").select("id, sku, name, unit, category_id, categories!inner(ops_quotable, name)").eq("active", true).eq("categories.ops_quotable", true).or(`name.ilike.%${q}%,sku.ilike.%${q}%`).order("name").limit(25)
      : Promise.resolve({ data: [] }),
  ]);
  const products = (data ?? []) as P[];
  const have = new Set(products.map((p) => p.product_id).filter(Boolean));
  const reviewed = !!(((ws.company.ops_settings ?? {}) as Record<string, unknown>).reviewed as Record<string, boolean> | undefined)?.products;

  return (
    <SettingsShell title="Products and AMBIT costs" sp={sp} wide>
      <p className="muted small" style={{ margin: 0 }}>
        Your foam sets and fiberglass are loaded from AMBIT, with costs from your own AMBIT invoices (locked, so job costing stays true). Products from other brands are priced by you.
      </p>
      <div className="row wrap" style={{ gap: 8 }}>
        <form action={refreshAmbitCosts}><Submit className="btn sm dark" pendingText="Checking…"><RefreshCw size={15} /> Update from my latest AMBIT invoices</Submit></form>
        {!reviewed ? <form action={markProductsReviewed}><Submit className="btn sm" pendingText="…"><Check size={15} /> These look right</Submit></form> : null}
      </div>

      {GROUPS.map((g) => {
        const list = products.filter((p) => g.kinds.includes(p.kind));
        if (!list.length) return null;
        return (
          <section key={g.title} className="col" style={{ gap: 8 }}>
            <div className="eyebrow">{g.title}</div>
            <div className="list">
              {list.map((p) => {
                const foam = p.kind.startsWith("foam");
                const standard = p.kind === "foam_oc" ? YIELD_DEFAULTS.foam_oc : p.kind === "foam_cc" ? YIELD_DEFAULTS.foam_cc : p.kind === "foam_roof" ? YIELD_DEFAULTS.foam_roof : null;
                const chart = p.kind === "blown" ? chartFor(p.coverage_key) : null;
                const perLb = foam && p.cost !== null && p.lb_per_set ? Number(p.cost) / Number(p.lb_per_set) : null;
                return (
                  <details key={p.id} className={`ops-prod${p.active ? "" : " off"}`}>
                    <summary className="item">
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="t ellipsis">{p.name}{!p.active ? <span className="pill grey" style={{ marginLeft: 8 }}>Hidden</span> : null}</div>
                        <div className="s ellipsis">
                          {[p.sku, foam && p.yield_bf ? `${Number(p.yield_bf).toLocaleString()} bd ft/set` : null, p.kind === "batt" && p.sqft_per_unit ? `${Number(p.sqft_per_unit)} sq ft/bag` : null, chart ? `${chart.maker} coverage chart` : p.kind === "blown" ? "No coverage chart" : null, `waste ${Number(p.waste_pct)}%`].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <span className="col tight" style={{ alignItems: "flex-end", flex: "none" }}>
                        <b>{money2(p.cost)}<span className="tiny faint"> /{p.unit}</span></b>
                        {perLb ? <span className="tiny faint">${perLb.toFixed(2)}/lb</span> : null}
                        {p.cost_source === "ambit" ? <span className="tiny faint"><Lock size={11} /> AMBIT invoice</span> : null}
                      </span>
                    </summary>
                    <form action={saveProduct} className="ops-prod-form">
                      <input type="hidden" name="id" value={p.id} />
                      <label className="field">
                        <span className="label">Name</span>
                        <input className="input sm" name="name" defaultValue={p.name} maxLength={120} />
                      </label>
                      <div className="grid3">
                        {p.cost_source === "ambit" ? (
                          <div className="field">
                            <span className="label">Cost per {p.unit}</span>
                            <span className="small"><Lock size={12} /> {money2(p.cost)} <span className="tiny faint">{p.cost_note}</span></span>
                          </div>
                        ) : (
                          <label className="field">
                            <span className="label">Cost per {p.unit}</span>
                            <input className="input sm" name="cost" inputMode="decimal" defaultValue={p.cost ?? ""} placeholder="$" />
                            {p.cost_note ? <span className="tiny faint">{p.cost_note}</span> : null}
                          </label>
                        )}
                        <label className="field">
                          <span className="label">Waste %</span>
                          <input className="input sm" name="waste_pct" inputMode="decimal" defaultValue={Number(p.waste_pct)} />
                        </label>
                        {foam ? (
                          <label className="field">
                            <span className="label">Pounds per set</span>
                            <input className="input sm" name="lb_per_set" inputMode="decimal" defaultValue={p.lb_per_set ?? ""} />
                          </label>
                        ) : null}
                        {p.kind === "batt" ? (
                          <>
                            <label className="field">
                              <span className="label">Sq ft per bag</span>
                              <input className="input sm" name="sqft_per_unit" inputMode="decimal" defaultValue={p.sqft_per_unit ?? ""} />
                            </label>
                            <label className="field">
                              <span className="label">R-value</span>
                              <input className="input sm" name="r_value" inputMode="decimal" defaultValue={p.r_value ?? ""} />
                            </label>
                          </>
                        ) : null}
                      </div>
                      {foam ? <YieldField value={p.yield_bf === null ? null : Number(p.yield_bf)} standard={standard} /> : null}
                      {p.kind === "blown" ? (
                        <>
                          <label className="field">
                            <span className="label">Coverage chart</span>
                            <select className="select sm" name="coverage_key" defaultValue={p.coverage_key ?? ""}>
                              <option value="">None</option>
                              {COVERAGE.map((c) => <option key={c.key} value={c.key}>{c.maker} {c.product}</option>)}
                            </select>
                          </label>
                          {chart ? (
                            <div className="ops-chart">
                              <table className="ops-table tight">
                                <thead><tr><th>R-value</th><th>Bags / 1,000 sq ft</th><th>Sq ft / bag</th><th>Inches</th></tr></thead>
                                <tbody>{chart.attic.map((r) => <tr key={r.r}><td>R-{r.r}</td><td>{r.bags_per_1000}</td><td>{r.sqft_per_bag}</td><td>{r.inches}</td></tr>)}</tbody>
                              </table>
                              {chart.walls.length ? (
                                <table className="ops-table tight">
                                  <thead><tr><th>Walls</th><th>R-value</th><th>Density</th><th>Bags / 1,000 sq ft</th></tr></thead>
                                  <tbody>{chart.walls.map((w, i) => <tr key={i}><td>{w.framing}</td><td>R-{w.r}</td><td>{w.pcf} lb/cu ft</td><td>{w.bags_per_1000}</td></tr>)}</tbody>
                                </table>
                              ) : null}
                              <span className="tiny faint">{chart.source}. {chart.note ?? ""}</span>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      <label className="field">
                        <span className="label">What customers read on the proposal (optional)</span>
                        <input className="input sm" name="description" defaultValue={p.description ?? ""} maxLength={400} placeholder="e.g. AMBI-SEAL 5.0 open cell spray foam, Class 1 fire rated" />
                      </label>
                      <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Show this product on quotes</label>
                      <Submit className="btn sm dark" pendingText="Saving…">Save</Submit>
                    </form>
                  </details>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="card col" style={{ gap: 10 }}>
        <b>Add from the AMBIT catalog</b>
        <span className="tiny faint">Supplies (plastic, foam baffles, mesh, tape), coatings and fiberglass. Gun parts and tools aren&apos;t quotable.</span>
        <form className="search" action="/ops/settings/products">
          <Search size={18} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Search AMBIT products" aria-label="Search the AMBIT catalog" />
        </form>
        {q ? (
          ((hits ?? []) as unknown as { id: string; sku: string; name: string; unit: string; categories: { name: string } }[]).length ? (
            <div className="list">
              {((hits ?? []) as unknown as { id: string; sku: string; name: string; unit: string; categories: { name: string } }[]).map((h) => (
                <form key={h.id} action={addFromCatalog} className="item">
                  <input type="hidden" name="product_id" value={h.id} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t ellipsis">{h.name}</div>
                    <div className="s ellipsis">{h.sku} · {h.categories?.name} · per {h.unit}</div>
                  </div>
                  {have.has(h.id) ? <span className="pill ok">Added</span> : <Submit className="btn sm" pendingText="…"><Plus size={14} /> Add</Submit>}
                </form>
              ))}
            </div>
          ) : (
            <span className="small muted">Nothing in the AMBIT catalog matches.</span>
          )
        ) : null}
      </section>

      <details className="card">
        <summary className="small"><b><Plus size={15} style={{ verticalAlign: -3 }} /> Add a product from another brand</b></summary>
        <form action={saveProduct} className="ops-prod-form">
          <div className="grid2">
            <label className="field">
              <span className="label">Type</span>
              <select className="select sm" name="kind" defaultValue="supply">
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">Name</span>
              <input className="input sm" name="name" required maxLength={120} placeholder="Owens Corning ProPink L77" />
            </label>
            <label className="field">
              <span className="label">Sold by the</span>
              <input className="input sm" name="unit" defaultValue="bag" maxLength={12} />
            </label>
            <label className="field">
              <span className="label">Your cost per unit</span>
              <input className="input sm" name="cost" inputMode="decimal" placeholder="$" />
            </label>
            <label className="field">
              <span className="label">Waste %</span>
              <input className="input sm" name="waste_pct" inputMode="decimal" defaultValue="10" />
            </label>
            <label className="field">
              <span className="label">SKU (optional)</span>
              <input className="input sm" name="sku" maxLength={40} />
            </label>
          </div>
          <input type="hidden" name="active" value="on" />
          <Submit className="btn sm" pendingText="Adding…">Add product</Submit>
        </form>
      </details>
      <span className="tiny faint">Labor isn&apos;t a product: set what you pay crews in <Link href="/ops/settings/pricing" className="linkbtn tiny">Pricing, margins and labor</Link>.</span>
    </SettingsShell>
  );
}
