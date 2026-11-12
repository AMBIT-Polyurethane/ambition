import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftRight, CircleAlert, CircleCheck, FileText, Sparkles } from "lucide-react";
import { requireActive } from "@/lib/session";
import { canReceive, hubAllows } from "@/lib/access";
import { dateShort, dateTime, plural } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import { claudeReady } from "@/lib/ai/claude";
import { inventoryBranches } from "@/lib/widgets";
import { sameBol, stockItems, vendorNames } from "@/lib/incoming";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { IncomingForm } from "@/components/incoming-forms";
import { ReceivingForm } from "@/components/inventory/receiving-form";
import { PartialReceipt } from "@/components/inventory/partial-receipt";
import { cancelIncoming } from "@/app/(app)/inventory/count-actions";
import { approveReceiving, sendBackReceiving } from "@/app/(app)/inventory/hub-actions";

export const metadata = { title: "Receiving Report" };
export const dynamic = "force-dynamic";

type Line = { id: number; product_id: string; sku: string; name: string | null; unit: string | null; qty: number; received_qty: number | null; damaged_qty: number | null; lot_no: string | null; mfg: string | null; exp: string | null; note: string | null };

/** One delivery: receive it (Receiving Report), or read the report once it's received. */
export default async function IncomingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (!canReceive(profile)) redirect("/");
  const { data: d } = await supabase.from("inbound_deliveries").select("*").eq("id", Number(id)).maybeSingle();
  if (!d || !hubAllows(profile, d.branch_id)) notFound();
  const [{ data: lineRows }, branches, { data: b }] = await Promise.all([
    supabase.from("inbound_lines").select("*").eq("delivery_id", d.id).order("id"),
    inventoryBranches(supabase, profile),
    supabase.from("branches").select("name, state").eq("id", d.branch_id).maybeSingle<{ name: string; state: string }>(),
  ]);
  const lines = (lineRows ?? []) as Line[];
  const branchName = b ? `${b.name}, ${b.state}` : d.branch_id;
  const expected = d.status === "expected";
  const waiting = d.status === "submitted";
  const admin = profile.role === "admin";
  const late = expected && d.expected_on < todayCentral();
  const files = (Array.isArray(d.files) ? d.files : []) as { path: string; name: string }[];
  const links = await Promise.all(
    files.map(async (f) => ({ ...f, url: (await supabase.storage.from("inventory-files").createSignedUrl(f.path, 3600)).data?.signedUrl ?? null })),
  );
  // Partial receipts (0065): this report's follow-up (the rest of the PO), or the report this one is the rest of.
  const canPartial = !d.transfer_id && (d.status === "submitted" || d.status === "received") && d.partial !== undefined;
  const [items, vendors] = expected || (waiting && admin) || canPartial ? await Promise.all([stockItems(supabase, d.branch_id), vendorNames(supabase)]) : [[], []];
  const restRow = d.rest_id
    ? (await supabase.from("inbound_deliveries").select("id, status, expected_on, lines:inbound_lines(qty, sku)").eq("id", d.rest_id).maybeSingle()).data as
        | { id: number; status: string; expected_on: string; lines: { qty: number; sku: string }[] }
        | null
    : null;
  const restOf = d.rest_of
    ? ((await supabase.from("inbound_deliveries").select("id, po_no, bol_no, received_at, submitted_at").eq("id", d.rest_of).maybeSingle()).data as { id: number; po_no: string | null; bol_no: string | null; received_at: string | null; submitted_at: string | null } | null)
    : null;
  const formLines = lines.map((l) => ({
    id: l.id, product_id: l.product_id, sku: l.sku, name: l.name, unit: l.unit, qty: Number(l.qty),
    received_qty: l.received_qty === null ? null : Number(l.received_qty), damaged_qty: Number(l.damaged_qty ?? 0),
    lot_no: l.lot_no, mfg: l.mfg, exp: l.exp, note: l.note,
  }));
  const anyDamaged = lines.some((l) => Number(l.damaged_qty ?? 0) > 0);
  // Other reports here with the same BOL #: a truck sent twice, or another load on the same ticket.
  const twins = !expected && !d.transfer_id && d.bol_no && d.status !== "cancelled" ? await sameBol(supabase, d.branch_id, d.bol_no, d.id) : [];
  const saidNewLoad = /^Load \d+ on BOL/.test(String(d.note ?? ""));
  const transfer = d.transfer_id as number | null;

  return (
    <main className="shell">
      <TopBar
        title={expected ? d.vendor : "Receiving Report"}
        back={`/inventory/incoming?b=${d.branch_id}`}
        howTo={twins.length ? "loads-and-duplicates" : "receive-inventory"}
        right={<span className={d.status === "received" ? "pill ok" : d.status === "cancelled" ? "pill grey" : waiting || late ? "pill warn" : "pill"}>{d.status === "received" ? "Received" : d.status === "cancelled" ? "Cancelled" : waiting ? "Waiting for approval" : late ? "Late" : "On the way"}</span>}
      />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}

      {transfer ? (
        <Link href={`/inventory/transfers/${transfer}`} className="alert info small" style={{ textDecoration: "none" }}>
          <ArrowLeftRight size={16} style={{ flex: "none", marginTop: 2 }} />
          <span>Transfer T-{transfer} from another AMBIT location. The lots come with the drums. Open the transfer</span>
        </Link>
      ) : null}

      {restOf ? (
        <Link href={`/inventory/incoming/${restOf.id}`} className="alert warn small" style={{ textDecoration: "none" }}>
          <CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
          <span>
            <b>The rest of a partial order.</b> Part of {restOf.po_no ? `PO ${restOf.po_no}` : "this order"} came on Receiving Report #{restOf.id}
            {restOf.submitted_at ? ` (${dateShort(restOf.submitted_at)})` : ""}; this is what was still coming. Receive it here when it arrives.
          </span>
        </Link>
      ) : null}

      {expected && d.sent_back_note ? (
        <div className="alert warn" role="alert">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span><b>Sent back by {d.sent_back_by_name ?? "an admin"}:</b> {d.sent_back_note} Fix the report below and send it again. Nothing went into stock.</span>
        </div>
      ) : null}
      {waiting ? (
        <div className={`alert ${admin ? "warn" : "info"}`} role="status">
          <CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            {admin
              ? <>Sent by <b>{d.submitted_by_name ?? "the warehouse"}</b> · {dateTime(d.submitted_at)}. Check it against the BOL, then approve it: stock and {branchName}&apos;s spreadsheet update right away.</>
              : <>Waiting for an admin to approve it (sent by {d.submitted_by_name ?? "you"} · {dateTime(d.submitted_at)}). Nothing has gone into stock yet.</>}
          </span>
        </div>
      ) : null}

      {twins.length ? (
        <div className={`alert ${waiting ? "warn" : "info"} bol-again`} role={waiting ? "alert" : "status"}>
          <CircleAlert size={18} style={{ flex: "none", marginTop: 2 }} />
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            <b>Same BOL # ({d.bol_no}) as {twins.length === 1 ? "another report" : `${twins.length} other reports`} here</b>
            <ul className="bol-list">
              {twins.map((m) => (
                <li key={m.id}>
                  <Link href={`/inventory/incoming/${m.id}`}>#{m.id}</Link> {m.lines || "no lines"} · {m.status === "received" ? "received" : "waiting for approval"} {dateTime(m.at)}{m.by ? ` · ${m.by}` : ""}
                </li>
              ))}
            </ul>
            <span className="small">
              {waiting
                ? saidNewLoad
                  ? `${d.submitted_by_name ?? "The receiver"} marked this as a new load on the same ticket. Check the BOL photos: a new load has its own count written on the ticket. If it's the same truck as one above, cancel this report (bottom of the page).`
                  : "Check the BOL photos. If this is the same truck as one above, don't approve it: cancel this report (bottom of the page). If it's another load on the same ticket, approve it."
                : saidNewLoad
                  ? "Marked as a new load on the same ticket when it was sent."
                  : "One BOL # on several reports: either separate loads on one ticket, or the same truck received twice. If it's the same truck, tell an admin so the extra can be taken back out of stock."}
            </span>
          </div>
        </div>
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
            admin={admin}
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
              lines: d.sent_back_note ? formLines : formLines.map((l) => ({ ...l, received_qty: null, damaged_qty: 0 })),
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
            <dt>{d.status === "received" ? "Received" : waiting ? "Sent by" : "Status"}</dt>
            <dd>
              {d.status === "received"
                ? `${d.received_by_name ?? ""} · ${dateTime(d.submitted_at ?? d.received_at)}`
                : waiting
                  ? `${d.submitted_by_name ?? ""} · ${dateTime(d.submitted_at)}`
                  : "Cancelled"}
            </dd>
            {d.status === "received" && d.approved_by_name ? (<><dt>Approved</dt><dd>{d.approved_by_name} · {dateTime(d.approved_at)}</dd></>) : null}
            {d.note ? (<><dt>Note</dt><dd>{d.note}</dd></>) : null}
            {d.read_by_ai ? (<><dt>BOL</dt><dd className="row" style={{ gap: 4 }}><Sparkles size={13} /> Read by the app, checked by {d.received_by_name ?? "the receiver"}</dd></>) : null}
          </dl>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>SKU</th><th>Item</th><th>Lot / Batch #</th><th className="num">{transfer ? "Sent" : "On BOL"}</th><th className="num">Received</th>{anyDamaged ? <th className="num">Damaged</th> : null}</tr>
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
                      {anyDamaged ? <td className="num">{Number(l.damaged_qty ?? 0) > 0 ? <b className="red">{Number(l.damaged_qty)}</b> : ""}</td> : null}
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
          {anyDamaged ? <p className="tiny faint" style={{ margin: 0 }}>Damaged items didn&apos;t go into stock.</p> : null}
        </article>
      )}

      {canPartial ? (
        <PartialReceipt
          id={d.id}
          lines={formLines}
          items={items}
          today={todayCentral()}
          rest={restRow ? { id: restRow.id, status: restRow.status, expected_on: restRow.expected_on, lines: (restRow.lines ?? []).map((l) => `${Number(l.qty)} ${l.sku}`).join(" · ") } : null}
        />
      ) : null}

      {waiting && admin ? (
        <section className="col no-print" style={{ gap: 10 }}>
          <form action={approveReceiving}>
            <input type="hidden" name="id" value={d.id} />
            <Submit className="btn block" pendingText="Approving…">Approve: add to stock</Submit>
          </form>
          <details className="card">
            <summary><b>Change something first</b> <span className="muted small">· fix a quantity, lot or date, then receive it</span></summary>
            <div style={{ marginTop: 12 }}>
              <ReceivingForm
                admin
                branch={d.branch_id}
                branchName={branchName}
                items={items}
                today={todayCentral()}
                aiReady={false}
                vendors={vendors}
                delivery={{ id: d.id, vendor: d.vendor, transfer: Boolean(transfer), bol_no: d.bol_no, po_no: d.po_no, carrier: d.carrier, note: d.note, lines: formLines }}
              />
            </div>
          </details>
          <details className="card">
            <summary><b>Send it back</b> <span className="muted small">· to {d.submitted_by_name ?? "the receiver"}, with what to fix</span></summary>
            <form action={sendBackReceiving} className="col" style={{ gap: 8, marginTop: 10 }}>
              <input type="hidden" name="id" value={d.id} />
              <input className="input sm" name="note" required minLength={3} placeholder="For example: lot # on line 2 doesn't match the drum label" />
              <Submit className="btn dark sm" pendingText="Sending…">Send back</Submit>
            </form>
          </details>
          {!transfer ? (
            <details className="danger-zone">
              <summary>Cancel this report</summary>
              <form action={cancelIncoming} className="col" style={{ gap: 10, marginTop: 10 }}>
                <input type="hidden" name="id" value={d.id} />
                <p className="tiny faint" style={{ margin: 0 }}>Nothing changes in stock.</p>
                <Submit className="btn sm danger" pendingText="Cancelling…">Cancel report</Submit>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
