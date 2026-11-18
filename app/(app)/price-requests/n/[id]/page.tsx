import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { can } from "@/lib/access";
import { dateShort, dateTime, money, rate } from "@/lib/format";
import { PR_STATUS, prRef } from "@/lib/price-requests";
import { PRODUCT_LINES } from "@/lib/prf";
import { savedScore, type Line, type Req } from "@/lib/prf-score";
import { Submit } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { PriceDecision } from "@/components/price-decision";
import { ScoreCard } from "@/components/prf/score-card";
import { withdrawPriceRequest } from "../../native-actions";

export const dynamic = "force-dynamic";
// The quality score waits for the AI the first time a request is opened.
export const maxDuration = 60;

const KNOWN = new Set(["legal_name", "contact_first", "contact_last", "email", "phone", "street", "city", "state", "zip", "customer_type", "rigs", "monthly_sets", "current_mfr", "tax_ack", "wants_credit", "credit_requested"]);
const human = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const PILL: Record<string, string> = { pending: "warn", approved: "ok", partly: "warn", denied: "err", withdrawn: "" };

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
  const req = r as Req;
  const lines = (lineRows ?? []) as Line[];
  const approver = can(profile, "prf_approve");
  const [{ data: floors }, { data: branch }, score] = await Promise.all([
    approver ? supabase.from("price_floors").select("product_id, floor").in("product_id", lines.map((l) => l.product_id).filter(Boolean) as string[]) : Promise.resolve({ data: [] }),
    req.branch_id ? supabase.from("branches").select("name, state").eq("id", req.branch_id).maybeSingle<{ name: string; state: string }>() : Promise.resolve({ data: null }),
    approver ? savedScore(supabase, req.id) : Promise.resolve(null),
  ]);
  const floorOf = new Map(((floors ?? []) as { product_id: string; floor: number }[]).map((f) => [f.product_id, Number(f.floor)]));
  const off = (l: Line) => (l.list_price ? `${Math.round((1 - Number(l.requested_price) / Number(l.list_price)) * 1000) / 10}% under list` : null);
  const st = PR_STATUS[req.status];
  const cu = req.customer ?? {};
  const kindText = req.customer_kind === "new" ? "New customer" : req.customer_kind === "previous" ? "Past customer" : req.company_id ? "Existing customer" : "Prospect";

  // Everything the rep entered, in the order they entered it.
  const kv: { k: string; v: React.ReactNode; wide?: boolean }[] = [];
  const add = (k: string, v: React.ReactNode, wide = false) => {
    if (v !== null && v !== undefined && v !== "") kv.push({ k, v, wide });
  };
  add("Customer", <>{req.company_id ? <Link href={`/customers/${req.company_id}`}>{cu.legal_name || req.company_name}</Link> : cu.legal_name || req.company_name}<span className="faint"> · {kindText}</span></>);
  add("Contact", [cu.contact_first, cu.contact_last].filter(Boolean).join(" ") || req.contact);
  add("Phone", cu.phone ? <a href={`tel:${cu.phone}`}>{cu.phone}</a> : null);
  add("Email", cu.email ? <a href={`mailto:${cu.email}`}>{cu.email}</a> : null);
  add("Address", cu.street || cu.city ? `${cu.street ?? ""}\n${[cu.city, [cu.state, cu.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}`.trim() : null);
  add("Customer type", cu.customer_type);
  add("Foam rigs", cu.rigs);
  add("Sets a month", cu.monthly_sets);
  add("Buying from now", cu.current_mfr);
  add("Sales tax", cu.tax_ack);
  if (cu.wants_credit) add("Credit", /^yes/i.test(cu.wants_credit) ? `Wants terms${cu.credit_requested ? ` · ${money(Number(String(cu.credit_requested).replace(/[^\d.]/g, "")) || 0)} line` : ""}` : "No credit line (COD / prepay)");
  for (const [k, v] of Object.entries(cu)) if (!KNOWN.has(k) && typeof v === "string" && v.trim()) add(human(k), v);
  add("Product lines", (req.product_lines ?? []).map((k) => PRODUCT_LINES.find((p) => p.key === k)?.label ?? k).join(", "), true);
  add("Location", branch ? `${branch.name}, ${branch.state}` : req.branch_id?.toUpperCase());
  add("Sales rep", req.rep_name);
  add("Sent", dateTime(req.created_at));
  add("Good through", req.valid_until ? dateShort(req.valid_until) : null);
  add("Rep's note", req.note, true);
  if (req.decided_by_name) add("Answered", `${req.decided_by_name}${req.decided_at ? ` · ${dateTime(req.decided_at)}` : ""}${req.decision_note ? `\n${req.decision_note}` : ""}`, true);

  const details = (
    <section className="card2" aria-label="What the rep entered">
      <div className="card2-h"><b>Customer &amp; business</b></div>
      <dl className="kv2" style={{ margin: 0 }}>
        {kv.map((x) => (
          <div key={x.k} className={x.wide ? "wide" : undefined}>
            <dt>{x.k}</dt>
            <dd>{x.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const prices =
    approver && req.status === "pending" ? (
      <PriceDecision
        id={req.id}
        lines={lines.map((l) => ({ id: l.id, name: l.name, sku: l.sku, unit: l.unit, list: l.list_price === null ? null : Number(l.list_price), requested: Number(l.requested_price), volume: l.volume, status: l.status, approved: l.approved_price === null ? null : Number(l.approved_price), auto: l.auto, rule: l.rule, floor: l.product_id && (l.basis ?? "unit") === "unit" ? floorOf.get(l.product_id) ?? null : null }))}
      />
    ) : (
      <section className="card2" aria-label="Prices">
        <div className="card2-h"><b>Prices</b><span className="up2-sub">{lines.length} line{lines.length === 1 ? "" : "s"}</span></div>
        {lines.map((l) => (
          <div key={l.id} className="item2">
            <div className="item2-b">
              <span className="item2-n">{l.name}</span>
              <span className="tiny faint">{[l.quote_type ? null : l.sku, l.volume ? `Volume: ${l.volume}` : null, off(l)].filter(Boolean).join(" · ")}</span>
              {l.auto ? <span className="tiny" style={{ color: "var(--ok-text)" }}><Sparkles size={11} /> {l.rule}</span> : null}
            </div>
            <div className="item2-q">
              <span className="tiny faint">Asked {rate(Number(l.requested_price))}{l.unit ? ` / ${l.unit}` : ""}{l.list_price !== null ? ` · list ${money(Number(l.list_price))}` : ""}</span>
              {l.status === "approved" && l.approved_price !== null ? <b>{rate(Number(l.approved_price))}</b> : l.status === "denied" ? <b className="red">No</b> : <span className="pill2 warn">Waiting</span>}
            </div>
          </div>
        ))}
      </section>
    );

  return (
    <main className="shell wide">
      <div className="o2">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href={approver ? "/price-requests/approvals" : "/price-requests"} className="o2-back" aria-label="Back"><ChevronLeft size={20} /></Link>
            <div className="o2-title">
              <div className="row"><h1>{prRef(req.id)}</h1><span className={`pill2 ${PILL[req.status] ?? ""}`}>{st.label}</span></div>
              <span className="o2-sub">{req.company_name} · {req.rep_name ?? "AMBIT"} · {dateShort(req.created_at.slice(0, 10))}</span>
            </div>
          </div>
          <div className="o2-head-r no-print"><PrintButton /></div>
        </div>
        {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
        {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
        <div className="o2-cols side-first">
          <div className="o2-main">
            {details}
            {prices}
            {req.status === "pending" && req.created_by === profile.id ? (
              <form action={withdrawPriceRequest} className="no-print">
                <input type="hidden" name="id" value={req.id} />
                <Submit className="link2" pendingText="Withdrawing…">Withdraw this request</Submit>
              </form>
            ) : null}
          </div>
          {approver ? (
            <div className="o2-side">
              <ScoreCard id={req.id} initial={score} />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
