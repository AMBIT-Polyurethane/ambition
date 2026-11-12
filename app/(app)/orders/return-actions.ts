"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, isEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { orderNo } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { kickSync } from "@/lib/inventory/sync";
import { placeOrder } from "@/app/(app)/order/actions";

// Returns and exchanges (0065). An exchange is a normal order for what goes out (the replacement), plus the items
// coming back; a return has only items coming back. Either way, when the items come back the warehouse receives
// them on a Receiving Report (with the lot and expiration of each one), so they go back into that location's stock.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NEEDS = "Returns and exchanges need the 0065 database update first. Ask Jeremiah to run it.";

export type BackLine = { product_id: string; qty: number; lot_no: string; mfg: string; exp: string; condition: "stock" | "damaged"; unit_credit: string; note: string };
export type ReturnInput = {
  kind: "return" | "exchange";
  branch: string;
  companyId: string;
  original: string | null;
  reason: string;
  delivery: "pickup" | "jobsite";
  address: string;
  back: BackLine[];
  out: { product_id: string; qty: number }[];
};

export async function createReturn(input: ReturnInput): Promise<{ ok: false; error: string } | { ok: true; id: string }> {
  const s = await getSession();
  if (!s?.profile || !isEmployee(s.profile) || !(can(s.profile, "ordering") || can(s.profile, "order_desk"))) return { ok: false, error: "You don't have access to ordering." };
  if (!/^[a-z]{2,8}$/.test(input.branch)) return { ok: false, error: "Pick the location." };
  if (!UUID.test(input.companyId)) return { ok: false, error: "Pick the customer." };
  const back = input.back.filter((l) => UUID.test(l.product_id) && Number(l.qty) > 0);
  if (!back.length) return { ok: false, error: "Add what's coming back (and how many)." };
  const out = input.out.filter((l) => UUID.test(l.product_id) && Number(l.qty) > 0);
  if (input.kind === "exchange" && !out.length) return { ok: false, error: "Add what goes out in exchange (or pick Return)." };
  if (input.delivery === "jobsite" && !input.address.trim()) return { ok: false, error: "Type the delivery address." };

  // Item names, for the note on the order.
  const ids = [...new Set([...back.map((l) => l.product_id), ...out.map((l) => l.product_id)])];
  const { data: prods } = await s.supabase.from("products").select("id, name, unit").in("id", ids);
  const nm = new Map(((prods ?? []) as { id: string; name: string; unit: string }[]).map((p) => [p.id, p]));
  const said = (l: { product_id: string; qty: number }) => `${Number(l.qty)} ${nm.get(l.product_id)?.name ?? "item"}`;
  const backText = back.map((l) => `${said(l)}${l.lot_no.trim() ? ` (lot ${l.lot_no.trim()})` : ""}${l.condition === "damaged" ? " [damaged]" : ""}`).join(", ");
  let origNo: number | null = null;
  let rep: string | null = null;
  let house = false;
  if (input.original && UUID.test(input.original)) {
    const { data: o } = await s.supabase.from("orders").select("order_no, sales_rep_id, house_account").eq("id", input.original).maybeSingle();
    origNo = o ? Number(o.order_no) : null;
    rep = (o?.sales_rep_id as string | null) ?? null;
    house = Boolean(o?.house_account);
  }
  if (!rep && !house) {
    const { data: c } = await s.supabase.from("companies").select("sales_rep_id, house_account").eq("id", input.companyId).maybeSingle();
    rep = (c?.sales_rep_id as string | null) ?? null;
    house = Boolean(c?.house_account) || !rep;
  }
  const note = [
    input.kind === "exchange" ? `EXCHANGE${origNo ? ` for ${orderNo(origNo)}` : ""}: coming back ${backText}. The customer pays the difference.` : `RETURN${origNo ? ` from ${orderNo(origNo)}` : ""}: ${backText}.`,
    input.reason.trim() ? `Reason: ${input.reason.trim()}` : "",
  ].filter(Boolean).join(" ");

  let id: string;
  if (input.kind === "exchange") {
    const placed = await placeOrder({
      items: Object.fromEntries(out.map((l) => [l.product_id, Number(l.qty)])),
      delivery: input.delivery,
      branchId: input.branch,
      address: input.address,
      po: "",
      neededBy: "",
      notes: note.slice(0, 2000),
      companyId: input.companyId,
      customerName: "",
      skipApproval: true,
      salesRep: rep ?? "house",
      repToCustomer: false,
    });
    if (!placed.ok) return { ok: false, error: placed.error };
    id = placed.id;
  } else {
    const { data, error } = await s.supabase.rpc("place_return_order", {
      p_branch: input.branch,
      p_company: input.companyId,
      p_customer_name: null,
      p_delivery: input.delivery,
      p_ship_address: input.address,
      p_notes: note.slice(0, 2000),
    });
    if (error) return { ok: false, error: /place_return_order|function|schema cache/i.test(error.message) ? NEEDS : error.message };
    id = String(data);
  }
  const { error } = await s.supabase.rpc("order_set_returns", {
    p_order: id,
    p_kind: input.kind,
    p_reason: input.reason.trim().slice(0, 500) || null,
    p_return_of: input.original && UUID.test(input.original) ? input.original : null,
    p_lines: back.map((l) => ({
      product_id: l.product_id,
      qty: Number(l.qty),
      lot_no: l.lot_no.trim(),
      mfg: DAY.test(l.mfg) ? l.mfg : "",
      exp: DAY.test(l.exp) ? l.exp : "",
      condition: l.condition,
      unit_credit: l.unit_credit.trim() && Number(l.unit_credit) >= 0 ? Number(l.unit_credit) : "",
      note: l.note.trim(),
    })),
  });
  if (error) return { ok: false, error: /order_set_returns|function|schema cache/i.test(error.message) ? NEEDS : `The order was made (${id.slice(0, 8)}), but the items coming back weren't saved: ${error.message}` };
  revalidatePath("/orders");
  return { ok: true, id };
}

/** The returned items came back: a Receiving Report (lots and dates filled in) puts them back into stock. */
export async function receiveReturn(form: FormData) {
  const s = await getSession();
  if (!s?.profile || !(can(s.profile, "receiving") || can(s.profile, "inventory"))) return;
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  const back = (kind: "msg" | "err", t: string): never => {
    revalidatePath(`/orders/${id}`);
    redirect(`/orders/${id}?${kind}=${encodeURIComponent(t)}`);
  };
  const [{ data: o }, { data: lines }] = await Promise.all([
    s.supabase.from("orders").select("order_no, company_name, branch_id, kind, return_reason").eq("id", id).maybeSingle(),
    s.supabase.from("order_returns").select("product_id, qty, lot_no, mfg, exp, condition, note").eq("order_id", id).is("inbound_id", null),
  ]);
  if (!o?.branch_id) back("err", "This order has no location to receive into.");
  const rows = (lines ?? []) as { product_id: string | null; qty: number; lot_no: string | null; mfg: string | null; exp: string | null; condition: string; note: string | null }[];
  if (!rows.length) back("err", "The returned items were already received.");
  const { data: rid, error } = await s.supabase.rpc("inbound_receive_report", {
    p_id: null,
    p_branch: o!.branch_id,
    p_head: {
      vendor: `Return: ${o!.company_name}`.slice(0, 120),
      po_no: orderNo(Number(o!.order_no)),
      note: `Returned items from ${o!.company_name} on ${orderNo(Number(o!.order_no))}${o!.return_reason ? ` (${o!.return_reason})` : ""}.`.slice(0, 500),
      received_on: todayCentral(),
      files: [],
    },
    p_lines: rows
      .filter((l) => l.product_id)
      .map((l) => ({
        product_id: l.product_id,
        qty: Number(l.qty),
        received_qty: l.condition === "damaged" ? 0 : Number(l.qty),
        damaged_qty: l.condition === "damaged" ? Number(l.qty) : 0,
        lot_no: l.lot_no ?? "",
        mfg: l.mfg ?? "",
        exp: l.exp ?? "",
        note: [l.condition === "damaged" ? "Damaged: not put back in stock" : "", l.note ?? ""].filter(Boolean).join(" · "),
      })),
  });
  if (error) back("err", error.message);
  await s.supabase.rpc("order_returns_received", { p_order: id, p_inbound: Number(rid) });
  kickSync(o!.branch_id as string, "return received");
  revalidatePath("/inventory", "layout");
  redirect(`/inventory/incoming/${Number(rid)}?msg=${encodeURIComponent(s.profile.role === "admin" ? "The returned items are back in stock." : "Receiving Report sent. Once an admin approves it, the returned items go back into stock.")}`);
}
