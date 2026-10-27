import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { inventoryBranches } from "@/lib/widgets";
import { stockItems, vendorNames } from "@/lib/incoming";
import { TopBar } from "@/components/ui";
import { IncomingForm } from "@/components/incoming-forms";

export const metadata = { title: "Expected delivery" };

export default async function NewIncomingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin" && !can(profile, "inventory")) redirect("/");
  const branches = await inventoryBranches(supabase, profile);
  const branch = branches.find((b) => b.id === sp.b) ?? branches[0];
  if (!branch) redirect("/inventory");
  const [items, vendors] = await Promise.all([stockItems(supabase, branch.id), vendorNames(supabase)]);
  return (
    <main className="shell">
      <TopBar title="Expected delivery" back={`/inventory/incoming?b=${branch.id}`} />
      <p className="small muted" style={{ margin: 0 }}>A truck that&apos;s on its way. It shows on the warehouse calendar, and when it arrives, one tap adds it to stock.</p>
      <IncomingForm items={items} branches={[branch, ...branches.filter((b) => b.id !== branch.id)]} vendors={vendors} />
    </main>
  );
}
