import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { merchantName } from "@/lib/expense-chase";

// "Connect Chase": the bank link through Plaid (plaid.com). An approver signs in to Chase once in Plaid's
// window; after that the card charges come in on their own every day. Vercel settings: PLAID_CLIENT_ID,
// PLAID_SECRET and PLAID_ENV ("sandbox" to try it with Plaid's test bank, "production" for the real one).
// The bank's key (the access token) is only ever read by the server (expense_bank_links has no rules).

const env = () => ((process.env.PLAID_ENV || "sandbox").trim().toLowerCase() === "production" ? "production" : "sandbox");
export const plaidEnv = env;
export const plaidReady = () => Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim());

type PlaidError = { error_type?: string; error_code?: string; error_message?: string; display_message?: string | null };

async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${env()}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID?.trim(), secret: process.env.PLAID_SECRET?.trim(), ...body }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & PlaidError;
  if (!res.ok) {
    const e = new Error(data.display_message || data.error_message || `Plaid said ${res.status}`) as Error & { code?: string };
    e.code = data.error_code;
    throw e;
  }
  return data;
}

/** The one-time key Plaid's window opens with. */
export async function linkToken(userId: string, accessToken?: string): Promise<string> {
  const r = await plaid<{ link_token: string }>("/link/token/create", {
    client_name: "AMBIT Intelligence",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: userId },
    ...(accessToken ? { access_token: accessToken } : { products: ["transactions"], transactions: { days_requested: 180 } }),
  });
  return r.link_token;
}

export async function exchange(publicToken: string): Promise<{ access_token: string; item_id: string }> {
  return plaid("/item/public_token/exchange", { public_token: publicToken });
}

export type PlaidAccount = { account_id: string; mask: string | null; name: string; official_name: string | null; type: string; subtype: string | null };
export async function accounts(accessToken: string): Promise<PlaidAccount[]> {
  const r = await plaid<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: accessToken });
  return r.accounts ?? [];
}

export async function removeItem(accessToken: string) {
  await plaid("/item/remove", { access_token: accessToken }).catch(() => null);
}

type Txn = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
};

const kindOf = (t: Txn): "purchase" | "return" | "fee" | "payment" => {
  const cat = t.personal_finance_category?.primary ?? "";
  if (t.amount < 0) return cat === "LOAN_PAYMENTS" || cat === "TRANSFER_IN" || /payment|thank you|autopay/i.test(t.name) ? "payment" : "return";
  return cat === "BANK_FEES" ? "fee" : "purchase";
};

type Link = { id: string; item_id: string; access_token: string; cursor: string | null };

/**
 * Brings in what's new for one bank link (db = the server's own key). Card charges already uploaded from a
 * statement are recognized (same card, amount and day, give or take 2) instead of added twice.
 */
export async function syncLink(db: SupabaseClient, link: Link): Promise<{ added: number; matched: number; removed: number; error?: string }> {
  let cursor = link.cursor ?? undefined;
  let added = 0;
  let matched = 0;
  let removed = 0;
  try {
    const accts = await accounts(link.access_token);
    const mask = new Map(accts.map((a) => [a.account_id, a.mask]));
    // Each card on the link: remember it (and who it belongs to, if an approver said so already).
    const { data: had } = await db.from("expense_cards").select("last4");
    const have = new Set(((had ?? []) as { last4: string }[]).map((c) => c.last4));
    for (const a of accts) {
      if (!a.mask || !/^\d{4}$/.test(a.mask) || a.type !== "credit") continue;
      if (have.has(a.mask)) await db.from("expense_cards").update({ plaid_account_id: a.account_id }).eq("last4", a.mask);
      else await db.from("expense_cards").insert({ last4: a.mask, plaid_account_id: a.account_id, label: (a.official_name || a.name).slice(0, 60) });
    }
    const { data: cards } = await db.from("expense_cards").select("last4, user_id");
    const owner = new Map(((cards ?? []) as { last4: string; user_id: string | null }[]).map((c) => [c.last4, c.user_id]));
    const credit = new Set(accts.filter((a) => a.type === "credit").map((a) => a.account_id));

    for (let page = 0; page < 40; page++) {
      const r = await plaid<{ added: Txn[]; modified: Txn[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }>("/transactions/sync", {
        access_token: link.access_token,
        cursor,
        count: 500,
      });
      for (const t of [...r.added, ...r.modified]) {
        if (t.pending || !credit.has(t.account_id)) continue;
        const card = mask.get(t.account_id) ?? null;
        const amount = Math.round(t.amount * 100) / 100;
        const day = t.authorized_date || t.date;
        const { data: known } = await db.from("expense_charges").select("id").eq("plaid_id", t.transaction_id).maybeSingle();
        if (known) continue;
        // Already here from a statement upload?
        const lo = new Date(`${day}T12:00:00Z`);
        lo.setUTCDate(lo.getUTCDate() - 2);
        const hi = new Date(`${day}T12:00:00Z`);
        hi.setUTCDate(hi.getUTCDate() + 2);
        let q = db.from("expense_charges").select("id").is("plaid_id", null).eq("amount", amount).gte("txn_date", lo.toISOString().slice(0, 10)).lte("txn_date", hi.toISOString().slice(0, 10)).limit(1);
        q = card ? q.eq("card_last4", card) : q;
        const { data: dup } = await q.maybeSingle();
        if (dup) {
          await db.from("expense_charges").update({ plaid_id: t.transaction_id }).eq("id", (dup as { id: string }).id);
          matched++;
          continue;
        }
        const { error } = await db.from("expense_charges").insert({
          source: "plaid",
          external_id: `plaid:${t.transaction_id}`,
          plaid_id: t.transaction_id,
          card_last4: card,
          user_id: card ? owner.get(card) ?? null : null,
          txn_date: day,
          post_date: t.date,
          description: t.name.slice(0, 300),
          merchant: (t.merchant_name || merchantName(t.name)).slice(0, 80),
          bank_category: t.personal_finance_category?.primary ?? null,
          kind: kindOf(t),
          amount,
        });
        if (!error) added++;
      }
      for (const x of r.removed) {
        const { data } = await db.from("expense_charges").update({ removed: true }).eq("plaid_id", x.transaction_id).is("receipt_id", null).select("id");
        removed += data?.length ?? 0;
      }
      cursor = r.next_cursor;
      if (!r.has_more) break;
    }
    await db.from("expense_bank_links").update({ cursor, status: "ok", error: null, last_sync_at: new Date().toISOString() }).eq("id", link.id);
    return { added, matched, removed };
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .from("expense_bank_links")
      .update({ cursor: cursor ?? link.cursor, status: code === "ITEM_LOGIN_REQUIRED" ? "needs_login" : "error", error: msg.slice(0, 400), last_sync_at: new Date().toISOString() })
      .eq("id", link.id);
    return { added, matched, removed, error: msg };
  }
}

/** Every bank link, then the matching. */
export async function syncAll(db: SupabaseClient): Promise<{ links: number; added: number; matched: number; errors: string[] }> {
  const { data } = await db.from("expense_bank_links").select("id, item_id, access_token, cursor");
  const out = { links: 0, added: 0, matched: 0, errors: [] as string[] };
  for (const l of (data ?? []) as Link[]) {
    const r = await syncLink(db, l);
    out.links++;
    out.added += r.added;
    out.matched += r.matched;
    if (r.error) out.errors.push(r.error);
  }
  if (out.added) {
    await db.from("expense_imports").insert({ source: "plaid", rows: out.added + out.matched, added: out.added, skipped: out.matched, by_name: "Bank link" });
  }
  return out;
}
