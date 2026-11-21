"use client";

import { useAdc } from "@/components/adc/lang";
import { SMS_PRIVACY_URL, SMS_TERMS_URL } from "@/lib/sms-text";

/** "Text me order updates": never ticked for them; the words and the two links are what carriers require next to the box. */
export function AdcSmsCheck({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const { t } = useAdc();
  return (
    <label className="adc-check adc-sms">
      <input type="checkbox" name="sms" defaultChecked={defaultChecked} />
      <span>
        {t.smsOpt}{" "}
        <a href={SMS_PRIVACY_URL} target="_blank" rel="noopener">{t.smsPrivacy}</a>
        {" · "}
        <a href={SMS_TERMS_URL} target="_blank" rel="noopener">{t.smsTerms}</a>
      </span>
    </label>
  );
}
