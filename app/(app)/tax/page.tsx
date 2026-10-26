import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { taxCounts, taxOverview } from "@/lib/tax-server";
import { TAX_STATE } from "@/lib/tax";
import { dateShort } from "@/lib/format";
import type { Company } from "@/lib/types";

export const metadata = { title: "Tax certificates" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { id: "attention", label: "Needs attention" },
  { id: "expiring", label: "Expiring in 60 days" },
  { id: "all", label: "All tax-exempt" },
];

export default async function TaxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requirePerm("credit_check");
  const rows = await taxOverview(supabase);
  const f = FILTERS.some((x) => x.id === sp.f) ? sp.f! : "attention";
  const q = (sp.q ?? "").trim().toLowerCase();

  // For "add a certificate for a customer who isn't on the list yet".
  const { data: comps } = q
    ? await supabase.from("companies").select("id, name, account_no").eq("active", true).ilike("name", `%${q.replace(/[%_]/g, "")}%`).order("name").limit(15)
    : { data: [] };

  if (!rows) {
    return (
      <main className="shell">
        <TopBar title="Tax certificates" back="/" />
        <div className="alert warn small">Run supabase/migrations/0021_intake_photos_reorder_tax.sql in Supabase first.</div>
      </main>
    );
  }
  const counts = taxCounts(rows);
  const order = { expired: 0, missing: 1, pending: 2, expiring: 3, ok: 4, taxable: 5 } as Record<string, number>;
  const shown = rows
    .filter((r) => (f === "all" ? true : f === "expiring" ? r.state === "expiring" : (r.state !== "ok" && r.state !== "taxable") || r.pending > 0))
    .filter((r) => !q || `${r.company_name} ${r.account_no ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || (a.days_left ?? 9999) - (b.days_left ?? 9999) || a.company_name.localeCompare(b.company_name));

  return (
    <main className="shell wide">
      <TopBar title="Tax certificates" back="/" />
      <p className="muted small" style={{ margin: 0 }}>
        Every tax-exempt customer&apos;s certificate. Orders from customers whose certificate is expired, missing or not verified yet wait at the credit
        check until a current one is verified (or you choose to charge sales tax on that order).
      </p>
      <div className="ai-stats">
        <div className="card"><span className="eyebrow">Expired or missing</span><b className={counts.expired ? "err-text" : ""}>{counts.expired}</b></div>
        <div className="card"><span className="eyebrow">Expire in 30 days</span><b>{counts.soon}</b></div>
        <div className="card"><span className="eyebrow">Expire in 60 days</span><b>{counts.soon60}</b></div>
        <div className="card"><span className="eyebrow">Waiting to verify</span><b className={counts.pending ? "ok-text" : ""}>{counts.pending}</b></div>
      </div>

      <form className="search" action="/tax">
        <input type="hidden" name="f" value={f} />
        <input className="input sm" name="q" defaultValue={sp.q ?? ""} placeholder="Find a customer (to see or add a certificate)" aria-label="Find a customer" />
      </form>
      <nav className="chips">
        {FILTERS.map((x) => (
          <Link key={x.id} className={`chip sm${f === x.id ? " on" : ""}`} href={`/tax?f=${x.id}${q ? `&q=${encodeURIComponent(sp.q ?? "")}` : ""}`}>{x.label}</Link>
        ))}
      </nav>

      {shown.length ? (
        <div className="list">
          {shown.map((r) => {
            const st = TAX_STATE[r.state] ?? TAX_STATE.taxable;
            return (
              <Link key={r.company_id} href={`/tax/${r.company_id}`} className="item">
                <div className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{r.company_name}{r.account_no ? <span className="faint" style={{ fontWeight: 500 }}> · {r.account_no}</span> : null}</span>
                  <span className="s">
                    {r.expires_on ? `${r.state === "expired" ? "Expired" : "Expires"} ${dateShort(r.expires_on)}` : r.state === "ok" ? "No expiration" : ""}
                    {r.cert_number ? ` · #${r.cert_number}` : ""}
                    {r.pending ? ` · ${r.pending} waiting to verify` : ""}
                    {r.last_order_at ? ` · last order ${dateShort(r.last_order_at)}` : ""}
                  </span>
                </div>
                <span className={st.cls}>{r.state === "expiring" && r.days_left !== null ? `${r.days_left} days left` : st.label}</span>
                <ChevronRight size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="alert info small">{f === "attention" ? "Nothing needs attention right now." : "No customers here yet."}</div>
      )}

      {q && comps?.length ? (
        <section className="section">
          <div className="eyebrow">Other customers matching &ldquo;{sp.q}&rdquo;</div>
          <div className="list">
            {(comps as Pick<Company, "id" | "name" | "account_no">[])
              .filter((c) => !rows.some((r) => r.company_id === c.id))
              .map((c) => (
                <Link key={c.id} href={`/tax/${c.id}`} className="item">
                  <div className="grow"><span className="t">{c.name}</span>{c.account_no ? <span className="faint small"> · {c.account_no}</span> : null}</div>
                  <span className="pill grey">Add certificate</span>
                  <ChevronRight size={18} className="chev" />
                </Link>
              ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
