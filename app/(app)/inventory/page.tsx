import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, ChevronRight, ClipboardCheck, FileDown, Hourglass, ScanLine, Tags, Truck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can, hubLock, seesInventory } from "@/lib/access";
import { dateShort, plural } from "@/lib/format";
import { inventoryBranches } from "@/lib/widgets";
import { AGING_DAYS, EXPIRING_DAYS, agingBuckets, loadHub } from "@/lib/inventory/hub";
import { Empty, TopBar } from "@/components/ui";
import { HubNav, hubHome } from "@/components/inventory/hub-nav";
import { BarList, ColumnChart } from "@/components/inventory/charts";

export const metadata = { title: "Inventory Hub" };
export const dynamic = "force-dynamic";

const whole = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The Inventory Hub: how stock is doing at one location or all of them, and where to go next. */
export default async function InventoryHubPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!seesInventory(profile)) redirect("/");
  // Links from before the hub (the stock list's filters and messages) go to the stock list.
  if ((sp.f || sp.msg || sp.err) && can(profile, "inventory")) {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    redirect(`/inventory/stock?${q}`);
  }
  if (!can(profile, "inv_reports")) redirect(hubHome(profile, sp.b) ?? "/");

  const live = await inventoryBranches(supabase, profile);
  // Warehouse managers only ever see their own location.
  const locked = hubLock(profile) !== null;
  if (!live.length) {
    return (
      <main className="shell">
        <TopBar title="Inventory Hub" back="/" />
        {locked ? (
          <Empty icon="boxes" title="Your account isn't set to a location yet">
            Warehouse managers see the Inventory Hub for their own location. An admin sets your location in Admin → Accounts.
          </Empty>
        ) : (
          <Empty icon="boxes" title="No inventory spreadsheet is connected yet">
            {profile.role === "admin" ? <Link href="/admin/inventory">Set it up in Admin → Inventory</Link> : "An admin sets this up in Admin → Inventory."}
          </Empty>
        )}
      </main>
    );
  }
  const pick = locked
    ? live[0].id
    : sp.b === "all" ? "all" : live.find((b) => b.id === sp.b)?.id ?? (live.some((b) => b.id === profile.branch_id) ? profile.branch_id! : "all");
  const hub = await loadHub(supabase, pick === "all" ? "all" : [pick]);
  const k = hub.kpi;
  const name = (id: string) => hub.branches.find((b) => b.id === id)?.name ?? id.toUpperCase();
  const many = hub.scope.length > 1;
  const q = `b=${pick}`;
  const hereBranch = pick === "all" ? (profile.branch_id && live.some((b) => b.id === profile.branch_id) ? profile.branch_id : live[0].id) : pick;

  // Charts
  const weeks = hub.weeks.map((w) => ({ label: w.label, values: [Math.round(w.shipped), Math.round(w.received)] }));
  const cats = hub.categories.slice(0, 7).map((c) => ({ label: c.name, value: Math.round(c.value), note: `${c.items} ${c.items === 1 ? "item" : "items"}` }));
  const rest = hub.categories.slice(7);
  if (rest.length) cats.push({ label: "Everything else", value: Math.round(rest.reduce((s, c) => s + c.value, 0)), note: `${rest.length} more groups` });
  const ages = agingBuckets(hub.items).map((b) => ({ label: b.label, value: Math.round(b.value), note: `${b.items} ${b.items === 1 ? "item" : "items"} in stock` }));

  // Top sellers (ISO brands sell as one item: show it once)
  const seen = new Set<string>();
  const top = hub.items
    .filter((i) => i.soldValue30 > 0)
    .sort((a, z) => z.soldValue30 - a.soldValue30 || z.sold30 - a.sold30)
    .filter((i) => {
      const key = `${i.branch}|${i.parent}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  const expiring = hub.lots.filter((l) => l.days !== null && l.days <= EXPIRING_DAYS).slice(0, 6);
  const toSell = hub.items
    .filter((i) => i.on_hand > 0 && i.idle >= AGING_DAYS)
    .sort((a, z) => z.value - a.value || z.idle - a.idle)
    .slice(0, 6);
  const starts = [...new Set(hub.scope.map((b) => hub.trackingStart[b]))].sort();

  const tile = (href: string, label: string, value: string, sub: React.ReactNode, tone?: "warn" | "err" | "ok") => (
    <Link href={href} className={`hub-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="l">{label}</span>
      <b>{value}</b>
      <span className="s">{sub}</span>
    </Link>
  );

  return (
    <main className="shell wide">
      <TopBar title="Inventory Hub" back="/" howTo="see-stock" />
      <HubNav profile={profile} active="dashboard" branch={pick} />

      {live.length > 1 ? (
        <div className="chips" role="tablist" aria-label="Location">
          <Link href="/inventory?b=all" className={`chip${pick === "all" ? " on" : ""}`}>All locations</Link>
          {live.map((b) => (
            <Link key={b.id} href={`/inventory?b=${b.id}`} className={`chip${b.id === pick ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}

      <section className="hub-kpis" aria-label="Key numbers">
        {tile(`/inventory/reports?r=value&${q}`, "Stock value (estimate)", usd(k.value), k.noPrice ? `${k.noPrice} ${k.noPrice === 1 ? "item has" : "items have"} no value yet` : `${k.pricedItems} items in stock`, k.noPrice ? "warn" : undefined)}
        {tile(
          `/inventory/reports?r=reorder&${q}`,
          "At reorder point",
          whole(k.reorder),
          k.withRop ? `of ${k.withRop} items with a reorder point` : "No reorder points set yet",
          k.reorder ? "warn" : undefined,
        )}
        {tile(
          `/inventory/reports?r=expiring&${q}`,
          `Expiring in ${EXPIRING_DAYS} days`,
          `${k.expiringLots} ${k.expiringLots === 1 ? "lot" : "lots"}`,
          k.expiredLots ? <span className="err-t"><AlertTriangle size={12} /> {k.expiredLots} {k.expiredLots === 1 ? "lot" : "lots"} already expired</span> : usd(k.expiringValue),
          k.expiredLots ? "err" : k.expiringLots ? "warn" : undefined,
        )}
        {tile(`/inventory/reports?r=aging&${q}`, `No sale in ${AGING_DAYS}+ days`, usd(k.agingValue), `${k.agingItems} ${k.agingItems === 1 ? "item" : "items"} to put on sale`, k.agingItems ? "warn" : undefined)}
        {tile(`/inventory/reports?r=movement&${q}`, "Shipped, last 30 days", usd(k.shipped30), "Completed orders")}
        {tile(`/inventory/incoming?b=${hereBranch}`, "Received, last 30 days", usd(k.received30), `${k.expected} ${k.expected === 1 ? "delivery" : "deliveries"} on the way`)}
        {tile(
          `/inventory/reports?r=counts&${q}`,
          "Count accuracy",
          k.accuracy === null ? "—" : `${k.accuracy}%`,
          k.countLines ? `${whole(k.countLines)} ${k.countLines === 1 ? "line" : "lines"} counted in 90 days` : "No counts in the last 90 days",
          k.accuracy !== null && k.accuracy < 95 ? "warn" : undefined,
        )}
        {tile(`/inventory/transfers?b=${hereBranch}`, "Transfers in transit", whole(k.inTransitOut + k.inTransitIn), `${k.inTransitOut} going out · ${k.inTransitIn} coming in`)}
      </section>

      <div className="hub-grid">
        {many ? (
          <section className="card col hub-card wide">
            <div className="row between"><b>Estimated stock value by location</b><Link className="tiny" href={`/inventory/reports?r=value&${q}`}>Report</Link></div>
            <BarList
              rows={hub.byBranch.map((x) => ({
                label: name(x.branch),
                value: Math.round(x.value),
                note: `${whole(x.items)} ${x.items === 1 ? "item" : "items"} in stock${x.noPrice ? ` · ${x.noPrice} with no value yet` : ""}`,
              }))}
              caption="Estimated sell value of the stock at each location"
            />
          </section>
        ) : null}

        <section className="card col hub-card wide">
          <div className="row between"><b>Shipped vs. received</b><span className="tiny faint">Weekly, last 12 weeks</span></div>
          <ColumnChart
            rows={weeks}
            series={[{ key: "shipped", label: "Shipped (orders)" }, { key: "received", label: "Received (trucks and transfers)" }]}
            caption="Dollars shipped on completed orders and received each week for the last 12 weeks"
          />
        </section>

        <section className="card col hub-card">
          <div className="row between"><b>Stock value by group</b><Link className="tiny" href={`/inventory/reports?r=value&${q}`}>Report</Link></div>
          {cats.length ? <BarList rows={cats} caption="Stock value by product group" /> : <p className="small muted" style={{ margin: 0 }}>Nothing priced in stock yet.</p>}
        </section>

        <section className="card col hub-card">
          <div className="row between"><b>How long stock has sat</b><Link className="tiny" href={`/inventory/reports?r=aging&${q}`}>Report</Link></div>
          <BarList rows={ages} caption="Stock value by days since the item last sold" sub={`Days since each item last sold here${starts.length ? ` (or since ${dateShort(starts[0])}, when the app started tracking, if it hasn't sold since)` : ""}.`} />
        </section>

        <section className="card col hub-card">
          <div className="row between"><b>Top sellers, last 30 days</b><Link className="tiny" href={`/inventory/reports?r=movement&${q}`}>Report</Link></div>
          {top.length ? (
            <BarList rows={top.map((i) => ({ label: `${i.sku}${many ? ` · ${name(i.branch)}` : ""}`, value: Math.round(i.soldValue30), note: `${whole(i.sold30)} ${plural(i.unit, i.sold30)} · ${i.name}` }))} caption="Top sellers by dollars, last 30 days" />
          ) : (
            <p className="small muted" style={{ margin: 0 }}>No completed orders in the last 30 days.</p>
          )}
        </section>

        <section className="card col hub-card">
          <div className="row between"><b>Lots to use first</b><Link className="tiny" href={`/inventory/reports?r=expiring&${q}`}>All lots</Link></div>
          {expiring.length ? (
            <div className="hub-rows">
              {expiring.map((l, i) => (
                <div key={i} className={`hub-row${l.days !== null && l.days < 0 ? " err" : ""}`}>
                  <Hourglass size={15} aria-hidden />
                  <span className="grow ellipsis"><b>{l.sku}</b> lot {l.lot_no}{many ? ` · ${name(l.branch)}` : ""}</span>
                  <span className="v">{l.estimated ? "~" : ""}{whole(l.remaining)} · {l.days !== null && l.days < 0 ? `expired ${dateShort(l.use_by)}` : `use by ${dateShort(l.use_by)}`}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>No lots expire in the next {EXPIRING_DAYS} days.</p>
          )}
        </section>

        <section className="card col hub-card">
          <div className="row between"><b>Put on sale</b><Link className="tiny" href={`/inventory/reports?r=aging&${q}`}>All aging stock</Link></div>
          {toSell.length ? (
            <div className="hub-rows">
              {toSell.map((i, x) => (
                <div key={x} className="hub-row">
                  <span className="grow ellipsis"><b>{i.sku}</b> {i.name}{many ? ` · ${name(i.branch)}` : ""}</span>
                  <span className="v">{whole(i.on_hand)} · {i.value ? usd(i.value) : "no value"} · {i.idle}d</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Nothing has gone {AGING_DAYS} days without a sale.</p>
          )}
          {profile.role === "admin" && toSell.length ? <Link href="/admin/promos" className="btn sm dark" style={{ alignSelf: "flex-start" }}>Set up a sale in Promos</Link> : null}
        </section>
      </div>

      <div className="inv-tools">
        {can(profile, "receiving") || can(profile, "inventory") ? (
          <Link href={`/inventory/incoming/receive?b=${hereBranch}`} className="inv-tool">
            <ScanLine size={20} />
            <span className="grow"><b>New Receiving Report</b><span className="tiny faint">Snap the BOL and the app fills it in</span></span>
            <ChevronRight size={16} />
          </Link>
        ) : null}
        {can(profile, "transfers") ? (
          <Link href={`/inventory/transfers/new?b=${hereBranch}`} className="inv-tool">
            <ArrowLeftRight size={20} />
            <span className="grow"><b>Send a transfer</b><span className="tiny faint">Stock to another AMBIT location</span></span>
            <ChevronRight size={16} />
          </Link>
        ) : null}
        {can(profile, "inventory") ? (
          <Link href={`/inventory/spot?b=${hereBranch}`} className="inv-tool">
            <ClipboardCheck size={20} />
            <span className="grow"><b>Spot check</b><span className="tiny faint">Today&apos;s item to count</span></span>
            <ChevronRight size={16} />
          </Link>
        ) : null}
        {profile.role === "admin" ? (
          <Link href="/inventory/values" className="inv-tool">
            <Tags size={20} />
            <span className="grow"><b>List values</b><span className="tiny faint">What each item is worth on these dashboards{k.noPrice ? ` · ${k.noPrice} missing` : ""}</span></span>
            <ChevronRight size={16} />
          </Link>
        ) : null}
        <Link href={`/inventory/reports?${q}`} className="inv-tool">
          <FileDown size={20} />
          <span className="grow"><b>Reports</b><span className="tiny faint">Reorder, expiring, aging, movement, value, counts</span></span>
          <ChevronRight size={16} />
        </Link>
        {can(profile, "receiving") || can(profile, "inventory") ? (
          <Link href={`/inventory/incoming?b=${hereBranch}`} className="inv-tool">
            <Truck size={20} />
            <span className="grow"><b>Receiving</b><span className="tiny faint">On the way and received</span></span>
            <ChevronRight size={16} />
          </Link>
        ) : null}
      </div>

      <p className="tiny faint" style={{ margin: 0 }}>
        Stock value is an estimate of what the stock would sell for: each item&apos;s List value
        {profile.role === "admin" ? <> (<Link href="/inventory/values">set them in List values</Link>)</> : null}; if it has none, the Sell Price on the
        location&apos;s COUNT SHEET; else the catalog price. Shipped is what completed orders sold for. Received is valued the same way as stock. {starts.length ? `The app has tracked sales here since ${dateShort(starts[0])}, so aging fills in over time.` : ""}
      </p>
    </main>
  );
}
