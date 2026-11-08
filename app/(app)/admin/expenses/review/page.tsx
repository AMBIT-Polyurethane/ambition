import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Download } from "lucide-react";
import { requireExpenseApprover } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { dateShort, money } from "@/lib/format";
import { chargeLabel, isMonth, loadMonth, monthLabel, reportBadge, shiftMonth, thisMonth, type XReport } from "@/lib/expenses";
import { MonthSummary, OtherCharges, ReceiptList } from "@/components/expenses/month-lists";
import { ChargeTools, ReviewForm, UndoExcuse, type Person } from "@/components/expenses/admin-bits";

export const metadata = { title: "Review expenses" };
export const dynamic = "force-dynamic";

// One person's month, for an approver: every receipt and card charge, then Approve or Send back.
export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireExpenseApprover();
  const uid = sp.u ?? "";
  const now = thisMonth();
  const month = isMonth(sp.m) && sp.m <= now ? sp.m : now;
  if (!/^[0-9a-f-]{36}$/i.test(uid)) notFound();

  const [{ data: who }, data, { data: hist }, { data: staffRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, job_role, branch_id").eq("id", uid).maybeSingle(),
    loadMonth(supabase, uid, month),
    supabase.from("expense_reports").select("month, status, total").eq("user_id", uid).order("month", { ascending: false }).limit(8),
    supabase.from("profiles").select("id, full_name, email").eq("status", "active").in("role", ["employee", "admin"]).order("full_name"),
  ]);
  if (!who) notFound();
  const name = (who.full_name as string | null) || (who.email as string);
  const { view, report } = data;
  const badge = reportBadge(report);
  const people: Person[] = ((staffRows ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const mine = uid === profile.id;
  const lost = view.receipts.filter((r) => !r.photos.length);
  const untied = view.receipts.filter((r) => !r.customer_name && (r.category === "Customer entertainment" || (r.category === "Meals" && (r.attendees ?? "").trim())));

  return (
    <main className="shell wide">
      <TopBar title={`${name.split(" ")[0]}'s expenses`} back={`/admin/expenses?m=${month}`} />

      <div className="row between wrap" style={{ gap: 10 }}>
        <div className="col" style={{ gap: 2 }}>
          <b style={{ fontSize: 20 }}>{name}</b>
          <span className="small muted">{who.email as string}</span>
        </div>
        <span className={`pill ${badge.tone}`}>{badge.text}</span>
      </div>

      <div className="month-nav">
        <Link href={`/admin/expenses/review?u=${uid}&m=${shiftMonth(month, -1)}`} className="iconbtn sm" aria-label="Previous month">
          <ChevronLeft size={18} />
        </Link>
        <b>{monthLabel(month)}</b>
        {month < now ? (
          <Link href={`/admin/expenses/review?u=${uid}&m=${shiftMonth(month, 1)}`} className="iconbtn sm" aria-label="Next month">
            <ChevronRight size={18} />
          </Link>
        ) : (
          <span className="iconbtn sm" aria-hidden="true" style={{ opacity: 0.3 }}>
            <ChevronRight size={18} />
          </span>
        )}
      </div>

      {report?.status === "returned" ? (
        <div className="alert warn small" style={{ margin: 0 }}>
          <span>Sent back {dateShort(report.returned_at)}: {report.review_note}</span>
        </div>
      ) : null}
      {lost.length || untied.length ? (
        <div className="alert info small" style={{ margin: 0 }}>
          <CircleAlert size={17} style={{ flex: "none", marginTop: 1 }} />
          <span>
            {[
              lost.length ? `${lost.length} lost ${lost.length === 1 ? "receipt" : "receipts"} (no photo, reason given)` : "",
              untied.length ? `${untied.length} ${untied.length === 1 ? "meal with guests isn't" : "meals with guests aren't"} tied to a customer` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      ) : null}

      <MonthSummary view={view} label={monthLabel(month)} />

      {view.missing.length ? (
        <section className="section">
          <div className="eyebrow" style={{ color: "var(--err-text)" }}>Card charges with no receipt</div>
          <div className="list">
            {view.missing.map((c) => (
              <div key={c.id} className="xm-row">
                <div className="row between" style={{ gap: 10 }}>
                  <span className="col" style={{ gap: 1, minWidth: 0 }}>
                    <b className="ellipsis">{chargeLabel(c)}</b>
                    <span className="tiny muted">
                      {dateShort(c.txn_date)}
                      {c.card_last4 ? ` · card ••${c.card_last4}` : ""} · {c.description}
                    </span>
                  </span>
                  <b className="nowrap">{money(Number(c.amount))}</b>
                </div>
                <ChargeTools chargeId={c.id} people={people} current={uid} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ReceiptList view={view} editable empty={`No receipts for ${monthLabel(month)}.`} backTo={`/admin/expenses/review?u=${uid}&m=${month}`} />
      <OtherCharges view={view} />
      {view.charges.some((c) => c.excused_note && !c.receipt_id) ? (
        <div className="row wrap tiny muted" style={{ gap: 8 }}>
          Marked &quot;no receipt needed&quot; by mistake?
          {view.charges
            .filter((c) => c.excused_note && !c.receipt_id)
            .map((c) => (
              <span key={c.id} className="row" style={{ gap: 4 }}>
                {chargeLabel(c)} <UndoExcuse chargeId={c.id} />
              </span>
            ))}
        </div>
      ) : null}

      <section className="card col" style={{ gap: 12 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div className="col" style={{ gap: 2 }}>
            <b>{monthLabel(month)} report</b>
            <span className="small muted">
              {report?.submitted_at ? `Sent ${dateShort(report.submitted_at)}${report.auto_submitted ? " automatically" : ""} · ` : ""}
              {money(view.totals.total)} · pay back {money(view.totals.personal)}
            </span>
          </div>
          <a className="btn sm dark" href={`/expenses/report?m=${month}&u=${uid}`} target="_blank" rel="noopener noreferrer">
            <Download size={15} /> PDF
          </a>
        </div>
        {report?.status === "approved" ? (
          <span className="small">
            Approved by <b>{report.approved_by_name}</b> on {dateShort(report.approved_at)}
            {report.review_note ? `: "${report.review_note}"` : "."}
          </span>
        ) : report?.status === "returned" ? (
          <span className="small muted">Waiting for {name.split(" ")[0]} to fix it and send it again.</span>
        ) : !report ? (
          <span className="small muted">
            {name.split(" ")[0]} hasn&apos;t sent this month yet.
            {month < now ? " It goes to you on its own once every card charge has a receipt." : ""}
          </span>
        ) : null}
        {/* One form in one place, so its message stays after the page refreshes. */}
        <ReviewForm
          userId={uid}
          month={month}
          mode={!report || report.status === "returned" ? "none" : report.status === "approved" ? "reopen" : "review"}
          canApprove={!view.missing.length}
          mine={mine}
          missing={view.missing.length}
        />
      </section>

      {(hist ?? []).length ? (
        <section className="section">
          <div className="eyebrow">Other months</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {((hist ?? []) as Pick<XReport, "month" | "status" | "total">[]).map((h) => (
              <Link key={h.month} href={`/admin/expenses/review?u=${uid}&m=${h.month.slice(0, 7)}`} className={`chip sm${h.month.slice(0, 7) === month ? " on2" : ""}`}>
                {monthLabel(h.month.slice(0, 7)).split(" ")[0].slice(0, 3)} {h.month.slice(2, 4)} · {money(Number(h.total))} · {reportBadge(h as XReport).text.split(" ")[0]}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
