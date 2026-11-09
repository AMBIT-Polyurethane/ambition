import Link from "next/link";
import { BookOpen, CircleAlert, CircleCheck, Download, Upload } from "lucide-react";
import { requireTakeoff } from "@/lib/takeoff/access";
import { loadTeaching, rulesScope, type RuleRow } from "@/lib/takeoff/teaching";
import { TopBar } from "@/components/ui";
import { ConfirmSubmit, Submit } from "@/components/forms";
import { dateShort, dateTime } from "@/lib/format";
import { addRule, deleteRule, importRules, saveRule, toggleRule } from "./actions";

export const metadata = { title: "Takeoff AI rules" };
export const dynamic = "force-dynamic";

type Call = {
  id: string;
  takeoff_id: string | null;
  sheet_name: string | null;
  kind: string;
  model: string | null;
  ok: boolean;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cents: number | null;
  ms: number | null;
  rules: number | null;
  created_by_name: string | null;
  created_at: string;
  takeoff?: { name: string } | null;
};

const FILTERS = [
  { id: "on", label: "In use" },
  { id: "off", label: "Switched off" },
  { id: "all", label: "All" },
];

/** Every rule the takeoff AI follows, where it came from, and the AI's call log. */
export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const a = await requireTakeoff();
  const ops = sp.ops === "1" && Boolean(a.ws);
  const scope = rulesScope(a, ops);
  const { rules, corrections } = await loadTeaching(a.supabase, scope);
  let lq = a.supabase
    .from("takeoff_ai_calls")
    .select("id, takeoff_id, sheet_name, kind, model, ok, error, input_tokens, output_tokens, cost_cents, ms, rules, created_by_name, created_at, takeoff:takeoffs(name)")
    .order("created_at", { ascending: false })
    .limit(60);
  lq = scope ? lq.eq("ops_company_id", scope) : lq.is("ops_company_id", null);
  const { data: callRows } = await lq;
  const calls = (callRows ?? []) as unknown as Call[];

  const f = FILTERS.some((x) => x.id === sp.f) ? sp.f! : "on";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const shown = rules.filter((r) => (f === "all" || (f === "on") === r.active) && (!q || `${r.text} ${r.builder ?? ""}`.toLowerCase().includes(q)));
  const builders = [...new Set(rules.map((r) => r.builder).filter(Boolean))] as string[];
  const o = ops ? "&ops=1" : "";
  const whose = scope ? `${a.ws?.company.name ?? "Your company"}'s` : "AMBIT's";
  const used = rules.filter((r) => r.active).length;

  const scopeFields = (r?: RuleRow) => (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="field" style={{ maxWidth: 190 }}>
        <span className="label">Applies to</span>
        <select className="select sm" name="scope" defaultValue={r?.builder ? "builder" : "all"}>
          <option value="all">All plans</option>
          <option value="builder">One builder</option>
        </select>
      </label>
      <label className="field grow" style={{ minWidth: 160 }}>
        <span className="label">Builder (for one builder)</span>
        <input className="input sm" name="builder" defaultValue={r?.builder ?? ""} list="ai-builders" maxLength={80} placeholder="Homes by Taber" />
      </label>
      <label className="field" style={{ maxWidth: 160 }}>
        <span className="label">Used for</span>
        <select className="select sm" name="kind" defaultValue={r?.kind ?? "plans"}>
          <option value="plans">Plans</option>
          <option value="photos">Site photos</option>
        </select>
      </label>
    </div>
  );

  return (
    <main className="shell wide">
      <TopBar title="Takeoff AI rules" back={`/takeoff${ops ? "?ops=1" : ""}`} />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}

      <section className="card col" style={{ gap: 8 }}>
        <b><BookOpen size={17} style={{ verticalAlign: -3, marginRight: 6 }} />What the AI has been taught</b>
        <span className="small muted">
          {whose} rules: {used} in use. They&apos;re added to every plan reading, after the measuring guide. A rule comes from a correction someone remembered
          (&ldquo;Tell the AI what it got wrong&rdquo; on a sheet), is typed here, or is imported. Rules for one builder are only used on that builder&apos;s plans.
          {scope ? " AMBIT's own measuring rules are used too." : " They apply to every takeoff, contractors' included; a contractor can add their own on top."}
        </span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a className="btn sm dark" href={`/takeoff/rules/export?f=json${o}`}><Download size={15} /> Export (JSON)</a>
          <a className="btn sm dark" href={`/takeoff/rules/export?f=md${o}`}><Download size={15} /> Export (Markdown)</a>
        </div>
      </section>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Add a rule</summary>
        <form action={addRule} className="col" style={{ gap: 10, marginTop: 10 }}>
          {ops ? <input type="hidden" name="ops" value="1" /> : null}
          <label className="field">
            <span className="label">The rule, the way you&apos;d tell a new estimator</span>
            <textarea className="textarea" name="text" rows={3} maxLength={2000} required placeholder="A porch ceiling is never insulated unless there's living space above it." />
          </label>
          {scopeFields()}
          <Submit className="btn sm">Add rule</Submit>
        </form>
      </details>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 800 }}><Upload size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Import rules (PRO-Rate or AMBIT export)</summary>
        <form action={importRules} className="col" style={{ gap: 10, marginTop: 10 }}>
          {ops ? <input type="hidden" name="ops" value="1" /> : null}
          <span className="small muted">
            In PRO-Rate, open the Rules page and click Export (JSON), then pick that file here. Each rule keeps its scope (all builders or one builder) and whether
            it&apos;s switched on. Rules already here are skipped.
          </span>
          <input type="file" name="file" accept="application/json,.json" required className="input" />
          <Submit className="btn sm" pendingText="Importing…">Import</Submit>
        </form>
      </details>

      <form className="row" style={{ gap: 10, flexWrap: "wrap" }} action="/takeoff/rules">
        {ops ? <input type="hidden" name="ops" value="1" /> : null}
        <input type="hidden" name="f" value={f} />
        <input className="input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search rules" aria-label="Search rules" style={{ flex: "1 1 240px" }} />
      </form>
      <div className="chips">
        {FILTERS.map((x) => (
          <Link key={x.id} href={`/takeoff/rules?f=${x.id}${o}`} className={`chip${x.id === f ? " on" : ""}`}>
            {x.label} {x.id === "on" ? used : x.id === "off" ? rules.length - used : rules.length}
          </Link>
        ))}
      </div>
      <datalist id="ai-builders">{builders.map((b) => <option key={b} value={b} />)}</datalist>

      {shown.length === 0 ? (
        <div className="card muted small center">{rules.length ? "No rules match." : "No rules yet. Correct a sheet and pick Remember, add one above, or import PRO-Rate's."}</div>
      ) : (
        <div className="list">
          {shown.map((r) => (
            <div key={r.id} className="item col" style={{ alignItems: "stretch", gap: 8, opacity: r.active ? 1 : 0.6 }}>
              <div className="row between" style={{ gap: 10, alignItems: "flex-start" }}>
                <b style={{ fontSize: 14.5, lineHeight: 1.4 }}>{r.text}</b>
                <span className="row" style={{ gap: 5, flex: "none" }}>
                  <span className={`pill ${r.builder ? "warn" : "grey"}`}>{r.builder ? r.builder : "All plans"}</span>
                  {r.kind === "photos" ? <span className="pill grey">Site photos</span> : null}
                  {!r.active ? <span className="pill grey">Off</span> : null}
                </span>
              </div>
              <span className="tiny faint">
                {r.source === "import" ? `Imported${r.source_sheet ? ` from ${r.source_sheet}` : ""}` : r.source === "manual" ? "Added here" : "From a correction"}
                {r.source_takeoff_id ? (
                  <> on <Link href={`/takeoff/${r.source_takeoff_id}`}>{r.takeoff?.name ?? "a takeoff"}</Link>{r.source_sheet && r.source !== "import" ? `, ${r.source_sheet}` : ""}</>
                ) : r.source === "correction" ? " (that takeoff was deleted; the rule stays)" : ""}
                {r.created_by_name ? ` · ${r.created_by_name}` : ""} · {dateShort(r.created_at)}
              </span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <details className="grow">
                  <summary className="linkbtn small" style={{ cursor: "pointer" }}>Edit</summary>
                  <form action={saveRule} className="col" style={{ gap: 8, marginTop: 8 }}>
                    {ops ? <input type="hidden" name="ops" value="1" /> : null}
                    <input type="hidden" name="id" value={r.id} />
                    <textarea className="textarea" name="text" rows={3} maxLength={2000} required defaultValue={r.text} />
                    {scopeFields(r)}
                    <Submit className="btn sm">Save</Submit>
                  </form>
                </details>
                <form action={toggleRule}>
                  {ops ? <input type="hidden" name="ops" value="1" /> : null}
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="on" value={r.active ? "0" : "1"} />
                  <Submit className="btn sm dark" pendingText="…">{r.active ? "Switch off" : "Switch on"}</Submit>
                </form>
                <form action={deleteRule}>
                  {ops ? <input type="hidden" name="ops" value="1" /> : null}
                  <input type="hidden" name="id" value={r.id} />
                  <ConfirmSubmit className="btn sm dark" pendingText="…" confirm="Delete this rule? To stop using it but keep it, switch it off instead.">Delete</ConfirmSubmit>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Corrections · {corrections.length}</summary>
        <p className="tiny faint" style={{ margin: "6px 0 10px" }}>Everything typed into &ldquo;Tell the AI what it got wrong&rdquo;, remembered or not.</p>
        {corrections.length ? (
          <div className="list">
            {corrections.slice(0, 100).map((c) => (
              <div key={c.id} className="item col" style={{ alignItems: "stretch", gap: 3 }}>
                <span className="small">{c.text}</span>
                <span className="tiny faint">
                  {c.takeoff_id ? <Link href={`/takeoff/${c.takeoff_id}`}>{c.takeoff?.name ?? "takeoff"}</Link> : "deleted takeoff"}
                  {c.sheet_name ? ` · ${c.sheet_name}` : ""} · {c.remember === "once" ? "just this time" : c.remember === "all" ? "remembered for all plans" : `remembered for ${c.builder ?? "the builder"}`}
                  {c.created_by_name ? ` · ${c.created_by_name}` : ""} · {dateTime(c.created_at)}
                </span>
              </div>
            ))}
          </div>
        ) : <span className="small muted">None yet.</span>}
      </details>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>AI call log · last {calls.length}</summary>
        <p className="tiny faint" style={{ margin: "6px 0 10px" }}>Every reading, correction and cross-sheet check, with what came back, so a bad read can be looked at and turned into a better rule.</p>
        {calls.length ? (
          <div className="list">
            {calls.map((c) => (
              <div key={c.id} className="item col" style={{ alignItems: "stretch", gap: 4 }}>
                <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="small">
                    <b>{c.kind === "read" ? "Read" : c.kind === "correct" ? "Correction" : "Cross-sheet check"}</b>
                    {c.sheet_name ? ` · ${c.sheet_name}` : ""}
                    {c.takeoff ? ` · ${c.takeoff.name}` : ""}
                    {!c.ok ? <span style={{ color: "var(--err-text)" }}> · failed</span> : null}
                  </span>
                  <span className="tiny faint">
                    {c.input_tokens ? `${c.input_tokens.toLocaleString()} in / ${(c.output_tokens ?? 0).toLocaleString()} out · ` : ""}
                    {c.cost_cents ? `${Number(c.cost_cents).toFixed(1)}¢ · ` : ""}
                    {c.ms ? `${Math.round(c.ms / 1000)}s · ` : ""}
                    {c.rules ? `${c.rules} rules · ` : ""}
                    {dateTime(c.created_at)}
                  </span>
                </div>
                {c.error ? <span className="tiny" style={{ color: "var(--err-text)" }}>{c.error}</span> : null}
                <span className="tiny faint">
                  {c.model ?? ""}{c.created_by_name ? ` · ${c.created_by_name}` : ""} ·{" "}
                  <a href={`/takeoff/rules/call?id=${c.id}`} target="_blank" rel="noopener noreferrer">What came back</a>
                </span>
              </div>
            ))}
          </div>
        ) : <span className="small muted">No AI calls yet.</span>}
      </details>
    </main>
  );
}
