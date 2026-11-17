import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { can, hubLock } from "@/lib/access";
import { dateShort, orderNo, qtyText } from "@/lib/format";
import { loadOrderDoc } from "@/lib/order-doc/load";
import { foamLoads, pickText } from "@/lib/order-doc/loads";
import { STOP_TEXT, totalsText } from "@/lib/order-doc/packing-slip";
import { STAGES, stageOf } from "@/lib/order-desk";
import { TopBar } from "@/components/ui";
import { SlipSignForm, type SignRow } from "@/components/slip-sign-form";

export const metadata = { title: "Sign the packing slip" };
export const dynamic = "force-dynamic";

/** 0076: the packing slip on a phone or iPad. The AMBIT employee and the customer or driver sign with a finger. */
export default async function SignSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();
  if (!isEmployee(profile) || !(can(profile, "order_desk") || can(profile, "inventory"))) redirect(`/orders/${id}`);
  const doc = await loadOrderDoc(supabase, id, { picks: true });
  if (!doc) notFound();
  const o = doc.order;
  const no = orderNo(o.order_no);
  const pickup = o.delivery_method === "pickup";

  // Same rules as Mark picked up, plus: no change waiting for an admin, and a warehouse manager's own location.
  const [{ count: waiting }, ver] = await Promise.all([
    supabase.from("order_edits").select("id", { count: "exact", head: true }).eq("order_id", id).eq("admin_needed", true).is("admin_approved_at", null),
    supabase.rpc("order_slip_version", { p_order: id }),
  ]);
  const st = stageOf(o as Parameters<typeof stageOf>[0]);
  const lock = hubLock(profile);
  const stop =
    o.status === "completed" ? `This order was already ${pickup ? "picked up" : "shipped out"}.`
    : o.status === "cancelled" ? "This order was cancelled. Don't load anything."
    : o.delivery_method === "dropship" ? "This order ships from the supplier, so there's nothing to load here."
    : waiting ? "Don't load this order: it was changed and an admin hasn't approved the change yet."
    : st !== "scheduled" ? `Not ready to load yet (${st ? STAGES[st].label : "not scheduled"}).`
    : lock !== null && lock !== o.branch_id ? "Warehouse managers sign out orders at their own location only."
    : ver.error ? "Signing on screen needs the 0076 database update first (Supabase > SQL Editor)."
    : null;

  // The slip's lines, with each lot to load (the drums to check).
  const groups = foamLoads(doc.items);
  const rows: SignRow[] = groups.flatMap((g) =>
    g.rows.map((row) => ({
      key: `${row.item.id ?? row.item.sku}-${row.qty}`,
      sku: row.item.sku,
      name: row.item.name,
      qty: qtyText(row.qty, row.item.unit),
      lots: (row.picks ?? [])
        .filter((p) => p.state === "reserved")
        .map((p) => ({ id: p.id, qty: qtyText(p.qty, row.item.unit), text: pickText(p), check: p.lot_id !== null })),
    })),
  );
  const shipTo = pickup ? (doc.branch ? `${doc.branch.name}, ${doc.branch.state}` : "AMBIT") : o.ship_address ?? "";
  const pay = [o.pay_prepaid ? "Customer has already paid" : null, !o.pay_prepaid && o.pay_cod ? "COD only: collect payment first" : null, !o.pay_prepaid && o.pay_no_checks ? "No checks: cash or card only" : null].filter(Boolean) as string[];

  return (
    <main className="shell">
      <TopBar title={`Sign · ${no}`} back={`/orders/${id}`} />
      <section className="card col slip-head" style={{ gap: 8 }}>
        <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="col tight" style={{ minWidth: 0 }}>
            <span className="eyebrow">Packing slip{(o.revision ?? 1) > 1 ? ` · revision ${o.revision}` : ""}</span>
            <b className="slip-no">{no}</b>
            <span className="small">{o.company_name}{o.account_no ? ` · ${o.account_no}` : ""}</span>
          </div>
          <span className="pill ok">{pickup ? "Pickup" : "Delivery"}{o.scheduled_for ? ` · ${dateShort(o.scheduled_for)}` : ""}</span>
        </div>
        <dl className="kv slip-kv" style={{ margin: 0 }}>
          <dt>Sales Order #</dt><dd>{o.ambit_po ?? <span className="red">Not entered</span>}</dd>
          <dt>Invoice #</dt><dd>{o.invoice_no ?? <span className="red">Not entered</span>}</dd>
          {o.po_number ? (<><dt>Customer PO</dt><dd>{o.po_number}</dd></>) : null}
          <dt>{pickup ? "Pickup at" : "Ship to"}</dt><dd>{shipTo}</dd>
        </dl>
        {pay.map((p) => <div key={p} className={`alert ${o.pay_prepaid ? "ok" : "err"} small`}><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{p}</span></div>)}
      </section>

      {stop ? (
        <div className="alert err" role="alert">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>{stop} <Link href={`/orders/${id}`}>Back to the order</Link></span>
        </div>
      ) : (
        <SlipSignForm
          orderId={id}
          version={String(ver.data ?? "")}
          rows={rows}
          total={totalsText(doc.items)}
          notes={o.notes ?? null}
          stopText={STOP_TEXT}
          pickup={pickup}
          me={profile.full_name ?? ""}
        />
      )}
    </main>
  );
}
