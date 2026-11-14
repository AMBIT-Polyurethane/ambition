import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Copy, FileText } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { answer, files, isShown, str, visibleSteps, type Data } from "@/lib/forms/engine";
import { SPECS } from "@/lib/forms/specs";
import { STATUS_LABEL, type Sub } from "@/lib/forms/load";
import { dateTime } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { DecidePanel, Reveal } from "@/components/forms/decide";

export const dynamic = "force-dynamic";
export const metadata = { title: "Form" };

/** One submitted form: every answer, files, signatures, the score, and the decision. */
export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireEmployee();
  const { data } = await supabase.from("form_submissions").select("*").eq("id", Number(id)).maybeSingle();
  if (!data) notFound();
  const s = data as Sub;
  const spec = SPECS[s.form_key];
  if (!spec) notFound();
  const d = s.data as Data;
  const [{ data: rev }, people, co] = await Promise.all([
    supabase.rpc("form_reviewer", { p_key: s.form_key }),
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
    s.company_id ? supabase.from("companies").select("id, name, terms").eq("id", s.company_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const who = new Map(((people.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  const reviewer = rev === true || (spec.group === "team" && str(d.manager) === profile.id);
  const seesSecrets = profile.role === "admin" || (profile.perms ?? []).includes("credit_check");
  const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.submitted;
  const sc = spec.score?.(d);
  const company = co.data as { id: string; name: string; terms: string | null } | null;

  return (
    <main className="shell wide">
      <TopBar title={`${spec.title}${s.ref_no ? ` · ${s.ref_no}` : ""}`} back="/forms" />
      <section className="cust-head">
        <div className="col" style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 6 }}><span className={`${st.pill} lg`}>{st.label}</span>{sc?.flags.map((f) => <span key={f} className="pill red">{f}</span>)}</div>
          <span className="small muted">{[spec.summary(d), s.submitted_name ? `from ${s.submitted_name}` : null, s.submitted_at ? dateTime(s.submitted_at) : null, s.for_day ? `for ${s.for_day}` : null].filter(Boolean).join(" · ")}</span>
          {company ? <Link href={`/customers/${company.id}`} className="small">Customer: {company.name}</Link> : null}
          {s.price_request_id ? <Link href={`/price-requests/n/${s.price_request_id}`} className="small">From price request #{s.price_request_id}</Link> : null}
          {s.decided_at ? <span className="small"><CircleCheck size={13} /> {st.label} by {s.decided_by_name} · {dateTime(s.decided_at)}{s.decision_note ? `: ${s.decision_note}` : ""}</span> : null}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {["draft", "sent", "submitted"].includes(s.status) && (s.created_by === profile.id || s.submitted_by === profile.id || reviewer) ? <Link href={`/forms/${s.form_key}?id=${s.id}`} className="btn sm dark">{s.form_key === "credit_app" && reviewer ? "Fill in AMBIT verification" : "Edit"}</Link> : null}
        </div>
      </section>

      {s.status === "sent" && s.public_token ? (
        <div className="alert small"><Copy size={16} /><span>Waiting on the customer. Their link: <code>/f/{s.public_token.slice(0, 6)}…</code> (works until {s.token_expires ? dateTime(s.token_expires) : "–"}).</span></div>
      ) : null}

      {sc ? (
        <section className="card col" style={{ gap: 8 }}>
          <div className="row between"><b>Score</b><b className={sc.pct >= 85 ? "ok-text" : sc.pct >= 60 ? "warn-text" : "red"} style={{ fontSize: 22 }}>{sc.pct}%</b></div>
          <div className="fx-score-parts">{sc.parts.map((p) => <span key={p.label} className="tiny"><b>{p.pts}</b>/{p.max} {p.label}</span>)}</div>
        </section>
      ) : null}

      {visibleSteps(spec, d, true).map((step) => {
        // Drop a sub-heading when nothing under it was filled in (an optional third reference, say).
        const rows = step.fields.filter((f) => f.t !== "note" && isShown(f, d)).filter((f, i, all) => {
          if (f.t !== "head") return true;
          const end = all.findIndex((g, j) => j > i && g.t === "head");
          return all.slice(i + 1, end < 0 ? undefined : end).some((g) => answer(g, d));
        });
        if (!rows.some((f) => f.t === "head" || answer(f, d))) return null;
        return (
          <section key={step.key} className="card col" style={{ gap: 6 }}>
            <b>{step.title}</b>
            <dl className="fx-dl">
              {rows.map((f) => {
                if (f.t === "head") return <div key={f.k} className="fx-dl-head">{f.text}</div>;
                const a = answer(f, d);
                if (!a) return null;
                let v: React.ReactNode = a;
                if (f.t === "staff") v = who.get(str(d[f.k])) ?? a;
                if (f.t === "customer") v = company?.name ?? a;
                if (f.t === "signature") v = <img src={str(d[f.k])} alt={`${f.label} signature`} className="fx-sig-img" />;
                if (f.t === "file") v = <span className="col tight">{files(d[f.k]).map((x) => <a key={x.path} href={`/forms/file?id=${s.id}&p=${encodeURIComponent(x.path)}`} target="_blank" rel="noreferrer"><FileText size={13} /> {x.name}</a>)}</span>;
                if (f.t === "secret") v = seesSecrets ? <Reveal id={s.id} field={f.k} masked={a} /> : a;
                return <div key={f.k}><dt>{f.label || "Agreed"}</dt><dd>{v}</dd></div>;
              })}
            </dl>
          </section>
        );
      })}

      {reviewer && spec.decide && s.status === "submitted" ? (
        <DecidePanel id={s.id} formKey={s.form_key} hasCompany={!!s.company_id} requested={str(d.credit_requested)} terms={company?.terms ?? ""} />
      ) : null}
    </main>
  );
}
