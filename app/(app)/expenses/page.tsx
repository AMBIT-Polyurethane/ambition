import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, CircleAlert, Download } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { ReportSend } from "@/components/expense-send";
import { dateShort, money } from "@/lib/format";
import { expensesReady, isMonth, monthLabel, receiptFileHref, receiptsFor, shiftMonth, thisMonth, totals, type Receipt } from "@/lib/expenses";

export const metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const now = thisMonth();
  const month = isMonth(sp.m) && sp.m <= now ? sp.m : now;
  const ready = expensesReady();

  let receipts: Receipt[] = [];
  let problem: string | null = null;
  if (ready) {
    try {
      receipts = await receiptsFor(month, profile.email);
    } catch (e) {
      problem = e instanceof Error ? e.message : "Couldn't read receipts from Jotform.";
    }
  }
  const t = totals(receipts);
  const { data: sent } = await supabase
    .from("expense_reports")
    .select("sent_at, receipt_ids, receipt_count, total, email_status")
    .eq("user_id", profile.id)
    .eq("month", `${month}-01`)
    .maybeSingle<{ sent_at: string; receipt_ids: string[]; receipt_count: number; total: number; email_status: string | null }>();
  const newSince = sent ? receipts.filter((r) => !sent.receipt_ids.includes(r.id)).length : 0;
  const label = monthLabel(month);

  return (
    <main className="shell">
      <TopBar title="Expenses" back="/" />

      <section className="exp-hero">
        <span className="kick">Company card</span>
        <h2 className="big">Snap every receipt</h2>
        <p>Each time you use your AMBIT card, take a photo of the receipt. It lands on your monthly report automatically.</p>
        <Link href="/expenses/add" className="b1"><Camera size={19} strokeWidth={2.4} /> Add a receipt</Link>
      </section>

      {!ready ? (
        <div className="alert warn small">Expense receipts aren&apos;t connected yet. An admin needs to finish the setup.</div>
      ) : problem ? (
        <div className="alert err small"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{problem}</span></div>
      ) : null}

      <div className="month-nav">
        <Link href={`/expenses?m=${shiftMonth(month, -1)}`} className="iconbtn sm" aria-label="Previous month"><ChevronLeft size={18} /></Link>
        <b>{label}</b>
        {month < now ? (
          <Link href={`/expenses?m=${shiftMonth(month, 1)}`} className="iconbtn sm" aria-label="Next month"><ChevronRight size={18} /></Link>
        ) : (
          <span className="iconbtn sm" aria-hidden="true" style={{ opacity: 0.3 }}><ChevronRight size={18} /></span>
        )}
      </div>

      <section className="card exp-sum">
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="tiny faint">TOTAL · {label.toUpperCase()}</span>
            <span className="exp-total">{money(t.total)}</span>
          </div>
          <span className="small muted">{t.count} {t.count === 1 ? "receipt" : "receipts"}</span>
        </div>
        <div className="exp-split">
          <span><i className="exp-dot card" /> AMBIT card <b>{money(t.card)}</b></span>
          <span><i className="exp-dot personal" /> Pay back to you <b>{money(t.personal)}</b></span>
        </div>
        {t.byCategory.length ? (
          <div className="exp-cats">
            {t.byCategory.map((c) => (
              <span key={c.category} className="exp-cat">{c.category} <b>{money(c.total)}</b></span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="eyebrow">Receipts</div>
        {receipts.length === 0 ? (
          <div className="card small muted center">
            {month === now ? "No receipts yet this month. Tap Add a receipt after each purchase." : `No receipts for ${label}.`}
          </div>
        ) : (
          <div className="list">
            {receipts.map((r) => (
              <a key={r.id} className="item exp-item" href={r.files.length ? receiptFileHref(r) : undefined} target="_blank" rel="noopener noreferrer">
                {r.files.length ? (
                  <img className="exp-thumb" src={receiptFileHref(r, 0, 160)} alt="" loading="lazy" />
                ) : (
                  <span className="exp-thumb empty"><Camera size={18} /></span>
                )}
                <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
                  <span className="t ellipsis">{r.vendor || "Receipt"}</span>
                  <span className="s ellipsis">{dateShort(r.date)} · {r.category}{r.purpose ? ` · ${r.purpose}` : ""}</span>
                </span>
                <span className="col" style={{ alignItems: "flex-end", gap: 3 }}>
                  <b className="nowrap">{r.amount === null ? "?" : money(r.amount)}</b>
                  {r.paidWith === "personal" ? <span className="pill warn" style={{ fontSize: 9 }}>Pay back</span> : null}
                </span>
              </a>
            ))}
          </div>
        )}
        {t.missing ? <p className="tiny warn-text" style={{ margin: 0 }}>{t.missing} receipt{t.missing === 1 ? " is" : "s are"} missing an amount. Ask an admin to fix it in Jotform.</p> : null}
      </section>

      <section className="card col" style={{ gap: 12 }}>
        <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
          <div className="col" style={{ gap: 2 }}>
            <b>{label} report</b>
            <span className="small muted">
              {sent
                ? `Sent to Corporate ${dateShort(sent.sent_at)} · ${sent.receipt_count} ${sent.receipt_count === 1 ? "receipt" : "receipts"} · ${money(Number(sent.total))}`
                : "Goes to Jeremiah, Kim and Kevin with every receipt photo."}
            </span>
          </div>
          {sent ? <span className="pill ok">Sent</span> : <span className="pill grey">Not sent</span>}
        </div>
        {sent && newSince ? (
          <div className="alert warn small" style={{ margin: 0 }}>
            {newSince} receipt{newSince === 1 ? " was" : "s were"} added after you sent it. Send it again so Corporate has everything.
          </div>
        ) : null}
        <div className="row wrap" style={{ gap: 10 }}>
          <ReportSend month={month} disabled={!receipts.length} again={Boolean(sent)} />
          <a className={`btn sm dark${receipts.length ? "" : " disabled"}`} href={`/expenses/report?m=${month}`} target="_blank" rel="noopener noreferrer" aria-disabled={!receipts.length}>
            <Download size={15} /> Download PDF
          </a>
        </div>
      </section>
    </main>
  );
}
