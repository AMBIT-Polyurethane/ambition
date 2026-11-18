import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPush } from "@/lib/push";

// 0089: the database writes the hand-off note in the order chat when an order moves on; this sends each person tagged
// in it a phone notification, once.

export async function pushHandoffs(db: SupabaseClient, orderId: string): Promise<void> {
  const { data, error } = await db.rpc("chat_handoffs_to_push", { p_order: orderId });
  if (error || !data) return;
  for (const m of data as { id: number; channel_id: string; body: string; mentions: string[] }[]) {
    if (!m.mentions?.length) continue;
    const [what] = m.body.split(" → ");
    await sendPush(m.mentions, {
      title: `${what} · your turn`,
      body: m.body.slice(0, 180),
      url: `/chat/${m.channel_id}?m=${m.id}`,
      tag: `handoff-${m.channel_id}`,
    }).catch(() => 0);
  }
}
