"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requirePerm } from "@/lib/session";
import { JotformError, answerText, looksLikeEmail, normName, prfFields, prfPricing, prfSubmission, priceRows, updateSubmission } from "@/lib/jotform";
import { sendEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { buildPrfApprovedEmail } from "@/lib/prf-email";

/** Admin: "this name on the form is this person in the app". */
export async function linkRepName(form: FormData) {
  const { supabase } = await requireAdmin();
  const repName = normName(String(form.get("rep_name") ?? ""));
  const profileId = String(form.get("profile_id") ?? "");
  if (!repName || !profileId) return;
  await supabase.from("rep_name_links").upsert({ rep_name: repName, profile_id: profileId }, { onConflict: "rep_name" });
  revalidatePath("/price-requests");
}

export async function unlinkRepName(form: FormData) {
  const { supabase } = await requireAdmin();
  const repName = normName(String(form.get("rep_name") ?? ""));
  if (!repName) return;
  await supabase.from("rep_name_links").delete().eq("rep_name", repName);
  revalidatePath("/price-requests");
}

/** Approver: save the approved prices into the Jotform submission, record who did it, and email the rep. */
export async function savePrfApproval(form: FormData) {
  const { supabase, profile } = await requirePerm("prf_approve");
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 2000);
  const back = (kind: "msg" | "err", text: string): never => {
    revalidatePath(`/price-requests/${id}`);
    revalidatePath("/price-requests/approvals");
    redirect(`/price-requests/${id}?${kind}=${encodeURIComponent(text)}`);
  };

  const [sub, pairs, fields] = await Promise.all([prfSubmission(id), prfPricing(), prfFields()]);
  if (!sub) back("err", "That price request no longer exists in Jotform.");
  const values: Record<string, string> = {};
  const prices: Record<string, string> = {};
  for (const p of pairs) {
    if (!p.apprQid) continue;
    const raw = form.get(`a_${p.apprQid}`);
    if (raw === null) continue;
    const v = String(raw).trim().slice(0, 40);
    values[p.apprQid] = v;
    if (v) prices[p.product] = v;
  }
  if (Object.keys(prices).length === 0) back("err", "Enter at least one approved price.");

  try {
    await updateSubmission(id, values);
  } catch (e) {
    back("err", e instanceof JotformError ? e.message : "Couldn't save to Jotform. Try again.");
  }

  const approver = profile.full_name || profile.email;
  const { error: saveError } = await supabase.from("prf_reviews").upsert(
    { submission_id: id, approved_by: profile.id, approved_by_name: approver, approved_at: new Date().toISOString(), prices, note: note || null },
    { onConflict: "submission_id" },
  );

  // The rep: SALES REP holds their email; otherwise the Sales Person Email box; otherwise their app account.
  const fresh = (await prfSubmission(id)) ?? sub!;
  const rep = fields.rep ? answerText(fresh.answers[fields.rep]) : "";
  const repBox = fields.repEmail ? answerText(fresh.answers[fields.repEmail]) : "";
  let to = looksLikeEmail(rep) ? rep.trim() : looksLikeEmail(repBox) ? repBox.trim() : "";
  if (!to && rep) {
    const { data: link } = await supabase.from("rep_name_links").select("profile_id").eq("rep_name", normName(rep)).maybeSingle();
    if (link?.profile_id) {
      const { data: owner } = await supabase.from("profiles").select("email").eq("id", link.profile_id).maybeSingle();
      to = owner?.email ?? "";
    }
  }
  const customer = fields.customer ? answerText(fresh.answers[fields.customer]) : "";
  const contact = fields.contact ? answerText(fresh.answers[fields.contact]) : "";
  let sent: { status: string; error?: string } = { status: "failed", error: "No rep email on the request" };
  if (to) {
    const origin = await currentOrigin();
    sent = await sendEmail({
      to: [to],
      replyTo: profile.email,
      ...buildPrfApprovedEmail({ customer, contact, rows: priceRows(fresh, pairs), note, approver, link: `${origin}/price-requests/${id}` }),
    });
  }
  if (!saveError) await supabase.from("prf_reviews").update({ email_status: sent.status, email_error: sent.error ?? null }).eq("submission_id", id);

  back(
    sent.status === "sent" ? "msg" : "err",
    sent.status === "sent"
      ? `Approved prices saved to Jotform and emailed to ${to}.`
      : `Approved prices saved to Jotform, but the email to the rep didn't go out (${sent.error ?? sent.status}).`,
  );
}
