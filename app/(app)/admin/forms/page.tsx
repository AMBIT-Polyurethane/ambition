import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { Empty, TopBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { jfDate } from "@/lib/format";
import { JotformError, jotformReady } from "@/lib/jotform";
import { KIND_LABEL, formSubmissions, hubForms, reviewable, type HubForm } from "@/lib/forms";
import { extraForms, reviewsFor } from "./reviews";
import { addHubForm } from "./actions";
import { Submit } from "@/components/forms";

export const metadata = { title: "Forms hub" };
export const dynamic = "force-dynamic";

const ICON: Record<HubForm["kind"], string> = { credit: "card", account: "building", prf: "tag", other: "form" };

/** Admins: every Jotform form in one place. Credit applications and account setups wait here for a decision. */
export default async function FormsHubPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();

  if (!jotformReady()) {
    return (
      <main className="shell">
        <TopBar title="Forms hub" back="/admin" />
        <div className="alert warn">The app needs a Jotform key first. Add JOTFORM_API_KEY in Vercel, then redeploy.</div>
      </main>
    );
  }

  let forms: HubForm[] = [];
  let error = "";
  try {
    forms = await hubForms(await extraForms(supabase));
  } catch (e) {
    error = e instanceof JotformError ? e.message : "Couldn't load the forms from Jotform.";
  }

  // Exact "waiting" counts for the forms that need a decision.
  const reviews = await reviewsFor(supabase);
  const waiting = new Map<string, number>();
  await Promise.all(
    forms
      .filter((f) => reviewable(f.kind))
      .map(async (f) => {
        try {
          const subs = await formSubmissions(f.id, 60);
          waiting.set(f.id, subs.filter((s) => !reviews.has(s.id)).length);
        } catch {
          /* show the form without a count */
        }
      }),
  );

  const apps = forms.filter((f) => reviewable(f.kind));
  const prf = forms.filter((f) => f.kind === "prf");
  const others = forms.filter((f) => f.kind === "other");

  const row = (f: HubForm) => {
    const w = waiting.get(f.id) ?? 0;
    const href = f.kind === "prf" ? "/price-requests/approvals" : `/admin/forms/${f.id}`;
    return (
      <Link key={f.id} className="item" href={href}>
        <div className="ic"><Icon name={ICON[f.kind]} /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="t">{f.title}</span>
            {reviewable(f.kind) ? (w ? <span className="pill warn">{w} waiting</span> : <span className="pill ok">All reviewed</span>) : null}
          </div>
          <div className="s ellipsis">
            {f.kind === "other" ? "" : `${KIND_LABEL[f.kind]} · `}
            {f.count} {f.count === 1 ? "submission" : "submissions"}
            {f.lastSubmission ? ` · last ${jfDate(f.lastSubmission)}` : ""}
            {f.enabled ? "" : " · turned off in Jotform"}
          </div>
        </div>
        <ChevronRight size={18} className="chev" />
      </Link>
    );
  };

  return (
    <main className="shell">
      <TopBar title="Forms hub" back="/admin" />
      <p className="muted small" style={{ margin: 0 }}>
        Every form from AMBIT&apos;s Jotform account. Open one to read past submissions, approve credit applications and account setups, and
        download any submission as a PDF.
      </p>
      {error ? <div className="alert err">{error}</div> : null}
      {sp.msg ? <div className="alert ok" role="status">{sp.msg}</div> : null}
      {sp.err ? <div className="alert err" role="alert">{sp.err}</div> : null}

      <details className="card" open={apps.length === 0 || Boolean(sp.err)}>
        <summary><b>Add a form from Jotform</b> <span className="small muted">· paste its link</span></summary>
        <form action={addHubForm} className="col" style={{ gap: 10, marginTop: 12 }}>
          <label className="field">
            <span className="label">Jotform link or form number</span>
            <input className="input" name="link" required placeholder="https://ambit-polyurethane.jotform.com/2629..." autoComplete="off" />
          </label>
          <label className="field">
            <span className="label">What kind of form is it?</span>
            <select className="select" name="kind" defaultValue="credit">
              <option value="credit">Credit application (approve with limit and terms)</option>
              <option value="account">Customer account setup (approve with limit and terms)</option>
              <option value="other">Other form (read and download only)</option>
            </select>
          </label>
          <Submit className="btn block" pendingText="Checking the form…">Add to the hub</Submit>
          <p className="tiny faint" style={{ margin: 0 }}>
            In Jotform, open the form and copy the address from the browser bar (or the form&apos;s Publish link). Forms in the app&apos;s own Jotform
            login and the forms on the home screen show up here by themselves.
          </p>
        </form>
      </details>

      <section className="section">
        <div className="eyebrow">Credit &amp; account applications</div>
        {apps.length ? (
          <div className="list">{apps.map(row)}</div>
        ) : !error ? (
          <div className="card small muted">
            No credit application or account setup form yet. Paste each form&apos;s Jotform link in &ldquo;Add a form from Jotform&rdquo; above and pick
            what kind of form it is.
          </div>
        ) : null}
      </section>

      {prf.length ? (
        <section className="section">
          <div className="eyebrow">Price requests</div>
          <div className="list">{prf.map(row)}</div>
        </section>
      ) : null}

      <section className="section">
        <div className="eyebrow">All other forms</div>
        {others.length ? <div className="list">{others.map(row)}</div> : !error ? <Empty icon="form" title="No other forms" /> : null}
      </section>
    </main>
  );
}
