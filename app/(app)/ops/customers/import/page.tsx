import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { TopBar } from "@/components/ui";
import { CustomerImport } from "./importer";

export const metadata = { title: "Import customers" };
export const dynamic = "force-dynamic";

export default async function ImportCustomersPage() {
  await requireOps(opsCan.manage);
  return (
    <main className="shell wide">
      <TopBar title="Import customers" back="/ops/customers" />
      <p className="muted small" style={{ margin: 0 }}>
        Upload an Excel (.xlsx) or CSV file from QuickBooks, Jobber, your old CRM or your own spreadsheet. You&apos;ll match the columns and see every row before anything is saved, and you can undo the import afterwards.
      </p>
      <CustomerImport />
    </main>
  );
}
