import Link from "next/link";
import { CircleAlert, CircleCheck, ClipboardCheck, ExternalLink, ListChecks, RefreshCw, Send, Truck } from "lucide-react";
import { todayCentral } from "@/lib/sale";
import { requirePerm } from "@/lib/session";
import { hubLock } from "@/lib/access";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
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
  // Warehouse managers only see their own location.
  const lock = hubLock(profile);
  const live = sheets.filter((s) => s.enabled && (lock === null || s.branch_id === lock));
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

  return (
    <main className="shell wide">
      <TopBar
        title="Stock"
        back={`/inventory?b=${branch}`}
        right={
          <a className="iconbtn" href={sheet.share_url} target="_blank" rel="noopener noreferrer" aria-label="Open the spreadsheet">
            <ExternalLink size={18} />
          </a>
        }
      />

      <HubNav profile={profile} active="stock" branch={branch} />

      {live.length > 1 ? (
        <div className="chips" role="tablist" aria-label="Location">
          {live.map((s) => (
            <Link key={s.branch_id} href={`/inventory/stock?b=${s.branch_id}`} className={`chip${s.branch_id === branch ? " on" : ""}`}>
              {branchName(s.branch_id)}
            </Link>
          ))}
        </div>
      ) : null}

      {sp.msg ? (
        <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div>
      ) : null}
      {sp.err ? (
        <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div>
      ) : null}

      {/* Counting and receiving */}
      <div className="inv-tools">
        <Link href={`/inventory/spot?b=${branch}`} className="inv-tool">
          <ClipboardCheck size={20} />
          <span className="grow">
            <b>Spot check</b>
            <span className="tiny faint">{spotMissed ? "Missed days to count" : "Today's item to count"}</span>
          </span>
          {spotMissed ? <span className="dot-badge static">{spotMissed}</span> : null}
        </Link>
        <Link href={`/inventory/incoming?b=${branch}`} className="inv-tool">
          <Truck size={20} />
          <span className="grow">
            <b>Incoming deliveries</b>
            <span className="tiny faint">{incoming ? `${incoming} on the way` : "Add a truck that's coming"}</span>
          </span>
        </Link>
        <Link href={`/inventory/reorders?b=${branch}`} className="inv-tool">
          <Send size={20} />
          <span className="grow">
            <b>Reorder requests</b>
            <span className="tiny faint">{openRequests ? `${openRequests} waiting on purchasing` : `What's been asked of ${buyer.name.split(" ")[0]}`}</span>
          </span>
          {openRequests ? <span className="dot-badge static">{openRequests}</span> : null}
        </Link>
        <Link href={`/inventory/counts?b=${branch}`} className="inv-tool">
          <ListChecks size={20} />
          <span className="grow">
            <b>Perform Inventory Reconciliation</b>
            <span className="tiny faint">{openRec ? "Counting in progress: carry on" : "Quarterly full count, approved by an admin"}</span>
          </span>
        </Link>
      </div>

      <section className="card col inv-head">
        <div className="row between" style={{ gap: 12, alignItems: "flex-start" }}>
          <div className="col tight" style={{ minWidth: 0 }}>
            <span className="eyebrow">{branchName(branch)}</span>
            <b className="ellipsis">{sheet.file_name ?? "Inventory spreadsheet"}</b>
            <span className="tiny faint">
              {sheet.last_ok_at ? `Matched with the spreadsheet ${ago(sheet.last_ok_at)}` : "Not synced yet"}
              {" · checks every 2 minutes"}
            </span>
          </div>
          <form action={syncNow}>
            <input type="hidden" name="branch" value={branch} />
            <Submit className="btn sm ghost" pendingText="Syncing…">
              <RefreshCw size={15} /> Sync now
            </Submit>
          </form>
        </div>
        {sheet.last_summary?.lot_issues?.length ? (
          <div className="alert warn small">
            <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
            <span>FOAM LOTS: {sheet.last_summary.lot_issues.join("; ")}.</span>
          </div>
        ) : null}
        {sheet.last_error ? (
          <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>Last try didn&apos;t finish: {sheet.last_error}</span></div>
        ) : null}
        <div className="inv-stats">
          <div><b>{rows.length}</b><span>items</span></div>
          <div><b>{reserved}</b><span>with stock reserved</span></div>
          <div className={reorder ? "warn" : ""}><b>{reorder}</b><span>at reorder point</span></div>
          <div><b>{uncounted}</b><span>not counted</span></div>
          <div className={noRop ? "warn" : ""}><b>{noRop}</b><span>no reorder point</span></div>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          Counts saved here reach the spreadsheet in seconds. Changes made on the spreadsheet show here within 2 minutes.
          When a PENDING ORDERS line is marked Picked Up / Completed, the app lowers TOTAL IN STOCK for you (its Notes say
          &ldquo;Stock taken&rdquo;). Spray foam is counted by lot on the FOAM LOTS tab: orders take ISO from Covestro first, then the lot
          that expires soonest.
        </p>
      </section>

      <InventoryList
        rows={rows}
        branch={branch}
        branchName={branchName(branch)}
        categories={(catRows ?? []) as Category[]}
        action={stockChange}
        initialFilter={sp.f ?? "all"}
        sheetUrl={sheet.share_url}
        sold60={Object.fromEntries(sold)}
        canRop={canSetRop(profile, branch)}
        canReorder={canRequestReorder(profile)}
        buyer={buyer.name}
      />
    </main>
  );
}
