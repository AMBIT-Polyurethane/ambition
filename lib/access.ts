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
  { key: "order_desk", label: "Order desk", hint: "Enter Sales Order #s, schedule delivery and pickup" },
  { key: "credit_check", label: "Credit check", hint: "Release orders or put them on hold" },
  { key: "takeoff", label: "Takeoff", hint: "Measure plans: areas, walls and counts" },
] as const;

export type Perm = (typeof PERMS)[number]["key"];
export const PERM_KEYS = PERMS.map((p) => p.key) as Perm[];

export const ROLES = [
  { key: "admin", label: "Admin", perms: PERM_KEYS },
  { key: "crm", label: "CRM", perms: PERM_KEYS.filter((k) => k !== "prf_approve" && k !== "credit_check") },
  { key: "sales_rep", label: "Sales rep", perms: ["ordering", "price_requests", "time_off", "travel", "takeoff"] as Perm[] },
  { key: "tech", label: "Tech", perms: ["time_off", "travel", "spray_log", "complaints"] as Perm[] },
  { key: "warehouse", label: "Warehouse manager", perms: ["inventory", "ordering", "time_off", "travel"] as Perm[] },
  { key: "accounting", label: "Accounting", perms: ["credit_check", "time_off", "travel"] as Perm[] },
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
  if (p.perms == null) return perm !== "prf_approve";
  return p.perms.includes(perm);
}

/** Staff with anything to do on orders see the Orders list. */
export const seesOrders = (p: Who) => p.role === "customer" || (["ordering", "order_desk", "credit_check", "inventory"] as Perm[]).some((k) => can(p, k));

/** Staff who still need an admin to pick their role. */
export const needsRole = (p: Pick<Profile, "role" | "status"> & { job_role?: string | null; perms?: string[] | null }) =>
  p.role === "employee" && p.status === "active" && p.perms != null && !p.job_role;
