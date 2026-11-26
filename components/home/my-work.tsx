import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarDays, Camera, ChevronRight, CircleCheck, CircleDollarSign, ClipboardCheck, Hash, Hourglass, PenLine, Receipt, ShieldAlert, Truck, Undo2 } from "lucide-react";
import { can } from "@/lib/access";
import type { Profile } from "@/lib/types";
import { deskAccess, waitingSince } from "@/lib/order-desk";
import { myTodos } from "@/lib/chat";
import { TodoList } from "@/components/chat/todos";
import { money, orderNo } from "@/lib/format";
import { monthLabel } from "@/lib/expense-kinds";
import type { Order, OrderStage } from "@/lib/types";

type Item = { id: string; no: number; company: string; what: string; when: string; late: boolean; since: number; icon: React.ReactNode; color: string; href?: string; sub?: string };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ago = (iso: string | null) => {
  if (!iso) return { text: "", days: 0 };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return { text: days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`, days };
};

/** "My work": every order waiting on this person's step, oldest first, and their to-dos. One tap opens the order. */
export async function MyWork({ db, profile }: { db: SupabaseClient; profile: Profile }) {
  const admin = profile.role === "admin";
  const desk = can(profile, "order_desk");
  const credit = can(profile, "credit_check");
  const warehouse = can(profile, "inventory") && (profile.job_role === "warehouse" || !desk);
  const rep = deskAccess(profile) === "mine";
  const d = today();
  const cols = "id, order_no, company_name, stage, status, delivery_method, scheduled_for, branch_id, approval_sent_at, approved_at, po_at, credit_at, created_at, invoice_update_at, credit_note";
  type O = Pick<Order, "id" | "order_no" | "company_name" | "status" | "delivery_method" | "scheduled_for" | "branch_id" | "approval_sent_at" | "approved_at" | "po_at" | "credit_at" | "created_at" | "credit_note"> & { stage: OrderStage | null; invoice_update_at: string | null };

  const stages: string[] = [];
  if (desk && !admin) stages.push("needs_po", "invoice_update", "schedule");
  if (credit && !admin) stages.push("credit", "hold");
  const staff = profile.role === "admin" || profile.role === "employee";
  const approver = staff && Boolean(profile.expense_approver);
  const old = new Date(Date.now() - 3 * 86400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [byStage, toLoad, mine, changes, todos, myReps, owed, toApprove] = await Promise.all([
    stages.length ? db.from("orders").select(cols).in("stage", stages).order("created_at").limit(60) : Promise.resolve({ data: [] }),
    // The warehouse: today's and late pickups / deliveries at their location (the desk sees late ones too).
    warehouse || (desk && !admin)
      ? (() => {
          let q = db.from("orders").select(cols).eq("stage", "scheduled").lte("scheduled_for", d).neq("delivery_method", "dropship").order("scheduled_for").limit(40);
          if (warehouse && profile.branch_id) q = q.eq("branch_id", profile.branch_id);
          return q;
        })()
      : Promise.resolve({ data: [] }),
    // Sales reps: their orders still waiting on the customer.
    rep ? db.from("orders").select(cols).eq("stage", "customer").eq("placed_by", profile.id).order("created_at").limit(20) : Promise.resolve({ data: [] }),
    // Admins: changes nobody can load until an admin approves them (0075).
    admin ? db.from("order_edits").select("order_id, edited_at, orders!inner(id, order_no, company_name)").eq("admin_needed", true).is("admin_approved_at", null).order("edited_at").limit(30) : Promise.resolve({ data: [] }),
    myTodos(db, profile.id, { limit: 5 }),
    // Expenses: a month that was sent back to them, card charges over 3 days old with no receipt, and (approvers)
    // reports waiting for approval.
    staff ? db.from("expense_reports").select("month, review_note, returned_at").eq("user_id", profile.id).eq("status", "returned").limit(6) : Promise.resolve({ data: [] }),
    staff
      ? db.from("expense_charges").select("txn_date").eq("user_id", profile.id).eq("removed", false).eq("kind", "purchase").is("receipt_id", null).is("excused_note", null).lte("txn_date", old).order("txn_date").limit(50)
      : Promise.resolve({ data: [] }),
    approver ? db.from("expense_reports").select("user_id, month, total, submitted_at").eq("status", "submitted").neq("user_id", profile.id).order("submitted_at").limit(20) : Promise.resolve({ data: [] }),
  ]);

  const items: Item[] = [];
  const seen = new Set<string>();
  const push = (o: O, what: string, icon: React.ReactNode, color: string, late = false, whenText?: string) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    const s = ago(waitingSince(o, d) ?? o.created_at);
    items.push({ id: o.id, no: o.order_no, company: o.company_name ?? "", what, when: whenText ?? s.text, late: late || s.days >= 3, since: late ? 1e9 : s.days, icon, color });
  };
  for (const o of (byStage.data ?? []) as O[]) {
    if (o.stage === "needs_po") push(o, "Enter the Sales Order # and invoice", <Hash size={17} />, "#6EA8FF");
    else if (o.stage === "invoice_update") push(o, "Update the invoice (order edited)", <Receipt size={17} />, "#F0B95A");
    else if (o.stage === "schedule") push(o, `Set the ${o.delivery_method === "pickup" ? "pickup" : "delivery"} date`, <CalendarDays size={17} />, "#5FD17A");
    else if (o.stage === "credit") push(o, "Check credit and release", <CircleDollarSign size={17} />, "#A78BFA");
    else if (o.stage === "hold") push(o, `On credit hold${o.credit_note ? `: ${o.credit_note}` : ""}`, <CircleDollarSign size={17} />, "#F87171");
  }
  for (const o of (toLoad.data ?? []) as O[]) {
    const late = Boolean(o.scheduled_for && o.scheduled_for < d);
    const days = o.scheduled_for ? Math.round((new Date(`${d}T12:00:00Z`).getTime() - new Date(`${o.scheduled_for}T12:00:00Z`).getTime()) / 86400_000) : 0;
    push(o, o.delivery_method === "pickup" ? "Pickup: have it ready and sign it out" : "Load it and get it signed", o.delivery_method === "pickup" ? <PenLine size={17} /> : <Truck size={17} />, "#FF7A59", late, late ? `${days} day${days === 1 ? "" : "s"} late` : "today");
  }
  for (const o of (mine.data ?? []) as O[]) push(o, "Waiting on the customer to approve: follow up", <Hourglass size={17} />, "#A1A1AA");
  type C = { order_id: string; edited_at: string; orders: { id: string; order_no: number; company_name: string } | { id: string; order_no: number; company_name: string }[] };
  for (const c of (changes.data ?? []) as C[]) {
    const o = Array.isArray(c.orders) ? c.orders[0] : c.orders;
    if (!o || seen.has(o.id)) continue;
    seen.add(o.id);
    const s = ago(c.edited_at);
    items.push({ id: o.id, no: o.order_no, company: o.company_name, what: "Approve the change (check the invoice)", when: s.text, late: s.days >= 1, since: s.days + 1000, icon: <ShieldAlert size={17} />, color: "#F87171" });
  }
  for (const r of (myReps.data ?? []) as { month: string; review_note: string | null; returned_at: string | null }[]) {
    const m = r.month.slice(0, 7);
    const s = ago(r.returned_at);
    items.push({ id: `xr:${m}`, no: 0, company: "", what: `Fix your ${monthLabel(m)} expenses and send them again`, sub: r.review_note ? `“${r.review_note}”` : "Sent back", when: s.text, late: s.days >= 2, since: s.days + 500, icon: <Undo2 size={17} />, color: "#F0B95A", href: `/expenses?m=${m}` });
  }
  const owedRows = (owed.data ?? []) as { txn_date: string }[];
  if (owedRows.length) {
    const s = ago(`${owedRows[0].txn_date}T12:00:00Z`);
    items.push({ id: "xr:owed", no: 0, company: "", what: `Add the receipt for ${owedRows.length === 1 ? "a card charge" : `${owedRows.length} card charges`}`, sub: "Expenses · AMBIT card", when: s.text, late: s.days >= 10, since: s.days, icon: <Camera size={17} />, color: "#34D399", href: `/expenses?m=${owedRows[0].txn_date.slice(0, 7)}` });
  }
  const waitRows = (toApprove.data ?? []) as { user_id: string; month: string; total: number; submitted_at: string | null }[];
  if (waitRows.length) {
    const ids = [...new Set(waitRows.map((w) => w.user_id))];
    const { data: ppl } = await db.from("profiles").select("id, full_name, email").in("id", ids);
    const nm = new Map(((ppl ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
    for (const w of waitRows) {
      const m = w.month.slice(0, 7);
      const s = ago(w.submitted_at);
      items.push({ id: `xa:${w.user_id}:${m}`, no: 0, company: "", what: `Approve ${(nm.get(w.user_id) ?? "an employee").split(" ")[0]}'s ${monthLabel(m)} expenses`, sub: `Expense report · ${money(Number(w.total))}`, when: s.text, late: s.days >= 3, since: s.days, icon: <ClipboardCheck size={17} />, color: "#A78BFA", href: `/admin/expenses/review?u=${w.user_id}&m=${m}` });
    }
  }
  items.sort((a, b) => b.since - a.since);
  const shown = items.slice(0, 7);
  const allHref = admin ? "/orders/desk" : desk ? "/orders/desk" : credit ? "/orders?stage=credit" : warehouse ? "/orders?stage=scheduled" : "/orders";
  const nothing = !items.length && !todos.length;
  if (nothing && !(desk || credit || warehouse || admin || rep || approver)) return null;

  return (
    <section className="card2 mywork" aria-label="My work">
      <div className="card2-h">
        <b>My work</b>
        <span className="up2-sub">{items.length ? `${items.length} waiting on you` : ""}</span>
      </div>
      {nothing ? (
        <div className="card2-b row" style={{ gap: 10, color: "var(--ok-text)", fontWeight: 700 }}><CircleCheck size={19} /> Nothing waiting on you. All caught up.</div>
      ) : null}
      {shown.map((it) => (
        <Link key={it.id} href={it.href ?? `/orders/${it.id}`} className="mw-row">
          <span className="mw-ic" style={{ color: it.color }}>{it.icon}</span>
          <span className="mw-b">
            <span className="mw-t">{it.what}</span>
            <span className="mw-s">{it.sub ?? `${orderNo(it.no)} · ${it.company}`}</span>
          </span>
          <span className={`mw-w${it.late ? " late" : ""}`}>{it.when}</span>
          <ChevronRight size={17} className="mw-c" />
        </Link>
      ))}
      {items.length > shown.length ? (
        <Link href={allHref} className="mw-more">All {items.length} <ChevronRight size={15} /></Link>
      ) : null}
      {todos.length ? (
        <div className="mw-todos">
          <div className="row between" style={{ padding: "0 18px" }}>
            <span className="mw-k">To-dos</span>
            <Link href="/chat/todos" className="tiny">All</Link>
          </div>
          <div style={{ padding: "4px 10px 10px" }}><TodoList todos={todos} adding={false} compact /></div>
        </div>
      ) : null}
    </section>
  );
}
