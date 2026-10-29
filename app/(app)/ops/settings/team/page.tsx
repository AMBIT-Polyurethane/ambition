import { requireOps, teamOf, locationsOf } from "@/lib/ops/server";
import { opsCan, OPS_ROLES, opsRoleLabel } from "@/lib/ops/roles";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { dateShort } from "@/lib/format";
import { cancelInvite, setMember } from "../actions";
import { InviteMember } from "./invite-member";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile, ws } = await requireOps(opsCan.manage);
  const [team, locations, { data: invites }] = await Promise.all([
    teamOf(supabase, ws.company.id),
    locationsOf(supabase, ws.company.id),
    supabase.from("invites").select("id, email, full_name, ops_role, created_at, expires_at, email_status").eq("company_id", ws.company.id).is("accepted_at", null).is("cancelled_at", null).order("created_at", { ascending: false }),
  ]);
  const owner = ws.role === "owner";
  const roles = OPS_ROLES.filter((r) => owner || r.key !== "owner");
  return (
    <SettingsShell title="Team" sp={sp} wide>
      <section className="card col" style={{ gap: 12 }}>
        <b>Invite someone</b>
        <span className="tiny faint">They get a private link to make their password. Each person has their own login, so the time clock and the timeline always know who did what.</span>
        <InviteMember roles={roles.map((r) => ({ key: r.key, label: r.label, hint: r.hint }))} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
      </section>

      <section className="col" style={{ gap: 8 }}>
        <div className="eyebrow">On the team ({team.length})</div>
        <div className="list">
          {team.map((m) => {
            const locked = m.ops_role === "owner" && !owner;
            return (
              <form key={m.id} action={setMember} className="item ops-member">
                <input type="hidden" name="id" value={m.id} />
                <div className="ops-avatar">{(m.full_name || m.email).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{m.full_name || m.email}{m.id === profile.id ? <span className="tiny faint"> (you)</span> : null}</div>
                  <div className="s ellipsis">{m.email}</div>
                </div>
                {locked ? (
                  <span className="pill">{opsRoleLabel(m.ops_role)}</span>
                ) : (
                  <span className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <select className="select sm" name="role" defaultValue={m.ops_role ?? ""} aria-label={`Role for ${m.full_name || m.email}`}>
                      {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      {m.id !== profile.id ? <option value="remove">Take off the team</option> : null}
                    </select>
                    {locations.length > 1 ? (
                      <select className="select sm" name="location_id" defaultValue={m.ops_location_id ?? ""} aria-label="Location">
                        <option value="">Any location</option>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    ) : null}
                    <Submit className="btn sm dark" pendingText="…">Save</Submit>
                  </span>
                )}
              </form>
            );
          })}
        </div>
      </section>

      {(invites ?? []).length ? (
        <section className="col" style={{ gap: 8 }}>
          <div className="eyebrow">Invited, not signed in yet</div>
          <div className="list">
            {((invites ?? []) as { id: string; email: string; full_name: string | null; ops_role: string | null; created_at: string; expires_at: string }[]).map((i) => (
              <form key={i.id} action={cancelInvite} className="item">
                <input type="hidden" name="id" value={i.id} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t ellipsis">{i.full_name || i.email}</div>
                  <div className="s ellipsis">{opsRoleLabel(i.ops_role)} · invited {dateShort(i.created_at)} · link good until {dateShort(i.expires_at)}</div>
                </div>
                <Submit className="btn sm ghost" pendingText="…">Cancel</Submit>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card col" style={{ gap: 8 }}>
        <b>What each role can do</b>
        <div className="kv small">
          {OPS_ROLES.map((r) => (
            <span key={r.key} style={{ display: "contents" }}>
              <span>{r.label}</span>
              <span>{r.hint}</span>
            </span>
          ))}
        </div>
      </section>
    </SettingsShell>
  );
}
