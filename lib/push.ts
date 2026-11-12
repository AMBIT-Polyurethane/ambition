import "server-only";
import webpush from "web-push";
import { serviceClient, serviceReady } from "@/lib/supabase/service";

// Phone notifications (web push). The server makes its own key pair the first time and keeps it in app_secrets
// (only the server's secret key can read that table), so there's nothing to set up. Each phone or computer that
// turns notifications on is a row in push_subscriptions.

type Keys = { publicKey: string; privateKey: string };
let cached: Keys | null = null;

async function keys(): Promise<Keys | null> {
  if (cached) return cached;
  if (!serviceReady()) return null;
  const db = serviceClient();
  const { data } = await db.from("app_secrets").select("value").eq("key", "vapid").maybeSingle();
  let k = (data?.value as Keys | undefined) ?? null;
  if (!k?.publicKey || !k?.privateKey) {
    const made = webpush.generateVAPIDKeys();
    // Another request may have just made one: keep whichever got saved first.
    await db.from("app_secrets").insert({ key: "vapid", value: made });
    const { data: again } = await db.from("app_secrets").select("value").eq("key", "vapid").maybeSingle();
    k = (again?.value as Keys | undefined) ?? null;
  }
  if (!k) return null;
  cached = k;
  return k;
}

/** The public half, for the browser to subscribe with. */
export async function pushPublicKey(): Promise<string | null> {
  return (await keys())?.publicKey ?? null;
}

export type PushNote = { title: string; body: string; url: string; tag?: string };

/** Sends a notification to every device these people turned notifications on for. Never throws. */
export async function sendPush(userIds: string[], note: PushNote): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const k = await keys().catch(() => null);
  if (!k) return 0;
  const db = serviceClient();
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, fails").in("user_id", ids);
  const contact = `mailto:${process.env.PUSH_CONTACT || "orders@ambitpu.com"}`;
  let sent = 0;
  const payload = JSON.stringify({ ...note, title: note.title.slice(0, 80), body: note.body.slice(0, 240) });
  await Promise.all(
    ((subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; fails: number }[]).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: contact, publicKey: k.publicKey, privateKey: k.privateKey },
          TTL: 60 * 60 * 6,
          urgency: "high",
          topic: note.tag ? note.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined : undefined,
        });
        sent++;
        await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fails: 0 }).eq("id", s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // Gone (the phone turned them off or the app was removed): forget it. Otherwise count the failure.
        if (code === 404 || code === 410 || s.fails >= 9) await db.from("push_subscriptions").delete().eq("id", s.id);
        else await db.from("push_subscriptions").update({ fails: s.fails + 1 }).eq("id", s.id);
      }
    }),
  );
  return sent;
}
