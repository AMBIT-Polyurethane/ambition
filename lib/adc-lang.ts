import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, asLang, type Lang } from "@/lib/adc-i18n";

/** The language the shopper picked on the ADC store (English unless they switched to Spanish). */
export async function adcLang(): Promise<Lang> {
  return asLang((await cookies()).get(LANG_COOKIE)?.value);
}
