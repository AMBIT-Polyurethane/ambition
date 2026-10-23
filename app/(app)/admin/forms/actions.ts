"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { formIdFrom, formInfo, formSubmission, hubForm, reviewable } from "@/lib/forms";
import { extraForms } from "./reviews";

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

  const f = await hubForm(formId, await extraForms(supabase));
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

const KINDS = ["credit", "account", "other"];

/** Admin: add a Jotform form to the hub by pasting its link. */
export async function addHubForm(form: FormData) {
  const { supabase, profile } = await requireAdmin();
  const id = formIdFrom(String(form.get("link") ?? ""));
  const kind = KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "other";
  const back = (k: "msg" | "err", text: string, to = "/admin/forms"): never => {
    revalidatePath("/admin/forms");
    redirect(`${to}?${k}=${encodeURIComponent(text)}`);
  };
  if (!id) back("err", "That doesn't look like a Jotform form link. It should end in a long number, like …jotform.com/262894659292980.");
  const info = await formInfo(id!);
  if (!info) back("err", "The app's Jotform key can't open that form. Check the link, or share the form with the Jotform login the app uses.");
  const { error } = await supabase.from("hub_forms").upsert({ form_id: id, kind, added_by: profile.id }, { onConflict: "form_id" });
  if (error) back("err", /hub_forms/.test(error.message ?? "") ? "Adding forms isn't switched on yet (the database update hasn't been run)." : error.message || "Couldn't save that form. Please try again.");
  back("msg", `Added “${info!.title}”.`, `/admin/forms/${id}`);
}

/** Admin: say what kind of form it is (credit applications and account setups get approvals). */
export async function setHubFormKind(form: FormData) {
  const { supabase, profile } = await requireAdmin();
  const id = formIdFrom(String(form.get("form_id") ?? ""));
  const kind = KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "other";
  if (!id) redirect("/admin/forms");
  await supabase.from("hub_forms").upsert({ form_id: id, kind, added_by: profile.id }, { onConflict: "form_id" });
  revalidatePath("/admin/forms");
  redirect(`/admin/forms/${id}?msg=${encodeURIComponent("Form type saved.")}`);
}

/** Admin: take a form that was added by link off the hub. */
export async function removeHubForm(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = formIdFrom(String(form.get("form_id") ?? ""));
  if (id) await supabase.from("hub_forms").delete().eq("form_id", id);
  revalidatePath("/admin/forms");
  redirect("/admin/forms");
}
