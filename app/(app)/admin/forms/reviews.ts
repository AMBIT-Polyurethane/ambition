import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formIdFrom, type ExtraForm, type FormKind } from "@/lib/forms";

export type FormReview = {
  submission_id: string;
  form_id: string;
  status: "approved" | "declined";
  credit_limit: number | null;
  terms: string | null;
  note: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string;
};

/** Decisions on a form's submissions (empty until the database update is run). */
export async function reviewsFor(supabase: SupabaseClient, formId?: string): Promise<Map<string, FormReview>> {
  let q = supabase.from("form_reviews").select("submission_id, form_id, status, credit_limit, terms, note, reviewed_by_name, reviewed_at");
  if (formId) q = q.eq("form_id", formId);
  const { data, error } = await q;
  if (error) return new Map();
  return new Map(((data ?? []) as FormReview[]).map((r) => [r.submission_id, r]));
}

export const TERMS = ["Net 10", "Net 15", "Net 30", "Net 45", "Net 60", "Due on receipt", "COD", "Prepay", "Credit card on file"];

/** Forms the hub shows by id: ones an admin added (with the type they picked) and Jotform links on the home screen. */
export async function extraForms(supabase: SupabaseClient): Promise<ExtraForm[]> {
  const [added, links] = await Promise.all([
    supabase.from("hub_forms").select("form_id, kind"),
    supabase.from("links").select("url").ilike("url", "%jotform%"),
  ]);
  const out: ExtraForm[] = [];
  for (const r of (added.error ? [] : added.data ?? []) as { form_id: string; kind: string | null }[]) {
    out.push({ id: r.form_id, kind: (["credit", "account", "other"].includes(r.kind ?? "") ? r.kind : null) as FormKind | null });
  }
  for (const l of (links.error ? [] : links.data ?? []) as { url: string | null }[]) {
    const id = formIdFrom(l.url ?? "");
    if (id && !out.some((o) => o.id === id)) out.push({ id });
  }
  return out;
}
