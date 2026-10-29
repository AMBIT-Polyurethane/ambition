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
  return { supabase, user, profile };
});

export async function requireActive() {
  const s = await getSession();
  if (!s) redirect("/signin");
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
