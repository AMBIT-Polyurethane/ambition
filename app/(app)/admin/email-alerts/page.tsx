import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { roleLabel } from "@/lib/access";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { saveCreditEmails, testCreditEmails } from "./actions";

export const metadata = { title: "Email alerts" };

type Person = { id: string; full_name: string | null; email: string; role: string; job_role: string | null; notify_credit?: boolean };

/** Admin: who gets the "Credit check needed" emails. */
export default async function EmailAlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, job_role, notify_credit")
    .in("role", ["employee", "admin"])
    .eq("status", "active")
    .order("full_name");
  const people = (data ?? []) as Person[];
  const on = people.filter((p) => p.notify_credit);

  return (
    <main className="shell">
      <TopBar title="Email alerts" back="/admin" />
      {sp.msg ? <div className="alert ok small" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err small" role="alert"><CircleAlert size={18} style={{ flex: "none" }} /><span>{sp.err}</span></div> : null}
      {error ? <div className="alert warn small">Run database update 0043 first (Supabase → SQL Editor).</div> : null}

      <section className="card col" style={{ gap: 10 }}>
        <div className="col tight">
          <b>Credit check needed</b>
          <span className="small muted">
            Emailed when the CRM enters an order&apos;s Sales Order # and Invoice #, and again if an edit makes the total go up. Whoever is ticked
            gets it, with a link to the order.
          </span>
        </div>
        <div className="alert info small" style={{ margin: 0 }}>
          <span>
            <b>Right now they go to:</b> {on.length ? on.map((p) => p.full_name ?? p.email).join(", ") : "nobody ticked yet (the app falls back to staff with the Credit check box)"}
          </span>
        </div>
        <form action={saveCreditEmails} className="col" style={{ gap: 10 }}>
          <div className="list">
            {people.map((p) => (
              <label key={p.id} className="item check" style={{ alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" name="credit" value={p.id} defaultChecked={Boolean(p.notify_credit)} />
                <span className="grow col tight" style={{ minWidth: 0 }}>
                  <span className="t ellipsis">{p.full_name ?? p.email}</span>
                  <span className="s ellipsis">{p.email}{p.role === "admin" ? " · Admin" : p.job_role ? ` · ${roleLabel(p.job_role) ?? p.job_role}` : ""}</span>
                </span>
              </label>
            ))}
          </div>
          <Submit className="btn block" pendingText="Saving…">Save</Submit>
        </form>
        <form action={testCreditEmails}>
          <Submit className="btn sm ghost" pendingText="Sending…">
            <Send size={15} /> Send a test email
          </Submit>
        </form>
      </section>
    </main>
  );
}
