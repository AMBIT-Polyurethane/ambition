"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/env";
import { emailConfigured, sendEmail, wrapEmail } from "@/lib/email";
import { currentOrigin } from "@/lib/origin";
import { claudeReady } from "@/lib/ai/claude";
import { fillFromConversation, type ComplaintFill } from "@/lib/complaints-ai";
import { COMPLAINT_FIELDS, SYMPTOMS } from "@/lib/complaints";
import { matchCustomers } from "@/lib/intake/read";

const UUID = /^[0-9a-f-]{36}$/i;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const back = (id: string, q: Record<string, string>) => redirect(`/complaints/${id}?${new URLSearchParams(q)}`);

/** Starts a complaint report, filled in from an Ask AMBIT conversation when there is one. */
export async function startComplaint(threadId?: string | null): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await requireActive();
  const staff = profile.role === "employee" || profile.role === "admin";
  let fill: ComplaintFill = {};
  let photos: string[] = [];
  let thread: string | null = null;

  if (threadId && UUID.test(threadId)) {
    const { data: t } = await supabase.from("ai_threads").select("id, user_id").eq("id", threadId).maybeSingle();
    if (t) {
      thread = t.id as string;
      const { data: msgs } = await supabase.from("ai_messages").select("role, body, images, author_name").eq("thread_id", thread).order("id");
      const rows = (msgs ?? []) as { role: string; body: string; images: string[] | null; author_name: string | null }[];
      photos = rows.flatMap((m) => m.images ?? []).slice(0, 8);
      const transcript = rows
        .map((m) => {
          const who = m.role === "user" ? "Person" : m.role === "expert" ? `AMBIT expert${m.author_name ? ` (${m.author_name})` : ""}` : "Ask AMBIT";
          return `${who}${m.images?.length ? ` [sent ${m.images.length} photo${m.images.length > 1 ? "s" : ""}]` : ""}: ${m.body.replace(/⟦[\d,\s]+⟧/g, "")}`;
        })
        .join("\n\n");
      if (claudeReady() && transcript.trim()) {
        try {
          fill = (await fillFromConversation(supabase, transcript)).fill;
        } catch (e) {
          console.error("complaint fill failed", e);
        }
      }
    }
  }

  // Whose complaint it is: a contractor's own company; staff get the best match for the name given.
  let companyId: string | null = null;
  let companyName = typeof fill.company_name === "string" ? fill.company_name : null;
  if (!staff && profile.company_id) {
    companyId = profile.company_id;
    companyName = profile.company?.name ?? companyName;
  } else if (companyName) {
    const { data: comps } = await supabase.from("companies").select("id, name, account_no, phone, email, contact_name, default_branch_id").eq("active", true);
    const best = matchCustomers((comps ?? []) as never[], { name: companyName })[0];
    if (best && best.score >= 0.6) {
      companyId = best.id;
      companyName = best.name;
    }
  }

  const row: Record<string, unknown> = {
    created_by: profile.id,
    created_by_name: profile.full_name || profile.email,
    created_by_role: profile.role,
    company_id: companyId,
    company_name: companyName,
    contact_name: !staff ? profile.full_name : null,
    contact_phone: !staff ? profile.phone : null,
    contact_email: !staff ? profile.email : null,
    photos,
    thread_id: thread,
    symptoms: fill.symptoms ?? [],
  };
  for (const f of COMPLAINT_FIELDS) {
    const v = fill[f.key as string];
    if (typeof v === "string" && v && f.key !== "company_name") row[f.key] = v;
  }
  if (typeof fill.description === "string") row.description = fill.description;
  if (typeof fill.ai_notes === "string") row.ai_notes = fill.ai_notes;

  const { data, error } = await supabase.from("complaint_reports").insert(row).select("id").single();
  if (error || !data) return { error: "Couldn't start the report. Try again." };
  revalidatePath("/complaints");
  return { id: data.id as string };
}

function fieldsFrom(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of COMPLAINT_FIELDS) {
    const raw = String(formData.get(f.key as string) ?? "").trim();
    if (f.type === "date") out[f.key] = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    else out[f.key] = raw.slice(0, f.wide ? 500 : 300) || null;
  }
  out.symptoms = formData.getAll("symptoms").map(String).filter((s) => SYMPTOMS.some((x) => x.id === s));
  out.description = String(formData.get("description") ?? "").trim().slice(0, 6000) || null;
  if (formData.has("ai_notes")) out.ai_notes = String(formData.get("ai_notes") ?? "").trim().slice(0, 6000) || null;
  out.updated_at = new Date().toISOString();
  return out;
}

export async function saveComplaint(formData: FormData) {
  const { supabase } = await requireActive();
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) redirect("/complaints");
  const { error } = await supabase.from("complaint_reports").update(fieldsFrom(formData)).eq("id", id);
  revalidatePath(`/complaints/${id}`);
  back(id, error ? { err: "Couldn't save it." } : { msg: "Saved." });
}

export async function submitComplaint(formData: FormData) {
  const { supabase, profile } = await requireActive();
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) redirect("/complaints");
  const fields = fieldsFrom(formData);
  if (!fields.product || !(fields.description || (fields.symptoms as string[]).length)) {
    await supabase.from("complaint_reports").update(fields).eq("id", id);
    back(id, { err: "Fill in at least the product and what's wrong (symptoms or a description) before submitting." });
  }
  const { error: saveErr } = await supabase.from("complaint_reports").update(fields).eq("id", id);
  if (saveErr) back(id, { err: "Couldn't save it." });
  const { data: no, error } = await supabase.rpc("complaint_submit", { p_id: id });
  if (error) back(id, { err: error.message });

  if (ADMIN_NOTIFY_EMAIL && emailConfigured()) {
    const origin = await currentOrigin();
    await sendEmail({
      to: [ADMIN_NOTIFY_EMAIL],
      subject: `Complaint report ${no}: ${String(fields.product ?? "")} · ${String(fields.company_name ?? profile.company?.name ?? "")}`,
      text: `${profile.full_name || profile.email} submitted complaint report ${no}. Open it: ${origin}/complaints/${id}`,
      html: wrapEmail(
        "Complaint report",
        `<p style="margin:0 0 12px;font-size:15px;"><b>${esc(profile.full_name || profile.email)}</b> submitted complaint report <b>${esc(String(no))}</b>.</p>
<p style="margin:0 0 6px;font-size:14px;">${esc(String(fields.product ?? ""))}${fields.lot_numbers ? ` · lots ${esc(String(fields.lot_numbers))}` : ""} · ${esc(String(fields.company_name ?? ""))}</p>
<p style="margin:0 0 16px;font-size:14px;white-space:pre-wrap;">${esc(String(fields.description ?? ""))}</p>
<p style="margin:0;"><a href="${origin}/complaints/${id}" style="display:inline-block;background:#E33527;color:#fff;text-decoration:none;font-weight:800;letter-spacing:1px;padding:12px 18px;border-radius:8px;">OPEN THE REPORT</a></p>`,
      ),
    });
  }
  revalidatePath("/complaints");
  revalidatePath(`/complaints/${id}`);
  back(id, { msg: `Submitted to AMBIT as ${no}.` });
}

export async function setComplaintStatus(formData: FormData) {
  const { supabase, profile } = await requireActive();
  const id = String(formData.get("id") ?? "");
  if (!can(profile, "complaints") && profile.role !== "admin") back(id, { err: "Not allowed." });
  const status = String(formData.get("status") ?? "");
  if (!["submitted", "reviewing", "closed"].includes(status)) back(id, { err: "Pick a status." });
  const resolution = String(formData.get("resolution") ?? "").trim().slice(0, 6000) || null;
  const { error } = await supabase
    .from("complaint_reports")
    .update({
      status,
      resolution,
      ...(status === "closed" ? { closed_by_name: profile.full_name || profile.email, closed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath(`/complaints/${id}`);
  revalidatePath("/complaints");
  back(id, error ? { err: "Couldn't update it." } : { msg: status === "closed" ? "Closed." : "Updated." });
}

export async function setComplaintPhotos(id: string, photos: string[]): Promise<{ ok?: boolean; error?: string }> {
  const { supabase } = await requireActive();
  if (!UUID.test(id)) return { error: "Report not found." };
  const clean = photos.filter((p) => typeof p === "string" && !p.includes("..")).slice(0, 12);
  const { error } = await supabase.from("complaint_reports").update({ photos: clean, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/complaints/${id}`);
  return error ? { error: "Couldn't save the photos." } : { ok: true };
}

export async function deleteComplaint(formData: FormData) {
  const { supabase } = await requireActive();
  const id = String(formData.get("id") ?? "");
  await supabase.from("complaint_reports").delete().eq("id", id).eq("status", "draft");
  revalidatePath("/complaints");
  redirect("/complaints?msg=" + encodeURIComponent("Draft deleted."));
}
