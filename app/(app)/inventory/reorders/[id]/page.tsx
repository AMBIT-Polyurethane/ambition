import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { dateTime } from "@/lib/format";
import { purchasingContact, reorderRef } from "@/lib/inventory/reorder";
import { setReorderStatus } from "../../reorder-actions";

export const dynamic = "force-dynamic";

type Line = { id: number; sku: string; name: string; unit: string | null; qty: number; on_hand: number | null; available: number | null; reorder_point: number | null; sold_60: number | null };

export default async function ReorderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const { supabase, profile } = await requireEmployee();
  const [{ data: r }, { data: lineRows }, buyer] = await Promise.all([
    supabase.from("reorder_requests").select("*").eq("id", Number(id)).maybeSingle(),
    supabase.from("reorder_request_lines").select("id, sku, name, unit, qty, on_hand, available, reorder_point, sold_60").eq("request_id", Number(id)).order("id"),
    purchasingContact(supabase),
  ]);
  if (!r) notFound();
  const { data: br } = await supabase.from("branches").select("name, state").eq("id", r.branch_id).maybeSingle();
  const lines = (lineRows ?? []) as Line[];
  const n = (v: number | null) => (v === null || v === undefined ? "–" : Number.isInteger(Number(v)) ? String(Number(v)) : String(Math.round(Number(v) * 100) / 100));
  const isBuyer = profile.role === "admin" || profile.email.toLowerCase() === buyer.email.toLowerCase();
  const mine = r.requested_by === profile.id;
  const ref = reorderRef(r.id);

  return (
    <main className="shell">
      <TopBar title={ref} back={`/inventory/reorders?b=${r.branch_id}`} right={<PrintButton />} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="card col" style={{ gap: 6 }}>
        <div className="row between" style={{ gap: 8 }}>
          <span className="eyebrow">Reorder request · {ref}</span>
          <span className={`pill ${r.status === "open" ? "warn" : r.status === "ordered" ? "ok" : "grey"}`}>
            {r.status === "open" ? "Waiting on purchasing" : r.status === "ordered" ? "Ordered" : "Cancelled"}
          </span>
        </div>
        <h2 style={{ margin: 0 }}>{br ? `${br.name}, ${br.state}` : String(r.branch_id).toUpperCase()}</h2>
        <span className="small muted">
          Asked by <b>{r.requested_by_name}</b> · {dateTime(r.created_at)} · to {buyer.name}
          {r.email_status === "sent" ? " (emailed)" : r.email_status ? " (not emailed)" : ""}
        </span>
        {r.note ? <div className="alert small" style={{ margin: "4px 0 0" }}><span><b>Note:</b> {r.note}</span></div> : null}
        {r.status !== "open" && r.handled_by_name ? (
          <span className="small">
            {r.status === "ordered" ? "Ordered" : "Cancelled"} by <b>{r.handled_by_name}</b> · {dateTime(r.handled_at)}
            {r.handled_note ? ` · ${r.handled_note}` : ""}
          </span>
        ) : null}
      </section>

      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="rr-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Order</th>
              <th className="hide-sm">In stock</th>
              <th>Available</th>
              <th className="hide-sm">Reorder at</th>
              <th>Sold 60 days</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td><b>{l.name}</b><br /><span className="tiny faint">{l.sku}</span></td>
                <td><b className="q">{n(l.qty)}</b> <span className="tiny faint">{l.unit}</span></td>
                <td className="hide-sm">{n(l.on_hand)}</td>
                <td>{n(l.available)}</td>
                <td className="hide-sm">{n(l.reorder_point)}</td>
                <td>{n(l.sold_60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny faint" style={{ margin: 0, padding: "8px 12px 12px" }}>In stock, Available and Reorder at are as they were when the request was sent.</p>
      </section>

      {r.status === "open" && isBuyer ? (
        <section className="card col no-print" style={{ gap: 8 }}>
          <b>Ordered it?</b>
          <form action={setReorderStatus} className="col" style={{ gap: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value="ordered" />
            <input className="input sm" name="note" maxLength={500} placeholder="PO #, vendor, when it should arrive (optional)" aria-label="Note" />
            <Submit className="btn" pendingText="Saving…">Mark ordered</Submit>
          </form>
          <span className="tiny faint">Then add the truck under Receiving → Incoming deliveries so the warehouse knows it&apos;s coming.</span>
        </section>
      ) : null}
      {r.status === "open" && (isBuyer || mine) ? (
        <details className="no-print">
          <summary className="linkbtn small">Cancel this request</summary>
          <form action={setReorderStatus} className="col" style={{ gap: 8, marginTop: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value="cancelled" />
            <input className="input sm" name="note" maxLength={500} placeholder="Why (optional)" aria-label="Why" />
            <Submit className="btn dark sm" pendingText="Saving…">Cancel request</Submit>
          </form>
        </details>
      ) : null}
      {r.status !== "open" && isBuyer ? (
        <form action={setReorderStatus} className="no-print">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="status" value="open" />
          <Submit className="linkbtn small" pendingText="Saving…">Open it again</Submit>
        </form>
      ) : null}
    </main>
  );
}
