import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { dateShort, searchSafe } from "@/lib/format";
import { Empty, TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { saveUser } from "@/app/(app)/admin/actions";
import { AccessPicker } from "@/components/access-picker";
import { ResendInvite } from "@/components/invite-form";
import { cancelInvite } from "./invite-actions";
import { UserPlus } from "lucide-react";
import { needsRole, roleLabel } from "@/lib/access";
import type { Branch, Company, Profile } from "@/lib/types";

export const metadata = { title: "Accounts" };

const TABS = [
  ["pending", "Waiting"],
  ["invited", "Invited"],
  ["customer", "Contractors"],
  ["employee", "AMBIT staff"],
  ["norole", "Needs a role"],
  ["disabled", "Turned off"],
] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "pending";
  const q = searchSafe(sp.q);
  const { supabase, profile: me } = await requireAdmin();

  let query = supabase.from("profiles").select("*, company:companies!company_id(id, name, account_no, default_branch_id)").order("created_at", { ascending: false }).limit(300);
  if (tab === "pending") query = query.eq("status", "pending");
  else if (tab === "disabled") query = query.eq("status", "disabled");
  else if (tab === "customer") query = query.eq("status", "active").eq("role", "customer");
  else if (tab === "norole") query = query.eq("status", "active").eq("role", "employee").is("job_role", null);
  else query = query.eq("status", "active").in("role", ["employee", "admin"]);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,requested_company.ilike.%${q}%`);

  const [{ data: users }, { data: companies }, { data: branches }] = await Promise.all([
    query,
    supabase.from("companies").select("id, name, account_no").order("name"),
    supabase.from("branches").select("id, name, state").order("sort"),
  ]);
  const list = tab === "invited" ? [] : ((users ?? []) as Profile[]);
  const cos = (companies ?? []) as Pick<Company, "id" | "name" | "account_no">[];

  return (
    <main className="shell wide">
      <TopBar title="Accounts" back="/admin" />
      <div>
        <Link href="/admin/users/new" className="btn sm"><UserPlus size={15} /> Create an account</Link>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="chips">
          {TABS.map(([id, label]) => (
            <Link key={id} href={`/admin/users?tab=${id}`} className={`chip${tab === id ? " on" : ""}`}>{label}</Link>
          ))}
        </div>
        <form action="/admin/users" className="grow" style={{ minWidth: 220 }}>
          <input type="hidden" name="tab" value={tab} />
          <input className="input sm" name="q" defaultValue={q} placeholder="Search name, email or company" />
        </form>
      </div>

      {sp.error ? <div className="alert err">{sp.error}</div> : null}
      {sp.saved ? <div className="alert ok">Saved {sp.saved}.</div> : null}
      {tab === "pending" ? (
        <div className="alert info small">
          Staff access (internal forms, directory, ordering for customers) is only possible for @ambitpu.com accounts.
          Until Microsoft sign-in is on, only approve AMBIT emails for people you know: anyone can type any email when requesting access.
          Safer for staff: use Create an account, which emails them a private link.
        </div>
      ) : null}

      {tab === "invited" ? (
        <InvitedList supabase={supabase} />
      ) : list.length === 0 ? (
        <Empty icon="users" title={tab === "pending" ? "No one is waiting" : "No accounts here"} />
      ) : (
        <div className="col">
          {list.map((u) => {
            const match =
              u.company_id ??
              cos.find((c) => u.requested_account_no && c.account_no?.toLowerCase() === u.requested_account_no.toLowerCase())?.id ??
              cos.find((c) => u.requested_company && c.name.toLowerCase() === u.requested_company.toLowerCase())?.id ??
              (u.requested_company ? "__new" : "");
            const isMe = u.id === me.id;
            const ambit = u.email.toLowerCase().endsWith("@ambitpu.com");
            const roleDefault = u.status === "pending" && ambit && u.role === "customer" ? "employee" : u.role;
            return (
              <form key={u.id} action={saveUser} className="card col" style={{ gap: 12 }}>
                <input type="hidden" name="user_id" value={u.id} />
                <input type="hidden" name="tab" value={tab} />
                <div className="row between wrap">
                  <div>
                    <div style={{ fontWeight: 800 }}>{u.full_name ?? "(no name)"} {isMe ? <span className="pill grey">You</span> : null} {ambit ? <span className="pill">AMBIT email</span> : <span className="pill grey">Outside email</span>}</div>
                    <div className="small muted">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                    {u.requested_company ? (
                      <div className="small">Requested: <b>{u.requested_company}</b>{u.requested_account_no ? ` · acct ${u.requested_account_no}` : ""}</div>
                    ) : null}
                  </div>
                  <span className="tiny faint">Joined {dateShort(u.created_at)}</span>
                </div>
                {u.role !== "customer" && u.status === "active" ? (
                  <div className="small">
                    {roleLabel(u.job_role) ? <span className="pill grey">{roleLabel(u.job_role)}</span> : needsRole(u) ? <span className="pill warn">Needs a role</span> : null}
                  </div>
                ) : null}
                <AccessPicker
                  role={roleDefault}
                  jobRole={u.job_role ?? null}
                  perms={u.perms ?? []}
                  ambit={ambit}
                  isMe={isMe}
                />
                <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                  <label className="field">
                    <span className="label">Access</span>
                    <select className="select sm" name="status" defaultValue={u.status === "pending" ? "active" : u.status} disabled={isMe}>
                      <option value="active">{u.status === "pending" ? "Approve" : "Active"}</option>
                      <option value="pending">Keep waiting</option>
                      <option value="disabled">Turn off</option>
                    </select>
                    {isMe ? <input type="hidden" name="status" value={u.status} /> : null}
                  </label>
                  <label className="field">
                    <span className="label">Company (contractors)</span>
                    <select className="select sm" name="company_id" defaultValue={ambit ? "" : match}>
                      <option value="">-</option>
                      {u.requested_company ? <option value="__new">+ New: {u.requested_company}</option> : null}
                      {cos.map((c) => <option key={c.id} value={c.id}>{c.name}{c.account_no ? ` · ${c.account_no}` : ""}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">Branch</span>
                    <select className="select sm" name="branch_id" defaultValue={u.branch_id ?? ""}>
                      <option value="">-</option>
                      {((branches ?? []) as Branch[]).map((b) => <option key={b.id} value={b.id}>{b.name}, {b.state}</option>)}
                    </select>
                  </label>
                  {u.role !== "customer" && u.status === "active" ? (
                    <label className="field">
                      <span className="label">Monthly sales goal ($)</span>
                      <input className="input sm" name="monthly_goal" inputMode="decimal" defaultValue={u.monthly_goal ? String(Number(u.monthly_goal)) : ""} placeholder="None" />
                      <span className="tiny faint">Shows on their Home screen.</span>
                    </label>
                  ) : null}
                </div>
                <div><Submit className="btn sm" pendingText="Saving…">{u.status === "pending" ? "Save & notify" : "Save"}</Submit></div>
              </form>
            );
          })}
        </div>
      )}
    </main>
  );
}

type InviteRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: Profile["role"];
  job_role: string | null;
  invited_by_name: string | null;
  created_at: string;
  sent_at: string | null;
  email_status: string | null;
  expires_at: string;
  accepted_at: string | null;
  company: { name: string } | null;
};

/** Accounts an admin created that are waiting for the person to set their password (and the latest ones who did). */
async function InvitedList({ supabase }: { supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"] }) {
  const { data, error } = await supabase
    .from("invites")
    .select("id, email, full_name, role, job_role, invited_by_name, created_at, sent_at, email_status, expires_at, accepted_at, company:companies(name)")
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return <div className="alert warn small">Account invites aren&apos;t set up in the database yet. Run supabase/migrations/0016_invites.sql in Supabase.</div>;
  }
  const rows = (data ?? []) as unknown as InviteRow[];
  const open = rows.filter((r) => !r.accepted_at);
  const joined = rows.filter((r) => r.accepted_at).slice(0, 15);
  const now = Date.now();
  const what = (r: InviteRow) =>
    r.role === "customer" ? `Contractor${r.company ? ` · ${r.company.name}` : ""}` : `AMBIT ${roleLabel(r.job_role) ?? (r.role === "admin" ? "Admin" : "employee")}`;

  return (
    <div className="col" style={{ gap: 18 }}>
      {open.length === 0 ? (
        <Empty icon="users" title="No invites waiting">Accounts you create show here until the person sets their password.</Empty>
      ) : (
        <div className="col">
          {open.map((r) => {
            const expired = new Date(r.expires_at).getTime() < now;
            return (
              <section key={r.id} className="card col" style={{ gap: 10 }}>
                <div className="row between wrap" style={{ gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{r.full_name ?? r.email}</div>
                    <div className="small muted">{r.full_name ? r.email : ""}</div>
                    <div className="small">{what(r)}</div>
                  </div>
                  {expired ? <span className="pill grey">Link expired</span> : <span className="pill warn">Hasn&apos;t set up yet</span>}
                </div>
                <div className="tiny faint">
                  Created {dateShort(r.created_at)}{r.invited_by_name ? ` by ${r.invited_by_name}` : ""}
                  {r.email_status === "sent" ? ` · Emailed ${dateShort(r.sent_at)}` : r.email_status === "not_configured" ? " · Not emailed (app email isn't set up)" : r.email_status === "failed" ? " · Email failed" : ""}
                  {!expired ? ` · Link works until ${dateShort(r.expires_at)}` : ""}
                </div>
                <ResendInvite id={r.id}>
                  <form action={cancelInvite}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="linkbtn small">Cancel invite</button>
                  </form>
                </ResendInvite>
              </section>
            );
          })}
        </div>
      )}
      {joined.length ? (
        <section className="section">
          <div className="eyebrow">Recently set up</div>
          <div className="list">
            {joined.map((r) => (
              <div key={r.id} className="item" style={{ minHeight: 56 }}>
                <div className="grow">
                  <div className="t">{r.full_name ?? r.email}</div>
                  <div className="s">{what(r)} · joined {dateShort(r.accepted_at)}</div>
                </div>
                <span className="pill ok">Active</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
