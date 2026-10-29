import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Bell, CalendarClock, ChevronRight, Landmark, Plus, RefreshCw, Sparkles, UserCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActive, isEmployee } from "@/lib/session";
import { opsMember } from "@/lib/ops/roles";
import { firstName, greeting, initials, orderNo, dateShort } from "@/lib/format";
import { BrandImg } from "@/components/brand";
import { JumpBackIn, RecentLink } from "@/components/recent";
import { can, seesOrders } from "@/lib/access";
import { docProducts } from "@/lib/docs";
import { arrangeApps, homeTiles, parseLayout } from "@/lib/home-apps";
import { HomeGrid } from "@/components/home-grid";
import { homeApps } from "@/lib/home-apps-server";
import { homePromos } from "@/lib/promos";
import { PromoBanner } from "@/components/promo-banner";
import { reorderCount } from "@/lib/inventory/view";
import { customersDue, reorderNudge } from "@/lib/reorder";
import { companyTax, taxCounts, taxOverview } from "@/lib/tax-server";
import { widgetsFor } from "@/lib/widgets";
import { roleCards, type BoardCard } from "@/components/home-widgets";
import { OutlookCalendarWidget, OutlookMailWidget } from "@/components/outlook-widgets";
import { CustomizeButton, HomeBoard } from "@/components/home-board";
import { arrangeBoard, parseHomeLayout } from "@/lib/home-board";
import { Suspense } from "react";
import { Loading } from "@/components/home-widgets";
import type { Course, DocumentRow, Order } from "@/lib/types";

export const dynamic = "force-dynamic";

// Product cards on the home screen: one strong color per product line.
const PRODUCT_ART = [
  ["#14B8A6", "#0F766E"],
  ["#A78BFA", "#6D28D9"],
  ["#FBBF24", "#B45309"],
  ["#38BDF8", "#0369A1"],
  ["#FB7185", "#BE123C"],
  ["#4ADE80", "#15803D"],
];

/**
 * Credit applications and account setups nobody has decided on yet (admins). It asks Jotform, which is slow, so the
 * answer is kept for 5 minutes (the same for every admin) and the home screen never waits more than 1.2 seconds.
 */
async function creditWaiting(supabase: Awaited<ReturnType<typeof requireActive>>["supabase"]): Promise<number> {
  const cached = unstable_cache(() => creditWaitingNow(supabase), ["home-credit-waiting"], { revalidate: 300 });
  return Promise.race([cached().catch(() => 0), new Promise<number>((resolve) => setTimeout(() => resolve(0), 1200))]);
}

async function creditWaitingNow(supabase: Awaited<ReturnType<typeof requireActive>>["supabase"]): Promise<number> {
  try {
    const [{ hubForms, formSubmissions, reviewable }, { extraForms, reviewsFor }] = await Promise.all([
      import("@/lib/forms"),
      import("@/app/(app)/admin/forms/reviews"),
    ]);
    const work = (async () => {
      const forms = (await hubForms(await extraForms(supabase))).filter((f) => reviewable(f.kind));
      if (!forms.length) return 0;
      const reviews = await reviewsFor(supabase);
      const lists = await Promise.all(forms.map((f) => formSubmissions(f.id, 120).catch(() => [])));
      return lists.flat().filter((s) => !reviews.has(s.id)).length;
    })();
    const timeout = new Promise<number>((resolve) => setTimeout(() => resolve(0), 2500));
    return await Promise.race([work, timeout]);
  } catch {
    return 0;
  }
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireActive();
  // AMBIT-OPS contractors: their business is home.
  if (opsMember(profile)) redirect(sp.msg ? `/ops?msg=${encodeURIComponent(sp.msg)}` : "/ops");
  const emp = isEmployee(profile);
  const admin = profile.role === "admin";
  const canOrder = !emp || can(profile, "ordering");

  const w = widgetsFor(profile);
  const desk = emp && can(profile, "order_desk");
  const credit = emp && can(profile, "credit_check");
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);

  const [noRole, needPo, toSchedule, needCredit, pending, newOrders, waitingApps, lastOrderRes, tsbRes, docsRes, coursesRes, promos] = await Promise.all([
    admin ? count(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active").eq("role", "employee").is("job_role", null)) : 0,
    desk ? count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("stage", "needs_po")) : 0,
    desk ? count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("stage", "schedule")) : 0,
    credit ? count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("stage", "credit")) : 0,
    admin ? count(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending")) : 0,
    emp && seesOrders(profile) ? count(supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "new")) : 0,
    admin ? creditWaiting(supabase) : 0,
    // Reorder repeats this: a contractor's company's latest order, or the last order this staff member placed.
    canOrder
      ? (emp
          ? supabase.from("orders").select("id, order_no, company_name, created_at, order_items(id)").eq("placed_by", profile.id)
          : supabase.from("orders").select("id, order_no, company_name, created_at, order_items(id)")
        )
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("documents").select("id, title, code, published_on, sort").eq("active", true).eq("doc_type", "TSB").order("published_on", { ascending: false, nullsFirst: false }).order("code", { ascending: false }).limit(8),
    supabase.from("documents").select("product, products, doc_type, sort").eq("active", true).order("sort"),
    supabase.from("courses").select("*").order("sort"),
    homePromos(supabase, profile),
  ]);

  // Smart reorder and sales-tax certificates (migration 0021). Each one quietly shows nothing if it isn't set up yet.
  const myCompany = !emp ? profile.company_id : null;
  const [nudge, myTax, due, taxRows] = await Promise.all([
    myCompany ? reorderNudge(supabase, myCompany).catch(() => null) : null,
    myCompany ? companyTax(supabase, myCompany).catch(() => null) : null,
    emp && can(profile, "ordering") ? customersDue(supabase, 200).catch(() => null) : null,
    emp && (credit || admin) ? taxOverview(supabase).catch(() => null) : null,
  ]);
  const tax = taxRows ? taxCounts(taxRows) : null;
  const taxWork = tax ? tax.expired + tax.soon + tax.pending : 0;
  const weekday = (iso: string) => {
    const d = new Date(iso + "T12:00:00Z");
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    return iso === tomorrow ? "tomorrow" : d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  };

  const apps = arrangeApps(
    await homeApps(supabase, profile, {
      desk: needPo + toSchedule + needCredit,
      credit: waitingApps,
      tax: taxWork,
      due: due?.length ?? 0,
      inventory: emp && can(profile, "inventory") ? await reorderCount(supabase, profile.branch_id) : 0,
    }),
    parseLayout(profile.home_apps),
  );

  const lastOrder = lastOrderRes.data as (Pick<Order, "id" | "order_no" | "company_name" | "created_at"> & { order_items: { id: number }[] }) | null;
  const tsbs = (tsbRes.data ?? []) as Pick<DocumentRow, "id" | "title" | "code">[];
  const productCounts = new Map<string, number>();
  for (const d of (docsRes.data ?? []) as DocumentRow[]) {
    if (d.doc_type === "TSB" || d.doc_type === "Industry") continue;
    for (const p of docProducts(d)) productCounts.set(p, (productCounts.get(p) ?? 0) + 1);
  }
  const products = [...productCounts.entries()].slice(0, 8);
  const courses = (coursesRes.data ?? []) as Course[];
  const course = courses.find((c) => c.status === "live" && c.url) ?? courses[0] ?? null;
  const tsbNo = (d: Pick<DocumentRow, "code" | "title">) => (d.code ?? d.title).match(/(\d{1,4})/)?.[1] ?? "TSB";
  const tsbTitle = (t: string) => t.replace(/^TSB[\s-]*\d+\s*[:\-–·]?\s*/i, "") || t;

  // ---- The Home board: every card, in the order this person chose (Customize), minus the ones they hid.
  const saved = parseHomeLayout(profile.home_layout);
  const skip = new Set(saved?.hidden ?? []);
  const show = (key: string, node: () => React.ReactNode) => (skip.has(key) ? null : node());
  const roles = await roleCards({ db: supabase, profile, known: { access: pending, roles: noRole, apps: waitingApps, due, tax }, skip });
  const cards: BoardCard[] = [...roles];
  if (emp) {
    cards.push({
      key: "outlook-cal",
      title: "Outlook calendar",
      node: show("outlook-cal", () => (
        <Suspense fallback={<Loading title="Outlook calendar" />}>
          <OutlookCalendarWidget profile={profile} />
        </Suspense>
      )),
    });
    cards.push({
      key: "outlook-mail",
      title: "Outlook inbox",
      node: show("outlook-mail", () => (
        <Suspense fallback={<Loading title="Outlook inbox" />}>
          <OutlookMailWidget profile={profile} />
        </Suspense>
      )),
    });
  }
  if (promos.length) cards.push({ key: "promo", title: "News & sales", node: show("promo", () => <PromoBanner slides={promos} />) });
  cards.push({
    key: "apps",
    title: "Your apps",
    node: show("apps", () => (
      <section className="section">
        <div className="row between" style={{ alignItems: "baseline" }}>
          <span className="sec-title">Your apps</span>
          <Link href="/profile/apps" className="sec-link">Edit</Link>
        </div>
        <HomeGrid tiles={homeTiles(apps)} />
      </section>
    )),
  });
  if (canOrder) {
    cards.push({
      key: "order",
      title: "Place an order",
      node: show("order", () => (
        <section className="order-card">
          <img src="/brand/atom-mark.png" alt="" className="atom" />
          <span className="kick">Order</span>
          <h2 className="big">Place an Order</h2>
          <div className="btns">
            <Link href="/order" className="b1"><Plus size={18} strokeWidth={2.6} /> Start order</Link>
            {lastOrder ? (
              <Link href={`/order?reorder=${lastOrder.id}`} className="b2"><RefreshCw size={17} strokeWidth={2.4} /> Reorder</Link>
            ) : null}
          </div>
          {lastOrder ? (
            <Link href={`/orders/${lastOrder.id}`} className="last">
              <span className="lk">Last</span>
              <span className="grow ellipsis">
                {orderNo(lastOrder.order_no)}
                {emp ? ` · ${lastOrder.company_name}` : ""} · {lastOrder.order_items.length} {lastOrder.order_items.length === 1 ? "item" : "items"} · {dateShort(lastOrder.created_at)}
              </span>
              <ChevronRight size={16} />
            </Link>
          ) : (
            <span className="last" style={{ opacity: 0.85 }}>Your past orders show here, ready to reorder in one tap.</span>
          )}
        </section>
      )),
    });
  }
  cards.push({ key: "jump", title: "Jump back in", node: show("jump", () => <JumpBackIn uid={profile.id} />) });
  if (tsbs.length) {
    cards.push({
      key: "tsb",
      title: "Tech bulletins",
      node: show("tsb", () => (
        <section className="section">
          <div className="row between" style={{ alignItems: "baseline" }}>
            <span className="sec-title">Tech bulletins</span>
            <Link href="/docs?type=tsb" className="sec-link">Show all</Link>
          </div>
          <div className="rail">
            {tsbs.map((d) => (
              <RecentLink
                key={d.id}
                uid={profile.id}
                className="tsb-card"
                item={{ kind: "tsb", href: `/docs/open/${d.id}`, title: tsbTitle(d.title), sub: "Bulletin", code: tsbNo(d), external: true }}
              >
                <span className="cover">
                  <span className="kk">AMBIT TSB</span>
                  <span className="num">{tsbNo(d)}</span>
                </span>
                <span className="tt">{tsbTitle(d.title)}</span>
              </RecentLink>
            ))}
          </div>
        </section>
      )),
    });
  }
  if (products.length) {
    cards.push({
      key: "products",
      title: "AMBIT products",
      node: show("products", () => (
        <section className="section">
          <div className="row between" style={{ alignItems: "baseline" }}>
            <span className="sec-title">AMBIT products</span>
            <Link href="/docs" className="sec-link">TDS · SDS · ESR</Link>
          </div>
          <div className="rail">
            {products.map(([name, n], i) => {
              const [c1, c2] = PRODUCT_ART[i % PRODUCT_ART.length];
              return (
                <Link key={name} className="prod-card" href={`/docs?product=${encodeURIComponent(name)}`} style={{ background: `linear-gradient(140deg, ${c1} 0%, ${c2} 100%)` }}>
                  <span className="pk">{n} {n === 1 ? "doc" : "docs"}</span>
                  <span className="pn">{name}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )),
    });
  }
  if (course) {
    cards.push({
      key: "learn",
      title: "Keep learning",
      node: show("learn", () => (
        <section className="section">
          <span className="sec-title">Keep learning</span>
          {course.status === "live" && course.url ? (
            <a className="learn" href={course.url} target="_blank" rel="noopener noreferrer">
              <LearnInner course={course} />
            </a>
          ) : (
            <Link className="learn" href="/academy">
              <LearnInner course={course} />
            </Link>
          )}
        </section>
      )),
    });
  }
  const defaults = cards.map((c) => c.key);
  const layout = arrangeBoard(defaults, saved);
  const board = cards.map((c) => ({ key: c.key, title: c.title, node: c.node }));

  return (
    <main className="shell home">
      <header className="row between" style={{ paddingTop: 8 }}>
        <span><BrandImg art="logo" alt="AMBIT Polyurethane" style={{ height: 26, width: "auto" }} /></span>
        <div className="row" style={{ gap: 10 }}>
          {emp && seesOrders(profile) ? (
            <Link href="/orders?status=new" className="iconbtn" aria-label={`${newOrders} new orders`} style={{ position: "relative" }}>
              <Bell size={20} />
              {newOrders > 0 ? <span className="dot-badge">{newOrders}</span> : null}
            </Link>
          ) : null}
          <CustomizeButton />
          <Link href="/profile" className="avatar grad" aria-label="Profile">{initials(profile.full_name, profile.email)}</Link>
        </div>
      </header>

      <div className="col" style={{ gap: 2 }}>
        <h1 className="hello">{greeting()}, {firstName(profile.full_name, profile.email)}</h1>
        <span className="muted small">
          {emp ? "Here's what's moving at AMBIT today." : `${profile.company?.name ?? "Welcome to AMBIT Intelligence"}${profile.company?.account_no ? ` · ${profile.company.account_no}` : ""}`}
        </span>
      </div>

      {apps.some((a) => a.key === "ask") ? (
        <Link href="/assistant" className="ask-bar">
          <Sparkles size={18} />
          <span className="grow ellipsis">Ask AMBIT about products, building science, codes or the app…</span>
          <ChevronRight size={18} />
        </Link>
      ) : null}

      {sp.password === "updated" ? <div className="alert ok">Your password was updated.</div> : null}
      {sp.outlook ? <div className="alert ok small" role="status">Outlook connected ({sp.outlook}). Your inbox and calendar show below.</div> : null}
      {sp.outlook_err ? <div className="alert err small" role="alert">{sp.outlook_err}</div> : null}
      {sp.welcome ? (
        <div className="alert ok">You&apos;re all set. Welcome to AMBIT Intelligence! Tip: on your phone, use Share → &ldquo;Add to Home Screen&rdquo; to open it like an app.</div>
      ) : null}
      {/* Admins see these in the "Waiting on you" card instead. */}
      {pending > 0 && !w.admin ? (
        <Link href="/admin/users" className="alert warn" style={{ alignItems: "center" }}>
          <UserCheck size={18} />
          <span className="grow"><b>{pending}</b> access {pending === 1 ? "request is" : "requests are"} waiting for approval</span>
          <ChevronRight size={18} />
        </Link>
      ) : null}
      {noRole > 0 && !w.admin ? (
        <Link href="/admin/users?tab=norole" className="alert warn" style={{ alignItems: "center" }}>
          <UserCheck size={18} />
          <span className="grow"><b>{noRole}</b> staff {noRole === 1 ? "account needs" : "accounts need"} a job role</span>
          <ChevronRight size={18} />
        </Link>
      ) : null}

      {myTax && (myTax.state === "expiring" || myTax.state === "expired" || myTax.state === "missing" || myTax.state === "pending") ? (
        <Link href="/profile#tax" className={`home-alert ${myTax.state === "expiring" || myTax.state === "pending" ? "warn" : "err"}`}>
          <span className="ic"><Landmark size={19} /></span>
          <span className="grow col tight">
            <span className="t">
              {myTax.state === "expiring"
                ? `Your sales-tax exemption certificate expires in ${myTax.days_left} day${myTax.days_left === 1 ? "" : "s"}`
                : myTax.state === "expired"
                  ? "Your sales-tax exemption certificate has expired"
                  : myTax.state === "pending"
                    ? "AMBIT Accounting is checking your new certificate"
                    : "We need your sales-tax exemption certificate"}
            </span>
            <span className="s">
              {myTax.state === "pending"
                ? "Nothing to do. Orders wait at credit check until it's verified."
                : myTax.state === "expiring"
                  ? "Upload the renewed one so your orders stay tax-exempt."
                  : "Upload a current one, or orders are held at credit check (or sales tax is charged)."}
            </span>
          </span>
          <ChevronRight size={18} />
        </Link>
      ) : null}
      {taxWork > 0 && tax && !w.admin && !w.credit ? (
        <Link href="/tax" className={`home-alert ${tax.expired ? "err" : "warn"}`}>
          <span className="ic"><Landmark size={19} /></span>
          <span className="grow col tight">
            <span className="t">Sales-tax certificates need attention</span>
            <span className="s">
              {[
                tax.expired ? `${tax.expired} expired or missing` : "",
                tax.soon ? `${tax.soon} expiring within 30 days` : "",
                tax.pending ? `${tax.pending} waiting for you to verify` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <ChevronRight size={18} />
        </Link>
      ) : null}
      {due?.length && !(w.goals && profile.job_role === "sales_rep") ? (
        <Link href="/orders/due" className="home-alert">
          <span className="ic"><CalendarClock size={19} /></span>
          <span className="grow col tight">
            <span className="t">{due.length} customer{due.length === 1 ? " is" : "s are"} overdue to order</span>
            <span className="s">
              {due.slice(0, 3).map((c) => c.company_name).join(", ")}
              {due.length > 3 ? ` and ${due.length - 3} more` : ""}
            </span>
          </span>
          <ChevronRight size={18} />
        </Link>
      ) : null}

      {/* Smart reorder: "You usually order 4 drums of AMBI-SEAL 5.0 every 3 weeks." */}
      {nudge ? (
        <section className="smart-card">
          <span className="eyebrow" style={{ display: "flex", gap: 6, alignItems: "center" }}><RefreshCw size={14} /> Time to reorder?</span>
          <p>
            {nudge.text} Reorder for {weekday(nudge.date)}?
          </p>
          {nudge.others.length ? (
            <span className="small muted">Also about due: {nudge.others.slice(0, 4).map((o) => o.name).join(", ")}</span>
          ) : null}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link href="/order?smart=1" className="btn sm dark"><RefreshCw size={15} /> Reorder for {weekday(nudge.date)}</Link>
            <Link href="/order?smart=all" className="btn sm">Everything I usually order</Link>
          </div>
        </section>
      ) : null}

      <HomeBoard items={board} defaults={defaults} initial={layout} />
    </main>
  );
}

function LearnInner({ course }: { course: Course }) {
  const meta = [course.lessons ? `${course.lessons} lessons` : null, course.minutes ? `${course.minutes} min` : null].filter(Boolean).join(" · ");
  return (
    <>
      <span className="art">
        <img src="/brand/academy-mark.png" alt="" />
      </span>
      <span className="col grow" style={{ gap: 4, minWidth: 0 }}>
        <span className="kk">AMBIT Academy</span>
        <span className="tt">{course.title}</span>
        <span className="tiny muted">{course.status === "live" ? meta || "Start the course" : `Coming soon${meta ? ` · ${meta}` : ""}`}</span>
      </span>
      <ChevronRight size={18} className="faint" />
    </>
  );
}
