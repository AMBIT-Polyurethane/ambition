import Link from "next/link";
import { ChevronLeft, CircleAlert, CircleCheck, ClipboardCheck, Eye, ExternalLink, ListChecks, Lock, RefreshCw, Send, TriangleAlert, Truck } from "lucide-react";
import { Help } from "@/components/help";
import { MoreMenu } from "@/components/order2/menu";
import { todayCentral } from "@/lib/sale";
import { requirePerm } from "@/lib/session";
import { hubAllows, hubLock } from "@/lib/access";
import { TopBar, Empty } from "@/components/ui";
import { InventoryList } from "@/components/inventory-list";
import { HubNav } from "@/components/inventory/hub-nav";
import { ago, branchStock, inventorySheets, needsReorder } from "@/lib/inventory/view";
import { canRequestReorder, canSetRop, purchasingContact, soldByProduct } from "@/lib/inventory/reorder";
import { stockChange, syncNow } from "../actions";
import type { Category } from "@/lib/types";

export const metadata = { title: "Stock" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requirePerm("inventory");
  const [sheets, { data: branchRows }, { data: catRows }] = await Promise.all([
    inventorySheets(supabase),
    supabase.from("branches").select("id, name, state").order("sort"),
    supabase.from("categories").select("*").order("sort"),
  ]);
  // Warehouse managers can look at every location, start on their own, and only work on their own.
  const lock = hubLock(profile);
  const live = sheets
    .filter((s) => s.enabled)
    .sort((a, b) => (a.branch_id === profile.branch_id ? -1 : b.branch_id === profile.branch_id ? 1 : 0));
  const branchName = (id: string) => {
    const b = ((branchRows ?? []) as { id: string; name: string; state: string }[]).find((x) => x.id === id);
    return b ? `${b.name}, ${b.state}` : id.toUpperCase();
  };

  if (!live.length) {
    return (
      <main className="shell">
        <TopBar title="Stock" back="/inventory" />
        <Empty icon="boxes" title="No inventory spreadsheet is connected yet">
          {profile.role === "admin" ? <Link href="/admin/inventory">Set it up in Admin → Inventory</Link> : "An admin sets this up in Admin → Inventory."}
        </Empty>
      </main>
    );
  }

  const sheet = live.find((s) => s.branch_id === sp.b) ?? live.find((s) => s.branch_id === profile.branch_id) ?? live[0];
  const branch = sheet.branch_id;
  const mine = hubAllows(profile, branch);
  const today = todayCentral();
  const [rows, spotRes, incomingRes, recRes, sold, buyer, reqRes] = await Promise.all([
    branchStock(supabase, branch),
    supabase.from("inventory_counts").select("id", { count: "exact", head: true }).eq("branch_id", branch).eq("kind", "spot").eq("status", "open").lt("day", today),
    supabase.from("inbound_deliveries").select("id", { count: "exact", head: true }).eq("branch_id", branch).eq("status", "expected"),
    supabase.from("inventory_counts").select("id").eq("branch_id", branch).eq("kind", "reconcile").eq("status", "open").limit(1),
    soldByProduct(supabase, branch, 60),
    purchasingContact(supabase),
    supabase.from("reorder_requests").select("id", { count: "exact", head: true }).eq("branch_id", branch).eq("status", "open"),
  ]);
  const openRequests = reqRes.error ? 0 : (reqRes.count ?? 0);
  const noRop = rows.filter((r) => r.reorder_point === null).length;
  const spotMissed = spotRes.count ?? 0;
  const incoming = incomingRes.count ?? 0;
  const openRec = (recRes.data ?? []).length > 0;
  const reorder = rows.filter(needsReorder).length;
  const reserved = rows.filter((r) => r.pending > 0).length;
  const uncounted = rows.filter((r) => r.on_hand === null).length;

  const shortName = (id: string) => ((branchRows ?? []) as { id: string; name: string }[]).find((x) => x.id === id)?.name ?? id.toUpperCase();
  const tiles: { href: string; tone: "warn" | "err" | "info" | ""; icon: React.ReactNode; title: string; sub: string }[] = [
    { href: `/inventory/stock?b=${branch}&f=reorder`, tone: reorder ? "warn" : "", icon: <TriangleAlert size={20} />, title: reorder ? `${reorder} running low` : "Nothing running low", sub: "At or under the reorder point" },
    ...(mine
      ? [
          {
            href: openRec ? `/inventory/counts?b=${branch}` : `/inventory/spot?b=${branch}`,
            tone: (spotMissed ? "err" : "") as "err" | "",
            icon: <ClipboardCheck size={20} />,
            title: openRec ? "Full count in progress" : spotMissed ? `${spotMissed} spot check${spotMissed === 1 ? "" : "s"} missed` : "Spot check",
            sub: openRec ? "Carry on counting" : spotMissed ? "Count them today" : "Today's item to count",
          },
          { href: `/inventory/incoming?b=${branch}`, tone: (incoming ? "info" : "") as "info" | "", icon: <Truck size={20} />, title: incoming ? `${incoming} deliver${incoming === 1 ? "y" : "ies"} coming` : "No deliveries coming", sub: incoming ? "Receive it when it lands" : "Add a truck that's coming" },
        ]
      : []),
    { href: `/inventory/stock?b=${branch}&f=reserved`, tone: "", icon: <Lock size={20} />, title: `${reserved} item${reserved === 1 ? "" : "s"} reserved`, sub: "Held for open orders" },
  ];

  return (
    <main className="shell wide">
      <div className="o2 stk">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href={`/inventory?b=${branch}`} className="o2-back" aria-label="Back to inventory"><ChevronLeft size={20} /></Link>
            <div className="o2-title">
              <h1>Stock</h1>
              <span className="o2-sub stk-sync">
                <span className={`stk-dot${sheet.last_error ? " warn" : sheet.last_ok_at ? " ok" : ""}`} aria-hidden="true" />
                {sheet.last_ok_at ? `Matches the spreadsheet · ${ago(sheet.last_ok_at)}` : "Not synced with the spreadsheet yet"}
                <Help label="How the spreadsheet sync works">
                  Counts saved here reach the spreadsheet in seconds. Changes made on the spreadsheet show here within 2 minutes. When a
                  PENDING ORDERS line is marked Picked Up / Completed, the app lowers TOTAL IN STOCK for you (its Notes say &ldquo;Stock
                  taken&rdquo;). Spray foam is counted by lot on the FOAM LOTS tab: orders take ISO from Covestro first, then the lot that
                  expires soonest.
                </Help>
              </span>
            </div>
          </div>
          <div className="o2-head-r">
            {live.length > 1 ? (
              <nav className="seg2" aria-label="Location">
                {live.map((x) => (
                  <Link key={x.branch_id} href={`/inventory/stock?b=${x.branch_id}`} className={x.branch_id === branch ? "on" : undefined} aria-current={x.branch_id === branch ? "page" : undefined}>
                    {shortName(x.branch_id)}{lock && x.branch_id === lock ? " (yours)" : ""}
                  </Link>
                ))}
              </nav>
            ) : null}
            <MoreMenu label="More: sync now, the spreadsheet, reorder requests, full count">
              {mine ? (
                <form action={syncNow}>
                  <input type="hidden" name="branch" value={branch} />
                  <button type="submit" className="menu2-i" style={{ width: "100%" }}><RefreshCw size={18} /> Sync with the spreadsheet now</button>
                </form>
              ) : null}
              <a className="menu2-i" href={sheet.share_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} /> Open {sheet.file_name ?? "the spreadsheet"}</a>
              {mine ? <Link className="menu2-i" href={`/inventory/reorders?b=${branch}`}><Send size={18} /> Reorder requests{openRequests ? ` · ${openRequests} waiting on ${buyer.name.split(" ")[0]}` : ""}</Link> : null}
              {mine ? <Link className="menu2-i" href={`/inventory/counts?b=${branch}`}><ListChecks size={18} /> Count everything (quarterly)</Link> : null}
            </MoreMenu>
          </div>
        </div>

        <HubNav profile={profile} active="stock" branch={branch} />

        {sp.msg ? (
          <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div>
        ) : null}
        {sp.err ? (
          <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div>
        ) : null}
        {!mine ? (
          <div className="alert info" role="status">
            <Eye size={18} style={{ flex: "none", marginTop: 1 }} />
            <span>
              Look only: this is {branchName(branch)}&apos;s stock. Counts, receiving, holds and transfers are done by that location.{" "}
              {lock ? <Link href={`/inventory/stock?b=${lock}`}>Back to your location</Link> : null}
            </span>
          </div>
        ) : null}
        {sheet.last_summary?.lot_issues?.length ? (
          <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>FOAM LOTS: {sheet.last_summary.lot_issues.join("; ")}.</span></div>
        ) : null}
        {sheet.last_error ? (
          <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>Last sync didn&apos;t finish: {sheet.last_error}</span></div>
        ) : null}

        <div className="stk-tiles">
          {tiles.map((t) => (
            <Link key={t.title} href={t.href} className={`stk-tile${t.tone ? ` ${t.tone}` : ""}`}>
              <span className="stk-tile-ic">{t.icon}</span>
              <span className="stk-tile-b"><b>{t.title}</b><span>{t.sub}</span></span>
            </Link>
          ))}
        </div>

        <InventoryList
          key={sp.f ?? "all"}
          rows={rows}
          branch={branch}
          branchName={branchName(branch)}
          categories={(catRows ?? []) as Category[]}
          action={stockChange}
          initialFilter={sp.f ?? "all"}
          sheetUrl={sheet.share_url}
          sold60={Object.fromEntries(sold)}
          canRop={mine && canSetRop(profile, branch)}
          canReorder={mine && canRequestReorder(profile)}
          buyer={buyer.name}
          readOnly={!mine}
        />
      </div>
    </main>
  );
}
