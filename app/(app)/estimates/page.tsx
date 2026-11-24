import Link from "next/link";
import { redirect } from "next/navigation";
import { Percent, Plus } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can, canEstimate, canFreight } from "@/lib/access";
import { dateShort, money } from "@/lib/format";
import { ESTIMATE_STATUS, estNo, type Estimate, type EstimateStatus } from "@/lib/estimates";
import { TopBar } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimates" };

type Row = Pick<Estimate, "id" | "est_no" | "company_name" | "status" | "created_by" | "created_by_name" | "delivery_method" | "subtotal" | "total" | "freight" | "updated_at" | "created_at" | "sent_at">;
const TABS: { key: string; label: string; statuses: EstimateStatus[] | null }[] = [
  { key: "open", label: "Open", statuses: ["draft", "needs_freight", "ready", "sent"] },
  { key: "freight", label: "Needs freight", statuses: ["needs_freight"] },
  { key: "ready", label: "Ready to send", statuses: ["ready"] },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "done", label: "Ordered", statuses: ["converted"] },
  { key: "all", label: "All", statuses: null },
];

/** Unofficial estimates: reps build them, CRMs add freight, either sends them; any can become an order. */
export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canEstimate(profile)) redirect("/");
  const crm = canFreight(profile);
  // Reps start on their own; CRMs (and admins) on everyone's.
  const mine = sp.who ? sp.who === "mine" : !crm;
  const tab = TABS.find((t) => t.key === sp.tab) ?? (crm ? TABS[1] : TABS[0]);
  const q = (sp.q ?? "").trim();

  let query = supabase
    .from("estimates")
    .select("id, est_no, company_name, status, created_by, created_by_name, delivery_method, subtotal, total, freight, updated_at, created_at, sent_at")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (tab.statuses) query = query.in("status", tab.statuses);
  if (mine) query = query.eq("created_by", profile.id);
  if (q) query = /^est-?\d+$/i.test(q) || /^\d+$/.test(q) ? query.eq("est_no", Number(q.replace(/\D/g, ""))) : query.ilike("company_name", `%${q.replace(/[%_,()]/g, " ")}%`);
  const [{ data, error }, { data: counts }] = await Promise.all([
    query,
    supabase.from("estimates").select("status, created_by").in("status", ["draft", "needs_freight", "ready", "sent"]).limit(2000),
  ]);
  const rows = (data ?? []) as Row[];
  const cnt = (statuses: EstimateStatus[] | null) =>
    statuses ? ((counts ?? []) as { status: EstimateStatus; created_by: string | null }[]).filter((c) => statuses.includes(c.status) && (!mine || c.created_by === profile.id)).length : null;
  const href = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const all = { tab: tab.key, who: mine ? "mine" : "all", q: q || undefined, ...p };
    for (const [k, v] of Object.entries(all)) if (v) u.set(k, v);
    return `/estimates?${u.toString()}`;
  };
  const taxOk = profile.role === "admin" || can(profile, "credit_check") || crm;

  return (
    <main className="shell full">
      <TopBar
        title="Estimates"
        right={
          <div className="row" style={{ gap: 8 }}>
            {taxOk ? <Link href="/estimates/tax-rates" className="btn sm ghost"><Percent size={15} /> Tax rates</Link> : null}
            <Link href="/estimates/new" className="btn sm"><Plus size={15} /> New estimate</Link>
          </div>
        }
      />
      {error ? <div className="alert warn small">Estimates need database update 0108 first (Supabase &gt; SQL Editor).</div> : null}
      <p className="small muted" style={{ marginTop: 0 }}>
        Unofficial estimates for customers. The rep lists the items (prices come from the customer&apos;s price list and can&apos;t be changed), a CRM adds the quoted freight for deliveries, the sales tax comes from the tax rate table, then the rep or the CRM emails it. Any estimate can be turned into an order.
      </p>
      <div className="row wrap between" style={{ gap: 8, marginBottom: 10 }}>
        <div className="chips wrap">
          {TABS.map((t) => {
            const n = cnt(t.statuses);
            return (
              <Link key={t.key} href={href({ tab: t.key })} className={`chip sm${t.key === tab.key ? " on" : ""}`}>
                {t.label}{n ? ` · ${n}` : ""}
              </Link>
            );
          })}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg sm">
            <Link href={href({ who: "mine" })} className={mine ? "on" : ""} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 9, padding: "0 12px", height: 34, fontWeight: 700, fontSize: 12.5, background: mine ? "var(--red)" : "transparent", color: mine ? "#fff" : "var(--text2)" }}>Mine</Link>
            <Link href={href({ who: "all" })} className={!mine ? "on" : ""} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 9, padding: "0 12px", height: 34, fontWeight: 700, fontSize: 12.5, background: !mine ? "var(--red)" : "transparent", color: !mine ? "#fff" : "var(--text2)" }}>Everyone&apos;s</Link>
          </div>
          <form action="/estimates" className="search" style={{ minWidth: 220 }}>
            <input type="hidden" name="tab" value={tab.key} />
            <input type="hidden" name="who" value={mine ? "mine" : "all"} />
            <input className="input sm" name="q" defaultValue={q} placeholder="Customer or EST #" aria-label="Find an estimate" style={{ paddingLeft: 12 }} />
          </form>
        </div>
      </div>
      <div className="cr-wrap card" style={{ padding: 0 }}>
        <table className="cr-table">
          <thead>
            <tr><th>Estimate</th><th>Customer</th><th>Rep</th><th>Status</th><th>Freight</th><th>Total</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = ESTIMATE_STATUS[r.status];
              return (
                <tr key={r.id}>
                  <td><Link href={`/estimates/${r.id}`}>{estNo(r.est_no)}</Link></td>
                  <td style={{ textAlign: "left", whiteSpace: "normal" }}><Link href={`/estimates/${r.id}`}>{r.company_name}</Link></td>
                  <td style={{ textAlign: "left" }}>{r.created_by_name ?? ""}</td>
                  <td style={{ textAlign: "left" }}><span className={`pill ${st.pill}`}>{st.label}</span></td>
                  <td>{r.delivery_method === "pickup" ? <span className="muted">Pickup</span> : r.freight === null ? <span className="warn-t">Needed</span> : money(Number(r.freight))}</td>
                  <td><b>{money(Number(r.total ?? r.subtotal))}</b></td>
                  <td>{dateShort(r.updated_at)}</td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr><td colSpan={7} className="small muted" style={{ textAlign: "center", padding: 24 }}>No estimates here{mine ? " of yours" : ""}. <Link href="/estimates/new">Start one</Link>.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
