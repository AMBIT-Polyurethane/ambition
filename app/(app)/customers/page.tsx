import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronLeft, Landmark, Search, Tag, UserPlus } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit, creditOverview, FLAGS, health, STATUS, type CreditRow, type CreditStatus } from "@/lib/credit";
import { monthDay, money } from "@/lib/format";
import { MoreMenu } from "@/components/order2/menu";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

type Co = { id: string; name: string; account_no: string | null; city: string | null; state: string | null; sales_rep_id: string | null; house_account: boolean; terms: string | null;
  credit_status: CreditStatus | null; credit_flags: string[] | null; credit_parent_id: string | null; active: boolean };

const FILTERS = [
  { key: "", label: "All" },
  { key: "bal", label: "With a balance" },
  { key: "due", label: "Past due" },
  { key: "over", label: "Over their line" },
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
    if (f === "due") return !!r && r.past_due > 0.004;
    if (f === "over") return !!r && r.available !== null && r.available < 0 && !r.parent_id;
    if (f === "none") return !c.credit_status;
    if (f) return c.credit_status === f;
    return true;
  }).sort((a, b) => (sp.sort === "name" ? a.name.localeCompare(b.name) : Math.abs(cr.get(b.id)?.balance ?? 0) - Math.abs(cr.get(a.id)?.balance ?? 0) || a.name.localeCompare(b.name)));
  const count = (k: string) =>
    all.filter((c) => {
      const r = cr.get(c.id);
      if (k === "bal") return Math.abs(r?.balance ?? 0) > 0.004;
      if (k === "due") return (r?.past_due ?? 0) > 0.004;
      if (k === "over") return !!r && r.available !== null && r.available < 0 && !r.parent_id;
      if (k === "none") return !c.credit_status;
      return k ? c.credit_status === k : true;
    }).length;
  const ar = credit.reduce((s, r) => s + r.balance, 0); // net, like QuickBooks
  const pastDue = credit.reduce((s, r) => s + r.past_due, 0);
  const over = credit.filter((r) => r.available !== null && r.available < 0 && !r.parent_id).length;
  const link = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, f, rep: sp.rep, sort: sp.sort, ...o })) if (v) p.set(k, v);
    return `/customers?${p.toString()}`;
  };
  const reps = [...new Set(all.map((c) => c.sales_rep_id).filter(Boolean) as string[])].sort((a, b) => (rep.get(a) ?? "").localeCompare(rep.get(b) ?? ""));

  const withLine = credit.filter((r) => r.credit_limit !== null && !r.parent_id).length;
  const asOf = credit.map((r) => r.as_of).filter(Boolean).sort().pop() ?? null;
  const short = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : Math.abs(v) >= 10_000 ? `$${Math.round(v / 1000)}k` : money(v));
  const lineK = (v: number) => (v >= 1_000_000 ? `$${+(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : money(v));
  const PAGE = 50;
  const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const n = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), 2000);
  const fLabel = FILTERS.find((x) => x.key === f)?.label ?? "Everyone";
  const sortLabel = sp.sort === "name" ? "A to Z" : "Biggest balance";
  const repLabel = sp.rep ? rep.get(sp.rep) ?? "Rep" : "Every rep";

  return (
    <main className="shell wide">
      <div className="o2 cus">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/" className="o2-back" aria-label="Back to home"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>Customers</h1>
              <span className="o2-sub">{all.length} customers{asOf ? ` · balances from QuickBooks, ${monthDay(asOf)}` : ""}</span>
            </div>
          </div>
          <div className="o2-head-r">
            <Link href="/prices" className="b2 sm"><Tag size={16} /> Customer prices</Link>
            <MoreMenu label="More: credit and collections, add a customer">
              <Link className="menu2-i" href="/credit"><Landmark size={18} /> Credit &amp; collections</Link>
              {profile.role === "admin" ? <Link className="menu2-i" href="/admin/companies"><UserPlus size={18} /> Add or edit customers</Link> : null}
            </MoreMenu>
          </div>
        </div>

        <div className="ihub-kpis">
          <Link href={link({ f: "bal", n: undefined })} className="ihub-kpi"><span className="l">Owed to AMBIT</span><b>{short(ar)}</b><span className="s">{count("bal")} customers</span></Link>
          <Link href={link({ f: "due", n: undefined })} className={`ihub-kpi${pastDue ? " warn" : ""}`}><span className="l">Past due</span><b>{short(pastDue)}</b><span className="s">{count("due")} customers</span></Link>
          <Link href={link({ f: "over", n: undefined })} className={`ihub-kpi${over ? " warn" : ""}`}><span className="l">Over their credit line</span><b>{over}</b><span className="s">of {withLine} with a line</span></Link>
          <Link href={link({ f: "revoked", n: undefined })} className="ihub-kpi"><span className="l">Line revoked</span><b>{count("revoked")}</b><span className="s">Pay in advance for now</span></Link>
        </div>

        <div className="stk-bar">
          <form className="stk-search" action="/customers" role="search">
            <Search size={18} aria-hidden="true" />
            {f ? <input type="hidden" name="f" value={f} /> : null}
            {sp.rep ? <input type="hidden" name="rep" value={sp.rep} /> : null}
            {sp.sort ? <input type="hidden" name="sort" value={sp.sort} /> : null}
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Customer, account # or city" aria-label="Search customers" />
          </form>
          <MoreMenu label="Show which customers" triggerClass="stk-select ord-loc" trigger={<><span>Show</span><b>{f ? fLabel : "Everyone"}</b><ChevronDown size={16} aria-hidden="true" /></>}>
            {FILTERS.map((x) => <Link key={x.key} className="menu2-i" href={link({ f: x.key, n: undefined })}>{x.key ? x.label : "Everyone"} <span className="faint">· {count(x.key)}</span></Link>)}
          </MoreMenu>
          <MoreMenu label="Pick a sales rep" triggerClass="stk-select ord-loc" trigger={<><span>Rep</span><b>{repLabel}</b><ChevronDown size={16} aria-hidden="true" /></>}>
            <Link className="menu2-i" href={link({ rep: "", n: undefined })}>Every rep</Link>
            {reps.map((id) => <Link key={id} className="menu2-i" href={link({ rep: id, n: undefined })}>{rep.get(id) ?? "Rep"}</Link>)}
          </MoreMenu>
          <MoreMenu label="Sort" triggerClass="stk-select ord-loc" trigger={<><span>Sort</span><b>{sortLabel}</b><ChevronDown size={16} aria-hidden="true" /></>}>
            <Link className="menu2-i" href={link({ sort: "", n: undefined })}>Biggest balance</Link>
            <Link className="menu2-i" href={link({ sort: "name", n: undefined })}>A to Z</Link>
          </MoreMenu>
        </div>

        {list.length ? (
          <div className="card2 cus-list">
            <div className="cus-row cus-cols" aria-hidden="true">
              <span>Customer</span><span>Credit</span><span className="num">Balance</span><span className="num">Past due</span><span className="num">Left on their line</span><span className="num">Last paid</span>
            </div>
            {list.slice(0, n).map((c) => {
              const r = cr.get(c.id);
              const st = c.credit_status ? STATUS[c.credit_status] : null;
              const flags = (c.credit_flags ?? []).filter((x) => FLAGS[x]);
              const lim = r?.group_limit ?? null;
              const avail = r?.available ?? null;
              const tone = c.credit_status === "line" ? "ok" : c.credit_status === "revoked" ? "err" : c.credit_status === "review" ? "warn" : "";
              return (
                <Link key={c.id} href={`/customers/${c.id}`} className="cus-row">
                  <span className="cus-name">
                    <b>{c.name}</b>
                    <span>{[c.account_no, c.sales_rep_id ? rep.get(c.sales_rep_id) : c.house_account ? "House Account" : null, c.terms].filter(Boolean).join(" · ")}</span>
                    {flags.length ? <span className="cus-flags">{flags.map((x) => <span key={x} className="pill2 err sm">{FLAGS[x]}</span>)}</span> : null}
                  </span>
                  <span className="cus-cr">
                    {st ? <><span className={`cus-dot ${tone}`} aria-hidden="true" />{c.credit_status === "line" && lim !== null ? `Line · ${lineK(lim)}` : c.credit_status === "advance" ? "Pays in advance" : st.short}</> : <span className="faint">-</span>}
                    {c.credit_parent_id ? <span className="faint"> (shared)</span> : null}
                  </span>
                  <span className="num">{r && Math.abs(r.balance) > 0.004 ? <b>{usd(r.balance)}</b> : <span className="faint">-</span>}</span>
                  <span className={`num${r?.past_due ? " due" : ""}`}>{r?.past_due ? usd(r.past_due) : <span className="faint">-</span>}</span>
                  <span className="num cus-left">
                    {avail === null ? <span className="faint">No line</span> : avail < 0 ? <span className="pill2 err sm">Over by {usd(-avail)}</span> : usd(avail)}
                  </span>
                  <span className="num cus-paid">{r?.last_paid ? monthDay(r.last_paid) : <span className="faint">-</span>}</span>
                </Link>
              );
            })}
            {list.length > n ? <Link href={link({ n: String(n + PAGE) })} className="stk-more-btn" scroll={false}>Show the next {Math.min(PAGE, list.length - n)} <ChevronDown size={15} aria-hidden="true" /></Link> : null}
          </div>
        ) : (
          <div className="card2 prd-empty">No customers match.</div>
        )}
      </div>
    </main>
  );
}
