import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink, Search } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { Empty, TopBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { dateShort, jfDate, money, searchSafe } from "@/lib/format";
import { JotformError, jotformReady } from "@/lib/jotform";
import { KIND_LABEL, formSubmissions, hubForm, jotformInboxUrl, reviewable, summarize } from "@/lib/forms";
import { reviewsFor } from "../reviews";

export const metadata = { title: "Form submissions" };
export const dynamic = "force-dynamic";

const TABS = [
  ["waiting", "Waiting"],
  ["approved", "Approved"],
  ["declined", "Declined"],
  ["all", "All"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function FormSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { formId } = await params;
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  if (!jotformReady()) notFound();

  let form = null;
  let error = "";
  let rows: { id: string; created_at: string; title: string; sub: string }[] = [];
  try {
    form = await hubForm(formId);
    if (!form) notFound();
    if (form.kind === "prf") {
      return (
        <main className="shell">
          <TopBar title={form.title} back="/admin/forms" />
          <Link className="btn block" href="/price-requests/approvals">Open price approvals</Link>
        </main>
      );
    }
    const subs = await formSubmissions(formId);
    rows = subs.map((s) => ({ id: s.id, created_at: s.created_at, ...summarize(s) }));
  } catch (e) {
    if (e instanceof JotformError) error = e.message;
    else throw e;
  }
  if (!form) {
    return (
      <main className="shell">
        <TopBar title="Form" back="/admin/forms" />
        <div className="alert err">{error || "Couldn't load this form."}</div>
      </main>
    );
  }

  const review = reviewable(form.kind);
  const reviews = review ? await reviewsFor(supabase, formId) : new Map();
  const statusOf = (id: string): Tab => (reviews.get(id)?.status as Tab | undefined) ?? "waiting";
  const tab: Tab = review ? (TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "waiting") : "all";
  const q = searchSafe(sp.q).toLowerCase();
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k === "all" ? rows.length : rows.filter((r) => statusOf(r.id) === k).length])) as Record<Tab, number>;
  const shown = rows.filter((r) => tab === "all" || statusOf(r.id) === tab).filter((r) => !q || `${r.title} ${r.sub}`.toLowerCase().includes(q));
  if (tab === "waiting") shown.reverse(); // oldest first, so nothing sits at the bottom forever
  const base = `/admin/forms/${formId}`;

  return (
    <main className="shell">
      <TopBar
        title={form.title}
        back="/admin/forms"
        right={
          <a className="iconbtn" href={jotformInboxUrl(formId)} target="_blank" rel="noopener noreferrer" aria-label="Open in Jotform">
            <ExternalLink size={18} />
          </a>
        }
      />
      <div className="tiny faint">
        {form.kind === "other" ? "Form" : KIND_LABEL[form.kind]} · {rows.length} {rows.length === 1 ? "submission" : "submissions"}
        {form.enabled ? "" : " · turned off in Jotform"}
      </div>
      {error ? <div className="alert err">{error}</div> : null}

      {review ? (
        <div className="chips">
          {TABS.map(([k, label]) => (
            <Link key={k} href={`${base}?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${tab === k ? " on" : ""}`}>
              {label} · {counts[k]}
            </Link>
          ))}
        </div>
      ) : null}
      <form className="search" action={base}>
        <Search size={18} />
        {review ? <input type="hidden" name="tab" value={tab} /> : null}
        <input className="input" name="q" defaultValue={q} placeholder="Search business, name, email or phone" aria-label="Search submissions" />
      </form>

      {shown.length === 0 ? (
        <Empty icon="form" title={tab === "waiting" ? "Nothing waiting for review" : "No submissions match"} />
      ) : (
        <div className="list">
          {shown.map((r) => {
            const rv = reviews.get(r.id);
            return (
              <Link key={r.id} className="item" href={`${base}/${r.id}`}>
                <div className="ic"><Icon name={form.kind === "credit" ? "card" : form.kind === "account" ? "building" : "form"} /></div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="t ellipsis">{r.title}</span>
                    {review ? (
                      rv?.status === "approved" ? <span className="pill ok">Approved</span> : rv?.status === "declined" ? <span className="pill red">Declined</span> : <span className="pill warn">Waiting</span>
                    ) : null}
                  </div>
                  {r.sub ? <div className="s ellipsis">{r.sub}</div> : null}
                  <div className="tiny faint">
                    Sent {jfDate(r.created_at)}
                    {rv ? ` · ${rv.status} ${dateShort(rv.reviewed_at)} by ${rv.reviewed_by_name ?? ""}` : ""}
                    {rv?.credit_limit != null ? ` · limit ${money(Number(rv.credit_limit))}` : ""}
                    {rv?.terms ? ` · ${rv.terms}` : ""}
                  </div>
                </div>
                <ChevronRight size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
