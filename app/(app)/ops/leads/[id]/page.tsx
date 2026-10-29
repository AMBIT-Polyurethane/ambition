import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight, Check, CheckCircle2, CircleAlert, CircleCheck, FileSignature, Mail, MapPin, MessageSquare, Phone, PhoneCall, StickyNote, Trash2, Trophy, XCircle,
} from "lucide-react";
import { requireOps, teamOf, locationsOf } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { CLOSED, stageName } from "@/lib/ops/defaults";
import { addressLine, mapsUrl, memberName, money0, phoneText, stageNote, type OpsLead, type OpsNote, type OpsProperty } from "@/lib/ops/crm";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateShort, dateTime } from "@/lib/format";
import { addNote, deleteLead, deleteNote, finishTask, moveLeadForm, updateLead } from "../../crm-actions";

export const metadata = { title: "Lead" };
export const dynamic = "force-dynamic";

const ICON = { note: StickyNote, call: PhoneCall, text: MessageSquare, email: Mail, task: CheckCircle2, stage: ArrowRight, system: StickyNote } as const;

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile, ws } = await requireOps(opsCan.crm);
  const { data: lead } = await supabase.from("ops_leads").select("*").eq("id", id).maybeSingle<OpsLead>();
  if (!lead) notFound();
  const [{ data: cust }, { data: props }, { data: noteRows }, team, locations] = await Promise.all([
    supabase.from("ops_customers").select("id, name, phone, phone2, email, kind, price_level").eq("id", lead.customer_id).maybeSingle(),
    supabase.from("ops_properties").select("*").eq("customer_id", lead.customer_id).order("created_at"),
    supabase.from("ops_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(200),
    teamOf(supabase, ws.company.id),
    locationsOf(supabase, ws.company.id),
  ]);
  const c = cust as { id: string; name: string; phone: string | null; phone2: string | null; email: string | null; kind: string; price_level: string } | null;
  const properties = (props ?? []) as OpsProperty[];
  const property = properties.find((p) => p.id === lead.property_id) ?? null;
  const notes = (noteRows ?? []) as OpsNote[];
  const tasks = notes.filter((n) => n.kind === "task");
  const timeline = notes.filter((n) => n.kind !== "task");
  const edit = opsCan.editCrm(ws.role);
  const s = ws.settings;
  const open = s.stages.filter((x) => x.key !== "lost");
  const at = open.findIndex((x) => x.key === lead.stage);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const reps = team.filter((m) => ["owner", "office", "sales", "dispatcher"].includes(m.ops_role ?? ""));
  const back = `/ops/leads/${id}`;
  const nameOf = (uid: string | null) => memberName(team.find((m) => m.id === uid)) || null;
  const nextStage = at >= 0 && at < open.length - 1 ? open[at + 1] : null;

  return (
    <main className="shell wide">
      <TopBar title={`Lead #${lead.number}`} back="/ops/pipeline" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <header className="col tight">
        <span className="eyebrow">{lead.title || (lead.services.length ? lead.services.join(" · ") : "Lead")}</span>
        <h1 className="h1" style={{ margin: 0 }}>{c?.name ?? "Customer"}</h1>
        <span className="small muted">{[addressLine(property), lead.source ? `from ${lead.source}` : null, `added ${dateShort(lead.created_at)}`].filter(Boolean).join(" · ")}</span>
      </header>

      {/* The straight path: where this lead is and the next step. */}
      <section className="ops-stepper" aria-label="Stage">
        {open.map((st, i) => {
          const done = lead.stage !== "lost" && at >= 0 && i < at;
          const here = st.key === lead.stage;
          const inner = (
            <>
              <span className="dot">{done ? <Check size={12} strokeWidth={3} /> : st.key === "won" ? <Trophy size={12} /> : i + 1}</span>
              <span className="nm">{st.name}</span>
            </>
          );
          return edit && !here ? (
            <form key={st.key} action={moveLeadForm} className={`ops-stp${done ? " done" : ""}`}>
              <input type="hidden" name="id" value={lead.id} />
              <input type="hidden" name="stage" value={st.key} />
              <button type="submit" title={`Move to ${st.name}`}>{inner}</button>
            </form>
          ) : (
            <div key={st.key} className={`ops-stp${here ? " here" : ""}${done ? " done" : ""}`} aria-current={here ? "step" : undefined}>{inner}</div>
          );
        })}
      </section>
      {lead.stage === "lost" ? (
        <div className="alert warn small"><XCircle size={16} style={{ flex: "none", marginTop: 1 }} /><span>Lost {lead.lost_at ? dateShort(lead.lost_at) : ""}: {lead.lost_reason}. Tap any stage above to reopen it.</span></div>
      ) : null}

      <div className="ops-lead">
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          {edit && !CLOSED.includes(lead.stage) ? (
            <section className="card ops-next">
              <span className="col tight grow" style={{ minWidth: 0 }}>
                <span className="tiny faint">Next step</span>
                <b>{nextStage && nextStage.key !== "won" ? `Move to ${nextStage.name}` : "Close it out"}</b>
              </span>
              {nextStage ? (
                <form action={moveLeadForm}>
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="stage" value={nextStage.key} />
                  <Submit className="btn sm" pendingText="…">{nextStage.key === "won" ? <><Trophy size={15} /> Mark won</> : <>{nextStage.name} <ArrowRight size={15} /></>}</Submit>
                </form>
              ) : null}
              <span className="ops-next-soon tiny faint"><FileSignature size={14} /> Build the quote from here starting Nov 12.</span>
            </section>
          ) : null}

          {edit ? (
            <section className="card col" style={{ gap: 10 }}>
              <form action={addNote} className="col" style={{ gap: 10 }}>
                <input type="hidden" name="lead_id" value={lead.id} />
                <input type="hidden" name="customer_id" value={lead.customer_id} />
                <div className="ops-kinds" role="radiogroup" aria-label="What happened">
                  {[["note", "Note"], ["call", "Call"], ["text", "Text"], ["email", "Email"]].map(([k, l], i) => (
                    <label key={k} className="chip sm">
                      <input type="radio" name="kind" value={k} defaultChecked={i === 0} /> {l}
                    </label>
                  ))}
                </div>
                <textarea className="textarea" name="body" rows={2} maxLength={4000} placeholder="What happened? Called, left a voicemail, they want a quote by Friday…" required />
                <Submit className="btn sm" pendingText="Saving…">Add to timeline</Submit>
              </form>
            </section>
          ) : null}

          <section className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Timeline</div>
            {timeline.length ? (
              <ol className="ops-timeline">
                {timeline.map((n) => {
                  const I = ICON[n.kind] ?? StickyNote;
                  const st = n.kind === "stage" ? stageNote(n.body) : null;
                  return (
                    <li key={n.id} className={`ops-tl ${n.kind}`}>
                      <span className="ops-tl-ic"><I size={14} /></span>
                      <span className="col tight grow" style={{ minWidth: 0 }}>
                        {st ? (
                          <span className="small">
                            Moved to <b>{stageName(s, st.to)}</b>{st.reason ? ` (${st.reason})` : ""}
                          </span>
                        ) : (
                          <span className="small ops-tl-body">{n.body}</span>
                        )}
                        <span className="tiny faint">{n.kind !== "stage" && n.kind !== "note" ? `${n.kind[0].toUpperCase()}${n.kind.slice(1)} · ` : ""}{n.created_by_name ?? ""} · {dateTime(n.created_at)}</span>
                      </span>
                      {edit && n.kind !== "stage" && (n.created_by === profile.id || opsCan.remove(ws.role)) ? (
                        <form action={deleteNote}>
                          <input type="hidden" name="id" value={n.id} />
                          <input type="hidden" name="back" value={back} />
                          <button type="submit" className="iconbtn sm" aria-label="Delete note"><Trash2 size={14} /></button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
                <li className="ops-tl stage">
                  <span className="ops-tl-ic"><StickyNote size={14} /></span>
                  <span className="col tight grow">
                    <span className="small">Lead added{lead.source ? ` from ${lead.source}` : ""}</span>
                    <span className="tiny faint">{dateTime(lead.created_at)}</span>
                  </span>
                </li>
              </ol>
            ) : (
              <span className="small muted">Lead added {dateTime(lead.created_at)}{lead.source ? ` from ${lead.source}` : ""}. Nothing logged yet.</span>
            )}
          </section>
        </div>

        <aside className="col" style={{ gap: 14, minWidth: 0 }}>
          <section className="card col" style={{ gap: 10 }}>
            <div className="row between">
              <b>{c?.name}</b>
              <Link href={`/ops/customers/${lead.customer_id}`} className="linkbtn tiny">Open customer</Link>
            </div>
            <div className="ops-contact">
              {c?.phone ? <a href={`tel:${c.phone}`} className="btn sm dark"><Phone size={15} /> {phoneText(c.phone)}</a> : null}
              {c?.phone ? <a href={`sms:${c.phone}`} className="btn sm dark"><MessageSquare size={15} /> Text</a> : null}
              {c?.email ? <a href={`mailto:${c.email}`} className="btn sm dark"><Mail size={15} /> Email</a> : null}
              {property ? <a href={mapsUrl(property)} target="_blank" rel="noopener noreferrer" className="btn sm dark"><MapPin size={15} /> Map</a> : null}
            </div>
            {property?.gate_code ? <span className="tiny faint">Gate code: {property.gate_code}</span> : null}
          </section>

          <section className="card col" style={{ gap: 10 }}>
            <b>Tasks</b>
            {tasks.length ? (
              <div className="ops-tasks">
                {tasks.map((t) => (
                  <form key={t.id} action={finishTask} className={`ops-task${t.done_at ? " done" : ""}`}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="done" value={t.done_at ? "0" : "1"} />
                    <button type="submit" className="ops-tick" aria-label={t.done_at ? "Mark not done" : "Mark done"}>{t.done_at ? <Check size={13} strokeWidth={3} /> : null}</button>
                    <span className="grow col tight" style={{ minWidth: 0 }}>
                      <span className="ellipsis">{t.body}</span>
                      <span className={`tiny ${t.due_on && !t.done_at && t.due_on < today ? "red" : "faint"}`}>{[t.due_on ? (t.due_on === today ? "Today" : dateShort(t.due_on)) : "Any time", nameOf(t.assigned_to)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </form>
                ))}
              </div>
            ) : (
              <span className="small muted">No tasks.</span>
            )}
            {edit ? (
              <details className="ops-more">
                <summary className="linkbtn small">Add a task</summary>
                <form action={addNote} className="col" style={{ gap: 8, marginTop: 8 }}>
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <input type="hidden" name="customer_id" value={lead.customer_id} />
                  <input type="hidden" name="kind" value="task" />
                  <input className="input sm" name="body" required maxLength={300} placeholder="Call back about the attic, send photos…" />
                  <div className="grid2">
                    <input className="input sm" type="date" name="due_on" defaultValue={today} aria-label="Due" />
                    <select className="select sm" name="assigned_to" defaultValue={profile.id} aria-label="For">
                      {team.filter((m) => !["crew", "crew_lead", "sub"].includes(m.ops_role ?? "")).map((m) => <option key={m.id} value={m.id}>{memberName(m)}</option>)}
                      {!team.some((m) => m.id === profile.id) ? <option value={profile.id}>Me</option> : null}
                    </select>
                  </div>
                  <Submit className="btn sm" pendingText="…">Add task</Submit>
                </form>
              </details>
            ) : null}
          </section>

          <section className="card col" style={{ gap: 10 }}>
            <b>Details</b>
            {edit ? (
              <form action={updateLead} className="col" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={lead.id} />
                <label className="field">
                  <span className="label">Job name</span>
                  <input className="input sm" name="title" defaultValue={lead.title ?? ""} maxLength={140} />
                </label>
                <div className="chips wrap">
                  {s.services.map((sv) => (
                    <label key={sv} className="chip sm ops-chk">
                      <input type="checkbox" name="services" value={sv} defaultChecked={lead.services.includes(sv)} /> {sv}
                    </label>
                  ))}
                </div>
                <div className="grid2">
                  <label className="field">
                    <span className="label">Rep</span>
                    <select className="select sm" name="rep_id" defaultValue={lead.rep_id ?? ""}>
                      <option value="">Not assigned</option>
                      {reps.map((m) => <option key={m.id} value={m.id}>{memberName(m)}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Source</span>
                    <select className="select sm" name="lead_source" defaultValue={lead.source ?? ""}>
                      <option value="">–</option>
                      {[...new Set([...(lead.source ? [lead.source] : []), ...s.sources])].map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Value</span>
                    <input className="input sm" name="value_est" inputMode="decimal" defaultValue={lead.value_est ?? ""} placeholder="$" />
                  </label>
                  <label className="field">
                    <span className="label">Follow up</span>
                    <input className="input sm" type="date" name="next_at" defaultValue={lead.next_at ?? ""} />
                  </label>
                </div>
                <label className="field">
                  <span className="label">Job address</span>
                  <select className="select sm" name="property_id" defaultValue={lead.property_id ?? ""}>
                    <option value="">None yet</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{addressLine(p)}</option>)}
                  </select>
                </label>
                {locations.length > 1 ? (
                  <label className="field">
                    <span className="label">Location</span>
                    <select className="select sm" name="location_id" defaultValue={lead.location_id ?? ""}>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                ) : <input type="hidden" name="location_id" value={lead.location_id ?? ""} />}
                <label className="field">
                  <span className="label">Notes</span>
                  <textarea className="textarea" name="notes" rows={3} defaultValue={lead.notes ?? ""} maxLength={4000} />
                </label>
                <Submit className="btn sm dark" pendingText="Saving…">Save details</Submit>
              </form>
            ) : (
              <div className="kv small">
                <span>Rep</span><b>{nameOf(lead.rep_id) ?? "Not assigned"}</b>
                <span>Value</span><b>{money0(lead.value_est) || "–"}</b>
                <span>Follow up</span><b>{lead.next_at ? dateShort(lead.next_at) : "–"}</b>
              </div>
            )}
          </section>

          {edit && lead.stage !== "lost" ? (
            <details className="card ops-more">
              <summary className="small"><XCircle size={15} style={{ verticalAlign: -3 }} /> Mark lost</summary>
              <form action={moveLeadForm} className="col" style={{ gap: 8, marginTop: 10 }}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="stage" value="lost" />
                <select className="select sm" name="lost_reason" required defaultValue="">
                  <option value="" disabled>Why was it lost?</option>
                  {s.lost_reasons.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input className="input sm" name="lost_note" maxLength={100} placeholder="Who they went with, their price… (optional)" />
                <Submit className="btn sm dark" pendingText="…">Mark lost</Submit>
              </form>
            </details>
          ) : null}
          {opsCan.remove(ws.role) ? (
            <details className="ops-more danger-zone">
              <summary className="tiny faint">Delete this lead</summary>
              <form action={deleteLead} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={lead.id} />
                <Submit className="btn sm danger" pendingText="Deleting…">Delete lead #{lead.number} for good</Submit>
              </form>
            </details>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
