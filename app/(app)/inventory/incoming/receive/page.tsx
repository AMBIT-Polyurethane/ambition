import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { canReceive } from "@/lib/access";
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
  const [items, vendors, { data: b }] = await Promise.all([
    stockItems(supabase, branch.id),
    vendorNames(supabase),
    supabase.from("branches").select("name, state").eq("id", branch.id).maybeSingle<{ name: string; state: string }>(),
  ]);
  return (
    <main className="shell">
      <TopBar title="New Receiving Report" back={`/inventory/incoming?b=${branch.id}`} />
      {branches.length > 1 ? (
        <div className="chips">
          {branches.map((x) => (
            <a key={x.id} href={`/inventory/incoming/receive?b=${x.id}`} className={`chip sm${x.id === branch.id ? " on" : ""}`}>{x.name}</a>
          ))}
        </div>
      ) : null}
      <ReceivingForm key={branch.id} admin={profile.role === "admin"} branch={branch.id} branchName={b ? `${b.name}, ${b.state}` : branch.name} items={items} today={todayCentral()} aiReady={claudeReady()} vendors={vendors} />
    </main>
  );
}
