import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight, ChevronRight, Paperclip, Plus, ScanLine, Sparkles } from "lucide-react";
import { requireActive } from "@/lib/session";
import { canReceive } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { inventoryBranches } from "@/lib/widgets";
import { Empty, TopBar } from "@/components/ui";
import { HubNav } from "@/components/inventory/hub-nav";

export const metadata = { title: "Receiving" };
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  vendor: string;
  expected_on: string;
  ref: string | null;
  bol_no: string | null;
  status: string;
  received_at: string | null;
  received_by_name: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  sent_back_note: string | null;
  transfer_id: number | null;
  read_by_ai: boolean;
  files: { path: string; name: string }[] | null;
  lines: { sku: string; qty: number; received_qty: number | null }[];
  /** 0065: this delivery is the rest of a partial order (the report it follows), or a report marked partial. */
  rest_of?: number | null;
  partial?: boolean;
  po_no?: string | null;
};

/** Receiving: trucks and transfers on the way, and the Receiving Reports done lately. */
export default async function ReceivingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!canReceive(profile)) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) return <main className="shell"><TopBar title="Receiving" back="/inventory" /><Empty icon="truck" title="No location has live inventory yet" /></main>;
  const today = todayCentral();
  const COLS = "id, vendor, expected_on, ref, bol_no, status, received_at, received_by_name, submitted_at, submitted_by_name, sent_back_note, transfer_id, read_by_ai, files, lines:inbound_lines(sku, qty, received_qty)";
  const q = (cols: string) => supabase.from("inbound_deliveries").select(cols).eq("branch_id", branch.id).neq("status", "cancelled").order("expected_on", { ascending: true }).limit(300);
  let res = await q(`${COLS}, rest_of, partial, po_no`);
  if (res.error && /rest_of|partial/.test(res.error.message)) res = await q(COLS); // before 0065
  const rows = (res.data ?? []) as unknown as Row[];
  const rests = rows.filter((r) => r.status === "expected" && r.rest_of);
  // Sent back by an admin to fix: fix that report and send it again (not a new one), so the truck counts once.
  const fix = rows.filter((r) => r.status === "expected" && !r.rest_of && r.sent_back_note);
  const coming = rows.filter((r) => r.status === "expected" && !r.rest_of && !r.sent_back_note);
  const waiting = rows.filter((r) => r.status === "submitted").sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const got = rows.filter((r) => r.status === "received").sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? "")).slice(0, 40);
  const item = (r: Row) => {
    const short = r.status === "received" && r.lines.some((l) => l.received_qty !== null && Number(l.received_qty) < Number(l.qty));
    return (
      <Link key={r.id} href={`/inventory/incoming/${r.id}`} className="item">
        {r.transfer_id ? <ArrowLeftRight size={18} className="chev" style={{ flex: "none" }} aria-label="Transfer" /> : null}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="t ellipsis">{r.vendor}</span>
            {r.status === "received" ? (
              <span className={short || r.partial ? "pill warn" : "pill ok"}>{r.partial ? "Partial · " : short ? "Short · " : ""}Received {dateShort(r.received_at)}</span>
            ) : r.status === "expected" && r.rest_of ? (
              <span className="pill warn">Rest of {r.po_no ? `PO ${r.po_no}` : "an order"}{r.expected_on < today ? " · late" : ` · ${dateShort(r.expected_on)}`}</span>
            ) : r.status === "submitted" ? (
              <span className="pill warn">Waiting for approval</span>
            ) : r.sent_back_note ? (
              <span className="pill warn">Sent back</span>
            ) : r.expected_on < today ? (
              <span className="pill warn">Late · was due {dateShort(r.expected_on)}</span>
            ) : (
              <span className="pill">{r.expected_on === today ? "Today" : dateShort(r.expected_on)}</span>
            )}
          </div>
          <div className="s ellipsis">{r.lines.map((l) => `${Number(r.status !== "expected" && l.received_qty !== null ? l.received_qty : l.qty)} ${l.sku}`).join(" · ")}</div>
          <div className="tiny faint row" style={{ gap: 6 }}>
            {r.bol_no ? <span>BOL {r.bol_no}</span> : r.ref ? <span>{r.ref}</span> : null}
            {r.files?.length ? <span className="row" style={{ gap: 3 }}><Paperclip size={11} /> {r.files.length}</span> : null}
            {r.read_by_ai ? <span className="row" style={{ gap: 3 }}><Sparkles size={11} /> read from BOL</span> : null}
            {r.received_by_name && r.status === "received" ? <span>{r.received_by_name}</span> : null}
            {r.status === "submitted" ? <span>{r.submitted_by_name} · {dateShort(r.submitted_at)}</span> : null}
          </div>
        </div>
        <ChevronRight size={18} className="chev" />
      </Link>
    );
  };

  return (
    <main className="shell">
      <TopBar title="Receiving" back={`/inventory?b=${branch.id}`} howTo="receive-inventory" />
      <HubNav profile={profile} active="receiving" branch={branch.id} />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((b) => (
            <Link key={b.id} href={`/inventory/incoming?b=${b.id}`} className={`chip${b.id === branch.id ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link href={`/inventory/incoming/receive?b=${branch.id}`} className="btn"><ScanLine size={17} /> New Receiving Report</Link>
        <Link href={`/inventory/incoming/new?b=${branch.id}`} className="btn dark"><Plus size={17} /> Expected delivery</Link>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        Truck here? If it was added as an expected delivery (or it&apos;s a transfer), open it below and receive it there. Otherwise start a New Receiving Report and snap the BOL and the packing list (both are needed).
      </p>
      {waiting.length ? (
        <>
          <div className="eyebrow">Waiting for admin approval</div>
          <p className="tiny faint" style={{ margin: 0 }}>
            {profile.role === "admin" ? "Open each one, check it, and approve it. Stock and the spreadsheet update when you do." : "An admin approves these. Stock and the spreadsheet update then."}
          </p>
          <div className="list">{waiting.map(item)}</div>
        </>
      ) : null}
      {fix.length ? (
        <>
          <div className="eyebrow">Sent back to fix · {fix.length}</div>
          <p className="tiny faint" style={{ margin: 0 }}>An admin sent these back. Open one, fix it (add what&apos;s missing) and send it again. Don&apos;t start a new report for the same truck.</p>
          <div className="list">{fix.map(item)}</div>
        </>
      ) : null}
      {rests.length ? (
        <>
          <div className="eyebrow">Waiting on the rest of the order · {rests.length}</div>
          <p className="tiny faint" style={{ margin: 0 }}>Partial receipts: part of the PO came in, these items are still coming. Open one and receive it when it shows up.</p>
          <div className="list">{rests.map(item)}</div>
        </>
      ) : null}
      <div className="eyebrow">On the way to {branch.name}</div>
      {coming.length ? <div className="list">{coming.map(item)}</div> : <Empty icon="truck" title="Nothing expected">Add a truck with &ldquo;Expected delivery&rdquo; and it shows on the warehouse calendar. Transfers from other locations show here on their own.</Empty>}
      {got.length ? (
        <>
          <div className="eyebrow">Receiving Reports</div>
          <div className="list">{got.map(item)}</div>
        </>
      ) : null}
    </main>
  );
}
