import Link from "next/link";
import { CircleAlert, CircleCheck, ExternalLink, RefreshCw } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { InventoryList } from "@/components/inventory-list";
import { ago, branchStock, inventorySheets, needsReorder } from "@/lib/inventory/view";
import { stockChange, syncNow } from "./actions";
import type { Category } from "@/lib/types";

export const metadata = { title: "Inventory" };
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
  const live = sheets.filter((s) => s.enabled);
  const branchName = (id: string) => {
    const b = ((branchRows ?? []) as { id: string; name: string; state: string }[]).find((x) => x.id === id);
    return b ? `${b.name}, ${b.state}` : id.toUpperCase();
  };

  if (!live.length) {
    return (
      <main className="shell">
        <TopBar title="Inventory" back="/" />
        <Empty icon="boxes" title="No inventory spreadsheet is connected yet">
          {profile.role === "admin" ? <Link href="/admin/inventory">Set it up in Admin → Inventory</Link> : "An admin sets this up in Admin → Inventory."}
        </Empty>
      </main>
    );
  }

  const sheet = live.find((s) => s.branch_id === sp.b) ?? live.find((s) => s.branch_id === profile.branch_id) ?? live[0];
  const branch = sheet.branch_id;
  const rows = await branchStock(supabase, branch);
  const reorder = rows.filter(needsReorder).length;
  const reserved = rows.filter((r) => r.pending > 0).length;
  const uncounted = rows.filter((r) => r.on_hand === null).length;

  return (
    <main className="shell wide">
      <TopBar
        title="Inventory"
        back="/"
        right={
          <a className="iconbtn" href={sheet.share_url} target="_blank" rel="noopener noreferrer" aria-label="Open the spreadsheet">
            <ExternalLink size={18} />
          </a>
        }
      />

      {live.length > 1 ? (
        <div className="chips" role="tablist" aria-label="Location">
          {live.map((s) => (
            <Link key={s.branch_id} href={`/inventory?b=${s.branch_id}`} className={`chip${s.branch_id === branch ? " on" : ""}`}>
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
        {sheet.last_error ? (
          <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>Last try didn&apos;t finish: {sheet.last_error}</span></div>
        ) : null}
        <div className="inv-stats">
          <div><b>{rows.length}</b><span>items</span></div>
          <div><b>{reserved}</b><span>with stock reserved</span></div>
          <div className={reorder ? "warn" : ""}><b>{reorder}</b><span>at reorder point</span></div>
          <div><b>{uncounted}</b><span>not counted</span></div>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          Counts saved here reach the spreadsheet in seconds. Changes made on the spreadsheet show here within 2 minutes.
          When a PENDING ORDERS line is marked Picked Up / Completed, the app lowers TOTAL IN STOCK for you (its Notes say
          &ldquo;Stock taken&rdquo;).
        </p>
      </section>

      <InventoryList rows={rows} branch={branch} categories={(catRows ?? []) as Category[]} action={stockChange} initialFilter={sp.f ?? "all"} />
    </main>
  );
}
