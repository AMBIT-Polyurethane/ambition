"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { takeoffAccess } from "@/lib/takeoff/access";

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
