import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, dateTime, money } from "@/lib/format";
import { inventoryBranches } from "@/lib/widgets";
import { loadHub } from "@/lib/inventory/hub";
import { loadVariances, type VarianceRow } from "@/lib/inventory/variances";
import { Empty, TopBar } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Variance report" };
export const dynamic = "force-dynamic";

const q = (v: number) => Number(v.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const signed = (v: number) => `${v > 0 ? "+" : "−"}${q(Math.abs(v))}`;

/** Every item whose last count didn't match the app and hasn't been approved: on screen and printable. */
export default async function VariancesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  if (profile.role !== "admin" && !can(profile, "inventory") && !can(profile, "inv_reports")) redirect("/");
  const live = await inventoryBranches(supabase, profile);
  if (!live.length) return <main className="shell"><TopBar title="Variance report" back="/inventory" /><Empty icon="boxes" title="No location has live inventory yet" /></main>;
  const pick = sp.b === "all" && live.length > 1 ? "all" : live.find((b) => b.id === sp.b)?.id ?? (live.length > 1 && !sp.b ? "all" : live[0].id);
  const scope = pick === "all" ? live.map((b) => b.id) : [pick];

  const [rows, hub] = await Promise.all([loadVariances(supabase, scope), loadHub(supabase, scope)]);
  const nameOf = (id: string) => live.find((b) => b.id === id)?.name ?? id.toUpperCase();
  const item = (r: VarianceRow) => hub.items.find((i) => i.branch === r.branch && i.product_id === r.productId);
  const nowIn = (r: VarianceRow) => {
    if (r.lotNo) {
      const lot = hub.lots.find((l) => l.branch === r.branch && l.sku === r.sku && l.lot_no === r.lotNo);
      return lot ? lot.remaining : null;
    }
    const i = item(r);
    return i ? i.on_hand : null;
  };
  const valueOf = (r: VarianceRow) => {
    const p = item(r)?.price;
    return p === null || p === undefined ? null : r.diff * p;
  };
  const waiting = rows.filter((r) => r.status === "submitted").length;
  const net = rows.reduce((a, r) => a + (valueOf(r) ?? 0), 0);
  const groups = scope.map((b) => ({ branch: b, rows: rows.filter((r) => r.branch === b) })).filter((g) => g.rows.length || pick !== "all");
  const title = pick === "all" ? "All locations" : nameOf(pick);

  return (
    <main className="shell wide">
      <div className="row no-print" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Link href={`/inventory/counts?b=${pick === "all" ? live[0].id : pick}`} className="btn sm dark"><ChevronLeft size={16} /> Counts</Link>
        <span className="grow" />
        <PrintButton label="Print / save PDF" />
      </div>
      {live.length > 1 ? (
        <div className="chips no-print" aria-label="Location">
          <Link href="/inventory/variances?b=all" className={`chip sm${pick === "all" ? " on" : ""}`}>All locations</Link>
          {live.map((b) => (
            <Link key={b.id} href={`/inventory/variances?b=${b.id}`} className={`chip sm${b.id === pick ? " on" : ""}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}

      <article className="paper">
        <header className="paper-head">
          <div className="col tight">
            <div className="paper-brand">AMBIT <span>INTELLIGENCE</span> <i>INVENTORY VARIANCE REPORT</i></div>
            <h1>{title}</h1>
            <div className="paper-sub">Items whose last count didn&apos;t match what the app had</div>
          </div>
          <dl className="paper-kv">
            <dt>Printed</dt><dd>{dateTime(new Date().toISOString())}</dd>
            <dt>By</dt><dd>{profile.full_name ?? profile.email}</dd>
            <dt>Items</dt><dd>{rows.length}</dd>
          </dl>
        </header>

        <div className="paper-tiles var-tiles">
          <div><b>{rows.length}</b><span>{rows.length === 1 ? "Item" : "Items"} with a variance</span></div>
          <div><b>{waiting}</b><span>Waiting for approval</span></div>
          <div><b>{rows.length - waiting}</b><span>Not approved</span></div>
          <div><b>{net < 0 ? `−${money(-net)}` : money(net)}</b><span>Net difference (value)</span></div>
        </div>

        {rows.length === 0 ? (
          <p className="paper-notes">No variances. Every item&apos;s last count matched the app, or its difference was approved.</p>
        ) : (
          groups.map((g) => (
            <section key={g.branch} className="col" style={{ gap: 6 }}>
              {pick === "all" ? <h2>{nameOf(g.branch)} · {g.rows.length} {g.rows.length === 1 ? "item" : "items"}</h2> : null}
              <div className="paper-table-wrap">
                <table className="paper-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 170 }}>Item</th>
                      <th style={{ minWidth: 120 }}>Counted</th>
                      <th className="r">App had</th>
                      <th className="r">Count</th>
                      <th className="r">Difference</th>
                      <th className="r">Value</th>
                      <th>Status</th>
                      <th className="r">In app now</th>
                      <th className="no-print" aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const v = valueOf(r);
                      const now = nowIn(r);
                      return (
                        <tr key={`${r.countId}-${r.productId}-${r.lotNo ?? ""}`}>
                          <td>
                            <span className="strong">{r.name}</span>
                            <div className="muted">{r.sku}{r.lotNo ? ` · Lot ${r.lotNo}` : ""}{r.unit ? ` · ${r.unit}` : ""}</div>
                            {r.firstQty !== null ? <div className="muted">Counted {q(r.firstQty)}, fixed by {r.fixedBy ?? "an admin"}</div> : null}
                          </td>
                          <td>
                            {dateShort(r.day)}
                            <div className="muted">{r.kind === "spot" ? "Spot check" : "Reconciliation"}{r.countedBy ? ` · ${r.countedBy}` : ""}</div>
                          </td>
                          <td className="r">{q(r.system)}</td>
                          <td className="r strong">{q(r.counted)}</td>
                          <td className="r strong">{signed(r.diff)}</td>
                          <td className="r">{v === null ? "—" : v < 0 ? `−${money(-v)}` : money(v)}</td>
                          <td>{r.status === "submitted" ? "Waiting for approval" : "Not approved"}</td>
                          <td className="r">{now === null ? "—" : q(now)}</td>
                          <td className="no-print"><Link href={`/inventory/counts/${r.countId}`}>Open</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}

        <p className="paper-foot">
          An item (spray foam lot by lot) is on this report when its most recent spot check or reconciliation didn&apos;t match what the app had, and the
          difference hasn&apos;t been approved: it&apos;s waiting for an admin, or an admin chose not to approve it. Approved differences are already in stock,
          so they aren&apos;t listed. Difference = count minus what the app had when it was counted. Value = difference × the item&apos;s value each (List value,
          else the COUNT SHEET Sell Price, else the catalog price). In app now = what the app has today.
        </p>
      </article>
    </main>
  );
}
