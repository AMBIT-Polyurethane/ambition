// Shared by the server pages and the cart (no server-only imports here).

export type Season = "winter" | "summer";

/** Winter or summer blend (spray foam): from the name, or a -W part number. */
export function seasonOf(i: { sku: string; name: string; category_id?: string | null }): Season | null {
  if (i.category_id && i.category_id !== "ambit-foam") return null;
  if (/\bwinter\b|\barctic\b/i.test(i.name) || /-W$/i.test(i.sku) || /-WTOTE$/i.test(i.sku)) return "winter";
  if (/\bsummer\b/i.test(i.name) || /-S$/i.test(i.sku)) return "summer";
  return null;
}
