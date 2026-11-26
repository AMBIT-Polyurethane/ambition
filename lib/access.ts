import type { Profile } from "@/lib/types";

// What AMBIT staff can see and do. Admins can do everything; contractors only ever see their own
// side of the app. Keep the keys in step with public.all_perms() in the database.

export const PERMS = [
  { key: "ordering", label: "Ordering", hint: "Place orders for customers" },
  { key: "price_requests", label: "Price requests", hint: "Price Request Form and their own requests" },
  { key: "prf_approve", label: "Approve price requests", hint: "Enter approved prices (admins)" },
  { key: "time_off", label: "Time off requests", hint: "" },
  { key: "travel", label: "Travel requests", hint: "" },
  { key: "spray_log", label: "Spray job data log", hint: "" },
  { key: "complaints", label: "Customer complaints", hint: "" },
  { key: "inventory", label: "Inventory", hint: "Counts and stock updates" },
  { key: "order_desk", label: "Order desk", hint: "Add Invoice #s and prices, schedule delivery and pickup" },
  { key: "credit_check", label: "Credit check", hint: "Release orders or put them on hold" },
  { key: "takeoff", label: "Takeoff", hint: "Measure plans: areas, walls and counts" },
  { key: "item_variance", label: "Item variance", hint: "Load a different lot or product type than the one picked" },
  { key: "receiving", label: "Receiving", hint: "Receiving Reports: upload a BOL, check it, add it to stock" },
  { key: "transfers", label: "Transfers", hint: "Send stock to another AMBIT location" },
  { key: "inv_reports", label: "Inventory dashboard", hint: "Inventory Hub KPIs, charts and reports (stock value, aging, expiring lots)" },
  { key: "add_customers", label: "Add new customers", hint: "Create customer accounts after credit vetting. Everyone else sends a request" },
  { key: "prices", label: "Customer prices", hint: "Change customer prices, base prices and the pricing dashboard" },
  { key: "estimates", label: "Estimates", hint: "Build unofficial estimates for customers from their price list (prices can't be changed)" },
  { key: "estimate_freight", label: "Estimates: add freight", hint: "Add the quoted freight (and change the tax rate) on estimates" },
  { key: "sales_hub", label: "Sales hub", hint: "Their own customers, follow-ups, new-customer pipeline and AI briefing (CRM)" },
  { key: "sales_dashboard", label: "Sales dashboard", hint: "Every rep's customers and numbers, and assigning customers to reps" },
] as const;

export type Perm = (typeof PERMS)[number]["key"];
export const PERM_KEYS = PERMS.map((p) => p.key) as Perm[];

export const ROLES = [
  { key: "admin", label: "Admin", perms: PERM_KEYS },
  { key: "crm", label: "CRM", perms: PERM_KEYS.filter((k) => k !== "prf_approve" && k !== "credit_check" && k !== "item_variance" && k !== "add_customers" && k !== "prices" && k !== "sales_hub" && k !== "sales_dashboard") },
  { key: "sales_rep", label: "Sales rep", perms: ["ordering", "price_requests", "time_off", "travel", "takeoff", "estimates", "sales_hub"] as Perm[] },
  { key: "tech", label: "Tech", perms: ["time_off", "travel", "spray_log", "complaints"] as Perm[] },
  { key: "warehouse", label: "Warehouse manager", perms: ["inventory", "receiving", "transfers", "inv_reports", "ordering", "time_off", "travel"] as Perm[] },
  { key: "accounting", label: "Accounting", perms: ["credit_check", "add_customers", "time_off", "travel"] as Perm[] },
] as const;

export type JobRole = (typeof ROLES)[number]["key"];

export const roleLabel = (key: string | null | undefined) => ROLES.find((r) => r.key === key)?.label ?? null;

type Who = Pick<Profile, "role" | "status"> & { perms?: string[] | null };

/** Can this person use a feature? */
export function can(p: Who | null | undefined, perm: Perm): boolean {
  if (!p || p.status !== "active") return false;
  if (p.role === "admin") return true;
  if (p.role !== "employee") return false;
  // Before the roles update (0011) is run there are no perms yet: staff keep what they had.
  if (p.perms == null) return perm !== "prf_approve" && perm !== "prices";
  return p.perms.includes(perm);
}

/** Estimates: build them (reps, CRMs), or add freight and send them (CRMs). Admins do both. */
export const canEstimate = (p: Who) => can(p, "estimates") || can(p, "estimate_freight");
export const canFreight = (p: Who) => can(p, "estimate_freight");

/** Sales CRM (0109): a rep's own hub, or every rep (admins and "Sales dashboard"). */
export const canSalesAll = (p: Who) => can(p, "sales_dashboard");
export const canSalesHub = (p: Who) => can(p, "sales_hub") || can(p, "sales_dashboard");

/** Anything in the Inventory Hub. */
export const INV_PERMS: Perm[] = ["inventory", "receiving", "transfers", "inv_reports"];
export const seesInventory = (p: Who) => INV_PERMS.some((k) => can(p, k));
/** Receiving Reports and expected deliveries. */
export const canReceive = (p: Who) => can(p, "receiving") || can(p, "inventory");

/** Staff with anything to do on orders see the Orders list. */
export const seesOrders = (p: Who) => p.role === "customer" || (["ordering", "order_desk", "credit_check", "inventory"] as Perm[]).some((k) => can(p, k));

/** Staff who still need an admin to pick their role. */
export const needsRole = (p: Pick<Profile, "role" | "status"> & { job_role?: string | null; perms?: string[] | null }) =>
  p.role === "employee" && p.status === "active" && p.perms != null && !p.job_role;

/**
 * Warehouse managers run one location. They can look at every location's stock, holds and reports (starting on their
 * own), but counts, receiving, holds, transfers and spot checks only ever happen at their own.
 * Returns that location ("" if their account has no location yet), or null for anyone who works on every location.
 */
type HubWho = (Pick<Profile, "role"> & { job_role?: string | null; branch_id?: string | null }) | null | undefined;
export function hubLock(p: HubWho): string | null {
  if (!p) return "";
  if (p.role !== "employee" || p.job_role !== "warehouse") return null;
  return p.branch_id ?? "";
}
/** Can this person work on this location in the Inventory Hub (count, receive, hold, transfer)? */
export function hubAllows(p: HubWho, branch: string | null | undefined): boolean {
  const lock = hubLock(p);
  return lock === null || (!!branch && branch === lock);
}
export const HUB_LOCKED_MSG = "Warehouse managers can only work on their own location.";
