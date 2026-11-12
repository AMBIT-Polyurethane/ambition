import Link from "next/link";
import { howtoBySlug } from "@/lib/howto";
import { BrandImg } from "@/components/brand";

/** The little AMBIT molecule with "How to": opens the walkthrough video for the job on this screen (employees). */
export function HowToChip({ slug, label = "How to" }: { slug: string; label?: string }) {
  const v = howtoBySlug(slug);
  if (!v) return null;
  return (
    <Link href={`/how-to/${v.slug}`} className="howto-chip" title={`Watch: ${v.title}`} aria-label={`How-to video: ${v.title}`}>
      <span className="howto-chip-mark"><BrandImg art="atom-mark" /></span>
      <span>{label}</span>
    </Link>
  );
}
