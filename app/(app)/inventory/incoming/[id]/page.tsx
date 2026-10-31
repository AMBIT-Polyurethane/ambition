import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftRight, CircleAlert, CircleCheck, FileText, Sparkles } from "lucide-react";
import { requireActive } from "@/lib/session";
import { canReceive } from "@/lib/access";
import { dateShort, dateTime, plural } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { claudeReady } from "@/lib/ai/claude";
import { inventoryBranches } from "@/lib/widgets";
import { stockItems, vendorNames } from "@/lib/incoming";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { IncomingForm } from "@/components/incoming-forms";
import { ReceivingForm } from "@/components/inventory/receiving-form";
import { cancelIncoming } from "@/app/(app)/inventory/count-actions";

export const metadata = { title: "Receiving Report" };
export const dynamic = "force-dynamic";

type Line = { id: number; product_id: string; sku: string; name: string | null; unit: string | null; qty: number; received_qty: number | null; lot_no: string | null; mfg: string | null; exp: string | null; note: string | null };

/** One delivery: receive it (Receiving Report), or read the report once it's received. */
export default async function IncomingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!canReceive(profile)) redirect("/");
  const { data: d } = await supabase.from("inbound_deliveries").select("*").eq("id", Number(id)).maybeSingle();
  if (!d) notFound();
  const [{ data: lineRows }, branches, { data: b }] = await Promise.all([
    supabase.from("inbound_lines").select("*").eq("delivery_id", d.id).order("id"),
    inventoryBranches(supabase, profile),
    supabase.from("branches").select("name, state").eq("id", d.branch_id).maybeSingle<{ name: string; state: string }>(),
  ]);
  const lines = (lineRows ?? []) as Line[];
  const branchName = b ? `${b.name}, ${b.state}` : d.branch_id;
  const expected = d.status === "expected";
  const late = expected && d.expected_on < todayCentral();
  const files = (Array.isArray(d.files) ? d.files : []) as { path: string; name: string }[];
  const links = await Promise.all(
    files.map(async (f) => ({ ...f, url: (await supabase.storage.from("inventory-files").createSignedUrl(f.path, 3600)).data?.signedUrl ?? null })),
  );
  const [items, vendors] = expected ? await Promise.all([stockItems(supabase, d.branch_id), vendorNames(supabase)]) : [[], []];
  const transfer = d.transfer_id as number | null;

  return (
    <main className="shell">
      <TopBar
        title={expected ? d.vendor : "Receiving Report"}
        back={`/inventory/incoming?b=${d.branch_id}`}
        right={<span className={d.status === "received" ? "pill ok" : d.status === "cancelled" ? "pill grey" : late ? "pill warn" : "pill"}>{d.status === "received" ? "Received" : d.status === "cancelled" ? "Cancelled" : late ? "Late" : "On the way"}</span>}
      />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}

      {transfer ? (
        <Link href={`/inventory/transfers/${transfer}`} className="alert info small" style={{ textDecoration: "none" }}>
          <ArrowLeftRight size={16} style={{ flex: "none", marginTop: 2 }} />
          <span>Transfer T-{transfer} from another AMBIT location. The lots come with the drums. Open the transfer</span>
        </Link>
      ) : null}

      {expected ? (
        <>
          <section className="card">
            <dl className="kv" style={{ margin: 0 }}>
              <dt>To</dt><dd>{branchName}</dd>
              <dt>Expected</dt><dd>{dateShort(d.expected_on)}</dd>
              {d.ref ? (<><dt>Reference</dt><dd>{d.ref}</dd></>) : null}
              {d.note ? (<><dt>Note</dt><dd>{d.note}</dd></>) : null}
              <dt>Added by</dt><dd>{d.created_by_name ?? ""} · {dateTime(d.created_at)}</dd>
            </dl>
          </section>
          <div className="eyebrow">Receiving Report</div>
          <ReceivingForm
            branch={d.branch_id}
            branchName={branchName}
            items={items}
            today={todayCentral()}
            aiReady={claudeReady()}
            vendors={vendors}
            delivery={{
              id: d.id,
              vendor: d.vendor,
              transfer: Boolean(transfer),
              bol_no: d.bol_no,
              po_no: d.po_no,
              carrier: d.carrier,
              note: d.note,
              lines: lines.map((l) => ({ id: l.id, product_id: l.product_id, sku: l.sku, name: l.name, unit: l.unit, qty: Number(l.qty), lot_no: l.lot_no, mfg: l.mfg, exp: l.exp })),
            }}
          />
          {!transfer ? (
            <>
              <details className="card">
                <summary><b>Change this expected delivery</b></summary>
                <div style={{ marginTop: 12 }}>
                  <IncomingForm
                    items={items}
                    branches={branches.filter((x) => x.id === d.branch_id)}
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
          ) : null}
        </>
      ) : (
        <article className="card col recv-report" style={{ gap: 12 }}>
          <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
            <div className="col tight">
              <span className="eyebrow">Receiving Report · {branchName}</span>
              <b style={{ fontSize: 18 }}>{d.vendor}</b>
            </div>
            <span className="no-print"><PrintButton /></span>
          </div>
          <dl className="kv" style={{ margin: 0 }}>
            {d.bol_no ? (<><dt>BOL #</dt><dd>{d.bol_no}</dd></>) : null}
            {d.po_no ? (<><dt>PO #</dt><dd>{d.po_no}</dd></>) : null}
            {d.carrier ? (<><dt>Carrier</dt><dd>{d.carrier}</dd></>) : null}
            {d.ref ? (<><dt>Reference</dt><dd>{d.ref}</dd></>) : null}
            <dt>{d.status === "received" ? "Received" : "Status"}</dt>
            <dd>{d.status === "received" ? `${d.received_by_name ?? ""} · ${dateTime(d.received_at)}` : "Cancelled"}</dd>
            {d.note ? (<><dt>Note</dt><dd>{d.note}</dd></>) : null}
            {d.read_by_ai ? (<><dt>BOL</dt><dd className="row" style={{ gap: 4 }}><Sparkles size={13} /> Read by the app, checked by {d.received_by_name ?? "the receiver"}</dd></>) : null}
          </dl>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>SKU</th><th>Item</th><th>Lot #</th><th className="num">{transfer ? "Sent" : "On BOL"}</th><th className="num">Received</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const got = l.received_qty === null ? null : Number(l.received_qty);
                  const short = got !== null && got !== Number(l.qty);
                  return (
                    <tr key={l.id} className={short ? "hl" : ""}>
                      <td>{l.sku}</td>
                      <td>
                        {l.name}
                        {l.note ? <div className="tiny faint">{l.note}</div> : null}
                        {l.mfg || l.exp ? <div className="tiny faint">{l.mfg ? `Mfg ${dateShort(l.mfg)}` : ""}{l.mfg && l.exp ? " · " : ""}{l.exp ? `Exp ${dateShort(l.exp)}` : ""}</div> : null}
                      </td>
                      <td>{l.lot_no ?? ""}</td>
                      <td className="num">{Number(l.qty)}</td>
                      <td className="num"><b>{got === null ? "" : got}</b> {l.unit ? <span className="tiny faint">{plural(l.unit, got ?? 0)}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {links.length ? (
            <div className="col" style={{ gap: 6 }}>
              <span className="eyebrow">BOL and paperwork</span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {links.map((f) =>
                  f.url ? (
                    <a key={f.path} href={f.url} target="_blank" rel="noopener noreferrer" className="btn sm dark"><FileText size={15} /> {f.name}</a>
                  ) : (
                    <span key={f.path} className="pill grey">{f.name}</span>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </article>
      )}
    </main>
  );
}
