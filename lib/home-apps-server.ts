import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Perm } from "@/lib/access";
import { deskAccess } from "@/lib/order-desk";
import { isEmployee } from "@/lib/session";
import { linkHref } from "@/lib/links";
import { APP_COLOR, FOLDER_KEYS, linkColor, type FolderKey, type HomeApp } from "@/lib/home-apps";
import type { LinkRow, Profile } from "@/lib/types";
import { assistantAccess } from "@/lib/assistant/settings";

/** Every app this person can use, in the default order for their role. Badges are filled in by the caller. */
export async function homeApps(
  supabase: SupabaseClient,
  profile: Profile,
  badges: Partial<Record<string, number>> = {},
): Promise<HomeApp[]> {
  const emp = isEmployee(profile);
  const audiences = emp ? ["all", "employee"] : ["all", "customer"];
  const { data } = await supabase.from("links").select("*").eq("active", true).in("audience", audiences).order("sort").order("title");
  const links = ((data ?? []) as LinkRow[]).filter((l) => !emp || !l.perm || can(profile, l.perm as Perm));
  const ai = await assistantAccess(supabase, profile);
  const ask: HomeApp | false = ai.on && { key: "ask", label: "Ask AMBIT", href: "/assistant", icon: "spark", color: APP_COLOR.fuchsia, badge: ai.unread || undefined };
  // Complaint reports: the AMBIT team always; anyone else once they've started one (from Ask AMBIT photos).
  const ccrTeam = emp && (can(profile, "complaints") || profile.role === "admin");
  const ccrMine = ccrTeam
    ? 0
    : await Promise.resolve(supabase.from("complaint_reports").select("id", { count: "exact", head: true }).eq("created_by", profile.id)).then(
        (r) => r.count ?? 0,
        () => 0,
      );
  const complaints: HomeApp | false = (ccrTeam || ccrMine > 0) && { key: "complaints", label: ccrTeam ? "Complaints" : "My complaints", href: "/complaints", icon: "complaint", color: APP_COLOR.rose };

  // Staff: the everyday apps sit right on the home screen; the rest go in folders (Sales tools, Employee forms,
  // Learn & resources, Admin tools). Accounting keeps tax certificates out front.
  const desk = deskAccess(profile);
  const admin = profile.role === "admin";
  const taxFront = !admin && can(profile, "credit_check");
  const apps: (HomeApp | false)[] = emp
    ? [
        ask,
        can(profile, "ordering") && { key: "order", label: "Order", href: "/order", icon: "cart", color: APP_COLOR.red },
        !!desk && { key: "desk", label: "Order desk", href: "/orders/desk", icon: "truck", color: APP_COLOR.orange },
        can(profile, "inventory") && { key: "inventory", label: "Inventory", href: "/inventory", icon: "boxes", color: APP_COLOR.cyan },
        can(profile, "takeoff") && { key: "ops", label: "AMBIT-OPS", href: "/ops", icon: "ops", color: APP_COLOR.sky },
        (can(profile, "credit_check") || admin) && { key: "tax", label: "Tax certificates", href: "/tax", icon: "tax", color: APP_COLOR.emerald, folder: taxFront ? undefined : "admin" },
        can(profile, "ordering") && { key: "intake", label: "Paste an order", href: "/order/intake", icon: "intake", color: APP_COLOR.fuchsia, folder: "sales" },
        can(profile, "ordering") && { key: "due", label: "Due to order", href: "/orders/due", icon: "due", color: APP_COLOR.steel, folder: "sales" },
        can(profile, "price_requests") && { key: "prf", label: "My price requests", href: "/price-requests", icon: "tag", color: "#CA8A04", folder: "sales" },
        complaints && { ...complaints, folder: ccrTeam && admin ? "admin" : "forms" },
        can(profile, "prf_approve") && { key: "prices", label: "Price approvals", href: "/price-requests/approvals", icon: "tag", color: APP_COLOR.amber, folder: "admin" },
        { key: "expenses", label: "Expenses", href: "/expenses", icon: "receipt", color: APP_COLOR.emerald, folder: "forms" },
        { key: "tsb", label: "Bulletins", href: "/docs?type=tsb", icon: "bulletin", color: APP_COLOR.blue, folder: "learn" },
        { key: "docs", label: "Product docs", href: "/docs", icon: "docs", color: APP_COLOR.teal, folder: "learn" },
        { key: "academy", label: "Academy", href: "/academy", icon: "academy", color: APP_COLOR.violet, folder: "learn" },
        { key: "directory", label: "Directory", href: "/directory", icon: "users", color: APP_COLOR.green, folder: "learn" },
        { key: "branches", label: "Branches", href: "/branches", icon: "pin", color: APP_COLOR.pink, folder: "learn" },
        admin && { key: "credit", label: "Credit apps", href: "/admin/forms", icon: "card", color: APP_COLOR.indigo, folder: "admin" },
        admin && { key: "admin", label: "Admin", href: "/admin", icon: "shield", color: "#52525B", folder: "admin" },
      ]
    : [
        { key: "order", label: "Order", href: "/order", icon: "cart", color: APP_COLOR.red },
        ask,
        { key: "orders", label: "My orders", href: "/orders", icon: "clipboard", color: APP_COLOR.slate },
        complaints,
        { key: "tsb", label: "Bulletins", href: "/docs?type=tsb", icon: "bulletin", color: APP_COLOR.blue },
        { key: "docs", label: "Product docs", href: "/docs", icon: "docs", color: APP_COLOR.teal },
        { key: "academy", label: "Academy", href: "/academy", icon: "academy", color: APP_COLOR.violet },
        { key: "branches", label: "Branches", href: "/branches", icon: "pin", color: APP_COLOR.pink },
      ];

  // Forms and resources from Admin → Links become apps too (only the ones with a link set). For staff they go in
  // the folder Admin → Links says, else by kind: price requests in Sales tools, forms in Employee forms, the rest
  // in Learn & resources.
  for (const l of links) {
    const h = linkHref(l);
    if (!h) continue;
    const chosen = (l as typeof l & { folder?: string | null }).folder;
    const folder: FolderKey | undefined = !emp
      ? undefined
      : chosen === "main"
        ? undefined
        : chosen && (FOLDER_KEYS as string[]).includes(chosen)
          ? (chosen as FolderKey)
          : l.perm === "price_requests"
            ? "sales"
            : l.section === "forms"
              ? "forms"
              : "learn";
    apps.push({ key: `link-${l.id}`, label: l.title, href: h.href, external: h.external, icon: l.icon, color: linkColor(l.icon), folder });
  }

  return (apps.filter(Boolean) as HomeApp[]).map((a) => (badges[a.key] ? { ...a, badge: badges[a.key] } : a));
}
