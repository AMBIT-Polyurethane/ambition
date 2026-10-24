"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { currentOrigin } from "@/lib/origin";
import { PERM_KEYS, ROLES } from "@/lib/access";
import { newToken, sendInvite, type InviteResult } from "@/lib/invites";
import type { Profile } from "@/lib/types";

// Admin → Accounts → Create an account, and the Invited list.

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => s(f, k) || null;
const fail = (error: string): InviteResult => ({ ok: false, error });

export async function createAccount(_prev: InviteResult, form: FormData): Promise<InviteResult> {
  const { supabase, profile: me } = await requireAdmin();
  const email = s(form, "email").toLowerCase();
  const name = n(form, "full_name");
  const phone = n(form, "phone");
  const kind = s(form, "kind") === "employee" ? "employee" : "contractor";
  const jobRole = n(form, "job_role");
  const branchId = n(form, "branch_id");
  const note = n(form, "note")?.slice(0, 600) ?? null;
  let companyId = kind === "contractor" ? n(form, "company_id") : null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Type the person's email address.");
  if (email === me.email.toLowerCase()) return fail("That's your own account.");
  if (kind === "employee") {
    if (!email.endsWith("@ambitpu.com")) return fail("AMBIT employee accounts need an @ambitpu.com email. For anyone else, pick Contractor.");
    if (!jobRole || !ROLES.some((r) => r.key === jobRole)) return fail("Pick their job role.");
  } else if (!companyId) {
    return fail("Pick the contractor's company (or add it as a new customer).");
  }
  const role: Profile["role"] = kind === "contractor" ? "customer" : jobRole === "admin" ? "admin" : "employee";
  const perms = role === "admin" ? PERM_KEYS : role === "employee" ? form.getAll("perms").map(String).filter((k) => (PERM_KEYS as string[]).includes(k)) : [];

  let companyName: string | null = null;
  if (companyId) {
    const { data: co } = await supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle();
    if (!co) return fail("That company isn't in the customer list anymore. Pick it again.");
    companyName = co.name as string;
    companyId = co.id as string;
  }

  const origin = await currentOrigin();
  const by = me.full_name || me.email;

  // Already has a login (for example they requested access): give that login these settings now.
  const { data: existing } = await supabase.from("profiles").select("*").eq("email", email).maybeSingle<Profile>();
  if (existing) {
    const { error } = await supabase.rpc("admin_update_user", {
      p_user: existing.id,
      p_role: role,
      p_status: "active",
      p_company: role === "customer" ? companyId : null,
      p_branch: branchId,
    });
    if (error) return fail(error.message);
    if (role !== "customer") {
      const { error: accessError } = await supabase.rpc("admin_set_access", { p_user: existing.id, p_job_role: role === "admin" ? "admin" : jobRole, p_perms: perms });
      if (accessError) return fail(accessError.message);
    }
    const link = `${origin}/signin`;
    const res = await sendInvite({ email, name: existing.full_name ?? name, kind, company: companyName, by, note, link, existing: true });
    revalidatePath("/admin/users");
    return {
      ok: true,
      email,
      name: existing.full_name ?? name,
      phone: existing.phone ?? phone,
      existing: true,
      link,
      emailStatus: res.status,
      emailError: res.error,
      subject: res.subject,
      text: res.text,
    };
  }

  // New person: save the invite, then email them their link.
  const { token, hash } = newToken();
  await supabase
    .from("invites")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("email", email)
    .is("accepted_at", null)
    .is("cancelled_at", null);
  const { data: inv, error } = await supabase
    .from("invites")
    .insert({
      email,
      full_name: name,
      phone,
      role,
      company_id: role === "customer" ? companyId : null,
      branch_id: branchId,
      job_role: role === "admin" ? "admin" : role === "employee" ? jobRole : null,
      perms,
      note,
      token_hash: hash,
      invited_by: me.id,
      invited_by_name: by,
    })
    .select("id")
    .single();
  if (error || !inv) {
    return fail(/invites|schema cache/i.test(error?.message ?? "") ? "Account invites aren't set up in the database yet (supabase/migrations/0016_invites.sql)." : error?.message ?? "Could not save.");
  }

  const link = `${origin}/join/${token}`;
  const res = await sendInvite({ email, name, kind, company: companyName, by, note, link });
  await supabase.from("invites").update({ sent_at: new Date().toISOString(), email_status: res.status }).eq("id", inv.id);
  revalidatePath("/admin/users");
  return { ok: true, email, name, phone, existing: false, link, emailStatus: res.status, emailError: res.error, subject: res.subject, text: res.text };
}

/** Send again: makes a new link (the old one stops working) and another 30 days. */
export async function resendInvite(_prev: InviteResult, form: FormData): Promise<InviteResult> {
  const { supabase, profile: me } = await requireAdmin();
  const id = s(form, "id");
  const { data: inv } = await supabase
    .from("invites")
    .select("*, company:companies(name)")
    .eq("id", id)
    .maybeSingle<{ id: string; email: string; full_name: string | null; phone: string | null; role: Profile["role"]; note: string | null; accepted_at: string | null; company: { name: string } | null }>();
  if (!inv) return fail("That invite is gone. Create the account again.");
  if (inv.accepted_at) return fail("They already set up their login.");

  const { token, hash } = newToken();
  const { error } = await supabase
    .from("invites")
    .update({ token_hash: hash, expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), cancelled_at: null })
    .eq("id", inv.id);
  if (error) return fail(error.message);

  const link = `${await currentOrigin()}/join/${token}`;
  const res = await sendInvite({
    email: inv.email,
    name: inv.full_name,
    kind: inv.role === "customer" ? "contractor" : "employee",
    company: inv.company?.name ?? null,
    by: me.full_name || me.email,
    note: inv.note,
    link,
  });
  await supabase.from("invites").update({ sent_at: new Date().toISOString(), email_status: res.status }).eq("id", inv.id);
  revalidatePath("/admin/users");
  return { ok: true, email: inv.email, name: inv.full_name, phone: inv.phone, existing: false, link, emailStatus: res.status, emailError: res.error, subject: res.subject, text: res.text };
}

export async function cancelInvite(form: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("invites").update({ cancelled_at: new Date().toISOString() }).eq("id", s(form, "id")).is("accepted_at", null);
  revalidatePath("/admin/users");
}
