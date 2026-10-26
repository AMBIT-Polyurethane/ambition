import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxInfo, TaxState } from "@/lib/tax";

export async function companyTax(supabase: SupabaseClient, companyId: string | null | undefined): Promise<TaxInfo | null> {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc("company_tax_state", { p_company: companyId });
  if (error || !data?.length) return null;
  const r = data[0] as { state: TaxState; expires_on: string | null; days_left: number | null; cert_id: string | null; pending: number };
  return { state: r.state, expires_on: r.expires_on, days_left: r.days_left, cert_id: r.cert_id, pending: Number(r.pending ?? 0) };
}

export type TaxRow = {
  company_id: string;
  company_name: string;
  account_no: string | null;
  email: string | null;
  state: TaxState;
  expires_on: string | null;
  days_left: number | null;
  pending: number;
  cert_state: string | null;
  cert_number: string | null;
  last_order_at: string | null;
};

export async function taxOverview(supabase: SupabaseClient): Promise<TaxRow[] | null> {
  const { data, error } = await supabase.rpc("tax_overview");
  if (error) return null;
  return (data ?? []) as TaxRow[];
}

/** Counts for Accounting's Home card and tile badge. */
export function taxCounts(rows: TaxRow[]) {
  return {
    expired: rows.filter((r) => r.state === "expired" || r.state === "missing").length,
    soon: rows.filter((r) => r.state === "expiring" && (r.days_left ?? 99) <= 30).length,
    soon60: rows.filter((r) => r.state === "expiring").length,
    pending: rows.filter((r) => r.pending > 0).length,
  };
}
