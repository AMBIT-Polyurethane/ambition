import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { can, type Perm } from "@/lib/access";

/** Who's signed in, from their verified sign-in token (id and email). */
export type SessionUser = { id: string; email: string | undefined };

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const user: SessionUser = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, company:companies!company_id(id, name, account_no, default_branch_id, ops_enabled)")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  // A distributor's people (0096) are not AMBIT logins: every "is this an active AMBIT login?" check says no.
  // (requireActive sends them back to their own store.)
  if (profile?.partner_id || profile?.web_only) return { supabase, user, profile: { ...profile, status: "disabled" as Profile["status"], role: "customer" as Profile["role"], perms: [] } };
  return { supabase, user, profile };
});

export async function requireActive() {
  const s = await getSession();
  if (!s) redirect("/signin");
  // A distributor's people (their store owner and their customers) never see AMBIT's side: back to their store.
  if (s.profile?.partner_id) redirect(`/store/${s.profile.partner_id}${s.profile.partner_role === "owner" ? "/desk" : "/account"}`);
  // An ADC store account (anyone can make one) is not an AMBIT login: back to their store account.
  if (s.profile?.web_only) redirect("/adc/account");
  if (!s.profile || s.profile.status !== "active") redirect("/pending");
  return { ...s, profile: s.profile as Profile };
}

export function isEmployee(p: Pick<Profile, "role">) {
  return p.role === "employee" || p.role === "admin";
}

export async function requireEmployee() {
  const s = await requireActive();
  if (!isEmployee(s.profile)) redirect("/");
  return s;
}

/** Expense approvers (Admin > Expense reports picks them). */
export const isExpenseApprover = (p: Pick<Profile, "role" | "expense_approver">) => isEmployee(p) && Boolean(p.expense_approver);

export async function requireExpenseApprover() {
  const s = await requireEmployee();
  if (!isExpenseApprover(s.profile)) redirect("/expenses");
  return s;
}

export async function requireAdmin() {
  const s = await requireActive();
  if (s.profile.role !== "admin") redirect("/");
  return s;
}

/** Staff page that needs one of these permissions (admins always pass). */
export async function requirePerm(...perms: Perm[]) {
  const s = await requireActive();
  if (!perms.some((p) => can(s.profile, p))) redirect("/");
  return s;
}
