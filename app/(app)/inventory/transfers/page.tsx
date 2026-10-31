import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, Send } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can, canReceive } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { inventoryBranches } from "@/lib/widgets";
import { Empty, TopBar } from "@/components/ui";
import { HubNav } from "@/components/inventory/hub-nav";

export const metadata = { title: "Transfers" };
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  from_branch: string;
  to_branch: string;
  status: string;
  arrive_on: string | null;
  created_at: string;
  received_at: string | null;
  created_by_name: string | null;
  lines: { sku: string; qty: number; lot_no: string | null }[];
};

/** Stock moving between AMBIT locations: going out, coming in, and done lately. */
export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!can(profile, "transfers") && !canReceive(profile)) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) return <main className="shell"><TopBar title="Transfers" back="/inventory" /><Empty icon="truck" title="No location has live inventory yet" /></main>;
  const { data } = await supabase
    .from("inventory_transfers")
    .select("id, from_branch, to_branch, status, arrive_on, created_at, received_at, created_by_name, lines:inventory_transfer_lines(sku, qty, lot_no)")
    .or(`from_branch.eq.${branch.id},to_branch.eq.${branch.id}`)
    .order("created_at", { ascending: false })
    .limit(150);
  const rows = (data ?? []) as Row[];
  const { data: names } = await supabase.from("branches").select("id, name");
  const nm = new Map(((names ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const moving = rows.filter((r) => r.status === "in_transit");
  const done = rows.filter((r) => r.status !== "in_transit").slice(0, 40);
  const item = (r: Row) => {
    const out = r.from_branch === branch.id;
    return (
      <Link key={r.id} href={`/inventory/transfers/${r.id}`} className="item">
        {out ? <ArrowRight size={18} className="chev" aria-label="Going out" /> : <ArrowLeft size={18} className="chev" aria-label="Coming in" />}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="t ellipsis">T-{r.id} · {out ? `to ${nm.get(r.to_branch) ?? r.to_branch}` : `from ${nm.get(r.from_branch) ?? r.from_branch}`}</span>
            {r.status === "in_transit" ? (
              <span className="pill">{out ? "Sent" : "Coming"}{r.arrive_on ? ` · ${dateShort(r.arrive_on)}` : ""}</span>
            ) : r.status === "received" ? (
              <span className="pill ok">Received {dateShort(r.received_at)}</span>
            ) : (
              <span className="pill grey">Cancelled</span>
            )}
          </div>
          <div className="s ellipsis">{r.lines.map((l) => `${Number(l.qty)} ${l.sku}${l.lot_no ? ` (${l.lot_no})` : ""}`).join(" · ")}</div>
          <div className="tiny faint">{dateShort(r.created_at)} · {r.created_by_name ?? ""}</div>
        </div>
        <ChevronRight size={18} className="chev" />
      </Link>
    );
  };

  return (
    <main className="shell">
      <TopBar title="Transfers" back={`/inventory?b=${branch.id}`} />
      <HubNav profile={profile} active="transfers" branch={branch.id} />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((b) => (
            <Link key={b.id} href={`/inventory/transfers?b=${b.id}`} className={`chip${b.id === branch.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      {can(profile, "transfers") ? (
        <Link href={`/inventory/transfers/new?b=${branch.id}`} className="btn" style={{ alignSelf: "flex-start" }}><Send size={16} /> Send stock from {branch.name}</Link>
      ) : null}
      <div className="eyebrow">On the road</div>
      {moving.length ? <div className="list">{moving.map(item)}</div> : <Empty icon="truck" title="Nothing on the road">Transfers sent from or to {branch.name} show here until they&apos;re received.</Empty>}
      {done.length ? (
        <>
          <div className="eyebrow">Done lately</div>
          <div className="list">{done.map(item)}</div>
        </>
      ) : null}
    </main>
  );
}
