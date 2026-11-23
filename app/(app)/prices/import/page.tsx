import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { allRows, canPrice } from "@/lib/prices";
import { TopBar } from "@/components/ui";
import { PriceImport, type ImportRow } from "@/components/prices/price-import";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import foam price sheet" };

/** The foam price spreadsheet (0107): check which customer each row is, then import their foam prices and notes. */
export default async function PriceImportPage() {
  const { supabase, profile } = await requireEmployee();
  if (!canPrice(profile)) redirect("/customers");
  const [rowsRes, custs] = await Promise.all([
    supabase.from("price_import_rows").select("*, company:companies(name, state)").order("source").order("name").limit(5000),
    allRows<{ id: string; name: string; state: string | null }>((f, t) => supabase.from("companies").select("id, name, state").eq("active", true).order("name").range(f, t)),
  ]);
  return (
    <main className="shell full">
      <TopBar title="Import foam price sheet" back="/prices/dashboard" right={<Link href="/prices/dashboard" className="btn sm dark"><LayoutDashboard size={15} /> Pricing dashboard</Link>} />
      {rowsRes.error ? (
        <div className="alert warn small">The import list needs the 0107 database update first (Supabase &gt; SQL Editor).</div>
      ) : (
        <PriceImport rows={(rowsRes.data ?? []) as ImportRow[]} customers={custs.map((c) => ({ id: c.id, label: c.state ? `${c.name} (${c.state})` : c.name }))} />
      )}
    </main>
  );
}
