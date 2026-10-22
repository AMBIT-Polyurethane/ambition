import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { PrfList } from "@/components/prf-list";
import { JotformError, PRF_FORM_ID, formUrl, jotformReady, prfFields, prfPricing, prfSubmissions, toItems, type RepLink } from "@/lib/jotform";
import { can } from "@/lib/access";
import { linkRepName, unlinkRepName } from "./actions";

export const metadata = { title: "My price requests" };
export const dynamic = "force-dynamic";

export default async function PriceRequestsPage() {
  const { supabase, profile } = await requirePerm("price_requests", "prf_approve");
  const admin = profile.role === "admin";
  const approver = can(profile, "prf_approve");

  const { data: prfLink } = await supabase.from("links").select("id").ilike("url", `%${PRF_FORM_ID}%`).limit(1).maybeSingle();
  const newHref = prfLink ? `/go/${prfLink.id}` : formUrl();
  const newBtn = (
    <Link className="btn sm" href={newHref} {...(prfLink ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
      <Plus size={15} /> New
    </Link>
  );

  if (!jotformReady()) {
    return (
      <main className="shell">
        <TopBar title="My price requests" back="/" />
        <div className="card col">
          <b>Almost ready</b>
          <span className="small muted">
            {admin
              ? "The app needs a Jotform key before it can show price requests. Add JOTFORM_API_KEY in Vercel (Settings → Environment Variables), then redeploy."
              : "This page is being set up. Check back soon."}
          </span>
        </div>
      </main>
    );
  }

  let error = "";
  let items: ReturnType<typeof toItems> = [];
  const [{ data: staffRows }, linksRes, reviewsRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, status").in("role", ["employee", "admin"]).order("full_name"),
    supabase.from("rep_name_links").select("rep_name, profile_id"),
    supabase.from("prf_reviews").select("submission_id"),
  ]);
  const reviewed = new Set(((reviewsRes.error ? [] : reviewsRes.data ?? []) as { submission_id: string }[]).map((r) => r.submission_id));
  const staff = (staffRows ?? []) as { id: string; full_name: string | null; email: string; role: string; status: string }[];
  const links = (linksRes.error ? [] : linksRes.data ?? []) as RepLink[];
  try {
    const [fields, subs, pairs] = await Promise.all([prfFields(), prfSubmissions(), prfPricing().catch(() => null)]);
    items = toItems(subs, fields, links, staff, pairs ? { pairs, reviewed } : undefined);
    if (!fields.rep) error = "Couldn't find the SALES REP box on the Price Request Form, so requests can't be matched to reps.";
  } catch (e) {
    error = e instanceof JotformError ? e.message : "Couldn't load price requests from Jotform.";
  }

  const mine = items.filter((i) => i.ownerId === profile.id);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "";

  // Admin: names on the form that don't belong to anyone in the app yet.
  const unmatched = admin
    ? Array.from(
        items
          .filter((i) => i.repKey && !i.ownerId)
          .reduce((m, i) => m.set(i.repKey, { name: i.rep, count: (m.get(i.repKey)?.count ?? 0) + 1 }), new Map<string, { name: string; count: number }>()),
      )
    : [];
  const blank = admin ? items.filter((i) => !i.repKey).length : 0;

  return (
    <main className="shell">
      <TopBar
        title="My price requests"
        back="/"
        right={
          <div className="row" style={{ gap: 8 }}>
            {approver ? <Link className="btn dark sm" href="/price-requests/approvals">Approvals</Link> : null}
            {newBtn}
          </div>
        }
      />

      {error ? <div className="alert err">{error}</div> : null}

      {admin && unmatched.length ? (
        <details className="card" open>
          <summary>
            <b>Sales reps not matched to an app account · {unmatched.length}</b>
            <div className="small muted" style={{ marginTop: 4 }}>
              Reps are matched by the email (or name) picked in the SALES REP box. Anyone listed here can't see their requests yet: either they don't have an app account, or the entry is misspelled. Link a misspelled one to the right person.
            </div>
          </summary>
          <div className="col" style={{ marginTop: 12, gap: 10 }}>
            {unmatched.map(([key, u]) => (
              <form key={key} action={linkRepName} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input type="hidden" name="rep_name" value={key} />
                <span className="grow" style={{ minWidth: 140 }}>
                  <b style={{ overflowWrap: "anywhere" }}>{u.name}</b> <span className="small muted">· {u.count} request{u.count === 1 ? "" : "s"}</span>
                  {/@ambitpu\.com$/i.test(u.name.trim()) ? (
                    <span className="tiny faint" style={{ display: "block", marginTop: 2 }}>No app account with this email yet. It matches on its own once they sign up with it.</span>
                  ) : null}
                </span>
                <select className="select sm" name="profile_id" required defaultValue="" style={{ width: "auto", minWidth: 180 }}>
                  <option value="" disabled>Pick their account…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                  ))}
                </select>
                <button className="btn sm" type="submit">Link</button>
              </form>
            ))}
          </div>
        </details>
      ) : null}

      <PrfList items={items} mineIds={mine.map((m) => m.id)} admin={admin} owners={Object.fromEntries(staff.map((s) => [s.id, s.full_name || s.email]))} />

      {admin && (links.length || blank) ? (
        <details className="card">
          <summary className="small"><b>Name links</b> <span className="muted">· {links.length}</span></summary>
          <div className="col" style={{ marginTop: 10, gap: 8 }}>
            {links.map((l) => (
              <form key={l.rep_name} action={unlinkRepName} className="row small" style={{ gap: 8 }}>
                <input type="hidden" name="rep_name" value={l.rep_name} />
                <span className="grow">“{l.rep_name}” → {nameOf(l.profile_id) || "removed account"}</span>
                <button className="linkbtn" type="submit">Unlink</button>
              </form>
            ))}
            {blank ? <span className="tiny faint">{blank} request{blank === 1 ? " has" : "s have"} no sales rep picked.</span> : null}
            <span className="tiny faint">Names match app accounts by full name. “Bryant, Jeremiah” also matches “Jeremiah Bryant”.</span>
          </div>
        </details>
      ) : null}
    </main>
  );
}
