import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { dateShort, money } from "@/lib/format";
import { canSeePayroll, payrollContact } from "@/lib/payroll";
import { WithheldButton } from "@/components/expenses/withheld-button";
import { Submit } from "@/components/forms";
import { savePayrollContact } from "@/app/(app)/expenses/actions";

export const metadata = { title: "Paycheck deductions" };
export const dynamic = "force-dynamic";

type Row = { id: string; user_id: string | null; txn_date: string; amount: number; merchant: string | null; description: string; card_last4: string | null; repay_status: string | null; repay_note: string | null; repay_marked_at: string | null; repay_withheld_at: string | null; repay_withheld_by_name: string | null };

/** Personal purchases on AMBIT cards that payroll takes out of a paycheck (0063). For payroll, approvers and admins. */
export default async function PayrollPage() {
  const { supabase, profile } = await requireEmployee();
  if (!(await canSeePayroll(supabase, profile))) redirect("/expenses");
  const pay = await payrollContact(supabase);
  const { data, error } = await supabase
    .from("expense_charges")
    .select("id, user_id, txn_date, amount, merchant, description, card_last4, repay_status, repay_note, repay_marked_at, repay_withheld_at, repay_withheld_by_name")
    .eq("personal_repay", true)
    .eq("removed", false)
    .order("repay_marked_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const name = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  const waiting = rows.filter((r) => r.repay_status !== "withheld");
  const done = rows.filter((r) => r.repay_status === "withheld");
  const total = waiting.reduce((a, r) => a + Number(r.amount), 0);

  const Item = ({ r }: { r: Row }) => (
    <div className="item" style={{ alignItems: "flex-start" }}>
      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
        <span className="t">{r.user_id ? name.get(r.user_id) ?? "Employee" : "Card not assigned"}</span>
        <span className="s">
          {(r.merchant || r.description || "Card purchase").trim()} · {dateShort(r.txn_date)}
          {r.card_last4 ? ` · card ••${r.card_last4}` : ""}
        </span>
        {r.repay_note ? <span className="tiny muted">&ldquo;{r.repay_note}&rdquo;</span> : null}
        {r.repay_withheld_at ? <span className="tiny" style={{ color: "var(--ok-text)" }}>Taken out {dateShort(r.repay_withheld_at)}{r.repay_withheld_by_name ? ` by ${r.repay_withheld_by_name}` : ""}</span> : null}
      </span>
      <span className="col" style={{ gap: 6, alignItems: "flex-end" }}>
        <b className="nowrap">{money(Number(r.amount))}</b>
        <WithheldButton chargeId={r.id} withheld={r.repay_status === "withheld"} />
      </span>
    </div>
  );

  return (
    <main className="shell">
      <TopBar title="Paycheck deductions" back="/expenses" />
      <p className="small muted" style={{ margin: 0 }}>
        Personal purchases employees made on their AMBIT card. {pay.name} gets an email for each one. Take it out of their next paycheck, then tap Taken out.
      </p>
      {error ? <div className="alert warn small">This needs the 0063 database update. Ask Jeremiah to run it.</div> : null}
      <section className="section">
        <div className="row between"><div className="eyebrow">To take out</div><b>{money(total)}</b></div>
        <div className="list">{waiting.length ? waiting.map((r) => <Item key={r.id} r={r} />) : <div className="item"><span className="small muted">Nothing waiting.</span></div>}</div>
      </section>
      {done.length ? (
        <section className="section">
          <div className="eyebrow">Taken out</div>
          <div className="list">{done.slice(0, 60).map((r) => <Item key={r.id} r={r} />)}</div>
        </section>
      ) : null}
      {profile.role === "admin" ? (
        <details className="card">
          <summary><b className="small">Who handles paycheck deductions (admins)</b></summary>
          <form action={savePayrollContact} className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <input className="input sm" name="name" defaultValue={pay.name} placeholder="Name" aria-label="Name" />
            <input className="input sm grow" name="email" type="email" defaultValue={pay.email} placeholder="Email" aria-label="Email" />
            <Submit className="btn sm">Save</Submit>
          </form>
        </details>
      ) : null}
    </main>
  );
}
