import Link from "next/link";
import { Blocks, CircleAlert, CircleCheck, FlaskConical, LifeBuoy, Search } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { dateShort } from "@/lib/format";
import { createDemo, openWorkspace, turnBackOn, turnOff } from "./actions";
import { TurnOnForm } from "./turn-on-form";

export const metadata = { title: "AMBIT-OPS workspaces" };
export const dynamic = "force-dynamic";

type Co = { id: string; name: string; account_no: string | null; city: string | null; state: string | null; ops_enabled: boolean; ops_demo: boolean; ops_enabled_at: string | null; ops_support_until: string | null };

export default async function AdminOpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireAdmin();
  const q = (sp.q ?? "").trim().slice(0, 80);
  const [{ data: on }, { data: hits }, picked] = await Promise.all([
    supabase.from("companies").select("id, name, account_no, city, state, ops_enabled, ops_demo, ops_enabled_at, ops_support_until").not("ops_enabled_at", "is", null).order("name"),
    q
      ? supabase.from("companies").select("id, name, account_no, city, state, ops_enabled, ops_demo, ops_enabled_at, ops_support_until").ilike("name", `%${q.replace(/[\\%_,()]/g, " ")}%`).eq("ops_enabled", false).order("name").limit(12)
      : Promise.resolve({ data: [] }),
    sp.c ? supabase.from("companies").select("id, name, account_no, city, state, ops_enabled, ops_demo, ops_enabled_at, ops_support_until").eq("id", sp.c).maybeSingle<Co>() : Promise.resolve({ data: null }),
  ]);
  const workspaces = (on ?? []) as Co[];
  const ids = workspaces.map((c) => c.id);
  const [{ data: team }, { data: logins }] = await Promise.all([
    ids.length ? supabase.from("profiles").select("company_id, full_name, email, ops_role").in("company_id", ids).not("ops_role", "is", null) : Promise.resolve({ data: [] }),
    picked.data ? supabase.from("profiles").select("id, full_name, email, phone").eq("company_id", picked.data.id).eq("role", "customer").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  type T = { company_id: string; full_name: string | null; email: string; ops_role: string };
  const members = (team ?? []) as T[];
  const now = Date.now();
  const supportOpen = (c: Co) => c.ops_demo || (!!c.ops_support_until && Date.parse(c.ops_support_until) > now);

  return (
    <main className="shell wide">
      <TopBar title="AMBIT-OPS workspaces" back="/admin" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      <p className="muted small" style={{ margin: 0 }}>
        Each contractor gets their own private workspace. AMBIT can open one only while its owner has &ldquo;Let AMBIT help&rdquo; turned on, and every visit shows in their log. Demo workspaces are AMBIT&apos;s own, for showing and testing.
      </p>

      <section className="section">
        <div className="eyebrow">Workspaces ({workspaces.length})</div>
        {workspaces.length === 0 ? (
          <div className="card muted small center">No contractor has AMBIT-OPS yet. Turn it on below, or start a demo.</div>
        ) : (
          <div className="list">
            {workspaces.map((c) => {
              const people = members.filter((m) => m.company_id === c.id);
              const owners = people.filter((m) => m.ops_role === "owner");
              return (
                <div key={c.id} className="item" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div className="ic">{c.ops_demo ? <FlaskConical size={18} /> : <Blocks size={18} />}</div>
                  <div className="grow col tight" style={{ minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                      <b className="ellipsis">{c.name}</b>
                      {c.ops_demo ? <span className="pill grey">Demo</span> : null}
                      {!c.ops_enabled ? <span className="pill warn">Off</span> : null}
                      {!c.ops_demo && supportOpen(c) ? <span className="pill ok">AMBIT can help until {dateShort(c.ops_support_until)}</span> : null}
                    </div>
                    <span className="tiny faint">
                      {owners.length ? `Owner: ${owners.map((o) => o.full_name || o.email).join(", ")}` : c.ops_demo ? "AMBIT demo" : "No owner has signed in yet"}
                      {` · ${people.length} on the team · on since ${dateShort(c.ops_enabled_at)}`}
                    </span>
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {c.ops_enabled && supportOpen(c) ? (
                      <form action={openWorkspace}>
                        <input type="hidden" name="company_id" value={c.id} />
                        <Submit className="btn sm" pendingText="Opening…"><LifeBuoy size={15} /> Open</Submit>
                      </form>
                    ) : null}
                    {c.ops_enabled ? (
                      <form action={turnOff}>
                        <input type="hidden" name="company_id" value={c.id} />
                        <Submit className="btn sm ghost" pendingText="…">Turn off</Submit>
                      </form>
                    ) : (
                      <form action={turnBackOn}>
                        <input type="hidden" name="company_id" value={c.id} />
                        <input type="hidden" name="demo" value={c.ops_demo ? "1" : ""} />
                        <Submit className="btn sm dark" pendingText="…">Turn back on</Submit>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="section card col" style={{ gap: 12 }}>
        <div className="col tight">
          <b>Turn on AMBIT-OPS for a customer</b>
          <span className="tiny faint">Their product library starts with AMBIT foam sets and fiberglass, priced from their own AMBIT invoices.</span>
        </div>
        {picked.data ? (
          <>
            <div className="row between" style={{ gap: 8 }}>
              <span><b>{picked.data.name}</b> <span className="tiny faint">{[picked.data.account_no, [picked.data.city, picked.data.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span></span>
              <Link href="/admin/ops" className="linkbtn tiny">Pick another</Link>
            </div>
            <TurnOnForm companyId={picked.data.id} logins={(logins ?? []) as { id: string; full_name: string | null; email: string; phone: string | null }[]} />
          </>
        ) : (
          <>
            <form className="search" action="/admin/ops">
              <Search size={18} />
              <input className="input" type="search" name="q" defaultValue={q} placeholder="Search customers by name" aria-label="Search customers" />
            </form>
            {q ? (
              (hits ?? []).length ? (
                <div className="list">
                  {((hits ?? []) as Co[]).map((c) => (
                    <Link key={c.id} href={`/admin/ops?c=${c.id}`} className="item">
                      <div className="ic"><Blocks size={18} /></div>
                      <div className="grow">
                        <div className="t ellipsis">{c.name}</div>
                        <div className="s ellipsis">{[c.account_no, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "Customer"}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <span className="small muted">No customer without AMBIT-OPS matches &ldquo;{q}&rdquo;.</span>
              )
            ) : null}
          </>
        )}
      </section>

      <section className="section card col" style={{ gap: 10 }}>
        <div className="col tight">
          <b>Demo workspace</b>
          <span className="tiny faint">A pretend contractor for trying OPS and showing it to customers. It isn&apos;t a real customer and never shows in ordering.</span>
        </div>
        <form action={createDemo} className="row wrap" style={{ gap: 8 }}>
          <input className="input sm" name="name" placeholder="AMBIT Demo Insulation" maxLength={80} style={{ flex: "1 1 220px" }} />
          <Submit className="btn sm" pendingText="Creating…"><FlaskConical size={15} /> Create and open</Submit>
        </form>
        {profile.ops_workspace ? <span className="tiny faint">You&apos;re in a workspace now; creating a demo switches you to it.</span> : null}
      </section>
    </main>
  );
}
