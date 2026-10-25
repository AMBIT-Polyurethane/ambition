import "server-only";
import { serviceClient, serviceReady } from "@/lib/supabase/service";

// The app's connection to Microsoft 365, used to read and update the branch inventory workbooks
// in OneDrive / SharePoint. An admin connects once (Admin > Inventory > Connect Microsoft) with
// their own Microsoft login; the app then keeps a refresh token, stored where only the server
// can read it, and uses it to reach the workbooks on its own.
//
// Vercel settings: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET (the "AMBITION" app registration
// in Microsoft Entra), plus SUPABASE_SECRET_KEY.

export const MS_SCOPES = "offline_access User.Read Files.ReadWrite.All";
export const MS_ENV = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"] as const;

const LOGIN = () => (process.env.MS_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/$/, "");
const GRAPH = () => (process.env.MS_GRAPH_URL || "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
const env = (k: (typeof MS_ENV)[number]) => (process.env[k] ?? "").trim();

/** Vercel settings still to add before the connection can work. */
export const msMissing = (): string[] => MS_ENV.filter((k) => !env(k));
export const msReady = () => msMissing().length === 0;

export class MsError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "",
  ) {
    super(message);
  }
}

type Stored = {
  refresh_token: string;
  access_token?: string;
  expires_at?: number; // ms
  account: { name: string; email: string };
  connected_at: string;
  connected_by: string;
};

const SECRET_KEY = "microsoft";

async function load(): Promise<Stored | null> {
  if (!serviceReady()) return null;
  const { data, error } = await serviceClient().from("app_secrets").select("value").eq("key", SECRET_KEY).maybeSingle<{ value: string }>();
  if (error || !data) return null;
  try {
    return JSON.parse(data.value) as Stored;
  } catch {
    return null;
  }
}

async function save(s: Stored) {
  const { error } = await serviceClient()
    .from("app_secrets")
    .upsert({ key: SECRET_KEY, value: JSON.stringify(s), updated_at: new Date().toISOString() });
  if (error) throw new MsError(`Couldn't save the Microsoft connection: ${error.message}`);
}

/** Who connected, and when (never the tokens). */
export async function msConnection(): Promise<Pick<Stored, "account" | "connected_at" | "connected_by"> | null> {
  const s = await load();
  return s ? { account: s.account, connected_at: s.connected_at, connected_by: s.connected_by } : null;
}

export async function msDisconnect() {
  await serviceClient().from("app_secrets").delete().eq("key", SECRET_KEY);
}

/** Where "Connect Microsoft" sends the admin to sign in and allow access. */
export function msAuthorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(`${LOGIN()}/${encodeURIComponent(env("MS_TENANT_ID"))}/oauth2/v2.0/authorize`);
  u.searchParams.set("client_id", env("MS_CLIENT_ID"));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MS_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenCall(params: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(`${LOGIN()}/${encodeURIComponent(env("MS_TENANT_ID"))}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"), scope: MS_SCOPES, ...params }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || !json.access_token) {
    const why = (json.error_description || json.error || `Microsoft answered ${res.status}`).split(/\r?\n/)[0];
    throw new MsError(why, res.status, json.error ?? "");
  }
  return json;
}

/** Finishes "Connect Microsoft": swaps the sign-in code for tokens and remembers them. */
export async function msFinishConnect(code: string, redirectUri: string, connectedBy: string) {
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!t.refresh_token) throw new MsError("Microsoft didn't allow staying connected (offline_access). Check the app's API permissions.");
  type Me = { displayName?: string; mail?: string; userPrincipalName?: string };
  const me: Me = await fetch(`${GRAPH()}/me?$select=displayName,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${t.access_token}` },
    cache: "no-store",
  }).then((r) => (r.ok ? (r.json() as Promise<Me>) : {}));
  const s: Stored = {
    refresh_token: t.refresh_token,
    access_token: t.access_token,
    expires_at: Date.now() + (t.expires_in ?? 3600) * 1000,
    account: { name: me.displayName ?? "", email: (me.mail || me.userPrincipalName || "").toLowerCase() },
    connected_at: new Date().toISOString(),
    connected_by: connectedBy,
  };
  await save(s);
  return s.account;
}

async function accessToken(force = false): Promise<string> {
  const s = await load();
  if (!s) throw new MsError("Microsoft isn't connected yet. An admin taps Connect Microsoft in Admin > Inventory.", 401, "not_connected");
  if (!force && s.access_token && (s.expires_at ?? 0) > Date.now() + 120_000) return s.access_token;
  if (!msReady()) throw new MsError(`Add ${msMissing().join(", ")} in Vercel.`, 0, "not_configured");
  let t: TokenReply;
  try {
    t = await tokenCall({ grant_type: "refresh_token", refresh_token: s.refresh_token });
  } catch (e) {
    const err = e as MsError;
    if (err.code === "invalid_grant") {
      throw new MsError("The Microsoft connection has expired or was turned off. An admin needs to tap Connect Microsoft again.", 401, "expired");
    }
    throw err;
  }
  await save({
    ...s,
    access_token: t.access_token,
    refresh_token: t.refresh_token || s.refresh_token,
    expires_at: Date.now() + (t.expires_in ?? 3600) * 1000,
  });
  return t.access_token!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Microsoft Graph call. Waits and tries again when Microsoft is busy (429 / 503 / 504),
 * and gets a fresh token once if the old one was refused.
 */
export async function graph<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let token = await accessToken();
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith("http") ? path : `${GRAPH()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    if (res.status === 401 && !refreshed) {
      token = await accessToken(true);
      refreshed = true;
      continue;
    }
    if ([429, 503, 504].includes(res.status) && attempt < 3) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2 ** attempt * 2, 10);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new MsError(e?.message || `Microsoft answered ${res.status}`, res.status, e?.code ?? "");
    }
    return json as T;
  }
}

/** Graph's id for a sharing link (https://learn.microsoft.com/graph/api/shares-get). */
export function shareId(url: string): string {
  return "u!" + Buffer.from(url.trim(), "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}
