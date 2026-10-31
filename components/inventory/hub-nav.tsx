import Link from "next/link";
import { ArrowLeftRight, BarChart3, Boxes, ClipboardList, LayoutDashboard, Tags, Truck } from "lucide-react";
import { can, type Perm } from "@/lib/access";
import type { Profile } from "@/lib/types";

// The Inventory Hub's sections. Each person sees the ones they have access to (Admin > Users).

export type HubTab = "dashboard" | "stock" | "receiving" | "transfers" | "counts" | "reports" | "values";

// perms: [] = admins only.
const TABS: { key: HubTab; label: string; href: string; perms: Perm[]; icon: typeof Boxes }[] = [
  { key: "dashboard", label: "Dashboard", href: "/inventory", perms: ["inv_reports"], icon: LayoutDashboard },
  { key: "stock", label: "Stock", href: "/inventory/stock", perms: ["inventory"], icon: Boxes },
  { key: "receiving", label: "Receiving", href: "/inventory/incoming", perms: ["receiving", "inventory"], icon: Truck },
  { key: "transfers", label: "Transfers", href: "/inventory/transfers", perms: ["transfers"], icon: ArrowLeftRight },
  { key: "counts", label: "Counts", href: "/inventory/counts", perms: ["inventory"], icon: ClipboardList },
  { key: "reports", label: "Reports", href: "/inventory/reports", perms: ["inv_reports"], icon: BarChart3 },
  { key: "values", label: "List values", href: "/inventory/values", perms: [], icon: Tags },
];

export const hubTabs = (p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }) =>
  TABS.filter((t) => (t.perms.length ? t.perms.some((k) => can(p, k)) : p.role === "admin" && p.status === "active"));

/** Where someone lands in the hub: the dashboard if they have it, else the first section they can use. */
export function hubHome(p: Pick<Profile, "role" | "status"> & { perms?: string[] | null }, branch?: string | null): string | null {
  const t = hubTabs(p)[0];
  return t ? `${t.href}${branch ? `?b=${branch}` : ""}` : null;
}

export function HubNav({ profile, active, branch }: { profile: Pick<Profile, "role" | "status"> & { perms?: string[] | null }; active: HubTab; branch?: string | null }) {
  const tabs = hubTabs(profile);
  if (tabs.length < 2) return null;
  const q = branch ? `?b=${branch}` : "";
  return (
    <nav className="hub-tabs" aria-label="Inventory Hub">
      {tabs.map((t) => (
        <Link key={t.key} href={`${t.href}${q}`} className={`hub-tab${t.key === active ? " on" : ""}`} aria-current={t.key === active ? "page" : undefined}>
          <t.icon size={16} /> {t.label}
        </Link>
      ))}
    </nav>
  );
}
