import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { saveBranch } from "@/app/(app)/admin/actions";
import type { Branch } from "@/lib/types";

export const metadata = { title: "Branches admin" };

export default async function BranchesAdminPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("branches").select("*").order("sort");
  return (
    <main className="shell wide">
      <TopBar title="Branches" back="/admin" />
      <div className="col">
        {((data ?? []) as Branch[]).map((b) => (
          <form key={b.id} action={saveBranch} className="card col">
            <input type="hidden" name="id" value={b.id} />
            <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <label className="field"><span className="label">Name</span><input className="input sm" name="name" defaultValue={b.name} /></label>
              <label className="field"><span className="label">State</span><input className="input sm" name="state" defaultValue={b.state} maxLength={2} /></label>
              <label className="field"><span className="label">Phone</span><input className="input sm" name="phone" defaultValue={b.phone ?? ""} /></label>
              <label className="field"><span className="label">Email</span><input className="input sm" name="email" defaultValue={b.email ?? ""} /></label>
              <label className="field" style={{ gridColumn: "span 2" }}><span className="label">Address</span><input className="input sm" name="address" defaultValue={b.address ?? ""} /></label>
              <label className="field"><span className="label">Sort</span><input className="input sm" name="sort" type="number" defaultValue={b.sort} /></label>
            </div>
            <div className="row">
              <label className="check"><input type="checkbox" name="active" defaultChecked={b.active} /> Active</label>
              <Submit className="btn sm">Save</Submit>
            </div>
          </form>
        ))}
      </div>
    </main>
  );
}
