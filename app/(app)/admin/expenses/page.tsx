import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, Download, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { dateShort, money } from "@/lib/format";
import { jotformInboxUrl } from "@/lib/forms";
import { EXPENSE_FORM_ID, expensesReady, isMonth, monthLabel, receiptFileHref, receiptsFor, shiftMonth, thisMonth, totals, type Receipt } from "@/lib/expenses";

export const metadata = { title: "Expense reports" };
export const dynamic = "force-dynamic";

type Person = { id: string; email: string; full_name: string | null };
type Sent = { user_id: string; sent_at: string; receipt_ids: string[]; email_status: string | null };

export default async function AdminExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const now = thisMonth();
  const month = isMonth(sp.m) && sp.m <= now ? sp.m : now;
  const label = monthLabel(month);

  let receipts: Receipt[] = [];
  let problem: string | null = null;
  if (expensesReady()) {
    try {
      receipts = await receiptsFor(month);
    } catch (e) {
      problem = e instanceof Error ? e.message : "Couldn't read receipts from Jotform.";
    }
  }
  const [{ data: staff }, { data: sentRows }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").eq("status", "active").in("role", ["employee", "admin"]).order("full_name"),
    supabase.from("expense_reports").select("user_id, sent_at, receipt_ids, email_status").eq("month", `${month}-01`),
  ]);
  const people = (staff ?? []) as Person[];
  const sent = new Map(((sentRows ?? []) as Sent[]).map((r) => [r.user_id, r]));
  const byEmail = new Map<string, Receipt[]>();
  for (const r of receipts) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);

  // Everyone on staff, plus anyone who uploaded receipts under an email that isn't an account.
  const rows = [
    ...people.map((p) => ({ key: p.id, name: p.full_name || p.email, email: p.email.toLowerCase(), person: p as Person | null })),
    ...[...byEmail.keys()].filter((e) => !people.some((p) => p.email.toLowerCase() === e)).map((e) => ({ key: e, name: byEmail.get(e)![0].name || e, email: e, person: null })),
  ]
    .map((r) => ({ ...r, list: byEmail.get(r.email) ?? [], sent: r.person ? sent.get(r.person.id) ?? null : null }))
    .sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  const all = totals(receipts);
  const withReceipts = rows.filter((r) => r.list.length);
  const quiet = rows.filter((r) => !r.list.length);

  return (
    <main className="shell wide">
      <TopBar
        title="Expense reports"
        back="/admin"
        right={
          EXPENSE_FORM_ID ? (
            <a className="iconbtn" href={jotformInboxUrl(EXPENSE_FORM_ID)} target="_blank" rel="noopener noreferrer" aria-label="Open the receipts in Jotform"><ExternalLink size={18} /></a>
          ) : null
        }
      />
      {!expensesReady() ? <div className="alert warn small">The receipt form isn&apos;t connected yet.</div> : null}
      {problem ? <div className="alert err small"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{problem}</span></div> : null}

      <div className="month-nav" style={{ maxWidth: 420 }}>
        <Link href={`/admin/expenses?m=${shiftMonth(month, -1)}`} className="iconbtn sm" aria-label="Previous month"><ChevronLeft size={18} /></Link>
        <b>{label}</b>
        {month < now ? (
          <Link href={`/admin/expenses?m=${shiftMonth(month, 1)}`} className="iconbtn sm" aria-label="Next month"><ChevronRight size={18} /></Link>
        ) : (
          <span className="iconbtn sm" aria-hidden="true" style={{ opacity: 0.3 }}><ChevronRight size={18} /></span>
        )}
      </div>

      <section className="card exp-sum">
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="tiny faint">ALL EMPLOYEES · {label.toUpperCase()}</span>
            <span className="exp-total">{money(all.total)}</span>
          </div>
          <span className="small muted">{all.count} receipts · {withReceipts.length} {withReceipts.length === 1 ? "person" : "people"}</span>
        </div>
        <div className="exp-split">
          <span><i className="exp-dot card" /> AMBIT card <b>{money(all.card)}</b></span>
          <span><i className="exp-dot personal" /> Owed to employees <b>{money(all.personal)}</b></span>
          <span>Reports sent <b>{withReceipts.filter((r) => r.sent).length} of {withReceipts.length}</b></span>
        </div>
      </section>

      <div className="col" style={{ gap: 10 }}>
        {withReceipts.map((r) => {
          const t = totals(r.list);
          const late = r.sent ? r.list.filter((x) => !r.sent!.receipt_ids.includes(x.id)).length : 0;
          return (
            <details key={r.key} className="card">
              <summary className="row between wrap" style={{ gap: 10, alignItems: "center" }}>
                <span className="col" style={{ gap: 2 }}>
                  <b>{r.name}</b>
                  <span className="small muted">{t.count} {t.count === 1 ? "receipt" : "receipts"} · Card {money(t.card)}{t.personal ? ` · Pay back ${money(t.personal)}` : ""}</span>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  {r.sent ? <span className="pill ok">Sent {dateShort(r.sent.sent_at)}{late ? ` · ${late} new` : ""}</span> : <span className="pill grey">Not sent</span>}
                  <b className="nowrap">{money(t.total)}</b>
                </span>
              </summary>
              <div className="col" style={{ gap: 10, marginTop: 12 }}>
                <div className="list">
                  {r.list.map((x) => (
                    <a key={x.id} className="item exp-item" href={x.files.length ? receiptFileHref(x) : undefined} target="_blank" rel="noopener noreferrer">
                      {x.files.length ? <img className="exp-thumb" src={receiptFileHref(x, 0, 160)} alt="" loading="lazy" /> : <span className="exp-thumb empty" />}
                      <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
                        <span className="t ellipsis">{x.vendor || "Receipt"}</span>
                        <span className="s ellipsis">{dateShort(x.date)} · {x.category}{x.purpose ? ` · ${x.purpose}` : ""}</span>
                      </span>
                      <span className="col" style={{ alignItems: "flex-end", gap: 3 }}>
                        <b className="nowrap">{x.amount === null ? "?" : money(x.amount)}</b>
                        {x.paidWith === "personal" ? <span className="pill warn" style={{ fontSize: 9 }}>Pay back</span> : null}
                      </span>
                    </a>
                  ))}
                </div>
                <div>
                  <a className="btn sm dark" href={`/expenses/report?m=${month}&email=${encodeURIComponent(r.email)}`} target="_blank" rel="noopener noreferrer">
                    <Download size={15} /> Report PDF
                  </a>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      {quiet.length ? (
        <section className="section">
          <div className="eyebrow">No receipts for {label}</div>
          <p className="small muted" style={{ margin: 0 }}>{quiet.map((r) => r.name).join(" · ")}</p>
        </section>
      ) : null}
    </main>
  );
}
