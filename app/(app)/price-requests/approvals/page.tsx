import Link from "next/link";
import { ArchiveRestore, ChevronLeft, ChevronRight, Clock, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { requirePerm } from "@/lib/session";
import { Empty } from "@/components/ui";
import { monthDay, searchSafe } from "@/lib/format";
import { JotformError, jotformReady, prfFields, prfPricing, prfSubmissions, toItems, type RepLink } from "@/lib/jotform";
import { PrNativeList, lineCounts } from "@/components/pr-native-list";
import type { PrRow } from "@/lib/price-requests";
import { OLD_DAYS, isCleared, jfMs, prfClearedBefore } from "@/lib/prf-cleared";
import { Submit } from "@/components/forms";
import { clearOldPrf, restoreOldPrf } from "../actions";

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
  const { supabase, profile } = await requirePerm("prf_approve");
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "pending";
  const q = searchSafe(sp.q).toLowerCase();
  // In the app (0066): waiting first (oldest at the top), then the latest answered.
  let nq = supabase.from("price_requests").select("*").order("created_at", { ascending: tab === "pending" }).limit(150);
  if (tab === "pending") nq = nq.eq("status", "pending");
  else if (tab === "approved") nq = nq.in("status", ["approved", "partly"]);
  const nativeRes = await nq;
  const native = ((nativeRes.error ? [] : nativeRes.data ?? []) as PrRow[]).filter((r) => !q || `${r.company_name} ${r.rep_name ?? ""} ${r.contact ?? ""}`.toLowerCase().includes(q));
  const ncounts = await lineCounts(supabase, native.map((r) => r.id));
  const rulesBtn = profile.role === "admin" && !nativeRes.error ? <Link href="/price-requests/rules" className="b2 quiet sm"><SlidersHorizontal size={16} /> Auto-approve rules</Link> : null;
  const nativeBlock = native.length ? (
    <section className="tg-sec">
      <b className="tg-h">In the app · {native.length}</b>
      <PrNativeList rows={native} counts={ncounts} showRep table />
    </section>
  ) : null;

  if (!jotformReady()) {
    const waitingN = native.filter((r) => r.status === "pending").length;
    const oldestN = waitingN ? Math.max(...native.filter((r) => r.status === "pending").map((r) => Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400_000))) : 0;
    return (
      <main className="shell wide">
        <div className="o2 pra">
          <div className="o2-head">
            <div className="o2-head-l">
              <Link href="/" className="o2-back" aria-label="Back to home"><ChevronLeft size={22} /></Link>
              <div className="o2-title">
                <h1>Price approvals</h1>
                <span className="o2-sub">{tab === "pending" ? `${waitingN} waiting${waitingN ? " · oldest first" : ""}` : `${native.length} shown`}</span>
              </div>
            </div>
            <div className="o2-head-r">{rulesBtn}</div>
          </div>
          {tab === "pending" && oldestN >= 7 ? (
            <div className="pra-warn" role="status"><Clock size={18} aria-hidden="true" /><span><b>The oldest has waited {oldestN} days.</b> Reps can&apos;t quote until you answer.</span></div>
          ) : null}
          <div className="stk-bar">
            <nav className="seg2" aria-label="Show">
              {TABS.map(([k, label]) => (
                <Link key={k} href={`/price-requests/approvals?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={tab === k ? "on" : undefined} aria-current={tab === k ? "page" : undefined}>{label}</Link>
              ))}
            </nav>
            <form className="stk-search" action="/price-requests/approvals" role="search">
              <Search size={18} aria-hidden="true" />
              <input type="hidden" name="tab" value={tab} />
              <input type="search" name="q" defaultValue={q} placeholder="Customer, contact or rep" aria-label="Search price requests" />
            </form>
          </div>
          {nativeBlock ?? <Empty icon="tag" title={tab === "pending" ? "Nothing waiting for approval" : "No price requests match"} />}
        </div>
      </main>
    );
  }

  const [{ data: staffRows }, linksRes, reviewsRes, nativeWaitRes, clearedBefore] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("role", ["employee", "admin"]).eq("demo", false),
    supabase.from("rep_name_links").select("rep_name, profile_id"),
    supabase.from("prf_reviews").select("submission_id, approved_by_name, approved_at"),
    supabase.from("price_requests").select("created_at").eq("status", "pending").limit(500),
    prfClearedBefore(supabase),
  ]);
  const nativeWaiting = ((nativeWaitRes.error ? [] : nativeWaitRes.data ?? []) as { created_at: string }[]).map((r) => r.created_at);
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

  // Old waiting ones the admin removed (they stay in Jotform).
  const removedN = items.filter((i) => isCleared(i, clearedBefore)).length;
  items = items.filter((i) => !isCleared(i, clearedBefore));
  const oldCut = Date.now() - OLD_DAYS * 86400_000;
  const oldN = items.filter((i) => i.status === "pending" && jfMs(i.created_at) <= oldCut).length;
  const isAdmin = profile.role === "admin";

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

  // How long each one has waited (Jotform dates are "YYYY-MM-DD HH:MM:SS", Central time).
  const daysSince = (v: string | null | undefined) => (v ? Math.max(0, Math.floor((Date.now() - jfMs(v)) / 86400_000)) : 0);
  const waitingAges = [
    ...nativeWaiting.map((v) => daysSince(v)),
    ...items.filter((i) => i.status === "pending").map((i) => daysSince(i.created_at)),
  ];
  const waitingN = waitingAges.length;
  const oldest = waitingN ? Math.max(...waitingAges) : 0;
  const href = (k: string) => `/price-requests/approvals?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className="shell wide">
      <div className="o2 pra">
        <div className="o2-head">
          <div className="o2-head-l">
            <Link href="/" className="o2-back" aria-label="Back to home"><ChevronLeft size={22} /></Link>
            <div className="o2-title">
              <h1>Price approvals</h1>
              <span className="o2-sub">{waitingN} waiting{waitingN ? " · oldest first" : ""}</span>
            </div>
          </div>
          <div className="o2-head-r">{rulesBtn}</div>
        </div>
        {error ? <div className="alert err">{error}</div> : null}
        {oldest >= 7 ? (
          <div className="pra-warn" role="status"><Clock size={18} aria-hidden="true" /><span><b>The oldest has waited {oldest} days.</b> Reps can&apos;t quote until you answer.</span></div>
        ) : null}
        {isAdmin && oldN ? (
          <form action={clearOldPrf} className="pra-old">
            <span><b>{oldN} {oldN === 1 ? "has" : "have"} waited {OLD_DAYS}+ days.</b> Take {oldN === 1 ? "it" : "them"} off the list? {oldN === 1 ? "It stays" : "They stay"} in Jotform.</span>
            <Submit className="b2 sm" pendingText="Removing…"><Trash2 size={15} /> Remove {oldN === 1 ? "it" : `all ${oldN}`}</Submit>
          </form>
        ) : null}

        <div className="stk-bar">
          <nav className="seg2" aria-label="Show">
            {TABS.map(([k, label]) => (
              <Link key={k} href={href(k)} className={tab === k ? "on" : undefined} aria-current={tab === k ? "page" : undefined}>
                {label} <span className="stk-n">{counts[k] + (k === "pending" ? nativeWaiting.length : 0)}</span>
              </Link>
            ))}
          </nav>
          <form className="stk-search" action="/price-requests/approvals" role="search">
            <Search size={18} aria-hidden="true" />
            <input type="hidden" name="tab" value={tab} />
            <input type="search" name="q" defaultValue={q} placeholder="Customer, contact or rep" aria-label="Search price requests" />
          </form>
        </div>

        {nativeBlock}
        {shown.length === 0 && !nativeBlock ? (
          <Empty icon="tag" title={tab === "pending" ? "Nothing waiting for approval" : "No price requests match"} />
        ) : shown.length ? (
          <section className="tg-sec">
            {nativeBlock ? <b className="tg-h">From Jotform · {shown.length}</b> : null}
            <div className="card2 pra-list">
              <div className="pra-row pra-cols" aria-hidden="true">
                <span>Customer</span><span>Sales rep</span><span className="num">Products</span><span>Sent</span><span>Waiting</span><span />
              </div>
              {shown.map((i) => {
                const r = reviews.get(i.id);
                const d = daysSince(i.created_at);
                return (
                  <Link key={i.id} className="pra-row" href={`/price-requests/${i.id}`} prefetch={false}>
                    <span className="pra-cust">
                      <b>{i.customer || i.contact || "Price request"}</b>
                      <span>{i.customer && i.contact ? i.contact : ""}</span>
                    </span>
                    <span className="pra-rep">{repOf(i)}</span>
                    <span className="num">{i.priced || "-"}</span>
                    <span className="pra-sent">{monthDay(i.created_at.slice(0, 10))}</span>
                    <span className="pra-wait">
                      {i.status === "pending" ? (
                        <span className={`pill2 sm ${d >= 14 ? "err" : d >= 3 ? "warn" : ""}`}>{d === 0 ? "Today" : `${d} ${d === 1 ? "day" : "days"}`}</span>
                      ) : i.status === "approved" ? (
                        <span className="pill2 ok sm">{r ? `Approved ${monthDay(r.approved_at)}` : "Approved"}</span>
                      ) : (
                        <span className="pill2 sm">No prices</span>
                      )}
                    </span>
                    <ChevronRight size={18} className="chev" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}
        {isAdmin && removedN ? (
          <form action={restoreOldPrf} className="pra-removed">
            <span>{removedN} old {removedN === 1 ? "request that" : "requests that"} waited {OLD_DAYS}+ days {removedN === 1 ? "was" : "were"} removed from this list.</span>
            <Submit className="link2" pendingText="Bringing back…"><ArchiveRestore size={14} /> Bring them back</Submit>
          </form>
        ) : null}
      </div>
    </main>
  );
}
