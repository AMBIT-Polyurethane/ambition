import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, Tag } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit, creditOverview, FLAGS, health, STATUS, type CreditRow, type CreditStatus } from "@/lib/credit";
import { dateShort, money } from "@/lib/format";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

type Co = { id: string; name: string; account_no: string | null; city: string | null; state: string | null; sales_rep_id: string | null; house_account: boolean; terms: string | null;
  credit_status: CreditStatus | null; credit_flags: string[] | null; credit_parent_id: string | null; active: boolean };

const FILTERS = [
  { key: "", label: "All" },
  { key: "bal", label: "With a balance" },
  { key: "line", label: STATUS.line.label },
  { key: "revoked", label: STATUS.revoked.label },
  { key: "advance", label: STATUS.advance.label },
  { key: "review", label: STATUS.review.label },
  { key: "none", label: "No credit status" },
] as const;

/** Every customer, with their credit tag and balance. Tap one for its dashboard. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canCredit(profile)) redirect("/");
  const [{ data: cos }, { rows: credit }, { data: staff }] = await Promise.all([
    supabase.from("companies").select("id, name, account_no, city, state, sales_rep_id, house_account, terms, credit_status, credit_flags, credit_parent_id, active").eq("active", true).order("name").range(0, 4999),
    creditOverview(supabase),
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
  ]);
  const cr = new Map<string, CreditRow>(credit.map((r) => [r.company_id, r]));
  const rep = new Map(((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((s) => [s.id, s.full_name || s.email]));
  const all = (cos ?? []) as Co[];
  const q = (sp.q ?? "").trim().toLowerCase();
  const f = FILTERS.some((x) => x.key === sp.f) ? sp.f ?? "" : "";
  const list = all.filter((c) => {
    const r = cr.get(c.id);
    if (q && !`${c.name} ${c.account_no ?? ""} ${c.city ?? ""}`.toLowerCase().includes(q)) return false;
    if (sp.rep && c.sales_rep_id !== sp.rep) return false;
    if (f === "bal") return !!r && Math.abs(r.balance) > 0.004;
    if (f === "none") return !c.credit_status;
    if (f) return c.credit_status === f;
    return true;
  }).sort((a, b) => (sp.sort === "name" ? a.name.localeCompare(b.name) : Math.abs(cr.get(b.id)?.balance ?? 0) - Math.abs(cr.get(a.id)?.balance ?? 0) || a.name.localeCompare(b.name)));
  const count = (k: string) => all.filter((c) => (k === "bal" ? Math.abs(cr.get(c.id)?.balance ?? 0) > 0.004 : k === "none" ? !c.credit_status : k ? c.credit_status === k : true)).length;
  const ar = credit.reduce((s, r) => s + r.balance, 0); // net, like QuickBooks
  const pastDue = credit.reduce((s, r) => s + r.past_due, 0);
  const over = credit.filter((r) => r.available !== null && r.available < 0 && !r.parent_id).length;
  const link = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, f, rep: sp.rep, sort: sp.sort, ...o })) if (v) p.set(k, v);
    return `/customers?${p.toString()}`;
  };
  const reps = [...new Set(all.map((c) => c.sales_rep_id).filter(Boolean) as string[])].sort((a, b) => (rep.get(a) ?? "").localeCompare(rep.get(b) ?? ""));

  return (
    <main className="shell wide">
      <TopBar title="Customers" back="/" right={<Link href="/prices" className="btn sm dark"><Tag size={15} /> Customer prices</Link>} />
      <div className="cr-kpis">
        <Link href={link({ f: "bal" })} className="cr-kpi"><span className="tiny">Customers with a balance</span><b>{count("bal")}</b><span className="tiny">{money(ar)} owed in all</span></Link>
        <Link href={link({ f: "bal" })} className={`cr-kpi${pastDue ? " warn" : " good"}`}><span className="tiny">Past due</span><b>{money(pastDue)}</b><span className="tiny">{credit.filter((r) => r.past_due > 0).length} customers</span></Link>
        <Link href={link({ f: "line" })} className="cr-kpi good"><span className="tiny">{STATUS.line.label}</span><b>{count("line")}</b><span className="tiny">{over} over their line</span></Link>
        <Link href={link({ f: "revoked" })} className="cr-kpi bad"><span className="tiny">{STATUS.revoked.label}</span><b>{count("revoked")}</b><span className="tiny">pay in advance until reinstated</span></Link>
      </div>
      <form className="row wrap" style={{ gap: 8 }} action="/customers">
        {f ? <input type="hidden" name="f" value={f} /> : null}
        <div className="search grow" style={{ minWidth: 220 }}><Search size={18} /><input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Customer, account # or city" aria-label="Search customers" /></div>
        <select className="select sm" name="rep" defaultValue={sp.rep ?? ""} style={{ width: "auto" }} aria-label="Sales rep">
          <option value="">Every rep</option>
          {reps.map((id) => <option key={id} value={id}>{rep.get(id) ?? "Rep"}</option>)}
        </select>
        <select className="select sm" name="sort" defaultValue={sp.sort ?? ""} style={{ width: "auto" }} aria-label="Sort">
          <option value="">Largest balance first</option>
          <option value="name">A to Z</option>
        </select>
        <button type="submit" className="btn sm dark">Show</button>
      </form>
      <div className="chips wrap">
        {FILTERS.map((x) => <Link key={x.key} href={link({ f: x.key })} className={`chip sm${f === x.key ? " on" : ""}`}>{x.label} · {count(x.key)}</Link>)}
      </div>
      {list.length ? (
        <div className="cr-wrap">
          <table className="cr-table cust-list">
            <thead><tr><th>Customer</th><th>Credit status</th><th>Credit line</th><th>Balance</th><th>Past due</th><th>Available</th><th>Last paid</th></tr></thead>
            <tbody>
              {list.slice(0, 600).map((c) => {
                const r = cr.get(c.id);
                const h = r ? health(r) : null;
                const st = c.credit_status ? STATUS[c.credit_status] : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.id}`} className="stretch">{c.name}</Link>
                      <div className="tiny faint">{[c.account_no, c.city && c.state ? `${c.city}, ${c.state}` : null, c.sales_rep_id ? rep.get(c.sales_rep_id) : c.house_account ? "House Account" : null, c.terms].filter(Boolean).join(" · ")}</div>
                      {(c.credit_flags ?? []).filter((x) => FLAGS[x]).length ? <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>{(c.credit_flags ?? []).filter((x) => FLAGS[x]).map((x) => <span key={x} className="pill red">{FLAGS[x]}</span>)}</div> : null}
                    </td>
                    <td>{st ? <span className={st.pill}>{st.short}</span> : <span className="faint">–</span>}{c.credit_parent_id ? <div className="tiny faint">shared line</div> : null}</td>
                    <td>{r?.group_limit !== null && r?.group_limit !== undefined ? money(r.group_limit) : <span className="faint">–</span>}</td>
                    <td>{r && Math.abs(r.balance) > 0.004 ? <b>{money(r.balance)}</b> : <span className="faint">–</span>}</td>
                    <td className={r?.past_due ? "red" : "faint"}>{r?.past_due ? money(r.past_due) : "–"}</td>
                    <td className={r?.available !== null && r?.available !== undefined && r.available < 0 ? "red" : ""}>{r?.available !== null && r?.available !== undefined ? money(r.available) : <span className="faint">–</span>}{h && h.score >= 2 ? <div><span className={h.pill}>{h.label}</span></div> : null}</td>
                    <td>{r?.last_paid ? dateShort(r.last_paid) : <span className="faint">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="card small muted center">No customers match.</div>}
      {list.length > 600 ? <span className="tiny faint">Showing 600 of {list.length}. Search to narrow it down.</span> : null}
    </main>
  );
}
