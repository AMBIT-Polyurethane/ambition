import "server-only";
import { can, hubLock, seesInventory } from "@/lib/access";
import { canCredit } from "@/lib/credit";
import { isEmployee } from "@/lib/session";
import type { Profile } from "@/lib/types";
import type { RangeKey } from "@/lib/sales-range";

// Reports (the Reports section): every report, who can open it, and the controls it has. The data for each one is
// built in lib/reports-data.ts; the page that shows them is app/(app)/reports/[key]. A report with `soon` shows as
// "Coming soon" until the app has its data.

export type ReportGroup = "sales" | "orders" | "inventory" | "money";
export const GROUPS: { key: ReportGroup; label: string }[] = [
  { key: "sales", label: "Sales & pricing" },
  { key: "orders", label: "Orders" },
  { key: "inventory", label: "Inventory & purchasing" },
  { key: "money", label: "Money & admin" },
];

export type ReportDef = {
  key: string;
  title: string;
  blurb: string;
  group: ReportGroup;
  icon: string;
  /** The date range it starts on (and has a date picker). */
  range?: RangeKey;
  /** Location chips: every location ("sales") or the ones with inventory (warehouse managers: their own). */
  location?: "sales" | "inventory";
  /** Not built yet: what it's waiting on. */
  soon?: string;
  /** Its own page instead of the shared report page. */
  href?: string;
};

export const REPORT_DEFS: ReportDef[] = [
  // ------------------------------------------------------------------ Sales & pricing
  { key: "sell-prices", group: "sales", icon: "tag", href: "/reports/sell-prices", title: "Sell Price List", blurb: "Every SKU and what the app sells it for: the list price, a sale price, or account pricing. By location, with each spreadsheet's price compared." },
  { key: "price-sheet", group: "sales", icon: "form", title: "Customer Price Sheet", blurb: "One customer's prices: their approved price requests, what they last paid, and list prices for what they buy. Print it for them." },
  { key: "sales-rep", group: "sales", icon: "target", range: "month", location: "sales", title: "Sales by Rep", blurb: "Sales, orders and customers for each rep, against their monthly goal." },
  { key: "stopped", group: "sales", icon: "alert", location: "sales", title: "Customers Who Stopped Ordering", blurb: "Customers who ordered in the last year but not lately: who their rep is, when they last ordered and what they usually buy." },
  { key: "sales-customer", group: "sales", icon: "building", range: "month", location: "sales", title: "Sales by Customer", blurb: "Sales and orders for each customer, compared with the period before." },
  { key: "sales-product", group: "sales", icon: "box", range: "month", location: "sales", title: "Sales by Product", blurb: "Units and dollars for each SKU, how many customers bought it and the average price." },
  { key: "sales-location", group: "sales", icon: "pin", range: "12m", title: "Sales by Location", blurb: "Each location's sales month by month, side by side." },
  { key: "discounts", group: "sales", icon: "tag", range: "month", location: "sales", title: "Discount Report", blurb: "Order lines sold below today's list price or below the floor price, by rep and customer." },
  { key: "price-requests", group: "sales", icon: "tag", range: "ytd", title: "Price Request Log", blurb: "Every price request made in the app: approved, auto-approved, declined, the discount and who decided." },
  { key: "addons", group: "sales", icon: "cart", range: "ytd", location: "sales", title: "Approval-Email Add-ons", blurb: "Items customers added themselves from the approval email, and what they were worth." },
  // ------------------------------------------------------------------ Orders
  { key: "open-orders", group: "orders", icon: "clipboard", location: "sales", title: "Open Orders Aging", blurb: "Every open order, the step it's on (Sales Order #, credit, payment, scheduling) and how many days it's been there." },
  { key: "shipped", group: "orders", icon: "truck", range: "month", location: "sales", title: "Shipped Out / Picked Up Log", blurb: "Completed orders by day and location, shipped out or picked up, with the invoice #." },
  { key: "returns", group: "orders", icon: "receipt", range: "ytd", location: "sales", title: "Returns & Exchanges Log", blurb: "What came back, why, the credit, the lot numbers and when it was received." },
  // ------------------------------------------------------------------ Inventory & purchasing
  { key: "lot-trace", group: "inventory", icon: "drum", title: "Lot Trace", blurb: "Type a lot number: where it came in, where it moved, which customers and orders got it, returns and complaints." },
  { key: "receiving", group: "inventory", icon: "truck", range: "month", location: "inventory", title: "Receiving Log", blurb: "Every truck received, by vendor and date: short or damaged counts, and any report missing its BOL or packing list." },
  { key: "reorders", group: "inventory", icon: "boxes", range: "ytd", location: "inventory", title: "Reorder Requests Log", blurb: "Each reorder request, its status, who handled it and how long it was open." },
  { key: "partials", group: "inventory", icon: "layers", location: "inventory", title: "Partial Orders Still Coming", blurb: "What's still owed on each partial PO, and how late it is." },
  { key: "transfers", group: "inventory", icon: "truck", range: "ytd", location: "inventory", title: "Transfers Log", blurb: "Stock moved between locations: sent, received, in transit and cancelled." },
  { key: "vendor-pos", group: "inventory", icon: "clipboard", title: "Vendor POs", blurb: "Purchase orders to AFCAT, Contractor Foam Supply and every other vendor: open, partly received and late.", soon: "Comes with the POs & Orders section (waiting on the vendor list)." },
  // ------------------------------------------------------------------ Money & admin
  { key: "payments", group: "money", icon: "credit", range: "month", title: "Payments Received", blurb: "Customer payments entered in the app: by customer, by week and how each was paid." },
  { key: "expenses", group: "money", icon: "receipt", range: "month", title: "Expense Summary", blurb: "Receipts by employee and category, with totals." },
  { key: "tax-certs", group: "money", icon: "tax", title: "Tax Certificates Expiring or Missing", blurb: "Tax-exempt customers whose certificate is missing, expired, expiring in 60 days or waiting to be verified." },
  { key: "complaints", group: "money", icon: "complaint", range: "ytd", title: "Complaint Reports Summary", blurb: "Complaint reports by product, lot and status, and how long each took to close." },
];

/** Who sees all sales, only their own customers' (sales reps), or none. */
export function salesScope(p: Profile): "all" | "rep" | null {
  if (!isEmployee(p)) return null;
  if (p.role === "admin" || can(p, "prf_approve") || can(p, "credit_check")) return "all";
  if (p.job_role === "sales_rep") return "rep";
  return null;
}
/** Orders reports: the order desk too. */
export function ordersScope(p: Profile): "all" | "rep" | null {
  const s = salesScope(p);
  if (s === "all" || (isEmployee(p) && can(p, "order_desk"))) return "all";
  return s;
}

/** Can this person open this report? */
export function canSee(p: Profile, key: string): boolean {
  if (!isEmployee(p)) return false;
  const admin = p.role === "admin";
  switch (key) {
    case "sell-prices":
      return true;
    case "price-sheet":
      return admin || can(p, "ordering") || can(p, "price_requests") || can(p, "order_desk");
    case "sales-rep":
    case "stopped":
    case "sales-customer":
    case "sales-product":
    case "discounts":
    case "addons":
      return salesScope(p) !== null;
    case "sales-location":
      return salesScope(p) === "all";
    case "price-requests":
      return admin || can(p, "prf_approve") || can(p, "order_desk") || can(p, "credit_check") || can(p, "price_requests");
    case "open-orders":
    case "shipped":
    case "returns":
      return ordersScope(p) !== null;
    case "lot-trace":
      return admin || seesInventory(p) || can(p, "complaints") || can(p, "order_desk");
    case "receiving":
    case "reorders":
    case "partials":
    case "transfers":
    case "vendor-pos":
      return admin || seesInventory(p);
    case "payments":
      return canCredit(p);
    case "expenses":
      return admin || Boolean((p as Profile & { expense_approver?: boolean }).expense_approver);
    case "tax-certs":
      return admin || can(p, "credit_check") || can(p, "order_desk");
    case "complaints":
      return admin || can(p, "complaints");
    default:
      return false;
  }
}

export const reportDef = (key: string) => REPORT_DEFS.find((r) => r.key === key) ?? null;
export const reportHref = (r: ReportDef) => r.href ?? `/reports/${r.key}`;

/** The reports this person can open, by group (Coming soon ones included). */
export function reportsFor(p: Profile): { group: (typeof GROUPS)[number]; reports: ReportDef[] }[] {
  return GROUPS.map((g) => ({ group: g, reports: REPORT_DEFS.filter((r) => r.group === g.key && canSee(p, r.key)) })).filter((g) => g.reports.length);
}

export type ReportCard = { key: string; title: string; blurb: string; href: string; icon: string; group: ReportGroup };
/** Reports that live in another part of the app, for the people who can open them. */
export function reportsElsewhere(p: Profile): ReportCard[] {
  if (!isEmployee(p)) return [];
  const admin = p.role === "admin";
  const out: (ReportCard | false)[] = [
    can(p, "inv_reports") && {
      key: "inventory",
      group: "inventory",
      title: "Inventory reports",
      blurb: "Reorder, expiring lots, aging stock, movement, stock value and counts, by location.",
      href: "/inventory/reports",
      icon: "boxes",
    },
    (can(p, "credit_check") || can(p, "order_desk") || admin) && {
      key: "credit",
      group: "money",
      title: "Credit & collections",
      blurb: "What customers owe, past due by age, payments and the follow-up list.",
      href: "/credit",
      icon: "credit",
    },
  ];
  return out.filter(Boolean) as ReportCard[];
}

/** A warehouse manager only ever sees their own location in the inventory reports. */
export const inventoryLock = (p: Profile) => hubLock(p);
