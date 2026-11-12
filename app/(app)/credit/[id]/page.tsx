import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit, canSetCredit, creditFor, health } from "@/lib/credit";
import { dateShort, dateTime, money, orderNo } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { AgingBar } from "@/components/credit/aging-bar";
import { addNote, addPayment, noteDone, setCreditLine, voidPayment } from "../actions";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

const METHODS = [["check", "Check"], ["ach", "ACH / bank transfer"], ["card", "Card"], ["wire", "Wire"], ["cash", "Cash"], ["other", "Other"]] as const;
const KINDS = [["call", "Call"], ["email", "Email"], ["promise", "Promise to pay"], ["note", "Note"], ["hold", "Put on hold"], ["release", "Released"]] as const;

/** One customer's credit: balance and aging, credit line, payments (CRMs enter them), collection notes, open orders. */
export default async function CustomerCreditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canCredit(profile)) redirect("/");
  const { data: co } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
  if (!co) notFound();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [cr, { data: pays }, { data: notes }, { data: orders }] = await Promise.all([
    creditFor(supabase, id),
    supabase.from("customer_payments").select("*").eq("company_id", id).order("paid_on", { ascending: false }).order("id", { ascending: false }).limit(100),
    supabase.from("collection_notes").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("orders").select("*").eq("company_id", id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(25),
  ]);
  const setter = canSetCredit(profile);
  const h = cr ? health(cr) : null;
  const open = ((orders ?? []) as Order[]).filter((o) => o.status !== "completed");
  const recent = ((orders ?? []) as Order[]).filter((o) => o.status === "completed").slice(0, 10);
  return (
    <main className="shell">
      <TopBar title={co.name as string} back="/credit" right={h ? <span className={h.pill}>{h.label}</span> : null} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="card col" style={{ gap: 10 }}>
        <span className="small muted">{[co.account_no, co.contact_name, co.phone, co.terms ? `Terms: ${co.terms}` : null].filter(Boolean).join(" · ")}</span>
        <div className="cr-mini">
          <div><span className="tiny faint">Owes now</span><b>{money(cr?.balance ?? 0)}</b></div>
          <div><span className="tiny faint">Past due</span><b className={cr?.past_due ? "red" : ""}>{money(cr?.past_due ?? 0)}</b></div>
          <div><span className="tiny faint">Credit line</span><b>{co.credit_limit !== null ? money(Number(co.credit_limit)) : "–"}</b></div>
          <div><span className="tiny faint">Available</span><b className={cr?.available !== null && (cr?.available ?? 0) < 0 ? "red" : ""}>{cr?.available !== null && cr?.available !== undefined ? money(cr.available) : "–"}</b></div>
          <div><span className="tiny faint">Open orders</span><b>{money(cr?.orders_open ?? 0)}</b></div>
          <div><span className="tiny faint">Paid, 90 days</span><b>{money(cr?.paid_90 ?? 0)}</b></div>
        </div>
        {cr ? <AgingBar a={cr} /> : null}
        {cr?.as_of ? <span className="tiny faint">QuickBooks balance {money(cr.imported)} as of {dateShort(cr.as_of)} · + {money(cr.shipped_since)} shipped since · − {money(cr.paid_since)} paid since</span> : <span className="tiny faint">No QuickBooks balance imported yet.</span>}
        {co.pay_cod ? <span className="pill red" style={{ alignSelf: "flex-start" }}>COD only</span> : null}
        {co.credit_note ? <div className="alert small"><span>{co.credit_note as string}</span></div> : null}
      </section>

      <section className="card col" style={{ gap: 10 }} id="pay">
        <b>Record a payment</b>
        <form action={addPayment} className="col" style={{ gap: 8 }}>
          <input type="hidden" name="company" value={id} />
          <div className="grid2">
            <label className="field"><span className="label">Amount</span><input className="input" name="amount" inputMode="decimal" required placeholder="$0.00" autoFocus={sp.pay === "1"} /></label>
            <label className="field"><span className="label">Date paid</span><input className="input" type="date" name="paid_on" defaultValue={today} max={today} /></label>
            <label className="field">
              <span className="label">How</span>
              <select className="select" name="method" defaultValue="check">{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="field"><span className="label">Check # / reference</span><input className="input" name="ref" maxLength={60} /></label>
            <label className="field">
              <span className="label">For order (optional)</span>
              <select className="select" name="order" defaultValue={sp.order ?? ""}>
                <option value="">—</option>
                {((orders ?? []) as Order[]).map((o) => <option key={o.id} value={o.id}>{orderNo(o.order_no)}{o.invoice_no ? ` · Inv ${o.invoice_no}` : ""}</option>)}
              </select>
            </label>
            <label className="field"><span className="label">Invoice # (optional)</span><input className="input" name="invoice" maxLength={60} /></label>
          </div>
          <input className="input" name="note" maxLength={500} placeholder="Note (optional)" aria-label="Note" />
          <Submit className="btn" pendingText="Saving…">Record payment</Submit>
          <span className="tiny faint">Enter it in QuickBooks too (for now). It comes off this customer&apos;s balance and the oldest past due right away.</span>
        </form>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <b>Collection notes</b>
        <form action={addNote} className="col" style={{ gap: 8 }}>
          <input type="hidden" name="company" value={id} />
          <div className="grid2">
            <select className="select sm" name="kind" defaultValue="call" aria-label="Kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="input sm" type="date" name="follow" min={today} aria-label="Follow up on" title="Follow up on" />
          </div>
          <textarea className="textarea" name="body" rows={2} required maxLength={2000} placeholder="Talked to Dana in AP: check goes out Friday…" />
          <input className="input sm" name="promise" inputMode="decimal" placeholder="Promised amount (for a promise to pay)" aria-label="Promised amount" />
          <Submit className="btn sm dark" pendingText="Saving…">Save note</Submit>
        </form>
        {((notes ?? []) as { id: number; kind: string; body: string; promise_amount: number | null; follow_up_on: string | null; done_at: string | null; by_name: string | null; created_at: string }[]).length ? (
          <div className="list">
            {((notes ?? []) as { id: number; kind: string; body: string; promise_amount: number | null; follow_up_on: string | null; done_at: string | null; by_name: string | null; created_at: string }[]).map((n) => (
              <div key={n.id} className={`cr-note ${n.kind}`}>
                <span className="k">{KINDS.find(([k]) => k === n.kind)?.[1] ?? n.kind}</span>
                <div className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="small">{n.body}{n.promise_amount ? <b> · {money(Number(n.promise_amount))}</b> : null}</span>
                  <span className="tiny faint">{n.by_name} · {dateTime(n.created_at)}{n.follow_up_on ? ` · follow up ${dateShort(n.follow_up_on)}${n.done_at ? " (done)" : ""}` : ""}</span>
                </div>
                {n.follow_up_on && !n.done_at ? (
                  <form action={noteDone}><input type="hidden" name="company" value={id} /><input type="hidden" name="id" value={n.id} /><Submit className="btn sm ghost" pendingText="…">Done</Submit></form>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card col" style={{ gap: 8 }}>
        <b>Payments</b>
        {(pays ?? []).length ? (
          <div className="list">
            {((pays ?? []) as { id: number; amount: number; paid_on: string; method: string; ref: string | null; invoice_no: string | null; note: string | null; entered_by_name: string | null; voided_at: string | null }[]).map((p) => (
              <div key={p.id} className="item" style={{ padding: "9px 12px", opacity: p.voided_at ? 0.5 : 1 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t" style={{ fontSize: 14 }}>{money(Number(p.amount))} · {METHODS.find(([k]) => k === p.method)?.[1] ?? p.method}{p.ref ? ` #${p.ref}` : ""}{p.voided_at ? " · voided" : ""}</div>
                  <div className="s ellipsis">{dateShort(p.paid_on)}{p.invoice_no ? ` · Inv ${p.invoice_no}` : ""}{p.note ? ` · ${p.note}` : ""} · {p.entered_by_name}</div>
                </div>
                {setter && !p.voided_at ? (
                  <form action={voidPayment}><input type="hidden" name="company" value={id} /><input type="hidden" name="id" value={p.id} /><Submit className="linkbtn tiny" pendingText="…">Void</Submit></form>
                ) : null}
              </div>
            ))}
          </div>
        ) : <span className="small muted">No payments entered in the app yet.</span>}
      </section>

      {open.length || recent.length ? (
        <section className="card col" style={{ gap: 8 }}>
          <b>Orders</b>
          <div className="list">
            {[...open, ...recent].map((o) => {
              const st = stageOf(o);
              return (
                <Link key={o.id} href={`/orders/${o.id}`} className="item" style={{ padding: "9px 12px" }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t" style={{ fontSize: 14 }}>{orderNo(o.order_no)} · {money(Number(o.invoiced_total ?? o.est_subtotal))}{o.has_customer_pricing && !o.invoiced_total ? " +" : ""}</div>
                    <div className="s ellipsis">{dateShort(o.created_at)}{o.invoice_no ? ` · Inv ${o.invoice_no}` : ""}</div>
                  </div>
                  {st ? <span className={STAGES[st].pill}>{STAGES[st].short}</span> : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {setter ? (
        <details className="card">
          <summary><b>Credit line and terms</b> <span className="muted small">· accounting and admins</span></summary>
          <form action={setCreditLine} className="col" style={{ gap: 8, marginTop: 10 }}>
            <input type="hidden" name="company" value={id} />
            <div className="grid2">
              <label className="field"><span className="label">Credit line</span><input className="input sm" name="limit" inputMode="decimal" defaultValue={co.credit_limit ?? ""} placeholder="No limit set" /></label>
              <label className="field"><span className="label">Terms</span><input className="input sm" name="terms" defaultValue={(co.terms as string) ?? ""} placeholder="Net 30" /></label>
            </div>
            <input className="input sm" name="note" defaultValue={(co.credit_note as string) ?? ""} maxLength={500} placeholder="Credit note (shows at the credit check)" aria-label="Credit note" />
            <Submit className="btn sm" pendingText="Saving…">Save</Submit>
          </form>
        </details>
      ) : null}
    </main>
  );
}
