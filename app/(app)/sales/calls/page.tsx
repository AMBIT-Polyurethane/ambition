import Link from "next/link";
import { redirect } from "next/navigation";
import { Info, Upload } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { canSalesAll, canSalesHub } from "@/lib/access";
import { callsLoggedSince, crmCalls, repList, todayCentral } from "@/lib/crm";
import { isDone, isDue } from "@/lib/calls-shared";
import { TopBar } from "@/components/ui";
import { SalesNav } from "@/components/sales/sales-nav";
import { RepPicker } from "@/components/sales/rep-picker";
import { CallList } from "@/components/sales/call-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "My calls" };

/** A rep's call lists: past customers to win back, and new contractors from BBB and ConstructConnect in their territory. */
export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  if (!canSalesHub(profile)) redirect("/");
  const all = canSalesAll(profile);
  const admin = profile.role === "admin";
  const reps = all ? await repList(supabase) : [];
  const mineN = all ? (await supabase.from("crm_calls").select("id", { count: "exact", head: true }).eq("rep_id", profile.id)).count ?? 0 : 1;
  const pick = all ? (sp.rep ?? (mineN ? profile.id : "all")) : profile.id;
  const who = pick === "all" ? null : pick;
  const today = todayCentral();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [{ rows, ready }, thisMonth] = await Promise.all([crmCalls(supabase, who), callsLoggedSince(supabase, monthStart, who)]);
  const name = who ? reps.find((r) => r.id === who)?.name ?? (who === profile.id ? profile.full_name : "Rep") : "Everyone";
  const worked = rows.filter((r) => r.touches > 0).length;
  const won = rows.filter((r) => r.status === "won");
  const due = rows.filter((r) => isDue(r, today)).length;
  const open = rows.filter((r) => !isDone(r)).length;
  const month = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { month: "long" });
  const pct = rows.length ? Math.round((worked / rows.length) * 100) : 0;
  const tab = sp.tab === "cold" || sp.tab === "due" ? sp.tab : due && !sp.tab ? "due" : "winback";

  return (
    <main className="shell full crm">
      <TopBar title={who === profile.id ? "My calls" : `Calls: ${name}`} right={all ? <RepPicker reps={reps} value={pick} me={profile.id} /> : undefined} />
      <SalesNav on="calls" all={all} admin={admin} />
      {!ready ? (
        <div className="alert warn small" role="note"><Info size={16} aria-hidden /><span>Call lists need database update 0113 first (Supabase › SQL Editor).</span></div>
      ) : null}
      <div className="crm-head">
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          Past customers to win back, and new contractors from BBB and ConstructConnect in {who === profile.id ? "your" : "the"} territory. Tap how each call went: it&apos;s saved to their history, &quot;Call back…&quot; puts it on the day you pick, and &quot;Interested&quot; moves a cold lead into the New-customer pipeline.
        </p>
        {admin ? <Link href="/sales/calls/load" className="b2 sm"><Upload size={15} aria-hidden /> Load lists and see progress</Link> : null}
      </div>
      {rows.length ? (
        <section className="card2 call-progress" aria-label="Progress">
          <div className="row between wrap" style={{ gap: 10 }}>
            <b>{worked} of {rows.length} called at least once</b>
            <span className="small muted">{month}: {thisMonth} call{thisMonth === 1 ? "" : "s"} logged · {won.filter((r) => r.list === "winback").length} won back · {won.filter((r) => r.list === "cold").length} cold leads moved to the pipeline · {open} still to work</span>
          </div>
          <span className="crm-funnel-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
        </section>
      ) : ready ? (
        <div className="alert small" role="note"><span>No calls on {who === profile.id ? "your" : "this"} list yet.{admin ? <> <Link href="/sales/calls/load">Load the lists</Link>.</> : " Your manager loads them."}</span></div>
      ) : null}
      {rows.length ? <CallList key={pick} rows={rows} today={today} showRep={!who} reps={reps} canAssign={all} tab={tab} /> : null}
    </main>
  );
}
