import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, company:companies(id, name, account_no, default_branch_id)")
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
