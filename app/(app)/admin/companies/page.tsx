import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { searchSafe } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { CsvImport } from "@/components/csv-import";
import { assignRep, saveCompany } from "@/app/(app)/admin/actions";
import { CheckAll } from "@/components/check-all";
import { roleLabel } from "@/lib/access";
import type { Branch, Company } from "@/lib/types";

type Staff = { id: string; full_name: string | null; email: string; job_role: string | null };
const staffName = (p: Staff) => p.full_name?.trim() || p.email;

/** Staff to pick a sales rep from: sales reps first, then everyone else on staff. */
function RepOptions({ staff }: { staff: Staff[] }) {
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

export const metadata = { title: "Customers" };

function CompanyFields({ c, branches, staff }: { c?: Company; branches: Branch[]; staff: Staff[] }) {
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
      <label className="field">
        <span className="label">Sales rep</span>
        <select className="select sm" name="sales_rep_id" defaultValue={c?.sales_rep_id ?? ""}>
          <option value="">-</option>
          <RepOptions staff={staff} />
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
  const rep = sp.rep ?? ""; // "" = anyone, "none" = no sales rep yet, or a person's id
  const { supabase } = await requireAdmin();
  let query = supabase.from("companies").select("*").order("name").limit(500);
  if (q) query = query.or(`name.ilike.%${q}%,account_no.ilike.%${q}%,city.ilike.%${q}%,contact_name.ilike.%${q}%`);
  if (needs) query = query.eq("needs_qb_setup", true);
  if (rep === "none") query = query.is("sales_rep_id", null);
  else if (/^[0-9a-f-]{36}$/i.test(rep)) query = query.eq("sales_rep_id", rep);
  const [{ data }, { data: branches }, { count: total }, { count: needCount }, { count: noRep }, { data: staffRows }] = await Promise.all([
    query,
    supabase.from("branches").select("*").order("sort"),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("needs_qb_setup", true),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("active", true).is("sales_rep_id", null),
    supabase.from("profiles").select("id, full_name, email, job_role").in("role", ["employee", "admin"]).eq("status", "active").order("full_name"),
  ]);
  const companies = (data ?? []) as Company[];
  const br = (branches ?? []) as Branch[];
  const staff = (staffRows ?? []) as Staff[];
  const nameOf = new Map(staff.map((p) => [p.id, staffName(p)]));
  const here = `/admin/companies?${new URLSearchParams(Object.entries({ q, needs: needs ? "1" : "", rep }).filter(([, v]) => v)).toString()}`;

  return (
    <main className="shell wide">
      <TopBar title="Customers" back="/admin" />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {sp.err ? <div className="alert err small" role="alert">{sp.err}</div> : null}
      <CsvImport kind="companies" />
      <details className="card">
        <summary><b>+ Add a customer</b></summary>
        <form action={saveCompany} className="col" style={{ marginTop: 14 }}>
          <CompanyFields branches={br} staff={staff} />
          <div><Submit className="btn sm">Add customer</Submit></div>
        </form>
      </details>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        <Link className={`chip${needs ? "" : " on"}`} href="/admin/companies">All customers · {total ?? 0}</Link>
        <Link className={`chip${needs ? " on" : ""}`} href="/admin/companies?needs=1">Needs QuickBooks setup · {needCount ?? 0}</Link>
        <Link className={`chip${rep === "none" ? " on" : ""}`} href="/admin/companies?rep=none">No sales rep · {noRep ?? 0}</Link>
      </div>
      {needs ? (
        <p className="small muted" style={{ margin: 0 }}>
          Added by staff on the order screen. Set each one up in QuickBooks, add their account number here, untick “Needs to be set up in QuickBooks” and save.
        </p>
      ) : null}
      {rep === "none" ? (
        <p className="small muted" style={{ margin: 0 }}>
          Every order from a customer counts toward their sales rep&apos;s goals. Tick the customers below, pick the rep, then tap Assign.
        </p>
      ) : null}
      <form action="/admin/companies" className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {needs ? <input type="hidden" name="needs" value="1" /> : null}
        <input className="input sm grow" style={{ minWidth: 220 }} name="q" defaultValue={q} placeholder="Search name, account #, contact or city" />
        <select className="select sm" name="rep" defaultValue={rep} aria-label="Sales rep" style={{ width: "auto" }}>
          <option value="">Any sales rep</option>
          <option value="none">No sales rep</option>
          <RepOptions staff={staff} />
        </select>
        <button type="submit" className="btn sm dark">Show</button>
      </form>
      {/* Give several customers a sales rep at once: tick them in the list, pick the rep, Assign. */}
      <form id="bulk-rep" action={assignRep} className="bulk-bar">
        <input type="hidden" name="back" value={here} />
        <CheckAll form="bulk-rep" name="ids" />
        <select className="select sm" name="rep" required defaultValue="" aria-label="Sales rep for the ticked customers">
          <option value="" disabled>Sales rep for ticked customers…</option>
          <RepOptions staff={staff} />
          <option value="none">(No sales rep)</option>
        </select>
        <Submit className="btn sm" pendingText="Assigning…">Assign</Submit>
      </form>
      <div className="list">
        {companies.map((c) => (
          <details key={c.id}>
            <summary className="item" style={{ minHeight: 56 }}>
              <input type="checkbox" name="ids" value={c.id} form="bulk-rep" className="bulk-check" aria-label={`Select ${c.name}`} />
              <div className="grow">
                <div className="t ellipsis">{c.name}{c.active ? "" : " (inactive)"}</div>
                {c.needs_qb_setup ? <span className="pill warn" style={{ marginTop: 4 }}>New · set up in QuickBooks</span> : null}
                <div className="s">
                  {[c.account_no, c.city && c.state ? `${c.city}, ${c.state}` : c.state, c.sales_rep_id ? `Rep: ${nameOf.get(c.sales_rep_id) ?? "(no longer on staff)"}` : null].filter(Boolean).join(" · ")}
                  {!c.sales_rep_id && c.active ? <span className="faint"> · No sales rep</span> : null}
                </div>
              </div>
              <span className="small red">Edit</span>
            </summary>
            <form action={saveCompany} className="col" style={{ padding: "0 16px 16px" }}>
              <input type="hidden" name="id" value={c.id} />
              <CompanyFields c={c} branches={br} staff={staff} />
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
