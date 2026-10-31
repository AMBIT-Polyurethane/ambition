"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";

// AMBIT-OPS work orders, office side: review a finished one, reopen one for the crew, and the
// "send spray logs to AMBIT" setting. The same ops_wo_sync() the crew's phones use checks the role.

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const go = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);

async function step(f: FormData, t: "review" | "reopen") {
  const { supabase } = await requireOps(opsCan.dispatch);
  const id = s(f, "id");
  const trip = s(f, "trip");
  const back = `/ops/work-orders/${id}`;
  if (!UUID.test(id) || !UUID.test(trip)) go("/ops/work-orders", "err", "Work order not found.");
  const { data, error } = await supabase.rpc("ops_wo_sync", { p_ops: [{ t, trip, at: new Date().toISOString(), note: s(f, "note").slice(0, 1000) }] });
  const r = (data as { results?: { ok: boolean; error?: string }[] } | null)?.results?.[0];
  if (error || !r?.ok) go(back, "err", error?.message ?? r?.error ?? "That didn't save.");
  revalidatePath(back);
  revalidatePath("/ops/work-orders");
  go(back, "msg", t === "review" ? "Reviewed. It's in the Reviewed list." : "Reopened. The crew can change it again on their phones.");
}

export async function reviewWorkOrder(f: FormData) {
  await step(f, "review");
}

export async function reopenWorkOrder(f: FormData) {
  await step(f, "reopen");
}

export async function saveWorkOrderSettings(f: FormData) {
  const { supabase } = await requireOps(opsCan.manage);
  const { error } = await supabase.rpc("ops_set_share_logs", { p_on: f.get("share_logs") === "on" });
  if (error) go("/ops/settings/work-orders", "err", error.message);
  revalidatePath("/ops/settings/work-orders");
  go("/ops/settings/work-orders", "msg", "Saved.");
}
