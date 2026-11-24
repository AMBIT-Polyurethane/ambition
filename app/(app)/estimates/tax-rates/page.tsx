import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can, canEstimate } from "@/lib/access";
import type { TaxRate } from "@/lib/estimates";
import { TopBar } from "@/components/ui";
import { TaxRates } from "@/components/estimates/tax-rates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales tax rates" };

/** The sales tax rates estimates use (pickup location, ZIP, state). */
export default async function TaxRatesPage() {
  const { supabase, profile } = await requireEmployee();
  const edit = profile.role === "admin" || can(profile, "credit_check");
  if (!edit && !canEstimate(profile)) redirect("/");
  const [{ data: rates, error }, { data: branches }] = await Promise.all([
    supabase.from("tax_rates").select("*").order("kind").order("key"),
    supabase.from("branches").select("id, name, state").eq("active", true).order("sort"),
  ]);
  const order = { branch: 0, zip: 1, state: 2 } as const;
  const list = ((rates ?? []) as TaxRate[]).sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
  return (
    <main className="shell">
      <TopBar title="Sales tax rates" back="/estimates" />
      <p className="small muted" style={{ marginTop: 0 }}>
        Estimates add sales tax from this table: a <b>pickup</b> uses its AMBIT location&apos;s rate; a <b>delivery</b> uses its ZIP&apos;s rate, or else its state&apos;s. Customers with a current tax exemption certificate pay none.
      </p>
      {error ? <div className="alert warn small">Tax rates need database update 0108 first (Supabase &gt; SQL Editor).</div> : (
        <TaxRates rates={list} branches={(branches ?? []) as { id: string; name: string; state: string }[]} canEdit={edit} />
      )}
    </main>
  );
}
