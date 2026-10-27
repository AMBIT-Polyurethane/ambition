import Link from "next/link";
import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, FileCheck, Landmark, OctagonAlert, UserCheck, UserCog } from "lucide-react";
import { money, qtyText } from "@/lib/format";
import { todayCentral } from "@/lib/sale";
import type { DueCustomer } from "@/lib/reorder";
import type { taxCounts } from "@/lib/tax-server";
import {
  calendar,
  countsWaiting,
  creditQueue,
  deskQueue,
  inventoryBranches,
  movers,
  salesSummary,
  spotChecks,
  spotOverview,
  widgetsFor,
} from "@/lib/widgets";
import { SpotCheckForm } from "@/components/count-input";
import { GoalCardBody, TeamGoals } from "@/components/goal-views";
import { monthGone, sum } from "@/lib/sales-goals";
import { goalBoard } from "@/lib/sales-goals-server";
import { WeekCalendar } from "@/components/week-calendar";
import type { Profile } from "@/lib/types";

// Home screen widgets, by job: a few cards that answer "what needs me today?" at a glance. Each card loads on its
// own (the rest of Home never waits for it) and links to where the work is done.

type Db = SupabaseClient;
type TaxCounts = ReturnType<typeof taxCounts>;
/** What Home has already looked up, so the widgets don't ask twice. */
export type HomeKnown = { access: number; roles: number; apps: number; due: DueCustomer[] | null; tax: TaxCounts | null };
const whole = (n: number) => money(Math.round(n)).replace(/\.00$/, "");
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
/** $20,611 → $20.6k (for tight spots). */
const short = (n: number) => (n >= 1000 ? `$${Number((n / 1000).toFixed(n >= 100000 ? 0 : 1))}k` : whole(n));
const ordersWord = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;
/** "↑ 12% vs. this point last month" (orders), or nothing when there's nothing to compare with. */
function Versus({ now, last }: { now: number; last: number }) {
  const change = pct(now, last);
  if (change === null) return null;
  return (
    <>
      {" · "}
      {change >= 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
      {Math.abs(change)}% vs. this point last month ({last})
    </>
  );
}
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

function Card({ title, href, link, children, tone }: { title: string; href?: string; link?: string; children: React.ReactNode; tone?: "warn" | "err" }) {
  return (
    <section className={`wg${tone ? ` ${tone}` : ""}`}>
      <div className="wg-head">
        <span className="wg-title">{title}</span>
        {href ? (
          <Link href={href} className="wg-link">
            {link ?? "Open"} <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <section className="wg" aria-busy="true">
      <div className="wg-head"><span className="wg-title">{title}</span></div>
      <span className="skel block" style={{ height: 70 }} />
    </section>
  );
}

/** A row in a list of things waiting: count, what, where to go. */
function Row({ n, label, href, tone, icon }: { n: number; label: string; href: string; tone?: "warn" | "err"; icon?: React.ReactNode }) {
  return (
    <Link href={href} className={`wg-row${n && tone ? ` ${tone}` : ""}${n ? "" : " zero"}`}>
      {icon ?? null}
      <b>{n}</b>
      <span className="grow">{label}</span>
      <ChevronRight size={15} />
    </Link>
  );
}

// ------------------------------------------------------------------ warehouse: spot check
async function SpotWidget({ db, branch, branchName }: { db: Db; branch: string; branchName: string }) {
  const s = await spotChecks(db, branch);
  if (!s) return null;
  const missed = s.missed.length;
  return (
    <Card title="Daily spot check" href={`/inventory/spot?b=${branch}`} link={missed ? "Count missed" : "Spot checks"} tone={missed ? "err" : undefined}>
      {missed ? (
        <Link href={`/inventory/spot?b=${branch}`} className="wg-alert err" role="alert">
          <OctagonAlert size={17} aria-hidden="true" />
          <span className="grow"><b>{missed} spot {missed === 1 ? "check" : "checks"} to complete</b> · missed on {s.missed.slice(0, 3).map((c) => dayLabel(c.day).split(",")[0]).join(", ")}{missed > 3 ? "…" : ""}</span>
          <ChevronRight size={16} />
        </Link>
      ) : null}
      {!s.today ? (
        <p className="small muted" style={{ margin: 0 }}>No spot check today (weekends are off).</p>
      ) : s.today.status === "open" ? (
        <SpotCheckForm lines={s.today.lines} day={dayLabel(s.today.day)} label={branchName} />
      ) : (
        <div className={`spot-done ${s.today.status === "submitted" ? "warn" : "ok"}`}>
          {s.today.status === "submitted" ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
          <span>
            <b>{s.today.lines[0]?.sku}</b> {s.today.status === "submitted" ? "counted: the difference is waiting for an admin." : "counted. Done for today."}
          </span>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ warehouse / CRM: the week
async function CalendarWidget({ db, branch, branchName, canAdd }: { db: Db; branch: string; branchName: string; canAdd: boolean }) {
  const days = await calendar(db, branch);
  const total = days.reduce((a, d) => a + d.items.length, 0);
  return (
    <Card title={`This week · ${branchName}`} href={`/orders?stage=scheduled&b=${branch}`} link="Orders">
      {total === 0 && !canAdd ? <p className="small muted" style={{ margin: 0 }}>No pickups, deliveries or incoming trucks this week.</p> : null}
      <WeekCalendar days={days} addHref={canAdd ? `/inventory/incoming/new?b=${branch}` : undefined} />
    </Card>
  );
}

// ------------------------------------------------------------------ CRM: the order desk queue
async function QueueWidget({ db }: { db: Db }) {
  const q = await deskQueue(db);
  return (
    <Card title="Your order desk" href="/orders/desk" link="Order desk">
      <div className="wg-rows">
        <Row n={q.needsPo} label="need a Sales Order # and Invoice #" href="/orders?stage=needs_po" tone="warn" />
        <Row n={q.toSchedule} label="released, need a date" href="/orders?stage=schedule" tone="warn" />
        <Row n={q.today} label="picking up or delivering today" href={`/orders?stage=scheduled&day=${todayCentral()}`} />
        {q.late ? <Row n={q.late} label="past their pickup / delivery date" href="/orders?stuck=1" tone="err" /> : null}
        <Row n={q.customer} label="waiting on the customer" href="/orders?stage=customer" />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Accounting: credit
async function CreditWidget({ db, t }: { db: Db; t: TaxCounts | null }) {
  const q = await creditQueue(db);
  return (
    <Card title="Credit approvals" href="/orders?stage=credit" link="Credit checks">
      <div className="wg-rows">
        <Row n={q.credit} label="waiting for a credit check" href="/orders?stage=credit" tone="warn" />
        <Row n={q.hold} label="on credit hold" href="/orders?stage=hold" />
        {t ? (
          <>
            <Row n={t.pending} label="tax certificates to verify" href="/tax" tone="warn" />
            <Row n={t.expired + t.soon} label="tax certificates expired or expiring" href="/tax" tone="err" />
          </>
        ) : null}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Sales reps and warehouse managers: goals
async function GoalsWidget({ db, profile, due }: { db: Db; profile: Profile; due: DueCustomer[] | null }) {
  const board = await goalBoard(db);
  const me = board?.people.find((p) => p.id === profile.id);
  if (!board || !me) return null;
  const rep = profile.job_role === "sales_rep";
  if (!sum(me.goals) && !sum(me.sold) && !rep && profile.job_role !== "warehouse") return null;
  const month = new Date(`${board.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return (
    <Card title={`Your sales goals · ${month}`} href="/sales-goals" link="Details">
      <GoalCardBody p={me} gone={monthGone(board.month, todayCentral())} compact />
      {due?.length ? (
        <Link href="/orders/due" className="wg-row warn">
          <b>{due.length}</b>
          <span className="grow ellipsis">overdue to order: {due.slice(0, 2).map((c) => c.company_name).join(", ")}{due.length > 2 ? "…" : ""}</span>
          <ChevronRight size={15} />
        </Link>
      ) : null}
      <p className="tiny faint" style={{ margin: 0 }}>
        {me.basis === "branch" ? "Every order from your location" : "Your customers' orders"}, at the invoice prices the order desk enters.
      </p>
    </Card>
  );
}

/** Admin: every rep's and warehouse manager's month against their goal. */
async function TeamGoalsWidget({ db }: { db: Db }) {
  const board = await goalBoard(db);
  if (!board || !board.people.length) {
    return (
      <Card title="Sales goals" href="/admin/sales-goals" link="Set goals">
        <p className="small muted" style={{ margin: 0 }}>No sales reps or warehouse managers yet.</p>
      </Card>
    );
  }
  const set = board.people.some((p) => sum(p.goals) > 0);
  return (
    <Card title="Sales goals" href="/sales-goals" link="All groups">
      {set ? null : (
        <Link href="/admin/sales-goals" className="wg-row warn">
          <span className="grow">No goals set yet: set them in Admin → Sales goals</span>
          <ChevronRight size={15} />
        </Link>
      )}
      <TeamGoals people={board.people} gone={monthGone(board.month, todayCentral())} href={(p) => `/sales-goals?p=${p.id}`} />
    </Card>
  );
}

// ------------------------------------------------------------------ Admin
async function WaitingWidget({ db, known }: { db: Db; known: HomeKnown }) {
  const counts = await countsWaiting(db).catch(() => []);
  const { access, roles, apps, tax } = known;
  const all = counts.length + access + roles + apps + (tax ? tax.pending + tax.expired + tax.soon : 0);
  return (
    <Card title="Waiting on you" tone={all ? "warn" : undefined}>
      {all === 0 ? (
        <div className="spot-done ok"><CircleCheck size={18} /> Nothing waiting. All caught up.</div>
      ) : (
        <div className="wg-rows">
          {counts.length ? <Row n={counts.length} label={`inventory ${counts.length === 1 ? "count differs" : "counts differ"} from the app: approve`} href={counts.length === 1 ? `/inventory/counts/${counts[0].id}` : `/inventory/counts?b=${counts[0].branch_id}`} tone="warn" icon={<ClipboardCheck size={15} />} /> : null}
          {apps ? <Row n={apps} label="credit applications / account setups" href="/admin/forms" tone="warn" icon={<FileCheck size={15} />} /> : null}
          {access ? <Row n={access} label={`access ${access === 1 ? "request" : "requests"}`} href="/admin/users" tone="warn" icon={<UserCheck size={15} />} /> : null}
          {roles ? <Row n={roles} label={`staff ${roles === 1 ? "account needs" : "accounts need"} a job role`} href="/admin/users?tab=norole" icon={<UserCog size={15} />} /> : null}
          {tax?.pending ? <Row n={tax.pending} label="tax certificates to verify" href="/tax" icon={<Landmark size={15} />} /> : null}
          {tax && tax.expired + tax.soon ? <Row n={tax.expired + tax.soon} label="tax certificates expired or expiring" href="/tax" tone={tax.expired ? "err" : undefined} icon={<Landmark size={15} />} /> : null}
        </div>
      )}
    </Card>
  );
}

async function SalesWidget({ db }: { db: Db }) {
  const s = await salesSummary(db);
  const max = Math.max(1, ...s.byBranch.map((b) => b.orders));
  const topMax = Math.max(1, ...s.top.slice(0, 3).map((t) => t.orders));
  return (
    <Card title={`Sales · ${s.month}`} href="/orders/desk?r=30" link="Order desk">
      <div className="wg-big">
        <b>{ordersWord(s.orders)}</b>
        <span className="small muted">
          {whole(s.total)} so far
          <Versus now={s.orders} last={s.lastOrders} />
        </span>
      </div>
      {s.byBranch.length ? (
        <>
          <div className="wg-sub">By location</div>
          <div className="wg-bars">
            {s.byBranch.map((b) => (
              <Link key={b.id} href={`/orders?b=${b.id}&from=${todayCentral().slice(0, 8)}01&to=${todayCentral()}`} className="wg-bar">
                <span className="nm">{b.name}</span>
                <span className="track"><i style={{ width: `${(b.orders / max) * 100}%` }} /></span>
                <span className="v">{ordersWord(b.orders)}{b.total > 0 ? <span className="faint"> · {short(b.total)}</span> : null}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>No orders yet this month.</p>
      )}
      {s.top.length ? (
        <>
          <div className="wg-sub">Top products <span className="lc">· on the most orders</span></div>
          <ol className="wg-top">
            {s.top.slice(0, 3).map((t) => (
              <li key={t.sku}>
                <span className="nm2">
                  <span className="ellipsis"><b>{t.name || t.sku}</b></span>
                  <span className="tiny faint ellipsis">{t.sku} · {qtyText(Number(t.qty.toFixed(2)), t.unit ?? "")}{t.total > 0 ? ` · ${whole(t.total)}` : ""}</span>
                </span>
                <span className="track" aria-hidden="true"><i style={{ width: `${(t.orders / topMax) * 100}%` }} /></span>
                <span className="v">{t.orders} {t.orders === 1 ? "order" : "orders"}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <p className="tiny faint" style={{ margin: 0 }}>Orders placed in the app. Dollars are the invoice prices the order desk enters (list prices until then). QuickBooks sales come later.</p>
    </Card>
  );
}

async function MovementWidget({ db }: { db: Db }) {
  const [m, spots, branches] = await Promise.all([movers(db), spotOverview(db).catch(() => new Map()), db.from("branches").select("id, name").order("sort")]);
  const names = new Map(((branches.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const line = (x: { sku: string; name: string; unit: string; now: number; before: number }, up: boolean) => (
    <li key={x.sku}>
      {up ? <ArrowUpRight size={15} className="up" aria-label="Selling faster" /> : <ArrowDownRight size={15} className="down" aria-label="Selling slower" />}
      <span className="grow ellipsis" title={x.sku}><b>{x.name || x.sku}</b></span>
      <span className="v">{Number(x.before.toFixed(2))} → <b>{Number(x.now.toFixed(2))}</b></span>
    </li>
  );
  return (
    <Card title="Inventory movement" href="/inventory" link="Inventory">
      <div className="wg-sub">Units ordered <span className="lc">· last 30 days vs. the 30 before</span></div>
      {m.up.length || m.down.length ? (
        <ul className="wg-move">
          {m.up.map((x) => line(x, true))}
          {m.down.map((x) => line(x, false))}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Not enough orders yet to show a trend.</p>
      )}
      {spots.size ? (
        <>
          <div className="wg-sub">Spot checks</div>
          <div className="wg-rows">
            {[...spots.entries()].map(([b, v]) => (
              <Link key={b} href={`/inventory/spot?b=${b}`} className={`wg-row${v.missed ? " err" : ""}`}>
                {v.missed ? <OctagonAlert size={15} /> : v.today && v.today !== "open" ? <CircleCheck size={15} className="ok" /> : <ClipboardCheck size={15} />}
                <span className="grow">
                  {names.get(b) ?? b}: {v.today === "open" ? "today's not counted yet" : v.today ? "counted today" : "none today"}
                  {v.missed ? ` · ${v.missed} missed` : ""}
                </span>
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ the set for this person
export async function HomeWidgets({ db, profile, known }: { db: Db; profile: Profile; known: HomeKnown }) {
  const w = widgetsFor(profile);
  if (!w.admin && !w.spot && !w.calendar && !w.queue && !w.credit && !w.goals) return null;
  const branches = w.spot || w.calendar ? await inventoryBranches(db, profile).catch(() => []) : [];
  const own = branches[0];
  const branch = own?.id ?? profile.branch_id ?? null;
  const branchName = own?.name ?? (branch ? branch.toUpperCase() : "");
  return (
    <section className="widgets" aria-label="Today">
      {w.spot && own ? (
        <Suspense fallback={<Loading title="Daily spot check" />}>
          <SpotWidget db={db} branch={own.id} branchName={own.name} />
        </Suspense>
      ) : null}
      {w.queue ? (
        <Suspense fallback={<Loading title="Your order desk" />}>
          <QueueWidget db={db} />
        </Suspense>
      ) : null}
      {w.credit ? (
        <Suspense fallback={<Loading title="Credit approvals" />}>
          <CreditWidget db={db} t={known.tax} />
        </Suspense>
      ) : null}
      {w.goals ? (
        <Suspense fallback={<Loading title="Your sales goals" />}>
          <GoalsWidget db={db} profile={profile} due={profile.job_role === "sales_rep" ? known.due : null} />
        </Suspense>
      ) : null}
      {w.calendar && branch ? (
        <Suspense fallback={<Loading title="This week" />}>
          <CalendarWidget db={db} branch={branch} branchName={branchName} canAdd={w.spot || profile.role === "admin"} />
        </Suspense>
      ) : null}
      {w.admin ? (
        <>
          <Suspense fallback={<Loading title="Waiting on you" />}>
            <WaitingWidget db={db} known={known} />
          </Suspense>
          <Suspense fallback={<Loading title="Sales goals" />}>
            <TeamGoalsWidget db={db} />
          </Suspense>
          <Suspense fallback={<Loading title="Sales" />}>
            <SalesWidget db={db} />
          </Suspense>
          <Suspense fallback={<Loading title="Inventory movement" />}>
            <MovementWidget db={db} />
          </Suspense>
        </>
      ) : null}
    </section>
  );
}
