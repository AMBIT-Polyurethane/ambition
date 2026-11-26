import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight, ChevronLeft, CircleCheck, ClipboardCheck, Hourglass, PackageOpen, ScanLine, Send, Tags, TrendingDown, TriangleAlert } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can, hubLock, seesInventory } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { inventoryBranches } from "@/lib/widgets";
import { AGING_DAYS, EXPIRING_DAYS, loadHub } from "@/lib/inventory/hub";
import { Empty, TopBar } from "@/components/ui";
import { Help } from "@/components/help";
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

  // Warehouse managers can look at every location but start on their own, and their tools stay on their own.
  const lock = hubLock(profile);
  const locked = lock !== null;
  const live = lock === "" ? [] : await inventoryBranches(supabase, profile, { all: true });
  if (!live.length) {
    return (
      <main className="shell">
        <TopBar title="Inventory Hub" back="/" />
        {lock === "" ? (
          <Empty icon="boxes" title="Your account isn't set to a location yet">
            Warehouse managers see the Inventory Hub for their own location. An admin sets your location in Admin → Accounts.
          </Empty>
        ) : (
          <Empty icon="boxes" title="No location has live inventory yet">
            {profile.role === "admin" ? <Link href="/admin/inventory">Set it up in Admin → Inventory</Link> : "An admin sets this up in Admin → Inventory."}
          </Empty>
        )}
      </main>
    );
  }
  const own = locked && live.some((b) => b.id === lock) ? lock : null;
  const pick =
    sp.b === "all" ? "all" : live.find((b) => b.id === sp.b)?.id ?? own ?? (live.some((b) => b.id === profile.branch_id) ? profile.branch_id! : "all");
  const hub = await loadHub(supabase, pick === "all" ? "all" : [pick]);
  const k = hub.kpi;
  const name = (id: string) => hub.branches.find((b) => b.id === id)?.name ?? id.toUpperCase();
  const many = hub.scope.length > 1;
  const q = `b=${pick}`;
  // Receiving, transfers and spot checks: a warehouse manager's are always their own location.
  const hereBranch = own ?? (pick === "all" ? (profile.branch_id && live.some((b) => b.id === profile.branch_id) ? profile.branch_id : live[0].id) : pick);
  const lookOnly = locked && pick !== own;
  // Partial receipts (0065) and reorder requests (0064) waiting, for the tool cards.
  const scopeIds = pick === "all" ? live.map((b) => b.id) : [pick];
  const [restRes, rrRes] = await Promise.all([
    supabase.from("inbound_deliveries").select("id", { count: "exact", head: true }).in("branch_id", scopeIds).eq("status", "expected").not("rest_of", "is", null),
    supabase.from("reorder_requests").select("id", { count: "exact", head: true }).in("branch_id", scopeIds).eq("status", "open"),
  ]);
  const restWaiting = restRes.error ? 0 : (restRes.count ?? 0);
  const reorderOpen = rrRes.error ? 0 : (rrRes.count ?? 0);

  // Charts: two, side by side.
  const weeks = hub.weeks.map((w) => ({ label: w.label, values: [Math.round(w.shipped), Math.round(w.received)] }));
  const cats = hub.categories.slice(0, 6).map((c) => ({ label: c.name, value: Math.round(c.value), note: `${c.items} ${c.items === 1 ? "item" : "items"}` }));
  const rest = hub.categories.slice(6);
  if (rest.length) cats.push({ label: "Everything else", value: Math.round(rest.reduce((t, c) => t + c.value, 0)), note: `${rest.length} more groups` });
  const starts = [...new Set(hub.scope.map((b) => hub.trackingStart[b]))].sort();
  const stockHref = `/inventory/stock?b=${hereBranch}`;
  const short = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M` : v >= 10_000 ? `$${Math.round(v / 1000)}k` : usd(v));

  // Needs you: the to-do list, each with its one button.
  type Todo = { icon: React.ReactNode; tone: "warn" | "err" | "info"; title: string; sub: string; href: string; go: string };
  const todos: Todo[] = [];
  if (k.expiredLots) todos.push({ icon: <TriangleAlert size={20} />, tone: "err", title: `${k.expiredLots} ${k.expiredLots === 1 ? "lot is" : "lots are"} past the use-by date`, sub: "Sell, use or write off first", href: `/inventory/reports?r=expiring&${q}`, go: "See them" });
  if (k.reorder) todos.push({ icon: <TrendingDown size={20} />, tone: "warn", title: `${whole(k.reorder)} ${k.reorder === 1 ? "item is" : "items are"} running low`, sub: `At or under the reorder point, out of ${whole(k.withRop)}`, href: can(profile, "inventory") ? `${stockHref}&f=reorder` : `/inventory/reports?r=reorder&${q}`, go: can(profile, "inventory") ? "Reorder" : "See them" });
  if (k.expiringLots) todos.push({ icon: <Hourglass size={20} />, tone: "warn", title: `${k.expiringLots} ${k.expiringLots === 1 ? "lot expires" : "lots expire"} in the next ${EXPIRING_DAYS} days`, sub: `${usd(k.expiringValue)} of stock to use first`, href: `/inventory/reports?r=expiring&${q}`, go: "See them" });
  if (restWaiting && (can(profile, "receiving") || can(profile, "inventory"))) todos.push({ icon: <PackageOpen size={20} />, tone: "info", title: `${restWaiting} ${restWaiting === 1 ? "delivery is" : "deliveries are"} still missing items`, sub: "Partial orders waiting on the rest", href: `/inventory/incoming?b=${hereBranch}`, go: "Receiving" });
  if (reorderOpen && can(profile, "inventory")) todos.push({ icon: <Send size={20} />, tone: "info", title: `${reorderOpen} reorder ${reorderOpen === 1 ? "request is" : "requests are"} waiting on purchasing`, sub: "Asked, not ordered yet", href: `/inventory/reorders${pick === "all" ? "" : `?b=${pick}`}`, go: "See them" });
  if (k.noPrice && profile.role === "admin") todos.push({ icon: <Tags size={20} />, tone: "info", title: `${k.noPrice} ${k.noPrice === 1 ? "item has" : "items have"} no value yet`, sub: "Stock value leaves them out until they have one", href: "/inventory/values", go: "Add values" });
  if (k.agingItems) todos.push({ icon: <Hourglass size={20} />, tone: "info", title: `${whole(k.agingItems)} ${k.agingItems === 1 ? "item hasn't" : "items haven't"} sold in ${AGING_DAYS}+ days`, sub: `${usd(k.agingValue)} sitting · worth putting on sale`, href: `/inventory/reports?r=aging&${q}`, go: "See them" });

  const kpi = (href: string, label: React.ReactNode, value: string, sub: React.ReactNode, tone?: "warn") => (
    <Link href={href} className={`ihub-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="l">{label}</span>
      <b>{value}</b>
      <span className="s">{sub}</span>
    </Link>
  );

  return (
    <main className="shell wide">
      <div className="o2 ihub">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/" className="o2-back" aria-label="Back to home"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>Inventory</h1>
              {lookOnly && own ? (
                <span className="o2-sub">Look only · your tools stay on {live.find((b) => b.id === own)?.name ?? "your location"} · <Link href={`/inventory?b=${own}`}>Back to yours</Link></span>
              ) : null}
            </div>
          </div>
          {live.length > 1 ? (
            <nav className="seg2" aria-label="Location">
              <Link href="/inventory?b=all" className={pick === "all" ? "on" : undefined} aria-current={pick === "all" ? "page" : undefined}>All</Link>
              {live.map((b) => (
                <Link key={b.id} href={`/inventory?b=${b.id}`} className={b.id === pick ? "on" : undefined} aria-current={b.id === pick ? "page" : undefined}>
                  {b.name.replace(/,\s*[A-Z]{2}$/, "")}{b.id === own ? " (yours)" : ""}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>

        <HubNav profile={profile} active="dashboard" branch={pick} />

        <section className="card2 ihub-todo" aria-label="Needs you">
          <div className="ihub-todo-h">
            <b>Needs you</b>
            <span>{todos.length ? `${todos.length} ${todos.length === 1 ? "thing" : "things"}` : "All caught up"}</span>
          </div>
          {todos.map((t, i) => (
            <div key={i} className="ihub-todo-r">
              <span className={`ihub-ic ${t.tone}`} aria-hidden="true">{t.icon}</span>
              <span className="ihub-todo-b"><b>{t.title}</b><span>{t.sub}</span></span>
              <Link href={t.href} className={`b2 sm${i === 0 ? "" : " quiet"}`}>{t.go}</Link>
            </div>
          ))}
          {!k.expiringLots && !k.expiredLots ? (
            <div className="ihub-todo-ok"><CircleCheck size={17} aria-hidden="true" /> No lots expire in the next {EXPIRING_DAYS} days</div>
          ) : null}
        </section>

        {can(profile, "receiving") || can(profile, "inventory") || can(profile, "transfers") ? (
          <div className="ihub-acts">
            {can(profile, "receiving") || can(profile, "inventory") ? <Link href={`/inventory/incoming/receive?b=${hereBranch}`} className="b2 quiet"><ScanLine size={18} /> New Receiving Report</Link> : null}
            {can(profile, "transfers") ? <Link href={`/inventory/transfers/new?b=${hereBranch}`} className="b2 quiet"><ArrowLeftRight size={18} /> Send a transfer</Link> : null}
            {can(profile, "inventory") ? <Link href={`/inventory/spot?b=${hereBranch}`} className="b2 quiet"><ClipboardCheck size={18} /> Spot check</Link> : null}
          </div>
        ) : null}

        <section className="ihub-kpis" aria-label="Key numbers">
          {kpi(
            `/inventory/reports?r=value&${q}`,
            <>Stock value <Help label="How stock value is worked out">Stock value is an estimate of what the stock would sell for: each item&apos;s List value; if it has none, the Sell Price on the location&apos;s COUNT SHEET; else the catalog price. Shipped is what completed orders sold for. Received is valued the same way as stock.{starts.length ? ` The app has tracked sales here since ${dateShort(starts[0])}, so aging fills in over time.` : ""}</Help></>,
            short(k.value),
            "Estimate",
          )}
          {kpi(`/inventory/reports?r=movement&${q}`, "Shipped, last 30 days", short(k.shipped30), "Completed orders")}
          {kpi(
            `/inventory/reports?r=counts&${q}`,
            "Count accuracy",
            k.accuracy === null ? "-" : `${k.accuracy}%`,
            k.countLines ? `${whole(k.countLines)} ${k.countLines === 1 ? "line" : "lines"} counted in 90 days` : "No counts in the last 90 days",
            k.accuracy !== null && k.accuracy < 95 ? "warn" : undefined,
          )}
          {kpi(`/inventory/transfers?b=${hereBranch}`, "On a truck between locations", whole(k.inTransitOut + k.inTransitIn), `${k.inTransitOut} going out · ${k.inTransitIn} coming in`)}
        </section>

        <div className="ihub-grid">
          <section className="card2 ihub-card">
            <div className="ihub-card-h"><b>Shipped vs. received</b><span>Each week, last 12 weeks</span></div>
            <ColumnChart
              rows={weeks}
              series={[{ key: "shipped", label: "Shipped (orders)" }, { key: "received", label: "Received (trucks and transfers)" }]}
              caption="Dollars shipped on completed orders and received each week for the last 12 weeks"
            />
            <span className="ihub-foot">Received in the last 30 days: {usd(k.received30)} · {k.expected} {k.expected === 1 ? "delivery" : "deliveries"} on the way</span>
          </section>
          <section className="card2 ihub-card">
            <div className="ihub-card-h"><b>Where the money sits</b><Link href={`/inventory/reports?r=value&${q}`}>All groups</Link></div>
            {cats.length ? <BarList rows={cats} caption="Stock value by product group" /> : <p className="small muted" style={{ margin: 0 }}>Nothing priced in stock yet.</p>}
          </section>
          {many ? (
            <section className="card2 ihub-card wide">
              <div className="ihub-card-h"><b>Stock value by location</b><Link href={`/inventory/reports?r=value&${q}`}>Report</Link></div>
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
        </div>
      </div>
    </main>
  );
}
