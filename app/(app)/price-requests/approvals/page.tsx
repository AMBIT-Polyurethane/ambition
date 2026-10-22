import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { Empty, TopBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { dateShort, jfDate, searchSafe } from "@/lib/format";
import { JotformError, jotformReady, prfFields, prfPricing, prfSubmissions, toItems, type RepLink } from "@/lib/jotform";

export const metadata = { title: "Price approvals" };
export const dynamic = "force-dynamic";

const TABS = [
  ["pending", "Waiting"],
  ["approved", "Approved"],
  ["all", "All"],
] as const;

type Review = { submission_id: string; approved_by_name: string | null; approved_at: string };

/** Admins: every price request, the ones waiting for prices first. */
export default async function PriceApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requirePerm("prf_approve");
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "pending";
  const q = searchSafe(sp.q).toLowerCase();

  if (!jotformReady()) {
    return (
      <main className="shell">
        <TopBar title="Price approvals" back="/" />
        <div className="alert warn">The app needs a Jotform key first. Add JOTFORM_API_KEY in Vercel, then redeploy.</div>
      </main>
    );
  }

  const [{ data: staffRows }, linksRes, reviewsRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]),
    supabase.from("rep_name_links").select("rep_name, profile_id"),
    supabase.from("prf_reviews").select("submission_id, approved_by_name, approved_at"),
  ]);
  const staff = (staffRows ?? []) as { id: string; full_name: string | null; email: string }[];
  const reviews = new Map(((reviewsRes.error ? [] : reviewsRes.data ?? []) as Review[]).map((r) => [r.submission_id, r]));

  let error = "";
  let items: ReturnType<typeof toItems> = [];
  try {
    const [fields, pairs, subs] = await Promise.all([prfFields(), prfPricing(), prfSubmissions()]);
    items = toItems(subs, fields, (linksRes.error ? [] : linksRes.data ?? []) as RepLink[], staff, { pairs, reviewed: new Set(reviews.keys()) });
  } catch (e) {
    error = e instanceof JotformError ? e.message : "Couldn't load price requests from Jotform.";
  }

  const owners = new Map(staff.map((s) => [s.id, s.full_name || s.email]));
  const repOf = (i: (typeof items)[number]) => (i.ownerId && owners.get(i.ownerId)) || i.rep || "No rep picked";
  const counts = {
    pending: items.filter((i) => i.status === "pending").length,
    approved: items.filter((i) => i.status === "approved").length,
    all: items.length,
  };
  const shown = items
    .filter((i) => tab === "all" || i.status === tab)
    .filter((i) => !q || `${i.customer} ${i.contact} ${repOf(i)}`.toLowerCase().includes(q));
  // Waiting: oldest first, so nothing sits at the bottom forever.
  if (tab === "pending") shown.reverse();

  return (
    <main className="shell">
      <TopBar title="Price approvals" back="/" />
      {error ? <div className="alert err">{error}</div> : null}

      <div className="chips">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/price-requests/approvals?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`chip${tab === k ? " on" : ""}`}>
            {label} · {counts[k]}
          </Link>
        ))}
      </div>
      <form className="search" action="/price-requests/approvals">
        <Search size={18} />
        <input type="hidden" name="tab" value={tab} />
        <input className="input" name="q" defaultValue={q} placeholder="Search customer, contact or rep" aria-label="Search price requests" />
      </form>

      {shown.length === 0 ? (
        <Empty icon="tag" title={tab === "pending" ? "Nothing waiting for approval" : "No price requests match"} />
      ) : (
        <div className="list">
          {shown.map((i) => {
            const r = reviews.get(i.id);
            return (
              <Link key={i.id} className="item" href={`/price-requests/${i.id}`}>
                <div className="ic"><Icon name="tag" /></div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="t ellipsis">{i.customer || i.contact || "Price request"}</span>
                    {i.status === "approved" ? <span className="pill ok">Approved</span> : i.status === "pending" ? <span className="pill warn">Waiting</span> : <span className="pill grey">No prices</span>}
                  </div>
                  <div className="s ellipsis">{[i.customer && i.contact ? i.contact : null, repOf(i)].filter(Boolean).join(" · ")}</div>
                  <div className="tiny faint">
                    Sent {jfDate(i.created_at)}
                    {i.priced ? ` · ${i.priced} product${i.priced === 1 ? "" : "s"}` : ""}
                    {r ? ` · approved ${dateShort(r.approved_at)} by ${r.approved_by_name ?? ""}` : ""}
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
