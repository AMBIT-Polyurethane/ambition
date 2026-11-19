import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";

export const metadata: Metadata = { title: "Order received", robots: { index: false } };

export default async function AdcThanks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const n = (sp.n ?? "").replace(/[^A-Z0-9-]/gi, "").slice(0, 20);
  return (
    <div className="adc-wrap adc-pad">
      <div className="adc-thanks">
        <CircleCheck size={54} aria-hidden="true" />
        <h1 className="adc-h1">We got your order{n && n !== "ADC-0" ? ` ${n}` : ""}.</h1>
        <p>Someone from AMBIT will call or email you shortly to confirm the total, shipping and payment. Nothing ships until you say yes.</p>
        <Link href="/adc" className="adc-cta">Keep shopping</Link>
      </div>
    </div>
  );
}
