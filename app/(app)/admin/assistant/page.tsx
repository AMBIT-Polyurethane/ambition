import Link from "next/link";
import { Check, CircleAlert, CircleCheck, ExternalLink, X } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { Markdown } from "@/components/assistant/markdown";
import { KnowledgeTools, type LibraryDoc } from "@/components/assistant/knowledge-tools";
import { aiKeySet, loadAiSettings } from "@/lib/assistant/settings";
import { DOC_KIND, KINDS, MODELS, NEVER_SITES, kindInfo, modelInfo, type AiSource } from "@/lib/assistant/config";
import { dateTime } from "@/lib/format";
import { answerQuestion, deleteSource, dismissQuestion, saveAiSettings, saveNote, updateSource } from "./actions";

export const metadata = { title: "Ask AMBIT admin" };
export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  kind: string;
  origin: string;
  title: string;
  document_id: string | null;
  file_name: string | null;
  body: string | null;
  pages: number | null;
  chars: number;
  staff_only: boolean;
  enabled: boolean;
  status: string;
  error: string | null;
  created_by_name: string | null;
  updated_at: string;
};
type QuestionRow = {
  id: string;
  user_name: string | null;
  user_company: string | null;
  question: string;
  draft: string | null;
  status: string;
  answer: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
  source_id: string | null;
  created_at: string;
};
type ReviewRow = {
  id: number;
  thread_id: string;
  user_id: string;
  body: string;
  sources: AiSource[] | null;
  no_source: boolean;
  rating: number | null;
  feedback: string | null;
  model: string | null;
  cost_cents: number | null;
  created_at: string;
};

const ORIGIN: Record<string, string> = { document: "Product docs", upload: "PDF", note: "Written here", answer: "Expert answer" };
const TABS = [
  { id: "teach", label: "Teach" },
  { id: "questions", label: "Questions" },
  { id: "review", label: "Conversations" },
  { id: "settings", label: "Settings" },
];

export default async function AssistantAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "teach";
  const { supabase, profile } = await requireAdmin();
  const settings = await loadAiSettings(supabase);
  const keyOk = aiKeySet();

  if (!settings) {
    return (
      <main className="shell">
        <TopBar title="Ask AMBIT" back="/admin" />
        <div className="alert warn">Run <code>supabase/migrations/0020_assistant.sql</code> in Supabase (SQL Editor) first, then come back here.</div>
      </main>
    );
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const [{ data: teachData }, { data: sourceRows }, { data: qRows }, { data: usageRows }, { data: admins }] = await Promise.all([
    supabase.rpc("ai_can_teach"),
    supabase.from("ai_sources").select("id, kind, origin, title, document_id, file_name, body, pages, chars, staff_only, enabled, status, error, created_by_name, updated_at").order("updated_at", { ascending: false }),
    supabase.from("ai_questions").select("*").order("created_at", { ascending: false }).limit(60),
    supabase.from("ai_usage").select("user_id, questions, cost_cents").gte("day", monthStart.toISOString().slice(0, 10)),
    supabase.from("profiles").select("id, full_name, email").eq("role", "admin").eq("status", "active").order("full_name"),
  ]);
  const canTeach = Boolean(teachData);
  const sources = (sourceRows ?? []) as SourceRow[];
  const questions = (qRows ?? []) as QuestionRow[];
  const open = questions.filter((q) => q.status === "open");
  const usage = (usageRows ?? []) as { user_id: string; questions: number; cost_cents: number }[];
  const monthQ = usage.reduce((a, u) => a + u.questions, 0);
  const monthCost = usage.reduce((a, u) => a + Number(u.cost_cents), 0) / 100;
  const teacherNames = (admins ?? []).filter((a) => settings.teachers.includes(a.id)).map((a) => a.full_name || a.email);

  return (
    <main className="shell wide">
      <TopBar title="Ask AMBIT" back="/admin" right={<Link href="/assistant" className="btn sm dark">Open Ask AMBIT</Link>} />

      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <div className="ai-stats">
        <div className="card">
          <span className="eyebrow">Claude connection</span>
          {keyOk ? <b className="ok-text"><Check size={16} /> Connected</b> : <b className="err-text"><X size={16} /> Not set up</b>}
          <span className="tiny faint">{modelInfo(settings.model).label}</span>
        </div>
        <div className="card">
          <span className="eyebrow">Who can use it</span>
          <b>{settings.open_to_customers ? "Staff and contractors" : "AMBIT staff only"}</b>
          <span className="tiny faint">Change in Settings</span>
        </div>
        <div className="card">
          <span className="eyebrow">This month</span>
          <b>{monthQ.toLocaleString()} questions</b>
          <span className="tiny faint">about ${monthCost.toFixed(2)} in Claude costs</span>
        </div>
        <div className="card">
          <span className="eyebrow">Knowledge</span>
          <b>{sources.filter((s) => s.enabled && s.status === "ready").length} sources in use</b>
          <span className="tiny faint">{open.length} question{open.length === 1 ? "" : "s"} waiting for an answer</span>
        </div>
      </div>

      {!keyOk ? (
        <div className="card col">
          <b>Connect Ask AMBIT to Claude (once)</b>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Go to <a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer">platform.claude.com</a> and sign up with your AMBIT email (this is separate from a Claude chat subscription).</li>
            <li>Settings → Billing: add a card and some credit (for example $25). Questions cost a few cents each.</li>
            <li>Settings → API keys → Create key, name it &ldquo;AMBIT Intelligence&rdquo;, and copy it (it&apos;s shown once).</li>
            <li>Vercel → ambition → Settings → Environment Variables → add <code>ANTHROPIC_API_KEY</code> with that key (Production), Save.</li>
            <li>Vercel → Deployments → ⋯ on the top one → Redeploy. This page then shows &ldquo;Connected&rdquo;.</li>
          </ol>
        </div>
      ) : null}

      <nav className="chips" aria-label="Sections">
        {TABS.map((t) => (
          <Link key={t.id} href={`/admin/assistant?tab=${t.id}`} className={`chip${tab === t.id ? " on" : ""}`}>
            {t.label}
            {t.id === "questions" && open.length ? ` (${open.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "teach" ? <TeachTab supabase={supabase} sources={sources} canTeach={canTeach} teacherNames={teacherNames} /> : null}
      {tab === "questions" ? <QuestionsTab questions={questions} canTeach={canTeach} /> : null}
      {tab === "review" ? <ReviewTab supabase={supabase} filter={sp.f ?? "bad"} canTeach={canTeach} /> : null}
      {tab === "settings" ? (
        <section className="section">
          <form action={saveAiSettings} className="col" style={{ gap: 16 }}>
            <div className="card col">
              <b>Who can use Ask AMBIT</b>
              <label className="check"><input type="radio" name="open_to_customers" value="no" defaultChecked={!settings.open_to_customers} /> AMBIT staff only (testing)</label>
              <label className="check"><input type="radio" name="open_to_customers" value="yes" defaultChecked={settings.open_to_customers} /> AMBIT staff and contractor customers</label>
            </div>
            <div className="card col">
              <b>Claude model</b>
              <select name="model" className="select sm" defaultValue={settings.model}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}: {m.note}</option>
                ))}
              </select>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <label className="field" style={{ flex: "1 1 160px" }}>
                  <span className="label">Questions a day: staff</span>
                  <input className="input sm" type="number" name="daily_limit_staff" min={1} max={2000} defaultValue={settings.daily_limit_staff} />
                </label>
                <label className="field" style={{ flex: "1 1 160px" }}>
                  <span className="label">Questions a day: contractors</span>
                  <input className="input sm" type="number" name="daily_limit_customer" min={1} max={2000} defaultValue={settings.daily_limit_customer} />
                </label>
              </div>
            </div>
            <div className="card col">
              <b>Approved websites</b>
              <label className="check"><input type="checkbox" name="web_lookups" defaultChecked={settings.web_lookups} /> Let Ask AMBIT look up code, HVAC and neutral-science facts on these websites (about 1¢ a lookup)</label>
              <textarea className="textarea" name="allowed_sites" rows={6} defaultValue={settings.allowed_sites.join("\n")} />
              <span className="tiny faint">
                One per line, like <code>energycodes.gov</code> (covers its subdomains). Every other website is blocked. These can never be added: {NEVER_SITES.join(", ")}.
                Building science and AMBIT products never come from websites, only from AMBIT&apos;s own teaching and documents.
              </span>
            </div>
            <div className="card col">
              <b>Building-science teacher</b>
              <span className="small muted">
                Only the teacher adds or changes AMBIT teaching (bulletins, notes, expert answers saved as teaching) and the extra rules below.
                {teacherNames.length ? ` Now: ${teacherNames.join(", ")}.` : " Nobody is picked yet, so any admin can."}
              </span>
              {(admins ?? []).map((a) => (
                <label key={a.id} className="check">
                  <input type="checkbox" name="teachers" value={a.id} defaultChecked={settings.teachers.includes(a.id)} disabled={!canTeach} /> {a.full_name || a.email}
                </label>
              ))}
              <label className="field">
                <span className="label">Extra rules for Ask AMBIT (optional)</span>
                <textarea
                  className="textarea"
                  name="extra_rules"
                  rows={4}
                  defaultValue={settings.extra_rules ?? ""}
                  disabled={!canTeach}
                  placeholder="For example: Always recommend a blower door test after spray foam. Never recommend open-cell foam on low-slope roof decks."
                />
              </label>
              {!canTeach ? <span className="tiny faint">Only the teacher can change these two.</span> : null}
            </div>
            <Submit className="btn" pendingText="Saving…">Save settings</Submit>
            {settings.updated_by_name ? <p className="tiny faint" style={{ margin: 0 }}>Last changed by {settings.updated_by_name} · {dateTime(settings.updated_at)}</p> : null}
          </form>
        </section>
      ) : null}
    </main>
  );
}

// ------------------------------------------------------------------ Teach
async function TeachTab({
  supabase,
  sources,
  canTeach,
  teacherNames,
}: {
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"];
  sources: SourceRow[];
  canTeach: boolean;
  teacherNames: string[];
}) {
  const { data: docRows } = await supabase.from("documents").select("id, title, doc_type, code").eq("active", true).order("doc_type").order("sort").order("title");
  const byDoc = new Map(sources.filter((s) => s.document_id).map((s) => [s.document_id!, s]));
  const docs: LibraryDoc[] = ((docRows ?? []) as { id: string; title: string; doc_type: string; code: string | null }[])
    .filter((d) => DOC_KIND[d.doc_type])
    .map((d) => {
      const s = byDoc.get(d.id);
      return { ...d, source: s ? { id: s.id, status: s.status, chars: s.chars, updated_at: s.updated_at, enabled: s.enabled } : null };
    });
  const kinds = KINDS.filter((k) => canTeach || k.id !== "teaching");

  return (
    <section className="section">
      <div className="alert info small">
        <span>
          <b>What Ask AMBIT may learn from:</b> building science only from AMBIT teaching (your TSBs and notes); codes only from the IECC, IRC and IBC;
          HVAC design only from ACCA, ASHRAE and other neutral parties; AMBIT products only from AMBIT&apos;s own documents; plus basic physics.
          Never SPFA, Spray Foam World or anything from the foam or HVAC industries.
          {canTeach ? " You're the building-science teacher." : teacherNames.length ? ` Building-science teaching is added by ${teacherNames.join(", ")}.` : ""}
        </span>
      </div>

      <details className="card" open={!sources.length}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Write teaching or app help</summary>
        <form action={saveNote} className="col" style={{ marginTop: 12 }}>
          <input type="hidden" name="tab" value="teach" />
          <label className="field">
            <span className="label">Title</span>
            <input className="input sm" name="title" required maxLength={300} placeholder="Open-cell foam on low-slope roof decks" />
          </label>
          <label className="field">
            <span className="label">What it is</span>
            <select className="select sm" name="kind" defaultValue={canTeach ? "teaching" : "app"}>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">The teaching</span>
            <textarea className="textarea" name="body" required rows={10} placeholder="Write it the way you'd explain it to a contractor. Ask AMBIT quotes from this and links to it." />
          </label>
          <label className="check"><input type="checkbox" name="staff_only" /> AMBIT staff only (contractors never see it)</label>
          <Submit className="btn sm" pendingText="Saving…">Save</Submit>
        </form>
      </details>

      <KnowledgeTools docs={docs} canTeach={canTeach} />

      <div className="eyebrow" style={{ marginTop: 6 }}>Everything Ask AMBIT uses</div>
      {KINDS.map((k) => {
        const list = sources.filter((s) => s.kind === k.id);
        if (!list.length) return null;
        return (
          <details key={k.id} className="card" open={k.id === "teaching"}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>
              {k.label} <span className="faint" style={{ fontWeight: 600 }}>({list.length})</span>
            </summary>
            <div className="ai-src-list">
              {list.map((s) => {
                const locked = s.kind === "teaching" && !canTeach;
                return (
                  <div key={s.id} className="ai-src">
                    <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
                      <div className="col tight" style={{ minWidth: 0 }}>
                        <b className="ellipsis" style={{ fontSize: 14 }}>{s.title}</b>
                        <span className="tiny faint">
                          {ORIGIN[s.origin] ?? s.origin}
                          {s.pages ? ` · ${s.pages} pages` : ""} · {s.status === "ready" ? (s.chars < 1000 ? `${s.chars} characters` : `${Math.round(s.chars / 1000)}k characters`) : s.status === "error" ? `couldn't read it${s.error ? `: ${s.error}` : ""}` : "no text found"}
                          {s.created_by_name ? ` · ${s.created_by_name}` : ""} · {dateTime(s.updated_at)}
                        </span>
                      </div>
                      <Link className="iconbtn" href={`/assistant/source/${s.id}`} target="_blank" aria-label="Open"><ExternalLink size={16} /></Link>
                    </div>
                    <form action={updateSource} className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <input type="hidden" name="id" value={s.id} />
                      <select name="kind" className="select sm" defaultValue={s.kind} disabled={locked} style={{ flex: "1 1 200px", maxWidth: 280 }}>
                        {KINDS.filter((x) => canTeach || x.id !== "teaching" || x.id === s.kind).map((x) => (
                          <option key={x.id} value={x.id}>{x.short}</option>
                        ))}
                      </select>
                      <label className="check small"><input type="checkbox" name="enabled" defaultChecked={s.enabled} disabled={locked} /> In use</label>
                      <label className="check small"><input type="checkbox" name="staff_only" defaultChecked={s.staff_only} disabled={locked} /> Staff only</label>
                      {!locked ? <Submit className="btn sm dark" pendingText="…">Save</Submit> : <span className="tiny faint">Only the teacher can change teaching</span>}
                    </form>
                    {(s.origin === "note" || s.origin === "answer") && !locked ? (
                      <details>
                        <summary className="tiny" style={{ cursor: "pointer", fontWeight: 700 }}>Edit the words</summary>
                        <form action={saveNote} className="col" style={{ marginTop: 8 }}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="tab" value="teach" />
                          <input type="hidden" name="kind" value={s.kind} />
                          {s.staff_only ? <input type="hidden" name="staff_only" value="on" /> : null}
                          <input className="input sm" name="title" defaultValue={s.title} required maxLength={300} />
                          <textarea className="textarea" name="body" rows={8} defaultValue={s.body ?? ""} required />
                          <Submit className="btn sm" pendingText="Saving…">Save changes</Submit>
                        </form>
                      </details>
                    ) : null}
                    {!locked ? (
                      <form action={deleteSource} className="row" style={{ gap: 10, alignItems: "center" }}>
                        <input type="hidden" name="id" value={s.id} />
                        <label className="check tiny"><input type="checkbox" name="confirm" value="yes" required /> Remove from Ask AMBIT</label>
                        <Submit className="btn sm ghost" pendingText="…">Remove</Submit>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
      {!sources.length ? <p className="small faint">Nothing yet. Start with &ldquo;Add all&rdquo; under AMBIT documents to load your TSBs and product docs.</p> : null}
    </section>
  );
}

// ------------------------------------------------------------------ Questions
function QuestionsTab({ questions, canTeach }: { questions: QuestionRow[]; canTeach: boolean }) {
  const open = questions.filter((q) => q.status === "open");
  const done = questions.filter((q) => q.status !== "open").slice(0, 20);
  return (
    <section className="section">
      <p className="small muted" style={{ margin: 0 }}>
        Questions Ask AMBIT had no approved source for (or got wrong), sent by the person who asked. Your answer goes back into their conversation
        (and by email once app email is set up) and, if you save it, Ask AMBIT learns it.
      </p>
      {!open.length ? <div className="alert info small">No questions waiting.</div> : null}
      {open.map((q) => (
        <div key={q.id} className="card col">
          <div className="row between" style={{ gap: 10 }}>
            <b>{q.user_name ?? "Someone"}{q.user_company ? ` · ${q.user_company}` : ""}</b>
            <span className="tiny faint">{dateTime(q.created_at)}</span>
          </div>
          <div className="ai-q">{q.question}</div>
          {q.draft ? (
            <details>
              <summary className="tiny" style={{ cursor: "pointer", fontWeight: 700 }}>What Ask AMBIT said</summary>
              <div className="ai-draft"><Markdown text={q.draft} /></div>
            </details>
          ) : null}
          <form action={answerQuestion} className="col">
            <input type="hidden" name="id" value={q.id} />
            <textarea className="textarea" name="answer" rows={6} required placeholder="Your answer, the way you'd explain it to them." />
            <label className="field">
              <span className="label">Teach Ask AMBIT with this answer?</span>
              <select className="select sm" name="save_as" defaultValue={canTeach ? "teaching" : "none"}>
                {canTeach ? <option value="teaching">Yes, as AMBIT building-science teaching</option> : null}
                <option value="product">Yes, as AMBIT product information</option>
                <option value="code">Yes, as building code information</option>
                <option value="hvac">Yes, as HVAC design information</option>
                <option value="app">Yes, as help using the app</option>
                <option value="none">No, just answer this person</option>
              </select>
            </label>
            <div className="row" style={{ gap: 10 }}>
              <Submit className="btn sm" pendingText="Sending…">Send answer</Submit>
            </div>
          </form>
          <form action={dismissQuestion}>
            <input type="hidden" name="id" value={q.id} />
            <Submit className="btn sm ghost" pendingText="…">Close without answering</Submit>
          </form>
        </div>
      ))}
      {done.length ? (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>Answered and closed ({done.length})</summary>
          <div className="col" style={{ marginTop: 10, gap: 14 }}>
            {done.map((q) => (
              <div key={q.id} className="col tight">
                <span className="tiny faint">{q.user_name ?? "Someone"} · {dateTime(q.created_at)} · {q.status === "answered" ? `answered by ${q.answered_by_name ?? "an admin"}${q.source_id ? " · taught to Ask AMBIT" : ""}` : "closed"}</span>
                <div className="ai-q">{q.question}</div>
                {q.answer ? <div className="small" style={{ whiteSpace: "pre-wrap" }}>{q.answer}</div> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ Conversations
async function ReviewTab({ supabase, filter, canTeach }: { supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"]; filter: string; canTeach: boolean }) {
  let query = supabase
    .from("ai_messages")
    .select("id, thread_id, user_id, body, sources, no_source, rating, feedback, model, cost_cents, created_at")
    .eq("role", "assistant")
    .order("id", { ascending: false })
    .limit(40);
  if (filter === "bad") query = query.eq("rating", -1);
  if (filter === "nosource") query = query.eq("no_source", true);
  const { data } = await query;
  const rows = (data ?? []) as ReviewRow[];
  const threadIds = [...new Set(rows.map((r) => r.thread_id))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [{ data: qs }, { data: people }] = await Promise.all([
    threadIds.length ? supabase.from("ai_messages").select("id, thread_id, body").eq("role", "user").in("thread_id", threadIds).order("id") : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from("profiles").select("id, full_name, email, role, company:companies!company_id(name)").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const userQs = (qs ?? []) as { id: number; thread_id: string; body: string }[];
  const questionFor = (r: ReviewRow) => [...userQs].reverse().find((q) => q.thread_id === r.thread_id && q.id < r.id)?.body ?? "";
  const who = (id: string) => {
    const p = ((people ?? []) as unknown as { id: string; full_name: string | null; email: string; role: string; company: { name: string } | null }[]).find((x) => x.id === id);
    if (!p) return "Someone";
    return `${p.full_name || p.email}${p.role === "customer" ? ` · ${p.company?.name ?? "contractor"}` : " · AMBIT"}`;
  };

  return (
    <section className="section">
      <nav className="chips">
        {[
          { id: "bad", label: "Not helpful" },
          { id: "nosource", label: "No approved source" },
          { id: "all", label: "All recent" },
        ].map((f) => (
          <Link key={f.id} className={`chip sm${filter === f.id ? " on2" : ""}`} href={`/admin/assistant?tab=review&f=${f.id}`}>{f.label}</Link>
        ))}
      </nav>
      {!rows.length ? <div className="alert info small">Nothing here yet.</div> : null}
      {rows.map((r) => {
        const q = questionFor(r);
        return (
          <div key={r.id} className="card col">
            <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="tiny faint">{who(r.user_id)} · {dateTime(r.created_at)}</span>
              <span className="row" style={{ gap: 6 }}>
                {r.rating === -1 ? <span className="pill">Not helpful</span> : r.rating === 1 ? <span className="pill ok">Helpful</span> : null}
                {r.no_source ? <span className="pill warn">No source</span> : null}
                <span className="pill grey">{r.sources?.length ?? 0} sources</span>
              </span>
            </div>
            <div className="ai-q">{q}</div>
            <details>
              <summary className="tiny" style={{ cursor: "pointer", fontWeight: 700 }}>Ask AMBIT&apos;s answer</summary>
              <div className="ai-draft">
                <Markdown text={r.body} />
                {r.sources?.length ? (
                  <ol className="tiny faint" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {r.sources.map((s) => <li key={s.n}>{s.title} ({s.kind === "web" ? s.site : kindInfo(s.kind).short})</li>)}
                  </ol>
                ) : null}
              </div>
            </details>
            {r.feedback ? <div className="small"><b>Their note:</b> {r.feedback}</div> : null}
            <details>
              <summary className="tiny" style={{ cursor: "pointer", fontWeight: 700 }}>Write a correction (Ask AMBIT learns it)</summary>
              <form action={saveNote} className="col" style={{ marginTop: 8 }}>
                <input type="hidden" name="tab" value="review" />
                <input className="input sm" name="title" required maxLength={300} defaultValue={q.slice(0, 200)} />
                <select className="select sm" name="kind" defaultValue={canTeach ? "teaching" : "app"}>
                  {KINDS.filter((k) => canTeach || k.id !== "teaching").map((k) => (
                    <option key={k.id} value={k.id}>{k.label}</option>
                  ))}
                </select>
                <textarea className="textarea" name="body" rows={6} required placeholder="The right answer, in your words." />
                <Submit className="btn sm" pendingText="Saving…">Save correction</Submit>
              </form>
            </details>
            <span className="tiny faint">{r.model ? modelInfo(r.model).label : ""}{r.cost_cents != null ? ` · ${Number(r.cost_cents).toFixed(1)}¢` : ""}</span>
          </div>
        );
      })}
    </section>
  );
}
