import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { inventoryBranches } from "@/lib/widgets";
import { every } from "@/lib/inventory/pages";
import { dateShort, money } from "@/lib/format";
import { saleOn, todayCentral } from "@/lib/sale";
import { Empty, TopBar } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ReportTable } from "@/components/inventory/report-table";

export const metadata = { title: "Sell Price List" };
export const dynamic = "force-dynamic";

type Prod = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  list_price: number | null;
  sale_price: number | null;
  sale_ends: string | null;
  customer_priced: boolean | null;
  category_id: string | null;
  admin_only: boolean | null;
  sort: number;
};
type Cat = { id: string; name: string; sort: number; customer_priced: boolean; admin_only?: boolean | null };
type Inv = { branch_id: string; product_id: string; sell_price: number | null };
type Cell = string | number | null;

/**
 * Sell Price List: every active SKU and what the app sells it for, the same way the order screen prices it: a sale
 * price while a sale runs, "Account pricing" for items priced per customer (spray foam), otherwise the list price,
 * or no price ("Price confirmed on invoice"). Pick a location to see only what's on its spreadsheet, with the
 * spreadsheet's own Sell Price beside the app's (differences highlighted). Private label items: admins only (the
 * database hides them from everyone else).
 */
export default async function SellPriceListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!isEmployee(profile)) redirect("/");
  const today = todayCentral();
  const live = await inventoryBranches(supabase, profile, { all: true });
  const pick = live.find((b) => b.id === sp.b) ?? null;

  const [prods, { data: catRows }, inv, { data: parentRows }] = await Promise.all([
    every<Prod>((a, z) =>
      supabase
        .from("products")
        .select("id, sku, name, unit, list_price, sale_price, sale_ends, customer_priced, category_id, admin_only, sort")
        .eq("active", true)
        .order("sort")
        .order("name")
        .range(a, z),
    ),
    supabase.from("categories").select("*").order("sort"),
    live.length
      ? every<Inv>((a, z) =>
          supabase
            .from("inventory")
            .select("branch_id, product_id, sell_price")
            .eq("on_sheet", true)
            .in("branch_id", live.map((b) => b.id))
            .order("branch_id")
            .order("product_id")
            .range(a, z),
        )
      : Promise.resolve([] as Inv[]),
    supabase.rpc("stock_parents"),
  ]);
  const cats = (catRows ?? []) as Cat[];
  const catOf = new Map(cats.map((c) => [c.id, c]));
  const catRank = new Map(cats.map((c, i) => [c.id, i]));
  // A brand stocked under what the store sells (ISO-COVESTRO under ISO A-Side) counts as that item at a location.
  const parentOf = new Map(((parentRows ?? []) as { product_id: string; parent_id: string }[]).map((r) => [r.product_id, r.parent_id]));
  const where = new Map<string, Set<string>>(); // product → locations that carry it
  const sheet = new Map<string, number>(); // `${branch}|${product}` → that spreadsheet's Sell Price
  for (const r of inv) {
    const pid = parentOf.get(r.product_id) ?? r.product_id;
    (where.get(pid) ?? where.set(pid, new Set()).get(pid)!).add(r.branch_id);
    if (r.sell_price !== null && Number(r.sell_price) > 0 && !sheet.has(`${r.branch_id}|${pid}`)) sheet.set(`${r.branch_id}|${pid}`, Number(r.sell_price));
  }
  const nameOf = new Map(live.map((b) => [b.id, b.name]));
  const order = new Map(live.map((b, i) => [b.id, i]));

  const list = prods
    .filter((p) => !pick || where.get(p.id)?.has(pick.id))
    .sort(
      (a, b) =>
        (catRank.get(a.category_id ?? "") ?? 999) - (catRank.get(b.category_id ?? "") ?? 999) ||
        a.sort - b.sort ||
        a.sku.localeCompare(b.sku, undefined, { numeric: true }),
    );

  let onSale = 0;
  let account = 0;
  let none = 0;
  let differ = 0;
  const rows: Cell[][] = [];
  const flag: boolean[] = [];
  for (const p of list) {
    const cat = p.category_id ? catOf.get(p.category_id) : undefined;
    const list$ = p.list_price !== null && Number(p.list_price) > 0 ? Number(p.list_price) : null;
    const sale = saleOn(p.sale_price, p.sale_ends, today);
    const cp = !sale && (p.customer_priced ?? cat?.customer_priced ?? false);
    const price = sale ? Number(p.sale_price) : cp ? null : list$;
    const type = sale ? "Sale" : cp ? "Account pricing" : list$ === null ? "No price set" : "List";
    const notes: string[] = [];
    if (sale) {
      onSale++;
      notes.push(`On sale ${p.sale_ends ? `through ${p.sale_ends}` : "until it's taken off"}${list$ !== null ? `; regular ${money(list$)}` : ""}`);
    } else if (cp) {
      account++;
      if (list$ !== null) notes.push(`List ${money(list$)}`);
    } else if (list$ === null) {
      none++;
      notes.push("Orders show “Price confirmed on invoice”");
    }
    if (p.admin_only || cat?.admin_only) notes.push("Private label (admins only)");
    const sheet$ = pick ? sheet.get(`${pick.id}|${p.id}`) ?? null : null;
    // A spreadsheet keeps the regular price: during a sale it's checked against the list price.
    const base = sale ? list$ : price;
    const off = pick !== null && sheet$ !== null && base !== null && Math.abs(sheet$ - base) >= 0.005;
    if (off) {
      differ++;
      notes.push(`${pick!.name} spreadsheet says ${money(sheet$)}`);
    }
    const locs = [...(where.get(p.id) ?? [])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).map((b) => nameOf.get(b) ?? b);
    rows.push([
      cat?.name ?? "Other",
      p.sku,
      p.name,
      p.unit,
      // A word where there's no single price, so the column never reads blank.
      price ?? (cp ? "Per customer" : "Not set"),
      type,
      pick ? sheet$ : locs.length ? locs.join(", ") : "Not on a location's spreadsheet",
      notes.join(" · "),
    ]);
    flag.push(off || type === "No price set");
  }

  const head = ["Group", "SKU", "Item", "Unit", "Sell price", "Price type", pick ? `${pick.name} sheet price` : "Locations", "Notes"];
  const num = [false, false, false, false, true, false, Boolean(pick), false];
  const label = pick ? pick.name : "All locations";

  return (
    <main className="shell wide">
      <TopBar title="Sell Price List" back="/reports" right={<span className="no-print"><PrintButton /></span>} />
      <p className="print-only report-print-head">
        <b>AMBIT</b> · {label} · prices as of {dateShort(today)}
      </p>
      {live.length ? (
        <div className="chips no-print" aria-label="Location">
          <Link href="/reports/sell-prices" className={`chip sm${pick ? "" : " on"}`}>All locations</Link>
          {live.map((b) => (
            <Link key={b.id} href={`/reports/sell-prices?b=${b.id}`} className={`chip sm${pick?.id === b.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      <p className="small muted no-print" style={{ margin: 0 }}>
        What the app charges today, the same as the order screen: a sale price while a sale runs, account pricing for items priced per customer, otherwise the list price.
        {pick ? ` Only what's on ${pick.name}'s spreadsheet, with its own Sell Price beside the app's.` : " Pick a location to see only what it carries and compare its spreadsheet's prices."}
      </p>
      <div className="row tiny report-stats" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="pill grey">{rows.length} SKUs</span>
        {onSale ? <span className="pill">{onSale} on sale</span> : null}
        {account ? <span className="pill grey">{account} account pricing</span> : null}
        {none ? <span className="pill warn">{none} with no price</span> : null}
        {pick ? <span className={`pill ${differ ? "warn" : "ok"}`}>{differ ? `${differ} differ from the spreadsheet` : "Spreadsheet prices match"}</span> : null}
      </div>
      {rows.length ? (
        <ReportTable
          key={pick?.id ?? "all"}
          head={head}
          num={num}
          money={num}
          cents
          rows={rows}
          flag={flag}
          fileName={`sell-price-list-${pick ? pick.id : "all-locations"}-${today}.csv`}
        />
      ) : (
        <Empty icon="tag" title="No products to show">{pick ? `Nothing on ${pick.name}'s spreadsheet matches a product in the app yet.` : "Add products in Admin › Products."}</Empty>
      )}
      <p className="tiny faint no-print" style={{ margin: 0 }}>
        Highlighted rows have no price in the app{pick ? " or a different price on the location's spreadsheet" : ""}. Prices are changed in Admin › Products{pick ? " (the app's) or on the spreadsheet's Sell Price column (the location's)" : ""}.
      </p>
    </main>
  );
}
