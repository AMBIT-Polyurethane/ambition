import Link from "next/link";
import { Bell, ChevronRight, Plus, RefreshCw, UserCheck } from "lucide-react";
import { requireActive, isEmployee } from "@/lib/session";
import { firstName, greeting, initials, orderNo, dateShort } from "@/lib/format";
import { Icon } from "@/components/icons";
import { BrandImg } from "@/components/brand";
import { JumpBackIn, RecentLink } from "@/components/recent";
import { can, seesOrders } from "@/lib/access";
import { docProducts } from "@/lib/docs";
import { arrangeApps, parseLayout } from "@/lib/home-apps";
import { homeApps } from "@/lib/home-apps-server";
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

/** Credit applications and account setups nobody has decided on yet (admins). Never holds up the home screen. */
async function creditWaiting(supabase: Awaited<ReturnType<typeof requireActive>>["supabase"]): Promise<number> {
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
  const emp = isEmployee(profile);
  const admin = profile.role === "admin";
  const canOrder = !emp || can(profile, "ordering");

  const desk = emp && can(profile, "order_desk");
  const credit = emp && can(profile, "credit_check");
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);

  const [noRole, needPo, toSchedule, needCredit, pending, newOrders, waitingApps, lastOrderRes, tsbRes, docsRes, coursesRes] = await Promise.all([
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
  ]);

  const apps = arrangeApps(
    await homeApps(supabase, profile, { desk: needPo + toSchedule + needCredit, credit: waitingApps }),
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
          <Link href="/profile" className="avatar grad" aria-label="Profile">{initials(profile.full_name, profile.email)}</Link>
        </div>
      </header>

      <div className="col" style={{ gap: 2 }}>
        <h1 className="hello">{greeting()}, {firstName(profile.full_name, profile.email)}</h1>
        <span className="muted small">
          {emp ? "Here's what's moving at AMBIT today." : `${profile.company?.name ?? "Welcome to AMBITION"}${profile.company?.account_no ? ` · ${profile.company.account_no}` : ""}`}
        </span>
      </div>

      {sp.password === "updated" ? <div className="alert ok">Your password was updated.</div> : null}
      {pending > 0 ? (
        <Link href="/admin/users" className="alert warn" style={{ alignItems: "center" }}>
          <UserCheck size={18} />
          <span className="grow"><b>{pending}</b> access {pending === 1 ? "request is" : "requests are"} waiting for approval</span>
          <ChevronRight size={18} />
        </Link>
      ) : null}
      {noRole > 0 ? (
        <Link href="/admin/users?tab=norole" className="alert warn" style={{ alignItems: "center" }}>
          <UserCheck size={18} />
          <span className="grow"><b>{noRole}</b> staff {noRole === 1 ? "account needs" : "accounts need"} a job role</span>
          <ChevronRight size={18} />
        </Link>
      ) : null}

      {/* Your apps */}
      <section className="section">
        <div className="row between" style={{ alignItems: "baseline" }}>
          <span className="sec-title">Your apps</span>
          <Link href="/profile/apps" className="sec-link">Edit</Link>
        </div>
        <div className="apps-grid">
          {apps.map((a) => {
            const inner = (
              <>
                <span className="app-ic" style={{ ["--c" as string]: a.color }}>
                  <Icon name={a.icon} size={28} />
                  {a.badge ? <span className="bdg">{a.badge > 99 ? "99+" : a.badge}</span> : null}
                </span>
                <span className="lbl">{a.label}</span>
              </>
            );
            return a.external ? (
              <a key={a.key} className="app" href={a.href} target="_blank" rel="noopener noreferrer">{inner}</a>
            ) : (
              <Link key={a.key} className="app" href={a.href}>{inner}</Link>
            );
          })}
        </div>
      </section>

      {/* Order: start a new one or repeat the last one */}
      {canOrder ? (
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
      ) : null}

      <JumpBackIn uid={profile.id} />

      {/* Tech bulletins */}
      {tsbs.length ? (
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
      ) : null}

      {/* Products */}
      {products.length ? (
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
      ) : null}

      {/* Academy */}
      {course ? (
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
      ) : null}
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
