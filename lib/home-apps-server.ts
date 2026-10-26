import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can, seesOrders, type Perm } from "@/lib/access";
import { isEmployee } from "@/lib/session";
import { linkHref } from "@/lib/links";
import { APP_COLOR, linkColor, type HomeApp } from "@/lib/home-apps";
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

  const apps: (HomeApp | false)[] = emp
    ? [
        ask,
        can(profile, "ordering") && { key: "order", label: "Order", href: "/order", icon: "cart", color: APP_COLOR.red },
        can(profile, "ordering") && { key: "intake", label: "Paste an order", href: "/order/intake", icon: "intake", color: APP_COLOR.fuchsia },
        can(profile, "ordering") && { key: "due", label: "Due to order", href: "/orders/due", icon: "due", color: APP_COLOR.steel },
        seesOrders(profile) && { key: "orders", label: "Orders", href: "/orders", icon: "clipboard", color: APP_COLOR.slate },
        (can(profile, "order_desk") || can(profile, "credit_check")) && { key: "desk", label: "Order desk", href: "/orders/desk", icon: "truck", color: APP_COLOR.orange },
        can(profile, "takeoff") && { key: "takeoff", label: "Takeoff", href: "/takeoff", icon: "ruler", color: APP_COLOR.sky },
        can(profile, "inventory") && { key: "inventory", label: "Inventory", href: "/inventory", icon: "boxes", color: APP_COLOR.cyan },
        (can(profile, "credit_check") || profile.role === "admin") && { key: "tax", label: "Tax certificates", href: "/tax", icon: "tax", color: APP_COLOR.emerald },
        complaints,
        can(profile, "prf_approve") && { key: "prices", label: "Price approvals", href: "/price-requests/approvals", icon: "tag", color: APP_COLOR.amber },
        can(profile, "price_requests") && { key: "prf", label: "My price requests", href: "/price-requests", icon: "tag", color: "#CA8A04" },
        { key: "expenses", label: "Expenses", href: "/expenses", icon: "receipt", color: APP_COLOR.emerald },
        { key: "tsb", label: "Bulletins", href: "/docs?type=tsb", icon: "bulletin", color: APP_COLOR.blue },
        { key: "docs", label: "Product docs", href: "/docs", icon: "docs", color: APP_COLOR.teal },
        { key: "academy", label: "Academy", href: "/academy", icon: "academy", color: APP_COLOR.violet },
        { key: "directory", label: "Directory", href: "/directory", icon: "users", color: APP_COLOR.green },
        { key: "branches", label: "Branches", href: "/branches", icon: "pin", color: APP_COLOR.pink },
        profile.role === "admin" && { key: "credit", label: "Credit apps", href: "/admin/forms", icon: "card", color: APP_COLOR.indigo },
        profile.role === "admin" && { key: "admin", label: "Admin", href: "/admin", icon: "shield", color: "#52525B" },
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

  // Forms and resources from Admin → Links become apps too (only the ones with a link set).
  for (const l of links) {
    const h = linkHref(l);
    if (!h) continue;
    apps.push({ key: `link-${l.id}`, label: l.title, href: h.href, external: h.external, icon: l.icon, color: linkColor(l.icon) });
  }

  return (apps.filter(Boolean) as HomeApp[]).map((a) => (badges[a.key] ? { ...a, badge: badges[a.key] } : a));
}
