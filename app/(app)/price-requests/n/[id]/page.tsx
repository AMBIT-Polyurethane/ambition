import { notFound } from "next/navigation";
import Link from "next/link";
import { CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, dateTime, money } from "@/lib/format";
import { PR_STATUS, prRef, type PrLine, type PrRow } from "@/lib/price-requests";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { PriceDecision } from "@/components/price-decision";
import { withdrawPriceRequest } from "../../native-actions";

export const dynamic = "force-dynamic";

export default async function PriceRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const { supabase, profile } = await requireEmployee();
  const [{ data: r }, { data: lineRows }] = await Promise.all([
    supabase.from("price_requests").select("*").eq("id", Number(id)).maybeSingle(),
    supabase.from("price_request_lines").select("*").eq("request_id", Number(id)).order("id"),
  ]);
  if (!r) notFound();
  const req = r as PrRow;
  const lines = (lineRows ?? []) as PrLine[];
  const approver = can(profile, "prf_approve");
  const { data: floors } = approver ? await supabase.from("price_floors").select("product_id, floor").in("product_id", lines.map((l) => l.product_id).filter(Boolean) as string[]) : { data: [] };
  const floorOf = new Map(((floors ?? []) as { product_id: string; floor: number }[]).map((f) => [f.product_id, Number(f.floor)]));
  const off = (l: PrLine) => (l.list_price ? `${Math.round((1 - Number(l.requested_price) / Number(l.list_price)) * 1000) / 10}% under list` : "no list price");
  const st = PR_STATUS[req.status];
  return (
    <main className="shell">
      <TopBar title={prRef(req.id)} back={approver ? "/price-requests/approvals" : "/price-requests"} right={<PrintButton />} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <section className="card col" style={{ gap: 6 }}>
        <div className="row between" style={{ gap: 8 }}>
          <span className="eyebrow">Price request · {prRef(req.id)}</span>
          <span className={st.pill}>{st.label}</span>
        </div>
        <h2 style={{ margin: 0 }}>{req.company_id ? <Link href={`/admin/companies?q=${encodeURIComponent(req.company_name)}`}>{req.company_name}</Link> : `${req.company_name} (prospect)`}</h2>
        <span className="small muted">
          {req.rep_name} · {dateTime(req.created_at)}{req.contact ? ` · ${req.contact}` : ""}{req.valid_until ? ` · good through ${dateShort(req.valid_until)}` : ""}
        </span>
        {req.note ? <div className="alert small" style={{ margin: "4px 0 0" }}><span><b>Why:</b> {req.note}</span></div> : null}
        {req.decided_by_name ? <span className="small">Answered by <b>{req.decided_by_name}</b>{req.decided_at ? ` · ${dateTime(req.decided_at)}` : ""}{req.decision_note ? ` · ${req.decision_note}` : ""}</span> : null}
      </section>

      {approver && req.status === "pending" ? (
        <PriceDecision
          id={req.id}
          lines={lines.map((l) => ({ id: l.id, name: l.name, sku: l.sku, unit: l.unit, list: l.list_price === null ? null : Number(l.list_price), requested: Number(l.requested_price), volume: l.volume, status: l.status, approved: l.approved_price === null ? null : Number(l.approved_price), auto: l.auto, rule: l.rule, floor: l.product_id ? floorOf.get(l.product_id) ?? null : null }))}
        />
      ) : (
        <section className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="rr-table">
            <thead><tr><th>Product</th><th className="hide-sm">List</th><th>Asked</th><th>Approved</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td><b>{l.name}</b><br /><span className="tiny faint">{l.sku}{l.volume ? ` · ${l.volume}` : ""} · {off(l)}</span>{l.auto ? <><br /><span className="tiny" style={{ color: "var(--ok-text)" }}><Sparkles size={11} /> {l.rule}</span></> : null}</td>
                  <td className="hide-sm">{l.list_price !== null ? money(Number(l.list_price)) : "–"}</td>
                  <td>{money(Number(l.requested_price))}</td>
                  <td>{l.status === "approved" && l.approved_price !== null ? <b>{money(Number(l.approved_price))}</b> : l.status === "denied" ? <b className="red">No</b> : <span className="pill warn">Waiting</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {req.status === "pending" && req.created_by === profile.id ? (
        <form action={withdrawPriceRequest} className="no-print">
          <input type="hidden" name="id" value={req.id} />
          <Submit className="linkbtn small" pendingText="Withdrawing…">Withdraw this request</Submit>
        </form>
      ) : null}
    </main>
  );
}
