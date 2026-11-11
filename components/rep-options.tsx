import { roleLabel } from "@/lib/access";

// Picking a sales rep (Admin → Customers, and the Sales rep box on an order): sales reps first, then everyone else on staff.

export type Staff = { id: string; full_name: string | null; email: string; job_role: string | null };
export const staffName = (p: Pick<Staff, "full_name" | "email">) => p.full_name?.trim() || p.email;

export function RepOptions({ staff }: { staff: Staff[] }) {
  const reps = staff.filter((p) => p.job_role === "sales_rep");
  const rest = staff.filter((p) => p.job_role !== "sales_rep");
  return (
    <>
      {reps.length ? <optgroup label="Sales reps">{reps.map((p) => <option key={p.id} value={p.id}>{staffName(p)}</option>)}</optgroup> : null}
      {rest.length ? (
        <optgroup label="Other AMBIT staff">
          {rest.map((p) => <option key={p.id} value={p.id}>{staffName(p)}{roleLabel(p.job_role) ? ` (${roleLabel(p.job_role)})` : ""}</option>)}
        </optgroup>
      ) : null}
    </>
  );
}
