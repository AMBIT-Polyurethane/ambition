// AMBIT-OPS: who does what inside a contractor's workspace. Keep in step with the roles in
// supabase/migrations/0031_ops_foundation.sql (ops_role check, ops_is(), the RLS policies).

export const OPS_ROLES = [
  { key: "owner", label: "Owner", hint: "Everything, including settings, prices and the team" },
  { key: "office", label: "Office manager", hint: "Customers, leads, quotes, scheduling and settings" },
  { key: "dispatcher", label: "Scheduler / dispatcher", hint: "Schedules rigs and crews; sees customers and leads" },
  { key: "sales", label: "Sales / estimator", hint: "Their own leads and quotes" },
  { key: "crew_lead", label: "Crew lead", hint: "Work orders and time for their crew; never sees prices" },
  { key: "crew", label: "Crew member", hint: "Their work orders and time clock; never sees prices" },
  { key: "accounting", label: "Accounting", hint: "Invoices and payments; sees customers" },
  { key: "sub", label: "Subcontractor", hint: "Only the jobs they're assigned" },
] as const;

export type OpsRole = (typeof OPS_ROLES)[number]["key"];
export const OPS_ROLE_KEYS = OPS_ROLES.map((r) => r.key) as OpsRole[];
export const opsRoleLabel = (k: string | null | undefined) => OPS_ROLES.find((r) => r.key === k)?.label ?? "Team member";

const has = (r: string | null | undefined, list: readonly string[]) => !!r && list.includes(r);

/** What each role can do (the database enforces the same rules). */
export const opsCan = {
  /** Settings, team, products, prices. */
  manage: (r: string | null | undefined) => has(r, ["owner", "office"]),
  /** See customers and the pipeline. */
  crm: (r: string | null | undefined) => has(r, ["owner", "office", "dispatcher", "sales", "accounting"]),
  /** Add and change customers and leads. */
  editCrm: (r: string | null | undefined) => has(r, ["owner", "office", "dispatcher", "sales"]),
  /** Every lead, not just their own. */
  allLeads: (r: string | null | undefined) => has(r, ["owner", "office", "dispatcher", "accounting"]),
  /** Delete customers and leads, undo imports. */
  remove: (r: string | null | undefined) => has(r, ["owner", "office"]),
  /** Crews and subs: work orders only, never prices. */
  fieldOnly: (r: string | null | undefined) => has(r, ["crew_lead", "crew", "sub"]),
  /** Build and send quotes. */
  quote: (r: string | null | undefined) => has(r, ["owner", "office", "dispatcher", "sales"]),
  /** OK a quote that's under the lowest margin. */
  approve: (r: string | null | undefined) => has(r, ["owner", "office"]),
  /** Order from AMBIT. */
  order: (r: string | null | undefined) => has(r, ["owner", "office", "dispatcher", "sales", "accounting"]),
};

/** A contractor's own login that works in their company's AMBIT-OPS workspace. */
export const opsMember = (p: { role: string; status?: string; ops_role?: string | null; company?: { ops_enabled?: boolean } | null }) =>
  p.role === "customer" && !!p.ops_role && !!p.company?.ops_enabled;
