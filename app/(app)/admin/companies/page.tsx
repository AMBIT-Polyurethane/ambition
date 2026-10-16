import { requireAdmin } from "@/lib/session";
import { searchSafe } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { CsvImport } from "@/components/csv-import";
import { saveCompany } from "@/app/(app)/admin/actions";
import type { Branch, Company } from "@/lib/types";

export const metadata = { title: "Customers" };

function CompanyFields({ c, branches }: { c?: Company; branches: Branch[] }) {
  return (
    <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      <label className="field"><span className="label">Name</span><input className="input sm" name="name" defaultValue={c?.name ?? ""} required /></label>
      <label className="field"><span className="label">Account #</span><input className="input sm" name="account_no" defaultValue={c?.account_no ?? ""} /></label>
      <label className="field">
        <span className="label">Branch</span>
        <select className="select sm" name="default_branch_id" defaultValue={c?.default_branch_id ?? ""}>
          <option value="">-</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="field"><span className="label">Phone</span><input className="input sm" name="phone" defaultValue={c?.phone ?? ""} /></label>
      <label className="field"><span className="label">Email</span><input className="input sm" name="email" type="email" defaultValue={c?.email ?? ""} /></label>
      <label className="field"><span className="label">City</span><input className="input sm" name="city" defaultValue={c?.city ?? ""} /></label>
      <label className="field"><span className="label">State</span><input className="input sm" name="state" defaultValue={c?.state ?? ""} maxLength={2} /></label>
    </div>
  );
}

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = searchSafe(sp.q);
  const { supabase } = await requireAdmin();
  let query = supabase.from("companies").select("*").order("name").limit(500);
  if (q) query = query.or(`name.ilike.%${q}%,account_no.ilike.%${q}%`);
  const [{ data }, { data: branches }] = await Promise.all([query, supabase.from("branches").select("*").order("sort")]);
  const companies = (data ?? []) as Company[];
  const br = (branches ?? []) as Branch[];

  return (
    <main className="shell wide">
      <TopBar title="Customers" back="/admin" />
      <CsvImport kind="companies" />
      <details className="card">
        <summary><b>+ Add a customer</b></summary>
        <form action={saveCompany} className="col" style={{ marginTop: 14 }}>
          <CompanyFields branches={br} />
          <div><Submit className="btn sm">Add customer</Submit></div>
        </form>
      </details>
      <form action="/admin/companies"><input className="input sm" name="q" defaultValue={q} placeholder="Search name or account #" /></form>
      <div className="list">
        {companies.map((c) => (
          <details key={c.id}>
            <summary className="item" style={{ minHeight: 56 }}>
              <div className="grow">
                <div className="t ellipsis">{c.name}{c.active ? "" : " (inactive)"}</div>
                <div className="s">{[c.account_no, c.city && c.state ? `${c.city}, ${c.state}` : c.state].filter(Boolean).join(" · ")}</div>
              </div>
              <span className="small red">Edit</span>
            </summary>
            <form action={saveCompany} className="col" style={{ padding: "0 16px 16px" }}>
              <input type="hidden" name="id" value={c.id} />
              <CompanyFields c={c} branches={br} />
              <div className="row">
                <label className="check"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                <Submit className="btn sm">Save</Submit>
              </div>
            </form>
          </details>
        ))}
        {companies.length === 0 ? <div className="item muted small">No customers yet. Import your list or add one above.</div> : null}
      </div>
    </main>
  );
}
