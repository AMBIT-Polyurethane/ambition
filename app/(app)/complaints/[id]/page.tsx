import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, Printer, Sparkles } from "lucide-react";
import { requireActive } from "@/lib/session";
import { can } from "@/lib/access";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { Markdown } from "@/components/assistant/markdown";
import { ComplaintPhotos } from "@/components/complaints/photos";
import { COMPLAINT_FIELDS, COMPLAINT_STATUS, SYMPTOMS, type Complaint } from "@/lib/complaints";
import { dateTime } from "@/lib/format";
import { deleteComplaint, saveComplaint, setComplaintStatus, submitComplaint } from "../actions";

export const metadata = { title: "Complaint report" };
export const dynamic = "force-dynamic";

export default async function ComplaintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, profile } = await requireActive();
  const { data } = await supabase.from("complaint_reports").select("*").eq("id", id).maybeSingle<Complaint>();
  if (!data) notFound();
  const r = data;
  const team = can(profile, "complaints") || profile.role === "admin";
  const editable = (r.status === "draft" && r.created_by === profile.id) || team;
  const signed = r.photos.length ? (await supabase.storage.from("photos").createSignedUrls(r.photos, 60 * 60)).data ?? [] : [];
  const photos = r.photos.map((p) => ({ path: p, url: signed.find((s) => s.path === p)?.signedUrl ?? null }));
  const st = COMPLAINT_STATUS[r.status] ?? COMPLAINT_STATUS.draft;
  const groups: { id: "who" | "product" | "conditions"; title: string }[] = [
    { id: "who", title: "Who and where" },
    { id: "product", title: "Product and job" },
    { id: "conditions", title: "Conditions when it was sprayed" },
  ];

  return (
    <main className="shell">
      <TopBar
        title={r.report_no ?? "Complaint report (draft)"}
        back="/complaints"
        right={<Link href={`/complaints/${r.id}/report`} className="btn sm dark" style={{ gap: 6 }}><Printer size={15} /> Print</Link>}
      />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={16} style={{ flex: "none", marginTop: 2 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 2 }} /><span>{sp.err}</span></div> : null}

      <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className={st.cls}>{st.label}</span>
        <span className="tiny faint">
          Started by {r.created_by_name ?? "someone"} · {dateTime(r.created_at)}
          {r.thread_id && r.created_by === profile.id ? <> · <Link href={`/assistant?t=${r.thread_id}`}>the Ask AMBIT conversation</Link></> : null}
        </span>
      </div>

      <section className="section">
        <div className="eyebrow">Photos</div>
        <ComplaintPhotos id={r.id} photos={photos} editable={editable} />
      </section>

      {r.ai_notes ? (
        <section className="card col" style={{ gap: 6 }}>
          <span className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center" }}><Sparkles size={14} /> What Ask AMBIT saw</span>
          <Markdown text={r.ai_notes} />
          <span className="tiny faint">From the photos and AMBIT&apos;s TSBs. Not a finding of cause; AMBIT reviews every report.</span>
        </section>
      ) : null}

      <form action={saveComplaint} className="col" style={{ gap: 16 }}>
        <input type="hidden" name="id" value={r.id} />
        {groups.map((g) => (
          <section key={g.id} className="card col" style={{ gap: 12 }}>
            <div className="eyebrow">{g.title}</div>
            <div className="ccr-grid">
              {COMPLAINT_FIELDS.filter((f) => f.group === g.id).map((f) => (
                <label key={String(f.key)} className={`field${f.wide ? " wide" : ""}`}>
                  <span className="label">{f.label}</span>
                  <input
                    className="input sm"
                    name={String(f.key)}
                    type={f.type === "date" ? "date" : "text"}
                    defaultValue={(r[f.key] as string | null) ?? ""}
                    disabled={!editable}
                  />
                </label>
              ))}
            </div>
          </section>
        ))}
        <section className="card col" style={{ gap: 12 }}>
          <div className="eyebrow">What&apos;s wrong</div>
          <div className="ccr-symptoms">
            {SYMPTOMS.map((s) => (
              <label key={s.id} className="check small">
                <input type="checkbox" name="symptoms" value={s.id} defaultChecked={r.symptoms.includes(s.id)} disabled={!editable} /> {s.label}
              </label>
            ))}
          </div>
          <label className="field">
            <span className="label">Describe it</span>
            <textarea className="textarea" name="description" rows={5} defaultValue={r.description ?? ""} disabled={!editable} placeholder="What the customer sees, when it started, how much of the job" />
          </label>
          {team ? (
            <label className="field">
              <span className="label">Ask AMBIT notes (AMBIT staff can edit)</span>
              <textarea className="textarea" name="ai_notes" rows={4} defaultValue={r.ai_notes ?? ""} />
            </label>
          ) : null}
        </section>

        {editable ? (
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <Submit className="btn dark" pendingText="Saving…">Save</Submit>
            {r.status === "draft" ? (
              <button formAction={submitComplaint} className="btn" type="submit">Submit to AMBIT</button>
            ) : null}
          </div>
        ) : null}
      </form>

      {r.status === "draft" && r.created_by === profile.id ? (
        <form action={deleteComplaint}>
          <input type="hidden" name="id" value={r.id} />
          <Submit className="linkbtn small" pendingText="…">Delete this draft</Submit>
        </form>
      ) : null}

      {team && r.status !== "draft" ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="eyebrow">AMBIT review</div>
          <form action={setComplaintStatus} className="col" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={r.id} />
            <select className="select sm" name="status" defaultValue={r.status}>
              <option value="submitted">Submitted</option>
              <option value="reviewing">Reviewing</option>
              <option value="closed">Closed</option>
            </select>
            <textarea className="textarea" name="resolution" rows={4} defaultValue={r.resolution ?? ""} placeholder="What AMBIT found and did (the contractor sees this)" />
            <Submit className="btn sm" pendingText="Saving…">Save review</Submit>
          </form>
          {r.closed_at ? <span className="tiny faint">Closed by {r.closed_by_name} · {dateTime(r.closed_at)}</span> : null}
        </section>
      ) : r.resolution ? (
        <section className="card col">
          <div className="eyebrow">AMBIT&apos;s review</div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.resolution}</p>
        </section>
      ) : null}
    </main>
  );
}
