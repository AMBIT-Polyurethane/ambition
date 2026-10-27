import { CalendarDays, Mail, Video } from "lucide-react";
import { Card } from "@/components/home-widgets";
import { addDays, centralStart } from "@/lib/order-desk";
import { todayCentral } from "@/lib/sale";
import { OutlookError, outlookAccount, outlookAgenda, outlookAvailable, outlookInbox, type CalEvent } from "@/lib/outlook";
import { disconnectOutlook } from "@/app/(app)/home-actions";
import type { Profile } from "@/lib/types";

// Outlook on Home: the person's own inbox and calendar, read from Microsoft 365 with the account they connected.

const MAIL_URL = "https://outlook.office.com/mail/";
const CAL_URL = "https://outlook.office.com/calendar/";

/** Jacksonville is on Eastern time; every other AMBIT location is on Central. */
const zoneFor = (p: Pick<Profile, "branch_id">) =>
  p.branch_id === "jax" ? { ms: "Eastern Standard Time", iana: "America/New_York" } : { ms: "Central Standard Time", iana: "America/Chicago" };

function Connect({ what }: { what: "inbox" | "calendar" }) {
  return (
    <div className="ol-connect">
      <p className="small" style={{ margin: 0 }}>
        See your {what === "inbox" ? "newest emails and unread count" : "meetings for the week"} right here. Sign in once with your AMBIT
        Microsoft account; the app can only read, never send or change anything.
      </p>
      <a href="/api/microsoft/outlook" className="btn sm" style={{ alignSelf: "flex-start", gap: 8 }}>
        {what === "inbox" ? <Mail size={16} /> : <CalendarDays size={16} />} Connect Outlook
      </a>
    </div>
  );
}

function Problem({ e, what }: { e: unknown; what: "inbox" | "calendar" }) {
  const err = e instanceof OutlookError ? e : new OutlookError("Outlook didn't answer. Try again in a minute.", "error");
  if (err.kind === "not_connected") return <Connect what={what} />;
  return (
    <div className="ol-connect">
      <p className="small" style={{ margin: 0, color: err.kind === "error" ? "var(--text2)" : "var(--warn-text)" }}>{err.message}</p>
      {err.kind === "expired" || err.kind === "consent" ? (
        <a href="/api/microsoft/outlook" className="btn sm dark" style={{ alignSelf: "flex-start" }}>Connect Outlook again</a>
      ) : null}
    </div>
  );
}

function Footer({ email }: { email: string }) {
  return (
    <form action={disconnectOutlook} className="ol-foot">
      <span className="tiny faint ellipsis">{email ? `Connected as ${email}` : "Connected"}</span>
      <button type="submit" className="linkbtn tiny">Disconnect</button>
    </form>
  );
}

/** "9:42 AM" today, "Yesterday", "Mon", or "Oct 3". */
function when(iso: string, iana: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: iana });
  const today = day(new Date());
  if (day(d) === today) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: iana });
  if (day(d) === day(new Date(Date.now() - 86400000))) return "Yesterday";
  if (Date.now() - d.getTime() < 6 * 86400000) return d.toLocaleDateString("en-US", { weekday: "short", timeZone: iana });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: iana });
}

export async function OutlookMailWidget({ profile }: { profile: Profile }) {
  if (!outlookAvailable()) {
    return (
      <Card title="Outlook inbox">
        <p className="small muted" style={{ margin: 0 }}>Outlook isn&apos;t switched on for the app yet. An admin finishes the Microsoft setup first.</p>
      </Card>
    );
  }
  const acct = await outlookAccount(profile.id);
  if (!acct) {
    return (
      <Card title="Outlook inbox">
        <Connect what="inbox" />
      </Card>
    );
  }
  const zone = zoneFor(profile);
  let data: Awaited<ReturnType<typeof outlookInbox>> | null = null;
  let problem: unknown = null;
  try {
    data = await outlookInbox(profile.id, 6);
  } catch (e) {
    problem = e;
  }
  return (
    <Card title="Outlook inbox" href={MAIL_URL} link="Open Outlook" external>
      {data ? (
        <>
          <div className="ol-count">
            <b>{data.unread}</b>
            <span className="small muted">{data.unread === 1 ? "unread email" : "unread emails"}</span>
          </div>
          {data.messages.length ? (
            <ul className="ol-list">
              {data.messages.map((m) => (
                <li key={m.id}>
                  <a href={m.link ?? MAIL_URL} target="_blank" rel="noopener noreferrer" className={m.unread ? "unread" : ""}>
                    <span className="row between" style={{ gap: 8 }}>
                      <span className="ellipsis ol-from">{m.unread ? <i className="ol-dot" aria-label="Unread" /> : null}{m.from}</span>
                      <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{when(m.received, zone.iana)}</span>
                    </span>
                    <span className="ellipsis small ol-subj">{m.subject}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Your inbox is empty.</p>
          )}
        </>
      ) : (
        <Problem e={problem} what="inbox" />
      )}
      <Footer email={acct.email} />
    </Card>
  );
}

const hm = (local: string) => {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${ap}`;
};
const dayHead = (day: string, today: string) => {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
};

export async function OutlookCalendarWidget({ profile }: { profile: Profile }) {
  if (!outlookAvailable()) {
    return (
      <Card title="Outlook calendar">
        <p className="small muted" style={{ margin: 0 }}>Outlook isn&apos;t switched on for the app yet. An admin finishes the Microsoft setup first.</p>
      </Card>
    );
  }
  const acct = await outlookAccount(profile.id);
  if (!acct) {
    return (
      <Card title="Outlook calendar">
        <Connect what="calendar" />
      </Card>
    );
  }
  const zone = zoneFor(profile);
  const today = todayCentral();
  let events: CalEvent[] | null = null;
  let problem: unknown = null;
  try {
    events = await outlookAgenda(profile.id, centralStart(today), centralStart(addDays(today, 7)), zone.ms);
  } catch (e) {
    problem = e;
  }
  // Today's meetings that haven't ended yet, then the rest of the week: 6 at most.
  const nowLocal = new Date().toLocaleString("sv-SE", { timeZone: zone.iana }).replace(" ", "T");
  const upcoming = (events ?? []).filter((e) => (e.allDay ? e.end.slice(0, 10) > today : e.end > nowLocal)).slice(0, 6);
  const todays = upcoming.filter((e) => e.start.slice(0, 10) <= today);
  const groups = new Map<string, CalEvent[]>();
  for (const e of upcoming) {
    const d = e.start.slice(0, 10) < today ? today : e.start.slice(0, 10);
    groups.set(d, [...(groups.get(d) ?? []), e]);
  }
  return (
    <Card title="Outlook calendar" href={CAL_URL} link="Open calendar" external>
      {events ? (
        upcoming.length ? (
          <div className="ol-agenda">
            {!todays.length ? <p className="small muted" style={{ margin: 0 }}>Nothing else on your calendar today.</p> : null}
            {[...groups.entries()].map(([day, list]) => (
              <div key={day} className="ol-day">
                <span className="wg-sub">{dayHead(day, today)}</span>
                <ul className="ol-list">
                  {list.map((e) => (
                    <li key={e.id}>
                      <a href={e.link ?? CAL_URL} target="_blank" rel="noopener noreferrer" className="ol-ev">
                        <span className="ol-time">{e.allDay ? "All day" : hm(e.start)}</span>
                        <span className="grow" style={{ minWidth: 0 }}>
                          <span className="ellipsis ol-subj" style={{ display: "block" }}><b>{e.subject}</b></span>
                          <span className="tiny faint ellipsis" style={{ display: "block" }}>
                            {[e.allDay ? "" : `until ${hm(e.end)}`, e.location || (e.online ? "Teams meeting" : "")].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        {e.online ? <Video size={15} className="faint" aria-label="Online meeting" /> : null}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Nothing on your calendar for the next 7 days.</p>
        )
      ) : (
        <Problem e={problem} what="calendar" />
      )}
      <Footer email={acct.email} />
    </Card>
  );
}
