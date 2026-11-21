"use client";

import Link from "next/link";
import { useAdc } from "@/components/adc/lang";

/** "Text me order updates": never ticked for them; the words are what carriers require next to the box. */
export function AdcSmsCheck({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const { t } = useAdc();
  return (
    <label className="adc-check adc-sms">
      <input type="checkbox" name="sms" defaultChecked={defaultChecked} />
      <span>
        {t.smsOpt}{" "}
        <Link href="/adc/policies#sms" target="_blank" rel="noopener">{t.smsTerms}</Link>
      </span>
    </label>
  );
}
