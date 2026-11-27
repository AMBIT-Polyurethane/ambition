import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { msrpRealPrices, type MyPrice } from "@/lib/adc-my-prices";

/** Anyone signed in on the ADC store: their real Graco / Binks prices (their AMBIT account's prices when they have one). */
export const adcMyPrices = cache(async (): Promise<{ signedIn: boolean; prices: Record<string, MyPrice> }> => {
  try {
    const supabase = await createClient();
    const { data: c } = await supabase.auth.getClaims();
    const uid = c?.claims?.sub as string | undefined;
    if (!uid) return { signedIn: false, prices: {} };
    let companyId: string | null = null;
    if (serviceReady()) {
      const { data: p } = await serviceClient().from("profiles").select("company_id").eq("id", uid).maybeSingle();
      companyId = (p as { company_id: string | null } | null)?.company_id ?? null;
    }
    const m = await msrpRealPrices({ companyId });
    return { signedIn: true, prices: Object.fromEntries(m) };
  } catch {
    return { signedIn: false, prices: {} };
  }
});
