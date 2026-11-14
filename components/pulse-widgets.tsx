import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CircleCheck, Target, TriangleAlert } from "lucide-react";
import { PULSE_DEPTS, SPECS } from "@/lib/forms/specs";
import type { Data } from "@/lib/forms/engine";
import { Card } from "@/components/home-widgets";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** Home: "Your Daily Pulse": fill it in, or today's score once it's in. */
export async function PulseWidget({ db, profile }: { db: SupabaseClient; profile: { id: string; pulse_dept?: string | null } }) {
  const dept = profile.pulse_dept as keyof typeof PULSE_DEPTS | null | undefined;
  if (!dept || !PULSE_DEPTS[dept]) return null;
  const key = `pulse_${dept}`;
  const { data } = await db.from("form_submissions").select("id, score, data").eq("form_key", key).eq("submitted_by", profile.id).eq("for_day", today()).maybeSingle();
  const r = data as { id: number; score: number | null; data: Data } | null;
  const flags = r ? SPECS[key]?.score?.(r.data).flags ?? [] : [];
  return (
    <Card title={`Daily Pulse · ${PULSE_DEPTS[dept]}`} href={r ? `/forms/s/${r.id}` : `/forms/${key}`} link={r ? "Open it" : "Fill it in"}>
      {r ? (
        <div className="row" style={{ gap: 12 }}>
          <span className="pulse-big ok"><CircleCheck size={22} /></span>
          <span className="col tight"><b>In for today · {r.score}%</b><span className="tiny muted">{flags.length ? flags.join(", ") : "Nice work. You can update it until midnight."}</span></span>
        </div>
      ) : (
        <Link href={`/forms/${key}`} className="row" style={{ gap: 12, color: "inherit" }}>
          <span className="pulse-big"><Target size={22} /></span>
          <span className="col tight"><b>Today&apos;s pulse isn&apos;t in yet</b><span className="tiny muted">Two minutes: your top 3, blockers, and the numbers.</span></span>
        </Link>
      )}
    </Card>
  );
}

/** Home (admins): the team's pulse today, and any alert. */
export async function PulseTeamWidget({ db }: { db: SupabaseClient }) {
  const [{ data: subs }, { count }] = await Promise.all([
    db.from("form_submissions").select("id, form_key, data, score, submitted_name").like("form_key", "pulse_%").eq("status", "submitted").eq("for_day", today()),
    db.from("profiles").select("id", { count: "exact", head: true }).not("pulse_dept", "is", null).eq("status", "active"),
  ]);
  const rows = (subs ?? []) as { id: number; form_key: string; data: Data; score: number | null; submitted_name: string | null }[];
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length) : null;
  const alerts = rows.flatMap((r) => (SPECS[r.form_key]?.score?.(r.data).flags ?? []).filter((f) => f !== "Blocked").map((f) => ({ f, r })));
  return (
    <Card title="Team pulse today" href="/pulse" link="Dashboard" tone={alerts.length ? "err" : undefined}>
      <div className="row" style={{ gap: 18 }}>
        <span className="col tight"><b style={{ fontSize: 22 }}>{rows.length}{count ? `/${count}` : ""}</b><span className="tiny muted">in</span></span>
        <span className="col tight"><b style={{ fontSize: 22 }} className={avg === null ? "" : avg >= 85 ? "ok-text" : avg >= 60 ? "warn-text" : "red"}>{avg === null ? "–" : `${avg}%`}</b><span className="tiny muted">average</span></span>
      </div>
      {alerts.slice(0, 3).map(({ f, r }) => (
        <Link key={`${r.id}${f}`} href={`/forms/s/${r.id}`} className="row small" style={{ gap: 6, marginTop: 6 }}><TriangleAlert size={14} className="red" /> {f} · {r.submitted_name}</Link>
      ))}
    </Card>
  );
}
