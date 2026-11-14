import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { allRows } from "@/lib/prices";
import { TopBar } from "@/components/ui";

export const metadata = { title: "Price request dashboard" };
export const dynamic = "force-dynamic";

type Pr = { id: number; created_at: string; created_by: string | null; rep_name: string | null; company_id: string | null; customer_kind: string | null; status: string; product_lines: string[] | null };
type Ln = { request_id: number; product_id: string | null; sku: string; name: string; basis: string | null; unit: string | null; requested_price: number; approved_price: number | null; status: string };
const RANGES = [30, 90, 180, 365];
const BASIS: Record<string, string> = { lb: "/lb", sqft: "/sq ft", unit: "" };
const isoDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** Price requests at a glance: how many, what prices reps ask for, who turns quotes into accounts, new vs existing. */
export default async function PrfDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!(profile.role === "admin" || can(profile, "prf_approve"))) redirect("/price-requests");
  const days = RANGES.includes(Number(sp.d)) ? Number(sp.d) : 90;
  const now = new Date();
  const since = new Date(now.getTime() - Math.max(days, 60) * 864e5).toISOString();
  const prs = await allRows<Pr>((f, t) => supabase.from("price_requests").select("id, created_at, created_by, rep_name, company_id, customer_kind, status, product_lines").gte("created_at", since).order("created_at").range(f, t));
  const ids = prs.map((r) => r.id);
  const [lines, setups] = await Promise.all([
    ids.length ? allRows<Ln>((f, t) => supabase.from("price_request_lines").select("request_id, product_id, sku, name, basis, unit, requested_price, approved_price, status").in("request_id", ids).range(f, t)) : Promise.resolve([] as Ln[]),
    ids.length ? allRows<{ price_request_id: number; status: string }>((f, t) => supabase.from("form_submissions").select("price_request_id, status").eq("form_key", "account_setup").in("price_request_id", ids).in("status", ["submitted", "approved"]).range(f, t)) : Promise.resolve([]),
  ]);
  const cut = (n: number) => new Date(now.getTime() - n * 864e5).toISOString();
  const inRange = prs.filter((r) => r.created_at >= cut(days));
  const last30 = prs.filter((r) => r.created_at >= cut(30));
  const prev30 = prs.filter((r) => r.created_at >= cut(60) && r.created_at < cut(30));
  const isNew = (r: Pr) => (r.customer_kind ? r.customer_kind !== "existing" : !r.company_id);

  // New price requests per day, last 30 days
  const perDay = Array.from({ length: 30 }, (_, i) => { const d = isoDay(new Date(now.getTime() - (29 - i) * 864e5)); return { d, n: last30.filter((r) => isoDay(new Date(r.created_at)) === d).length }; });
  const peak = Math.max(1, ...perDay.map((x) => x.n));
  const delta = last30.length - prev30.length;

  // New vs existing
  const nNew = inRange.filter(isNew).length;
  const pctNew = inRange.length ? Math.round((nNew / inRange.length) * 100) : 0;

  // Average price asked, per item (by how it's priced)
  const inIds = new Set(inRange.map((r) => r.id));
  const groups = new Map<string, { name: string; sku: string; basis: string; asks: number[]; approved: number[] }>();
  for (const l of lines) {
    if (!inIds.has(l.request_id)) continue;
    const k = `${l.product_id ?? l.sku}|${l.basis ?? "unit"}`;
    if (!groups.has(k)) groups.set(k, { name: l.name, sku: l.sku, basis: l.basis ?? "unit", asks: [], approved: [] });
    const g = groups.get(k)!;
    g.asks.push(Number(l.requested_price));
    if (l.status === "approved" && l.approved_price !== null) g.approved.push(Number(l.approved_price));
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : null);
  const items = [...groups.values()].map((g) => ({ ...g, n: g.asks.length, avg: avg(g.asks)!, min: Math.min(...g.asks), max: Math.max(...g.asks), ok: avg(g.approved) })).sort((a, b) => b.n - a.n).slice(0, 20);
  const dp = (b: string) => (b === "unit" ? 2 : b === "lb" ? 3 : 4);
  const fmt = (n: number, b: string) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp(b), maximumFractionDigits: dp(b) })}${BASIS[b] ?? ""}`;

  // Reps: new-customer price requests that went on to an account setup
  const setupFor = new Set(setups.map((s) => s.price_request_id));
  const approvedFor = new Set(setups.filter((s) => s.status === "approved").map((s) => s.price_request_id));
  const reps = new Map<string, { name: string; all: number; fresh: number; setup: number; opened: number }>();
  for (const r of inRange) {
    const k = r.created_by ?? r.rep_name ?? "?";
    if (!reps.has(k)) reps.set(k, { name: r.rep_name ?? "Unknown", all: 0, fresh: 0, setup: 0, opened: 0 });
    const x = reps.get(k)!;
    x.all++;
    if (isNew(r)) { x.fresh++; if (setupFor.has(r.id)) x.setup++; if (approvedFor.has(r.id)) x.opened++; }
  }
  const repRows = [...reps.values()].map((x) => ({ ...x, pct: x.fresh ? Math.round((x.setup / x.fresh) * 100) : null })).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.setup - a.setup || b.all - a.all);
  const status = ["pending", "approved", "partly", "denied", "withdrawn"].map((k) => ({ k, n: inRange.filter((r) => r.status === k).length }));

  return (
    <main className="shell wide">
      <TopBar title="Price request dashboard" back="/price-requests" />
      <div className="chips">{RANGES.map((d) => <Link key={d} href={`/price-requests/dashboard?d=${d}`} className={`chip sm${d === days ? " on" : ""}`}>Last {d} days</Link>)}</div>

      <div className="prd-grid">
        <section className="card col prd-wide" style={{ gap: 10 }}>
          <div className="row between wrap"><b>New price requests, last 30 days</b><span className="small"><b style={{ fontSize: 26 }}>{last30.length}</b> <span className={delta > 0 ? "ok-text" : delta < 0 ? "red" : "faint"}>{delta > 0 ? "+" : ""}{delta} vs the 30 days before</span></span></div>
          <div className="prd-bars" role="img" aria-label={`Price requests per day: ${perDay.map((x) => x.n).join(", ")}`}>
            {perDay.map((x) => <span key={x.d} title={`${new Date(`${x.d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${x.n}`}><i style={{ height: `${(x.n / peak) * 100}%` }} /></span>)}
          </div>
          <div className="row between tiny faint"><span>30 days ago</span><span>Today</span></div>
        </section>

        <section className="card col" style={{ gap: 10 }}>
          <b>New accounts vs. existing customers</b>
          <div className="prd-split" role="img" aria-label={`${pctNew}% new, ${100 - pctNew}% existing`}><span style={{ width: `${pctNew}%` }} /></div>
          <div className="row between">
            <span className="col tight"><b style={{ fontSize: 26 }}>{pctNew}%</b><span className="tiny muted">new or coming back · {nNew}</span></span>
            <span className="col tight" style={{ textAlign: "right" }}><b style={{ fontSize: 26 }}>{inRange.length ? 100 - pctNew : 0}%</b><span className="tiny muted">existing · {inRange.length - nNew}</span></span>
          </div>
          <span className="tiny faint">{inRange.length} price requests in the last {days} days</span>
        </section>

        <section className="card col" style={{ gap: 8 }}>
          <b>Where they stand</b>
          {status.filter((s) => s.n).map((s) => (
            <div key={s.k} className="prd-hbar"><span className="small">{{ pending: "Waiting", approved: "Approved", partly: "Partly approved", denied: "Not approved", withdrawn: "Withdrawn" }[s.k]}</span>
              <span className="prd-track"><i style={{ width: `${(s.n / Math.max(1, inRange.length)) * 100}%` }} /></span><b className="small">{s.n}</b></div>
          ))}
          {!inRange.length ? <span className="small muted">None yet.</span> : null}
        </section>

        <section className="card col prd-wide" style={{ gap: 8 }}>
          <div className="row between wrap"><b>Which reps turn price requests into accounts</b><span className="tiny faint">New-customer price requests that went on to an account setup</span></div>
          <div className="prd-reps">
            <span className="tiny faint">Rep</span><span className="tiny faint">Conversion</span><span className="tiny faint num">New-customer PRFs</span><span className="tiny faint num">Account setups</span><span className="tiny faint num">Opened</span><span className="tiny faint num">All PRFs</span>
            {repRows.map((r) => (
              <div key={r.name} className="prd-rep">
                <b className="small">{r.name}</b>
                <span className="prd-hbar"><span className="prd-track"><i style={{ width: `${r.pct ?? 0}%` }} /></span><b className="small">{r.pct === null ? "–" : `${r.pct}%`}</b></span>
                <span className="small num">{r.fresh}</span><span className="small num">{r.setup}</span><span className="small num">{r.opened}</span><span className="small num faint">{r.all}</span>
              </div>
            ))}
          </div>
          {!repRows.length ? <span className="small muted">No price requests yet.</span> : null}
        </section>

        <section className="card col prd-wide" style={{ gap: 8 }}>
          <div className="row between wrap"><b>Average price asked, per item</b><span className="tiny faint">The bar runs from the lowest to the highest ask; the dot is the average</span></div>
          <div className="prd-items">
            <span className="tiny faint">Item</span><span className="tiny faint num">Asks</span><span className="tiny faint">Lowest – highest</span><span className="tiny faint num">Average asked</span><span className="tiny faint num">Average approved</span>
            {items.map((g) => {
              const lo = g.min * 0.97, hi = Math.max(g.max * 1.03, lo + 0.0001);
              const x = (n: number) => `${((n - lo) / (hi - lo)) * 100}%`;
              return (
                <div key={`${g.sku}${g.basis}`} className="prd-item">
                  <span className="col tight" style={{ minWidth: 0 }}><b className="small ellipsis">{g.name}</b><span className="tiny faint">{g.sku}</span></span>
                  <span className="small num">{g.n}</span>
                  <span className="prd-range" title={`${fmt(g.min, g.basis)} – ${fmt(g.max, g.basis)}, average ${fmt(g.avg, g.basis)}`}><i style={{ left: x(g.min), width: `calc(${x(g.max)} - ${x(g.min)})` }} /><b style={{ left: x(g.avg) }} /></span>
                  <b className="small num">{fmt(g.avg, g.basis)}</b>
                  <span className="small num">{g.ok === null ? <span className="faint">–</span> : fmt(g.ok, g.basis)}</span>
                </div>
              );
            })}
          </div>
          {!items.length ? <span className="small muted">No prices asked in this period.</span> : null}
          <span className="tiny faint">Older Jotform price requests aren&apos;t counted; only ones made in the app.</span>
        </section>
      </div>
    </main>
  );
}
