import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { requireActive } from "@/lib/session";
import { canReceive } from "@/lib/access";
import { dateShort } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { claudeReady } from "@/lib/ai/claude";
import { inventoryBranches } from "@/lib/widgets";
import { stockItems, vendorNames } from "@/lib/incoming";
import { TopBar } from "@/components/ui";
import { ReceivingForm } from "@/components/inventory/receiving-form";

export const metadata = { title: "New Receiving Report" };
export const dynamic = "force-dynamic";

/** A truck is here that nobody added ahead of time: snap the BOL and receive it. */
export default async function NewReceivingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!canReceive(profile)) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) redirect("/inventory");
  const [items, vendors, { data: b }, { data: back }] = await Promise.all([
    stockItems(supabase, branch.id),
    vendorNames(supabase),
    supabase.from("branches").select("name, state").eq("id", branch.id).maybeSingle<{ name: string; state: string }>(),
    // Reports an admin sent back here: the truck may already have a report to fix (don't start a second one).
    supabase
      .from("inbound_deliveries")
      .select("id, vendor, bol_no, sent_back_note, sent_back_by_name, sent_back_at")
      .eq("branch_id", branch.id)
      .eq("status", "expected")
      .not("sent_back_note", "is", null)
      .order("sent_back_at", { ascending: false })
      .limit(10),
  ]);
  const sentBack = (back ?? []) as { id: number; vendor: string; bol_no: string | null; sent_back_note: string; sent_back_by_name: string | null; sent_back_at: string | null }[];
  return (
    <main className="shell">
      <TopBar title="New Receiving Report" back={`/inventory/incoming?b=${branch.id}`} howTo="receive-inventory" />
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((x) => (
            <a key={x.id} href={`/inventory/incoming/receive?b=${x.id}`} className={`chip sm${x.id === branch.id ? " on" : ""}`}>{x.name}</a>
          ))}
        </div>
      ) : null}
      {sentBack.length ? (
        <div className="alert warn" role="alert">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            <b>Is this one of the reports that {sentBack.length === 1 ? "was" : "were"} sent back to fix?</b>
            <span className="small">If so, open it and fix it there instead of starting a new one, so the truck is only counted once.</span>
            <div className="list">
              {sentBack.map((r) => (
                <Link key={r.id} href={`/inventory/incoming/${r.id}`} className="item">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <span className="t ellipsis">#{r.id} {r.vendor}{r.bol_no ? ` · BOL ${r.bol_no}` : ""}</span>
                    <div className="s ellipsis">Sent back{r.sent_back_by_name ? ` by ${r.sent_back_by_name}` : ""}{r.sent_back_at ? ` ${dateShort(r.sent_back_at)}` : ""}: {r.sent_back_note}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <ReceivingForm key={branch.id} admin={profile.role === "admin"} branch={branch.id} branchName={b ? `${b.name}, ${b.state}` : branch.name} items={items} today={todayCentral()} aiReady={claudeReady()} vendors={vendors} />
    </main>
  );
}
