import { TabBar } from "@/components/tabbar";
import { Sidebar, type SideItem } from "@/components/sidebar";
import { requireActive, isEmployee } from "@/lib/session";
import { can, roleLabel } from "@/lib/access";
import { deskAccess } from "@/lib/order-desk";
import { assistantAccess } from "@/lib/assistant/settings";
import { opsCan, opsMember, opsRoleLabel } from "@/lib/ops/roles";

export const dynamic = "force-dynamic";

// One app for phones and computers. Phones get the bottom tabs; wider screens (tablets in
// landscape, laptops, desktops) get the menu down the left side. Every page works in both.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  const ops = opsMember(profile);
  const ai = await assistantAccess(supabase, profile);
  const ask: SideItem | false = ai.on && { href: "/assistant", label: "Ask AMBIT", icon: "assistant", badge: ai.unread };
  const items: (SideItem | false)[] = emp
    ? [
        { href: "/", label: "Home", icon: "home" },
        ask,
        can(profile, "ordering") && { href: "/order", label: "Order", icon: "cart" },
        // One place for orders: the Order Desk (with "View orders" for the full list).
        !!deskAccess(profile) && { href: "/orders/desk", label: "Order desk", icon: "desk" },
        can(profile, "takeoff") && { href: "/ops", label: "AMBIT-OPS", icon: "ops" },
        can(profile, "inventory") && { href: "/inventory", label: "Inventory", icon: "inventory" },
        (can(profile, "credit_check") || profile.role === "admin") && { href: "/tax", label: "Tax certificates", icon: "tax" },
        (can(profile, "complaints") || profile.role === "admin") && { href: "/complaints", label: "Complaint reports", icon: "complaints" },
        can(profile, "spray_log") && { href: "/spray-logs", label: "Contractor spray logs", icon: "spraylogs" },
        can(profile, "prf_approve")
          ? { href: "/price-requests/approvals", label: "Price approvals", icon: "prices" }
          : can(profile, "price_requests") && { href: "/price-requests", label: "Price requests", icon: "prices" },
        { href: "/expenses", label: "Expenses", icon: "expenses" },
        { href: "/docs", label: "Product docs", icon: "docs" },
        { href: "/academy", label: "Academy", icon: "academy" },
        { href: "/directory", label: "Directory", icon: "directory" },
        profile.role === "admin" && { href: "/admin", label: "Admin", icon: "admin" },
        { href: "/profile", label: "Profile", icon: "profile" },
      ]
    : ops
      ? opsCan.fieldOnly(profile.ops_role)
        ? [
            { href: "/ops", label: "Home", icon: "home", exact: true },
            { href: "/ops/field", label: "Work orders", icon: "workorders" },
            ask,
            { href: "/docs", label: "Product docs", icon: "docs" },
            { href: "/academy", label: "Academy", icon: "academy" },
            { href: "/profile", label: "Profile", icon: "profile" },
          ]
        : [
            { href: "/ops", label: "Home", icon: "home", exact: true },
            ask,
            opsCan.crm(profile.ops_role) && { href: "/ops/pipeline", label: "Leads", icon: "pipeline" },
            opsCan.crm(profile.ops_role) && { href: "/ops/customers", label: "Customers", icon: "customers" },
            opsCan.quote(profile.ops_role) && { href: "/ops/quotes", label: "Quotes", icon: "quotes" },
            opsCan.quote(profile.ops_role) && { href: "/takeoff", label: "Takeoffs", icon: "takeoff" },
            opsCan.jobs(profile.ops_role) && { href: "/ops/schedule", label: "Schedule", icon: "schedule" },
            opsCan.jobs(profile.ops_role) && { href: "/ops/work-orders", label: "Work orders", icon: "workorders" },
            opsCan.dispatch(profile.ops_role) && { href: "/ops/stock", label: "Stock", icon: "stock" },
            opsCan.order(profile.ops_role) && { href: "/order", label: "Order from AMBIT", icon: "cart" },
            opsCan.order(profile.ops_role) && { href: "/orders", label: "My AMBIT orders", icon: "orders" },
            { href: "/docs", label: "Product docs", icon: "docs" },
            { href: "/academy", label: "Academy", icon: "academy" },
            opsCan.manage(profile.ops_role) && { href: "/ops/settings", label: "Settings", icon: "settings" },
            { href: "/profile", label: "Profile", icon: "profile" },
          ]
      : [
        { href: "/", label: "Home", icon: "home" },
        ask,
        { href: "/order", label: "Order", icon: "cart" },
        { href: "/orders", label: "My orders", icon: "orders" },
        { href: "/docs", label: "Product docs", icon: "docs" },
        { href: "/academy", label: "Academy", icon: "academy" },
        { href: "/profile", label: "Profile", icon: "profile" },
      ];
  const name = profile.full_name || profile.email;
  const sub = emp
    ? roleLabel(profile.job_role) ?? (profile.role === "admin" ? "Admin" : "AMBIT")
    : ops
      ? `${opsRoleLabel(profile.ops_role)} · ${profile.company?.name ?? ""}`
      : profile.company?.name ?? "Contractor";

  return (
    <div className="app-frame">
      <Sidebar items={items.filter(Boolean) as SideItem[]} name={name} sub={sub} />
      <div className="app-main">{children}</div>
      <TabBar
        showOrder={ops ? opsCan.order(profile.ops_role) : profile.role === "customer" || can(profile, "ordering")}
        mode={ops ? (opsCan.fieldOnly(profile.ops_role) ? "crew" : "ops") : "default"}
      />
    </div>
  );
}
