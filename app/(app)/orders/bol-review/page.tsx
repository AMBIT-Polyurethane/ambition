import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { dateShort, orderNo, qtyText } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { LoadedFix, type FixItem, type FixLot, type FixStockItem } from "@/components/loaded-fix";
import { fixStockList } from "@/lib/inventory/view";
import { loadFixItems } from "@/lib/order-doc/fix-items";
import { BolAuditRunner } from "@/components/bol-audit-runner";
import { bolsToCheck, loadBolFindings } from "@/lib/order-doc/bol-check";
import { bolLooksRight, recheckBol } from "./actions";

export const metadata = { title: "BOL review" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER = 8;

type O = { id: string; order_no: number; company_name: string | null; branch_id: string | null; completed_at: string | null; delivery_method: string };
type It = { id: number; order_id: string; sku: string; name: string; unit: string; qty: number; product_id: string | null };
type Ln = { order_item_id: number | null; order_id: string; sku: string; qty: number; lot_no: string | null; lot_id: number | null };
type F = { id: number; order_id: string; path: string; name: string | null; created_at: string };

/** Admins: every picked-up or shipped order next to its signed BOL / packing slip, with "Fix what went out" right
 *  there, so the lots in the app can be checked against what the warehouse wrote down, order by order. */
export default async function BolReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const page = Math.max(1, Number(sp.page) || 1);
  const one = Number(sp.o) || null;
  // 0082: what the AI read off every signed BOL. "Problems only" lists just the orders it found something wrong with.
  const [{ list: findings, ready: aiReady }, toCheck] = await Promise.all([loadBolFindings(supabase), bolsToCheck(supabase).catch(() => [])]);
  const findingOf = new Map(findings.map((f) => [f.order_id, f]));
  const flagged = findings.filter((f) => f.problems.length || f.status === "error");
  const onlyProblems = !one && sp.problems === "1";
  let q = supabase.from("orders").select("id, order_no, company_name, branch_id, completed_at, delivery_method", { count: "exact" }).eq("status", "completed");
  if (one) q = q.eq("order_no", one);
  if (onlyProblems) q = q.in("id", flagged.length ? flagged.map((f) => f.order_id) : ["00000000-0000-0000-0000-000000000000"]);
  const { data: oRows, count } = await q.order("order_no", { ascending: false }).range(one ? 0 : onlyProblems ? 0 : (page - 1) * PER, one ? 0 : onlyProblems ? 199 : page * PER - 1);
  const orders = (oRows ?? []) as O[];
  const ids = orders.map((o) => o.id);
  const [{ data: itRows }, { data: lnRows }, { data: fRows }] = await Promise.all([
    ids.length ? supabase.from("order_items").select("id, order_id, sku, name, unit, qty, product_id").in("order_id", ids).order("id") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("inventory_lines").select("order_item_id, order_id, sku, qty, lot_no, lot_id").in("order_id", ids).eq("state", "done").order("id") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("order_files").select("id, order_id, path, name, created_at").in("order_id", ids).eq("kind", "bol").order("id") : Promise.resolve({ data: [] }),
  ]);
  const items = (itRows ?? []) as It[];
  const lines = (lnRows ?? []) as Ln[];
  const files = (fRows ?? []) as F[];
  const signed = files.length ? ((await supabase.storage.from("order-files").createSignedUrls(files.map((f) => f.path), 60 * 60 * 3)).data ?? []) : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));

  // The "Fix what went out" panel for each order: spray foam items that went out by lot.
  const fixOf = new Map<string, FixItem[]>();
  await Promise.all(
    orders.map(async (o) => {
      const mine = items.filter((i) => i.order_id === o.id);
      // Every spray foam item, also ones with nothing recorded (older orders, 0083).
      fixOf.set(o.id, await loadFixItems(supabase, mine.map((i) => ({ ...i, product_id: i.product_id ?? null })), lines.filter((l) => l.order_id === o.id)));
    }),
  );

  // Items counted by total at each location, for "a different product went out" (0078).
  const stockAt = new Map<string, FixStockItem[]>();
  await Promise.all(
    [...new Set(orders.map((o) => (o as { branch_id?: string | null }).branch_id).filter((b): b is string => !!b))].map(async (b) => stockAt.set(b, await fixStockList(supabase, b))),
  );

  const pages = onlyProblems ? 1 : Math.max(1, Math.ceil((count ?? 0) / PER));
  const here = `/orders/bol-review?${one ? `o=${one}` : onlyProblems ? "problems=1" : `page=${page}`}`;
  return (
    <main className="shell wide">
      <TopBar title="BOL review" back="/orders" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="small muted" style={{ margin: 0 }}>
        Every picked-up or shipped order, newest first, next to the signed BOL the warehouse uploaded. Check the lots written on it against what the
        app recorded; if they&apos;re different, use Fix what went out under it.{one || onlyProblems ? "" : ` Page ${page} of ${pages}.`}
      </p>
      {aiReady && !one ? (
        <>
          <BolAuditRunner toCheck={toCheck.length} checked={findings.length} problems={flagged.length} />
          <div className="seg" role="tablist" aria-label="Show">
            <Link href="/orders/bol-review" className={onlyProblems ? "" : "on"}>Every order</Link>
            <Link href="/orders/bol-review?problems=1" className={onlyProblems ? "on" : ""}>Problems only · {flagged.length}</Link>
          </div>
        </>
      ) : !aiReady ? (
        <div className="alert warn small"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>The AI check of signed BOLs needs the 0082 database update first (Supabase &gt; SQL Editor).</span></div>
      ) : null}
      {onlyProblems && !orders.length ? <div className="alert ok small"><CircleCheck size={16} style={{ flex: "none", marginTop: 2 }} /><span>No problems found on the BOLs read so far.</span></div> : null}
      {orders.map((o) => {
        const mine = items.filter((i) => i.order_id === o.id);
        const docs = files.filter((f) => f.order_id === o.id);
        const fix = fixOf.get(o.id) ?? [];
        return (
          <section key={o.id} id={`o-${o.order_no}`} className="card col br-order" style={{ gap: 10 }}>
            <div className="row between wrap" style={{ gap: 8 }}>
              <b>
                <Link href={`/orders/${o.id}`}>{orderNo(o.order_no)}</Link> · {o.company_name ?? ""}
              </b>
              <span className="tiny faint">
                {(o.branch_id ?? "").toUpperCase()} · {o.delivery_method === "pickup" ? "picked up" : "shipped"} {o.completed_at ? dateShort(o.completed_at) : ""}
              </span>
            </div>
            <div className="br-recorded">
              <span className="tiny faint">Recorded in the app</span>
              {mine.map((it) => {
                const done = lines.filter((l) => l.order_item_id === it.id);
                const lots = new Map<string, number>();
                for (const l of done) lots.set(l.lot_no ? `${l.sku} · ${l.lot_no}` : `${l.sku} · no lot`, (lots.get(l.lot_no ? `${l.sku} · ${l.lot_no}` : `${l.sku} · no lot`) ?? 0) + Number(l.qty));
                return (
                  <div key={it.id} className="small">
                    <b>{qtyText(Number(it.qty), it.unit)}</b> {it.name} <span className="faint">({it.sku})</span>
                    {done.length ? (
                      <span> → {[...lots.entries()].map(([k, v]) => `${v} × ${k}`).join(" + ")}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {(() => {
              const f = findingOf.get(o.id);
              if (!docs.length) return null;
              if (!f) return <span className="tiny faint">Not read by AI yet.</span>;
              const err = f.problems.some((p) => p.tone === "err");
              const tone = f.status === "error" ? "warn" : err ? "err" : f.problems.length ? "warn" : "ok";
              return (
                <div className={`alert ${tone} small col`} style={{ alignItems: "stretch", gap: 6 }}>
                  <span>
                    <b>AI check:</b>{" "}
                    {f.status === "app_signed"
                      ? "signed on screen in the app."
                      : f.status === "error"
                        ? `couldn't read it (${f.error ?? "unknown"}).`
                        : f.ok_by_name
                          ? `marked looks right by ${f.ok_by_name}${f.ok_note ? ` (${f.ok_note})` : ""}.`
                          : f.problems.length
                            ? `${f.problems.length} problem${f.problems.length === 1 ? "" : "s"}${f.uploaders.length ? ` · attached by ${f.uploaders.join(", ")}` : ""}`
                            : "right order, signed, lots match."}
                  </span>
                  {f.problems.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {f.problems.map((p, i) => <li key={i}>{p.text}</li>)}
                    </ul>
                  ) : null}
                  <div className="row wrap" style={{ gap: 6 }}>
                    {f.problems.length || f.ok_by_name ? (
                      <form action={bolLooksRight}>
                        <input type="hidden" name="order" value={o.id} />
                        <input type="hidden" name="ok" value={f.ok_by_name ? "0" : "1"} />
                        <input type="hidden" name="back" value={`${here}#o-${o.order_no}`} />
                        <button type="submit" className="btn sm ghost">{f.ok_by_name ? "Undo looks right" : "Looks right (the AI got it wrong)"}</button>
                      </form>
                    ) : null}
                    <form action={recheckBol}>
                      <input type="hidden" name="order" value={o.id} />
                      <input type="hidden" name="back" value={`${here}#o-${o.order_no}`} />
                      <button type="submit" className="btn sm ghost">Read it again</button>
                    </form>
                  </div>
                </div>
              );
            })()}
            {docs.length ? (
              docs.map((f, i) => {
                const url = urlOf.get(f.path);
                if (!url) return <div key={f.id} className="alert err small">Couldn&apos;t open {f.name ?? "the file"}.</div>;
                return /\.pdf$/i.test(f.path) ? (
                  <iframe key={f.id} className="br-pdf" src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={`BOL ${i + 1} for ${orderNo(o.order_no)}`} loading="lazy" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={f.id} className="br-img" src={url} alt={`BOL ${i + 1} for ${orderNo(o.order_no)}`} loading="lazy" />
                );
              })
            ) : (
              <div className="alert warn small">No signed BOL uploaded.</div>
            )}
            {fix.length ? <LoadedFix orderId={o.id} items={fix} back={`${here}#o-${o.order_no}`} stock={stockAt.get((o as { branch_id?: string | null }).branch_id ?? "") ?? []} /> : null}
          </section>
        );
      })}
      {one || onlyProblems ? null : (
        <div className="row between">
          {page > 1 ? <Link className="btn sm dark" href={`/orders/bol-review?page=${page - 1}`}>Newer</Link> : <span />}
          {page < pages ? <Link className="btn sm dark" href={`/orders/bol-review?page=${page + 1}`}>Older</Link> : <span />}
        </div>
      )}
    </main>
  );
}
