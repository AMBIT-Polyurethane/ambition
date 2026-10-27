import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, dateTime } from "@/lib/format";
import { inventoryBranches } from "@/lib/widgets";
import { Empty, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { startReconcile } from "@/app/(app)/inventory/count-actions";

export const metadata = { title: "Inventory counts" };

const STATUS: Record<string, { label: string; pill: string }> = {
  open: { label: "Counting", pill: "pill warn" },
  matched: { label: "Matched", pill: "pill ok" },
  submitted: { label: "Waiting for approval", pill: "pill warn" },
  approved: { label: "Approved", pill: "pill ok" },
  rejected: { label: "Not approved", pill: "pill grey" },
};

/** Every spot check and reconciliation for a location: what's waiting for approval first. */
export default async function CountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin" && !can(profile, "inventory")) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) return <main className="shell"><TopBar title="Inventory counts" back="/inventory" /><Empty icon="boxes" title="No location has live inventory yet" /></main>;

  const { data } = await supabase
    .from("inventory_counts")
    .select("id, kind, day, status, started_at, started_by_name, submitted_at, submitted_by_name, lines:inventory_count_lines(sku, name, counted_qty, system_qty)")
    .eq("branch_id", branch.id)
    .neq("status", "open")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(120);
  const { data: openRec } = await supabase.from("inventory_counts").select("id, started_at, started_by_name").eq("branch_id", branch.id).eq("kind", "reconcile").eq("status", "open").maybeSingle();
  type Row = { id: number; kind: string; day: string | null; status: string; started_at: string; started_by_name: string | null; submitted_at: string | null; submitted_by_name: string | null; lines: { sku: string; name: string | null; counted_qty: number | null; system_qty: number | null }[] };
  const rows = ((data ?? []) as Row[]).sort((a, b) => (a.status === "submitted" ? 0 : 1) - (b.status === "submitted" ? 0 : 1));

  return (
    <main className="shell">
      <TopBar title="Inventory counts" back={`/inventory?b=${branch.id}`} />
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((b) => (
            <Link key={b.id} href={`/inventory/counts?b=${b.id}`} className={`chip${b.id === branch.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      <section className="card col" style={{ gap: 8 }}>
        <b>Quarterly inventory reconciliation</b>
        <span className="small muted">Count everything at {branch.name} in the app. An admin approves the differences, then they go onto the spreadsheet.</span>
        {openRec ? (
          <Link href={`/inventory/counts/${openRec.id}`} className="btn sm" style={{ alignSelf: "flex-start" }}>Carry on counting (started {dateShort(openRec.started_at)})</Link>
        ) : (
          <form action={startReconcile}>
            <input type="hidden" name="branch" value={branch.id} />
            <Submit className="btn sm" pendingText="Starting…">Perform Inventory Reconciliation</Submit>
          </form>
        )}
      </section>
      <div className="eyebrow">Spot checks and reconciliations</div>
      {rows.length === 0 ? (
        <Empty icon="clipboard" title="No counts sent in yet" />
      ) : (
        <div className="list">
          {rows.map((r) => {
            const off = r.lines.filter((l) => l.counted_qty !== null && Number(l.counted_qty) !== Number(l.system_qty ?? 0)).length;
            const st = STATUS[r.status] ?? STATUS.open;
            return (
              <Link key={r.id} href={`/inventory/counts/${r.id}`} className="item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="t ellipsis">{r.kind === "spot" ? `Spot check · ${r.lines[0]?.sku ?? ""}` : "Reconciliation"}</span>
                    <span className={st.pill}>{st.label}</span>
                  </div>
                  <div className="s ellipsis">
                    {r.kind === "spot" ? `${dateShort(r.day)} · ${r.lines[0]?.name ?? ""}` : `${r.lines.filter((l) => l.counted_qty !== null).length} items counted`}
                    {off ? ` · ${off} different from the app` : ""}
                  </div>
                  <div className="tiny faint">{r.submitted_by_name ?? ""}{r.submitted_at ? ` · ${dateTime(r.submitted_at)}` : ""}</div>
                </div>
                <ChevronRight size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
