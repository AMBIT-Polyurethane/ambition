/** The words next to the app's "text me" box (English). The ADC store has its own in each language (lib/adc-i18n). */
export const APP_SMS_TEXT =
  "Text me order updates and alerts from AMBIT Polyurethane at this number. Message frequency varies. Msg & data rates may apply. Reply STOP to cancel, HELP for help.";

/** A US mobile number as 10 digits ("(682) 418-5200" -> "6824185200"), or null when it isn't one. */
export function usPhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
}

export const SMS_PHONE_NEEDED = "To get texts, add a 10-digit US mobile number.";

/** AMBIT's Privacy Policy and Terms & Conditions: carriers require a direct link to both wherever people opt in to texts. */
export const SMS_PRIVACY_URL = "https://ambitpu.com/privacy/";
export const SMS_TERMS_URL = "https://ambitpu.com/terms/";
