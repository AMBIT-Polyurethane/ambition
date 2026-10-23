import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, Download, ExternalLink, FileText } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { dateTime, jfDate, money } from "@/lib/format";
import { jotformReady } from "@/lib/jotform";
import { KIND_LABEL, formSections, formSubmission, hubForm, jotformEditUrl, reviewable, summarize } from "@/lib/forms";
import { approveFormReview, clearFormReview, declineFormReview } from "../../actions";
import { SigImage } from "@/components/sig-image";
import { TERMS, reviewsFor } from "../../reviews";

export const metadata = { title: "Form submission" };
export const dynamic = "force-dynamic";

const fileHref = (u: string) => `/admin/forms/file?u=${encodeURIComponent(u)}`;

export default async function FormSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string; subId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { formId, subId } = await params;
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  if (!jotformReady()) notFound();

  const [form, sub] = await Promise.all([hubForm(formId), formSubmission(formId, subId)]);
  if (!form || !sub) notFound();
  const review = reviewable(form.kind);
  const rv = review ? (await reviewsFor(supabase, formId)).get(subId) ?? null : null;
  const { title, sub: subtitle } = summarize(sub);
  const sections = formSections(sub);
  const pdfHref = `/admin/forms/${formId}/${subId}/pdf`;

  const decisionForm = (
    <form action={approveFormReview} className="col" style={{ gap: 12 }}>
      <input type="hidden" name="form_id" value={formId} />
      <input type="hidden" name="id" value={subId} />
      <div className="grid2">
        <label className="field">
          <span className="label">Credit limit</span>
          <input className="input" name="credit_limit" inputMode="decimal" defaultValue={rv?.credit_limit ?? ""} placeholder="$ e.g. 25,000" />
        </label>
        <label className="field">
          <span className="label">Terms</span>
          <select className="select" name="terms" defaultValue={rv?.terms && TERMS.includes(rv.terms) ? rv.terms : ""}>
            <option value="">Pick terms</option>
            {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="label">Other terms (optional)</span>
        <input className="input" name="terms_other" defaultValue={rv?.terms && !TERMS.includes(rv.terms) ? rv.terms : ""} placeholder="Only if it isn't in the list" />
      </label>
      <label className="field">
        <span className="label">Note (optional)</span>
        <textarea className="textarea" name="note" rows={2} defaultValue={rv?.note ?? ""} placeholder="Conditions, references checked, why it was declined…" />
      </label>
      <div className="grid2">
        <button className="btn block approve" type="submit" formAction={approveFormReview}>Approve</button>
        <button className="btn dark block" type="submit" formAction={declineFormReview}>Decline</button>
      </div>
      <p className="tiny faint center" style={{ margin: 0 }}>Credit limit and terms are saved with an approval and print on the PDF.</p>
    </form>
  );

  return (
    <main className="shell">
      <TopBar title={title} back={`/admin/forms/${formId}`} />

      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="card col" style={{ gap: 6 }}>
        <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
          <div className="eyebrow">{form.title}</div>
          {review ? (
            rv?.status === "approved" ? <span className="pill ok">Approved</span> : rv?.status === "declined" ? <span className="pill red">Declined</span> : <span className="pill warn">Waiting</span>
          ) : null}
        </div>
        <div className="h2">{title}</div>
        {subtitle ? <div className="small muted">{subtitle}</div> : null}
        <div className="tiny faint">
          {form.kind === "other" ? "" : `${KIND_LABEL[form.kind]} · `}Sent {jfDate(sub.created_at, true)}
          {sub.updated_at ? ` · Last edited ${jfDate(sub.updated_at, true)}` : ""} · Ref {sub.id}
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
          <a className="btn sm" href={pdfHref} target="_blank" rel="noopener noreferrer"><Download size={15} /> Download PDF</a>
          <a className="btn dark sm" href={jotformEditUrl(sub.id)} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Edit in Jotform</a>
        </div>
      </section>

      {review ? (
        <section className="section">
          <div className="eyebrow">AMBIT decision</div>
          {rv ? (
            <div className="card col" style={{ gap: 10 }}>
              <dl className="kv wide" style={{ margin: 0 }}>
                <dt>Decision</dt>
                <dd><b className={rv.status === "approved" ? "" : "red"}>{rv.status === "approved" ? "Approved" : "Declined"}</b></dd>
                {rv.status === "approved" ? (
                  <>
                    <dt>Credit limit</dt>
                    <dd>{rv.credit_limit != null ? money(Number(rv.credit_limit)) : "Not set"}</dd>
                    <dt>Terms</dt>
                    <dd>{rv.terms ?? "Not set"}</dd>
                  </>
                ) : null}
                {rv.note ? (
                  <>
                    <dt>Note</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{rv.note}</dd>
                  </>
                ) : null}
                <dt>By</dt>
                <dd>{rv.reviewed_by_name} · {dateTime(rv.reviewed_at)}</dd>
              </dl>
              <details>
                <summary className="linkbtn small">Change the decision</summary>
                <div style={{ marginTop: 12 }}>{decisionForm}</div>
                <form action={clearFormReview} style={{ marginTop: 10 }}>
                  <input type="hidden" name="form_id" value={formId} />
                  <input type="hidden" name="id" value={subId} />
                  <button className="linkbtn tiny" type="submit">Clear the decision (back to waiting)</button>
                </form>
              </details>
            </div>
          ) : (
            <div className="card">{decisionForm}</div>
          )}
        </section>
      ) : null}

      {sections.map((sec, i) => (
        <section key={i} className="section">
          <div className="eyebrow">{sec.heading || (i === 0 ? "Submission" : "More")}</div>
          <div className="card">
            <dl className="kv wide" style={{ margin: 0 }}>
              {sec.fields.map((f) => (
                <div key={f.qid} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>
                    {f.signature ? (
                      <SigImage src={fileHref(f.signature)} label={f.label} />
                    ) : f.files ? (
                      <span className="col tight">
                        {f.files.map((x) => (
                          <a key={x.url} href={fileHref(x.url)} target="_blank" rel="noopener noreferrer" className="file-link">
                            <FileText size={14} /> {x.name}
                          </a>
                        ))}
                      </span>
                    ) : (
                      f.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}
    </main>
  );
}
