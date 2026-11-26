import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, FileUp, Search, Zap } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit, canSetCredit, creditOverview, FLAGS, health, STATUS, type CreditRow } from "@/lib/credit";
import { dateShort, monthDay, money } from "@/lib/format";
import { Help } from "@/components/help";
import { MoreMenu } from "@/components/order2/menu";
import { TopBar, Empty } from "@/components/ui";
import { Submit } from "@/components/forms";
import { setAutoRelease } from "./actions";
import { AgingBar } from "@/components/credit/aging-bar";
import { ColumnChart } from "@/components/inventory/charts";

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

  const short = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : Math.abs(v) >= 10_000 ? `$${Math.round(v / 1000)}k` : money(v));
  const branchList = (branches ?? []) as { id: string; name: string }[];
  const callFirst = [...rows].filter((r) => r.past_due > 0).sort((x, y) => y.past_due - x.past_due).slice(0, 6);
  const overdueFollow = promises.filter((p) => p.follow_up_on < today).length;

  return (
    <main className="shell wide">
      <div className="o2 crd">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/customers" className="o2-back" aria-label="Back to customers"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>Credit &amp; collections</h1>
              <span className="o2-sub row" style={{ gap: 8 }}>
                {all.length ? `QuickBooks balances from ${asOf ? monthDay(asOf) : "the import"}, kept current since` : "No balances imported yet"}
                <Help label="How balances are kept current">
                  Balances from QuickBooks as of {asOf ? dateShort(asOf) : "the import"}, plus orders shipped since, minus payments entered here since. Payments come off the oldest past due first.
                </Help>
              </span>
            </div>
          </div>
          <div className="o2-head-r">
            {canSetCredit(profile) ? <Link href="/credit/import" className="b2 sm"><FileUp size={16} /> Import balances</Link> : null}
          </div>
        </div>
        {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
        {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

        <section className={`card2 crd-auto${autoOn ? " on" : ""}`}>
          <span className="ihub-ic info" aria-hidden="true"><Zap size={20} /></span>
          <span className="grow row" style={{ gap: 8 }}>
            <b>Release good-standing orders automatically</b>
            <Help label="Which orders release on their own">
              When the CRM enters the Invoice #, the order releases itself if the customer Has Line Of Credit, nothing is past due (any amount, any location on a shared line) and the line covers the balance plus every open order including this one. Everything else goes to Accounting with the reason on the order.
            </Help>
          </span>
          {profile.role === "admin" ? (
            <form action={setAutoRelease}>
              <input type="hidden" name="on" value={autoOn ? "0" : "1"} />
              <Submit className={`crd-switch${autoOn ? " on" : ""}`} pendingText="...">
                <span className="knob" aria-hidden="true" />
                <span className="sr-only">{autoOn ? "Turn off" : "Turn on"}</span>
              </Submit>
            </form>
          ) : null}
          <b className={`crd-state${autoOn ? " on" : ""}`}>{autoOn ? "On" : "Off"}</b>
        </section>

        {!all.length ? (
          <div className="alert warn"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>No balances yet. {canSetCredit(profile) ? <>Tap <Link href="/credit/import">Import balances</Link> and upload the QuickBooks A/R Aging Summary (and credit limits).</> : "Accounting imports them from QuickBooks."}</span></div>
        ) : null}

        <div className="ihub-kpis">
          <Link href={qs({ v: "all" })} className="ihub-kpi"><span className="l">Owed to AMBIT</span><b>{short(ar)}</b><span className="s">{rows.filter((r) => r.balance > 0).length} accounts</span></Link>
          <Link href={qs({ v: "attention" })} className={`ihub-kpi${pastDue ? " warn" : ""}`}><span className="l">Past due</span><b>{short(pastDue)}</b><span className="s">{rows.filter((r) => r.past_due > 0).length} accounts{ar ? ` · ${Math.round((pastDue / ar) * 100)}% of it` : ""}</span></Link>
          <Link href={qs({ v: "attention" })} className={`ihub-kpi${over90 ? " err" : ""}`}><span className="l">90+ days late</span><b>{short(over90)}</b><span className="s">{rows.filter((r) => r.over_90 > 0).length} accounts</span></Link>
          <div className="ihub-kpi"><span className="l">Paid, last 30 days</span><b>{short(paid30)}</b><span className="s">Entered in the app{dso !== null ? ` · ${dso} days to collect` : ""}</span></div>
        </div>

        <section className="card2 ihub-card">
          <div className="ihub-card-h"><b>How late is it?</b><span>{rows.length} accounts</span></div>
          <AgingBar a={{ current_due: sum((r) => r.current_due), d1_30: sum((r) => r.d1_30), d31_60: sum((r) => r.d31_60), d61_90: sum((r) => r.d61_90), over_90: over90 }} />
        </section>

        <div className="ihub-grid">
          <section className="card2 ihub-card">
            <div className="ihub-card-h">
              <b>Call these first</b>
              {promises.length ? <Link href={qs({ v: "follow" })}>{overdueFollow ? `${overdueFollow} follow-up${overdueFollow === 1 ? "" : "s"} overdue` : `${promises.length} follow-up${promises.length === 1 ? "" : "s"} this week`}</Link> : null}
            </div>
            {callFirst.length ? (
              <div className="crd-call">
                {callFirst.map((r) => (
                  <Link key={r.company_id} href={`/customers/${r.company_id}?from=credit`} className="crd-call-r">
                    <span className="grow ellipsis">{r.name}</span>
                    <b className={r.over_90 ? "red" : ""}>{short(r.past_due)} late</b>
                    <ChevronRight size={16} className="chev" aria-hidden="true" />
                  </Link>
                ))}
                <Link href={qs({ v: "attention" })} className="crd-all">All {rows.filter((r) => r.past_due > 0).length} past due</Link>
              </div>
            ) : <span className="small muted">Nobody is past due.</span>}
          </section>
          <section className="card2 ihub-card">
            <div className="ihub-card-h"><b>Payments each week</b><span>Last 12 weeks</span></div>
            <ColumnChart rows={weeks} series={[{ key: "paid", label: "Paid" }]} caption="Payments entered per week" />
          </section>
        </div>

        {promises.length ? (
          <section className="card2 ihub-card">
            <div className="ihub-card-h"><b>Follow-ups and promises to pay</b><span>Next 7 days</span></div>
            <div className="crd-call">
              {promises.slice(0, 12).map((p, i) => (
                <Link key={i} href={`/customers/${p.company_id}?tab=notes&from=credit`} className="crd-call-r">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="ellipsis" style={{ display: "block", fontWeight: 700 }}>{nameOf.get(p.company_id) ?? "Customer"}</span>
                    <span className="tiny faint ellipsis" style={{ display: "block" }}>{p.kind === "promise" ? `Promised ${p.promise_amount ? money(Number(p.promise_amount)) : ""}: ` : ""}{p.body}</span>
                  </span>
                  <span className={`pill2 sm ${p.follow_up_on < today ? "err" : p.follow_up_on === today ? "warn" : ""}`}>{p.follow_up_on < today ? "Overdue · " : ""}{monthDay(p.follow_up_on)}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

      <section className="col" style={{ gap: 10 }}>
        <div className="stk-bar">
          <nav className="seg2" aria-label="Show">
            {VIEWS.map((v) => <Link key={v.key} href={qs({ v: v.key })} className={view === v.key ? "on" : undefined} aria-current={view === v.key ? "page" : undefined}>{v.label}</Link>)}
          </nav>
          <form className="stk-search" action="/credit" role="search">
            <Search size={18} aria-hidden="true" />
            <input type="hidden" name="v" value={view} />
            {sf ? <input type="hidden" name="s" value={sf} /> : null}
            {sp.b ? <input type="hidden" name="b" value={sp.b} /> : null}
            {sp.rep ? <input type="hidden" name="rep" value={sp.rep} /> : null}
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Customer or account #" aria-label="Search customers" />
          </form>
        </div>
        <div className="stk-bar">
          <MoreMenu label="Credit status" triggerClass="stk-select ord-loc" trigger={<><span>Credit</span><b>{sf ? STATUS[sf as keyof typeof STATUS].short : "Every status"}</b><ChevronDown size={16} aria-hidden="true" /></>}>
            <Link className="menu2-i" href={qs({ s: "" })}>Every status</Link>
            {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => <Link key={k} className="menu2-i" href={qs({ s: k })}>{STATUS[k].label} <span className="faint">· {rolled.filter((r) => r.status === k).length}</span></Link>)}
          </MoreMenu>
          <MoreMenu label="Location" triggerClass="stk-select ord-loc" trigger={<><span>Location</span><b>{sp.b ? branchList.find((x) => x.id === sp.b)?.name ?? "One" : "Every location"}</b><ChevronDown size={16} aria-hidden="true" /></>}>
            <Link className="menu2-i" href={qs({ b: "" })}>Every location</Link>
            {branchList.map((x) => <Link key={x.id} className="menu2-i" href={qs({ b: x.id })}>{x.name}</Link>)}
          </MoreMenu>
          <MoreMenu label="Sales rep" triggerClass="stk-select ord-loc" trigger={<><span>Rep</span><b>{sp.rep ? repName.get(sp.rep) ?? "Rep" : "Every rep"}</b><ChevronDown size={16} aria-hidden="true" /></>}>
            <Link className="menu2-i" href={qs({ rep: "" })}>Every rep</Link>
            {reps.map((id) => <Link key={id} className="menu2-i" href={qs({ rep: id })}>{repName.get(id) ?? "Rep"}</Link>)}
          </MoreMenu>
        </div>
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
      </div>
    </main>
  );
}
