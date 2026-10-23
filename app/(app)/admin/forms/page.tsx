import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { Empty, TopBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { jfDate } from "@/lib/format";
import { JotformError, jotformReady } from "@/lib/jotform";
import { KIND_LABEL, formSubmissions, hubForms, reviewable, type HubForm } from "@/lib/forms";
import { reviewsFor } from "./reviews";

export const metadata = { title: "Forms hub" };
export const dynamic = "force-dynamic";

const ICON: Record<HubForm["kind"], string> = { credit: "card", account: "building", prf: "tag", other: "form" };

/** Admins: every Jotform form in one place. Credit applications and account setups wait here for a decision. */
export default async function FormsHubPage() {
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
    forms = await hubForms();
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

      <section className="section">
        <div className="eyebrow">Credit &amp; account applications</div>
        {apps.length ? (
          <div className="list">{apps.map(row)}</div>
        ) : !error ? (
          <div className="card small muted">
            No credit application or account setup form was found in Jotform. The app looks for &ldquo;credit&rdquo; or &ldquo;account setup&rdquo; in the
            form&apos;s name, so renaming the form in Jotform makes it show up here.
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
