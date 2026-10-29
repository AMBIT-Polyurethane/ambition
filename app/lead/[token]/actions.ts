"use server";

import { createClient } from "@/lib/supabase/server";

export type LeadFormState = { ok: true } | { ok: false; error: string } | null;

const s = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

/** A homeowner (or builder) asks for a quote from the contractor's public form. */
export async function submitLeadRequest(_prev: LeadFormState, f: FormData): Promise<LeadFormState> {
  // Bots fill every box; people never see this one.
  if (s(f, "website")) return { ok: true };
  const token = s(f, "token", 64);
  const data = {
    name: s(f, "name", 120),
    phone: s(f, "phone", 40),
    email: s(f, "email", 160),
    street: s(f, "street", 160),
    city: s(f, "city", 80),
    state: s(f, "state", 2),
    zip: s(f, "zip", 10),
    services: f.getAll("services").map((x) => String(x).slice(0, 60)).slice(0, 10),
    message: s(f, "message", 2000),
  };
  if (!data.name) return { ok: false, error: "Please add your name." };
  if (!data.phone && !data.email) return { ok: false, error: "Please add a phone number or an email so they can reach you." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ops_lead_submit", { p_token: token, p_data: data });
  if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, "") || "That didn't go through. Please try again." };
  return { ok: true };
}
