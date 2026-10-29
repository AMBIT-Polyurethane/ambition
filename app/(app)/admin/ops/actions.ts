"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { newToken, type InviteResult } from "@/lib/invites";
import { sendOpsInvite } from "@/lib/ops/invite";
import { starterProducts } from "@/lib/ops/seed";
import { DEFAULT_SETTINGS } from "@/lib/ops/defaults";

// Admin → AMBIT-OPS: turn a contractor's workspace on or off, name its owner, AMBIT demo workspaces,
// and open a workspace to help (only when the owner allows it).

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (kind: "msg" | "err", text: string): never => redirect(`/admin/ops?${kind}=${encodeURIComponent(text)}`);

async function enable(companyId: string, demo: boolean) {
  const { supabase } = await requireAdmin();
  const { data: co } = await supabase.from("companies").select("id, name, phone, email, ops_settings").eq("id", companyId).maybeSingle();
  if (!co) return "That customer isn't in the list anymore.";
  const products = await starterProducts(supabase, companyId);
  const settings = { ...DEFAULT_SETTINGS, display_name: co.name as string, phone: (co.phone as string) ?? "", email: (co.email as string) ?? "" };
  const { error } = await supabase.rpc("admin_ops_enable", { p_company: companyId, p_on: true, p_demo: demo, p_settings: settings, p_products: products });
  return error ? error.message : null;
}

/** Turn AMBIT-OPS on for a customer and name the owner: one of their logins, or invite someone. */
export async function turnOn(_prev: InviteResult, form: FormData): Promise<InviteResult> {
  const { supabase, profile: me } = await requireAdmin();
  const companyId = s(form, "company_id");
  const ownerId = s(form, "owner_id");
  const email = s(form, "owner_email").toLowerCase();
  const name = s(form, "owner_name") || null;
  const phone = s(form, "owner_phone") || null;
  if (!companyId) return { ok: false, error: "Pick the customer." };
  if (!ownerId && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Pick the owner, or type the owner's email to invite them." };

  const err = await enable(companyId, false);
  if (err) return { ok: false, error: err };
  const { data: co } = await supabase.from("companies").select("name").eq("id", companyId).single();
  const company = (co?.name as string) ?? "your company";
  const origin = await currentOrigin();

  if (ownerId) {
    const { error } = await supabase.rpc("admin_ops_set_owner", { p_company: companyId, p_user: ownerId });
    if (error) return { ok: false, error: error.message };
    const { data: p } = await supabase.from("profiles").select("email, full_name, phone").eq("id", ownerId).single();
    const link = `${origin}/ops`;
    const res = await sendOpsInvite({ email: p!.email as string, name: (p!.full_name as string) ?? null, role: "owner", company, by: me.full_name || me.email, link, existing: true });
    revalidatePath("/admin/ops");
    return { ok: true, email: p!.email as string, name: (p!.full_name as string) ?? null, phone: (p!.phone as string) ?? null, existing: true, link, emailStatus: res.status, emailError: res.error, subject: res.subject, text: res.text };
  }

  // Someone new (or a login without a company): a private invite link that makes them the owner.
  const { data: existing } = await supabase.from("profiles").select("id, role, company_id").eq("email", email).maybeSingle();
  if (existing && existing.role !== "customer") return { ok: false, error: "That email belongs to an AMBIT employee account." };
  if (existing && existing.company_id && existing.company_id !== companyId) return { ok: false, error: "That email already belongs to another company's login." };
  if (existing && existing.company_id === companyId) {
    const { error } = await supabase.rpc("admin_ops_set_owner", { p_company: companyId, p_user: existing.id });
    if (error) return { ok: false, error: error.message };
    const link = `${origin}/ops`;
    const res = await sendOpsInvite({ email, name, role: "owner", company, by: me.full_name || me.email, link, existing: true });
    revalidatePath("/admin/ops");
    return { ok: true, email, name, phone, existing: true, link, emailStatus: res.status, emailError: res.error, subject: res.subject, text: res.text };
  }
  const { token, hash } = newToken();
  await supabase.from("invites").update({ cancelled_at: new Date().toISOString() }).eq("email", email).is("accepted_at", null).is("cancelled_at", null);
  const { data: inv, error } = await supabase
    .from("invites")
    .insert({ email, full_name: name, phone, role: "customer", company_id: companyId, ops_role: "owner", token_hash: hash, invited_by: me.id, invited_by_name: me.full_name || me.email })
    .select("id")
    .single();
  if (error || !inv) return { ok: false, error: error?.message ?? "Could not save the invite." };
  const link = `${origin}/join/${token}`;
  const res = await sendOpsInvite({ email, name, role: "owner", company, by: me.full_name || me.email, link });
  await supabase.from("invites").update({ sent_at: new Date().toISOString(), email_status: res.status }).eq("id", inv.id);
  revalidatePath("/admin/ops");
  return { ok: true, email, name, phone, existing: false, link, emailStatus: res.status, emailError: res.error, subject: res.subject, text: res.text };
}

export async function turnOff(form: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_ops_enable", { p_company: s(form, "company_id"), p_on: false, p_demo: null, p_settings: null, p_products: null });
  if (error) back("err", error.message);
  revalidatePath("/admin/ops");
  back("msg", "AMBIT-OPS is off for that customer. Nothing was deleted; turn it back on any time.");
}

export async function turnBackOn(form: FormData) {
  const err = await enable(s(form, "company_id"), form.get("demo") === "1");
  if (err) back("err", err);
  revalidatePath("/admin/ops");
  back("msg", "AMBIT-OPS is back on.");
}

/** An AMBIT demo workspace for showing and testing OPS (open to AMBIT admins without asking). */
export async function createDemo(form: FormData) {
  const { supabase } = await requireAdmin();
  const name = s(form, "name") || "AMBIT Demo Insulation";
  const { data: co, error } = await supabase
    .from("companies")
    .insert({ name, active: false, source: "admin", notes: "AMBIT-OPS demo workspace (not a real customer)" })
    .select("id")
    .single();
  if (error || !co) back("err", error?.message ?? "Could not create the demo.");
  const err = await enable(co!.id as string, true);
  if (err) back("err", err);
  const { error: openErr } = await supabase.rpc("ops_open_workspace", { p_company: co!.id });
  if (openErr) back("err", openErr.message);
  redirect("/ops?msg=" + encodeURIComponent(`You're in the "${name}" demo workspace.`));
}

export async function openWorkspace(form: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("ops_open_workspace", { p_company: s(form, "company_id") });
  if (error) back("err", error.message);
  redirect("/ops");
}
