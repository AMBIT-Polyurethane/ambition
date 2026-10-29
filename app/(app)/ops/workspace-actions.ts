"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";

/** AMBIT admins: leave the contractor workspace they were helping in. */
export async function leaveWorkspace() {
  const { supabase } = await requireAdmin();
  await supabase.rpc("ops_open_workspace", { p_company: null });
  redirect("/admin/ops");
}

/** AMBIT admins: open a workspace (the owner allowed it, or it's an AMBIT demo). */
export async function enterWorkspace(form: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("ops_open_workspace", { p_company: String(form.get("company_id") ?? "") });
  if (error) redirect(`/ops?err=${encodeURIComponent(error.message)}`);
  redirect("/ops");
}
