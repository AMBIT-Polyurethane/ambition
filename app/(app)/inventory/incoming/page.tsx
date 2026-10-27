import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { inventoryBranches } from "@/lib/widgets";
import { Empty, TopBar } from "@/components/ui";

export const metadata = { title: "Incoming deliveries" };

type Row = { id: number; vendor: string; expected_on: string; ref: string | null; status: string; received_at: string | null; lines: { sku: string; qty: number }[] };

/** Trucks on the way to a location, and the ones received lately. */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin" && !can(profile, "inventory")) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) return <main className="shell"><TopBar title="Incoming deliveries" back="/inventory" /><Empty icon="truck" title="No location has live inventory yet" /></main>;
  const today = todayCentral();
  const { data } = await supabase
    .from("inbound_deliveries")
    .select("id, vendor, expected_on, ref, status, received_at, lines:inbound_lines(sku, qty)")
    .eq("branch_id", branch.id)
    .neq("status", "cancelled")
    .order("expected_on", { ascending: true })
    .limit(200);
  const rows = (data ?? []) as Row[];
  const coming = rows.filter((r) => r.status === "expected");
  const got = rows.filter((r) => r.status === "received").sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? "")).slice(0, 20);
  const item = (r: Row) => (
    <Link key={r.id} href={`/inventory/incoming/${r.id}`} className="item">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between" style={{ gap: 8 }}>
          <span className="t ellipsis">{r.vendor}</span>
          {r.status === "received" ? (
            <span className="pill ok">Received {dateShort(r.received_at)}</span>
          ) : r.expected_on < today ? (
            <span className="pill warn">Late · was due {dateShort(r.expected_on)}</span>
          ) : (
            <span className="pill">{r.expected_on === today ? "Today" : dateShort(r.expected_on)}</span>
          )}
        </div>
        <div className="s ellipsis">{r.lines.map((l) => `${Number(l.qty)} ${l.sku}`).join(" · ")}</div>
        {r.ref ? <div className="tiny faint">{r.ref}</div> : null}
      </div>
      <ChevronRight size={18} className="chev" />
    </Link>
  );

  return (
    <main className="shell">
      <TopBar
        title="Incoming deliveries"
        back={`/inventory?b=${branch.id}`}
        right={<Link href={`/inventory/incoming/new?b=${branch.id}`} className="btn sm"><Plus size={16} /> Expected delivery</Link>}
      />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((b) => (
            <Link key={b.id} href={`/inventory/incoming?b=${b.id}`} className={`chip${b.id === branch.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      <div className="eyebrow">On the way to {branch.name}</div>
      {coming.length ? <div className="list">{coming.map(item)}</div> : <Empty icon="truck" title="Nothing expected">Add a truck with &ldquo;Expected delivery&rdquo; and it shows on the warehouse calendar.</Empty>}
      {got.length ? (
        <>
          <div className="eyebrow">Received lately</div>
          <div className="list">{got.map(item)}</div>
        </>
      ) : null}
    </main>
  );
}
