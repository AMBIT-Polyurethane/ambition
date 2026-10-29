import Link from "next/link";
import { CircleAlert, CircleCheck, FileSignature, Plus, Ruler, Search, ShieldAlert } from "lucide-react";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { QUOTE_STATUS } from "@/lib/ops/quotes";
import { money } from "@/lib/ops/quote-calc";
import { dateShort } from "@/lib/format";
import { Empty, TopBar } from "@/components/ui";

export const metadata = { title: "Quotes" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "draft", label: "Drafts" },
  { id: "out", label: "Waiting on the customer" },
  { id: "signed", label: "Signed" },
  { id: "all", label: "All" },
];

type Row = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  needs_approval: boolean;
  approved_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  signed_total: number | null;
  valid_until: string | null;
  updated_at: string;
  totals: { options?: Record<string, { total: number; margin: number | null }> };
  customer: { name: string } | null;
  property: { street: string | null; city: string | null } | null;
};

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireOps(opsCan.crm);
  const f = FILTERS.some((x) => x.id === sp.f) ? sp.f! : "open";
  const q = (sp.q ?? "").trim().replace(/[\\%_,()]/g, " ").slice(0, 80);
  let query = supabase
    .from("ops_quotes")
    .select("id, number, title, status, needs_approval, approved_at, sent_at, viewed_at, signed_at, signed_total, valid_until, updated_at, totals, customer:ops_customers(name), property:ops_properties(street, city)")
    .eq("company_id", ws.company.id)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (f === "open") query = query.in("status", ["draft", "sent", "viewed"]);
  if (f === "draft") query = query.eq("status", "draft");
  if (f === "out") query = query.in("status", ["sent", "viewed"]);
  if (f === "signed") query = query.eq("status", "signed");
  if (q) {
    const num = Number(q.replace(/^#/, ""));
    query = Number.isInteger(num) && num > 0 ? query.eq("number", num) : query.ilike("title", `%${q}%`);
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const today = new Date().toISOString().slice(0, 10);
  const total = (r: Row) => {
    if (r.signed_total !== null && r.signed_total !== undefined) return Number(r.signed_total);
    const t = Object.values(r.totals?.options ?? {}).map((o) => o.total);
    return t.length ? Math.max(...t) : 0;
  };
  const canQuote = opsCan.quote(ws.role);

  return (
    <main className="shell wide">
      <TopBar
        title="Quotes"
        back="/ops"
        right={
          canQuote ? (
            <span className="row" style={{ gap: 8 }}>
              <Link href="/takeoff" className="btn sm dark"><Ruler size={15} /> Takeoffs</Link>
              <Link href="/ops/quotes/new" className="btn sm"><Plus size={16} /> New quote</Link>
            </span>
          ) : undefined
        }
      />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <form className="search" action="/ops/quotes" style={{ flex: "1 1 240px" }}>
          <Search size={18} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Quote # or job name" aria-label="Search quotes" />
          <input type="hidden" name="f" value={f} />
        </form>
        <div className="chips scroll-x">
          {FILTERS.map((x) => (
            <Link key={x.id} href={`/ops/quotes?f=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${x.id === f ? " on" : ""}`}>{x.label}</Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        q || f !== "open" ? (
          <div className="card muted small center">No quotes match.</div>
        ) : (
          <Empty icon="docs" title="No quotes yet">
            Start one from a lead (its page has &quot;Build the quote&quot;), from a takeoff (&quot;Quote it&quot;), or right here.
            {canQuote ? <div style={{ marginTop: 12 }}><Link href="/ops/quotes/new" className="btn sm"><Plus size={15} /> New quote</Link></div> : null}
          </Empty>
        )
      ) : (
        <div className="list">
          {rows.map((r) => {
            const st = QUOTE_STATUS[r.status] ?? QUOTE_STATUS.draft;
            const expired = r.valid_until && r.valid_until < today && ["sent", "viewed"].includes(r.status);
            const where = [r.property?.street, r.property?.city].filter(Boolean).join(", ");
            return (
              <Link key={r.id} href={`/ops/quotes/${r.id}`} className="item">
                <span className="ops-q-ic" aria-hidden="true"><FileSignature size={18} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{r.customer?.name ?? "Customer"}{r.title ? <span className="faint"> · {r.title}</span> : null}</div>
                  <div className="s ellipsis">
                    #{r.number}
                    {where ? ` · ${where}` : ""}
                    {r.status === "signed" && r.signed_at ? ` · signed ${dateShort(r.signed_at)}` : r.viewed_at ? ` · opened ${dateShort(r.viewed_at)}` : r.sent_at ? ` · sent ${dateShort(r.sent_at)}` : ` · updated ${dateShort(r.updated_at)}`}
                  </div>
                </div>
                <span className="col tight" style={{ alignItems: "flex-end", flex: "none" }}>
                  <b>{money(total(r), false)}</b>
                  <span className="row" style={{ gap: 6 }}>
                    {r.needs_approval && !r.approved_at && r.status === "draft" ? <span className="pill warn"><ShieldAlert size={11} /> Needs OK</span> : null}
                    {expired ? <span className="pill grey">Ran out</span> : <span className={st.cls}>{st.label}</span>}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
