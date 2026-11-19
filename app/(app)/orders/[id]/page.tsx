import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Ban,
  Check,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CirclePlay,
  FileDown,
  Mail,
  MailCheck,
  Pencil,
  Printer,
  RefreshCw,
  Repeat,
  Shuffle,
  Tag,
  UserRound,
  CalendarDays,
  Workflow,
  X,
  Hash,
  ListChecks,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { holidaySettings } from "@/lib/holidays-server";
import { todayCentral } from "@/lib/sale";
import { closuresAround } from "@/lib/holidays";
import { howtoBySlug } from "@/lib/howto";
import { OrderReturnsCard, type ReturnLine } from "@/components/order-returns-card";
import { canCredit, creditFor } from "@/lib/credit";
import { requireActive, isEmployee } from "@/lib/session";
import { TrackRecent } from "@/components/recent";
import { dateShort, dateTime, money, orderNo, qtyText } from "@/lib/format";
import { brandOf, foamOf } from "@/lib/order-doc/loads";
import { orderPicks, showsPicks } from "@/lib/order-doc/load";
import type { LotPick } from "@/lib/order-doc/loads";
import { Submit } from "@/components/forms";
import { cancelOrder, customerDecision, deleteOrder, moveOrderFile, removeOrderFile, resendOrderEmail, setOrderRep, setOrderStatus } from "@/app/(app)/orders/actions";
import { HOUSE, RepOptions, staffName, type Staff } from "@/components/rep-options";
import { changeWaiting, changesText, detailsText, editable, type DetailEdit, type OrderEdit } from "@/lib/order-edit";
import { docState } from "@/lib/order-doc/types";
import type { OrderFile } from "@/components/order-desk-card";
import type { LotLine, LotOption } from "@/components/lot-check";
import { orderBolFinding, orderFileVerdicts } from "@/lib/order-doc/bol-check";
import { orderFlow } from "@/lib/order-flow";
import { OrderFlow } from "@/components/order-flow";
import { ItemVariance, type Alternative, type LotChoice, type Variance, type VarianceData } from "@/components/item-variance";
import { NumbersForm } from "@/components/order-file-forms";
import { priceLines } from "@/lib/order-doc/loads";
import { can } from "@/lib/access";
import { STAGES, customerProgress, stageOf } from "@/lib/order-desk";
import type { Branch, Company, Order, OrderItem, OrderStage } from "@/lib/types";
import { companyTax } from "@/lib/tax-server";
import { TAX_STATE, taxLine } from "@/lib/tax";
import { CatIcon, lookFor } from "@/components/cat-icon";
import { ProductPhoto } from "@/components/product-photo";
import { Help } from "@/components/help";
import { Steps } from "@/components/order2/steps";
import { FileChips, ScheduleForm, UpNow } from "@/components/order2/up-now";
import { MoreMenu } from "@/components/order2/menu";
import { ChatCard } from "@/components/order2/chat-card";
import { AddFiles } from "@/components/order2/add-files";

export const metadata = { title: "Order" };
// Adding signed paperwork waits for the AI to read it (up to 35 seconds).
export const maxDuration = 60;

/** The status pill in the header: where the order is, in two or three words. */
function statusPill(o: Order, st: OrderStage | null, emp: boolean): { text: string; tone: string } {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (o.status === "cancelled") return { text: "Cancelled", tone: "" };
  if (o.status === "completed") return { text: o.delivery_method === "pickup" ? "Picked up" : o.delivery_method === "dropship" ? "Shipped" : "Delivered", tone: "ok" };
  if (!emp) {
    const s = docState(o);
    if (s === "pending") return { text: "Needs your approval", tone: "warn" };
    return { text: customerProgress(o) ?? "Processing", tone: "" };
  }
  if (!st) return { text: o.status, tone: "" };
  if (st === "scheduled" && o.scheduled_for === today) return { text: o.delivery_method === "pickup" ? "Pickup today" : "Loading today", tone: "warn" };
  if (st === "scheduled" && o.scheduled_for && o.scheduled_for < today) return { text: "Past its date", tone: "err" };
  const tone: Record<string, string> = { customer: "warn", needs_po: "info", invoice_update: "warn", credit: "warn", hold: "err", schedule: "warn", scheduled: "ok" };
  return { text: STAGES[st].short, tone: tone[st] ?? "" };
}

/** "Sac City, IA" from the last line of a ship-to address. */
function cityOf(addr: string | null): string | null {
  const last = (addr ?? "").split("\n").map((s) => s.trim()).filter(Boolean).pop();
  if (!last) return null;
  return last.replace(/\s+\d{5}(-\d{4})?$/, "").trim() || null;
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const emp = isEmployee(profile);
  const admin = profile.role === "admin";
  const doing = emp ? sp.do ?? null : null;

  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (!order) notFound();
  const staffOpen = emp && order.company_id && order.status !== "completed" && order.status !== "cancelled";
  const [{ data: items }, { data: branch }, { data: company }, picks, { data: fileRows }, { data: varRows }, tax, { data: rep }] = await Promise.all([
    supabase.from("order_items").select("*, product:products!order_items_product_id_fkey(image_url, category_id)").eq("order_id", id).order("id"),
    order.branch_id ? supabase.from("branches").select("*").eq("id", order.branch_id).maybeSingle<Branch>() : Promise.resolve({ data: null }),
    emp && order.company_id
      ? supabase
          .from("companies")
          .select("*") // everything, so a column added by a later update (house_account, 0060) never breaks the page
          .eq("id", order.company_id)
          .maybeSingle<Pick<Company, "email" | "contact_name"> & { pay_cod: boolean | null; pay_no_checks: boolean | null; sales_rep_id: string | null; house_account?: boolean | null }>()
      : Promise.resolve({ data: null }),
    emp ? orderPicks(supabase, id) : Promise.resolve(new Map<number, LotPick[]>()),
    emp ? supabase.from("order_files").select("id, kind, name, uploaded_by_name, created_at").eq("order_id", id).order("created_at") : Promise.resolve({ data: null }),
    emp && doing === "vary"
      ? supabase.from("order_variances").select("id, order_item_id, kind, from_text, to_text, reason, stage, by_name, created_at").eq("order_id", id).order("created_at")
      : Promise.resolve({ data: null }),
    staffOpen ? companyTax(supabase, order.company_id!) : Promise.resolve(null),
    emp && order.sales_rep_id
      ? supabase.from("profiles").select("full_name, email").eq("id", order.sales_rep_id).maybeSingle<{ full_name: string | null; email: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const lines = (items ?? []) as (OrderItem & { product: { image_url: string | null; category_id: string | null } | null })[];
  const st = stageOf(order);
  const isOpen = order.status !== "completed" && order.status !== "cancelled";
  const desk = emp && can(profile, "order_desk");
  const credit = emp && can(profile, "credit_check");
  const warehouse = emp && can(profile, "inventory");
  const closer = desk || warehouse;
  const kind = ((order as { kind?: string }).kind ?? "sale") as "sale" | "return" | "exchange";

  // Approved price requests (0066) for this customer that are still good.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const prRes = emp && order.company_id && order.status !== "cancelled"
    ? await supabase.from("price_requests").select("id, valid_until, lines:price_request_lines(name, sku, unit, approved_price, status)").eq("company_id", order.company_id).in("status", ["approved", "partly"]).gte("valid_until", today).order("created_at", { ascending: false }).limit(5)
    : { data: null, error: null };
  const approvedPrices = ((prRes.error ? [] : prRes.data ?? []) as { id: number; valid_until: string; lines: { name: string; sku: string; unit: string | null; approved_price: number | null; status: string }[] }[])
    .flatMap((r) => r.lines.filter((l) => l.status === "approved" && l.approved_price !== null).map((l) => ({ ...l, req: r.id, until: r.valid_until })));
  const creditInfo = emp && order.company_id && (st === "credit" || st === "hold") && canCredit(profile) ? await creditFor(supabase, order.company_id) : null;
  const { data: retRows } = emp && kind !== "sale" ? await supabase.from("order_returns").select("*").eq("order_id", id).order("id") : { data: null };
  const retOrig = emp && (order as { return_of?: string | null }).return_of
    ? (await supabase.from("orders").select("id, order_no").eq("id", (order as { return_of?: string }).return_of!).maybeSingle()).data
    : null;

  // Every change to the order (0041) and every detail change (0076), oldest first.
  const [{ data: editRows }, { data: detailRows }] = await Promise.all([
    emp ? supabase.from("order_edits").select("*").eq("order_id", id).order("edited_at") : Promise.resolve({ data: null }),
    emp ? supabase.from("order_detail_changes").select("id, changed_by_name, changed_at, changes, note, restocked").eq("order_id", id).order("changed_at") : Promise.resolve({ data: null }),
  ]);
  const edits = ((editRows ?? []) as OrderEdit[]).map((e) => ({ ...e, changes: Array.isArray(e.changes) ? e.changes : [] }));
  const detailEdits = ((detailRows ?? []) as DetailEdit[]).map((d) => ({ ...d, changes: Array.isArray(d.changes) ? d.changes : [] }));
  const waitingEdits = edits.filter(changeWaiting);

  // Who can change what.
  const canSetRep = emp && (admin || desk);
  const canEditDetails = emp && (admin || ((can(profile, "ordering") || desk) && order.status !== "cancelled" && order.delivery_method !== "pickup"));
  const canEdit = emp && ((editable(order) && (admin || can(profile, "ordering") || desk)) || (order.status === "completed" && admin));
  const canVary = emp && can(profile, "item_variance") && isOpen && !canEdit;
  const canCancel = emp && isOpen && (admin || desk || (order.placed_by === profile.id && !order.ambit_po));

  // Lots to check when it's marked picked up on paper (0069).
  const pickupLots: LotLine[] =
    closer && st === "scheduled" && isOpen
      ? (
          await Promise.all(
            lines.flatMap((l) => (picks.get(l.id) ?? []).filter((p) => p.state === "reserved").map((p) => ({ l, p }))).map(async ({ l, p }) => {
              const { data } = await supabase.rpc("inventory_lot_choices_any", { p_line: p.id });
              const options = ((data ?? []) as LotOption[]).map((o) => ({ ...o, available: Number(o.available) }));
              return { line: p.id, item: l.name, qty: Number(p.qty), unit: l.unit, sku: p.sku, lot_id: p.lot_id, lot_no: p.lot_no, options };
            }),
          )
        ).filter((x) => x.options.length > 0)
      : [];

  // Swap a lot (Item variance, for people who can't use Edit order): only loaded when it's opened.
  let variance: VarianceData | null = null;
  if (canVary && doing === "vary") {
    const choices = new Map<number, LotChoice[]>();
    const alternatives = new Map<number, Alternative[]>();
    await Promise.all([
      ...lines.flatMap((l) => (picks.get(l.id) ?? []).filter((p) => p.state === "reserved")).map(async (p) => {
        const { data } = await supabase.rpc("inventory_lot_choices", { p_line: p.id });
        choices.set(p.id, ((data ?? []) as LotChoice[]).map((c) => ({ ...c, available: Number(c.available), remaining: c.remaining === undefined ? undefined : Number(c.remaining) })));
      }),
      ...lines.filter((l) => l.product_id).map(async (l) => {
        const { data } = await supabase.rpc("order_item_alternatives", { p_item: l.id });
        alternatives.set(l.id, ((data ?? []) as Alternative[]).map((a) => ({ ...a, on_hand: a.on_hand === null ? null : Number(a.on_hand), available: a.available === null ? null : Number(a.available) })));
      }),
    ]);
    variance = { orderId: order.id, lines, picks, choices, alternatives, log: (varRows ?? []) as Variance[], canEdit: true };
  }

  const files = (fileRows ?? []) as OrderFile[];
  const bolFinding = emp && order.status !== "cancelled" && files.some((f) => f.kind === "bol") ? await orderBolFinding(supabase, order.id, order.order_no) : null;
  const pickFor = (l: OrderItem) => {
    const p = picks.get(l.id);
    return emp && showsPicks(l.sku, p) ? p : undefined;
  };
  const state = docState(order);
  const justSent = sp.sent === "1" || sp.sent === "approval";
  const contractorDecides = !emp && profile.role === "customer" && order.placed_by_role !== "customer" && state === "pending";
  const branchName = branch ? branch.name : order.branch_id ? order.branch_id.toUpperCase() : null;

  // What goes on the truck: "32 drums", "16 drums + 4 boxes".
  const units = new Map<string, number>();
  for (const l of lines) units.set(l.unit, (units.get(l.unit) ?? 0) + Number(l.qty));
  const loadText = units.size && units.size <= 2 ? [...units].map(([u, q]) => qtyText(q, u)).join(" + ") : `${lines.length} items`;

  // ------------------------------------------------------------------ the Flow view (staff)
  if (emp && sp.view === "flow") {
    const { count: signedCount } = await supabase.from("packing_slip_signatures").select("id", { count: "exact", head: true }).eq("order_id", order.id);
    const load = lines.map((l) => {
      const lots = (picks.get(l.id) ?? []).filter((p) => p.state === "reserved" && p.lot_no);
      return `${qtyText(Number(l.qty), l.unit)} ${l.name}${lots.length ? ` (${lots.map((p) => `lot ${p.lot_no}${lots.length > 1 ? ` × ${Number(p.qty)}` : ""}`).join(", ")})` : ""}`;
    });
    const m = orderFlow({
      order,
      branchName,
      edits,
      signedOnScreen: (signedCount ?? 0) > 0,
      bolFiles: files.filter((f) => f.kind === "bol").length,
      load,
      canSign: closer && !waitingEdits.length,
    });
    const pill = statusPill(order, st, emp);
    return (
      <main className="shell wide">
        <div className="o2">
          <div className="o2-head">
            <div className="o2-head-l">
              <Link href={`/orders/${order.id}`} className="o2-back" aria-label="Back to the order"><ChevronLeft size={20} /></Link>
              <div className="o2-title">
                <div className="row"><h1>{orderNo(order.order_no)}</h1><span className={`pill2 ${pill.tone}`}>{pill.text}</span></div>
                <span className="o2-sub">{order.company_name} · Flow</span>
              </div>
            </div>
          </div>
          <OrderFlow m={m} />
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------------ pieces
  const pill = statusPill(order, st, emp);
  const city = cityOf(order.ship_address);
  const deliveryLine =
    order.delivery_method === "pickup"
      ? `Pickup at ${branch ? `${branch.name}, ${branch.state}` : branchName ?? "the branch"}`
      : order.delivery_method === "dropship"
        ? `Drop ship${city ? ` to ${city}` : ""}`
        : `Delivery${branch ? ` from ${branch.name}` : ""}${city ? ` to ${city}` : ""}`;
  const back = emp ? "/orders" : "/orders";
  const panelHead = (title: string) => (
    <div className="panel2-h">
      <b>{title}</b>
      <Link href={`/orders/${order.id}`} className="b2 sm quiet icon" aria-label="Close"><X size={18} /></Link>
    </div>
  );
  const howtos = [howtoBySlug("order-desk"), howtoBySlug("close-out-an-order")].filter((v): v is NonNullable<typeof v> => Boolean(v));
  const slipOk = emp && kind !== "return" && order.status !== "cancelled" && order.delivery_method !== "dropship" && !waitingEdits.length;
  const hasLots = lines.some((l) => pickFor(l));

  // The ⋯ menu.
  const menu = emp ? (
    <MoreMenu label="More: print, PDF, reorder, cancel">
      {slipOk ? <a href={`/orders/${order.id}/packing-slip`} target="_blank" rel="noopener" className="menu2-i"><Printer size={18} /> Print packing slip</a> : null}
      <a href={`/orders/${order.id}/pdf`} target="_blank" rel="noopener" className="menu2-i"><FileDown size={18} /> {hasLots ? "Warehouse PDF" : "Order PDF"}</a>
      {hasLots ? <a href={`/orders/${order.id}/pdf?copy=customer`} target="_blank" rel="noopener" className="menu2-i"><FileDown size={18} /> Customer copy PDF</a> : null}
      <Link href={`/order?reorder=${order.id}`} className="menu2-i"><RefreshCw size={18} /> Reorder</Link>
      {kind === "sale" && order.status !== "cancelled" && (can(profile, "ordering") || desk) ? <Link href={`/orders/return?order=${order.id}`} className="menu2-i"><Repeat size={18} /> Return or exchange</Link> : null}
      <Link href={`/orders/${order.id}?view=flow`} className="menu2-i"><Workflow size={18} /> Flow view</Link>
      <Link href={`/orders/${order.id}?do=files`} className="menu2-i"><FileText size={18} /> Files{files.length ? ` (${files.length})` : ""}</Link>
      <div className="menu2-sep" />
      {canSetRep ? <Link href={`/orders/${order.id}?do=rep`} className="menu2-i"><UserRound size={18} /> Sales rep</Link> : null}
      {desk && isOpen && order.scheduled_for ? <Link href={`/orders/${order.id}?do=date`} className="menu2-i"><CalendarDays size={18} /> Change the date</Link> : null}
      {desk && isOpen && order.ambit_po && st !== "invoice_update" ? <Link href={`/orders/${order.id}?do=numbers`} className="menu2-i"><Hash size={18} /> Sales Order # &amp; prices</Link> : null}
      {approvedPrices.length ? <Link href={`/orders/${order.id}?do=prices`} className="menu2-i"><Tag size={18} /> Approved prices ({approvedPrices.length})</Link> : null}
      {canVary ? <Link href={`/orders/${order.id}?do=vary`} className="menu2-i"><Shuffle size={18} /> Swap a lot or item</Link> : null}
      {!(state === "pending" || state === "expired" || state === "changes_requested") ? <Link href={`/orders/${order.id}?do=email`} className="menu2-i"><Mail size={18} /> Order email{order.email_status === "failed" ? " · failed" : ""}</Link> : null}
      {admin || desk ? <Link href={`/orders/${order.id}?do=status`} className="menu2-i"><ListChecks size={18} /> Status</Link> : null}
      {howtos.length ? <div className="menu2-sep" /> : null}
      {howtos.map((v) => <Link key={v.slug} href={`/how-to/${v.slug}`} className="menu2-i"><CirclePlay size={18} /> {v.title}</Link>)}
      {canCancel || (admin && order.status === "cancelled") ? <div className="menu2-sep" /> : null}
      {canCancel ? <Link href={`/orders/${order.id}?do=cancel`} className="menu2-i red"><Ban size={18} /> Cancel order</Link> : null}
      {admin && order.status === "cancelled" ? <Link href={`/orders/${order.id}?do=delete`} className="menu2-i red"><X size={18} /> Delete order</Link> : null}
    </MoreMenu>
  ) : (
    <MoreMenu label="More: PDF, reorder">
      <a href={`/orders/${order.id}/pdf`} target="_blank" rel="noopener" className="menu2-i"><FileDown size={18} /> Order PDF</a>
      <Link href={`/order?reorder=${order.id}`} className="menu2-i"><RefreshCw size={18} /> Reorder</Link>
    </MoreMenu>
  );

  // A ⋯ pick opens here, in place of the Up-now card.
  let panel: React.ReactNode = null;
  const fileCan = (k: string) => admin || desk || (k === "bol" && warehouse);
  if (doing === "files") {
    const verdicts = files.some((f) => f.kind === "bol") ? await orderFileVerdicts(supabase, order.id) : new Map();
    const shown = [...files].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "bol" ? -1 : 1));
    panel = (
      <section className="panel2">
        {panelHead("Files")}
        {shown.length ? (
          <div className="col" style={{ gap: 0 }}>
            {shown.map((f) => {
              const v = verdicts.get(f.id);
              return (
                <div key={f.id} className="file2">
                  <a href={`/orders/${order.id}/file/${f.id}`} target="_blank" rel="noopener" className="file2-n">
                    <span className="file2-ic">{/\.pdf$/i.test(f.name ?? "") ? <FileText size={18} /> : <ImageIcon size={18} />}</span>
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      <b className="ellipsis">{f.kind === "bol" ? "Signed BOL / packing slip" : "Invoice"}</b>
                      <span className="t ellipsis">{[f.uploaded_by_name, dateTime(f.created_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </a>
                  {f.kind === "bol" ? (
                    v ? <span className={`pill2 ${v.tone === "ok" ? "ok" : v.tone === "err" ? "err" : v.tone === "warn" ? "warn" : ""}`}>{v.text}</span> : <span className="pill2">Not checked yet</span>
                  ) : null}
                  {fileCan(f.kind) ? (
                    <div className="file2-acts">
                      {v?.belongsTo ? (
                        <form action={moveOrderFile}>
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="file" value={f.id} />
                          <input type="hidden" name="to" value={v.belongsTo} />
                          <input type="hidden" name="reason" value="The AI read it as that order's paperwork" />
                          <Submit className="b2 sm" pendingText="Moving…">Move to ORD-{v.belongsTo}</Submit>
                        </form>
                      ) : null}
                      <details className="file2-more">
                        <summary className="b2 sm quiet">Move</summary>
                        <form action={moveOrderFile} className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="file" value={f.id} />
                          <input className="input sm" name="to" inputMode="numeric" required placeholder="Order #, like 1240" aria-label="Order number it belongs to" style={{ width: 170 }} />
                          <Submit className="b2 sm" pendingText="Moving…">Move it</Submit>
                        </form>
                      </details>
                      <details className="file2-more">
                        <summary className="b2 sm danger">Remove</summary>
                        <form action={removeOrderFile} className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="file" value={f.id} />
                          <input className="input sm" name="reason" placeholder="Why (optional)" aria-label="Why" style={{ width: 200 }} />
                          <Submit className="b2 sm" pendingText="Removing…">Remove it</Submit>
                        </form>
                      </details>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="up2-sub">No files on this order.</span>
        )}
        {order.status !== "cancelled" && fileCan("bol") ? (
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <AddFiles orderId={order.id} />
            <Help>A photo or scan of the signed packing slip or BOL. The AI reads it and tells you if it&apos;s another order&apos;s. Signing in the app (Load &amp; sign) is better: nothing to photograph.</Help>
          </div>
        ) : null}
      </section>
    );
  } else if (doing === "rep" && canSetRep) {
    const { data: staffRows } = await supabase.from("profiles").select("id, full_name, email, job_role").in("role", ["employee", "admin"]).eq("status", "active").eq("demo", false).order("full_name");
    const staff = (staffRows ?? []) as Staff[];
    const customerRep = company?.sales_rep_id ? staff.find((p) => p.id === company.sales_rep_id) : undefined;
    const placerRep = staff.find((p) => p.id === order.placed_by && p.job_role === "sales_rep");
    const companyHouse = Boolean(company?.house_account) && !company?.sales_rep_id;
    const repPick = order.sales_rep_id ?? (order.house_account ? HOUSE : placerRep?.id ?? "");
    panel = (
      <section className="panel2">
        {panelHead("Sales rep")}
        <form action={setOrderRep} className="col" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={order.id} />
          <select className="select" name="rep" defaultValue={repPick} required aria-label="Sales rep for this order">
            <option value="" disabled>Pick the sales rep…</option>
            <RepOptions staff={staff} house />
          </select>
          {order.company_id ? (
            <label className="check small">
              <input type="checkbox" name="customer" value="1" defaultChecked={!company?.sales_rep_id && !companyHouse} />
              <span>Use for {order.company_name}&apos;s future orders <span className="faint">(now: {company?.sales_rep_id ? (customerRep ? staffName(customerRep) : "someone no longer on staff") : companyHouse ? "House Account" : "none"})</span></span>
            </label>
          ) : null}
          <div className="up2-acts">
            <Submit className="b2" pendingText="Saving…">Save</Submit>
            <Help>Whoever you pick gets credit for this order on the sales goal trackers. House Account: no one does.</Help>
          </div>
        </form>
      </section>
    );
  } else if (doing === "date" && desk && isOpen) {
    panel = (
      <section className="panel2">
        {panelHead(order.delivery_method === "pickup" ? "Pickup date" : "Delivery date")}
        <ScheduleForm o={order} today={today} closures={closuresAround(todayCentral(), await holidaySettings(supabase))} />
      </section>
    );
  } else if (doing === "numbers" && desk && isOpen) {
    panel = (
      <section className="panel2">
        {panelHead("Sales Order #, Invoice # & prices")}
        <NumbersForm orderId={order.id} po={order.ambit_po ?? null} invoice={order.invoice_no ?? null} lines={priceLines(lines.map((l) => ({ ...l, foam: foamOf(l, l.product?.category_id) })), { prefill: !order.priced_at })} />
      </section>
    );
  } else if (doing === "prices" && approvedPrices.length) {
    panel = (
      <section className="panel2">
        {panelHead(`Approved prices for ${order.company_name}`)}
        <div className="col" style={{ gap: 0 }}>
          {approvedPrices.map((l, i) => (
            <Link key={i} href={`/price-requests/n/${l.req}`} className="item2" style={{ padding: "10px 0", color: "inherit" }}>
              <span className="item2-b"><span className="item2-n">{l.name}</span><span className="tiny faint">{l.sku} · PR-{1000 + l.req} · good through {l.until}</span></span>
              <span className="item2-q"><b>{money(Number(l.approved_price))}</b><span className="tiny faint">/ {l.unit ?? "each"}</span></span>
            </Link>
          ))}
        </div>
      </section>
    );
  } else if (doing === "vary" && variance) {
    panel = (
      <section className="panel2">
        {panelHead("Swap a lot or item")}
        <ItemVariance data={variance} open title="Item variance" />
      </section>
    );
  } else if (doing === "email") {
    panel = (
      <section className="panel2">
        {panelHead("Order email")}
        <span className="up2-sub">
          {order.email_status === "sent" && "Sent to orders@ambitpu.com."}
          {order.email_status === "failed" && `Didn't go out: ${order.email_error ?? "unknown error"}`}
          {order.email_status === "not_configured" && "Email isn't set up, so it was saved here only."}
          {order.email_status === "pending" && "Not sent yet."}
        </span>
        <form action={resendOrderEmail}>
          <input type="hidden" name="id" value={order.id} />
          <Submit className="b2" pendingText="Sending…">{order.email_status === "sent" ? "Send again" : "Send it"}</Submit>
        </form>
      </section>
    );
  } else if (doing === "status" && (admin || desk)) {
    panel = (
      <section className="panel2">
        {panelHead("Status")}
        <form action={setOrderStatus} className="row" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={order.id} />
          <select name="status" className="select" defaultValue={order.status} style={{ flex: 1 }} aria-label="Order status">
            <option value="new">New</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Submit className="b2" pendingText="Saving…">Save</Submit>
        </form>
      </section>
    );
  } else if (doing === "cancel" && canCancel) {
    panel = (
      <section className="panel2" style={{ borderColor: "var(--red)" }}>
        {panelHead("Cancel this order")}
        <form action={cancelOrder} className="col" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={order.id} />
          <input className="input" name="reason" required minLength={3} maxLength={500} placeholder="Why? Customer called / Entered twice" aria-label="Why is it cancelled?" />
          <div className="up2-acts">
            <Submit className="b2" pendingText="Cancelling…">Cancel order</Submit>
            <Help>Its stock is released and the inventory sheet line is marked Cancelled. It stays in Orders as Cancelled{admin ? ", and you can delete it after that" : ""}.</Help>
          </div>
        </form>
      </section>
    );
  } else if (doing === "delete" && admin && order.status === "cancelled") {
    panel = (
      <section className="panel2" style={{ borderColor: "var(--red)" }}>
        {panelHead("Delete this order")}
        <form action={deleteOrder} className="col" style={{ gap: 10 }}>
          <input type="hidden" name="id" value={order.id} />
          <label className="check small"><input type="checkbox" name="sure" required /> {orderNo(order.order_no)} leaves the app (kept in the Deleted orders log)</label>
          <div><Submit className="b2" pendingText="Deleting…">Delete order</Submit></div>
        </form>
      </section>
    );
  }

  // Items, with the lot chips.
  const isoOrFoam = (l: (typeof lines)[number]) => ["iso", "foam"].includes(lookFor(l.product?.category_id, l.sku, l.name));
  const itemsCard = (
    <section className="card2" aria-label="Items">
      <div className="card2-h">
        <b>Items</b>
        <span className="up2-sub">{loadText}</span>
      </div>
      {lines.map((l) => {
        const ps = pickFor(l);
        const noneRecorded = emp && order.status === "completed" && !ps?.length && isoOrFoam(l);
        return (
          <div key={l.id} className="item2">
            {l.product?.image_url ? (
              <ProductPhoto src={l.product.image_url} alt={l.name} size={72} className="item2-ph" />
            ) : (
              <CatIcon look={lookFor(l.product?.category_id, l.sku, l.name)} size={44} />
            )}
            <div className="item2-b">
              <span className="item2-n">{l.name}</span>
              {ps?.length || noneRecorded ? (
                <span className="lots2">
                  {ps?.map((p) => (
                    <span key={p.id} className={`lot2${p.lot_no ? "" : " none"}`}>
                      {[brandOf(p.sku), p.lot_no ? `Lot ${p.lot_no}` : p.state === "reserved" ? "No lot yet" : "No lot"].filter(Boolean).join(" · ")} <b>{Number(p.qty)}</b>
                    </span>
                  ))}
                  {noneRecorded ? (
                    canEdit ? <Link href={`/orders/${order.id}/edit`} className="lot2 none">No lots recorded · add</Link> : <span className="lot2 none">No lots recorded</span>
                  ) : null}
                </span>
              ) : null}
              {(l as { added_by_customer?: boolean }).added_by_customer ? <span className="tag2">Added by the customer</span> : null}
              {emp && l.ordered_sku ? <span className="tag2">Instead of {l.ordered_name ?? l.ordered_sku}</span> : null}
            </div>
            <div className="item2-q">
              <b>{qtyText(Number(l.qty), l.unit)}</b>
              <span className="tiny faint">
                {l.customer_priced && l.unit_price === null ? "Customer pricing" : l.line_total !== null ? money(l.line_total) : "On invoice"}
              </span>
            </div>
          </div>
        );
      })}
      <div className="item2" style={{ justifyContent: "space-between" }}>
        <span className="up2-sub row" style={{ gap: 8 }}>
          {order.priced_at ? "Subtotal" : "Estimated subtotal"}
          <Help>{order.priced_at ? "From the invoice prices." : "List prices."} Final pricing, tax and freight are on the invoice.</Help>
        </span>
        <b>{money(order.est_subtotal)}</b>
      </div>
    </section>
  );

  // The details, as a calm grid.
  const kv: { k: string; v: React.ReactNode; wide?: boolean; warn?: boolean }[] = [];
  if (order.po_number) kv.push({ k: "Customer PO", v: order.po_number });
  if (emp) kv.push({ k: "Sales Order #", v: order.ambit_po ?? <span className="faint">–</span> });
  if (emp) kv.push({ k: "Invoice #", v: order.invoice_no ? <span className="col" style={{ gap: 6 }}>{order.invoice_no}<FileChips orderId={order.id} files={files.filter((f) => f.kind === "invoice")} label="Invoice" /></span> : <span className="faint">–</span> });
  if (order.delivery_method === "pickup") kv.push({ k: "Pickup at", v: branch ? `${branch.name}, ${branch.state}` : branchName ?? "–" });
  else kv.push({ k: "Ship to", v: order.ship_address ?? "–" });
  if (order.needed_by) kv.push({ k: "Needed by", v: dateShort(order.needed_by) });
  if (order.scheduled_for && order.status !== "cancelled") kv.push({ k: order.delivery_method === "pickup" ? "Pickup" : "Delivery", v: dateShort(order.scheduled_for) });
  kv.push({ k: "Placed by", v: `${order.placed_by_name ?? order.placed_by_email}${emp && order.placed_by_role !== "customer" ? " (AMBIT)" : ""}` });
  if (emp) kv.push({ k: "Sales rep", v: rep ? rep.full_name?.trim() || rep.email : order.house_account ? "House Account" : <span className="faint">None yet</span> });
  if (emp && order.account_no) kv.push({ k: "Account", v: order.account_no });
  kv.push({ k: "Submitted", v: dateTime(order.created_at) });
  if (state === "approved" && order.approved_at) {
    kv.push({ k: "Approved", v: order.approval_method === "staff_recorded" ? `${order.approval_note ?? ""} (${order.approved_by_name ?? "AMBIT"})` : [order.approved_by_name, dateShort(order.approved_at.slice(0, 10))].filter(Boolean).join(" · ") });
  }
  if (emp && (order.revision ?? 1) > 1) kv.push({ k: "Revision", v: String(order.revision) });
  if (emp && files.some((f) => f.kind === "bol")) kv.push({ k: "Signed BOL", v: <span className="col" style={{ gap: 6 }}><FileChips orderId={order.id} files={files.filter((f) => f.kind === "bol")} label="Page" /><Link href={`/orders/${order.id}?do=files`} className="tiny">Manage files</Link></span> });
  if (emp && order.tax_note) kv.push({ k: "Sales tax", v: order.tax_note, wide: true, warn: true });
  if (emp && tax && (TAX_STATE[tax.state].blocks || tax.state === "expiring")) {
    kv.push({ k: "Tax certificate", v: <>{taxLine(tax, dateShort)}{credit && order.company_id ? <> · <Link href={`/tax/${order.company_id}`}>Certificates</Link></> : null}</>, wide: true, warn: true });
  }
  if (order.notes) kv.push({ k: "Notes", v: order.notes, wide: true });
  const detailsCard = (
    <section className="card2" aria-label="Details">
      <dl className="kv2" style={{ margin: 0 }}>
        {kv.map((x) => (
          <div key={x.k} className={x.wide ? "wide" : undefined}>
            <dt>{x.k}</dt>
            <dd style={x.warn ? { color: "var(--warn-text)" } : undefined}>{x.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  // Every change, newest first, folded away.
  type HistoryRow = { kind: "d"; at: string; d: (typeof detailEdits)[number] } | { kind: "e"; at: string; e: (typeof edits)[number] };
  const history: HistoryRow[] = [
    ...detailEdits.map((d) => ({ kind: "d" as const, at: d.changed_at, d })),
    ...edits.map((e) => ({ kind: "e" as const, at: e.edited_at, e })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const historyCard = history.length ? (
    <details className="card2 hist2" open={doing === "history"}>
      <summary>
        <span>Changes ({history.length})</span>
        <span className="up2-sub">Show</span>
      </summary>
      <div className="hist2-l">
        {history.map((h) =>
          h.kind === "d" ? (
            <div key={`d${h.d.id}`} className="hist2-e">
              <span className="t">{h.d.changed_by_name ?? ""} · {dateTime(h.d.changed_at)}</span>
              <ul className="edit-changes small" style={{ margin: 0 }}>{detailsText(h.d.changes).map((t, i) => <li key={i}>{t}</li>)}</ul>
              {h.d.note ? <span className="t">Why: {h.d.note}</span> : null}
            </div>
          ) : (
            <div key={h.e.id} className="hist2-e">
              <span className="t">Revision {h.e.revision} · {h.e.edited_by_name ?? ""} · {dateTime(h.e.edited_at)}</span>
              <ul className="edit-changes small" style={{ margin: 0 }}>{changesText(h.e.changes).map((t, i) => <li key={i}>{t}</li>)}</ul>
              {h.e.note ? <span className="t">Why: {h.e.note}</span> : null}
              {h.e.admin_needed ? (
                <span className="t" style={h.e.admin_approved_at ? undefined : { color: "var(--red-text)" }}>
                  {h.e.admin_approved_at ? `Approved by ${h.e.admin_approved_by_name ?? "an admin"} · ${dateTime(h.e.admin_approved_at)}` : "Waiting for an admin to approve"}
                </span>
              ) : null}
              {h.e.invoice_updated_at ? (
                <span className="t">Invoice updated by {h.e.invoice_updated_by_name ?? ""}{h.e.total_before !== null && h.e.total_after !== null ? ` · ${money(h.e.total_before)} → ${money(h.e.total_after)}` : ""}</span>
              ) : null}
            </div>
          ),
        )}
      </div>
    </details>
  ) : null;

  const upNow = emp ? (
    <UpNow
      order={order}
      stage={st}
      who={{ admin, desk, credit, warehouse }}
      edits={edits}
      waitingEdits={waitingEdits}
      files={files}
      lines={lines.map((l) => ({ ...l, foam: foamOf(l, l.product?.category_id) }))}
      loadText={loadText}
      branchName={branch?.name ?? null}
      tax={tax}
      closures={st === "schedule" && desk ? closuresAround(todayCentral(), await holidaySettings(supabase)) : []}
      creditInfo={creditInfo ? { limit: creditInfo.credit_limit, balance: creditInfo.balance, pastDue: creditInfo.past_due, over90: creditInfo.over_90, available: creditInfo.available, lastPaid: creditInfo.last_paid, lastPaidAmount: creditInfo.last_paid_amount, asOf: creditInfo.as_of, companyId: creditInfo.company_id } : null}
      payDefaults={company ? { cod: Boolean(company.pay_cod), noChecks: Boolean(company.pay_no_checks) } : null}
      pickupLots={pickupLots}
      customerEmail={company?.email ?? null}
      customerContact={company?.contact_name ?? null}
      bolProblems={bolFinding?.problems ?? []}
    />
  ) : null;

  return (
    <main className="shell wide">
      <TrackRecent uid={profile.id} kind="order" href={`/orders/${order.id}`} title={emp ? order.company_name : orderNo(order.order_no)} sub={emp ? orderNo(order.order_no) : "Order"} />
      {justSent ? (
        <div className="col" style={{ alignItems: "center", gap: 14, paddingTop: 30, textAlign: "center" }}>
          <div className="done-mark">
            {sp.sent !== "approval" ? <Check size={40} strokeWidth={3} /> : order.approval_email_status === "sent" ? <MailCheck size={38} strokeWidth={2.4} /> : <CircleAlert size={38} strokeWidth={2.4} />}
          </div>
          <h1 className="h1">
            {sp.sent === "approval"
              ? order.approval_email_status === "sent" ? "Sent for approval" : "Order saved, not sent"
              : profile.role === "customer" ? "Order approved" : "Order sent"}
          </h1>
          <p className="muted" style={{ margin: 0, maxWidth: 380 }}>
            {sp.sent === "approval"
              ? order.approval_email_status === "sent"
                ? `${orderNo(order.order_no)} was emailed to ${order.approval_email} to approve.`
                : `${orderNo(order.order_no)} is saved, but the approval email didn't go out. Check the email address and resend it.`
              : order.email_status === "sent"
                ? `${orderNo(order.order_no)} went to AMBIT. A copy is in your inbox.`
                : `${orderNo(order.order_no)} is saved and the AMBIT team can see it.`}
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/" className="b2 quiet">Back home</Link>
            <Link href={`/orders/${order.id}`} className="b2 quiet">See the order</Link>
            <Link href="/order" className="b2">Place another</Link>
          </div>
        </div>
      ) : (
        <div className="o2">
          <div className="o2-head">
            <div className="o2-head-l">
              <Link href={back} className="o2-back" aria-label="Back to orders"><ChevronLeft size={20} /></Link>
              <div className="o2-title">
                <div className="row">
                  <h1>{orderNo(order.order_no)}</h1>
                  <span className={`pill2 ${pill.tone}`}>{pill.text}</span>
                  {kind !== "sale" ? <span className="pill2 info">{kind === "return" ? "Return" : "Exchange"}</span> : null}
                </div>
                <span className="o2-sub">{emp ? `${order.company_name} · ` : ""}{deliveryLine}</span>
              </div>
            </div>
            <div className="o2-head-r">
              {canEdit || canEditDetails ? (
                <Link href={canEdit ? `/orders/${order.id}/edit` : `/orders/${order.id}/edit?tab=details`} className="b2 quiet"><Pencil size={17} /> Edit order</Link>
              ) : null}
              {menu}
            </div>
          </div>

          {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
          {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

          <Steps order={order} stage={st} href={emp ? `/orders/${order.id}?view=flow` : undefined} />

          <div className="o2-cols">
            <div className="o2-main">
              {panel ?? upNow}
              {contractorDecides ? (
                <section className="up2" aria-label="Your approval">
                  <div className="up2-txt">
                    <span className="up2-who">Up now · You</span>
                    <span className="up2-title">Approve this order</span>
                    <span className="up2-sub">{order.placed_by_name ?? "AMBIT"} put it together for {order.company_name}. Nothing ships until you approve.</span>
                  </div>
                  <form action={customerDecision} className="up2-acts">
                    <input type="hidden" name="id" value={order.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <Submit className="b2 lg" pendingText="Approving…"><Check size={19} /> Approve order</Submit>
                  </form>
                  <details className="up2-more">
                    <summary>Something not right?</summary>
                    <form action={customerDecision} className="col" style={{ gap: 10, marginTop: 10, width: "100%" }}>
                      <input type="hidden" name="id" value={order.id} />
                      <input type="hidden" name="decision" value="changes" />
                      <textarea className="textarea" name="note" rows={3} required placeholder="What needs to change?" aria-label="What needs to change?" />
                      <div><Submit className="b2 sm" pendingText="Sending…">Send to my AMBIT rep</Submit></div>
                    </form>
                  </details>
                </section>
              ) : null}
              {emp && kind !== "sale" && retRows?.length ? (
                <OrderReturnsCard
                  orderId={order.id}
                  kind={kind}
                  reason={(order as { return_reason?: string | null }).return_reason ?? null}
                  originalNo={retOrig ? Number(retOrig.order_no) : null}
                  originalId={retOrig ? (retOrig.id as string) : null}
                  lines={retRows as ReturnLine[]}
                  outTotal={Number(order.est_subtotal ?? 0)}
                  outAccount={Boolean(order.has_customer_pricing)}
                  canReceive={can(profile, "receiving") || can(profile, "inventory")}
                />
              ) : null}
              {itemsCard}
              {detailsCard}
              {historyCard}
            </div>
            {emp ? (
              <div className="o2-side">
                <ChatCard db={supabase} orderId={order.id} me={profile.id} meName={profile.full_name || profile.email} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
