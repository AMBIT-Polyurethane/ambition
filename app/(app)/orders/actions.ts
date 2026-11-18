"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getSession, isEmployee } from "@/lib/session";
import { sendAdminChangeApproval, sendApprovalRequest, sendChangeRequestNotice, sendDeskNotice, sendOrderEmail, sendOrderUpdatedNotice, sendScheduledNotice } from "@/lib/order-send";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { renderPackingSlip, signedSlipFileName } from "@/lib/order-doc/packing-slip";
import type { Order } from "@/lib/types";
import { kickForOrder } from "@/lib/inventory/sync";
import { pushHandoffs } from "@/lib/chat-handoff";
import { can } from "@/lib/access";
import { money } from "@/lib/format";
import { changesText, detailsText, type DetailChange, type OrderChange } from "@/lib/order-edit";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { bolCheckReady, checkOrderBol, checkOrderBolNow, orderFileVerdicts } from "@/lib/order-doc/bol-check";

const STATUSES = ["new", "processing", "completed", "cancelled"];

function back(id: string, kind: "msg" | "err", text: string): never {
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  if (kind === "msg") handoffPush(id);
  redirect(`/orders/${id}?${kind}=${encodeURIComponent(text)}`);
}

/** 0089: a phone notification for whoever the order chat just tagged for the next step (once the page has moved on). */
function handoffPush(id: string) {
  try {
    after(async () => {
      try {
        const s = await getSession();
        if (s?.supabase) await pushHandoffs(s.supabase, id);
      } catch {
        // the note and the to-do are there anyway
      }
    });
  } catch {
    // not inside a request
  }
}

export async function setOrderStatus(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!STATUSES.includes(status)) return;
  if (status === "completed") {
    const { count } = await s.supabase.from("order_files").select("id", { count: "exact", head: true }).eq("order_id", id).eq("kind", "bol");
    if (!count) back(id, "err", "Attach the signed BOL first: use Mark shipped out / Mark picked up on the order desk card.");
  }
  await s.supabase.from("orders").update({ status }).eq("id", id);
  await kickForOrder(s.supabase, id, `order ${status}`);
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Sales rep box on an order (admins and the order desk): who gets credit for this order on the sales goal
 * trackers, and (if ticked) the customer's rep from now on, which also credits that rep with the customer's other
 * orders that had no rep. Staff can't write orders (or, unless admin, customers) directly, so after the check here
 * both are saved with the server key, one column each.
 */
export async function setOrderRep(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  const admin = s.profile.role === "admin";
  if (!admin && !can(s.profile, "order_desk")) back(id, "err", "Only admins and the order desk can change the sales rep.");
  const raw = String(form.get("rep") ?? "");
  const rep = UUID.test(raw) ? raw : null;
  const house = raw === "house"; // House Account: no sales rep gets credit
  if (!rep && !house) back(id, "err", "Pick the sales rep, or House Account.");
  const alsoCustomer = form.get("customer") === "1";

  const { data: o } = await s.supabase.from("orders").select("id, company_id, company_name, sales_rep_id").eq("id", id).maybeSingle<{
    id: string;
    company_id: string | null;
    company_name: string;
    sales_rep_id: string | null;
  }>();
  if (!o) back(id, "err", "Order not found.");
  let name = "";
  if (rep) {
    const { data: p } = await s.supabase.from("profiles").select("full_name, email, role, status").eq("id", rep).maybeSingle<{
      full_name: string | null;
      email: string;
      role: string;
      status: string;
    }>();
    if (!p || (p.role !== "employee" && p.role !== "admin") || p.status !== "active") back(id, "err", "Pick someone on AMBIT staff.");
    name = p.full_name?.trim() || p.email;
  }

  if (!serviceReady()) back(id, "err", "The sales rep can't be saved yet: SUPABASE_SECRET_KEY isn't set in Vercel.");
  const db = serviceClient();
  {
    const { error } = await db.from("orders").update({ sales_rep_id: rep, house_account: house }).eq("id", id);
    if (error) back(id, "err", `The sales rep wasn't saved: ${error.message}`);
  }
  if (alsoCustomer && o.company_id) {
    const { error } = await db.from("companies").update({ sales_rep_id: rep, house_account: house }).eq("id", o.company_id);
    if (error) back(id, "err", `This order's sales rep is saved, but not ${o.company_name}'s: ${error.message}`);
    revalidatePath("/admin/companies");
  }
  revalidatePath("/sales-goals");
  revalidatePath("/");
  back(
    id,
    "msg",
    rep
      ? `${name} now gets credit for this order${alsoCustomer && o.company_id ? ` and is ${o.company_name}'s sales rep from now on` : ""}.`
      : `This order is a House Account order: no sales rep gets credit${alsoCustomer && o.company_id ? `, and ${o.company_name} is a House Account from now on` : ""}.`,
  );
}

export async function resendOrderEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const { data: order } = await s.supabase.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (order && (order.approval_status === "pending" || order.approval_status === "changes_requested")) {
    back(id, "err", "This order goes to AMBIT orders once the customer approves it.");
  }
  await sendOrderEmail(s.supabase, id);
  revalidatePath(`/orders/${id}`);
}

/** Staff: send the approval email again (new link), optionally to a different address. */
export async function resendApproval(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const res = await sendApprovalRequest(s.supabase, id, email);
  if (res.status === "sent") back(id, "msg", `Approval email sent to ${email}. The earlier link no longer works.`);
  back(id, "err", res.error ?? "The approval email didn't go out.");
}

/** Staff: the customer approved by phone or in person. */
export async function recordApproval(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("record_order_approval", { p_order: id, p_note: note });
  if (error) back(id, "err", error.message);
  const sent = await sendOrderEmail(s.supabase, id);
  back(id, "msg", sent.status === "sent" ? "Approval recorded. The order went to orders@ambitpu.com." : "Approval recorded.");
}

/** Staff: move the order past the customer step without the customer's email approval. */
export async function approveWithoutEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("order_approve_without_customer", { p_order: id, p_note: note || null });
  if (error) back(id, "err", error.message);
  const sent = await sendOrderEmail(s.supabase, id);
  back(
    id,
    "msg",
    `Approved without customer email approval.${sent.status === "sent" ? " The order went to orders@ambitpu.com." : ""} It's ready for its Sales Order # and Invoice #.`,
  );
}

// ------------------------------------------------------------------ editing an order (0041)
export type EditLine = { id?: number | null; product_id?: string | null; qty: number; lot_id?: number | null };

/**
 * AMBIT staff: add items or change / remove quantities on an open order. Then whoever's next hears about it:
 * the customer gets a fresh approval email (still waiting on them), the CRM gets "invoice update needed"
 * (the Invoice # was already in), or orders@ gets the updated order.
 */
export type SheetRow = { item_id?: number | null; product_id: string | null; lot_id: number | null; qty: number };

/**
 * Edit order as a sheet (0086): any number of rows, any item in inventory, the same item on as many rows as you like,
 * each on its own lot. Rows of one item add up to its quantity; the lots on its rows are what it holds (open order)
 * or what went out (picked up / shipped). Then whoever's next hears about it, as before.
 */
type Saved = { ok: false; error: string } | { ok: true; kind: "msg" | "err"; text: string };

export async function saveOrderSheet(input: { id: string; rows: SheetRow[]; note: string; belowZero?: boolean; recordOnly?: boolean }): Promise<{ ok: false; error: string } | never> {
  const r = await sheetCore(input);
  if (!r.ok) return r;
  back(String(input.id ?? ""), r.kind, r.text);
}

async function sheetCore(input: { id: string; rows: SheetRow[]; note: string; belowZero?: boolean; recordOnly?: boolean }): Promise<Saved> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !(s.profile.role === "admin" || can(s.profile, "ordering") || can(s.profile, "order_desk"))) {
    return { ok: false, error: "You don't have access to edit orders." };
  }
  const id = String(input.id ?? "");
  const note = String(input.note ?? "").trim().slice(0, 500);
  const UUIDISH = /^[0-9a-f-]{36}$/i;
  const rows = (input.rows ?? [])
    .map((r) => ({
      item_id: Number(r.item_id) > 0 ? Number(r.item_id) : null,
      product_id: r.product_id && UUIDISH.test(String(r.product_id)) ? String(r.product_id) : null,
      lot_id: Number(r.lot_id) > 0 ? Number(r.lot_id) : null,
      qty: Math.round(Number(r.qty) * 100) / 100,
    }))
    .filter((r) => Number.isFinite(r.qty) && r.qty >= 0 && (r.product_id || r.item_id));
  const [{ data: o }, { data: itRows }] = await Promise.all([
    s.supabase.from("orders").select("status, branch_id, order_no").eq("id", id).maybeSingle<{ status: string; branch_id: string | null; order_no: number }>(),
    s.supabase.from("order_items").select("id, product_id, qty, name, sku").eq("order_id", id).order("id"),
  ]);
  if (!o) return { ok: false, error: "Order not found." };
  if (o.status === "completed" && s.profile.role !== "admin") return { ok: false, error: "Only an admin can correct an order that already went out." };
  const closed = o.status === "completed";
  type It = { id: number; product_id: string | null; qty: number; name: string; sku: string };
  const items = (itRows ?? []) as It[];

  // What each item should be: its rows added up, and the lots on them.
  const want = new Map<string, { qty: number; lots: Map<number, number> }>();
  for (const r of rows) {
    if (!r.product_id || r.qty <= 0) continue;
    const w = want.get(r.product_id) ?? { qty: 0, lots: new Map<number, number>() };
    w.qty = Math.round((w.qty + r.qty) * 100) / 100;
    if (r.lot_id) w.lots.set(r.lot_id, Math.round(((w.lots.get(r.lot_id) ?? 0) + r.qty) * 100) / 100);
    want.set(r.product_id, w);
  }
  const freeQty = new Map(rows.filter((r) => !r.product_id && r.item_id).map((r) => [r.item_id!, r.qty]));
  const firstOf = new Map<string, number>();
  for (const it of items) if (it.product_id && !firstOf.has(it.product_id)) firstOf.set(it.product_id, it.id);
  const lines: { id?: number; product_id?: string; qty: number }[] = [];
  for (const it of items) {
    const q = it.product_id ? (firstOf.get(it.product_id) === it.id ? want.get(it.product_id)?.qty ?? 0 : 0) : freeQty.get(it.id) ?? Number(it.qty);
    lines.push({ id: it.id, qty: q });
  }
  for (const [pid, w] of want) if (!firstOf.has(pid)) lines.push({ product_id: pid, qty: w.qty });
  const qtyChanged = lines.some((l) => !l.id || Number(items.find((i) => i.id === l.id)?.qty) !== l.qty);
  if (!lines.some((l) => l.qty > 0)) return { ok: false, error: "An order needs at least one item. To drop everything, cancel the order instead." };

  // Gone out already: every drum of an item counted by lot needs its lot (that's what went out).
  const lotWanted = [...want.entries()].filter(([, w]) => w.lots.size > 0);
  if (closed && lotWanted.length) {
    if (!o.branch_id) return { ok: false, error: "This order has no location, so its lots can't be recorded. Set the location first (Edit details)." };
    for (const [pid, w] of lotWanted) {
      const onLots = [...w.lots.values()].reduce((t, q) => t + q, 0);
      if (Math.abs(onLots - w.qty) > 0.001) {
        const it = items.find((i) => i.product_id === pid);
        return { ok: false, error: `${it?.name ?? "That item"}: ${onLots} of its ${w.qty} have a lot. On an order that already went out, give every row of it a lot (or none).` };
      }
    }
  }
  if (!qtyChanged && !lotWanted.length) return { ok: false, error: "Nothing changed yet." };

  let r: { revision?: number; invoice_update?: boolean; customer?: boolean; closed?: boolean; changes?: OrderChange[]; lots?: number } = {};
  // Before the quantities change: which items had nothing recorded as gone out ("Just record the lots").
  const { data: doneRows } = closed ? await s.supabase.from("inventory_lines").select("order_item_id").eq("order_id", id).eq("state", "done") : { data: [] };
  const hadDone = new Set(((doneRows ?? []) as { order_item_id: number | null }[]).map((d) => d.order_item_id));
  if (qtyChanged) {
    const { data, error } = await s.supabase.rpc("order_edit", { p_order: id, p_lines: lines, p_note: note || null });
    if (error) return { ok: false, error: error.message.replace(/^.*?ERROR:\s*/, "") };
    r = (data ?? {}) as typeof r;
  }

  // The lots.
  const lotNotes: string[] = [];
  let lotErr: string | null = null;
  if (lotWanted.length) {
    const { data: now } = await s.supabase.from("order_items").select("id, product_id, name").eq("order_id", id).order("id");
    const itemOf = new Map<string, { id: number; name: string }>();
    for (const it of (now ?? []) as { id: number; product_id: string | null; name: string }[]) if (it.product_id && !itemOf.has(it.product_id)) itemOf.set(it.product_id, it);
    if (!closed) {
      for (const [pid, w] of lotWanted) {
        const it = itemOf.get(pid);
        if (!it) continue;
        const { data: txt, error } = await s.supabase.rpc("order_item_set_lots", {
          p_item: it.id,
          p_lots: [...w.lots.entries()].map(([lot, qty]) => ({ lot, qty })),
          p_below_zero: input.belowZero === true,
          p_reason: note || "Edit order",
        });
        if (error) {
          lotErr = /order_item_set_lots/.test(error.message) ? "Putting rows on their lots needs the 0086 database update first (Supabase > SQL Editor)." : `${it.name}: ${error.message.replace(/^.*?ERROR:\s*/, "")}`;
          break;
        }
        lotNotes.push(`${it.name}: ${String(txt ?? "")}.`);
      }
    } else {
      const relot = lotWanted
        .map(([pid, w]) => {
          const it = itemOf.get(pid);
          if (!it) return null;
          return {
            item: it.id,
            lots: [...w.lots.entries()].map(([lot, qty]) => ({ lot, qty })),
            ...(input.belowZero === true ? { below_zero: true } : {}),
            ...(input.recordOnly === true && !hadDone.has(it.id) && !qtyChanged ? { record_only: true } : {}),
          };
        })
        .filter((x) => x !== null);
      const { data: n, error } = await s.supabase.rpc("order_relot_items", { p_order: id, p_items: relot, p_reason: note || "Edit order" });
      if (error && !/Nothing changed/.test(error.message)) lotErr = error.message.replace(/^.*?ERROR:\s*/, "");
      else if (!error) lotNotes.push(`${Number(n) || 0} item${Number(n) === 1 ? "" : "s"} now show the lots that went out.`);
    }
  }
  await kickForOrder(s.supabase, id, "order edited");
  if (lotErr) return { ok: true, kind: "err", text: `${qtyChanged ? `The quantities were saved (revision ${r.revision ?? ""}), but the lots weren't: ` : "The lots weren't saved: "}${lotErr}` };
  if (!qtyChanged) return { ok: true, kind: "msg", text: `Saved. ${lotNotes.join(" ")}` };

  const changes = changesText(r.changes);
  // Every change to the items waits for an admin, who makes sure the QuickBooks invoice has it (0075).
  const admins = changes.length
    ? await sendAdminChangeApproval(s.supabase, id, { by: s.profile.full_name ?? s.profile.email ?? "AMBIT staff", revision: r.revision ?? 2, changes, note: note || null })
    : null;
  const rev = `${lotNotes.length ? `${lotNotes.join(" ")} ` : ""}Saved as revision ${r.revision ?? 2}.${
    admins ? (admins.status === "sent" ? " Admins were emailed to approve the change." : " An admin has to approve the change (the email to admins didn't go out, so tell one).") : ""
  }`;
  if (r.closed) {
    const sent = r.invoice_update ? await sendDeskNotice(s.supabase, id, "invoice_update", changes) : null;
    return {
      ok: true,
      kind: "msg",
      text: `${rev} Stock was corrected (what changed went back in, the new amounts came out), and the spreadsheet updates on its next sync.${
        r.invoice_update ? ` The order desk${sent?.status === "sent" ? " was emailed to" : " needs to"} update the invoice. If the total changes, the credit team is emailed to collect or credit the difference.` : ""
      }`,
    };
  }
  if (r.customer) {
    const { data: oc } = await s.supabase.from("orders").select("approval_email").eq("id", id).maybeSingle<{ approval_email: string | null }>();
    if (oc?.approval_email) {
      const sent = await sendApprovalRequest(s.supabase, id, oc.approval_email);
      return { ok: true, kind: sent.status === "sent" ? "msg" : "err", text: `${rev} ${sent.status === "sent" ? `A fresh approval email went to ${oc.approval_email} (the old link no longer works).` : `The new approval email didn't go out (${sent.error ?? sent.status}). Use Resend below.`}` };
    }
    return { ok: true, kind: "msg", text: `${rev} The customer still needs to approve it.` };
  }
  if (r.invoice_update) {
    const sent = await sendDeskNotice(s.supabase, id, "invoice_update", changes);
    return { ok: true, kind: "msg", text: `${rev} It went back to the order desk for an invoice update${sent.status === "sent" ? " (they were emailed)" : ""}. If the total goes up, accounting checks credit again.` };
  }
  const sent = await sendOrderEmail(s.supabase, id, { changes });
  return { ok: true, kind: "msg", text: `${rev}${sent.status === "sent" ? " The updated order went to orders@ambitpu.com." : ""}` };
}

/** A signed-in contractor approves, or asks to change, an order AMBIT placed for their company. */
export async function customerDecision(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const approve = String(form.get("decision") ?? "") === "approve";
  const note = String(form.get("note") ?? "").trim();
  const { error } = await s.supabase.rpc("customer_order_decision", { p_order: id, p_approve: approve, p_note: note || null });
  if (error) back(id, "err", error.message);
  if (approve) {
    await sendOrderEmail(s.supabase, id);
    back(id, "msg", "Thanks, the order is approved and on its way to AMBIT.");
  }
  const doc = await loadOrderDoc(s.supabase, id);
  if (doc) await sendChangeRequestNotice(doc);
  back(id, "msg", "Thanks. Your AMBIT rep will send an updated order.");
}

// ------------------------------------------------------------------ order desk
// The database checks who may do each step (Admin > Accounts boxes); these just call it and send the emails.

/** Files the app uploaded to the order-files bucket (paths and names), as sent by the upload forms. */
function filesFrom(form: FormData): { path: string; name: string }[] {
  const paths = form.getAll("file_path").map(String);
  const names = form.getAll("file_name").map(String);
  return paths.filter(Boolean).map((path, i) => ({ path, name: names[i] ?? "" }));
}

async function addFiles(s: NonNullable<Awaited<ReturnType<typeof getSession>>>, id: string, kind: "invoice" | "bol", files: { path: string; name: string }[]) {
  for (const f of files) {
    const { error } = await s.supabase.rpc("order_add_file", { p_order: id, p_kind: kind, p_path: f.path, p_name: f.name || null });
    if (error) return error.message;
  }
  return null;
}

/** CRM: AMBIT's Sales Order # and Invoice # (and the invoice itself, if it's ready). The order moves on to the credit check. */
export async function setOrderPo(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const po = String(form.get("po") ?? "").trim();
  const invoice = String(form.get("invoice") ?? "").trim();
  const { data: before } = await s.supabase
    .from("orders")
    .select("credit_status, invoice_update_at")
    .eq("id", id)
    .maybeSingle<{ credit_status: string | null; invoice_update_at: string | null }>();
  // Prices from the invoice: [{ id, price }] for every line (spray foam and fiberglass have none until now). ISO that
  // goes with more than one foam set has a price per set instead: { id, parts: [{ with, qty, price }] }.
  type Part = { with: number | null; qty: number; price: number };
  let prices: ({ id: number; price: number } | { id: number; parts: Part[] })[] | null = null;
  try {
    const raw = JSON.parse(String(form.get("prices") ?? "null"));
    if (Array.isArray(raw)) {
      prices = raw
        .map((p): { id: number; price: number } | { id: number; parts: Part[] } =>
          Array.isArray(p?.parts)
            ? {
                id: Number(p.id),
                parts: (p.parts as Part[]).map((x) => ({ with: x.with === null || x.with === undefined ? null : Number(x.with), qty: Number(x.qty), price: Number(x.price) })),
              }
            : { id: Number(p.id), price: Number(p.price) },
        )
        .filter((p) =>
          Number.isFinite(p.id) && ("parts" in p ? p.parts.length > 0 && p.parts.every((x) => Number.isFinite(x.qty) && Number.isFinite(x.price)) : Number.isFinite(p.price)),
        );
    }
  } catch {
    prices = null;
  }
  const { error } = await s.supabase.rpc("order_set_numbers", { p_order: id, p_po: po, p_invoice: invoice, p_prices: prices });
  if (error) back(id, "err", error.message);
  const files = filesFrom(form);
  const fileErr = await addFiles(s, id, "invoice", files);
  await kickForOrder(s.supabase, id, "PO entered");
  // After an edit: the invoice now matches. Credit again only if the total went up; the customer gets the updated order.
  if (before?.invoice_update_at) {
    const { data: done, error: doneErr } = await s.supabase.rpc("order_invoice_update_done", { p_order: id });
    if (doneErr) back(id, "err", doneErr.message);
    const r = (done ?? {}) as { was?: boolean; reopened?: boolean; closed?: boolean; before?: number; after?: number; changes?: OrderChange[] };
    if (r.was) {
      const changes = changesText(r.changes);
      if (r.reopened) await sendDeskNotice(s.supabase, id, "credit_needed");
      // Corrected after pickup / delivery: no credit check (the goods are gone); the credit team settles the difference.
      const diff = r.closed && r.before !== undefined && r.after !== undefined && Math.abs(Number(r.after) - Number(r.before)) > 0.004;
      if (diff) await sendDeskNotice(s.supabase, id, "corrected", [`Total ${money(Number(r.before))} → ${money(Number(r.after))}`, ...changes]);
      const mailed = await sendOrderUpdatedNotice(s.supabase, id, changes);
      const total = r.before !== undefined && r.after !== undefined ? ` Total ${money(r.before)} → ${money(r.after)}.` : "";
      back(
        id,
        fileErr ? "err" : "msg",
        `Invoice # ${invoice} and prices saved.${total} ${
          r.closed
            ? diff
              ? `The credit team was emailed to ${Number(r.after) > Number(r.before) ? "collect" : "credit the customer"} the difference.`
              : "The total didn't change."
            : r.reopened ? "The total went up, so accounting was asked to check credit again." : "Credit stays approved."
        } ${mailed.status === "sent" ? "The customer was emailed the updated order." : `The customer wasn't emailed (${mailed.error ?? mailed.status}).`}${
          fileErr ? ` The invoice file wasn't added: ${fileErr}` : ""
        }`,
      );
    }
  }
  // 0068: the credit step can release itself (customer has a line of credit, nothing past due, the order fits the line).
  let auto: { released?: boolean; reason?: string } = {};
  if (!before?.credit_status) {
    const { data: ar, error: arErr } = await s.supabase.rpc("credit_auto_release", { p_order: id });
    if (!arErr) auto = (ar ?? {}) as { released?: boolean; reason?: string };
    await sendDeskNotice(s.supabase, id, auto.released ? "ready_to_schedule" : "credit_needed");
  }
  if (fileErr) back(id, "err", `Sales Order # and Invoice # saved, but the invoice file wasn't added: ${fileErr}`);
  if (auto.released) {
    back(id, "msg", `Sales Order # ${po}, Invoice # ${invoice}${prices ? " and prices" : ""} saved. Credit released automatically (line of credit, nothing past due, fits the line). Schedule it now.`);
  }
  const added = files.length ? ` ${files.length === 1 ? "Invoice file" : `${files.length} invoice files`} added.` : "";
  back(
    id,
    "msg",
    before?.credit_status
      ? `Sales Order # ${po}, Invoice # ${invoice}${prices ? " and prices" : ""} saved.${added}`
      : `Sales Order # ${po}, Invoice # ${invoice}${prices ? " and prices" : ""} saved.${added} Accounting has been asked for the credit check${auto.reason && auto.reason !== "off" ? ` (not released automatically: ${auto.reason})` : ""}.`,
  );
}

/** Order desk: add the invoice file later (after the numbers are in). */
export async function addInvoiceFile(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const files = filesFrom(form);
  if (!files.length) back(id, "err", "Choose the invoice file first.");
  const err = await addFiles(s, id, "invoice", files);
  if (err) back(id, "err", err);
  back(id, "msg", files.length === 1 ? "Invoice file added." : `${files.length} invoice files added.`);
}

/** Accounting: release the order, or put it on hold (with a reason). */
export async function creditDecision(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const approve = String(form.get("decision") ?? "") === "approve";
  const note = String(form.get("note") ?? "").trim();
  const chargeTax = form.get("charge_tax") === "on";
  // COD Only / No Checks Allowed: set on release (the customer's next order starts the same way).
  // Customer Has Already Paid (0042): nothing to collect, so COD Only / No Checks come off this order.
  const pay = approve ? { p_cod: form.get("cod") === "on", p_no_checks: form.get("no_checks") === "on", p_prepaid: form.get("prepaid") === "on" } : {};
  const { error } = await s.supabase.rpc("order_credit_decision", { p_order: id, p_approve: approve, p_note: note || null, p_charge_tax: chargeTax, ...pay });
  if (error) back(id, "err", error.message);
  await sendDeskNotice(s.supabase, id, approve ? "ready_to_schedule" : "credit_hold");
  const flags = pay.p_prepaid ? "customer has already paid" : [pay.p_cod ? "COD only" : "", pay.p_no_checks ? "no checks" : ""].filter(Boolean).join(", ");
  back(id, "msg", approve ? `Released${flags ? ` (${flags})` : ""}. The order desk can schedule it now.` : "Put on credit hold. The rep and the order desk were told.");
}

/** Accounting, at the credit check: waiting on the customer's payment before releasing (0064). */
export async function payWaiting(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const on = String(form.get("on") ?? "1") === "1";
  const { error } = await s.supabase.rpc("order_pay_waiting", { p_order: id, p_on: on });
  if (error) back(id, "err", /order_pay_waiting|function|schema cache/i.test(error.message) ? "Waiting on customer payment needs the 0064 database update first. Ask Jeremiah to run it." : error.message);
  back(id, "msg", on ? "Marked Waiting on customer payment. When it comes in, release the order (Customer Has Already Paid is ticked for you)." : "Took off Waiting on customer payment.");
}

/** CRM: delivery or pickup date. The customer is emailed that it's approved and scheduled. */
export async function scheduleOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const date = String(form.get("date") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back(id, "err", "Pick the delivery or pickup date.");
  const { error } = await s.supabase.rpc("order_schedule", { p_order: id, p_date: date, p_note: note || null });
  if (error) back(id, "err", error.message);
  const sent = await sendScheduledNotice(s.supabase, id);
  back(
    id,
    sent.status === "sent" ? "msg" : "err",
    sent.status === "sent"
      ? "Scheduled, and the customer was emailed."
      : sent.status === "not_configured"
        ? "Scheduled. Email isn't set up yet, so the customer wasn't emailed. Let them know, then tap Customer Approved without Email."
        : `Scheduled, but the customer email didn't go out (${sent.error ?? sent.status}). Use Resend customer email, or let them know and tap Customer Approved without Email.`,
  );
}

export async function resendScheduledEmail(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const sent = await sendScheduledNotice(s.supabase, id);
  back(id, sent.status === "sent" ? "msg" : "err", sent.status === "sent" ? "Customer emailed again." : `The email didn't go out (${sent.error ?? sent.status}).`);
}

/** Order desk, until email is set up: the customer knows the date (told by phone), so the missing email is fine. */
export async function notifyOverride(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const { error } = await s.supabase.rpc("order_notify_override", { p_order: id });
  if (error) back(id, "err", error.message);
  back(id, "msg", "Marked as approved by the customer without email. The order is ready to go out.");
}

/** CRM or warehouse: delivered / picked up, with the signed BOL (photo or scan) attached. */
export async function completeOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  // A change an admin hasn't approved yet: nothing goes out (0075).
  const { count: waiting } = await s.supabase.from("order_edits").select("id", { count: "exact", head: true }).eq("order_id", id).eq("admin_needed", true).is("admin_approved_at", null);
  if (waiting) back(id, "err", "Don't load this order: it was changed and an admin hasn't approved the change yet. Ask an admin to approve it on this page first.");
  const files = filesFrom(form);
  const fileErr = await addFiles(s, id, "bol", files);
  if (fileErr) back(id, "err", `The signed BOL wasn't saved: ${fileErr}`);
  // The AI reads the paperwork just added before anything closes: another order's slip stops it here.
  let checked = false;
  if (files.length && bolCheckReady()) {
    const r = await checkOrderBolNow(s.supabase, id);
    checked = r.ok;
    if (r.ok) {
      const bad = await wrongPages(s, id, files);
      if (bad) back(id, "err", `Nothing was closed. ${bad} Move it or remove it under Files, then add the right one. If the AI is wrong, tap the same button again.`);
    }
  }
  // Spray foam: the lots that really went on the truck (0069). A different one is saved as an item variance first.
  let moved = 0;
  for (const [k, v] of form.entries()) {
    const line = Number(k.startsWith("lot:") ? k.slice(4) : NaN);
    const lot = Number(v);
    if (!Number.isFinite(line) || !lot) continue;
    const { data, error: le } = await s.supabase.rpc("order_line_relot", { p_line: line, p_lot: lot, p_reason: null, p_at_pickup: true });
    if (le) back(id, "err", `Nothing was closed: ${le.message.replace(/^.*?ERROR:\s*/, "")}`);
    if (data !== null) moved += 1;
  }
  const { error } = await s.supabase.rpc("order_complete", { p_order: id });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "order completed");
  // 0082: the AI reads the signed BOL just attached (right order? signed? lots match?) once the page has moved on.
  if (files.length && bolCheckReady() && !checked) {
    try {
      after(async () => {
        try {
          await checkOrderBol(s.supabase, id);
        } catch {
          // read again from BOL review
        }
      });
    } catch {
      // not inside a request
    }
  }
  back(id, "msg", `Marked complete. The signed BOL is saved on the order.${moved ? ` ${moved} lot${moved === 1 ? "" : "s"} changed to what really went out (on the item variance table).` : ""}`);
}

/** Admins, after pickup or delivery: the lot (or brand) that really went out (0069). FOAM LOTS and the order follow. */
export async function fixLoadedLot(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const id = String(form.get("id") ?? "");
  const line = Number(form.get("line"));
  const lot = Number(form.get("lot"));
  const reason = String(form.get("reason") ?? "").trim();
  if (!line || !lot) back(id, "err", "Pick the lot that really went out.");
  const { data, error } = await s.supabase.rpc("order_line_relot", { p_line: line, p_lot: lot, p_reason: reason, p_at_pickup: false });
  if (error) back(id, "err", /order_line_relot|function/.test(error.message) && !/Say why|lot|admin/i.test(error.message) ? "This needs the 0069 database update first." : error.message);
  await kickForOrder(s.supabase, id, "lot corrected after pickup");
  back(id, "msg", `Corrected to lot ${data}. The drums moved between lots on FOAM LOTS (the spreadsheet updates in a moment), and the change is on the item variance table.`);
}

/** Admins, on a picked-up or shipped order: rebuild how many drums of each item came off each lot (0073). */
export async function rebuildLoaded(input: {
  id: string;
  /** Per item, each lot ({ lot }) or item counted by total ({ product }, 0078) and how many came off it. */
  items: { item: number; lots: ({ lot: number; qty: number } | { product: string; qty: number })[]; record_only?: boolean; below_zero?: boolean }[];
  reason: string;
  back?: string;
}): Promise<{ ok: false; error: string } | never> {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return { ok: false, error: "Only an admin can change what was loaded after pickup." };
  const id = String(input.id ?? "");
  const UUIDISH = /^[0-9a-f-]{36}$/i;
  const items = (input.items ?? []).map((it) => ({
    item: Number(it.item),
    ...(it.record_only === true ? { record_only: true } : {}),
    ...(it.below_zero === true ? { below_zero: true } : {}),
    lots: (it.lots ?? [])
      .map((l): { lot: number; qty: number } | { product: string; qty: number } | null => {
        const qty = Math.round(Number(l.qty) * 100) / 100;
        if (!Number.isFinite(qty) || qty <= 0) return null;
        if ("product" in l) return UUIDISH.test(String(l.product)) ? { product: String(l.product), qty } : null;
        return Number(l.lot) > 0 ? { lot: Number(l.lot), qty } : null;
      })
      .filter((l) => l !== null),
  }));
  const { data, error } = await s.supabase.rpc("order_relot_items", { p_order: id, p_items: items, p_reason: String(input.reason ?? "").slice(0, 300) });
  if (error) {
    if (/order_relot_items/.test(error.message)) return { ok: false, error: "This needs the 0073 database update first (Supabase > SQL Editor)." };
    // Before 0078 only lots of the same kind of product could be picked.
    if (/can't take the place of|invalid input syntax for type bigint/.test(error.message)) return { ok: false, error: "Picking any product needs the 0078 database update first (Supabase > SQL Editor)." };
    return { ok: false, error: error.message.replace(/^.*?ERROR:\s*/, "") };
  }
  await kickForOrder(s.supabase, id, "lots corrected after pickup");
  const n = Number(data) || 0;
  // From the BOL review page: back there, at this order.
  const review = typeof input.back === "string" && input.back.startsWith("/orders/bol-review") ? input.back : null;
  if (review) {
    const [path, hash] = review.split("#");
    revalidatePath("/orders/bol-review");
    redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(`Saved ${n === 1 ? "1 item" : `${n} items`}. FOAM LOTS and PENDING ORDERS update in a moment.`)}${hash ? `#${hash}` : ""}`);
  }
  back(id, "msg", `Saved. ${n === 1 ? "1 item" : `${n} items`} now show${n === 1 ? "s" : ""} the lots that really went out. FOAM LOTS and PENDING ORDERS update in a moment, and the change is on the item variance table.`);
}

/** Cancel an order with a reason. Its stock is released and the inventory sheet line is marked Cancelled. */
export async function cancelOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const { error } = await s.supabase.rpc("order_cancel", { p_order: id, p_reason: reason });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "order cancelled");
  back(id, "msg", "Order cancelled. Its stock is released.");
}

/** Admins: delete a cancelled order for good (test orders, mistakes). */
export async function deleteOrder(form: FormData) {
  const s = await getSession();
  if (!s?.profile || s.profile.role !== "admin") return;
  const id = String(form.get("id") ?? "");
  if (form.get("sure") !== "on") back(id, "err", "Tick the box to confirm, then delete.");
  const { data: no, error } = await s.supabase.rpc("order_delete", { p_order: id });
  if (error) back(id, "err", error.message);
  revalidatePath("/orders");
  revalidatePath("/orders/desk");
  revalidatePath("/orders/deleted");
  redirect(`/orders?msg=${encodeURIComponent(`${no} was deleted. It's saved in the Deleted orders log, so Jeremiah can put it back.`)}`);
}

/** The order keepers (Jeremiah): put a deleted order back, open again (or as cancelled, for the record). */
export async function restoreDeleted(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const log = String(form.get("log") ?? "");
  const reopen = form.get("reopen") !== "0";
  const { data: no, error } = await s.supabase.rpc("order_restore", { p_log: log, p_reopen: reopen });
  revalidatePath("/orders");
  revalidatePath("/orders/desk");
  revalidatePath("/orders/deleted");
  if (error) redirect(`/orders/deleted?err=${encodeURIComponent(error.message)}`);
  const { data: o } = await s.supabase.from("orders").select("id, branch_id").eq("order_no", Number(String(no).replace(/\D/g, ""))).maybeSingle<{ id: string; branch_id: string | null }>();
  if (o) await kickForOrder(s.supabase, o.id, "order put back");
  redirect(o ? `/orders/${o.id}?msg=${encodeURIComponent(`${no} is back${reopen ? " and open again; its stock is held again" : " (as cancelled)"}.`)}` : "/orders/deleted");
}


/** Item variance (admins, or the Item variance box): take a line's drums from a different lot (or another ISO brand). */
export async function changeLot(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const line = Number(form.get("line"));
  const lot = Number(form.get("lot"));
  const reason = String(form.get("reason") ?? "").trim();
  if (!line || !lot) back(id, "err", "Choose a lot.");
  const { data, error } = await s.supabase.rpc("order_variance_lot", { p_line: line, p_lot: lot, p_reason: reason || null });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "lot changed");
  back(id, "msg", `Lot changed to ${data} The spreadsheet updates in a moment.`.replace(/^Lot changed to ([^ .]+)(?=\s)/, "Lot changed to $1."));
}

/** Item variance: load a different product type than the one ordered (Summer / Winter, another product in the same category). */
export async function swapItem(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const item = Number(form.get("item"));
  const product = String(form.get("product") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!item || !product) back(id, "err", "Choose what to load instead.");
  const { data, error } = await s.supabase.rpc("order_item_swap", { p_item: item, p_product: product, p_reason: reason });
  if (error) back(id, "err", error.message);
  await kickForOrder(s.supabase, id, "item type changed");
  back(id, "msg", `Now loading ${data}. The change is saved on the item variance table.`);
}

/** An admin approves the changes to an order, confirming the QuickBooks invoice has them (0075). */
export async function approveOrderChange(form: FormData) {
  const s = await getSession();
  if (!s?.profile) return;
  const id = String(form.get("id") ?? "");
  if (s.profile.role !== "admin") back(id, "err", "Only an admin can approve changes to an order.");
  const { data, error } = await s.supabase.rpc("order_change_approve", {
    p_order: id,
    p_invoice_ok: form.get("invoice_ok") === "1",
    p_note: String(form.get("note") ?? "").slice(0, 500) || null,
  });
  if (error) back(id, "err", /order_change_approve|function/.test(error.message) && !/Tick|nothing|admin/i.test(error.message) ? "This needs the 0075 database update first." : error.message);
  back(id, "msg", `Change approved${Number(data) > 1 ? ` (${data} revisions)` : ""}. The order can be loaded and marked picked up or shipped out.`);
}

/** Change an order's details (0076): ship-to for staff who edit orders; everything for admins. No admin approval. */
export async function editOrderDetails(input: { id: string; set: Record<string, string | boolean | null>; note: string }): Promise<{ ok: false; error: string } | never> {
  const r = await detailsCore(input);
  if (!r.ok) return r;
  back(String(input.id ?? ""), r.kind, r.text);
}

/** One Save for all of Edit order: the details first (customer, ship-to, location, PO, dates), then the items and lots. */
export async function saveEditOrder(input: {
  id: string;
  note: string;
  details?: Record<string, string | boolean | null> | null;
  sheet?: { rows: SheetRow[]; belowZero?: boolean; recordOnly?: boolean } | null;
}): Promise<{ ok: false; error: string } | never> {
  const id = String(input.id ?? "");
  const hasDetails = Boolean(input.details && Object.keys(input.details).length);
  if (!hasDetails && !input.sheet) return { ok: false, error: "Nothing changed yet." };
  let first: string | null = null;
  if (hasDetails) {
    const d = await detailsCore({ id, set: input.details!, note: input.note });
    if (!d.ok) return d;
    first = d.text;
  }
  if (input.sheet) {
    const r = await sheetCore({ id, rows: input.sheet.rows, note: input.note, belowZero: input.sheet.belowZero, recordOnly: input.sheet.recordOnly });
    if (!r.ok) {
      // The details went in; say so, and what's still wrong with the items.
      if (first) back(id, "err", `${first} The items weren't saved: ${r.error}`);
      return r;
    }
    back(id, r.kind, first ? `${first} ${r.text}` : r.text);
  }
  back(id, "msg", first ?? "Saved.");
}

async function detailsCore(input: { id: string; set: Record<string, string | boolean | null>; note: string }): Promise<Saved> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !(s.profile.role === "admin" || can(s.profile, "ordering") || can(s.profile, "order_desk"))) {
    return { ok: false, error: "You don't have access to edit orders." };
  }
  const id = String(input.id ?? "");
  const set = Object.fromEntries(Object.entries(input.set ?? {}).filter(([, v]) => v !== undefined));
  if (!Object.keys(set).length) return { ok: false, error: "Nothing changed." };
  const { data, error } = await s.supabase.rpc("order_edit_details", { p_order: id, p_set: set, p_note: String(input.note ?? "").slice(0, 500) || null });
  if (error) {
    if (/order_edit_details/.test(error.message)) return { ok: false, error: "Editing order details needs the 0076 database update first (Supabase > SQL Editor)." };
    // The page lets a shipped order with no location get one (0084); the database needs that update too.
    if (/location and Ship from supplier can't be changed/.test(error.message) && set.branch_id) {
      const { data: o } = await s.supabase.from("orders").select("branch_id, status").eq("id", id).maybeSingle<{ branch_id: string | null; status: string }>();
      if (o && !o.branch_id && o.status === "completed") {
        return { ok: false, error: "The database needs update-0084 first: in Supabase > SQL Editor, run update-0084-location-on-orders-with-none.sql from the AMBITION App folder, then Save again." };
      }
    }
    return { ok: false, error: error.message.replace(/^.*?ERROR:\s*/, "") };
  }
  const r = (data ?? {}) as { changes?: DetailChange[]; restocked?: boolean; stage?: string; customer?: boolean; approval_pending?: boolean; scheduled?: boolean };
  const changes = detailsText(r.changes);
  if (r.restocked) await kickForOrder(s.supabase, id, "order moved");
  const by = s.profile.full_name ?? s.profile.email ?? "AMBIT staff";
  // The order desk hears about it once the order is in QuickBooks (before that, the new details are simply on the order).
  const desk = r.stage && r.stage !== "customer" && r.stage !== "needs_po" ? await sendDeskNotice(s.supabase, id, "details", changes, by) : null;
  const parts = [
    `Saved: ${changes.length === 1 ? changes[0] : `${changes.length} details changed`}.`,
    r.restocked ? "The stock it holds moved too (the spreadsheets update on the next sync)." : "",
    desk ? (desk.status === "sent" ? "The order desk was emailed to check the invoice." : "Tell the order desk so they can check the invoice (the email didn't go out).") : "",
    r.customer ? "Prices on the items didn't change: check them against the new customer's pricing." : "",
    r.customer && r.approval_pending ? "It's still waiting on the customer: resend the approval below so it goes to the new customer." : "",
    r.scheduled && !r.customer ? "It's already scheduled: if the customer needs the new details, resend the scheduled email." : "",
  ];
  return { ok: true, kind: "msg", text: parts.filter(Boolean).join(" ") };
}

/** 0076: the packing slip signed on a phone or iPad. Saves the signed slip as the BOL and marks the order picked up / shipped out. */
export async function signPackingSlip(input: {
  id: string;
  version: string;
  ambit_name: string;
  ambit_sig: string;
  customer_name: string;
  customer_company: string;
  truck: string;
  customer_sig: string;
  lots: number[];
}): Promise<{ ok: false; error: string } | never> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !(can(s.profile, "order_desk") || can(s.profile, "inventory"))) {
    return { ok: false, error: "Only the order desk or the warehouse can sign out an order." };
  }
  const id = String(input.id ?? "");
  const png = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length < 400000 ? v : "");
  const ambitSig = png(input.ambit_sig);
  const custSig = png(input.customer_sig);
  if (!ambitSig || !custSig) return { ok: false, error: "Both signatures are needed." };
  const doc = await loadOrderDoc(s.supabase, id, { picks: true });
  if (!doc) return { ok: false, error: "Order not found." };
  // The signed slip, as it was signed.
  const signedAt = new Date().toISOString();
  let pdf: Buffer;
  try {
    pdf = await renderPackingSlip(doc, {
      printedBy: s.profile.full_name ?? s.profile.email ?? null,
      signed: {
        signedAt,
        ambit: { name: String(input.ambit_name ?? "").trim().slice(0, 120), sig: ambitSig },
        customer: {
          name: String(input.customer_name ?? "").trim().slice(0, 120),
          company: String(input.customer_company ?? "").trim().slice(0, 120) || null,
          truck: String(input.truck ?? "").trim().slice(0, 60) || null,
          sig: custSig,
        },
      },
    });
  } catch (e) {
    return { ok: false, error: `The signed slip couldn't be made: ${e instanceof Error ? e.message : String(e)}` };
  }
  const path = `${id}/bol-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const up = await s.supabase.storage.from("order-files").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (up.error) return { ok: false, error: `The signed slip couldn't be saved (${up.error.message}). Try again.` };
  const { error } = await s.supabase.rpc("order_sign_slip", {
    p_order: id,
    p_version: String(input.version ?? ""),
    p: {
      ambit_name: input.ambit_name,
      ambit_sig: ambitSig,
      customer_name: input.customer_name,
      customer_company: input.customer_company,
      truck: input.truck,
      customer_sig: custSig,
      lots: (input.lots ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0),
    },
    p_path: path,
    p_file_name: signedSlipFileName(doc),
  });
  if (error) {
    await s.supabase.storage.from("order-files").remove([path]);
    return { ok: false, error: /order_sign_slip|order_slip_version/.test(error.message) ? "Signing on screen needs the 0076 database update first (Supabase > SQL Editor)." : error.message.replace(/^.*?ERROR:\s*/, "") };
  }
  await kickForOrder(s.supabase, id, "order completed");
  back(id, "msg", `Signed and marked ${doc.order.delivery_method === "pickup" ? "picked up" : "shipped out"}. The signed packing slip is saved on the order as its signed BOL.`);
}

// ------------------------------------------------------------------ the order's files (0087)

function toFiles(id: string, kind: "msg" | "err", text: string): never {
  revalidatePath(`/orders/${id}`);
  redirect(`/orders/${id}?do=files&${kind}=${encodeURIComponent(text)}`);
}

const needs0087 = (m: string) => /order_file_(remove|move)|function|schema cache/i.test(m) && !/raise|only|gone|already|found/i.test(m);

/** The pages just added that the AI says are another order's (or not paperwork): one sentence, or null. */
async function wrongPages(s: NonNullable<Awaited<ReturnType<typeof getSession>>>, id: string, added: { path: string }[]): Promise<string | null> {
  const { data } = await s.supabase.from("order_files").select("id, path").eq("order_id", id).eq("kind", "bol");
  const want = new Set(added.map((f) => f.path));
  const ids = ((data ?? []) as { id: number; path: string }[]).filter((f) => want.has(f.path)).map((f) => Number(f.id));
  const v = await orderFileVerdicts(s.supabase, id);
  const bad = ids.map((i) => v.get(i)).filter((x) => x && x.tone === "err");
  if (!bad.length) return null;
  const other = bad.find((x) => x!.belongsTo)?.belongsTo;
  if (other) {
    const { data: o } = await s.supabase.from("orders").select("company_name").eq("order_no", other).maybeSingle<{ company_name: string | null }>();
    return `The page you added looks like ORD-${other}${o?.company_name ? ` (${o.company_name})` : ""}, not this order.`;
  }
  return bad[0]!.text === "Not paperwork" ? "The photo you added isn't the signed paperwork." : "The page you added isn't this order's paperwork.";
}

/** Add signed paperwork (or an invoice) to any order, any time. The AI reads a signed BOL / packing slip straight away. */
export async function addOrderFiles(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const kind = form.get("kind") === "invoice" ? "invoice" : "bol";
  const files = filesFrom(form);
  if (!files.length) toFiles(id, "err", "Pick a file first.");
  const err = await addFiles(s, id, kind, files);
  if (err) toFiles(id, "err", `Not saved: ${err}`);
  if (kind === "bol" && bolCheckReady()) {
    const r = await checkOrderBolNow(s.supabase, id);
    if (r.ok) {
      const bad = await wrongPages(s, id, files);
      if (bad) toFiles(id, "err", `${bad} Move it or remove it below.`);
      toFiles(id, "msg", "Added. The AI checked it: it's this order's paperwork.");
    }
    try {
      after(async () => {
        try {
          if (r.late) await checkOrderBol(s.supabase, id);
        } catch {
          // BOL review reads it again
        }
      });
    } catch {
      // not inside a request
    }
    toFiles(id, "msg", r.late ? "Added. The AI is still reading it: look again in a minute." : "Added. The AI couldn't read it just now; BOL review reads it again later.");
  }
  toFiles(id, "msg", "Added.");
}

/** Take a wrong file off an order (kept in the log, never really lost). */
export async function removeOrderFile(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const file = Number(form.get("file"));
  const reason = String(form.get("reason") ?? "").trim();
  const { error } = await s.supabase.rpc("order_file_remove", { p_file: file, p_reason: reason || null });
  if (error) toFiles(id, "err", needs0087(error.message) ? "This needs database update 0087 first (Supabase > SQL Editor)." : error.message);
  if (bolCheckReady()) {
    try {
      after(async () => {
        try {
          await checkOrderBol(s.supabase, id);
        } catch {
          // read again from BOL review
        }
      });
    } catch {
      // not inside a request
    }
  }
  toFiles(id, "msg", "Removed from this order.");
}

/** Move a file to the order it really belongs to (by its ORD number). */
export async function moveOrderFile(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile)) return;
  const id = String(form.get("id") ?? "");
  const file = Number(form.get("file"));
  const no = Number(String(form.get("to") ?? "").replace(/\D/g, ""));
  if (!no) toFiles(id, "err", "Type the order number it belongs to, like 1240.");
  const { data: to } = await s.supabase.from("orders").select("id, order_no, company_name").eq("order_no", no).maybeSingle<{ id: string; order_no: number; company_name: string | null }>();
  if (!to) toFiles(id, "err", `ORD-${no} wasn't found.`);
  const { error } = await s.supabase.rpc("order_file_move", { p_file: file, p_to: to!.id, p_reason: String(form.get("reason") ?? "").trim() || null });
  if (error) toFiles(id, "err", needs0087(error.message) ? "This needs database update 0087 first (Supabase > SQL Editor)." : error.message);
  revalidatePath(`/orders/${to!.id}`);
  if (bolCheckReady()) {
    try {
      after(async () => {
        for (const o of [id, to!.id]) {
          try {
            await checkOrderBol(s.supabase, o);
          } catch {
            // read again from BOL review
          }
        }
      });
    } catch {
      // not inside a request
    }
  }
  toFiles(id, "msg", `Moved to ORD-${to!.order_no}${to!.company_name ? ` (${to!.company_name})` : ""}.`);
}
