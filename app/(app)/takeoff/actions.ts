"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { takeoffAccess } from "@/lib/takeoff/access";
import { copyTakeoff } from "@/lib/takeoff/copy";

const clip = (v: FormDataEntryValue | null, n = 200) => String(v ?? "").trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["in_progress", "sent", "won", "lost"];

async function team() {
  return takeoffAccess();
}

/** New takeoff: the workspace opens next, ready for the plans. */
export async function createTakeoff(form: FormData) {
  const s = await team();
  if (!s) return;
  const name = clip(form.get("name"), 120);
  if (!name) redirect("/takeoff?err=" + encodeURIComponent("Give the takeoff a name (the project or job)."));
  const due = clip(form.get("due"), 10);
  // A contractor's takeoff goes in their workspace (AMBIT staff helping one choose it with "ops").
  const inWs = Boolean(s.ws) && (!s.staff || form.get("ops") === "1");
  const lead = clip(form.get("lead_id"), 40);
  const cust = clip(form.get("ops_customer_id"), 40);
  // Started from a template: everything in it is copied (plans, shapes, quantities), no AI needed.
  const template = clip(form.get("template"), 40);
  if (UUID.test(template)) {
    const made = await copyTakeoff(s.supabase, template, {
      name,
      customer: clip(form.get("customer"), 120) || null,
      address: clip(form.get("address"), 240) || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      is_template: false,
      from_template: template,
      ops_company_id: inWs ? s.ws!.company.id : null,
      lead_id: inWs && UUID.test(lead) ? lead : null,
      ops_customer_id: inWs && UUID.test(cust) ? cust : null,
      created_by: s.user.id,
      created_by_name: s.profile!.full_name || s.profile!.email,
    });
    if ("error" in made) redirect("/takeoff?err=" + encodeURIComponent(made.error));
    revalidatePath("/takeoff");
    redirect(`/takeoff/${made.id}?msg=${encodeURIComponent("Started from the template. Check it and adjust what's different.")}`);
  }
  const { data, error } = await s.supabase
    .from("takeoffs")
    .insert({
      name,
      customer: clip(form.get("customer"), 120) || null,
      address: clip(form.get("address"), 240) || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      created_by: s.user.id,
      created_by_name: s.profile!.full_name || s.profile!.email,
      ops_company_id: inWs ? s.ws!.company.id : null,
      lead_id: inWs && UUID.test(lead) ? lead : null,
      ops_customer_id: inWs && UUID.test(cust) ? cust : null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) redirect("/takeoff?err=" + encodeURIComponent(error?.message ?? "Couldn't create the takeoff."));
  revalidatePath("/takeoff");
  redirect(`/takeoff/${data.id}`);
}

export async function updateTakeoff(form: FormData) {
  const s = await team();
  if (!s) return;
  const id = clip(form.get("id"), 40);
  if (!UUID.test(id)) return;
  const due = clip(form.get("due"), 10);
  const status = clip(form.get("status"), 20);
  const back = clip(form.get("back"), 200);
  const { error } = await s.supabase
    .from("takeoffs")
    .update({
      name: clip(form.get("name"), 120) || "Untitled takeoff",
      customer: clip(form.get("customer"), 120) || null,
      address: clip(form.get("address"), 240) || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      status: STATUSES.includes(status) ? status : "in_progress",
      notes: clip(form.get("notes"), 2000) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/takeoff");
  revalidatePath(`/takeoff/${id}`);
  const to = back.startsWith("/takeoff") ? back : `/takeoff/${id}/report`;
  redirect(`${to}${to.includes("?") ? "&" : "?"}${error ? "err=" + encodeURIComponent(error.message) : "msg=Saved."}`);
}

/** Deletes the takeoff, its measurements and its plan files. */
export async function deleteTakeoff(form: FormData) {
  const s = await team();
  if (!s) return;
  const id = clip(form.get("id"), 40);
  if (!UUID.test(id) || form.get("confirm") !== "yes") return;
  const { data: files } = await s.supabase.from("takeoff_files").select("path").eq("takeoff_id", id);
  const paths = ((files ?? []) as { path: string }[]).map((f) => f.path);
  if (paths.length) await s.supabase.storage.from("plans").remove(paths);
  await s.supabase.from("takeoffs").delete().eq("id", id);
  revalidatePath("/takeoff");
  redirect("/takeoff?msg=" + encodeURIComponent("Takeoff deleted."));
}

/** Saves a copy of this takeoff as a template (plans, shapes and quantities), for plans built over and over. */
export async function saveTemplate(form: FormData) {
  const s = await team();
  if (!s) return;
  const id = clip(form.get("id"), 40);
  const name = clip(form.get("template_name"), 120);
  if (!UUID.test(id)) return;
  if (!name) redirect(`/takeoff/${id}/report?err=${encodeURIComponent("Give the template a name (the plan's name).")}`);
  const { data: src } = await s.supabase.from("takeoffs").select("ops_company_id").eq("id", id).maybeSingle<{ ops_company_id: string | null }>();
  if (!src) return;
  const made = await copyTakeoff(s.supabase, id, {
    name,
    template_name: name,
    is_template: true,
    ops_company_id: src.ops_company_id,
    created_by: s.user.id,
    created_by_name: s.profile!.full_name || s.profile!.email,
  });
  revalidatePath("/takeoff");
  redirect(`/takeoff/${id}/report?${"error" in made ? `err=${encodeURIComponent(made.error)}` : `msg=${encodeURIComponent(`Saved as the template "${name}". Start a new takeoff from it on the Takeoff page.`)}`}`);
}

/** Deletes a template (and its copy of the plans). Takeoffs started from it stay. */
export async function deleteTemplate(form: FormData) {
  const s = await team();
  if (!s) return;
  const id = clip(form.get("id"), 40);
  if (!UUID.test(id)) return;
  const { data: t } = await s.supabase.from("takeoffs").select("id, is_template").eq("id", id).maybeSingle<{ id: string; is_template: boolean }>();
  if (!t?.is_template) return;
  const { data: files } = await s.supabase.from("takeoff_files").select("path").eq("takeoff_id", id);
  const paths = ((files ?? []) as { path: string }[]).map((f) => f.path);
  if (paths.length) await s.supabase.storage.from("plans").remove(paths);
  await s.supabase.from("takeoffs").delete().eq("id", id);
  revalidatePath("/takeoff");
  redirect("/takeoff?msg=" + encodeURIComponent("Template deleted."));
}
