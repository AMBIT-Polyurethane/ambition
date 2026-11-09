import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, ChevronLeft, ChevronRight, CircleAlert, Landmark } from "lucide-react";
import { isExpenseApprover, requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { dateShort, dateTime, money } from "@/lib/format";
import { chargeLabel, isMonth, monthLabel, monthSpan, reportBadge, shiftMonth, thisMonth, type XCharge, type XReport } from "@/lib/expenses";
import { plaidEnv, plaidReady } from "@/lib/plaid";
import { serviceReady } from "@/lib/supabase/service";
import { todayCentral } from "@/lib/sale";
import { demoDelete, demoLoad, importJotform, matchNow, plaidDisconnect, plaidSyncNow, undoUpload } from "@/app/(app)/admin/expenses/actions";
import { ActBtn, ApproversForm, CardRow, ChargeTools, NewCard, PlaidConnect, UploadStatement, type Person } from "@/components/expenses/admin-bits";

export const metadata = { title: "Expense reports" };
export const dynamic = "force-dynamic";

type Tab = "reports" | "bank" | "setup";

export default async function AdminExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const approver = isExpenseApprover(profile);
  const admin = profile.role === "admin";
  if (!approver && !admin) redirect("/expenses");
  const tab: Tab = !approver ? "setup" : sp.tab === "bank" || sp.tab === "setup" ? sp.tab : "reports";
  const now = thisMonth();
  // Early in a month, last month is the one being finished and approved.
  const month = isMonth(sp.m) && sp.m <= now ? sp.m : Number(todayCentral().slice(8, 10)) <= 10 ? shiftMonth(now, -1) : now;

  const [{ data: staffRows }, { data: demoRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, expense_approver").eq("status", "active").in("role", ["employee", "admin"]).order("full_name"),
    // The expense demo's made-up employees (migration 0051): shown wherever expenses are, marked Demo.
    supabase.from("profiles").select("id, full_name").eq("demo", true).order("full_name"),
  ]);
  const staff = ((staffRows ?? []) as { id: string; full_name: string | null; email: string; expense_approver: boolean }[]).map((p) => ({ id: p.id, name: p.full_name || p.email, email: p.email, approver: p.expense_approver }));
  const demo = ((demoRows ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, name: `${p.full_name ?? "Demo"} (demo)` }));
  const people: Person[] = [...staff.map((p) => ({ id: p.id, name: p.name })), ...demo];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return (
    <main className="shell wide">
      <TopBar
        title="Expense reports"
        back={admin ? "/admin" : "/expenses"}
        right={
          approver ? (
            <Link className="iconbtn" href="/admin/expenses/dashboard" aria-label="Expense dashboard" title="Expense dashboard">
              <BarChart3 size={18} />
            </Link>
          ) : null
        }
      />
      {approver ? (
        <nav className="seg xa-tabs" aria-label="Sections">
          {(
            [
              ["reports", "Reports"],
              ["bank", "Card charges"],
              ["setup", "Setup"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <Link key={k} href={`/admin/expenses?tab=${k}${k === "reports" ? `&m=${month}` : ""}`} className={tab === k ? "on" : ""}>
              {l}
            </Link>
          ))}
        </nav>
      ) : (
        <div className="alert info small">You&apos;re not an expense approver, so reports and the dashboard aren&apos;t shown. Add yourself below if you should be.</div>
      )}

      {approver && demo.length ? (
        <div className="alert info small" style={{ margin: 0 }}>
          <span>
            <b>Demo data is loaded:</b> {demo.length} made-up employees marked &quot;(demo)&quot; with about five months of receipts, card charges and reports, tied to real customers. They can&apos;t sign in and never get email. Delete it in <Link href="/admin/expenses?tab=setup">Setup</Link> before real employees start.
          </span>
        </div>
      ) : null}
      {tab === "reports" ? <Reports month={month} now={now} nameOf={nameOf} /> : null}
      {tab === "bank" ? <Bank people={people} nameOf={nameOf} /> : null}
      {tab === "setup" ? (
        <>
          <section className="card col" style={{ gap: 12 }}>
            <div className="col" style={{ gap: 4 }}>
              <b>Expense approvers</b>
              <span className="small muted">They get an email when a month is ready, approve or send it back, and see the expense dashboard. Any one of them can approve; nobody approves their own.</span>
            </div>
            <ApproversForm people={staff} chosen={staff.filter((p) => p.approver).map((p) => p.id)} canEdit={admin} />
          </section>
          {approver ? <JotformImport /> : null}
          {approver ? (
            <section className="card col" style={{ gap: 10 }}>
              <div className="col" style={{ gap: 4 }}>
                <b>Demo data</b>
                <span className="small muted">
                  {demo.length
                    ? `Loaded: ${demo.map((d) => d.name.replace(" (demo)", "")).join(", ")} (made up). Delete it before real employees start, so the dashboard shows only real spending.`
                    : "Five made-up employees with about five months of receipts, Chase charges and monthly reports, tied to your customers, to show how expenses and the dashboard work. They can't sign in and never get email."}
                </span>
              </div>
              {demo.length ? (
                <ActBtn action={demoDelete} className="btn sm dark" confirm="Yes, delete all demo data">
                  Delete demo data
                </ActBtn>
              ) : (
                <ActBtn action={demoLoad} className="btn sm">
                  Load demo data
                </ActBtn>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );

  // ---------------------------------------------------------------- Reports
  async function Reports({ month, now, nameOf }: { month: string; now: string; nameOf: Map<string, string> }) {
    const { from, next } = monthSpan(month);
    const [{ data: waitRows }, { data: repRows }, { data: recRows }, { data: chgRows }] = await Promise.all([
      supabase.from("expense_reports").select("id, user_id, month, total, submitted_at, auto_submitted, receipt_count").eq("status", "submitted").order("submitted_at"),
      supabase.from("expense_reports").select("user_id, status, total, approved_by_name").eq("month", from),
      supabase.from("expense_receipts").select("id, user_id, amount, paid_with").is("deleted_at", null).gte("bought_on", from).lt("bought_on", next).limit(5000),
      supabase.from("expense_charges").select("user_id, amount, kind, receipt_id, excused_note").eq("removed", false).gte("txn_date", from).lt("txn_date", next).limit(5000),
    ]);
    const waiting = (waitRows ?? []) as (Pick<XReport, "id" | "user_id" | "month" | "total" | "submitted_at" | "auto_submitted" | "receipt_count">)[];
    const reps = new Map(((repRows ?? []) as Pick<XReport, "user_id" | "status" | "total" | "approved_by_name">[]).map((r) => [r.user_id, r]));
    type Row = { id: string; receipts: number; charges: number; missing: number; total: number };
    const rows = new Map<string, Row>();
    const row = (id: string) => rows.get(id) ?? (rows.set(id, { id, receipts: 0, charges: 0, missing: 0, total: 0 }), rows.get(id)!);
    const recs = (recRows ?? []) as { id: string; user_id: string; amount: number; paid_with: string }[];
    const chgs = (chgRows ?? []) as Pick<XCharge, "user_id" | "amount" | "kind" | "receipt_id" | "excused_note">[];
    const onCard = new Set(chgs.map((c) => c.receipt_id).filter(Boolean));
    for (const r of recs) {
      const x = row(r.user_id);
      x.receipts++;
      // Card receipts the bank hasn't shown count at their own amount (the same as the report).
      if (r.paid_with === "personal" || !onCard.has(r.id)) x.total += Number(r.amount);
    }
    let unassigned = 0;
    for (const c of chgs) {
      if (c.kind === "payment" || c.kind === "other") continue;
      if (!c.user_id) {
        if (c.kind === "purchase" && !c.receipt_id) unassigned++;
        continue;
      }
      const x = row(c.user_id);
      if (c.kind === "purchase") x.charges++;
      if (c.kind === "purchase" && !c.receipt_id && !c.excused_note) x.missing++;
      x.total += Number(c.amount);
    }
    for (const id of reps.keys()) row(id);
    const list = [...rows.values()].sort((a, b) => (nameOf.get(a.id) ?? "").localeCompare(nameOf.get(b.id) ?? ""));

    return (
      <>
        <section className="section">
          <div className="eyebrow">Waiting for approval</div>
          {waiting.length ? (
            <div className="list">
              {waiting.map((w) => (
                <Link key={w.id} className="item" href={`/admin/expenses/review?u=${w.user_id}&m=${w.month.slice(0, 7)}`}>
                  <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
                    <span className="t ellipsis">{nameOf.get(w.user_id) ?? "Someone"} · {monthLabel(w.month.slice(0, 7))}</span>
                    <span className="s">
                      {w.receipt_count} {w.receipt_count === 1 ? "receipt" : "receipts"} · sent {dateShort(w.submitted_at)}
                      {w.auto_submitted ? " automatically" : ""}
                      {w.user_id === profile.id ? " · yours (another approver approves it)" : ""}
                    </span>
                  </span>
                  <b className="nowrap">{money(Number(w.total))}</b>
                  <ChevronRight size={18} className="chev" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="card small muted center">Nothing is waiting. You&apos;ll get an email when a month is ready.</div>
          )}
        </section>

        <div className="month-nav">
          <Link href={`/admin/expenses?m=${shiftMonth(month, -1)}`} className="iconbtn sm" aria-label="Previous month">
            <ChevronLeft size={18} />
          </Link>
          <b>{monthLabel(month)}</b>
          {month < now ? (
            <Link href={`/admin/expenses?m=${shiftMonth(month, 1)}`} className="iconbtn sm" aria-label="Next month">
              <ChevronRight size={18} />
            </Link>
          ) : (
            <span className="iconbtn sm" aria-hidden="true" style={{ opacity: 0.3 }}>
              <ChevronRight size={18} />
            </span>
          )}
        </div>
        {unassigned ? (
          <Link className="alert warn small" href="/admin/expenses?tab=bank" style={{ margin: 0 }}>
            <CircleAlert size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>{unassigned} card {unassigned === 1 ? "charge is" : "charges are"} on a card nobody is assigned to. Tap to say whose card it is.</span>
          </Link>
        ) : null}
        <section className="section">
          {list.length ? (
            <div className="list xa-month">
              <div className="xa-mrow head">
                <span>Who</span>
                <span>Receipts</span>
                <span>Card charges</span>
                <span>Total</span>
                <span>Report</span>
              </div>
              {list.map((x) => {
                const rep = reps.get(x.id);
                const b = reportBadge(rep);
                return (
                  <Link key={x.id} className="xa-mrow" href={`/admin/expenses/review?u=${x.id}&m=${month}`}>
                    <b className="ellipsis">{nameOf.get(x.id) ?? "Former employee"}</b>
                    <span>{x.receipts}</span>
                    <span className={x.missing ? "err-text" : ""}>{x.charges ? (x.missing ? `${x.missing} of ${x.charges} need a receipt` : `All ${x.charges} have one`) : "None"}</span>
                    <b>{money(rep && rep.status !== "sent" ? Number(rep.total) : x.total)}</b>
                    <span className={`pill ${b.tone}`}>{b.text}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="card small muted center">No receipts or card charges for {monthLabel(month)}.</div>
          )}
        </section>
      </>
    );
  }

  // ---------------------------------------------------------------- Card charges
  async function Bank({ people, nameOf }: { people: Person[]; nameOf: Map<string, string> }) {
    const [{ data: cardRows }, { data: loose }, { data: imps }, links] = await Promise.all([
      supabase.from("expense_cards").select("last4, user_id, label, plaid_account_id").order("last4"),
      supabase.from("expense_charges").select("id, card_last4, txn_date, description, merchant, amount, kind, user_id").is("user_id", null).is("receipt_id", null).eq("removed", false).eq("kind", "purchase").is("excused_note", null).order("txn_date", { ascending: false }).limit(60),
      supabase.from("expense_imports").select("id, source, file_name, rows, added, skipped, date_from, date_to, by_name, at").order("at", { ascending: false }).limit(12),
      supabase.rpc("expense_bank_status"),
    ]);
    const cards = (cardRows ?? []) as { last4: string; user_id: string | null; label: string | null; plaid_account_id: string | null }[];
    const unclaimed = (loose ?? []) as Pick<XCharge, "id" | "card_last4" | "txn_date" | "description" | "merchant" | "amount" | "user_id">[];
    const bank = (links.data ?? []) as { id: string; institution: string | null; status: string; error: string | null; last_sync_at: string | null }[];
    const unknownCards = [...new Set(unclaimed.map((c) => c.card_last4).filter((c): c is string => Boolean(c) && !cards.some((k) => k.last4 === c)))];

    return (
      <>
        <section className="card col" style={{ gap: 12 }}>
          <div className="col" style={{ gap: 4 }}>
            <b>Upload the Chase statement</b>
            <span className="small muted">
              On chase.com: open the business card → <b>Download account activity</b> (the arrow) → Account: <b>All cards</b> → File type: <b>Spreadsheet (Excel, CSV)</b> → pick the dates → Download. Then choose that file here. Uploading the same dates twice is fine; nothing is added twice.
            </span>
          </div>
          <UploadStatement />
        </section>

        <section className="card col" style={{ gap: 12 }}>
          <div className="row between" style={{ gap: 10 }}>
            <div className="col" style={{ gap: 4 }}>
              <b>Connect Chase (automatic)</b>
              <span className="small muted">Once connected, card charges come in by themselves every morning, and nobody has to upload the statement.</span>
            </div>
            <Landmark size={22} style={{ flex: "none", color: "var(--text3)" }} />
          </div>
          {!plaidReady() || !serviceReady() ? (
            <div className="alert info small" style={{ margin: 0 }}>
              Not set up yet. It needs a Plaid account (plaid.com) and its keys in Vercel: PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV. Until then, upload the statement above.
            </div>
          ) : (
            <>
              {bank.map((l) => (
                <div key={l.id} className="xa-bank">
                  <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                    <b>{l.institution ?? "Bank"}</b>
                    <span className="tiny muted">
                      {l.status === "ok" ? `Working · last checked ${l.last_sync_at ? dateTime(l.last_sync_at) : "never"}` : l.status === "needs_login" ? "Chase needs you to sign in again. Tap Connect Chase." : `Problem: ${l.error ?? "unknown"}`}
                    </span>
                  </span>
                  <span className={`pill ${l.status === "ok" ? "ok" : "warn"}`}>{l.status === "ok" ? "Connected" : "Needs attention"}</span>
                  <ActBtn action={plaidDisconnect.bind(null, l.id)} confirm="Yes, disconnect">Disconnect</ActBtn>
                </div>
              ))}
              <div className="row wrap" style={{ gap: 10 }}>
                <PlaidConnect again={bank.length > 0} />
                {bank.length ? <ActBtn action={plaidSyncNow}>Check the bank now</ActBtn> : null}
              </div>
              {plaidEnv() === "sandbox" ? <span className="tiny muted">Test mode (PLAID_ENV is &quot;sandbox&quot;): this connects to Plaid&apos;s pretend bank, not Chase.</span> : null}
            </>
          )}
        </section>

        <section className="section">
          <div className="row between">
            <div className="eyebrow">Cards</div>
            <ActBtn action={matchNow}>Match again</ActBtn>
          </div>
          <span className="small muted" style={{ marginTop: -6 }}>Whose card is whose. Charges on a card go to that person to add receipts for.</span>
          <div className="list xa-cards">
            {[...cards, ...unknownCards.map((c) => ({ last4: c, user_id: null, label: null, plaid_account_id: null }))].map((c) => (
              <CardRow key={c.last4} last4={c.last4} label={c.label} userId={c.user_id} people={people} />
            ))}
            <div className="xa-newcard">
              <NewCard people={people} />
            </div>
          </div>
        </section>

        {unclaimed.length ? (
          <section className="section">
            <div className="eyebrow" style={{ color: "var(--warn-text)" }}>Charges nobody is assigned to</div>
            <span className="small muted" style={{ marginTop: -6 }}>Say whose card it is above (all its charges move), or give one charge to someone.</span>
            <div className="list">
              {unclaimed.map((c) => (
                <div key={c.id} className="xm-row">
                  <div className="row between" style={{ gap: 10 }}>
                    <span className="col" style={{ gap: 1, minWidth: 0 }}>
                      <b className="ellipsis">{chargeLabel(c)}</b>
                      <span className="tiny muted">{dateShort(c.txn_date)}{c.card_last4 ? ` · card ••${c.card_last4}` : " · no card number"}</span>
                    </span>
                    <b className="nowrap">{money(Number(c.amount))}</b>
                  </div>
                  <ChargeTools chargeId={c.id} people={people} current={null} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="section">
          <div className="eyebrow">Uploads and bank checks</div>
          {(imps ?? []).length ? (
            <div className="list">
              {((imps ?? []) as { id: string; source: string; file_name: string | null; rows: number; added: number; skipped: number; date_from: string | null; date_to: string | null; by_name: string | null; at: string }[]).map((i) => (
                <div key={i.id} className="item" style={{ minHeight: 56 }}>
                  <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
                    <span className="t ellipsis" style={{ fontSize: 14 }}>{i.source === "plaid" ? "From the bank link" : i.file_name ?? "Statement"}</span>
                    <span className="s">
                      {dateTime(i.at)} · {i.by_name ?? ""} · {i.added} added{i.skipped ? `, ${i.skipped} already here` : ""}
                      {i.date_from ? ` · ${dateShort(i.date_from)} – ${dateShort(i.date_to)}` : ""}
                    </span>
                  </span>
                  {i.source === "upload" ? <ActBtn action={undoUpload.bind(null, i.id)} confirm="Yes, remove its charges">Undo</ActBtn> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="card small muted center">No statements uploaded yet.</div>
          )}
        </section>
      </>
    );
  }

  async function JotformImport() {
    const { count } = await supabase.from("expense_receipts").select("id", { count: "exact", head: true }).eq("source", "jotform");
    return (
      <section className="card col" style={{ gap: 10 }}>
        <div className="col" style={{ gap: 4 }}>
          <b>Old receipts from Jotform</b>
          <span className="small muted">
            Brings every receipt sent through the old Jotform form into the app (photos stay in Jotform and show here). Safe to run again: each one comes over once.
            {count ? ` ${count} brought over so far.` : ""}
          </span>
        </div>
        <ActBtn action={importJotform} className="btn sm" confirm="Yes, bring them over">
          Bring over Jotform receipts
        </ActBtn>
      </section>
    );
  }
}
