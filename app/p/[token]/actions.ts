"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SignResult = { ok: true } | { ok: false; error: string };

const clean = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/** The customer signs from the private link (no sign-in). The total is worked out by the database. */
export async function signProposal(token: string, input: { option: string; addons: string[]; name: string; email: string; signature: string }): Promise<SignResult> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim().slice(0, 60);
  const ua = (h.get("user-agent") ?? "").slice(0, 300);
  const supabase = await createClient();
  const { error } = await supabase.rpc("ops_proposal_sign", {
    p_token: clean(token, 100),
    p_option: clean(input.option, 40),
    p_addons: (input.addons ?? []).map((a) => clean(a, 40)).slice(0, 50),
    p_name: clean(input.name, 120),
    p_email: clean(input.email, 160),
    p_signature: String(input.signature ?? "").slice(0, 300000),
    p_ip: ip,
    p_ua: ua,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/p/${token}`);
  return { ok: true };
}

export async function declineProposal(token: string, reason: string): Promise<SignResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("ops_proposal_decline", { p_token: clean(token, 100), p_reason: clean(reason, 500) });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/p/${token}`);
  return { ok: true };
}
