"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { formSubmission, hubForm, reviewable } from "@/lib/forms";

const money = (v: FormDataEntryValue | null): number | null => {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

/** Admin: approve a credit application / account setup, with credit limit, terms and a note. */
export async function approveFormReview(form: FormData) {
  await saveFormReview(form, "approved");
}

/** Admin: decline it (the note says why). */
export async function declineFormReview(form: FormData) {
  await saveFormReview(form, "declined");
}

async function saveFormReview(form: FormData, decision: "approved" | "declined") {
  const { supabase, profile } = await requireAdmin();
  const formId = String(form.get("form_id") ?? "");
  const id = String(form.get("id") ?? "");
  const page = `/admin/forms/${formId}/${id}`;
  const back = (kind: "msg" | "err", text: string): never => {
    revalidatePath(page);
    revalidatePath(`/admin/forms/${formId}`);
    revalidatePath("/admin/forms");
    redirect(`${page}?${kind}=${encodeURIComponent(text)}`);
  };

  const f = await hubForm(formId);
  if (!f || !reviewable(f.kind)) back("err", "This form doesn't take approvals.");
  const sub = await formSubmission(formId, id);
  if (!sub) back("err", "That submission wasn't found in Jotform.");

  const limit = money(form.get("credit_limit"));
  if (Number.isNaN(limit)) back("err", "Type the credit limit as a number, like 25000.");
  const terms = String(form.get("terms_other") ?? "").trim() || String(form.get("terms") ?? "").trim();

  const { error } = await supabase.from("form_reviews").upsert(
    {
      submission_id: id,
      form_id: formId,
      form_title: f!.title,
      status: decision,
      credit_limit: decision === "approved" ? limit : null,
      terms: decision === "approved" ? terms.slice(0, 80) || null : null,
      note: String(form.get("note") ?? "").trim().slice(0, 2000) || null,
      reviewed_by: profile.id,
      reviewed_by_name: profile.full_name ?? profile.email,
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: "submission_id" },
  );
  if (error) {
    back("err", /form_reviews/.test(error.message) ? "Approvals aren't switched on yet (the database update hasn't been run)." : error.message);
  }
  back("msg", decision === "approved" ? "Approved. It's on the PDF now." : "Marked as declined.");
}

/** Admin: undo a decision so the submission is waiting again. */
export async function clearFormReview(form: FormData) {
  const { supabase } = await requireAdmin();
  const formId = String(form.get("form_id") ?? "");
  const id = String(form.get("id") ?? "");
  await supabase.from("form_reviews").delete().eq("submission_id", id);
  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/admin/forms");
  redirect(`/admin/forms/${formId}/${id}?msg=${encodeURIComponent("Decision cleared. It's waiting again.")}`);
}
