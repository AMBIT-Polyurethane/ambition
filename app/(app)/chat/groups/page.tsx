import { CircleAlert, CircleCheck } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { Empty, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateTime } from "@/lib/format";
import { chatGroups, staffList } from "@/lib/chat";
import { chatGroupSave } from "../actions";

export const metadata = { title: "Chat groups" };
export const dynamic = "force-dynamic";

const RULE: Record<string, string> = {
  orders: "Everyone set up as a CRM (Order desk) is in this group on their own, plus the people ticked here.",
  admins: "Every admin is in this group on their own. Tick anyone else who should get @Admins too.",
  list: "Only the people ticked here.",
};
const JOB: Record<string, string> = { warehouse: "Warehouse", crm: "CRM", sales_rep: "Sales", accounting: "Accounting", admin: "Admin", tech: "Tech" };

/** Admins: the groups people @tag as one (@Orders Group, @Admins, @Credit Team) and who is in each. */
export default async function ChatGroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [groups, staff, { data: meta }] = await Promise.all([
    chatGroups(supabase),
    staffList(supabase),
    supabase.from("chat_groups").select("key, updated_by_name, updated_at"),
  ]);
  const when = new Map(((meta ?? []) as { key: string; updated_by_name: string | null; updated_at: string }[]).map((m) => [m.key, m]));
  return (
    <main className="shell">
      <TopBar title="Chat groups" back="/chat" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="small muted">
        A group is one tag in chat. Type @ and pick the group, and everyone in it gets the notification and a to-do. The automatic order notes
        use these too: new orders, scheduling and invoice updates go to @Orders Group, credit checks to @Credit Team, and loading goes to the
        warehouse manager at that order&apos;s location.
      </p>
      {!groups.length ? (
        <Empty icon="message" title="This needs the 0110 database update">Run 0110_chat_groups.sql in Supabase, then come back.</Empty>
      ) : (
        groups.map((g) => {
          const m = when.get(g.key);
          return (
            <form key={g.key} id={`g-${g.key}`} action={chatGroupSave} className="card col" style={{ gap: 12 }}>
              <input type="hidden" name="key" value={g.key} />
              <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 17 }}><span className="chat-at group">@{g.name}</span></b>
                <span className="pill">{g.members.length} {g.members.length === 1 ? "person" : "people"}</span>
              </div>
              <span className="small muted">{RULE[g.rule] ?? RULE.list}</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                {staff.map((s) => {
                  const auto = (g.rule === "orders" && s.role === "crm") || (g.rule === "admins" && g.members.includes(s.id) && !g.listed.includes(s.id));
                  return (
                    <label key={s.id} className="row" style={{ gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--s1)", alignItems: "center" }}>
                      <input type="checkbox" name="member" value={s.id} defaultChecked={auto || g.listed.includes(s.id)} disabled={auto} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="small">{s.name}</span>
                        <span className="tiny faint"> {[s.role ? JOB[s.role] ?? s.role : null, s.branch?.toUpperCase()].filter(Boolean).join(" · ")}</span>
                      </span>
                      {auto ? <span className="tiny faint">automatic</span> : null}
                    </label>
                  );
                })}
              </div>
              <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="tiny faint">{m?.updated_by_name ? `Last changed by ${m.updated_by_name} · ${dateTime(m.updated_at)}` : ""}</span>
                <Submit className="btn sm" pendingText="Saving…">Save {g.name}</Submit>
              </div>
            </form>
          );
        })
      )}
    </main>
  );
}
