import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cust, Person } from "@/components/forms/form-runner";

export type Sub = { id: number; form_key: string; ref_no: string | null; status: string; data: Record<string, unknown>; score: number | null; company_id: string | null; price_request_id: number | null;
  submitted_by: string | null; submitted_name: string | null; submitted_at: string | null; for_day: string | null; decided_by_name: string | null; decided_at: string | null;
  decision_note: string | null; created_by: string | null; created_at: string; public_token: string | null; token_expires: string | null };

export const STATUS_LABEL: Record<string, { label: string; pill: string }> = {
  draft: { label: "Draft", pill: "pill grey" }, sent: { label: "Sent to customer", pill: "pill info" }, submitted: { label: "Waiting for review", pill: "pill warn" },
  approved: { label: "Approved", pill: "pill ok" }, denied: { label: "Denied", pill: "pill red" }, closed: { label: "Closed", pill: "pill grey" }, withdrawn: { label: "Withdrawn", pill: "pill grey" },
};

/** People to pick (managers, reps, techs) and customers to pick, for any form. */
export async function pickLists(supabase: SupabaseClient): Promise<{ people: Person[]; customers: Cust[] }> {
  const [{ data: staff }, { data: cos }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]).eq("status", "active").order("full_name"),
    supabase.from("companies").select("id, name, phone, email, contact_name, city, state").eq("active", true).order("name").range(0, 4999),
  ]);
  return {
    people: ((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => ({ id: p.id, name: p.full_name || p.email })),
    customers: (cos ?? []) as Cust[],
  };
}
