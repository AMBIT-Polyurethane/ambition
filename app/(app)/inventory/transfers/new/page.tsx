import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { todayCentral } from "@/lib/sale";
import { inventoryBranches } from "@/lib/widgets";
import { sendableItems, stockedAt } from "@/lib/incoming";
import { Empty, TopBar } from "@/components/ui";
import { TransferForm } from "@/components/inventory/transfer-form";

export const metadata = { title: "Send stock" };
export const dynamic = "force-dynamic";

/** Send stock from one location to another. */
export default async function NewTransferPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!can(profile, "transfers")) redirect("/inventory");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) redirect("/inventory");
  const others = (await inventoryBranches(supabase, profile, { all: true })).filter((b) => b.id !== branch.id);
  if (!others.length) return <main className="shell"><TopBar title="Send stock" back="/inventory/transfers" /><Empty icon="truck" title="Only one location has live inventory">Transfers need a second location with its spreadsheet connected.</Empty></main>;
  const [items, stocks, { data: names }] = await Promise.all([
    sendableItems(supabase, branch.id),
    stockedAt(supabase, others.map((b) => b.id)),
    supabase.from("branches").select("id, name, state"),
  ]);
  const label = new Map(((names ?? []) as { id: string; name: string; state: string }[]).map((b) => [b.id, `${b.name}, ${b.state}`]));
  return (
    <main className="shell">
      <TopBar title="Send stock" back={`/inventory/transfers?b=${branch.id}`} howTo="transfers" />
      {branches.length > 1 ? (
        <div className="chips">
          <span className="tiny faint" style={{ alignSelf: "center" }}>From</span>
          {branches.map((b) => (
            <a key={b.id} href={`/inventory/transfers/new?b=${b.id}`} className={`chip sm${b.id === branch.id ? " on" : ""}`}>{b.name}</a>
          ))}
        </div>
      ) : null}
      <TransferForm
        key={branch.id}
        from={branch.id}
        fromName={label.get(branch.id) ?? branch.name}
        items={items}
        destinations={others.map((b) => ({ id: b.id, name: label.get(b.id) ?? b.name, stocks: stocks[b.id] ?? [] }))}
        today={todayCentral()}
      />
    </main>
  );
}
