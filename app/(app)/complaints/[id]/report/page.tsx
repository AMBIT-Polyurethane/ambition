import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireActive } from "@/lib/session";
import { PrintButton } from "@/components/print-button";
import { Markdown } from "@/components/assistant/markdown";
import { COMPLAINT_FIELDS, COMPLAINT_STATUS, SYMPTOMS, type Complaint } from "@/lib/complaints";
import { dateShort, dateTime } from "@/lib/format";

export const metadata = { title: "Complaint report" };
export const dynamic = "force-dynamic";

export default async function ComplaintPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireActive();
  const { data } = await supabase.from("complaint_reports").select("*").eq("id", id).maybeSingle<Complaint>();
  if (!data) notFound();
  const r = data;
  const signed = r.photos.length ? (await supabase.storage.from("photos").createSignedUrls(r.photos, 60 * 60)).data ?? [] : [];
  const photos = r.photos.map((p) => signed.find((s) => s.path === p)?.signedUrl ?? null).filter((u): u is string => !!u);
  const st = COMPLAINT_STATUS[r.status] ?? COMPLAINT_STATUS.draft;
  const value = (k: keyof Complaint) => {
    const v = r[k] as string | null;
    if (!v) return "—";
    return k === "date_sprayed" ? dateShort(v) : v;
  };
  const groups: { id: "who" | "product" | "conditions"; title: string }[] = [
    { id: "who", title: "Who and where" },
    { id: "product", title: "Product and job" },
    { id: "conditions", title: "Conditions when it was sprayed" },
  ];

  return (
    <main className="shell wide to-report">
      <div className="row no-print" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link href={`/complaints/${r.id}`} className="btn sm dark"><ChevronLeft size={16} /> Back to the report</Link>
        <span className="grow" />
        <PrintButton label="Print / save PDF" />
      </div>

      <article className="paper">
        <header className="paper-head">
          <div className="col tight">
            <div className="paper-brand">AMBIT <span>INTELLIGENCE</span> <i>COMPLAINT REPORT</i></div>
            <h1>{r.report_no ?? "Draft"}</h1>
            <div className="paper-sub">{[r.product, r.company_name].filter(Boolean).join(" · ") || " "}</div>
          </div>
          <dl className="paper-kv">
            <dt>Status</dt><dd>{st.label}</dd>
            <dt>Started</dt><dd>{dateShort(r.created_at)}</dd>
            {r.submitted_at ? (<><dt>Submitted</dt><dd>{dateShort(r.submitted_at)}</dd></>) : null}
            <dt>By</dt><dd>{r.created_by_name ?? "—"}</dd>
            {r.closed_at ? (<><dt>Closed</dt><dd>{dateShort(r.closed_at)}</dd></>) : null}
          </dl>
        </header>

        {groups.map((g) => (
          <section key={g.id} className="col" style={{ gap: 6 }}>
            <h2>{g.title}</h2>
            <dl className="ccr-kv">
              {COMPLAINT_FIELDS.filter((f) => f.group === g.id).map((f) => (
                <div key={String(f.key)} className={f.wide ? "wide" : ""}>
                  <dt>{f.label}</dt>
                  <dd>{value(f.key)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section className="col" style={{ gap: 6 }}>
          <h2>What&apos;s wrong</h2>
          <p className="paper-notes" style={{ fontWeight: 700 }}>
            {r.symptoms.length ? r.symptoms.map((s) => SYMPTOMS.find((x) => x.id === s)?.label ?? s).join(" · ") : "No symptoms picked"}
          </p>
          {r.description ? <p className="paper-notes">{r.description}</p> : null}
        </section>

        {r.ai_notes ? (
          <section className="col" style={{ gap: 6 }}>
            <h2>What Ask AMBIT saw</h2>
            <div className="paper-notes ccr-ai"><Markdown text={r.ai_notes} /></div>
            <p className="paper-notes muted" style={{ fontSize: 12 }}>From the photos and AMBIT&apos;s TSBs. Not a finding of cause.</p>
          </section>
        ) : null}

        {photos.length ? (
          <section className="col" style={{ gap: 6 }}>
            <h2>Photos</h2>
            <div className="ccr-photos">
              {photos.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt={`Photo ${i + 1}`} />
              ))}
            </div>
          </section>
        ) : null}

        {r.resolution ? (
          <section className="col" style={{ gap: 6 }}>
            <h2>AMBIT&apos;s review</h2>
            <p className="paper-notes">{r.resolution}</p>
            {r.closed_by_name ? <p className="paper-notes muted" style={{ fontSize: 12 }}>{r.closed_by_name} · {r.closed_at ? dateTime(r.closed_at) : ""}</p> : null}
          </section>
        ) : null}

        <p className="paper-foot">AMBIT Polyurethane · Complaint report {r.report_no ?? "(draft)"} · Printed from AMBIT Intelligence</p>
      </article>
    </main>
  );
}
