import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, CircleCheck, FilePlus2, Link2, ListChecks, Lock, Pencil, Tag } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canCredit, canSetCredit, creditFor, creditOverview, daysLate, FLAGS, health, methodLabel, STATUS, type CreditStatus, type Invoice } from "@/lib/credit";
import { dateShort, dateTime, money, orderNo } from "@/lib/format";
import { STAGES, stageOf } from "@/lib/order-desk";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { AgingBar } from "@/components/credit/aging-bar";
import { PaymentDrawer } from "@/components/credit/payment-drawer";
import { addNote, noteDone, saveCreditProfile, voidPayment68 } from "@/app/(app)/credit/actions";
import type { Order } from "@/lib/types";
import { canHold, holdsAt } from "@/lib/inventory/holds";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

const TABS = [
  { key: "invoices", label: "Open invoices" },
  { key: "payments", label: "Payments" },
  { key: "orders", label: "Orders" },
  { key: "prices", label: "Prices" },
  { key: "notes", label: "Notes & follow-ups" },
  { key: "forms", label: "Forms" },
  { key: "credit", label: "Credit settings" },
] as const;
const NOTE_KINDS = [["call", "Call"], ["email", "Email"], ["promise", "Promise to pay"], ["note", "Note"], ["hold", "Put on hold"], ["release", "Released"]] as const;
type Pay = { id: number; amount: number; paid_on: string; method: string; kind: string; check_no: string | null; ref: string | null; invoice_no: string | null; note: string | null;
  discount: number; card_fee: number | null; last4: string | null; entered_by_name: string | null; voided_at: string | null; voided_by_name: string | null; created_at: string };
type Note = { id: number; kind: string; body: string; promise_amount: number | null; follow_up_on: string | null; done_at: string | null; by_name: string | null; created_at: string };

/** One customer at a glance: credit line, balance, past due and aging, every open invoice, payments (record one by any
 *  method), orders, their prices, notes and the credit settings. Admins, Accounting and the order desk. */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canCredit(profile)) redirect("/");
  const [{ data: co }, kids] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("companies").select("id, name").eq("credit_parent_id", id).order("name"),
  ]);
  if (!co) notFound();
  // A shared line (MacArthur): corporate sees, and can pay, every location's invoices.
  const kidRows = (kids.data ?? []) as { id: string; name: string }[];
  const where = new Map<string, string>([[id, co.name as string], ...kidRows.map((k) => [k.id, k.name] as [string, string])]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "invoices";
  const [cr, invRes, payRes, noteRes, orderRes, priceRes, priceCount, parentRes, repRes, formRes, prfRes, roots] = await Promise.all([
    creditFor(supabase, id),
    supabase.from("customer_invoices").select("*").in("company_id", [...where.keys()]).eq("status", "open").order("due_date").limit(1000),
    supabase.from("customer_payments").select("*").eq("company_id", id).order("paid_on", { ascending: false }).order("id", { ascending: false }).limit(200),
    supabase.from("collection_notes").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("orders").select("*").eq("company_id", id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(40),
    supabase.from("customer_prices").select("price, basis, effective_on, expires_on, source, products(sku, name, unit)").eq("company_id", id).order("updated_at", { ascending: false }).limit(8),
    supabase.from("customer_prices").select("id", { count: "exact", head: true }).eq("company_id", id),
    co.credit_parent_id ? supabase.from("companies").select("id, name, credit_limit").eq("id", co.credit_parent_id).maybeSingle() : Promise.resolve({ data: null }),
    co.sales_rep_id ? supabase.from("profiles").select("full_name, email").eq("id", co.sales_rep_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("form_submissions").select("id, form_key, ref_no, status, created_at, submitted_at").eq("company_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("price_requests").select("id, status, created_at, rep_name, customer_kind").eq("company_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("companies").select("id, name").not("credit_status", "is", null).is("credit_parent_id", null).neq("id", id).order("name").limit(400),
  ]);
  const invoices = (invRes.error ? [] : invRes.data ?? []) as Invoice[];
  const pays = (payRes.data ?? []) as Pay[];
  // What was applied to each invoice since the QuickBooks import (so "remaining" is right today).
  const ids = invoices.map((i) => i.id);
  const { data: apps } = ids.length
    ? await supabase.from("payment_applications").select("invoice_id, amount, payment_id, customer_payments(id, paid_on, voided_at)").in("invoice_id", ids)
    : { data: [] };
  type App = { invoice_id: number; amount: number; payment_id: number; customer_payments: { id: number; paid_on: string; voided_at: string | null } | null };
  const payById = new Map(((apps ?? []) as unknown as App[]).filter((a) => a.customer_payments).map((a) => [a.payment_id, a.customer_payments!]));
  const appliedTo = new Map<number, number>();
  for (const a of (apps ?? []) as unknown as App[]) {
    const p = payById.get(a.payment_id);
    const inv = invoices.find((i) => i.id === a.invoice_id);
    if (!p || p.voided_at || !inv || p.paid_on <= inv.as_of) continue;
    appliedTo.set(a.invoice_id, (appliedTo.get(a.invoice_id) ?? 0) + Number(a.amount));
  }
  const open = invoices.map((i) => ({ ...i, amount: Number(i.amount), open_balance: Number(i.open_balance), applied: appliedTo.get(i.id) ?? 0 }))
    .map((i) => ({ ...i, remaining: Math.round((i.open_balance - i.applied) * 100) / 100, late: daysLate(i.due_date ?? i.txn_date, today) }));
  const owing = open.filter((i) => i.remaining > 0.004);

  const groupRows = kidRows.length ? (await creditOverview(supabase)).rows.filter((r) => r.company_id === id || r.parent_id === id) : [];
  // Corporate's tiles add up every location on the line.
  const gsum = (k: "balance" | "past_due" | "over_90" | "d61_90" | "d31_60" | "d1_30" | "current_due" | "shipped_since" | "paid_since" | "orders_open") => groupRows.reduce((t, r) => t + r[k], 0);
  const k = cr && groupRows.length > 1 ? { ...cr, balance: gsum("balance"), past_due: gsum("past_due"), over_90: gsum("over_90"), d61_90: gsum("d61_90"), d31_60: gsum("d31_60"),
    d1_30: gsum("d1_30"), current_due: gsum("current_due"), shipped_since: gsum("shipped_since"), paid_since: gsum("paid_since"), orders_open: gsum("orders_open"),
    max_days_late: Math.max(0, ...groupRows.map((r) => r.max_days_late ?? 0)) || null } : cr;
  const group = groupRows.length > 1;
  const parent = parentRes.data as { id: string; name: string; credit_limit: number | null } | null;
  const status = (co.credit_status ?? cr?.status ?? null) as CreditStatus | null;
  const st = status ? STATUS[status] : null;
  const h = cr ? health(cr) : null;
  const setter = canSetCredit(profile);
  const admin = profile.role === "admin";
  const rep = repRes.data as { full_name: string | null; email: string } | null;
  const limit = cr?.group_limit ?? (co.credit_limit === null ? null : Number(co.credit_limit));
  const used = limit && cr ? Math.max(0, cr.group_balance + cr.group_open) / limit : null;
  const orders = (orderRes.data ?? []) as Order[];
  const notes = (noteRes.data ?? []) as Note[];
  const flags = ((co.credit_flags ?? []) as string[]).filter((f) => FLAGS[f]);
  const paid12 = pays.filter((p) => !p.voided_at && p.kind === "payment" && p.paid_on >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`).reduce((s, p) => s + Number(p.amount), 0);
  const q = (o: Record<string, string>) => `/customers/${id}?${new URLSearchParams(o).toString()}`;
  // Material set aside for this customer (or its locations) at the branches (0071).
  const held = (await holdsAt(supabase, null)).filter((h) => where.has(h.company_id) && h.held_left > 0);
  // AM-BUCKS (0105): finished orders earn 3 points per $100 of invoice prices; distributors never earn.
  const [bucksBal, bucksRows, bucksSet] = await Promise.all([
    supabase.rpc("am_bucks_company_balance", { p_company: id }),
    supabase.from("am_bucks_ledger").select("id, points, kind, note, created_by_name, created_at, order_id").eq("company_id", id).order("created_at", { ascending: false }).limit(12),
    supabase.from("app_settings").select("value").eq("key", "am_bucks").maybeSingle<{ value: { point_value?: number; orders_from?: string } }>(),
  ]);
  const bucks = bucksBal.error || bucksRows.error || !bucksSet.data?.value?.orders_from ? null : {
    balance: Number(bucksBal.data ?? 0),
    pv: Number(bucksSet.data.value.point_value ?? 0.01),
    since: bucksSet.data.value.orders_from,
    rows: (bucksRows.data ?? []) as { id: number; points: number; kind: string; note: string | null; created_by_name: string | null; created_at: string; order_id: string | null }[],
  };
  const holder = canHold(profile);

  return (
    <main className="shell wide cust">
      <TopBar title={co.name as string} back={sp.from === "credit" ? "/credit" : "/customers"} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="cust-head">
        <div className="col" style={{ gap: 8, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {st ? <span className={`${st.pill} lg`} title={st.hint}>{st.label}</span> : <span className="pill grey lg">No credit status</span>}
            {h && cr && (cr.balance !== 0 || cr.past_due) ? <span className={h.pill}>{h.label}</span> : null}
            {flags.map((f) => <span key={f} className="pill red">{FLAGS[f]}</span>)}
            {co.credit_manual ? <span className="pill warn">Every order checked by hand</span> : null}
            {co.pay_cod ? <span className="pill red">COD only</span> : null}
            {co.pay_no_checks ? <span className="pill warn">No checks</span> : null}
            {parent ? <Link href={`/customers/${parent.id}`} className="pill info"><Link2 size={12} /> Shares {parent.name}&apos;s line</Link> : null}
          </div>
          <span className="small muted">
            {[co.account_no ? `Acct ${co.account_no}` : null, co.terms ? `Terms: ${co.terms}` : null, rep ? `Rep: ${rep.full_name || rep.email}` : co.house_account ? "House Account" : null,
              co.city && co.state ? `${co.city}, ${co.state}` : null, co.phone].filter(Boolean).join(" · ")}
          </span>
          {co.qb_name && co.qb_name !== co.name ? <span className="tiny faint">QuickBooks: {co.qb_name as string}</span> : null}
        </div>
        <div className="row wrap cust-actions" style={{ gap: 8 }}>
          {setter ? <PaymentDrawer company={id} name={co.name as string} terms={(co.terms as string) ?? null} admin={admin} setter={setter} today={today}
            invoices={owing.concat(open.filter((i) => i.remaining < -0.004)).map((i) => ({ id: i.id, doc_no: i.doc_no, txn_date: i.txn_date, due_date: i.due_date, remaining: i.remaining, late: i.late, kind: i.kind, where: group && i.company_id !== id ? where.get(i.company_id) : undefined }))}
            open={sp.pay === "1"} /> : null}
          <Link href={`/customers/${id}/prices`} className="btn sm dark"><Tag size={15} /> Prices</Link>
          <Link href={`/price-requests/new?company=${id}`} className="btn sm dark"><FilePlus2 size={15} /> Price request</Link>
          {holder ? <Link href={`/inventory/holds?c=${id}`} className="btn sm dark"><Lock size={15} /> Hold material</Link> : null}
          {admin ? <Link href={`/admin/companies?q=${encodeURIComponent(co.name as string)}`} className="btn sm dark"><Pencil size={15} /> Edit details</Link> : null}
        </div>
      </section>

      <div className="cr-kpis cust-kpis">
        <div className="cr-kpi">
          <span className="tiny">Credit line{parent ? " (shared)" : kidRows.length ? " (all locations)" : ""}</span>
          <b>{limit !== null ? money(limit) : "–"}</b>
          <span className="tiny">{status === "revoked" && co.credit_limit_prior ? `Was ${money(Number(co.credit_limit_prior))}` : status === "line" && limit === null ? "No limit on file" : co.terms ?? "No terms"}</span>
        </div>
        <div className="cr-kpi"><span className="tiny">Balance{group ? " (all locations)" : ""}</span><b>{money(k?.balance ?? 0)}</b><span className="tiny">{owing.length} open invoice{owing.length === 1 ? "" : "s"}{k?.orders_open ? ` · ${money(k.orders_open)} in open orders` : ""}{group ? ` · corporate ${money(cr?.balance ?? 0)}` : ""}</span></div>
        <div className={`cr-kpi${cr?.available !== null && cr?.available !== undefined ? (cr.available < 0 ? " bad" : " good") : ""}`}>
          <span className="tiny">Available{parent || kidRows.length ? " (group)" : ""}</span>
          <b>{cr?.available !== null && cr?.available !== undefined ? money(cr.available) : "–"}</b>
          <span className="tiny">{cr?.available !== null && cr?.available !== undefined && cr.available < 0 ? "Over the line" : "Line − balance − open orders"}</span>
        </div>
        <div className={`cr-kpi${k?.past_due ? " warn" : " good"}`}><span className="tiny">Past due{group ? " (all locations)" : ""}</span><b>{money(k?.past_due ?? 0)}</b><span className="tiny">{k?.max_days_late ? `Oldest ${k.max_days_late} days late` : "Nothing late"}</span></div>
        <div className={`cr-kpi${k?.over_90 ? " bad" : " good"}`}><span className="tiny">90+ days</span><b>{money(k?.over_90 ?? 0)}</b><span className="tiny">{k?.over_90 ? "Collections risk" : "–"}</span></div>
        <div className="cr-kpi"><span className="tiny">Last payment</span><b>{cr?.last_paid ? money(cr.last_paid_amount ?? 0) : "–"}</b><span className="tiny">{cr?.last_paid ? dateShort(cr.last_paid) : "None entered in the app"}{paid12 ? ` · ${money(paid12)} in 12 months` : ""}</span></div>
      </div>

      {used !== null ? (
        <section className="card col" style={{ gap: 8 }}>
          <div className="row between"><b className="small">Credit used{parent || kidRows.length ? " (every location on the line)" : ""}</b><span className="small"><b>{Math.round(used * 100)}%</b> of {money(limit ?? 0)}</span></div>
          <div className={`use-bar${used > 1 ? " over" : used > 0.85 ? " near" : ""}`} role="img" aria-label={`${Math.round(used * 100)} percent of the credit line used`}>
            <span style={{ width: `${Math.min(100, used * 100)}%` }} />
            {used > 1 ? <i style={{ left: `${100 / used}%` }} title="The line" /> : null}
          </div>
          <span className="tiny faint">Balance {money(cr?.group_balance ?? 0)} + open orders {money(cr?.group_open ?? 0)}{used > 1 ? ` · ${money((cr?.group_balance ?? 0) + (cr?.group_open ?? 0) - (limit ?? 0))} over` : ""}</span>
        </section>
      ) : null}

      {k && k.balance !== 0 ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="row between"><b className="small">Aging{group ? " (all locations)" : ""}</b>{k.as_of ? <span className="tiny faint">QuickBooks {dateShort(k.as_of)} + {money(k.shipped_since)} shipped since − {money(k.paid_since)} paid since</span> : null}</div>
          <AgingBar a={k} />
        </section>
      ) : null}

      {groupRows.length > 1 ? (
        <section className="card col" style={{ gap: 8 }}>
          <b className="small">Locations on this line</b>
          <div className="cr-wrap" style={{ maxHeight: "none" }}>
            <table className="cr-table">
              <thead><tr><th>Location</th><th>Balance</th><th>Past due</th><th>Open orders</th><th>Open invoices</th></tr></thead>
              <tbody>
                {groupRows.sort((a, b) => b.balance - a.balance).map((r) => (
                  <tr key={r.company_id}>
                    <td><Link href={`/customers/${r.company_id}`}>{r.name}</Link>{r.company_id === id ? <span className="tiny faint"> (corporate)</span> : null}</td>
                    <td><b>{money(r.balance)}</b></td><td className={r.past_due ? "red" : "faint"}>{r.past_due ? money(r.past_due) : "–"}</td>
                    <td>{r.orders_open ? money(r.orders_open) : "–"}</td><td>{r.open_invoices || "–"}</td>
                  </tr>
                ))}
                <tr className="tot"><td><b>All locations</b></td><td><b>{money(groupRows.reduce((s, r) => s + r.balance, 0))}</b></td><td><b>{money(groupRows.reduce((s, r) => s + r.past_due, 0))}</b></td><td>{money(groupRows.reduce((s, r) => s + r.orders_open, 0))}</td><td>{groupRows.reduce((s, r) => s + r.open_invoices, 0)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {co.credit_note ? <div className="alert small cust-note"><span><b>Credit note:</b> {co.credit_note as string}</span></div> : null}

      {held.length ? (
        <section className="card col" style={{ gap: 6 }}>
          <b className="small">Material held for {group ? "this customer and its locations" : "this customer"}</b>
          <ul className="small cust-holds" style={{ margin: 0, paddingLeft: 18 }}>
            {held.map((h) => (
              <li key={h.id}>
                <b>{Number.isInteger(h.held_left) ? h.held_left : h.held_left.toFixed(2)}</b> of {h.sku} · Lot {h.lot_no || "(no lot #)"} at {h.branch_id.toUpperCase()} until {dateShort(h.until)}
                {where.size > 1 && h.company_id !== id ? <span className="faint"> · for {h.company_name}</span> : null}
                {h.note ? <span className="faint"> · {h.note}</span> : null}{" "}
                <Link href={`/inventory/holds?b=${h.branch_id}`} className="tiny">Manage</Link>
              </li>
            ))}
          </ul>
          <span className="tiny faint">Their orders from that location take these drums first. Nobody else&apos;s orders get them.</span>
        </section>
      ) : null}

      {bucks ? (
        <section className="card col" style={{ gap: 6 }} aria-label="AM-BUCKS">
          <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
            <b className="small">AM-BUCKS</b>
            {co.distributor ? (
              <span className="small faint">Distributor: doesn&apos;t earn AM-BUCKS</span>
            ) : (
              <span className="small"><b>{bucks.balance} points</b> ({money(Math.round(bucks.balance * bucks.pv * 100) / 100)})</span>
            )}
          </div>
          {bucks.rows.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {bucks.rows.map((r) => (
                <li key={r.id}>
                  <b className={r.points < 0 ? "red" : undefined}>{r.points > 0 ? "+" : ""}{r.points}</b> · {r.order_id ? <Link href={`/orders/${r.order_id}`}>{r.note ?? "Order"}</Link> : r.note ?? r.kind} · {dateShort(r.created_at.slice(0, 10))}
                  {r.kind === "redeem" && r.created_by_name ? <span className="faint"> · used by {r.created_by_name}</span> : null}
                </li>
              ))}
            </ul>
          ) : !co.distributor ? (
            <span className="tiny faint">No points yet. Orders picked up or shipped out since {dateShort(bucks.since)} earn 3 points per $100 of invoice prices.</span>
          ) : null}
        </section>
      ) : null}

      <nav className="chips cust-tabs" aria-label="Customer sections">
        {TABS.map((t) => (
          <Link key={t.key} href={q({ tab: t.key })} className={`chip${tab === t.key ? " on" : ""}`} aria-current={tab === t.key ? "page" : undefined}>
            {t.label}
            {t.key === "invoices" && owing.length ? <span className="chip-n">{owing.length}</span> : null}
            {t.key === "notes" && notes.some((n) => n.follow_up_on && !n.done_at) ? <span className="chip-n">{notes.filter((n) => n.follow_up_on && !n.done_at).length}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "invoices" ? (
        open.length ? (
          <div className="cr-wrap">
            <table className="cr-table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Days late</th><th>Amount</th><th>Open in QuickBooks</th><th>Paid here since</th><th>Still owed</th><th>Ships from</th></tr></thead>
              <tbody>
                {open.sort((a, b) => b.late - a.late).map((i) => (
                  <tr key={i.id}>
                    <td><b>{i.kind === "invoice" ? `Inv ${i.doc_no ?? ""}` : i.kind === "credit_memo" ? `Credit memo ${i.doc_no ?? ""}` : i.kind === "payment" ? `Unapplied payment ${i.doc_no ?? ""}` : i.doc_no}</b>
                      {group && i.company_id !== id ? <div className="tiny"><Link href={`/customers/${i.company_id}`}>{where.get(i.company_id)}</Link></div> : i.qb_name && i.qb_name.includes(":") ? <div className="tiny faint">{i.qb_name.split(":").pop()}</div> : null}</td>
                    <td>{dateShort(i.txn_date)}</td>
                    <td>{i.due_date ? dateShort(i.due_date) : "–"}</td>
                    <td>{i.remaining > 0.004 && i.late > 0 ? <span className={`late-chip ${i.late > 90 ? "l4" : i.late > 60 ? "l3" : i.late > 30 ? "l2" : "l1"}`}>{i.late}</span> : <span className="faint">{i.remaining > 0.004 ? "current" : "–"}</span>}</td>
                    <td>{money(i.amount)}</td>
                    <td>{money(i.open_balance)}</td>
                    <td className={i.applied ? "ok-text" : "faint"}>{i.applied ? `− ${money(i.applied)}` : "–"}</td>
                    <td><b className={i.remaining < 0 ? "ok-text" : i.late > 30 && i.remaining > 0 ? "red" : ""}>{money(i.remaining)}</b></td>
                    <td className="faint">{i.location ?? "–"}</td>
                  </tr>
                ))}
                <tr className="tot"><td><b>Total</b></td><td /><td /><td /><td /><td><b>{money(open.reduce((s, i) => s + i.open_balance, 0))}</b></td><td>{money(open.reduce((s, i) => s + i.applied, 0))}</td><td><b>{money(open.reduce((s, i) => s + i.remaining, 0))}</b></td><td /></tr>
              </tbody>
            </table>
          </div>
        ) : <div className="card small muted center">No open invoices from QuickBooks.{cr?.as_of ? ` (Imported ${dateShort(cr.as_of)}.)` : ""}</div>
      ) : null}

      {tab === "payments" ? (
        pays.length ? (
          <div className="cr-wrap">
            <table className="cr-table">
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Check # / reference</th><th>Applied to</th><th>Entered by</th><th /></tr></thead>
              <tbody>
                {pays.map((p) => {
                  const ap = ((apps ?? []) as unknown as App[]).filter((a) => a.payment_id === p.id);
                  return (
                    <tr key={p.id} style={{ opacity: p.voided_at ? 0.5 : 1 }}>
                      <td>{dateShort(p.paid_on)}</td>
                      <td style={{ textAlign: "left" }}><span className={`pay-kind ${p.kind}`}>{methodLabel(p.method, p.kind)}</span>{p.voided_at ? <span className="pill red" style={{ marginLeft: 6 }}>Voided</span> : null}
                        {p.last4 ? <span className="tiny faint"> ····{p.last4}</span> : null}{p.note ? <div className="tiny faint" style={{ whiteSpace: "normal" }}>{p.note}</div> : null}</td>
                      <td><b className={p.kind === "refund" ? "red" : ""}>{p.kind === "refund" ? "+" : "−"}{money(Number(p.amount))}</b>
                        {Number(p.discount) > 0 ? <div className="tiny faint">+ {money(Number(p.discount))} discount</div> : null}{p.card_fee ? <div className="tiny faint">{money(Number(p.card_fee))} card fee</div> : null}</td>
                      <td>{p.check_no ? `#${p.check_no}` : p.ref ?? "–"}</td>
                      <td className="tiny">{ap.length ? ap.map((a) => `Inv ${invoices.find((i) => i.id === a.invoice_id)?.doc_no ?? "?"} ${money(Number(a.amount))}`).join(", ") : p.kind === "refund" ? "–" : "On account"}</td>
                      <td className="tiny faint">{p.entered_by_name}<div>{dateTime(p.created_at)}</div></td>
                      <td>{setter && !p.voided_at ? <form action={voidPayment68}><input type="hidden" name="company" value={id} /><input type="hidden" name="id" value={p.id} /><Submit className="linkbtn tiny" pendingText="…">Void</Submit></form> : p.voided_by_name ? <span className="tiny faint">by {p.voided_by_name}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="card small muted center">No payments entered in the app yet. Tap <b>Record payment</b>.</div>
      ) : null}

      {tab === "orders" ? (
        orders.length ? (
          <div className="list">
            {orders.map((o) => {
              const s2 = stageOf(o);
              return (
                <Link key={o.id} href={`/orders/${o.id}`} className="item" style={{ padding: "10px 14px" }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t" style={{ fontSize: 14 }}>{orderNo(o.order_no)} · {money(Number(o.invoiced_total ?? o.est_subtotal))}{o.invoice_no ? ` · Inv ${o.invoice_no}` : ""}</div>
                    <div className="s ellipsis">{dateShort(o.created_at)}{(o as Order & { credit_auto_note?: string | null }).credit_auto_note ? ` · Not auto-released: ${(o as Order & { credit_auto_note?: string | null }).credit_auto_note}` : ""}</div>
                  </div>
                  {s2 ? <span className={STAGES[s2].pill}>{STAGES[s2].short}</span> : <span className="pill grey">{o.status}</span>}
                </Link>
              );
            })}
          </div>
        ) : <div className="card small muted center">No orders in the app yet.</div>
      ) : null}

      {tab === "prices" ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <span className="small"><b>{priceCount.count ?? 0}</b> customer price{priceCount.count === 1 ? "" : "s"} on file</span>
            <div className="row" style={{ gap: 8 }}>
              <Link href={`/customers/${id}/prices`} className="btn sm"><ListChecks size={15} /> Open price list</Link>
              <Link href={`/price-requests/new?company=${id}`} className="btn sm dark"><FilePlus2 size={15} /> New price request</Link>
            </div>
          </div>
          {(priceRes.data ?? []).length ? (
            <div className="list">
              {((priceRes.data ?? []) as unknown as { price: number; basis: string; effective_on: string; expires_on: string | null; source: string; products: { sku: string; name: string; unit: string | null } | null }[]).map((p, i) => (
                <div key={i} className="item" style={{ padding: "9px 12px" }}>
                  <div className="grow" style={{ minWidth: 0 }}><div className="t ellipsis" style={{ fontSize: 14 }}>{p.products?.name}</div><div className="s">{p.products?.sku} · since {dateShort(p.effective_on)}{p.expires_on ? ` · until ${dateShort(p.expires_on)}` : ""} · {p.source === "price_request" ? "Price request" : p.source === "import" ? "Import" : p.source === "netsuite" ? "NetSuite" : "Entered"}</div></div>
                  <b>{money(Number(p.price))}<span className="tiny faint">/{p.basis === "lb" ? "lb" : p.basis === "sqft" ? "sq ft" : p.products?.unit ?? "ea"}</span></b>
                </div>
              ))}
            </div>
          ) : <span className="small muted">No customer prices yet. Approved price requests land here, or add them in the price list.</span>}
          {(prfRes.data ?? []).length ? <span className="tiny faint">{(prfRes.data ?? []).length} price request{(prfRes.data ?? []).length === 1 ? "" : "s"} for this customer · <Link href={`/price-requests?company=${id}`}>See them</Link></span> : null}
        </section>
      ) : null}

      {tab === "notes" ? (
        <section className="card col" style={{ gap: 10 }}>
          <form action={addNote} className="col" style={{ gap: 8 }}>
            <input type="hidden" name="company" value={id} />
            <input type="hidden" name="back" value={`/customers/${id}?tab=notes`} />
            <div className="grid2">
              <select className="select sm" name="kind" defaultValue="call" aria-label="Kind">{NOTE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className="input sm" type="date" name="follow" min={today} aria-label="Follow up on" title="Follow up on" />
            </div>
            <textarea className="textarea" name="body" rows={2} required maxLength={2000} placeholder="Talked to Dana in AP: check goes out Friday…" />
            <input className="input sm" name="promise" inputMode="decimal" placeholder="Promised amount (for a promise to pay)" aria-label="Promised amount" />
            <Submit className="btn sm dark" pendingText="Saving…">Save note</Submit>
          </form>
          {notes.length ? (
            <div className="list">
              {notes.map((n) => (
                <div key={n.id} className={`cr-note ${n.kind}`}>
                  <span className="k">{NOTE_KINDS.find(([k]) => k === n.kind)?.[1] ?? n.kind}</span>
                  <div className="grow col tight" style={{ minWidth: 0 }}>
                    <span className="small">{n.body}{n.promise_amount ? <b> · {money(Number(n.promise_amount))}</b> : null}</span>
                    <span className="tiny faint">{n.by_name} · {dateTime(n.created_at)}{n.follow_up_on ? ` · follow up ${dateShort(n.follow_up_on)}${n.done_at ? " (done)" : ""}` : ""}</span>
                  </div>
                  {n.follow_up_on && !n.done_at ? <form action={noteDone}><input type="hidden" name="company" value={id} /><input type="hidden" name="id" value={n.id} /><Submit className="btn sm ghost" pendingText="…">Done</Submit></form> : null}
                </div>
              ))}
            </div>
          ) : <span className="small muted">No notes yet.</span>}
        </section>
      ) : null}

      {tab === "forms" ? (
        <section className="card col" style={{ gap: 8 }}>
          {(formRes.data ?? []).length || (prfRes.data ?? []).length ? (
            <div className="list">
              {((prfRes.data ?? []) as { id: number; status: string; created_at: string; rep_name: string | null; customer_kind: string | null }[]).map((r) => (
                <Link key={`p${r.id}`} href={`/price-requests/${r.id}`} className="item" style={{ padding: "9px 12px" }}>
                  <div className="grow"><div className="t" style={{ fontSize: 14 }}>Price Request #{r.id}</div><div className="s">{dateShort(r.created_at)} · {r.rep_name}</div></div><span className="pill grey">{r.status}</span>
                </Link>
              ))}
              {((formRes.data ?? []) as { id: number; form_key: string; ref_no: string | null; status: string; created_at: string }[]).map((f) => (
                <Link key={f.id} href={`/forms/${f.form_key}/${f.id}`} className="item" style={{ padding: "9px 12px" }}>
                  <div className="grow"><div className="t" style={{ fontSize: 14 }}>{f.ref_no ?? f.form_key}</div><div className="s">{dateShort(f.created_at)}</div></div><span className="pill grey">{f.status}</span>
                </Link>
              ))}
            </div>
          ) : <span className="small muted">No forms for this customer yet.</span>}
        </section>
      ) : null}

      {tab === "credit" ? (
        setter ? (
          <form action={saveCreditProfile} className="card col" style={{ gap: 12 }}>
            <input type="hidden" name="company" value={id} />
            <div className="col" style={{ gap: 6 }}>
              <span className="label">Credit status</span>
              <div className="status-pick">
                {(Object.keys(STATUS) as CreditStatus[]).map((k) => (
                  <label key={k} className={`status-opt ${k}`}>
                    <input type="radio" name="status" value={k} defaultChecked={status === k} />
                    <b>{STATUS[k].label}</b><span className="tiny faint">{STATUS[k].hint}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid2">
              <label className="field"><span className="label">Credit line</span><input className="input" name="limit" inputMode="decimal" defaultValue={co.credit_limit ?? ""} placeholder={parent ? `Shares ${parent.name}` : "e.g. 50000"} /></label>
              <label className="field"><span className="label">Terms</span><input className="input" name="terms" defaultValue={(co.terms as string) ?? ""} placeholder="Net 30" /></label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="label">Shares the credit line of (corporate account)</span>
                <select className="select" name="parent" defaultValue={co.credit_parent_id ?? ""}>
                  <option value="">— Its own line —</option>
                  {parent ? <option value={parent.id}>{parent.name}</option> : null}
                  {((roots.data ?? []) as { id: string; name: string }[]).filter((c) => c.id !== parent?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
            <div className="col" style={{ gap: 6 }}>
              <span className="label">Flags</span>
              <div className="row wrap" style={{ gap: 14 }}>
                {Object.entries(FLAGS).map(([k, l]) => <label key={k} className="check"><input type="checkbox" name="flags" value={k} defaultChecked={flags.includes(k)} /> {l}</label>)}
              </div>
            </div>
            <label className="check"><input type="checkbox" name="manual" defaultChecked={!!co.credit_manual} /> Check every order by hand (never release automatically)</label>
            <label className="field"><span className="label">Credit note (shows at the credit check)</span><textarea className="textarea" name="note" rows={3} maxLength={1000} defaultValue={(co.credit_note as string) ?? ""} /></label>
            {co.credit_status_at ? <span className="tiny faint">Status set {dateTime(co.credit_status_at as string)}{co.credit_status_by ? ` by ${co.credit_status_by}` : ""}</span> : null}
            <Submit className="btn" pendingText="Saving…">Save credit settings</Submit>
          </form>
        ) : <div className="card small muted">Only Accounting and admins change credit settings.</div>
      ) : null}
    </main>
  );
}
