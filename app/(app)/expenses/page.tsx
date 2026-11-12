import Link from "next/link";
import { canSeePayroll } from "@/lib/payroll";
import { BarChart3, Camera, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, Clock, Download } from "lucide-react";
import { isExpenseApprover, requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { dateShort, money } from "@/lib/format";
import { isMonth, loadMonth, monthLabel, reportBadge, shiftMonth, thisMonth } from "@/lib/expenses";
import { MissingList, MonthSummary, OtherCharges, ReceiptList } from "@/components/expenses/month-lists";
import { SubmitMonth } from "@/components/expenses/month-bits";

export const metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const payrollLink = await canSeePayroll(supabase, profile);
  const now = thisMonth();
  const month = isMonth(sp.m) && sp.m <= now ? sp.m : now;
  const label = monthLabel(month);
  const approver = isExpenseApprover(profile);

  let problem: string | null = null;
  let data: Awaited<ReturnType<typeof loadMonth>> | null = null;
  try {
    data = await loadMonth(supabase, profile.id, month);
  } catch (e) {
    problem = e instanceof Error ? e.message : "Couldn't load your expenses.";
  }
  const waiting = approver
    ? ((await supabase.from("expense_reports").select("id", { count: "exact", head: true }).eq("status", "submitted").neq("user_id", profile.id)).count ?? 0)
    : 0;
  // Last month still open? Point people at it.
  const prev = shiftMonth(now, -1);
  const prevOpen =
    month === now
      ? await supabase
          .from("expense_charges")
          .select("id", { count: "exact", head: true })
          .eq("user_id", profile.id)
          .eq("kind", "purchase")
          .eq("removed", false)
          .is("receipt_id", null)
          .is("excused_note", null)
          .gte("txn_date", `${prev}-01`)
          .lt("txn_date", `${now}-01`)
      : null;

  const view = data?.view;
  const report = data?.report ?? null;
  const locked = report?.status === "submitted" || report?.status === "approved";
  const badge = reportBadge(report);
  const over = month < now;
  const blocked = !view
    ? "Couldn't load the month."
    : locked
      ? null
      : !over
        ? `You can send ${label} once the month is over.`
        : view.missing.length
          ? `First add a receipt (or "Lost receipt") for ${view.missing.length === 1 ? "the card charge" : `the ${view.missing.length} card charges`} above.`
          : !view.receipts.length && !view.charges.length
            ? `Nothing for ${label}.`
            : null;

  return (
    <main className="shell">
      <TopBar title="Expenses" back="/" right={payrollLink ? <Link href="/expenses/payroll" className="btn sm dark">Paycheck deductions</Link> : null} />

      <section className="exp-hero">
        <span className="kick">Company card</span>
        <h2 className="big">Snap every receipt</h2>
        <p>Each time you use your AMBIT card, take a photo of the receipt and say which customer it was for. It&apos;s matched to the Chase statement for you.</p>
        <Link href="/expenses/add" className="b1">
          <Camera size={19} strokeWidth={2.4} /> Add a receipt
        </Link>
      </section>

      {approver ? (
        <div className="xm-appr">
          <Link href="/admin/expenses" className="item">
            <span className="ic"><ClipboardCheck size={18} /></span>
            <span className="grow col" style={{ gap: 1 }}>
              <span className="t">Approve reports</span>
              <span className="s">{waiting ? `${waiting} waiting for you` : "Nothing waiting"}</span>
            </span>
            {waiting ? <span className="pill info">{waiting}</span> : null}
          </Link>
          <Link href="/admin/expenses/dashboard" className="item">
            <span className="ic"><BarChart3 size={18} /></span>
            <span className="grow col" style={{ gap: 1 }}>
              <span className="t">Expense dashboard</span>
              <span className="s">Customers, categories, people</span>
            </span>
          </Link>
        </div>
      ) : null}

      {prevOpen?.count ? (
        <Link href={`/expenses?m=${prev}`} className="alert warn small" style={{ margin: 0 }}>
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            {monthLabel(prev)} still has {prevOpen.count} card {prevOpen.count === 1 ? "charge" : "charges"} without a receipt. Tap to finish it so it can go for approval.
          </span>
        </Link>
      ) : null}

      <div className="month-nav">
        <Link href={`/expenses?m=${shiftMonth(month, -1)}`} className="iconbtn sm" aria-label="Previous month">
          <ChevronLeft size={18} />
        </Link>
        <b>{label}</b>
        {month < now ? (
          <Link href={`/expenses?m=${shiftMonth(month, 1)}`} className="iconbtn sm" aria-label="Next month">
            <ChevronRight size={18} />
          </Link>
        ) : (
          <span className="iconbtn sm" aria-hidden="true" style={{ opacity: 0.3 }}>
            <ChevronRight size={18} />
          </span>
        )}
      </div>

      {problem ? (
        <div className="alert err small"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{problem}</span></div>
      ) : null}

      {report?.status === "returned" ? (
        <div className="alert warn small" style={{ margin: 0 }}>
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            <b>Sent back{report.returned_at ? ` ${dateShort(report.returned_at)}` : ""}:</b> {report.review_note}
            <br />Fix it below, then send it again.
          </span>
        </div>
      ) : report?.status === "submitted" ? (
        <div className="alert info small" style={{ margin: 0 }}>
          <Clock size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>Waiting for approval since {dateShort(report.submitted_at)}. It&apos;s locked until it&apos;s approved or sent back.</span>
        </div>
      ) : report?.status === "approved" ? (
        <div className="alert ok small" style={{ margin: 0 }}>
          <CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            Approved by {report.approved_by_name} on {dateShort(report.approved_at)}.{Number(report.personal_total) > 0 ? ` ${money(Number(report.personal_total))} is being paid back to you.` : ""}
            {report.review_note ? ` "${report.review_note}"` : ""}
          </span>
        </div>
      ) : null}

      {view ? (
        <>
          <MonthSummary view={view} label={label} />
          <MissingList view={view} locked={locked} />
          <ReceiptList view={view} editable={!locked} empty={month === now ? "No receipts yet this month. Tap Add a receipt after each purchase." : `No receipts for ${label}.`} />
          <OtherCharges view={view} locked={locked} />
        </>
      ) : null}

      <section className="card col" style={{ gap: 12 }}>
        <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
          <div className="col" style={{ gap: 2 }}>
            <b>{label} report</b>
            <span className="small muted">
              {report?.status === "submitted" || report?.status === "approved"
                ? `Sent ${dateShort(report.submitted_at ?? report.sent_at)}${report.auto_submitted ? " automatically" : ""} · ${money(Number(report.total))}`
                : "When every card charge has a receipt, it goes to the approvers. If you don't send it, it goes on its own a few days after the month ends."}
            </span>
          </div>
          <span className={`pill ${badge.tone}`}>{badge.text}</span>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <SubmitMonth month={month} blocked={blocked} locked={locked} />
          <a className={`btn sm dark${view && (view.receipts.length || view.charges.length) ? "" : " disabled"}`} href={`/expenses/report?m=${month}`} target="_blank" rel="noopener noreferrer">
            <Download size={15} /> Download PDF
          </a>
        </div>
      </section>
    </main>
  );
}
