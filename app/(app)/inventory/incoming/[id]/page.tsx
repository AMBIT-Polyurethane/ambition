import { notFound, redirect } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, dateTime, plural } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { inventoryBranches } from "@/lib/widgets";
import { stockItems, vendorNames } from "@/lib/incoming";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { IncomingForm, ReceiveForm } from "@/components/incoming-forms";
import { cancelIncoming } from "@/app/(app)/inventory/count-actions";

export const metadata = { title: "Incoming delivery" };

type Line = { id: number; product_id: string; sku: string; name: string | null; unit: string | null; qty: number; received_qty: number | null; lot_no: string | null; mfg: string | null; exp: string | null };

/** One incoming truck: what's on it, change it, receive it (or cancel it). */
export default async function IncomingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin" && !can(profile, "inventory")) redirect("/");
  const { data: d } = await supabase.from("inbound_deliveries").select("*").eq("id", Number(id)).maybeSingle();
  if (!d) notFound();
  const [{ data: lineRows }, { data: lots }, branches] = await Promise.all([
    supabase.from("inbound_lines").select("*").eq("delivery_id", d.id).order("id"),
    supabase.from("inventory_lots").select("product_id").eq("branch_id", d.branch_id),
    inventoryBranches(supabase, profile),
  ]);
  const lines = (lineRows ?? []) as Line[];
  const lotted = new Set(((lots ?? []) as { product_id: string }[]).map((l) => l.product_id));
  const branchName = branches.find((b) => b.id === d.branch_id)?.name ?? d.branch_id;
  const expected = d.status === "expected";
  const late = expected && d.expected_on < todayCentral();
  const [items, vendors] = expected ? await Promise.all([stockItems(supabase, d.branch_id), vendorNames(supabase)]) : [[], []];

  return (
    <main className="shell">
      <TopBar
        title={d.vendor}
        back={`/inventory/incoming?b=${d.branch_id}`}
        right={<span className={d.status === "received" ? "pill ok" : d.status === "cancelled" ? "pill grey" : late ? "pill warn" : "pill"}>{d.status === "received" ? "Received" : d.status === "cancelled" ? "Cancelled" : late ? "Late" : "On the way"}</span>}
      />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}
      <section className="card">
        <dl className="kv" style={{ margin: 0 }}>
          <dt>To</dt><dd>{branchName}</dd>
          <dt>Expected</dt><dd>{dateShort(d.expected_on)}</dd>
          {d.ref ? (<><dt>Reference</dt><dd>{d.ref}</dd></>) : null}
          {d.note ? (<><dt>Note</dt><dd>{d.note}</dd></>) : null}
          <dt>Added by</dt><dd>{d.created_by_name ?? ""} · {dateTime(d.created_at)}</dd>
          {d.received_at ? (<><dt>Received</dt><dd>{d.received_by_name ?? ""} · {dateTime(d.received_at)}</dd></>) : null}
        </dl>
      </section>

      {expected ? (
        <>
          <div className="eyebrow">When it arrives</div>
          <ReceiveForm deliveryId={d.id} lines={lines.map((l) => ({ id: l.id, sku: l.sku, name: l.name, unit: l.unit, qty: Number(l.qty), lots: lotted.has(l.product_id) }))} />
          <details className="card">
            <summary><b>Change this delivery</b></summary>
            <div style={{ marginTop: 12 }}>
              <IncomingForm
                items={items}
                branches={branches.filter((b) => b.id === d.branch_id)}
                vendors={vendors}
                initial={{ id: d.id, branch: d.branch_id, vendor: d.vendor, expected: d.expected_on, ref: d.ref ?? "", note: d.note ?? "", lines: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty) })) }}
              />
            </div>
          </details>
          <details className="danger-zone">
            <summary>Cancel this delivery</summary>
            <form action={cancelIncoming} className="col" style={{ gap: 10, marginTop: 10 }}>
              <input type="hidden" name="id" value={d.id} />
              <p className="tiny faint" style={{ margin: 0 }}>It comes off the calendar. Nothing changes in stock.</p>
              <Submit className="btn sm danger" pendingText="Cancelling…">Cancel delivery</Submit>
            </form>
          </details>
        </>
      ) : (
        <div className="list">
          {lines.map((l) => (
            <div key={l.id} className="item">
              <div className="grow">
                <div className="t">{l.sku}</div>
                <div className="s">{l.name}</div>
                {l.lot_no ? <div className="tiny faint">Lot {l.lot_no}{l.mfg ? ` · Mfg ${dateShort(l.mfg)}` : ""}{l.exp ? ` · Exp ${dateShort(l.exp)}` : ""}</div> : null}
              </div>
              <div style={{ textAlign: "right" }}>
                <b>{l.received_qty === null ? Number(l.qty) : Number(l.received_qty)}</b>
                <div className="tiny faint">{l.received_qty !== null && Number(l.received_qty) !== Number(l.qty) ? `of ${Number(l.qty)} expected` : l.unit ? plural(l.unit, Number(l.received_qty ?? l.qty)) : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
