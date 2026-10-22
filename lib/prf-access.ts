import "server-only";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { prfFields, prfSubmission, toItems, type RepLink } from "@/lib/jotform";

/** Loads one price request: its rep can open it, and so can anyone who approves prices (admins). */
export async function ownedPriceRequest(id: string) {
  const { supabase, profile } = await requireEmployee();
  const [sub, fields, staffRes, linksRes] = await Promise.all([
    prfSubmission(id),
    prfFields(),
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
    supabase.from("rep_name_links").select("rep_name, profile_id"),
  ]);
  if (!sub) notFound();
  const staff = (staffRes.data ?? []) as { id: string; full_name: string | null; email: string }[];
  const links = (linksRes.error ? [] : linksRes.data ?? []) as RepLink[];
  const [item] = toItems([sub], fields, links, staff);
  const approver = can(profile, "prf_approve");
  if (!approver && item.ownerId !== profile.id) notFound();
  const owner = staff.find((s) => s.id === item.ownerId) ?? null;
  return { supabase, profile, sub, item, fields, admin: approver, approver, ownerName: owner?.full_name ?? "", ownerEmail: owner?.email ?? "", mine: item.ownerId === profile.id };
}
