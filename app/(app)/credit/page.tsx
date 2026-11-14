import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, CircleCheck, FileUp, Search } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit, canSetCredit, creditOverview, FLAGS, health, STATUS, type CreditRow } from "@/lib/credit";
import { dateShort, money } from "@/lib/format";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { setAutoRelease } from "./actions";
import { AgingBar } from "@/components/credit/aging-bar";
import { BarList, ColumnChart } from "@/components/inventory/charts";

export const metadata = { title: "Credit & collections" };
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "attention", label: "Needs attention" },
  { key: "limit", label: "Over or near limit" },
  { key: "follow", label: "Follow-ups due" },
  { key: "all", label: "Every account" },
] as const;

/** Melinda, Al and the order desk: every account's balance, aging, limit and payments, and who to call today. */
export default async function CreditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canCredit(profile)) redirect("/");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const since = (days: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  const [{ ready, rows: all }, { data: branches }, { data: staff }, payRes, salesRes, promRes] = await Promise.all([
    creditOverview(supabase),
    supabase.from("branches").select("id, name").order("sort"),
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]).eq("demo", false),
    supabase.from("customer_payments").select("amount, paid_on").is("voided_at", null).gte("paid_on", since(84)).limit(5000),
    supabase.from("orders").select("invoiced_total, est_subtotal, completed_at").eq("status", "completed").gte("completed_at", `${since(90)}T00:00:00Z`).limit(10000),
    supabase.from("collection_notes").select("company_id, kind, body, promise_amount, follow_up_on, by_name").is("done_at", null).not("follow_up_on", "is", null).lte("follow_up_on", since(-7)).order("follow_up_on").limit(200),
  ]);
  const { data: autoRow } = await supabase.from("app_settings").select("value").eq("key", "credit_auto").maybeSingle();
  const autoOn = Boolean((autoRow?.value as { enabled?: boolean } | null)?.enabled);
  if (!ready) {
    return (
      <main className="shell">
        <TopBar title="Credit & collections" back="/" />
        <Empty icon="dollar" title="This needs the 0066 database update">Ask Jeremiah to run it.</Empty>
      </main>
    );
  }
  const repName = new Map(((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((s) => [s.id, s.full_name || s.email]));
  const q = (sp.q ?? "").trim().toLowerCase();
  // Shared lines (MacArthur): the locations fold into the corporate row, with the group's totals.
  const kids = new Map<string, CreditRow[]>();
  for (const r of all) if (r.parent_id) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  const rolled = all.filter((r) => !r.parent_id || !all.some((x) => x.company_id === r.parent_id)).map((r) => {
    const k = kids.get(r.company_id);
    if (!k?.length) return r;
    const g = [r, ...k];
    const add = (f: (x: CreditRow) => number) => g.reduce((s2, x) => s2 + f(x), 0);
    return { ...r, balance: add((x) => x.balance), past_due: add((x) => x.past_due), over_90: add((x) => x.over_90), d61_90: add((x) => x.d61_90), d31_60: add((x) => x.d31_60),
      d1_30: add((x) => x.d1_30), current_due: add((x) => x.current_due), orders_open: add((x) => x.orders_open), open_invoices: add((x) => x.open_invoices),
      max_days_late: Math.max(...g.map((x) => x.max_days_late ?? 0)) || null, credit_limit: r.group_limit, locations: k.length } as CreditRow & { locations?: number };
  });
  const sf = ["line", "revoked", "advance", "review"].includes(sp.s ?? "") ? sp.s : "";
  const rows = (rolled as (CreditRow & { locations?: number })[]).filter((r) => (!sp.b || r.branch === sp.b) && (!sp.rep || r.rep_id === sp.rep) && (!sf || r.status === sf) && (!q || `${r.name} ${r.account_no ?? ""}`.toLowerCase().includes(q)));
  const sum = (f: (r: CreditRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const ar = sum((r) => r.balance); // net, like QuickBooks (credits on account count)
  const pastDue = sum((r) => r.past_due);
  const over90 = sum((r) => r.over_90);
  const limits = sum((r) => r.credit_limit ?? 0);
  const overLimit = rows.filter((r) => r.available !== null && r.available < 0);
  const pays = (payRes.data ?? []) as { amount: number; paid_on: string }[];
  const paid30 = pays.filter((p) => p.paid_on >= since(30)).reduce((s, p) => s + Number(p.amount), 0);
  const sales90 = ((salesRes.data ?? []) as { invoiced_total: number | null; est_subtotal: number }[]).reduce((s, o) => s + Number(o.invoiced_total ?? o.est_subtotal ?? 0), 0);
  const dso = sales90 > 0 ? Math.round(ar / (sales90 / 90)) : null;
  const promises = ((promRes.error ? [] : promRes.data ?? []) as { company_id: string; kind: string; body: string; promise_amount: number | null; follow_up_on: string; by_name: string | null }[]).filter((p) => rows.some((r) => r.company_id === p.company_id));
  const nameOf = new Map(all.map((r) => [r.company_id, r.name]));
  const asOf = all.map((r) => r.as_of).filter(Boolean).sort().pop() ?? null;

  // Payments by week (12 weeks), Monday to Sunday.
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) - 7 * (11 - i));
    const start = end.toISOString().slice(0, 10);
    const stop = new Date(end); stop.setUTCDate(stop.getUTCDate() + 7);
    const total = pays.filter((p) => p.paid_on >= start && p.paid_on < stop.toISOString().slice(0, 10)).reduce((s, p) => s + Number(p.amount), 0);
    return { label: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`, values: [Math.round(total)] };
  });

  const view = VIEWS.some((v) => v.key === sp.v) ? sp.v! : "attention";
  const list = (view === "attention"
    ? rows.filter((r) => health(r).score >= 2)
    : view === "limit"
      ? rows.filter((r) => r.credit_limit && (r.available !== null && (r.available < 0 || r.balance > r.credit_limit * 0.85)))
      : view === "follow"
        ? rows.filter((r) => r.next_follow && r.next_follow <= since(-7))
        : rows
  ).sort((a, b) => b.over_90 - a.over_90 || b.past_due - a.past_due || b.balance - a.balance);
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ b: sp.b, rep: sp.rep, q: sp.q, s: sf, v: view, ...o })) if (v) p.set(k, v);
    return `/credit?${p.toString()}`;
  };
  const reps = [...new Set(all.map((r) => r.rep_id).filter(Boolean) as string[])];

  return (
    <main className="shell wide">
      <TopBar
        title="Credit & collections"
        back="/"
        right={canSetCredit(profile) ? <Link href="/credit/import" className="btn sm dark"><FileUp size={15} /> Import balances</Link> : null}
      />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <section className={`auto-card${autoOn ? " on" : ""}`}>
        <div className="col tight grow" style={{ minWidth: 0 }}>
          <b>Automatic credit release · {autoOn ? "On" : "Off"}</b>
          <span className="tiny muted">When the CRM enters the Sales Order #, the order releases itself if the customer <b>Has Line Of Credit</b>, <b>nothing is past due</b> (any amount, any location on a shared line) and the line covers the balance <b>plus every open order including this one</b>. Everything else goes to Accounting with the reason on the order.</span>
        </div>
        {profile.role === "admin" ? (
          <form action={setAutoRelease}><input type="hidden" name="on" value={autoOn ? "0" : "1"} /><Submit className={`btn sm${autoOn ? " dark" : ""}`} pendingText="…">{autoOn ? "Turn off" : "Turn on"}</Submit></form>
        ) : null}
      </section>
      {!all.length ? (
        <div className="alert warn"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>No balances yet. {canSetCredit(profile) ? <>Tap <Link href="/credit/import">Import balances</Link> and upload the QuickBooks A/R Aging Summary (and credit limits).</> : "Accounting imports them from QuickBooks."}</span></div>
      ) : (
        <p className="tiny faint" style={{ margin: 0 }}>
          Balances from QuickBooks as of {asOf ? dateShort(asOf) : "the import"}, plus orders shipped since, minus payments entered here since. Payments come off the oldest past due first.
        </p>
      )}

      <div className="cr-kpis">
        <div className="cr-kpi"><span className="tiny">Total owed (A/R)</span><b>{money(ar)}</b><span className="tiny">{rows.filter((r) => r.balance > 0).length} accounts with a balance</span></div>
        <Link href={qs({ v: "attention" })} className={`cr-kpi${pastDue ? " warn" : " good"}`}><span className="tiny">Past due</span><b>{money(pastDue)}</b><span className="tiny">{ar ? `${Math.round((pastDue / ar) * 100)}% of A/R` : "–"} · {rows.filter((r) => r.past_due > 0).length} accounts</span></Link>
        <Link href={qs({ v: "attention" })} className={`cr-kpi${over90 ? " bad" : " good"}`}><span className="tiny">90+ days</span><b>{money(over90)}</b><span className="tiny">{rows.filter((r) => r.over_90 > 0).length} accounts</span></Link>
        <Link href={qs({ v: "limit" })} className={`cr-kpi${overLimit.length ? " bad" : " good"}`}><span className="tiny">Over their credit line</span><b>{overLimit.length}</b><span className="tiny">{limits ? `${Math.round((ar / limits) * 100)}% of all credit lines used` : "No credit lines yet"}</span></Link>
        <div className="cr-kpi good"><span className="tiny">Paid, last 30 days</span><b>{money(paid30)}</b><span className="tiny">entered in the app</span></div>
        <div className="cr-kpi"><span className="tiny">Days to collect (DSO)</span><b>{dso ?? "–"}</b><span className="tiny">A/R ÷ average daily sales (90 days)</span></div>
        <Link href={qs({ v: "follow" })} className={`cr-kpi${promises.some((p) => p.follow_up_on < today) ? " warn" : ""}`}><span className="tiny">Follow-ups this week</span><b>{promises.length}</b><span className="tiny">{promises.filter((p) => p.follow_up_on < today).length} overdue</span></Link>
      </div>

      <section className="card col" style={{ gap: 10 }}>
        <div className="row between"><b>Aging</b><span className="tiny faint">{rows.length} accounts</span></div>
        <AgingBar a={{ current_due: sum((r) => r.current_due), d1_30: sum((r) => r.d1_30), d31_60: sum((r) => r.d31_60), d61_90: sum((r) => r.d61_90), over_90: over90 }} />
      </section>

      <div className="grid2 cr-charts">
        <section className="card col" style={{ gap: 8 }}>
          <b>Payments by week</b>
          <span className="tiny faint">What the CRMs entered, last 12 weeks</span>
          <ColumnChart rows={weeks} series={[{ key: "paid", label: "Paid" }]} caption="Payments entered per week" />
        </section>
        <section className="card col" style={{ gap: 8 }}>
          <b>Largest past due</b>
          <span className="tiny faint">Who owes the most that&apos;s late</span>
          {rows.some((r) => r.past_due > 0) ? (
            <BarList rows={[...rows].sort((a, b) => b.past_due - a.past_due).filter((r) => r.past_due > 0).slice(0, 8).map((r) => ({ label: r.name, value: Math.round(r.past_due), note: r.over_90 ? `${money(r.over_90)} is 90+ days` : undefined }))} caption="Largest past-due balances" />
          ) : <span className="small muted">Nobody is past due.</span>}
        </section>
      </div>

      {promises.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b>Follow-ups and promises to pay (next 7 days)</b>
          <div className="list">
            {promises.slice(0, 12).map((p, i) => (
              <Link key={i} href={`/customers/${p.company_id}?tab=notes&from=credit`} className="item" style={{ padding: "9px 12px" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis" style={{ fontSize: 14 }}>{nameOf.get(p.company_id) ?? "Customer"}</div>
                  <div className="s ellipsis">{p.kind === "promise" ? `Promised ${p.promise_amount ? money(Number(p.promise_amount)) : ""}: ` : ""}{p.body}</div>
                </div>
                <span className={`pill ${p.follow_up_on < today ? "red" : p.follow_up_on === today ? "warn" : ""}`}>{p.follow_up_on < today ? "Overdue · " : ""}{dateShort(p.follow_up_on)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="col" style={{ gap: 8 }}>
        <div className="chips">
          {VIEWS.map((v) => <Link key={v.key} href={qs({ v: v.key })} className={`chip${view === v.key ? " on" : ""}`}>{v.label}</Link>)}
        </div>
        <div className="chips wrap">
          <Link href={qs({ s: "" })} className={`chip sm${!sf ? " on2" : ""}`}>Every status</Link>
          {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => <Link key={k} href={qs({ s: k })} className={`chip sm${sf === k ? " on2" : ""}`}>{STATUS[k].label} · {rolled.filter((r) => r.status === k).length}</Link>)}
        </div>
        <form className="row wrap" style={{ gap: 8 }} action="/credit">
          <input type="hidden" name="v" value={view} />
          <div className="search grow" style={{ minWidth: 200 }}><Search size={18} /><input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Customer or account #" aria-label="Search customers" /></div>
          <select className="select sm" name="b" defaultValue={sp.b ?? ""} style={{ width: "auto" }} aria-label="Location">
            <option value="">Every location</option>
            {((branches ?? []) as { id: string; name: string }[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="select sm" name="rep" defaultValue={sp.rep ?? ""} style={{ width: "auto" }} aria-label="Sales rep">
            <option value="">Every rep</option>
            {reps.map((id) => <option key={id} value={id}>{repName.get(id) ?? "Rep"}</option>)}
          </select>
          <button type="submit" className="btn sm dark">Show</button>
        </form>
        {list.length === 0 ? (
          <div className="card small muted center">{view === "attention" ? "Nothing past due or over a limit. Nice." : "Nothing matches."}</div>
        ) : (
          <div className="cr-wrap">
            <table className="cr-table">
              <thead>
                <tr><th>Customer</th><th>Credit</th><th>Owes</th><th>Past due</th><th>90+</th><th>Days late</th><th>Credit line</th><th>Available</th><th>Last paid</th><th>Next follow-up</th><th>Status</th></tr>
              </thead>
              <tbody>
                {list.slice(0, 300).map((r) => {
                  const hlt = health(r);
                  return (
                    <tr key={r.company_id}>
                      <td><Link href={`/customers/${r.company_id}?from=credit`}>{r.name}</Link><div className="tiny faint">{[r.account_no, r.rep_id ? repName.get(r.rep_id) : null, r.terms, r.locations ? `${r.locations + 1} locations on one line` : null].filter(Boolean).join(" · ")}</div>
                        {r.flags.filter((f) => FLAGS[f]).length ? <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>{r.flags.filter((f) => FLAGS[f]).map((f) => <span key={f} className="pill red">{FLAGS[f]}</span>)}</div> : null}</td>
                      <td>{r.status ? <span className={STATUS[r.status].pill}>{STATUS[r.status].short}</span> : <span className="faint">–</span>}</td>
                      <td><b>{money(r.balance)}</b>{r.open_invoices ? <div className="tiny faint">{r.open_invoices} invoice{r.open_invoices === 1 ? "" : "s"}</div> : null}</td>
                      <td className={r.past_due ? "red" : "faint"}>{r.past_due ? money(r.past_due) : "–"}</td>
                      <td className={r.over_90 ? "red" : "faint"}>{r.over_90 ? <b>{money(r.over_90)}</b> : "–"}</td>
                      <td>{r.max_days_late ? <span className={`late-chip ${r.max_days_late > 90 ? "l4" : r.max_days_late > 60 ? "l3" : r.max_days_late > 30 ? "l2" : "l1"}`}>{r.max_days_late}</span> : <span className="faint">–</span>}</td>
                      <td>{r.credit_limit !== null ? money(r.credit_limit) : <span className="faint">–</span>}</td>
                      <td className={r.available !== null && r.available < 0 ? "red" : ""}>{r.available !== null ? money(r.available) : <span className="faint">–</span>}</td>
                      <td>{r.last_paid ? <>{dateShort(r.last_paid)}<div className="tiny faint">{r.last_paid_amount ? money(r.last_paid_amount) : ""}</div></> : <span className="faint">–</span>}</td>
                      <td>{r.next_follow ? <span className={r.next_follow < today ? "red" : ""}>{dateShort(r.next_follow)}</span> : <span className="faint">–</span>}</td>
                      <td><span className={hlt.pill}>{hlt.label}</span>{r.holds ? <div className="tiny red">{r.holds} on hold</div> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
