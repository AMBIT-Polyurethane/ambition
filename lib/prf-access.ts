import "server-only";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { prfFields, prfSubmission, toItems, type RepLink } from "@/lib/jotform";

/** Loads one price request and makes sure the signed-in rep owns it (admins can open any). */
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
  const admin = profile.role === "admin";
  if (!admin && item.ownerId !== profile.id) notFound();
  const ownerName = staff.find((s) => s.id === item.ownerId)?.full_name ?? "";
  return { sub, item, admin, ownerName, mine: item.ownerId === profile.id };
}
