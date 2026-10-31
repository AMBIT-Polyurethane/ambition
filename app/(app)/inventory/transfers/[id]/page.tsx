import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, CircleCheck, Truck } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can, canReceive } from "@/lib/access";
import { dateShort, dateTime, plural } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { cancelTransfer } from "@/app/(app)/inventory/hub-actions";

export const metadata = { title: "Transfer" };
export const dynamic = "force-dynamic";

type Line = { id: number; sku: string; name: string | null; unit: string | null; qty: number; lot_no: string | null; mfg: string | null; exp: string | null };

/** One transfer: what went, from where to where, and where it is. Printable as the packing list. */
export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!can(profile, "transfers") && !canReceive(profile)) redirect("/");
  const { data: t } = await supabase.from("inventory_transfers").select("*").eq("id", Number(id)).maybeSingle();
  if (!t) notFound();
  const [{ data: lineRows }, { data: names }, { data: del }] = await Promise.all([
    supabase.from("inventory_transfer_lines").select("*").eq("transfer_id", t.id).order("id"),
    supabase.from("branches").select("id, name, state"),
    t.delivery_id ? supabase.from("inbound_lines").select("sku, lot_no, qty, received_qty").eq("delivery_id", t.delivery_id) : Promise.resolve({ data: [] }),
  ]);
  const lines = (lineRows ?? []) as Line[];
  const nm = new Map(((names ?? []) as { id: string; name: string; state: string }[]).map((b) => [b.id, `${b.name}, ${b.state}`]));
  const got = (del ?? []) as { sku: string; lot_no: string | null; qty: number; received_qty: number | null }[];
  const receivedOf = (l: Line) => {
    const m = got.find((g) => g.sku === l.sku && (g.lot_no ?? "") === (l.lot_no ?? ""));
    return m?.received_qty === null || m?.received_qty === undefined ? null : Number(m.received_qty);
  };

  return (
    <main className="shell">
      <TopBar
        title={`Transfer T-${t.id}`}
        back={`/inventory/transfers?b=${t.from_branch}`}
        right={<span className={t.status === "received" ? "pill ok" : t.status === "cancelled" ? "pill grey" : "pill"}>{t.status === "received" ? "Received" : t.status === "cancelled" ? "Cancelled" : "On the road"}</span>}
      />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}

      <article className="card col" style={{ gap: 12 }}>
        <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="col tight">
            <span className="eyebrow">AMBIT transfer · packing list</span>
            <b style={{ fontSize: 18 }}>{nm.get(t.from_branch) ?? t.from_branch} → {nm.get(t.to_branch) ?? t.to_branch}</b>
          </div>
          <span className="no-print"><PrintButton /></span>
        </div>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Sent</dt><dd>{t.created_by_name ?? ""} · {dateTime(t.created_at)}</dd>
          {t.arrive_on ? (<><dt>Gets there</dt><dd>{dateShort(t.arrive_on)}</dd></>) : null}
          {t.ref ? (<><dt>BOL / trailer</dt><dd>{t.ref}</dd></>) : null}
          {t.note ? (<><dt>Note</dt><dd>{t.note}</dd></>) : null}
          {t.received_at ? (<><dt>Received</dt><dd>{t.received_by_name ?? ""} · {dateTime(t.received_at)}</dd></>) : null}
          {t.cancelled_at ? (<><dt>Cancelled</dt><dd>{t.cancelled_by_name ?? ""} · {dateTime(t.cancelled_at)}</dd></>) : null}
        </dl>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>SKU</th><th>Item</th><th>Lot #</th><th className="num">Sent</th>{t.status === "received" ? <th className="num">Received</th> : null}</tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const r = receivedOf(l);
                return (
                  <tr key={l.id} className={r !== null && r !== Number(l.qty) ? "hl" : ""}>
                    <td>{l.sku}</td>
                    <td>{l.name}{l.mfg || l.exp ? <div className="tiny faint">{l.mfg ? `Mfg ${dateShort(l.mfg)}` : ""}{l.mfg && l.exp ? " · " : ""}{l.exp ? `Exp ${dateShort(l.exp)}` : ""}</div> : null}</td>
                    <td>{l.lot_no ?? ""}</td>
                    <td className="num"><b>{Number(l.qty)}</b> {l.unit ? <span className="tiny faint">{plural(l.unit, Number(l.qty))}</span> : null}</td>
                    {t.status === "received" ? <td className="num">{r ?? ""}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      {t.status === "in_transit" && t.delivery_id && canReceive(profile) ? (
        <Link href={`/inventory/incoming/${t.delivery_id}`} className="btn no-print" style={{ alignSelf: "flex-start" }}><Truck size={16} /> Receive it at {nm.get(t.to_branch) ?? t.to_branch}</Link>
      ) : null}
      {t.status === "in_transit" && can(profile, "transfers") ? (
        <details className="danger-zone no-print">
          <summary>Cancel this transfer</summary>
          <form action={cancelTransfer} className="col" style={{ gap: 10, marginTop: 10 }}>
            <input type="hidden" name="id" value={t.id} />
            <p className="tiny faint" style={{ margin: 0 }}>Only if it never left (or came back). The stock goes back on {nm.get(t.from_branch) ?? t.from_branch}&apos;s sheet and it comes off {nm.get(t.to_branch) ?? t.to_branch}&apos;s incoming.</p>
            <Submit className="btn sm danger" pendingText="Cancelling…">Cancel transfer</Submit>
          </form>
        </details>
      ) : null}
    </main>
  );
}
