"use server";

import { getSession } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Jump back in" remembers orders on the device. Which of them are still open: an order that was deleted, cancelled
 * or completed (picked up / delivered) drops off the list.
 */
export async function openOrders(ids: string[]): Promise<string[] | null> {
  const list = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, 20);
  if (!list.length) return [];
  const s = await getSession();
  if (!s?.profile) return null;
  const { data, error } = await s.supabase.from("orders").select("id, status").in("id", list);
  if (error) return null; // can't tell right now: keep showing them
  return ((data ?? []) as { id: string; status: string }[]).filter((o) => o.status !== "cancelled" && o.status !== "completed").map((o) => o.id);
}
