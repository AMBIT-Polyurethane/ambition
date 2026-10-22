import Link from "next/link";
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
      <label className="field"><span className="label">Contact</span><input className="input sm" name="contact_name" defaultValue={c?.contact_name ?? ""} /></label>
      <label className="field"><span className="label">Phone</span><input className="input sm" name="phone" defaultValue={c?.phone ?? ""} /></label>
      <label className="field"><span className="label">Email</span><input className="input sm" name="email" type="email" defaultValue={c?.email ?? ""} /></label>
      <label className="field"><span className="label">City</span><input className="input sm" name="city" defaultValue={c?.city ?? ""} /></label>
      <label className="field"><span className="label">State</span><input className="input sm" name="state" defaultValue={c?.state ?? ""} maxLength={2} /></label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="label">Billing address</span>
        <textarea className="textarea" name="bill_address" rows={2} defaultValue={c?.bill_address ?? ""} />
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="label">Shipping address (fills in the order screen)</span>
        <textarea className="textarea" name="ship_address" rows={2} defaultValue={c?.ship_address ?? ""} />
      </label>
      <label className="check" style={{ gridColumn: "1 / -1" }}>
        <input type="checkbox" name="needs_qb_setup" defaultChecked={c?.needs_qb_setup ?? false} /> Needs to be set up in QuickBooks
      </label>
    </div>
  );
}

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = searchSafe(sp.q);
  const needs = sp.needs === "1";
  const { supabase } = await requireAdmin();
  let query = supabase.from("companies").select("*").order("name").limit(500);
  if (q) query = query.or(`name.ilike.%${q}%,account_no.ilike.%${q}%,city.ilike.%${q}%,contact_name.ilike.%${q}%`);
  if (needs) query = query.eq("needs_qb_setup", true);
  const [{ data }, { data: branches }, { count: total }, { count: needCount }] = await Promise.all([
    query,
    supabase.from("branches").select("*").order("sort"),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("needs_qb_setup", true),
  ]);
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
      <div className="chips" style={{ flexWrap: "wrap" }}>
        <Link className={`chip${needs ? "" : " on"}`} href="/admin/companies">All customers · {total ?? 0}</Link>
        <Link className={`chip${needs ? " on" : ""}`} href="/admin/companies?needs=1">Needs QuickBooks setup · {needCount ?? 0}</Link>
      </div>
      {needs ? (
        <p className="small muted" style={{ margin: 0 }}>
          Added by staff on the order screen. Set each one up in QuickBooks, add their account number here, untick “Needs to be set up in QuickBooks” and save.
        </p>
      ) : null}
      <form action="/admin/companies">
        {needs ? <input type="hidden" name="needs" value="1" /> : null}
        <input className="input sm" name="q" defaultValue={q} placeholder="Search name, account #, contact or city" />
      </form>
      <div className="list">
        {companies.map((c) => (
          <details key={c.id}>
            <summary className="item" style={{ minHeight: 56 }}>
              <div className="grow">
                <div className="t ellipsis">{c.name}{c.active ? "" : " (inactive)"}</div>
                {c.needs_qb_setup ? <span className="pill warn" style={{ marginTop: 4 }}>New · set up in QuickBooks</span> : null}
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
        {companies.length === 0 ? (
          <div className="item muted small">{needs ? "Nothing waiting. Every customer is set up in QuickBooks." : "No customers yet. Import your list or add one above."}</div>
        ) : null}
        {companies.length === 500 ? <div className="item tiny faint">Showing the first 500. Search to find others.</div> : null}
      </div>
    </main>
  );
}
