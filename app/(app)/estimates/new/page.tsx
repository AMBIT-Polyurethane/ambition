import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { canEstimate } from "@/lib/access";
import { estimateChoices } from "@/lib/estimates-server";
import { TopBar } from "@/components/ui";
import { EstimateForm } from "@/components/estimates/estimate-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New estimate" };

/** A sales rep builds an unofficial estimate: customer, pickup or delivery, items (prices from their price list). */
export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canEstimate(profile)) redirect("/");
  const { customers, products, branches } = await estimateChoices(supabase);
  const company = sp.company && customers.some((c) => c.id === sp.company) ? sp.company : undefined;
  return (
    <main className="shell">
      <TopBar title="New estimate" back="/estimates" />
      <EstimateForm customers={customers} products={products} branches={branches} initial={{ company_id: company, branch_id: profile.branch_id ?? undefined }} />
    </main>
  );
}
