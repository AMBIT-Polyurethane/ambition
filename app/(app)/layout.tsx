import { TabBar } from "@/components/tabbar";
import { colorsCss, readColors } from "@/lib/theme-colors";
import { Sidebar, type SideEntry, type SideGroup, type SideItem } from "@/components/sidebar";
import { requireActive, isEmployee } from "@/lib/session";
import { can, roleLabel, seesInventory } from "@/lib/access";
import { deskAccess } from "@/lib/order-desk";
import { assistantAccess } from "@/lib/assistant/settings";
import { opsCan, opsMember, opsRoleLabel } from "@/lib/ops/roles";
import { AiPanel } from "@/components/ops/ai/panel";
import { serverVoiceOn, voiceLabel } from "@/lib/ops/ai/voice-server";
import { unreadTotal } from "@/lib/chat";

export const dynamic = "force-dynamic";

// One app for phones and computers. Phones get the bottom tabs; wider screens (tablets in
// landscape, laptops, desktops) get the menu down the left side. Every page works in both.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  const ops = opsMember(profile);
  const ai = await assistantAccess(supabase, profile);
  const ask: SideItem | false = ai.on && { href: "/assistant", label: "Ask AMBIT", icon: "assistant", badge: ai.unread };
  // Team Chat (0063): AMBIT employees only. The badge is unread direct messages and @mentions.
  const chatUnread = emp ? await unreadTotal(supabase) : 0;
  // Forms waiting on this person (credit apps, account setups, RMAs, their team's travel and time off).
  const formsWaiting = emp ? await supabase.from("form_submissions").select("id", { count: "exact", head: true }).eq("status", "submitted").not("form_key", "like", "pulse_%").neq("submitted_by", profile.id)
    .then((r) => r.count ?? 0, () => 0) : 0;
  const credit = can(profile, "credit_check") || can(profile, "order_desk") || profile.role === "admin";
  const dept = (profile as { pulse_dept?: string | null }).pulse_dept ?? null;
  // The computer menu, grouped: hover a group and its pages fly out (Orders → Place an order, Order desk, Inventory…).
  const G = (group: string, label: string, icon: SideGroup["icon"], list: (SideItem | false)[]): SideGroup => ({ group, label, icon, items: list.filter(Boolean) as SideItem[] });
  const items: (SideEntry | false)[] = emp
    ? [
        { href: "/", label: "Home", icon: "home" },
        ask,
        { href: "/chat", label: "Chat", icon: "chat", badge: chatUnread || undefined },
        G("orders", "Orders", "orders", [
          can(profile, "ordering") && { href: "/order", label: "Place an order", icon: "cart", sub: "Order for a customer" },
          !!deskAccess(profile) && { href: "/orders/desk", label: "Order desk", icon: "desk", sub: "Every open order, by stage" },
          !!deskAccess(profile) && { href: "/orders", label: "All orders", icon: "orders", exact: true },
          seesInventory(profile) && { href: "/inventory", label: "Inventory", icon: "inventory" },
          { href: "/reports", label: "Order & sales reports", icon: "reports" },
        ]),
        G("customers", "Customers", "customers", [
          credit && { href: "/customers", label: "Customers", icon: "customers", sub: "Dashboards, balances, payments" },
          credit && { href: "/credit", label: "Credit & collections", icon: "credit" },
          can(profile, "prf_approve") && { href: "/prices", label: "Customer prices", icon: "prices", sub: "The master price sheet" },
          can(profile, "prf_approve") && { href: "/price-requests/approvals", label: "Price approvals", icon: "prices" },
          (can(profile, "price_requests") || can(profile, "prf_approve")) && { href: "/price-requests", label: "Price requests", icon: "quotes", exact: true },
          can(profile, "prf_approve") && { href: "/price-requests/dashboard", label: "Price request dashboard", icon: "reports" },
          (can(profile, "credit_check") || profile.role === "admin") && { href: "/tax", label: "Tax certificates", icon: "tax" },
          (can(profile, "complaints") || profile.role === "admin") && { href: "/complaints", label: "Complaint reports", icon: "complaints" },
        ]),
        G("forms", "Forms", "forms", [
          { href: "/forms", label: "All forms", icon: "forms", exact: true, badge: formsWaiting || undefined, sub: formsWaiting ? `${formsWaiting} waiting on you` : undefined },
          (can(profile, "price_requests") || profile.role === "admin") && { href: "/price-requests/new", label: "Price request", icon: "prices" },
          { href: "/forms/credit_app", label: "Credit application", icon: "credit" },
          { href: "/forms/account_setup", label: "Customer account setup", icon: "customers" },
          { href: "/forms/rma", label: "Return (RMA)", icon: "stock" },
          { href: "/forms/travel", label: "Travel request", icon: "schedule" },
          { href: "/forms/time_off", label: "Time off", icon: "schedule" },
          !!dept && { href: `/forms/pulse_${dept}`, label: "My Daily Pulse", icon: "workorders" },
          profile.role === "admin" && { href: "/pulse", label: "Pulse dashboard", icon: "reports" },
        ]),
        G("field", "Field", "ops", [
          can(profile, "takeoff") && { href: "/ops", label: "AMBIT-OPS", icon: "ops" },
          can(profile, "spray_log") && { href: "/spray-logs", label: "Contractor spray logs", icon: "spraylogs" },
          { href: "/forms/spray_data", label: "Spray data", icon: "spraylogs", sub: "Lots, conditions, density, yield" },
          { href: "/forms/contact_info", label: "New contact", icon: "directory" },
        ]),
        G("team", "Team", "directory", [
          { href: "/directory", label: "Directory", icon: "directory" },
          { href: "/expenses", label: "Expenses", icon: "expenses" },
        ]),
        G("learn", "Learn", "learn", [
          { href: "/docs", label: "Product docs", icon: "docs" },
          { href: "/academy", label: "Academy", icon: "academy" },
          { href: "/how-to", label: "How To Use A.I.", icon: "howto" },
        ]),
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

  // AMBIT Intelligence (the atom button): everyone in an AMBIT-OPS workspace, and AMBIT admins while
  // they have a workspace open (Admin -> AMBIT-OPS).
  const aiAdmin = profile.role === "admin" && !!profile.ops_workspace;
  const intel = ops || aiAdmin;
  // Profile > Colors (0065): this person's accent color and soft background.
  const userCss = colorsCss(readColors((profile as { theme?: unknown }).theme));

  return (
    <div className="app-frame">
      {userCss ? <style id="user-colors" dangerouslySetInnerHTML={{ __html: userCss }} /> : null}
      <Sidebar items={items.filter(Boolean) as SideEntry[]} name={name} sub={sub} />
      <div className="app-main">{children}</div>
      <TabBar
        showOrder={ops ? opsCan.order(profile.ops_role) : profile.role === "customer" || can(profile, "ordering")}
        mode={ops ? (opsCan.fieldOnly(profile.ops_role) ? "crew" : "ops") : "default"}
        ai={ops ? "always" : aiAdmin ? "ops" : false}
        chat={emp && !ops ? chatUnread : false}
      />
      {intel ? <AiPanel name={name} field={ops && opsCan.fieldOnly(profile.ops_role)} canEdit={ops ? opsCan.editCrm(profile.ops_role) : true} voice={{ server: serverVoiceOn(), label: voiceLabel() }} /> : null}
    </div>
  );
}
