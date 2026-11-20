import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { dict } from "@/lib/adc-i18n";
import { adcLang } from "@/lib/adc-lang";

export async function generateMetadata(): Promise<Metadata> {
  return { title: dict(await adcLang()).orderReceived, robots: { index: false } };
}

export default async function AdcThanks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const t = dict(await adcLang());
  const n = (sp.n ?? "").replace(/[^A-Z0-9-]/gi, "").slice(0, 20);
  return (
    <div className="adc-wrap adc-pad">
      <div className="adc-thanks">
        <CircleCheck size={54} aria-hidden="true" />
        <h1 className="adc-h1">{t.gotIt(n && n !== "ADC-0" ? n : "")}</h1>
        <p>{t.gotItText}</p>
        <p className="adc-note-b"><b>{t.contactNote}</b></p>
        <p className="adc-muted small">{t.shipDisclaimer}</p>
        <Link href="/adc" className="adc-cta">{t.keepShopping}</Link>
      </div>
    </div>
  );
}
