import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { canSetCredit } from "@/lib/credit";
import { TopBar } from "@/components/ui";
import { CreditImporter } from "@/components/credit/importer";
import { InvoiceImporter } from "@/components/credit/invoice-importer";

export const metadata = { title: "Import balances" };
export const dynamic = "force-dynamic";

/** Admins and accounting: the QuickBooks A/R Aging Summary (and credit limits) into each customer's credit. */
export default async function CreditImportPage() {
  const { supabase, profile } = await requireEmployee();
  if (!canSetCredit(profile)) redirect("/credit");
  const { data } = await supabase.from("companies").select("id, name, account_no, qb_name").eq("active", true).order("name").range(0, 4999);
  return (
    <main className="shell wide">
      <TopBar title="Import balances" back="/credit" />
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        <li><b>Best: every open invoice.</b> In QuickBooks: <b>Reports › Accounts receivable aging detail</b>, set the date to today, <b>Export › Export to Excel</b>. Pick it under Open invoices below. Aging then updates by itself every day from each invoice&apos;s due date.</li>
        <li>Pick it below, check any customer it couldn&apos;t match, then tap <b>Import</b>. Do this as often as you like (weekly is plenty): payments recorded here since the last import stay applied.</li>
      </ol>
      <InvoiceImporter customers={(data ?? []) as { id: string; name: string; qb_name: string | null }[]} />
      <details className="card"><summary><b>Or: balances only (A/R Aging Summary) and credit limits</b></summary>
        <ol className="small muted" style={{ margin: "12px 0", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In QuickBooks: <b>Reports › A/R Aging Summary</b>, set the date to today, then <b>Export › Export to Excel</b> (or CSV).</li>
        <li>For credit lines: <b>Reports › Customer Contact List › Customize</b>, add the <b>Credit Limit</b> (and Terms) column, then export it. (Or add a <b>Credit Limit</b> column to the aging file.)</li>
        <li>Pick each file below, check the matches, then tap <b>Import</b>. You can import the two files one after the other.</li>
        </ol>
        <div><CreditImporter customers={(data ?? []) as { id: string; name: string; account_no: string | null }[]} /></div>
      </details>
    </main>
  );
}
