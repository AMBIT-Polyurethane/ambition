import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Mail, MapPin, Phone } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canSalesAll, canSalesHub } from "@/lib/access";
import { todayCentral } from "@/lib/crm";
import { kmoney } from "@/lib/crm-shared";
import { CALL_COLS, gone, isDone, statusText, type Call, type CallLog } from "@/lib/calls-shared";
import { dateShort, dateTime } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { CallLogForm } from "@/components/sales/call-log-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call" };

const LABEL: Record<string, string> = { no_answer: "No answer", voicemail: "Left a voicemail", talked: "Talked", callback: "Call back", not_interested: "Not interested", wrong_number: "Wrong number", won: "Won" };

/** One call on a rep's list: who to call, what we know, and "How did it go?". */
export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const { supabase, profile } = await requireEmployee();
  if (!canSalesHub(profile)) redirect("/");
  const all = canSalesAll(profile);
  const { data } = await supabase.from("crm_calls").select(CALL_COLS).eq("id", Number(id)).maybeSingle();
  const c = data as Call | null;
  if (!c) notFound();
  const today = todayCentral();
  // The next open call on the same list and rep, in list order (priority first for win-back, state/city for cold leads).
  let nq = supabase.from("crm_calls").select("id, name, priority, sales_12mo, state, city, status").eq("list", c.list).not("status", "in", "(won,not_interested,wrong_number)").limit(2000);
  nq = c.rep_id ? nq.eq("rep_id", c.rep_id) : nq.is("rep_id", null);
  const [{ data: log }, { data: sibs }] = await Promise.all([
    supabase.from("crm_call_log").select("id, call_id, outcome, note, next_on, by_name, at").eq("call_id", c.id).order("at", { ascending: false }).limit(50),
    nq,
  ]);
  const PRI: Record<string, number> = { A: 0, B: 1, C: 2 };
  const order = ((sibs ?? []) as { id: number; name: string; priority: string | null; sales_12mo: number | null; state: string | null; city: string | null; status: string }[]).sort((a, b) =>
    c.list === "winback"
      ? (PRI[a.priority ?? ""] ?? 3) - (PRI[b.priority ?? ""] ?? 3) || Number(b.sales_12mo ?? 0) - Number(a.sales_12mo ?? 0)
      : (a.state ?? "").localeCompare(b.state ?? "") || (a.city ?? "").localeCompare(b.city ?? "") || a.name.localeCompare(b.name),
  );
  const at = order.findIndex((x) => x.id === c.id);
  const after = order.filter((x, i) => i > at && x.status === "new")[0] ?? order.filter((x, i) => i > at)[0] ?? null;
  const before = at > 0 ? order[at - 1] : null;
  const s = statusText(c);
  const phones = (c.phone ?? "").split(/[|,]/).map((p) => p.trim()).filter(Boolean);
  const emails = (c.email ?? "").split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const back = `/sales/calls${c.rep_id && c.rep_id !== profile.id && all ? `?rep=${c.rep_id}&` : "?"}tab=${c.list}`;

  return (
    <main className="shell crm">
      <TopBar title={c.list === "winback" ? "Win-back call" : "Cold lead"} back={back} />
      <div className="crm-head">
        <div className="col" style={{ gap: 6 }}>
          <span className="tiny faint" style={{ letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800 }}>
            {c.list === "winback" ? "Win-back" : "Cold lead"}{at >= 0 ? ` · ${at + 1} of ${order.length} still to work` : ""}{c.rep_name && all ? ` · ${c.rep_name}` : ""}
          </span>
          <h1 className="h1" style={{ margin: 0 }}>{c.name}</h1>
          <span className="row wrap" style={{ gap: 6 }}>
            {c.list === "cold"
              ? (c.source ?? "").split("+").map((x) => x.trim()).filter(Boolean).map((x) => <span key={x} className={`pill ${x === "BBB" ? "info" : "warn"}`}>{x}</span>)
              : c.priority ? <span className="pill red">Priority {c.priority}</span> : null}
            {c.kind_guess ? <span className="pill grey">{c.kind_guess}</span> : null}
            <span className={`pill ${s.tone}`}>{c.touches ? s.label : "Never called"}</span>
          </span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {before ? <Link href={`/sales/calls/${before.id}`} className="b2 quiet sm"><ArrowLeft size={15} aria-hidden /> Back one</Link> : null}
          {after ? <Link href={`/sales/calls/${after.id}`} className="b2 quiet sm">Next call <ArrowRight size={15} aria-hidden /></Link> : null}
        </div>
      </div>

      <div className="call-detail">
        <div className="col" style={{ gap: 16 }}>
          <section className="card2" aria-label="Who to call">
            <div className="card2-h"><b>Who to call</b></div>
            <div className="crm-pad">
              <dl className="call-dl">
                {c.contact_name ? <><dt>Contact</dt><dd>{c.contact_name}</dd></> : null}
                <dt>Phone</dt>
                <dd>{phones.length ? phones.map((p, i) => {
                  const num = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.exec(p)?.[0];
                  const d = num ? num.replace(/[^\d]/g, "") : "";
                  const shown = /^\d{10}$/.test(p) ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
                  return <span key={i} style={{ display: "block" }}>{num ? <a href={`tel:${d}`}><Phone size={13} aria-hidden /> {shown}</a> : p}</span>;
                }) : <span className="faint">None on file</span>}</dd>
                {emails.length ? <><dt>Email</dt><dd>{emails.map((e) => <a key={e} href={`mailto:${e}`} style={{ display: "block" }}><Mail size={13} aria-hidden /> {e}</a>)}</dd></> : null}
                <dt>Address</dt>
                <dd><MapPin size={13} aria-hidden className="faint" /> {[c.street, [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") || "None on file"}</dd>
                {c.list === "cold" ? <><dt>Found on</dt><dd>{c.source ?? "–"}</dd></> : null}
              </dl>
            </div>
          </section>
          {c.list === "winback" ? (
            <section className="card2" aria-label="Their history">
              <div className="card2-h"><b>Their history with AMBIT</b>{c.company_id && all ? <Link href={`/sales/customers/${c.company_id}`} className="small">Customer page <ArrowRight size={13} aria-hidden /></Link> : null}</div>
              <div className="crm-pad">
                <div className="call-facts">
                  <div><span className="l">Last order</span><b>{c.last_invoice ? dateShort(c.last_invoice) : "No date on file"}</b><span className="s">{c.last_invoice ? `${gone(c.last_invoice, today)} ago` : ""}</span></div>
                  <div><span className="l">Sales, last 12 months</span><b>{c.sales_12mo ? kmoney(c.sales_12mo) : "–"}</b><span className="s">from the win-back sheet</span></div>
                  <div><span className="l">Previous rep</span><b>{c.prev_rep ?? "–"}</b><span className="s">{c.company_id ? "Their price list is on file" : "Not linked to an A.I. customer"}</span></div>
                </div>
                {c.sheet_note ? <div className="alert warn small" role="note"><span>Note: {c.sheet_note}</span></div> : null}
                {c.company_id ? <Link href={`/order?smart=all&company=${c.company_id}`} className="b2 quiet sm" style={{ alignSelf: "flex-start" }}>Start an order for them</Link> : null}
              </div>
            </section>
          ) : null}
        </div>
        <div className="col" style={{ gap: 16 }}>
          <CallLogForm id={c.id} list={c.list} today={today} next={after ? `/sales/calls/${after.id}` : null} companyId={c.company_id} />
          <section className="card2" aria-label="History">
            <div className="card2-h"><b>Calls so far</b><span className="small faint">{c.touches}</span></div>
            <div className="crm-pad">
              {(log ?? []).length ? (
                <ul className="crm-acts">
                  {((log ?? []) as CallLog[]).map((l) => (
                    <li key={l.id}>
                      <span className="col tight">
                        <b className="small">{LABEL[l.outcome] ?? l.outcome}{l.next_on ? ` · call back ${dateShort(l.next_on)}` : ""}</b>
                        {l.note ? <span className="small">{l.note}</span> : null}
                        <span className="tiny faint">{l.by_name ?? "?"} · {dateTime(l.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>Not called yet. {isDone(c) ? "" : "Loaded from the call lists."}</p>
              )}
              {c.lead_id ? <Link href="/sales/pipeline" className="small">In the New-customer pipeline <ArrowRight size={13} aria-hidden /></Link> : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
