import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { callsLoggedSince, crmCalls, repList, todayCentral } from "@/lib/crm";
import { isDone, isDue, type Call } from "@/lib/calls-shared";
import { TopBar } from "@/components/ui";
import { SalesNav } from "@/components/sales/sales-nav";
import { CallLoader } from "@/components/sales/call-loader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call lists" };

/** Admins: load the reviewed call lists and see how far each rep is. */
export default async function CallListsAdminPage() {
  const { supabase } = await requireAdmin();
  const today = todayCentral();
  const [{ rows, ready }, reps, month] = await Promise.all([crmCalls(supabase, null), repList(supabase), callsLoggedSince(supabase, `${today.slice(0, 7)}-01`, null)]);
  const by = new Map<string, Call[]>();
  for (const r of rows) by.set(r.rep_id ?? "", [...(by.get(r.rep_id ?? "") ?? []), r]);
  const people = [...by.keys()].map((id) => ({ id, name: reps.find((r) => r.id === id)?.name ?? by.get(id)?.[0]?.rep_name ?? "No rep" })).sort((a, b) => a.name.localeCompare(b.name));
  const stat = (cs: Call[], list: string) => {
    const l = cs.filter((c) => c.list === list);
    return { n: l.length, worked: l.filter((c) => c.touches > 0).length, won: l.filter((c) => c.status === "won").length };
  };
  return (
    <main className="shell full crm">
      <TopBar title="Call lists" back="/sales/calls" />
      <SalesNav on="calls" all admin />
      {!ready ? <div className="alert warn small" role="note"><span>Call lists need database update 0113 first (Supabase › SQL Editor).</span></div> : null}
      {rows.length ? (
        <section className="card2" aria-label="Progress by rep" style={{ padding: 0 }}>
          <div className="card2-h"><b>Who has what</b><span className="small faint">{month} calls logged this month</span></div>
          <div className="tbl-wrap"><table className="tbl crm-tbl">
            <thead><tr><th>Rep</th><th className="num">Win-back</th><th className="num">Called</th><th className="num">Won back</th><th className="num">Cold leads</th><th className="num">Called</th><th className="num">To pipeline</th><th className="num">Call-backs due</th><th className="num">Still to work</th><th>Progress</th></tr></thead>
            <tbody>
              {people.map((p) => {
                const cs = by.get(p.id) ?? [];
                const w = stat(cs, "winback"), c = stat(cs, "cold");
                const pct = cs.length ? Math.round(((w.worked + c.worked) / cs.length) * 100) : 0;
                return (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: "nowrap" }}><Link href={`/sales/calls?rep=${p.id}`} className="crm-name">{p.name}</Link></td>
                    <td className="num"><b>{w.n}</b></td><td className="num">{w.worked}</td><td className="num">{w.won}</td>
                    <td className="num"><b>{c.n}</b></td><td className="num">{c.worked}</td><td className="num">{c.won}</td>
                    <td className="num">{cs.filter((x) => isDue(x, today)).length}</td>
                    <td className="num">{cs.filter((x) => !isDone(x)).length}</td>
                    <td style={{ minWidth: 140 }}><span className="crm-rep-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span><span className="tiny faint">{pct}% called</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      ) : null}
      <CallLoader reps={reps} />
      <p className="tiny faint" style={{ margin: 0 }}>
        To move calls from one rep to another, open <Link href="/sales/calls?rep=all">My calls › Everyone</Link>, tick them and pick the new rep.
      </p>
    </main>
  );
}
