import "server-only";
import { headers } from "next/headers";
import { serviceClient, serviceReady } from "@/lib/supabase/service";

import { usPhone } from "@/lib/sms-text";
export { usPhone };

export type SmsSource = "adc_checkout" | "adc_signup" | "adc_account" | "app_profile" | "reply";

/**
 * Keeps a dated record of a text-message yes or no (carriers require proof of consent) and sets the matching
 * "texts OK" flag. Never stops the page it's called from: before database update 0103 it quietly does nothing.
 */
export async function recordSmsConsent(c: {
  phone: unknown;
  optedIn: boolean;
  source: SmsSource;
  userId?: string | null;
  name?: string | null;
  company?: string | null;
  ref?: string | null;
  text?: string | null;
  lang?: string | null;
  flags?: { table: "profiles" | "adc_accounts" | "adc_orders"; column: "id" | "user_id"; value: string | number }[];
}): Promise<void> {
  const phone = usPhone(c.phone);
  if (!serviceReady()) return;
  try {
    const db = serviceClient();
    if (phone) {
      const h = await headers();
      const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim().slice(0, 60) || null;
      const { error } = await db.from("sms_consents").insert({
        phone, opted_in: c.optedIn, source: c.source, user_id: c.userId ?? null, name: c.name?.slice(0, 120) ?? null, company: c.company?.slice(0, 160) ?? null,
        ref: c.ref?.slice(0, 60) ?? null, consent_text: c.text?.slice(0, 1000) ?? null, lang: c.lang ?? null, ip, user_agent: (h.get("user-agent") ?? "").slice(0, 300) || null,
      });
      if (error) console.error("sms consent: record failed", error.message);
    }
    if (phone || !c.optedIn) {
      for (const f of c.flags ?? []) {
        const { error } = await db.from(f.table).update({ sms_opt_in: c.optedIn && Boolean(phone) }).eq(f.column, f.value);
        if (error) console.error("sms consent: flag failed", error.message);
      }
    }
  } catch (e) {
    console.error("sms consent", e);
  }
}

export { APP_SMS_TEXT } from "@/lib/sms-text";
