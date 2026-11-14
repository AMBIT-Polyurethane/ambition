import Link from "next/link";
import { ChevronRight, Inbox } from "lucide-react";
import { requireEmployee } from "@/lib/session";
import { GROUPS, PULSE_DEPTS, SPECS } from "@/lib/forms/specs";
import { STATUS_LABEL, type Sub } from "@/lib/forms/load";
import { dateShort } from "@/lib/format";
import { TopBar } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

/** Every AMBIT form in one place: start one, see what you've sent, and (for reviewers) what's waiting on you. */
export default async function FormsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireEmployee();
  const [{ data: mine }, { data: waiting }, revs] = await Promise.all([
    supabase.from("form_submissions").select("id, form_key, ref_no, status, data, score, submitted_at, created_at, for_day, submitted_name, decided_at")
      .or(`submitted_by.eq.${profile.id},created_by.eq.${profile.id}`).order("created_at", { ascending: false }).limit(12),
    supabase.from("form_submissions").select("id, form_key, ref_no, status, data, score, submitted_at, created_at, submitted_name, company_id")
      .eq("status", "submitted").not("form_key", "like", "pulse_%").order("submitted_at", { ascending: true }).limit(60),
    Promise.all(Object.keys(SPECS).filter((k) => !k.startsWith("pulse_")).map(async (k) => [k, (await supabase.rpc("form_reviewer", { p_key: k })).data === true] as const)),
  ]);
  const reviews = new Set(revs.filter(([, v]) => v).map(([k]) => k));
  const todo = ((waiting ?? []) as Sub[]).filter((s) => reviews.has(s.form_key) || ((SPECS[s.form_key]?.group === "team") && String(s.data.manager ?? "") === profile.id));
  const dept = (profile as { pulse_dept?: string | null }).pulse_dept ?? null;
  const tab = sp.t === "mine" ? "mine" : sp.t === "review" ? "review" : "new";

  return (
    <main className="shell wide">
      <TopBar title="Forms" back="/" right={profile.role === "admin" ? <Link href="/pulse" className="btn sm dark"><Icon name="target" size={15} /> Pulse dashboard</Link> : null} />
      <nav className="chips" aria-label="Forms">
        <Link href="/forms" className={`chip${tab === "new" ? " on" : ""}`}>Start a form</Link>
        <Link href="/forms?t=review" className={`chip${tab === "review" ? " on" : ""}`}>Waiting on me{todo.length ? <span className="chip-n">{todo.length}</span> : null}</Link>
        <Link href="/forms?t=mine" className={`chip${tab === "mine" ? " on" : ""}`}>Sent by me</Link>
      </nav>

      {tab === "new" ? (
        <>
          <Link href="/price-requests/new" className="fx-hero card">
            <span className="fx-hero-ic"><Icon name="tag" size={22} /></span>
            <span className="col tight grow"><b>Price Request</b><span className="small muted">Quote a customer. New customers flow straight into the credit application and account setup.</span></span>
            <ChevronRight size={18} />
          </Link>
          {GROUPS.map((g) => {
            const list = Object.values(SPECS).filter((s) => s.group === g.key);
            return (
              <section key={g.key} className="col" style={{ gap: 10 }}>
                <h2 className="label" style={{ margin: "6px 0 0" }}>{g.label}{g.key === "pulse" && dept ? <span className="tiny faint" style={{ textTransform: "none", letterSpacing: 0 }}> · yours is {PULSE_DEPTS[dept as keyof typeof PULSE_DEPTS]}</span> : null}</h2>
                <div className="fx-tiles">
                  {list.map((s) => (
                    <Link key={s.key} href={`/forms/${s.key}`} className={`fx-tile card${s.dept && s.dept === dept ? " mine" : ""}`}>
                      <span className="fx-tile-ic"><Icon name={s.icon} size={20} /></span>
                      <b>{s.group === "pulse" ? s.short : s.title}</b>
                      <span className="tiny muted">{s.desc}</span>
                      {s.publicLink ? <span className="tiny info-text">Fill it in together, or email the customer a link</span> : null}
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
          <p className="tiny faint" style={{ margin: 0 }}>Older Jotform submissions are still under <Link href="/admin/forms">Admin › Forms hub</Link>.</p>
        </>
      ) : (
        <List subs={(tab === "review" ? todo : (mine ?? [])) as Sub[]} empty={tab === "review" ? "Nothing waiting on you." : "You haven't sent any forms yet."} />
      )}
    </main>
  );
}

function List({ subs, empty }: { subs: Sub[]; empty: string }) {
  if (!subs.length) return <div className="card small muted center col" style={{ gap: 8, padding: 28 }}><Inbox size={22} style={{ alignSelf: "center" }} />{empty}</div>;
  return (
    <div className="card" style={{ padding: 0 }}>
      {subs.map((s) => {
        const spec = SPECS[s.form_key];
        const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.submitted;
        return (
          <Link key={s.id} href={`/forms/s/${s.id}`} className="fx-row">
            <span className="fx-tile-ic sm"><Icon name={spec?.icon ?? "form"} size={16} /></span>
            <span className="col tight grow" style={{ minWidth: 0 }}>
              <b className="small">{spec?.title ?? s.form_key} {s.ref_no ? <span className="faint">· {s.ref_no}</span> : null}</b>
              <span className="tiny muted ellipsis">{[spec?.summary(s.data as never), s.submitted_name].filter(Boolean).join(" · ") || "–"}</span>
            </span>
            {s.score !== null && s.score !== undefined ? <b className={s.score >= 85 ? "ok-text" : s.score >= 60 ? "warn-text" : "red"}>{s.score}%</b> : null}
            <span className={st.pill}>{st.label}</span>
            <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{dateShort((s.submitted_at ?? s.created_at).slice(0, 10))}</span>
          </Link>
        );
      })}
    </div>
  );
}
