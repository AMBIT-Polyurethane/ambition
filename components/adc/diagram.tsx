"use client";

import { PartsDiagram, type PartInfo } from "@/components/parts-diagram";
import { useAdcCart } from "@/components/adc/cart";
import { diagramBySlug } from "@/lib/diagrams";

/** The parts diagram on the ADC store: clicking a part puts it in the cart (parts not in the catalog yet: price to confirm). */
export function AdcDiagram({ slug, info, images }: { slug: string; info: Record<string, PartInfo>; images: Record<string, string | null> }) {
  const { add } = useAdcCart();
  const d = diagramBySlug(slug);
  if (!d) return null;
  return (
    <PartsDiagram
      diagram={d}
      info={info}
      canAddMissing
      onAdd={(p, i) => add({ id: i?.id ?? null, sku: p.sku, name: p.name, image: images[p.sku] ?? null }, 1)}
    />
  );
}
