import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";
import { SUPABASE_URL } from "@/lib/env";
import { settingsOf, type OpsSettings } from "@/lib/ops/defaults";
import type { OpsRole } from "@/lib/ops/roles";
import type { Profile } from "@/lib/types";

// AMBIT-OPS: the contractor workspace the signed-in person is working in. Contractors work in their
// own company's; AMBIT admins can open one when the owner allows it (or an AMBIT demo workspace).
// The database decides the same thing (public.ops_company()), so the screens and the data agree.

export type OpsCompany = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  ops_enabled: boolean;
  ops_demo: boolean;
  ops_settings: unknown;
  ops_logo_path: string | null;
  ops_support_until: string | null;
  ops_form_token: string | null;
  ops_enabled_at: string | null;
};

export type Workspace = {
  company: OpsCompany;
  role: OpsRole;
  settings: OpsSettings;
  /** The name customers see. */
  brand: string;
  logoUrl: string | null;
  /** An AMBIT admin helping this contractor (not one of their own people). */
  support: boolean;
};

export const OPS_COMPANY_COLS = "id, name, phone, email, ops_enabled, ops_demo, ops_settings, ops_logo_path, ops_support_until, ops_form_token, ops_enabled_at";

export const logoUrl = (path: string | null | undefined) => (path ? `${SUPABASE_URL}/storage/v1/object/public/ops-logos/${path}` : null);

const supportOpen = (c: Pick<OpsCompany, "ops_demo" | "ops_support_until">) => c.ops_demo || (!!c.ops_support_until && Date.parse(c.ops_support_until) > Date.now());

export async function loadWorkspace(supabase: SupabaseClient, profile: Profile): Promise<Workspace | null> {
  const staff = profile.role === "admin" || profile.role === "employee";
  const id = staff ? (profile.role === "admin" ? profile.ops_workspace : null) : profile.ops_role ? profile.company_id : null;
  if (!id) return null;
  const { data } = await supabase.from("companies").select(OPS_COMPANY_COLS).eq("id", id).maybeSingle<OpsCompany>();
  if (!data || !data.ops_enabled) return null;
  if (staff && !supportOpen(data)) return null;
  const settings = settingsOf(data.ops_settings);
  return {
    company: data,
    role: (staff ? "owner" : profile.ops_role) as OpsRole,
    settings,
    brand: settings.display_name || data.name,
    logoUrl: logoUrl(data.ops_logo_path),
    support: staff,
  };
}

export const getWorkspace = cache(async () => {
  const s = await getSession();
  if (!s?.profile || s.profile.status !== "active") return null;
  const ws = await loadWorkspace(s.supabase, s.profile);
  return ws ? { ...s, profile: s.profile, ws } : null;
});

/** An OPS screen: the person must be working in a workspace (and, if given, have one of these roles). */
export async function requireOps(check?: (role: OpsRole) => boolean) {
  const s = await getWorkspace();
  if (!s) {
    const plain = await getSession();
    if (!plain) redirect("/signin");
    redirect("/ops");
  }
  if (check && !check(s.ws.role)) redirect("/ops");
  return s;
}

/** The workspace's people (names for reps, crews and task owners). */
export async function teamOf(supabase: SupabaseClient, companyId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, ops_role, phone, ops_location_id")
    .eq("company_id", companyId)
    .eq("role", "customer")
    .not("ops_role", "is", null)
    .order("full_name");
  return (data ?? []) as { id: string; full_name: string | null; email: string; ops_role: string | null; phone: string | null; ops_location_id: string | null }[];
}

export async function locationsOf(supabase: SupabaseClient, companyId: string) {
  const { data } = await supabase.from("ops_locations").select("id, name, address, phone, sort").eq("company_id", companyId).order("sort").order("created_at");
  return (data ?? []) as { id: string; name: string; address: string | null; phone: string | null; sort: number }[];
}
