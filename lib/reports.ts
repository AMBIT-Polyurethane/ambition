import "server-only";
import { can } from "@/lib/access";
import { isEmployee } from "@/lib/session";
import type { Profile } from "@/lib/types";

// Reports (the Reports section): one list of the reports each person can open. New reports are added here, with
// who can see them. The reports that live inside another area (Inventory Hub reports, Credit & collections) are
// listed too, so Reports is the one place to look.

export type ReportCard = { key: string; title: string; blurb: string; href: string; icon: string };

/** Reports built in the Reports section. */
export function reportsFor(p: Profile): ReportCard[] {
  if (!isEmployee(p)) return [];
  return [
    {
      key: "sell-prices",
      title: "Sell Price List",
      blurb: "Every SKU and what the app sells it for: the list price, a sale price, or account pricing. Pick a location to see only what it carries and check its spreadsheet's prices. Print it or download it for Excel.",
      href: "/reports/sell-prices",
      icon: "tag",
    },
  ];
}

/** Reports that live in another part of the app, for the people who can open them. */
export function reportsElsewhere(p: Profile): ReportCard[] {
  if (!isEmployee(p)) return [];
  const admin = p.role === "admin";
  const out: (ReportCard | false)[] = [
    can(p, "inv_reports") && {
      key: "inventory",
      title: "Inventory reports",
      blurb: "Reorder, expiring lots, aging stock, movement, stock value and counts, by location.",
      href: "/inventory/reports",
      icon: "boxes",
    },
    (can(p, "credit_check") || can(p, "order_desk") || admin) && {
      key: "credit",
      title: "Credit & collections",
      blurb: "What customers owe, past due by age, payments and the follow-up list.",
      href: "/credit",
      icon: "credit",
    },
  ];
  return out.filter(Boolean) as ReportCard[];
}
