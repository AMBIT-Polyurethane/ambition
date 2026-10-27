import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { GRAPH, MsError, msReady, msTokenCall } from "@/lib/microsoft";

// Outlook on Home (0029): each AMBIT staff member connects their own Microsoft 365 account once ("Connect Outlook").
// The app keeps that person's refresh token where only the server can read it (user_ms_tokens) and uses it to read
// their inbox and calendar. It can read, never send, change or delete anything.

export const OUTLOOK_SCOPES = "offline_access User.Read Mail.Read Calendars.Read";

type Row = {
  user_id: string;
  account_email: string | null;
  account_name: string | null;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
};

export class OutlookError extends Error {
  constructor(
    message: string,
    public kind: "not_connected" | "expired" | "consent" | "unavailable" | "error",
  ) {
    super(message);
  }
}

/** Can Outlook work at all here (the Microsoft app settings and the server key are in Vercel)? */
export const outlookAvailable = () => msReady() && serviceReady();

async function load(userId: string): Promise<Row | null> {
  if (!serviceReady()) return null;
  const { data, error } = await serviceClient().from("user_ms_tokens").select("*").eq("user_id", userId).maybeSingle<Row>();
  return error ? null : data;
}

/** The Microsoft account someone connected (never the tokens), or null. */
export async function outlookAccount(userId: string): Promise<{ email: string; name: string } | null> {
  const r = await load(userId);
  return r ? { email: r.account_email ?? "", name: r.account_name ?? "" } : null;
}

export async function outlookDisconnect(userId: string) {
  if (!serviceReady()) return;
  await serviceClient().from("user_ms_tokens").delete().eq("user_id", userId);
}

/** Finishes "Connect Outlook": swaps the sign-in code for tokens and keeps them for this person. */
export async function outlookFinishConnect(userId: string, code: string, redirectUri: string) {
  const t = await msTokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, OUTLOOK_SCOPES);
  if (!t.refresh_token) throw new MsError("Microsoft didn't allow staying connected (offline_access).");
  type Me = { displayName?: string; mail?: string; userPrincipalName?: string };
  const me: Me = await fetch(`${GRAPH()}/me?$select=displayName,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${t.access_token}` },
    cache: "no-store",
  }).then((r) => (r.ok ? (r.json() as Promise<Me>) : {}));
  const account = { name: me.displayName ?? "", email: (me.mail || me.userPrincipalName || "").toLowerCase() };
  const { error } = await serviceClient()
    .from("user_ms_tokens")
    .upsert({
      user_id: userId,
      account_email: account.email,
      account_name: account.name,
      refresh_token: t.refresh_token,
      access_token: t.access_token ?? null,
      expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      scopes: t.scope ?? OUTLOOK_SCOPES,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  if (error) throw new MsError(`Couldn't save the Outlook connection: ${error.message}`);
  return account;
}

async function token(userId: string, force = false): Promise<string> {
  if (!outlookAvailable()) throw new OutlookError("Outlook isn't set up for the app yet.", "unavailable");
  const r = await load(userId);
  if (!r) throw new OutlookError("Connect your Outlook to see it here.", "not_connected");
  if (!force && r.access_token && r.expires_at && new Date(r.expires_at).getTime() > Date.now() + 120_000) return r.access_token;
  try {
    const t = await msTokenCall({ grant_type: "refresh_token", refresh_token: r.refresh_token }, OUTLOOK_SCOPES);
    await serviceClient()
      .from("user_ms_tokens")
      .update({
        access_token: t.access_token ?? null,
        refresh_token: t.refresh_token || r.refresh_token,
        expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return t.access_token!;
  } catch (e) {
    const err = e as MsError;
    if (err.code === "invalid_grant" || err.code === "interaction_required") {
      throw new OutlookError("Your Outlook connection has expired. Connect it again.", "expired");
    }
    if (err.code === "consent_required" || /AADSTS65001/.test(err.message)) {
      throw new OutlookError("Your Microsoft admin needs to allow the app to read mail and calendars.", "consent");
    }
    throw new OutlookError(err.message || "Microsoft didn't answer.", "error");
  }
}

/** One read from this person's mailbox or calendar (gives up after a few seconds so Home never hangs). */
async function graph<T>(userId: string, path: string, headers: Record<string, string> = {}): Promise<T> {
  let t = await token(userId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(`${GRAPH()}${path}`, { headers: { Authorization: `Bearer ${t}`, ...headers }, cache: "no-store", signal: ctl.signal });
    } catch {
      throw new OutlookError("Outlook took too long to answer. Try again in a minute.", "error");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && attempt === 0) {
      t = await token(userId, true);
      continue;
    }
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok) {
      if (res.status === 403) throw new OutlookError("The app isn't allowed to read your Outlook yet. Your Microsoft admin needs to allow Mail.Read and Calendars.Read.", "consent");
      throw new OutlookError(json?.error?.message || `Outlook answered ${res.status}.`, "error");
    }
    return json as T;
  }
  throw new OutlookError("Outlook didn't accept the connection. Connect it again.", "expired");
}

export type MailItem = { id: string; subject: string; from: string; received: string; unread: boolean; link: string | null; preview: string };

/** The newest messages in the inbox, and how many are unread. */
export async function outlookInbox(userId: string, top = 6): Promise<{ unread: number; messages: MailItem[] }> {
  type Msg = {
    id: string;
    subject?: string | null;
    from?: { emailAddress?: { name?: string; address?: string } };
    receivedDateTime?: string;
    isRead?: boolean;
    webLink?: string;
    bodyPreview?: string;
  };
  const [folder, list] = await Promise.all([
    graph<{ unreadItemCount?: number }>(userId, "/me/mailFolders/inbox?$select=unreadItemCount"),
    graph<{ value?: Msg[] }>(
      userId,
      `/me/mailFolders/inbox/messages?$top=${top}&$select=subject,from,receivedDateTime,isRead,webLink,bodyPreview&$orderby=receivedDateTime desc`,
    ),
  ]);
  return {
    unread: Number(folder?.unreadItemCount ?? 0),
    messages: (list?.value ?? []).map((m) => ({
      id: m.id,
      subject: m.subject?.trim() || "(no subject)",
      from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unknown sender",
      received: m.receivedDateTime ?? "",
      unread: !m.isRead,
      link: m.webLink ?? null,
      preview: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
    })),
  };
}

export type CalEvent = { id: string; subject: string; start: string; end: string; allDay: boolean; location: string; link: string | null; online: string | null };

/**
 * The next few days of this person's calendar, in their time zone's local time ("2026-10-27T09:00:00"), soonest
 * first. Cancelled meetings are left out.
 */
export async function outlookAgenda(userId: string, fromUtc: string, toUtc: string, timeZone: string): Promise<CalEvent[]> {
  type Ev = {
    id: string;
    subject?: string | null;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    isAllDay?: boolean;
    isCancelled?: boolean;
    location?: { displayName?: string };
    webLink?: string;
    onlineMeeting?: { joinUrl?: string } | null;
  };
  const q = new URLSearchParams({
    startDateTime: fromUtc,
    endDateTime: toUtc,
    $select: "subject,start,end,isAllDay,isCancelled,location,webLink,onlineMeeting",
    $orderby: "start/dateTime",
    $top: "40",
  });
  const r = await graph<{ value?: Ev[] }>(userId, `/me/calendarView?${q.toString()}`, { Prefer: `outlook.timezone="${timeZone}"` });
  return (r?.value ?? [])
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      id: e.id,
      subject: e.subject?.trim() || "(no title)",
      start: (e.start?.dateTime ?? "").slice(0, 19),
      end: (e.end?.dateTime ?? "").slice(0, 19),
      allDay: Boolean(e.isAllDay),
      location: e.location?.displayName?.trim() ?? "",
      link: e.webLink ?? null,
      online: e.onlineMeeting?.joinUrl ?? null,
    }));
}
