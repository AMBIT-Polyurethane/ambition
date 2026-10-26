import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { CertForm } from "@/components/tax/cert-form";
import { companyTax } from "@/lib/tax-server";
import { CERT_KINDS, CERT_STATUS, TAX_STATE, taxLine, type CertRow } from "@/lib/tax";
import { dateShort, dateTime } from "@/lib/format";
import { decideCertificate, deleteCertificate, setTaxExempt } from "../actions";

export const metadata = { title: "Tax certificate" };
export const dynamic = "force-dynamic";

export default async function TaxCompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requirePerm("credit_check");
  const { data: company } = await supabase.from("companies").select("id, name, account_no, email, phone, state, tax_exempt").eq("id", id).maybeSingle();
  if (!company) notFound();
  const [tax, { data: certRows }] = await Promise.all([
    companyTax(supabase, id),
    supabase.from("tax_certificates").select("*").eq("company_id", id).order("created_at", { ascending: false }),
  ]);
  const certs = (certRows ?? []) as CertRow[];
  const files = certs.filter((c) => c.file_path).map((c) => c.file_path!);
  const signed = files.length ? (await supabase.storage.from("tax-certs").createSignedUrls(files, 60 * 30)).data ?? [] : [];
  const urlFor = (p: string | null) => (p ? signed.find((s) => s.path === p)?.signedUrl ?? null : null);
  const st = tax ? TAX_STATE[tax.state] : TAX_STATE.taxable;

  return (
    <main className="shell">
      <TopBar title={company.name} back="/tax" />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={16} style={{ flex: "none", marginTop: 2 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{sp.err}</span></div> : null}

      <div className="card col">
        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className={st.cls}>{st.label}</span>
          <span className="tiny faint">{company.account_no ?? ""}{company.state ? ` · ${company.state}` : ""}</span>
        </div>
        {tax ? <b>{taxLine(tax, dateShort)}</b> : null}
        {st.blocks ? (
          <span className="small" style={{ color: "var(--err-text)" }}>
            Orders from this customer wait at the credit check until a current certificate is verified.
          </span>
        ) : null}
        <form action={setTaxExempt} className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="company" value={company.id} />
          <input type="hidden" name="on" value={company.tax_exempt ? "no" : "yes"} />
          <span className="small muted">{company.tax_exempt ? "Marked tax-exempt." : "Not marked tax-exempt."}</span>
          <Submit className="btn sm dark" pendingText="…">{company.tax_exempt ? "Mark as not tax-exempt" : "Mark as tax-exempt"}</Submit>
        </form>
      </div>

      <section className="section">
        <div className="eyebrow">Certificates</div>
        {!certs.length ? <div className="alert info small">No certificates yet.</div> : null}
        {certs.map((c) => {
          const cs = CERT_STATUS[c.status] ?? CERT_STATUS.pending;
          const url = urlFor(c.file_path);
          return (
            <div key={c.id} className="card col" style={{ gap: 8 }}>
              <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
                <b>{c.state ?? ""} {CERT_KINDS.find((k) => k.id === c.kind)?.label ?? "Certificate"}{c.cert_number ? ` #${c.cert_number}` : ""}</b>
                <span className={cs.cls}>{cs.label}</span>
              </div>
              <span className="small muted">
                {c.issued_on ? `Issued ${dateShort(c.issued_on)} · ` : ""}
                {c.no_expiration ? "No expiration" : c.expires_on ? `Expires ${dateShort(c.expires_on)}` : "No expiration date entered"}
              </span>
              <span className="tiny faint">
                Added by {c.uploaded_by_name ?? "someone"}{c.uploaded_by_role === "customer" ? " (the customer)" : ""} · {dateTime(c.created_at)}
                {c.verified_by_name ? ` · ${c.status === "rejected" ? "turned down" : "verified"} by ${c.verified_by_name} ${dateTime(c.verified_at)}` : ""}
              </span>
              {c.note ? <span className="small">Note: {c.note}</span> : null}
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn sm dark" style={{ alignSelf: "flex-start", gap: 8 }}>
                  <ExternalLink size={15} /> Open {c.file_name ?? "the certificate"}
                </a>
              ) : null}
              {c.status === "pending" ? (
                <div className="col" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <form action={decideCertificate} className="col" style={{ gap: 8 }}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="company" value={company.id} />
                    <input type="hidden" name="decision" value="verify" />
                    <span className="tiny faint">Check the file matches, and fix the expiration date if needed:</span>
                    <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <input className="input sm" type="date" name="expires_on" defaultValue={c.expires_on ?? ""} aria-label="Expires" style={{ maxWidth: 180 }} />
                      <label className="check small"><input type="checkbox" name="no_expiration" defaultChecked={c.no_expiration} /> No expiration</label>
                    </div>
                    <Submit className="btn sm" pendingText="Verifying…">Verify certificate</Submit>
                  </form>
                  <details>
                    <summary className="linkbtn small">Turn it down</summary>
                    <form action={decideCertificate} className="col" style={{ gap: 8, marginTop: 8 }}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="company" value={company.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <input className="input sm" name="note" required placeholder="Why (the customer sees this)" />
                      <Submit className="btn sm dark" pendingText="…">Turn down</Submit>
                    </form>
                  </details>
                </div>
              ) : null}
              <details>
                <summary className="tiny faint" style={{ cursor: "pointer" }}>Remove…</summary>
                <form action={deleteCertificate} className="row" style={{ gap: 8, marginTop: 6 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="company" value={company.id} />
                  <Submit className="btn sm ghost" pendingText="…">Remove this certificate</Submit>
                </form>
              </details>
            </div>
          );
        })}
      </section>

      <details className="card" open={!certs.length}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Add a certificate</summary>
        <div style={{ marginTop: 12 }}>
          <CertForm companyId={company.id} asCustomer={false} defaultState={company.state} />
        </div>
      </details>
    </main>
  );
}
