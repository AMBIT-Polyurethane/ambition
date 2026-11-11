import { roleLabel } from "@/lib/access";

// Picking a sales rep (Admin > Customers, the order screen and the Sales rep box on an order): House Account,
// then sales reps, then everyone else on staff.

export type Staff = { id: string; full_name: string | null; email: string; job_role: string | null };
export const staffName = (p: Pick<Staff, "full_name" | "email">) => p.full_name?.trim() || p.email;

/** The picker's value for "House Account" (the customer's orders credit no sales rep). */
export const HOUSE = "house";
export const HOUSE_LABEL = "House Account (no sales rep)";

export function RepOptions({ staff, house = false }: { staff: Staff[]; house?: boolean }) {
  const reps = staff.filter((p) => p.job_role === "sales_rep");
  const rest = staff.filter((p) => p.job_role !== "sales_rep");
  return (
    <>
      {house ? <option value={HOUSE}>{HOUSE_LABEL}</option> : null}
      {reps.length ? <optgroup label="Sales reps">{reps.map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}</optgroup> : null}
      {rest.length ? (
        <optgroup label="Other AMBIT staff">
          {rest.map((p) => <option key={p.id} value={p.id}>{staffName(p)}{roleLabel(p.job_role) ? ` (${roleLabel(p.job_role)})` : ""}</option>)}
        </optgroup>
      ) : null}
    </>
  );
}
