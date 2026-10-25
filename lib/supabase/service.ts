import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

// The server's own key (Supabase > Project Settings > API Keys > Secret keys). It skips the
// row-level rules, so it's only ever used on the server, for jobs nobody is signed in for
// (the inventory sync) and for secrets no user may read (the Microsoft connection).

export const SERVICE_KEY_NAMES = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

const serviceKey = () => (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export const serviceReady = () => Boolean(SUPABASE_URL && serviceKey());

let client: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!serviceReady()) throw new Error("SUPABASE_SECRET_KEY isn't set in Vercel yet.");
  client ??= createClient(SUPABASE_URL, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
