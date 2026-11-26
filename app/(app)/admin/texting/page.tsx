import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { TestTextForm } from "@/components/test-text-form";
import { currentOrigin } from "@/lib/origin";
import { prettyPhone, smsErrorText, smsReady, smsSetup } from "@/lib/sms";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Texting" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { approval: "Approval link", scheduled: "Scheduled", done: "Picked up / delivered", handoff: "Hand-off", waiting: "Waiting on you", test: "Test", reply: "Reply" };

/** Admin > Texting (0118): is Twilio set up, the two webhook links for Twilio, a test text, every text sent, STOPs. */
export default async function TextingPage() {
  const { supabase } = await requireAdmin();
  const origin = await currentOrigin();
  const set = smsSetup();
  const [logRes, outRes, staffRes] = await Promise.all([
    supabase.from("sms_log").select("id, at, direction, to_phone, from_phone, kind, body, status, error").order("at", { ascending: false }).limit(60),
    supabase.from("sms_optout").select("phone, at, said").order("at", { ascending: false }).limit(50),
    supabase.from("profiles").select("full_name, sms_phone").eq("sms_on", true).in("role", ["admin", "employee"]).order("full_name"),
  ]);
  const needs0118 = Boolean(logRes.error);
  const log = (logRes.data ?? []) as { id: number; at: string; direction: string; to_phone: string | null; from_phone: string | null; kind: string | null; body: string; status: string | null; error: string | null }[];
  const outs = (outRes.data ?? []) as { phone: string; at: string; said: string | null }[];
  const staff = (staffRes.data ?? []) as { full_name: string | null; sms_phone: string | null }[];
  const step = (ok: boolean, t: string) => <li className="small" style={{ color: ok ? "var(--ok-text)" : "var(--warn-text)" }}>{ok ? "✓" : "•"} {t}</li>;

  return (
    <main className="shell">
      <TopBar title="Texting" back="/admin" />
      {needs0118 ? <div className="alert warn small"><span>Texting needs database update 0118 first (Supabase › SQL Editor).</span></div> : null}
      <section className="card col" style={{ gap: 10 }}>
        <b>Twilio setup</b>
        <ul style={{ margin: 0, paddingLeft: 4, listStyle: "none" }} className="col tight">
          {step(set.account, "TWILIO_ACCOUNT_SID in Vercel")}
          {step(set.token, "TWILIO_AUTH_TOKEN in Vercel")}
          {step(set.service || set.from, "TWILIO_MESSAGING_SERVICE_SID in Vercel (the service with the approved campaign)")}
        </ul>
        <span className="small muted">{smsReady() ? "Texting is on." : "Texting is off until all three are in Vercel (then Redeploy)."}</span>
        <div className="col tight" style={{ gap: 6 }}>
          <span className="small"><b>In Twilio</b> › Messaging › Services › your service › <b>Integration</b> › Incoming messages › <b>Send a webhook</b>, paste:</span>
          <div className="row" style={{ gap: 8, alignItems: "center" }}><code className="small" style={{ overflowWrap: "anywhere" }}>{origin}/api/twilio/inbound</code><CopyButton text={`${origin}/api/twilio/inbound`} /></div>
          <span className="tiny faint">Delivery updates come back on their own (each text tells Twilio where to report).</span>
        </div>
      </section>
      <section className="card col" style={{ gap: 10 }}>
        <b>Send a test text</b>
        <TestTextForm />
      </section>
      <section className="card col" style={{ gap: 8 }}>
        <b>Staff with text alerts on ({staff.length})</b>
        {staff.length ? <span className="small">{staff.map((p) => `${p.full_name ?? "?"} ${p.sms_phone ? prettyPhone(p.sms_phone) : ""}`).join(" · ")}</span> : <span className="small muted">Nobody yet. Each person turns them on in Profile › Text alerts.</span>}
      </section>
      <section className="card col" style={{ gap: 8 }}>
        <b>Texts</b>
        {log.length ? (
          <div className="list">
            {log.map((m) => (
              <div key={m.id} className="item col" style={{ gap: 2, alignItems: "flex-start", textAlign: "left" }}>
                <span className="tiny faint">{dateTime(m.at)} · {m.direction === "in" ? `From ${prettyPhone(m.from_phone)}` : `To ${prettyPhone(m.to_phone)}${m.from_phone ? ` from ${m.from_phone.startsWith("MG") ? `service ${m.from_phone.slice(0, 8)}…` : prettyPhone(m.from_phone)}` : ""}`} · {KIND[m.kind ?? ""] ?? m.kind} · <b style={{ color: m.status === "failed" || m.status === "undelivered" ? "var(--err-text)" : m.status === "delivered" || m.status === "received" ? "var(--ok-text)" : undefined }}>{m.status}</b>{m.error ? ` · ${m.error}` : ""}</span>
                <span className="small" style={{ overflowWrap: "anywhere" }}>{m.body}</span>
                {smsErrorText(m.error) ? <span className="tiny err-text">{smsErrorText(m.error)}</span> : null}
              </div>
            ))}
          </div>
        ) : <span className="small muted">No texts yet.</span>}
      </section>
      <section className="card col" style={{ gap: 8 }}>
        <b>Replied STOP ({outs.length})</b>
        {outs.length ? <span className="small">{outs.map((o) => `${prettyPhone(o.phone)} (${dateTime(o.at)})`).join(" · ")}</span> : <span className="small muted">Nobody.</span>}
      </section>
    </main>
  );
}
