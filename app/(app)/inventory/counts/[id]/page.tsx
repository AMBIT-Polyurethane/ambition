import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, CircleCheck, Pencil } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can, hubAllows } from "@/lib/access";
import { dateShort, dateTime } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { CountSheet } from "@/components/count-input";
import { approveCount, fixCount, rejectCount, submitCount } from "@/app/(app)/inventory/count-actions";

export const metadata = { title: "Inventory count" };

type Line = {
  id: number;
  product_id: string;
  sku: string;
  name: string | null;
  unit: string | null;
  lot_no: string | null;
  system_qty: number | null;
  counted_qty: number | null;
  counted_by_name: string | null;
  counted_at: string | null;
  note: string | null;
  applied: boolean;
  first_qty?: number | null;
  fixed_by_name?: string | null;
  fixed_at?: string | null;
  product: { category_id: string | null } | null;
};

const STATUS: Record<string, { label: string; pill: string }> = {
  open: { label: "Counting", pill: "pill warn" },
  matched: { label: "Approved", pill: "pill ok" },
  submitted: { label: "Waiting for approval", pill: "pill warn" },
  approved: { label: "Approved", pill: "pill ok" },
  rejected: { label: "Not approved", pill: "pill grey" },
};
const n = (v: number | null) => (v === null ? "–" : String(Number(v)));

/** A spot check or reconciliation: counting it (while open), or what was counted against what the app had. */
export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  const admin = profile.role === "admin";
  if (!admin && !can(profile, "inventory")) redirect("/");

  const { data: count } = await supabase.from("inventory_counts").select("*").eq("id", Number(id)).maybeSingle();
  if (!count || !hubAllows(profile, count.branch_id)) notFound();
  const [{ data: lineRows }, { data: cats }, { data: branch }] = await Promise.all([
    supabase.from("inventory_count_lines").select("*, product:products(category_id)").eq("count_id", count.id).order("id"),
    supabase.from("categories").select("id, name"),
    supabase.from("branches").select("name").eq("id", count.branch_id).maybeSingle<{ name: string }>(),
  ]);
  const lines = (lineRows ?? []) as Line[];
  const catName = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const spot = count.kind === "spot";
  const title = spot ? `Spot check · ${dateShort(count.day)}` : "Inventory reconciliation";
  const st = STATUS[count.status] ?? STATUS.open;
  const countedLines = lines.filter((l) => l.counted_qty !== null);
  const off = countedLines.filter((l) => Number(l.counted_qty) !== Number(l.system_qty ?? 0));
  const net = off.reduce((a, l) => a + Number(l.counted_qty) - Number(l.system_qty ?? 0), 0);
  // Admins can fix a counted number while the count waits for approval.
  const canFix = admin && count.status === "submitted";
  const auto = count.reviewed_by_name === "AMBIT A.I.";

  return (
    <main className="shell">
      <TopBar title={title} back={`/inventory/counts?b=${count.branch_id}`} right={<span className={st.pill}>{st.label}</span>} />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}
      <p className="small muted" style={{ margin: 0 }}>
        {branch?.name ?? count.branch_id}
        {count.started_by_name && !spot ? ` · started by ${count.started_by_name}, ${dateTime(count.started_at)}` : ""}
        {count.submitted_at ? ` · sent in by ${count.submitted_by_name ?? ""}, ${dateTime(count.submitted_at)}` : ""}
        {count.reviewed_at
          ? auto
            ? ` · approved automatically, ${dateTime(count.reviewed_at)}`
            : ` · ${count.status === "approved" ? "approved" : "reviewed"} by ${count.reviewed_by_name ?? ""}, ${dateTime(count.reviewed_at)}`
          : ""}
      </p>
      {count.review_note ? <div className="card small">{count.review_note}</div> : null}

      {count.status === "open" && !spot ? (
        <>
          <div className="card small col" style={{ gap: 6 }}>
            <b>How it works</b>
            <span>Count what&apos;s physically on the shelf for each item (spray foam lot by lot), including anything set aside for orders that haven&apos;t left yet. Each number saves as you type it, so you can stop and come back. Leave an item blank if you didn&apos;t count it; it won&apos;t change. When you&apos;re done, tap <b>Send for approval</b>: an admin checks the differences, and once approved they go onto the spreadsheet.</span>
          </div>
          <CountSheet
            countId={count.id}
            lines={lines.map((l) => ({ id: l.id, sku: l.sku, name: l.name, unit: l.unit, lot_no: l.lot_no, counted_qty: l.counted_qty === null ? null : Number(l.counted_qty), group: catName.get(l.product?.category_id ?? "") ?? "Other" }))}
          />
          <form action={submitCount} className="col" style={{ gap: 8 }}>
            <input type="hidden" name="id" value={count.id} />
            <Submit className="btn block" pendingText="Sending…">Send for approval</Submit>
            <span className="tiny faint center">Items left blank aren&apos;t changed.</span>
          </form>
        </>
      ) : count.status === "open" && spot ? (
        <div className="card small">This spot check hasn&apos;t been counted yet. Count it from Home or <Link href={`/inventory/spot?b=${count.branch_id}`}>Spot checks</Link>.</div>
      ) : (
        <>
          <div className="dash-tiles">
            <div className="dash-tile"><span className="l">Counted</span><span className="v">{countedLines.length}</span><span className="s">of {lines.length} {lines.length === 1 ? "line" : "lines"}</span></div>
            <div className={`dash-tile${off.length ? " warn" : ""}`}>
              <span className="l">Different from the app</span>
              <span className="v">{off.length ? <CircleAlert size={20} aria-hidden="true" /> : null}{off.length}</span>
              <span className="s">{off.length ? `Net ${net > 0 ? "+" : ""}${Number(net.toFixed(2))}` : "Everything matched"}</span>
            </div>
          </div>

          {admin && count.status === "submitted" ? (
            <section className="card col" style={{ gap: 10, borderColor: "var(--warn)" }}>
              <b>Approve these counts?</b>
              <span className="small muted">
                Approving changes stock by each difference below (TOTAL IN STOCK on the COUNT SHEET, or Adj on FOAM LOTS for spray foam) and records who counted it. Anything picked up since the count is already taken into account.
              </span>
              <span className="small muted">
                A number counted wrong (a display item missed, digits swapped)? Tap <b>Edit count</b> next to the item and type the right number first. If it then matches the app, it&apos;s approved automatically.
              </span>
              <form action={approveCount} className="col" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={count.id} />
                <input className="input sm" name="note" maxLength={500} placeholder="Note (optional)" aria-label="Note" />
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" className="btn sm approve">Approve</button>
                  <button type="submit" formAction={rejectCount} className="btn sm dark">Don&apos;t approve</button>
                </div>
              </form>
            </section>
          ) : count.status === "submitted" ? (
            <div className="alert warn small">Waiting for an admin to approve. Stock changes once it&apos;s approved.</div>
          ) : null}

          <div className="tbl-wrap">
            <table className="count-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">App had</th>
                  <th className="num">Counted</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {[...off, ...countedLines.filter((l) => !off.includes(l))].map((l) => {
                  const d = Number(l.counted_qty) - Number(l.system_qty ?? 0);
                  return (
                    <tr key={l.id}>
                      <td>
                        <b>{l.name ?? l.sku}</b>
                        <div className="tiny faint">
                          {l.sku}{l.lot_no ? ` · Lot ${l.lot_no}` : ""} · {l.counted_by_name ?? ""}{l.counted_at ? `, ${dateTime(l.counted_at)}` : ""}
                        </div>
                        {l.first_qty !== null && l.first_qty !== undefined ? (
                          <div className="tiny" style={{ color: "var(--warn-text, var(--text2))" }}>
                            Counted {n(l.first_qty)}, fixed to {n(l.counted_qty)} by {l.fixed_by_name ?? "an admin"}{l.fixed_at ? `, ${dateTime(l.fixed_at)}` : ""}
                            {l.note ? `: ${l.note}` : ""}
                          </div>
                        ) : l.note ? (
                          <div className="tiny faint">{l.note}</div>
                        ) : null}
                        {canFix ? (
                          <details className="fix-count">
                            <summary className="btn sm dark">
                              <span className="when-closed"><Pencil size={14} /> Edit count</span>
                              <span className="when-open">Cancel</span>
                            </summary>
                            <form action={fixCount} className="fix-form">
                              <input type="hidden" name="id" value={count.id} />
                              <input type="hidden" name="line" value={l.id} />
                              <label className="col tight">
                                <span className="tiny faint">Right count{l.unit ? ` (${l.unit})` : ""}</span>
                                <input className="input sm" name="qty" inputMode="decimal" required defaultValue={n(l.counted_qty)} aria-label={`Right count for ${l.sku}${l.lot_no ? ` lot ${l.lot_no}` : ""}`} style={{ width: 110 }} />
                              </label>
                              <label className="col tight grow" style={{ minWidth: 160 }}>
                                <span className="tiny faint">Why (optional)</span>
                                <input className="input sm" name="note" maxLength={300} placeholder="Missed the display item" />
                              </label>
                              <Submit className="btn sm" pendingText="Saving…">Save</Submit>
                            </form>
                          </details>
                        ) : null}
                      </td>
                      <td className="num">{n(l.system_qty)}</td>
                      <td className="num"><b>{n(l.counted_qty)}</b></td>
                      <td className={`num${d ? " off" : ""}`}>
                        {d ? <>{d > 0 ? "+" : "−"}{Math.abs(Number(d.toFixed(2)))}</> : <CircleCheck size={15} aria-label="Matches" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
