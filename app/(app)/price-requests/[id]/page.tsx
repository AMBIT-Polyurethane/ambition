import Link from "next/link";
import { CircleAlert, CircleCheck, PencilLine } from "lucide-react";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateTime, jfDate } from "@/lib/format";
import { answerRows, prfPricing, prfStatus, priceRows, type PricePair } from "@/lib/jotform";
import { ownedPriceRequest } from "@/lib/prf-access";
import { savePrfApproval } from "../actions";

export const metadata = { title: "Price request" };
export const dynamic = "force-dynamic";

type Review = { approved_by_name: string | null; approved_at: string; note: string | null; email_status: string | null };

// A price request as a clean, filled-in form. Approvers (admins) can enter approved prices right here.
export default async function PriceRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, sub, item, mine, ownerName, approver } = await ownedPriceRequest(id);

  let pairs: PricePair[] = [];
  try {
    pairs = await prfPricing();
  } catch {
    pairs = [];
  }
  const { data: reviewRow } = await supabase.from("prf_reviews").select("approved_by_name, approved_at, note, email_status").eq("submission_id", id).maybeSingle<Review>();
  const review = reviewRow ?? null;

  const prices = priceRows(sub, pairs);
  const asked = prices.filter((r) => r.requested || r.approved);
  const others = prices.filter((r) => !r.requested && !r.approved && r.apprQid);
  const status = prfStatus(sub, pairs, Boolean(review));
  const skip = new Set(pairs.flatMap((p) => [p.reqQid, p.apprQid].filter(Boolean) as string[]));
  const rows = answerRows(sub, skip);
  const title = item.customer || item.contact || "Price request";

  // Group the other answers under their headings, two columns like the order form.
  const groups: { heading: string; rows: { label: string; value: string }[] }[] = [{ heading: "Request", rows: [] }];
  for (const r of rows) {
    if ("heading" in r) groups.push({ heading: r.heading.replace(/:$/, ""), rows: [] });
    else groups[groups.length - 1].rows.push(r);
  }

  return (
    <main className="shell">
      <TopBar title={title} back={approver && !mine ? "/price-requests/approvals" : "/price-requests"} />

      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="card col" style={{ gap: 6 }}>
        <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
          <div className="eyebrow">Price request</div>
          {status === "approved" ? <span className="pill ok">Approved</span> : status === "pending" ? <span className="pill warn">Waiting for approval</span> : <span className="pill grey">No prices asked</span>}
        </div>
        <div className="h2">{title}</div>
        <div className="small muted">
          {[item.customer && item.contact ? item.contact : null, mine ? "Your request" : ownerName || item.rep || "No rep picked"].filter(Boolean).join(" · ")}
        </div>
        <div className="tiny faint">
          Sent {jfDate(sub.created_at, true)}
          {sub.updated_at ? ` · Last edited ${jfDate(sub.updated_at, true)}` : ""}
        </div>
        {review ? (
          <div className="tiny faint">
            Prices approved by {review.approved_by_name} · {dateTime(review.approved_at)}
            {review.email_status && review.email_status !== "sent" ? " · rep wasn't emailed" : ""}
          </div>
        ) : null}
        {mine ? (
          <Link className="btn dark sm" href={`/price-requests/${id}/edit`} style={{ marginTop: 8, alignSelf: "flex-start" }}>
            <PencilLine size={15} /> Edit &amp; resubmit
          </Link>
        ) : null}
      </section>

      {/* Pricing: what the rep asked for, and what was approved */}
      <section className="section">
        <div className="eyebrow">Pricing</div>
        {pairs.length === 0 ? (
          <div className="alert warn small">Couldn&apos;t read the price boxes on the Jotform form.</div>
        ) : approver ? (
          <form action={savePrfApproval} className="col" style={{ gap: 12 }}>
            <input type="hidden" name="id" value={id} />
            <div className="list price-table">
              <div className="price-row head"><span>Product</span><span>Requested</span><span>Approved</span></div>
              {asked.length === 0 ? <div className="item small muted">The rep didn&apos;t ask for a price on any product.</div> : null}
              {asked.map((r) => (
                <div key={r.reqQid} className="price-row">
                  <span className="name"><b>{r.product}</b>{r.section ? <span className="tiny faint"> · {r.section}</span> : null}</span>
                  <span className="req">{r.requested || "-"}</span>
                  {r.apprQid ? (
                    <input className="input sm" name={`a_${r.apprQid}`} defaultValue={r.approved} inputMode="decimal" placeholder="$" aria-label={`Approved price for ${r.product}`} />
                  ) : (
                    <span className="tiny faint">No box</span>
                  )}
                </div>
              ))}
            </div>
            {others.length ? (
              <details className="card">
                <summary className="small"><b>Add a price for another product</b> <span className="muted">· {others.length}</span></summary>
                <div className="list price-table" style={{ marginTop: 10 }}>
                  {others.map((r) => (
                    <div key={r.reqQid} className="price-row">
                      <span className="name">{r.product}{r.section ? <span className="tiny faint"> · {r.section}</span> : null}</span>
                      <span className="req">-</span>
                      <input className="input sm" name={`a_${r.apprQid}`} defaultValue="" inputMode="decimal" placeholder="$" aria-label={`Approved price for ${r.product}`} />
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            <label className="field">
              <span className="label">Note to the rep (optional)</span>
              <textarea className="textarea" name="note" rows={2} defaultValue={review?.note ?? ""} placeholder="Terms, minimums, how long the pricing is good for…" />
            </label>
            <Submit className="btn block" pendingText="Saving…">{status === "approved" ? "Update & email rep" : "Approve & email rep"}</Submit>
            <p className="tiny faint center" style={{ margin: 0 }}>Saves into the Jotform request and emails {mine ? "you" : ownerName || item.rep || "the rep"}.</p>
          </form>
        ) : (
          <div className="list price-table">
            <div className="price-row head"><span>Product</span><span>Requested</span><span>Approved</span></div>
            {asked.length === 0 ? <div className="item small muted">No prices asked for.</div> : null}
            {asked.map((r) => (
              <div key={r.reqQid} className="price-row">
                <span className="name"><b>{r.product}</b></span>
                <span className="req">{r.requested || "-"}</span>
                <span className={r.approved ? "appr" : "tiny faint"} style={{ textAlign: "right" }}>{r.approved || (status === "approved" ? "Not approved" : "Waiting")}</span>
              </div>
            ))}
            {review?.note ? <div className="item small"><span><b>Note:</b> {review.note}</span></div> : null}
          </div>
        )}
      </section>

      {/* Everything else on the request */}
      {groups
        .filter((g) => g.rows.length)
        .map((g, i) => (
          <section key={i} className="section">
            <div className="eyebrow">{g.heading}</div>
            <div className="card">
              <dl className="kv wide" style={{ margin: 0 }}>
                {g.rows.map((r, j) => (
                  <div key={j} style={{ display: "contents" }}>
                    <dt>{r.label.replace(/[*:]+$/, "")}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        ))}
    </main>
  );
}
