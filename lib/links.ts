import type { LinkRow } from "@/lib/types";

export function linkHref(l: Pick<LinkRow, "id" | "url" | "open_in_app">): { href: string; external: boolean } | null {
  if (!l.url) return null;
  if (l.open_in_app && /^https?:\/\//.test(l.url)) return { href: `/go/${l.id}`, external: false };
  return { href: l.url, external: /^https?:\/\//.test(l.url) };
}
