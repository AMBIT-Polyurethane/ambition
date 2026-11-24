import { requireAdmin } from "@/lib/session";
import { historyMeta } from "@/lib/crm";
import { dateShort, dateTime } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { SalesNav } from "@/components/sales/sales-nav";
import { HistoryImport } from "@/components/sales/history-import";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import sales history" };

/** Admins: load QuickBooks sales history so the hub and dashboard see more than A.I.'s own orders. */
export default async function SalesImportPage() {
  const { supabase } = await requireAdmin();
  const [meta, { data: cos }] = await Promise.all([
    historyMeta(supabase),
    supabase.from("companies").select("id, name, qb_name").eq("active", true).order("name").limit(5000),
  ]);
  return (
    <main className="shell crm">
      <TopBar title="Import sales history" back="/sales" />
      <SalesNav on="import" all admin />
      <p className="small muted" style={{ margin: 0 }}>
        The sales hub counts QuickBooks history up to its last date, then orders placed in A.I. after it, so nothing counts twice. Importing the same dates again replaces them.
      </p>
      {meta?.through_date ? (
        <div className="alert ok small" role="status">
          <span>Loaded: {dateShort(meta.from_date)} to {dateShort(meta.through_date)} · {Number(meta.rows ?? 0).toLocaleString()} lines · by {meta.imported_by_name ?? "?"}, {dateTime(meta.imported_at)}.</span>
        </div>
      ) : (
        <div className="alert small" role="note"><span>Nothing loaded yet.</span></div>
      )}
      <HistoryImport customers={(cos ?? []) as { id: string; name: string; qb_name: string | null }[]} />
    </main>
  );
}
